"""方案 B 後續：映射版匯入冪等防護 + prop-check 非 DEMO 真實推論路徑測試。

重點：
  1) 已登記筆誤映射的提交，匯入後模型必須標記「映射版·臨時」、有效類別 4 類。
  2) 同一提交不得匯入出第二個模型（即使狀態被改回 SUBMITTED）。
  3) prop-check 在 demo_simulation_enabled=False 時，必須走真實推論分支
     （用 ACTIVE 模型），而不是 simulate_prop_check。
  4) 對照組：demo_simulation_enabled=True 時確實走 DEMO 模擬分支。

做法：不改動正式 DEMO 設定，只用「測試專用 VisionCenter + 獨立 TestClient」。
"""
from __future__ import annotations

import base64
import json
import os
import tempfile
import unittest
from pathlib import Path

from starlette.testclient import TestClient

from app import vision_center as vc
from app.main import create_app

RAW_SIX = ["CCE-F", "CCF-b", "CCW-F", "CCW-B", "CW-F", "CW-B"]
MAPPING = {
    "CCE-F": "CCW_F",
    "CCF-b": "CCW_B",
    "CCW-F": "CCW_F",
    "CCW-B": "CCW_B",
    "CW-F": "CW_F",
    "CW-B": "CW_B",
}
TEACHER = {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "teacher-1"}


class OfflineVision:
    async def health(self):
        return False


class OkHealthInspector:
    """假 .pt 內容不是真實 checkpoint（真實檢查會判 UNKNOWN）；注入 OK 健康度，
    讓本檔聚焦映射與 prop-check 路徑（健康度閈門由 test_model_health.py 覆蓋）。
    nc/names_count 給 None（不斷言分類頭數量），與六類映射提交／四類基準兩種
    裝置都相容；數量一致性由 validator 回傳的類別名本身把關。"""

    def __call__(self, _path):
        return {
            "health": vc.HEALTH_OK,
            "reasons": [],
            "map50": 0.9,
            "nc": None,
            "names_count": None,
            "map50_threshold": 0.5,
        }


class SixClassValidator:
    """模擬 sub-5d87f027：6 類、含筆誤名稱。"""

    def validate(self, _path, _model_type):
        return {"class_names": list(RAW_SIX), "task": "detect", "smoke_inference": True}


class FourClassValidator:
    """正常的 4 類模型（作為回滾基準）。"""

    def validate(self, _path, _model_type):
        return {"class_names": list(vc.PROP_CLASSES), "task": "detect", "smoke_inference": True}


class SixClassRunner:
    """6 類原始輸出，其中 CCE-F / CCW-F 命中同一個框（用於驗證去重）。"""

    def predict(self, _path, _image_bytes):
        return [
            {"class": "CCE-F", "confidence": 0.71, "bbox": [10, 10, 110, 110], "center_x": 60, "center_y": 60},
            {"class": "CCW-F", "confidence": 0.93, "bbox": [11, 11, 110, 110], "center_x": 60.5, "center_y": 60.5},
            {"class": "CW-F", "confidence": 0.80, "bbox": [300, 10, 400, 110], "center_x": 350, "center_y": 60},
            {"class": "CW-B", "confidence": 0.75, "bbox": [10, 300, 110, 400], "center_x": 60, "center_y": 350},
        ]

    def get_names(self, _path):
        return list(RAW_SIX)


