"""模型管理（歸檔／還原／永久刪除／學員重傳）契約測試（2026-10-21 教師指令）。

教師指令：「教師視覺模型中心新增『模型管理』：不理想模型可歸檔/刪除，學員可再傳新模型。」

本檔以隔離臨時目錄與真實 HTTP 端點，逐條證明 M1–M7 的契約：

M1 歸檔      ACTIVE／驗證中一律拒絕；非 ACTIVE 可歸檔；.pt 不動；重複歸檔冪等。
M2 還原      僅教師手動歸檔件可還原；回到歸檔前狀態；反向解除「已被取代」。
M3 永久刪除  ACTIVE／驗證中拒絕；共用 .pt（sha256）時只刪記錄不刪檔案並回報共用方；
             無共用時才物理刪除；連帶移除該模型的 evaluations。
M4 後端硬攔  錯誤碼 model_active_cannot_manage／model_validation_in_progress；
             未帶教師標頭 → 403 teacher_required（不靠前端隱藏按鈕）。
M5 學員重傳  歸檔／刪除後來源提交標記 superseded；學員可再上傳新檔；
             重傳同檔只提示「與已歸檔模型相同」不拒絕；重傳未訓練模型仍被 D2 拒絕。
M6 審計      操作者／時間／原因／備份路徑／store SHA 寫入 store 之外的 JSONL。
M7 備份      操作前自動備份 store（含 SHA256）。

全部使用隔離臨時目錄，不觸碰 DEMO／正式資料。
"""

import base64
import json
import tempfile
import unittest
from pathlib import Path

from p6_signed_client import legacy_header_client as TestClient

from app.main import create_app
from app.vision_center import (
    HEALTH_LOW_QUALITY,
    HEALTH_OK,
    HEALTH_UNTRAINED,
    PROP_CLASSES,
    ModelValidationError,
    VisionCenter,
)


class FixtureValidator:
    """回報固定 4 類 detect 模型，讓匯入不需要真實 ultralytics。"""

    def validate(self, _path, _model_type):
        return {"class_names": list(PROP_CLASSES), "task": "detect", "smoke_inference": True}


class OkHealthInspector:
    def __call__(self, _path):
        return {
            "health": HEALTH_OK,
            "reasons": [],
            "map50": 0.9,
            "nc": None,
            "names_count": 4,
            "map50_threshold": 0.5,
        }


class UntrainedHealthInspector:
    def __call__(self, _path):
        return {
            "health": HEALTH_UNTRAINED,
            "reasons": ["no_train_args"],
            "map50": None,
            "nc": None,
            "names_count": 4,
            "map50_threshold": 0.5,
        }


class LowQualityHealthInspector:
    def __call__(self, _path):
        return {
            "health": HEALTH_LOW_QUALITY,
            "reasons": ["map50_below_threshold"],
            "map50": 0.117,
            "nc": None,
            "names_count": 4,
            "map50_threshold": 0.5,
        }


class OfflineVision:
    async def health(self):
        return False


class ModelManagementTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".test-temp"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.root = Path(self.temp.name)
        self.center = self.make_center()
        self.client = TestClient(
            create_app(vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=True)
        )
        self.teacher = {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "teacher-1"}

    def tearDown(self):
        self.temp.cleanup()

    def make_center(self, inspector=None):
        """隔離中心：關閉評估證據閘門（require_evaluation=False），讓類別名吻合即 VALIDATED。"""
        return VisionCenter(
            self.root,
            model_validator=FixtureValidator(),
            model_health_inspector=inspector or OkHealthInspector(),
            quality_gate={"require_evaluation": False, "map50_threshold": 0.5},
        )

    # ---- helpers ----
    def create_dataset(self):
        response = self.client.post(
            "/api/v1/vision/datasets",
            headers=self.teacher,
            json={"model_type": "PROP_DIRECTION", "dataset_version": "v1", "created_by": "t"},
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def submit(self, content=b"pt-v1", student="DEMO-STU-0001", filename="best.pt"):
        response = self.client.post(
            "/api/v1/vision/submissions",
            json={
                "task_id": "PROP_DIRECTION",
                "student_id": student,
                "group_id": "G1",
                "original_filename": filename,
                "file_base64": base64.b64encode(content).decode(),
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def import_submission(self, submission_id, version="v1"):
        dataset = self.create_dataset()
        response = self.client.post(
            f"/api/v1/vision/submissions/{submission_id}/import",
            headers=self.teacher,
            json={
                "model_name": f"mgmt-{version}",
                "version": version,
                "dataset_id": dataset["dataset_id"],
                "dataset_version": "v1",
                "rule_version": "r1",
            },
        )
        self.assertEqual(response.status_code in (200, 201), True, response.text)
        return response.json()

    def model_from_submission(self, content=b"pt-v1", version="v1"):
        submission = self.submit(content=content, filename=f"{version}.pt")
        model = self.import_submission(submission["submission_id"], version=version)
        return submission, model

    def activate(self, model_id):
        # A 硬規則（2026-10-23 教師指令）：啟用需有真實圖片驗證通過紀錄（最高信心 ≥ 0.6）。
        # 本檔焦點為歸檔/刪除/還原行為，以一次 MATCH 紀錄滿足啟用前置條件；
        # 啟用資格本身由 test_vision_center.py／test_vision_quality_gate.py 覆蓋。
        self.center._remember_validation(
            model_id=model_id, model_type="PROP_DIRECTION", decision="MATCH",
            max_confidence=0.9, expected_class=None, confidence_threshold=0.5,
            validated_by="teacher-1", reason_code="OK",
        )
        return self.client.post(
            f"/api/v1/vision/models/{model_id}/activate", headers=self.teacher, json={}
        )

    def archive(self, model_id, reason="", headers=None):
        return self.client.post(
            f"/api/v1/vision/models/{model_id}/archive",
            headers=self.teacher if headers is None else headers,
            json={"reason": reason},
        )

    def restore(self, model_id, reason="", headers=None):
        return self.client.post(
            f"/api/v1/vision/models/{model_id}/restore",
            headers=self.teacher if headers is None else headers,
            json={"reason": reason},
        )

    def delete_model(self, model_id, reason="", headers=None):
        return self.client.post(
            f"/api/v1/vision/models/{model_id}/delete",
            headers=self.teacher if headers is None else headers,
            json={"reason": reason},
        )

    def audit_events(self):
        path = self.root / "audit" / "model_management_audit.jsonl"
        if not path.exists():
            return []
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    # ==== M4：ACTIVE／驗證中一律拒絕（後端硬攔） ====
    def test_archive_rejects_active_model(self):
        _, model = self.model_from_submission()
        self.assertEqual(self.activate(model["model_id"]).json()["status"], "ACTIVE")

        response = self.archive(model["model_id"], reason="想歸檔 ACTIVE")
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["error"]["code"], "model_manage_failed")
        self.assertIn("model_active_cannot_manage", response.json()["error"]["message"])
        # 狀態未變更
        self.assertEqual(self.center.get_model(model["model_id"])["status"], "ACTIVE")
        self.assertEqual(self.audit_events(), [])

    def test_delete_rejects_active_model(self):
        _, model = self.model_from_submission()
        self.activate(model["model_id"])

        response = self.delete_model(model["model_id"])
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["error"]["code"], "model_delete_failed")
        self.assertIn("model_active_cannot_manage", response.json()["error"]["message"])
        self.assertEqual(self.center.get_model(model["model_id"])["status"], "ACTIVE")
        self.assertTrue(Path(model["file_path"]).exists())

    def test_archive_and_delete_reject_validating_model(self):
        """驗證進行中（status/validation_status=VALIDATING）不可操作。"""
        _, model = self.model_from_submission()
        stored = self.center._find("models", "model_id", model["model_id"])
        stored.update(status="VALIDATING", validation_status="VALIDATING")

        with self.assertRaises(ModelValidationError) as ctx:
            self.center.archive_model(model["model_id"], "teacher-1")
        self.assertIn("model_validation_in_progress", str(ctx.exception))

        with self.assertRaises(ModelValidationError) as ctx:
            self.center.delete_model(model["model_id"], "teacher-1")
        self.assertIn("model_validation_in_progress", str(ctx.exception))
        self.assertTrue(Path(model["file_path"]).exists())

    # ==== M4：權限 ====
    def test_management_requires_teacher_header(self):
        _, model = self.model_from_submission()
        for call in (self.archive, self.restore, self.delete_model):
            response = call(model["model_id"], headers={})
            self.assertEqual(response.status_code, 403, response.text)
            self.assertEqual(response.json()["error"]["code"], "internal_auth_rejected")
        # 被拒的請求不得留下任何改動
        self.assertEqual(self.center.get_model(model["model_id"])["status"], "VALIDATED")
        self.assertEqual(self.audit_events(), [])

    # ==== M1：歸檔 ====
    def test_archive_hides_model_but_keeps_pt_file(self):
        _, model = self.model_from_submission()
        file_path = Path(model["file_path"])
        self.assertTrue(file_path.exists())

        response = self.archive(model["model_id"], reason="辨識品質不足")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertFalse(body["already_archived"])
        self.assertEqual(body["status"], "ARCHIVED")
        self.assertEqual(body["archived_via"], "teacher")
        self.assertEqual(body["archived_reason"], "辨識品質不足")
        self.assertEqual(body["status_before_archive"], "VALIDATED")
        # .pt 不動
        self.assertTrue(file_path.exists())
        self.assertEqual(file_path.read_bytes(), b"pt-v1")
        # 歷史仍可見（不回滾成遺失）
        history = self.client.get(
            "/api/v1/vision/tasks/PROP_DIRECTION/history", headers=self.teacher
        ).json()
        self.assertIn(model["model_id"], {item["model_id"] for item in history["history"]})

    def test_archive_is_idempotent(self):
        _, model = self.model_from_submission()
        first = self.archive(model["model_id"], reason="第一次").json()
        archived_at = first["archived_at"]
        second = self.archive(model["model_id"], reason="第二次").json()
        self.assertTrue(second["already_archived"])
        self.assertEqual(second["archived_at"], archived_at)
        self.assertEqual(len(self.audit_events()), 1)
        # 只備份一次
        backups = [p for p in (self.root / "backups").iterdir() if "archive" in p.name]
        self.assertEqual(len(backups), 1)

    # ==== M2：還原 ====
    def test_restore_round_trip(self):
        _, model = self.model_from_submission()
        self.archive(model["model_id"], reason="先歸檔")
        response = self.restore(model["model_id"])
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "VALIDATED")
        self.assertEqual(self.center.get_model(model["model_id"])["status"], "VALIDATED")
        # 還原即撤銷「教師歸檔」標記：archived_via 清空，歸檔時間轉存 last_archived_at
        restored = self.center.get_model(model["model_id"])
        self.assertIsNone(restored.get("archived_via"))
        self.assertIsNone(restored.get("archived_at"))
        self.assertTrue(restored.get("last_archived_at"))
        self.assertEqual(restored.get("archived_reason"), "先歸檔")
        # 審計：歸檔＋還原各一筆
        events = [item["event"] for item in self.audit_events()]
        self.assertEqual(events, ["model_archived", "model_restored"])

    def test_restore_rejects_system_archived_model(self):
        """系統自動歸檔（版本頂替）不是教師手動歸檔，不可用「一鍵還原」。"""
        _, first = self.model_from_submission(version="v1")
        _, second = self.model_from_submission(content=b"pt-v2", version="v2")
        self.activate(first["model_id"])
        self.activate(second["model_id"])  # first 被系統歸檔
        self.assertEqual(self.center.get_model(first["model_id"])["status"], "ARCHIVED")

        response = self.restore(first["model_id"])
        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn("restore_not_teacher_archived", response.json()["error"]["message"])

    def test_rollback_does_not_resurrect_teacher_archived_model(self):
        """教師歸檔件不得成為回滾目標（避免不理想模型被一鍵回滾復活）。"""
        _, first = self.model_from_submission(version="v1")
        _, second = self.model_from_submission(content=b"pt-v2", version="v2")
        _, third = self.model_from_submission(content=b"pt-v3", version="v3")
        self.activate(first["model_id"])
        self.activate(second["model_id"])  # first 被系統歸檔
        # 教師歸檔 third（VALIDATED，但不可回滾）
        self.archive(third["model_id"], reason="不理想")

        target = self.center.previous_active_model("PROP_DIRECTION")
        self.assertIsNotNone(target)
        self.assertEqual(target["model_id"], first["model_id"])
        self.assertNotEqual(target["model_id"], third["model_id"])

    # ==== M3：永久刪除 ====
    def test_delete_keeps_shared_pt_and_reports_owner(self):
        """兩個模型共用同一 .pt（sha256）→ 只刪記錄，檔案保留並回報共用方。"""
        shared = b"same-pt-bytes"
        sub_a, model_a = self.model_from_submission(content=shared, version="v1")
        sub_b, model_b = self.model_from_submission(content=shared, version="v2")
        self.assertEqual(model_a["file_hash"], model_b["file_hash"])
        file_a = Path(model_a["file_path"])

        response = self.delete_model(model_a["model_id"], reason="重複")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body["record_removed"])
        self.assertFalse(body["file_removed"])
        self.assertIn(model_b["model_id"], body["shared_with"])
        self.assertIn(sub_a["submission_id"], body["shared_with"])
        # 檔案與另一個模型都必須完好
        self.assertTrue(file_a.exists())
        self.assertEqual(file_a.read_bytes(), shared)
        self.assertEqual(self.center.get_model(model_b["model_id"])["status"], "VALIDATED")
        # 被刪的記錄真的消失
        with self.assertRaises(KeyError):
            self.center._find("models", "model_id", model_a["model_id"])

    def test_delete_removes_file_when_not_shared(self):
        """教師直接上傳（無來源提交、無其他引用）→ 記錄與 .pt 一併刪除。"""
        dataset = self.center.create_dataset(
            {
                "model_type": "PROP_DIRECTION",
                "dataset_version": "v1",
                "total_images": 1,
                "train_count": 1,
                "val_count": 0,
                "test_count": 0,
                "class_distribution": {},
                "source_groups": ["f"],
                "created_by": "t",
            }
        )
        model = self.center.upload_model(
            model_type="PROP_DIRECTION",
            model_name="teacher-only",
            version="v1",
            content=b"teacher-only-bytes",
            dataset_id=dataset["dataset_id"],
            dataset_version="v1",
            rule_version="r1",
            uploaded_by="teacher-1",
        )
        folder = Path(model["file_path"]).parent
        self.assertTrue(folder.exists())

        response = self.delete_model(model["model_id"])
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body["file_removed"])
        self.assertEqual(body["shared_with"], [])
        self.assertFalse(folder.exists())
        # 備份仍留有原始檔案（可追溯）
        backup_dir = Path(body["backup_path"])
        self.assertTrue((backup_dir / "model_file").exists())

    def test_delete_removes_model_evaluations(self):
        _, model = self.model_from_submission()
        self.center.save_evaluation(
            model["model_id"],
            {
                "precision": 0.9,
                "recall": 0.9,
                "map50": 0.8,
                "map50_95": 0.5,
                "per_class_metrics": {},
                "confusion_matrix": [],
                "error_count": 0,
                "low_confidence_count": 0,
            },
            "teacher-1",
        )
        self.assertEqual(len(self.center.list_evaluations(model["model_id"])), 1)

        response = self.delete_model(model["model_id"])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["removed_evaluations"]), 1)
        self.assertEqual(self.center.list_evaluations(model["model_id"]), [])

    # ==== M5：學員重傳 ====
    def test_archive_supersedes_submission_and_student_can_resubmit(self):
        submission, model = self.model_from_submission(content=b"pt-old", version="v1")
        self.archive(model["model_id"], reason="不理想，請重傳")

        stored_submission = self.center.get_submission(submission["submission_id"])
        self.assertTrue(stored_submission["superseded"])
        self.assertEqual(stored_submission["superseded_op"], "archive")
        self.assertEqual(stored_submission["superseded_model_id"], model["model_id"])

        # 學員可再傳新模型（不同檔案）
        new_submission = self.submit(content=b"pt-new", filename="best-v2.pt", student="DEMO-STU-0001")
        self.assertEqual(new_submission["status"], "SUBMITTED")
        self.assertEqual(new_submission["duplicate_hint"], "")
        # 新提交可正常匯入（未被舊提交佔用名額）
        new_model = self.import_submission(new_submission["submission_id"], version="v2")
        self.assertEqual(new_model["status"], "VALIDATED")

    def test_resubmit_same_file_hints_same_as_archived_model(self):
        """重傳與已歸檔模型相同的檔案：只提示、不拒絕。"""
        submission, model = self.model_from_submission(content=b"pt-same", version="v1")
        self.archive(model["model_id"], reason="不理想")

        again = self.submit(content=b"pt-same", filename="best-again.pt")
        self.assertEqual(again["status"], "SUBMITTED")
        self.assertEqual(again["duplicate_hint"], "same_as_archived_model")
        self.assertIn(model["model_id"], again["matching_archived_model_ids"])

    def test_restore_clears_superseded_flag(self):
        submission, model = self.model_from_submission()
        self.archive(model["model_id"], reason="先歸檔")
        self.assertTrue(self.center.get_submission(submission["submission_id"])["superseded"])

        self.restore(model["model_id"])
        restored = self.center.get_submission(submission["submission_id"])
        self.assertFalse(restored["superseded"])
        self.assertIsNone(restored["superseded_model_id"])

    def test_resubmitted_untrained_model_still_rejected_by_d2(self):
        """重傳不放寬健康度檢查：未訓練模型匯入仍被 D2 拒絕。"""
        _, model = self.model_from_submission()
        self.archive(model["model_id"], reason="不理想")

        untrained_center = self.make_center(inspector=UntrainedHealthInspector())
        submission = untrained_center.create_submission(
            task_id="PROP_DIRECTION",
            student_id="DEMO-STU-0001",
            group_id="G1",
            original_filename="untrained.pt",
            content=b"untrained-bytes",
        )
        dataset = untrained_center.create_dataset(
            {
                "model_type": "PROP_DIRECTION",
                "dataset_version": "v1",
                "total_images": 1,
                "train_count": 1,
                "val_count": 0,
                "test_count": 0,
                "class_distribution": {},
                "source_groups": ["f"],
                "created_by": "t",
            }
        )
        with self.assertRaises(ModelValidationError) as ctx:
            untrained_center.import_submission(
                submission["submission_id"],
                model_name="untrained",
                version="v1",
                dataset_id=dataset["dataset_id"],
                dataset_version="v1",
                rule_version="r1",
                uploaded_by="teacher-1",
            )
        self.assertIn("model_untrained", str(ctx.exception))
        # 提交保持 SUBMITTED（不自動駁回），並留下失敗原因
        stored = untrained_center.get_submission(submission["submission_id"])
        self.assertEqual(stored["status"], "SUBMITTED")
        self.assertIn("model_untrained", str(stored.get("import_last_error_code")))

    # ==== M6／M7：審計與備份 ====
    def test_audit_and_backup_written_before_mutation(self):
        _, model = self.model_from_submission()
        response = self.archive(model["model_id"], reason="審計測試")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()

        # M7：備份存在且 SHA 可核對
        backup_dir = Path(body["backup_path"])
        snapshot = backup_dir / "vision_center.json"
        self.assertTrue(snapshot.exists())
        import hashlib

        digest = hashlib.sha256(snapshot.read_bytes()).hexdigest()
        self.assertEqual(digest, body["store_sha256"])
        # 備份內容是「改動前」：模型仍是 VALIDATED
        saved = json.loads(snapshot.read_text(encoding="utf-8"))
        saved_model = next(item for item in saved["models"] if item["model_id"] == model["model_id"])
        self.assertEqual(saved_model["status"], "VALIDATED")

        # M6：審計日誌在 store 之外，含操作者／時間／原因／備份與 SHA
        events = self.audit_events()
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["event"], "model_archived")
        self.assertEqual(event["model_id"], model["model_id"])
        self.assertEqual(event["operator"], "teacher-1")
        self.assertEqual(event["reason"], "審計測試")
        self.assertEqual(event["store_sha256"], body["store_sha256"])
        self.assertTrue(event["at"])

    def test_delete_unknown_model_returns_404(self):
        for call in (self.archive, self.restore, self.delete_model):
            response = call("PROP-00000000-0000-0000-0000-000000000000")
            self.assertEqual(response.status_code, 404, response.text)
            self.assertEqual(response.json()["error"]["code"], "model_not_found")


    # ==== 教師覆寫路徑已撤銷（2026-10-23 教師指令，取代 2026-10-22 覆寫版）====
    # 2026-10-22 曾裁定「override=true 由教師決定啟用」；2026-10-23 教師指令撤銷該路徑：
    #   ① 請求明確帶 override=true／"true" → 一律 422 teacher_override_disabled
    #     （在模型查詢與所有閘門之前拒絕，不留靜音放行後門）；
    #   ② 不帶 override → 啟用資格硬規則全部生效（health OK＋圖片驗證通過且
    #      最高信心 ≥ 0.6＋類別規範四類＋非 DEMO_IMPORTED＋非隔離＋.pt 可讀）；
    #   ③ 覆寫請求不改變模型狀態、不寫審計。

    def test_activate_without_override_still_rejects_low_quality(self):
        """向後相容：未帶 override 時，低品質模型仍被健康度閘門拒絕。"""
        self.center = self.make_center(inspector=LowQualityHealthInspector())
        self.client = TestClient(
            create_app(vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=True)
        )
        _, model = self.model_from_submission()

        response = self.activate(model["model_id"])          # 不帶 override
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["error"]["code"], "activation_failed")
        # 2026-10-23：健康度不合格統一原因碼 model_health_not_ok
        #（原 model_low_quality_not_eligible 已併入此碼）。
        self.assertIn("model_health_not_ok", response.json()["error"]["message"])
        # 明確帶 false 也一樣（不得因為送了 body 就放行）
        response = self.client.post(
            f"/api/v1/vision/models/{model['model_id']}/activate",
            headers=self.teacher,
            json={"override": False},
        )
        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn("model_health_not_ok", response.json()["error"]["message"])
        # 狀態未變更、未寫審計
        self.assertEqual(self.center.get_model(model["model_id"])["status"], "VALIDATED")
        self.assertEqual(self.audit_events(), [])

    def test_activate_override_is_rejected_and_low_quality_still_blocked(self):
        """2026-10-23：覆寫路徑已撤銷——override=true 一律拒絕；低品質仍不得啟用。"""
        self.center = self.make_center(inspector=LowQualityHealthInspector())
        self.client = TestClient(
            create_app(vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=True)
        )
        _, model = self.model_from_submission()

        response = self.client.post(
            f"/api/v1/vision/models/{model['model_id']}/activate",
            headers=self.teacher,
            json={"override": True},
        )
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["error"]["code"], "teacher_override_disabled")
        # 覆寫請求在閘門之前就被拒：狀態未變更、未寫審計
        self.assertEqual(self.center.get_model(model["model_id"])["status"], "VALIDATED")
        self.assertEqual(self.audit_events(), [])
        # 不帶 override 也一樣被健康度閘門拒絕（原 2026-10-22「可覆寫啟用」行為已撤銷）
        response = self.activate(model["model_id"])
        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn("model_health_not_ok", response.json()["error"]["message"])
        self.assertEqual(self.center.get_model(model["model_id"])["status"], "VALIDATED")

    def test_activate_override_does_not_bypass_quarantine(self):
        """硬攔①：已隔離模型不得啟用；override=true 亦已在閘門前被撤銷拒絕。"""
        _, model = self.model_from_submission()
        # get_model 回傳副本，必須直接改 store 內的紀錄
        for item in self.center.store.data["models"]:
            if item["model_id"] == model["model_id"]:
                item["quarantined"] = True
        self.center.store.save()

        # 不帶 override：隔離硬攔生效
        response = self.activate(model["model_id"])
        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn("model_quarantined", response.json()["error"]["message"])
        # override=true：覆寫路徑已撤銷，直接在閘門之前拒絕
        response = self.client.post(
            f"/api/v1/vision/models/{model['model_id']}/activate",
            headers=self.teacher,
            json={"override": True},
        )
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["error"]["code"], "teacher_override_disabled")
        self.assertEqual(self.center.get_model(model["model_id"])["status"], "VALIDATED")
        self.assertEqual(self.audit_events(), [])

    def test_activate_override_for_demo_imported_model(self):
        """DEMO 放寬匯入模型不得啟用（A 硬規則 d-④）；override=true 亦被撤銷。"""
        # DEMO_IMPORTED 需要「健康度被擋 + demo_relaxed」才會產生
        #（類別名吻合時走正常 VALIDATED，見 test_vision_center.py 的既有案例）。
        self.center = self.make_center(inspector=UntrainedHealthInspector())
        self.client = TestClient(
            create_app(vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=True)
        )
        dataset = self.create_dataset()
        model = self.center.upload_model(
            model_type="PROP_DIRECTION",
            model_name="demo-relaxed",
            version="v1",
            content=b"pt-demo",
            dataset_id=dataset["dataset_id"],
            dataset_version="v1",
            rule_version="r1",
            uploaded_by="teacher-1",
            demo_relaxed=True,
        )
        model_id = model["model_id"]
        self.assertEqual(
            self.center.get_model(model_id)["validation_status"], "DEMO_IMPORTED"
        )

        # 未覆寫：DEMO 放寬匯入不得啟用（A 硬規則）
        refused = self.activate(model_id)
        self.assertEqual(refused.status_code, 422, refused.text)
        self.assertIn(
            "model_demo_imported_not_allowed",
            refused.json()["error"]["message"],
        )

        # override=true：覆寫路徑已撤銷（2026-10-23），不再有「教師決定啟用」
        denied = self.client.post(
            f"/api/v1/vision/models/{model_id}/activate",
            headers=self.teacher,
            json={"override": True},
        )
        self.assertEqual(denied.status_code, 422, denied.text)
        self.assertEqual(denied.json()["error"]["code"], "teacher_override_disabled")
        self.assertEqual(self.center.get_model(model_id)["status"], "DEMO_IMPORTED")
        self.assertEqual(self.audit_events(), [])

    def test_activate_without_override_requires_no_body(self):
        """完全不送 body（舊客戶端行為）也必須照舊拒絕，不得因解析失敗而放行。"""
        self.center = self.make_center(inspector=LowQualityHealthInspector())
        self.client = TestClient(
            create_app(vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=True)
        )
        _, model = self.model_from_submission()
        response = self.client.post(
            f"/api/v1/vision/models/{model['model_id']}/activate",
            headers=self.teacher,
        )
        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn("model_health_not_ok", response.json()["error"]["message"])


if __name__ == "__main__":
    unittest.main()
