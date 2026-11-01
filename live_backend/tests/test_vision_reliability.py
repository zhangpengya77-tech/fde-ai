"""D1 / D2 / D4 定向測試（2026-10-19）。

只覆蓋本輪修復的三項：
- D1：資料集隔離（匯入失敗補償用），不刪除、不進清單、可追溯；
- D2：導入失敗原因寫入 import_last_error（含預檢失敗）；
- D4：隔離模型不得啟用。

不涉及 D3 的啟用閘門（Golden Test／圖片驗證）。
"""

import tempfile
import unittest
from pathlib import Path

from app.vision_center import PROP_CLASSES, ModelValidationError, VisionCenter


class OkHealthInspector:
    """假 .pt 內容不是真實 checkpoint（真實檢查判 UNKNOWN）；注入 OK 健康度，
    讓本檔聚焦隔離/還原規則（健康度閈門由 test_model_health.py 覆蓋）。
    nc=None 不斷言分類頭數量，與各預期類別集相容。"""

    def __call__(self, _path):
        return {
            "health": "OK",
            "reasons": [],
            "map50": 0.9,
            "nc": None,
            "names_count": None,
            "map50_threshold": 0.5,
        }


class FixtureValidator:
    def validate(self, _path: Path, model_type: str) -> dict:
        classes = PROP_CLASSES if model_type == "PROP_DIRECTION" else ("FRONT", "RIGHT", "BACK", "LEFT")
        return {"class_names": list(classes), "task": "detect", "smoke_inference": True}


class WrongClassValidator:
    """1 類 vs 預期 4 類：預檢即失敗，用來驗證失敗原因是否被記錄。"""

    def validate(self, _path: Path, _model_type: str) -> dict:
        return {"class_names": ["WRONG"], "task": "detect", "smoke_inference": True}