class Base(unittest.TestCase):
    demo_simulation = False

    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".test-temp"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.center = vc.VisionCenter(
            self.temp.name,
            model_validator=SixClassValidator(),
            model_runner=SixClassRunner(),
            demo_simulation_enabled=self.demo_simulation,
            model_health_inspector=OkHealthInspector(),
            # 本檔焦點為映射與 prop-check 路徑；質量證據閈口（require_evaluation）
            # 由 test_vision_quality_gate.py 專門覆蓋，這裡關閉以隔离变量。
            quality_gate={"require_evaluation": False},
        )
        self.client = TestClient(
            create_app(vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=True)
        )
        self.submission = self.center.create_submission(
            task_id="PROP_DIRECTION",
            student_id="DEMO-STU-0001",
            group_id="DEMO-A",
            original_filename="best.pt",
            content=b"fake-pt-content-for-test",
            growth_record_slot="R07",
        )
        self.mapping_file = Path(self.temp.name) / "vision_class_mappings.json"
        self.mapping_file.write_text(
            json.dumps({
                "schema_version": 1,
                "submissions": {
                    self.submission["submission_id"]: {
                        "task_id": "PROP_DIRECTION",
                        "temporary": True,
                        "registered_at": "2026-10-19",
                        "reason": "test typo mapping",
                        "name_mapping": MAPPING,
                    }
                },
            }, ensure_ascii=False),
            encoding="utf-8",
        )
        self._previous_env = os.environ.get("FDE_VISION_CLASS_MAPPINGS")
        os.environ["FDE_VISION_CLASS_MAPPINGS"] = str(self.mapping_file)

    def tearDown(self):
        if self._previous_env is None:
            os.environ.pop("FDE_VISION_CLASS_MAPPINGS", None)
        else:
            os.environ["FDE_VISION_CLASS_MAPPINGS"] = self._previous_env
        self.temp.cleanup()

    def dataset(self) -> dict:
        response = self.client.post(
            "/api/v1/vision/datasets", headers=TEACHER,
            json={"model_type": "PROP_DIRECTION", "dataset_version": "v1"},
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def import_mapped(self) -> dict:
        dataset = self.dataset()
        return self.center.import_submission(
            self.submission["submission_id"],
            model_name="mapped", version="v1",
            dataset_id=dataset["dataset_id"], dataset_version="v1",
            rule_version="PROP_RULE_v1", uploaded_by="teacher-1",
        )

    def remember_validation(self, model_id):
        """A 硬規則（2026-10-23）：啟用需有真實圖片驗證通過紀錄（最高信心 ≥ 0.6）。
        本檔以一次 MATCH 紀錄滿足啟用前置條件（啟用資格由專門套件覆蓋）。"""
        self.center._remember_validation(
            model_id=model_id, model_type="PROP_DIRECTION", decision="MATCH",
            max_confidence=0.9, expected_class=None, confidence_threshold=0.5,
            validated_by="teacher-1", reason_code="OK",
        )


class MappingImportTests(Base):
    def test_registered_mapping_marks_temporary_and_four_classes(self):
        model = self.import_mapped()
        self.assertEqual(model["class_names"], list(vc.PROP_CLASSES))
        self.assertEqual(model["class_count"], 4)
        self.assertEqual(model["class_count_raw"], 6)
        self.assertTrue(model["temporary_mapping"])
        self.assertEqual(model["temporary_mapping_label"], "映射版·臨時")
        self.assertEqual(model["class_name_mapping_source"], "registered_typo_mapping")
        self.assertEqual(model["class_name_mapping"], MAPPING)
        self.assertEqual(model["validation_status"], "VALIDATED")
        stored = self.center.get_submission(self.submission["submission_id"])
        self.assertEqual(stored["status"], "IMPORTED")
        self.assertEqual(stored["imported_model_id"], model["model_id"])

    def test_duplicate_import_is_rejected(self):
        first = self.import_mapped()
        stored = self.center._find("submissions", "submission_id", self.submission["submission_id"])
        # 模擬「狀態被人工改回 SUBMITTED」後又重送一次
        stored["status"] = "SUBMITTED"
        dataset = self.dataset()
        with self.assertRaises(ValueError) as ctx:
            self.center.import_submission(
                self.submission["submission_id"],
                model_name="mapped-again", version="v1",
                dataset_id=dataset["dataset_id"], dataset_version="v1",
                rule_version="PROP_RULE_v1", uploaded_by="teacher-1",
            )
        self.assertIn("submission_already_imported", str(ctx.exception))
        created = [m for m in self.center.list_models() if m.get("source_submission_id") == self.submission["submission_id"]]
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0]["model_id"], first["model_id"])

    def test_rejected_record_does_not_block_retry(self):
        model = self.import_mapped()
        stored = self.center._find("models", "model_id", model["model_id"])
        stored["status"] = "REJECTED"
        stored["validation_status"] = "REJECTED"
        submission = self.center._find("submissions", "submission_id", self.submission["submission_id"])
        submission["status"] = "SUBMITTED"
        retried = self.import_mapped()
        self.assertNotEqual(retried["model_id"], model["model_id"])
        self.assertTrue(retried["temporary_mapping"])


class DedupTests(unittest.TestCase):
    def test_same_box_same_mapped_class_keeps_highest(self):
        detections = [
            {"class": "CCE-F", "confidence": 0.71, "bbox": [10, 10, 110, 110]},
            {"class": "CCW-F", "confidence": 0.93, "bbox": [11, 11, 110, 110]},
            {"class": "CW-F", "confidence": 0.55, "bbox": [300, 10, 400, 110]},
        ]
        mapped, removed = vc.apply_mapping_to_detections(detections, MAPPING)
        self.assertEqual(removed, 1)
        self.assertEqual([item["class"] for item in mapped], ["CCW_F", "CW_F"])
        self.assertEqual(mapped[0]["confidence"], 0.93)
        self.assertEqual(mapped[0]["class_raw"], "CCW-F")


class PropCheckRealPathTests(Base):
    """demo_simulation_enabled=False → prop-check 必須走真實推論分支。"""

    def test_prop_check_uses_active_model_not_demo(self):
        model = self.import_mapped()
        self.remember_validation(model["model_id"])
        self.center.activate_model(model["model_id"], "teacher-1")
        response = self.client.post(
            "/api/v1/vision/prop-check",
            json={
                "image_base64": base64.b64encode(b"prop-image").decode(),
                "image_width": 640, "image_height": 480,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertFalse(body.get("simulation_mode", False))
        self.assertEqual((body.get("model") or {}).get("model_id"), model["model_id"])
        self.assertNotIn("DEMO_R07", json.dumps(body, ensure_ascii=False))

        classes = [item["class"] for item in body["detections"]]
        self.assertTrue(set(classes) <= set(vc.PROP_CLASSES), classes)
        # 4 筆原始偵測 → 映射後同框合併 1 筆 = 3 筆
        self.assertEqual(len(classes), 3, classes)
        self.assertNotIn("CCE-F", classes)
        self.assertIn("CCW_F", classes)
        # 4 個位置都要有結果，且格式完整
        self.assertEqual(set(body["positions"]), {"M1", "M2", "M3", "M4"})
        self.assertIn(body["final_result"], {"PASS", "NG", "INSUFFICIENT_DATA"})

    def test_prop_check_rollback_to_previous_model(self):
        # 先建立並啟用一個正常 4 類模型，作為回滾基準
        dataset = self.dataset()
        self.center.model_validator = FourClassValidator()
        try:
            baseline = self.center.upload_model(
                model_type="PROP_DIRECTION", model_name="baseline", version="v1",
                content=b"baseline-pt", dataset_id=dataset["dataset_id"],
                dataset_version="v1", rule_version="PROP_RULE_v1", uploaded_by="teacher-1",
            )
        finally:
            self.center.model_validator = SixClassValidator()
        self.remember_validation(baseline["model_id"])
        self.center.activate_model(baseline["model_id"], "teacher-1")

        mapped = self.import_mapped()
        self.remember_validation(mapped["model_id"])
        self.center.activate_model(mapped["model_id"], "teacher-1")
        self.assertEqual(self.center.active_model("PROP_DIRECTION")["model_id"], mapped["model_id"])

        restored = self.center.rollback_model("PROP_DIRECTION", "teacher-1")
        self.assertEqual(restored["restored"]["model_id"], baseline["model_id"])
        active = self.center.active_model("PROP_DIRECTION")
        self.assertEqual(active["model_id"], baseline["model_id"])
        self.assertFalse(bool(active.get("temporary_mapping")))
        self.assertEqual(active["class_names"], list(vc.PROP_CLASSES))


class PropCheckDemoPathTests(Base):
    """對照組：demo_simulation_enabled=True 時確實走 DEMO 模擬。"""

    demo_simulation = True

    def test_prop_check_uses_demo_simulation_when_enabled(self):
        self.center.approve_demo_submission(
            self.submission["submission_id"], approved_by="teacher-1"
        )
        response = self.client.post(
            "/api/v1/vision/prop-check",
            json={
                "image_base64": base64.b64encode(b"prop-image").decode(),
                "image_width": 640, "image_height": 480,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body.get("simulation_mode") is True)
        self.assertTrue(str((body.get("model") or {}).get("model_id", "")).startswith("DEMO_R07_"))


if __name__ == "__main__":
    unittest.main()