class VisionReliabilityTests(unittest.TestCase):
    def setUp(self):
        test_root = Path(__file__).resolve().parents[2] / ".test-temp"
        test_root.mkdir(parents=True, exist_ok=True)
        # 不用 TemporaryDirectory：沙箱會攔截其 bulk delete，改用 mkdtemp 避免雜訊。
        self.root = Path(tempfile.mkdtemp(prefix="p1-", dir=test_root))
        self.center = VisionCenter(
            self.root,
            model_validator=FixtureValidator(),
            model_health_inspector=OkHealthInspector(),
            # 本檔聚焦隔離/還原等可靠性規則；健康度與質量證據閈門由專門套件覆蓋。
            quality_gate={"require_evaluation": False},
        )

    def remember_validation(self, model_id, model_type="PROP_DIRECTION"):
        """A 硬規則（2026-10-23）：啟用需有真實圖片驗證通過紀錄（最高信心 ≥ 0.6）。
        以一次 MATCH 紀錄滿足啟用前置條件（資格判定由專門套件覆蓋）。"""
        self.center._remember_validation(
            model_id=model_id, model_type=model_type, decision="MATCH",
            max_confidence=0.9, expected_class=None, confidence_threshold=0.5,
            validated_by="teacher", reason_code="OK",
        )

    # ---- helpers ----
    def dataset(self, model_type="PROP_DIRECTION", version="v1"):
        return self.center.create_dataset({
            "model_type": model_type, "dataset_version": version, "total_images": 12,
            "train_count": 8, "val_count": 2, "test_count": 2,
            "class_distribution": {}, "source_groups": ["fixture"], "created_by": "teacher",
        })

    def model(self, dataset=None, model_type="PROP_DIRECTION", version="v1", validator=None):
        dataset = dataset or self.dataset(model_type, version)
        if validator:
            self.center.model_validator = validator
        return self.center.upload_model(
            model_type=model_type, model_name=f"{model_type}-{version}", version=version,
            content=b"fixture-pt", dataset_id=dataset["dataset_id"],
            dataset_version=dataset["dataset_version"], rule_version="r1", uploaded_by="teacher",
        )

    def submission(self, model_type="PROP_DIRECTION"):
        return self.center.create_submission(
            task_id=model_type, student_id="s1", group_id="G1",
            original_filename="best.pt", content=b"fixture-pt",
        )

    def mark_quarantined(self, collection, key, value):
        record = self.center._find(collection, key, value)
        record.update(quarantined=True, quarantined_at="2026-10-19T00:00:00Z",
                      quarantine_reason="test", quarantined_by="teacher")
        self.center.store.save()
        return record

    # ---- D4：隔離模型不得啟用 ----
    def test_quarantined_model_cannot_be_activated(self):
        active = self.model(version="v1")
        self.remember_validation(active["model_id"])
        self.center.activate_model(active["model_id"], "teacher")
        candidate = self.model(version="v2")
        self.mark_quarantined("models", "model_id", candidate["model_id"])

        with self.assertRaises(ValueError) as ctx:
            self.center.activate_model(candidate["model_id"], "teacher")
        self.assertEqual(str(ctx.exception), "model_quarantined")
        # ACTIVE 必須完全不變
        self.assertEqual(self.center.active_model("PROP_DIRECTION")["model_id"], active["model_id"])
        self.assertEqual(self.center.get_model(candidate["model_id"])["status"], "VALIDATED")

    def test_normal_candidate_still_activates_after_quarantine_check(self):
        """D4 不得影響正常流程：未隔離的候選仍可啟用。"""
        first = self.model(version="v1")
        self.remember_validation(first["model_id"])
        self.center.activate_model(first["model_id"], "teacher")
        second = self.model(version="v2")
        self.remember_validation(second["model_id"])
        result = self.center.activate_model(second["model_id"], "teacher")
        self.assertEqual(result["status"], "ACTIVE")
        self.assertEqual(self.center.active_model("PROP_DIRECTION")["model_id"], second["model_id"])

    # ---- D1：資料集隔離 ----
    def test_quarantine_dataset_hides_from_list_but_keeps_record(self):
        dataset = self.dataset()
        before = len(self.center.list_datasets())
        result = self.center.quarantine_dataset(
            dataset["dataset_id"], reason="import_failed:test",
            source_submission_id="sub-fixture", quarantined_by="teacher",
        )
        self.assertTrue(result["quarantined"])
        self.assertEqual(result["quarantine_reason"], "import_failed:test")
        self.assertEqual(result["source_submission_id"], "sub-fixture")
        self.assertEqual(len(self.center.list_datasets()), before - 1)
        # 記錄與檔案仍在，可用 ID 取回
        kept = self.center._find("datasets", "dataset_id", dataset["dataset_id"])
        self.assertTrue(Path(kept["storage_path"]).exists())
        self.assertEqual(len(self.center.store.data["datasets"]), before)
        # metadata 檔同步寫入隔離狀態，供日後追查
        metadata = Path(kept["storage_path"]) / "dataset_metadata.json"
        self.assertIn("quarantined", metadata.read_text(encoding="utf-8"))

    def test_quarantine_dataset_is_idempotent(self):
        dataset = self.dataset()
        first = self.center.quarantine_dataset(dataset["dataset_id"], reason="import_failed:a")
        second = self.center.quarantine_dataset(dataset["dataset_id"], reason="import_failed:b")
        self.assertEqual(first["quarantine_reason"], second["quarantine_reason"])

    def test_quarantine_refuses_dataset_referenced_by_model(self):
        dataset = self.dataset()
        self.model(dataset=dataset)
        with self.assertRaises(ValueError) as ctx:
            self.center.quarantine_dataset(dataset["dataset_id"], reason="import_failed:test")
        self.assertEqual(str(ctx.exception), "dataset_in_use")
        self.assertEqual(len(self.center.list_datasets()), 1)

    def test_retry_after_quarantine_creates_new_visible_dataset(self):
        """同一提交重試：舊隔離資料集不得干擾新資料集。"""
        old = self.dataset()
        self.center.quarantine_dataset(old["dataset_id"], reason="import_failed:test",
                                       source_submission_id="sub-retry")
        new = self.dataset()
        visible = [item["dataset_id"] for item in self.center.list_datasets()]
        self.assertIn(new["dataset_id"], visible)
        self.assertNotIn(old["dataset_id"], visible)

    # ---- D2：失敗原因寫入 ----
    def test_preflight_failure_records_import_last_error(self):
        self.center.model_validator = WrongClassValidator()
        dataset = self.dataset()
        sub = self.submission()
        with self.assertRaises(ModelValidationError):
            self.center.import_submission(
                sub["submission_id"], model_name="imp", version="v1",
                dataset_id=dataset["dataset_id"], dataset_version=dataset["dataset_version"],
                rule_version="r1", uploaded_by="teacher",
            )
        record = self.center.get_submission(sub["submission_id"])
        self.assertEqual(record["status"], "SUBMITTED")
        self.assertIn("model_class_names_mismatch", record.get("import_last_error") or "")
        self.assertTrue(record.get("import_attempted_at"))
        # 預檢失敗不得建立模型
        self.assertEqual(self.center.list_models(), [])

    def test_duplicate_import_records_reason_on_submitted_record(self):
        dataset = self.dataset()
        sub = self.submission()
        self.center.import_submission(
            sub["submission_id"], model_name="imp", version="v1",
            dataset_id=dataset["dataset_id"], dataset_version=dataset["dataset_version"],
            rule_version="r1", uploaded_by="teacher",
        )
        # 人工把狀態改回 SUBMITTED，模擬「狀態被誤改」後重送
        record = self.center._find("submissions", "submission_id", sub["submission_id"])
        record["status"] = "SUBMITTED"
        self.center.store.save()
        with self.assertRaises(ValueError) as ctx:
            self.center.import_submission(
                sub["submission_id"], model_name="imp2", version="v2",
                dataset_id=dataset["dataset_id"], dataset_version=dataset["dataset_version"],
                rule_version="r1", uploaded_by="teacher",
            )
        self.assertIn("submission_already_imported", str(ctx.exception))
        refreshed = self.center.get_submission(sub["submission_id"])
        self.assertIn("submission_already_imported", refreshed.get("import_last_error") or "")

    def test_record_import_failure_writes_django_side_reason(self):
        sub = self.submission()
        result = self.center.record_import_failure(
            sub["submission_id"], message="無法連線到推論服務，請確認服務已啟動後重試。",
            code="vision_api_unavailable", recorded_by="teacher",
        )
        self.assertTrue(result["recorded"])
        record = self.center.get_submission(sub["submission_id"])
        self.assertEqual(record["import_last_error"], "無法連線到推論服務，請確認服務已啟動後重試。")
        self.assertEqual(record["import_last_error_code"], "vision_api_unavailable")
        self.assertEqual(record["status"], "SUBMITTED")

    def test_record_import_failure_never_marks_imported_submission(self):
        """失敗不得把已成功導入的提交標成失敗。"""
        dataset = self.dataset()
        sub = self.submission()
        self.center.import_submission(
            sub["submission_id"], model_name="imp", version="v1",
            dataset_id=dataset["dataset_id"], dataset_version=dataset["dataset_version"],
            rule_version="r1", uploaded_by="teacher",
        )
        result = self.center.record_import_failure(
            sub["submission_id"], message="重複導入", code="submission_already_imported",
        )
        self.assertFalse(result["recorded"])
        record = self.center.get_submission(sub["submission_id"])
        self.assertEqual(record["status"], "IMPORTED")
        self.assertIsNone(record.get("import_last_error"))

    def test_successful_import_clears_previous_error(self):
        dataset = self.dataset()
        sub = self.submission()
        self.center.record_import_failure(
            sub["submission_id"], message="先前的失敗", code="vision_api_unavailable",
        )
        self.assertEqual(
            self.center.get_submission(sub["submission_id"])["import_last_error"], "先前的失敗",
        )
        self.center.import_submission(
            sub["submission_id"], model_name="imp", version="v1",
            dataset_id=dataset["dataset_id"], dataset_version=dataset["dataset_version"],
            rule_version="r1", uploaded_by="teacher",
        )
        record = self.center.get_submission(sub["submission_id"])
        self.assertEqual(record["status"], "IMPORTED")
        self.assertIsNone(record.get("import_last_error"))
        self.assertIsNone(record.get("import_last_error_code"))


if __name__ == "__main__":
    unittest.main()
