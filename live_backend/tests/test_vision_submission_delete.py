"""學員上傳刪除功能的契約測試（2026-10-20 教師指令：教師後台增加刪除功能）。

教師指令：「現在清除當下後台學員上傳pt，教師後台增加刪除功能」。

本檔以隔離臨時目錄與真實 HTTP 端點（DELETE /api/v1/vision/submissions/{id}）
證明刪除閘門的契約：

1. 刪除成功：store 記錄與 .pt 實體檔一併移除，刪除前自動備份（store JSON＋
   該提交目錄），其他提交不受影響。
2. 有模型依賴時拒絕：已匯入為模型的提交不可刪除（422，錯誤訊息列出依賴的
   model_id），記錄與檔案均保持原狀——刪除永遠不會切斷模型來源鏈或 ACTIVE 指標。
3. 未知提交 → 404（可追溯，不假成功）。
4. 未帶教師標頭 → 403 teacher_required（不是任何身分都能刪）。
5. 備份內容可用：備份中的 store 含被刪除的記錄、備份目錄含原 .pt 位元組。

全部使用隔離臨時目錄，不觸碰 DEMO／正式資料。
"""

import base64
import json
import tempfile
import unittest
from pathlib import Path

from starlette.testclient import TestClient

from app.main import create_app
from app.vision_center import PROP_CLASSES, VisionCenter


class FixtureValidator:
    """回報固定 4 類 detect 模型，讓匯入不需要真實 ultralytics。"""

    def validate(self, _path, _model_type):
        return {"class_names": list(PROP_CLASSES), "task": "detect", "smoke_inference": True}


class OfflineVision:
    async def health(self):
        return False


class DeleteSubmissionContractTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".test-temp"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.center = VisionCenter(self.temp.name, model_validator=FixtureValidator())
        self.client = TestClient(
            create_app(vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=True)
        )
        self.teacher = {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "teacher-1"}

    def tearDown(self):
        self.temp.cleanup()

    # ---- helpers ----
    def create_dataset(self):
        response = self.client.post(
            "/api/v1/vision/datasets",
            headers=self.teacher,
            json={"model_type": "PROP_DIRECTION", "dataset_version": "v1", "created_by": "t"},
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def upload(self, filename="best.pt", student="DEMO-STU-0001", content=b"fixture-pt-bytes"):
        response = self.client.post(
            "/api/v1/vision/submissions",
            headers=self.teacher,
            json={
                "task_id": "PROP_DIRECTION",
                "student_id": student,
                "original_filename": filename,
                "file_base64": base64.b64encode(content).decode(),
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def import_submission(self, submission_id):
        dataset = self.create_dataset()
        response = self.client.post(
            f"/api/v1/vision/submissions/{submission_id}/import",
            headers=self.teacher,
            json={
                "model_name": "delete-fixture",
                "version": "v1",
                "dataset_id": dataset["dataset_id"],
                "dataset_version": "v1",
                "rule_version": "r1",
            },
        )
        self.assertEqual(response.status_code in (200, 201), True, response.text)
        return response.json()

    def delete(self, submission_id, headers=None):
        return self.client.delete(
            f"/api/v1/vision/submissions/{submission_id}",
            headers=self.teacher if headers is None else headers,
        )

    # ---- 1. 刪除成功：記錄＋檔案移除，自動備份，其他記錄不受影響 ----
    def test_delete_removes_record_and_file_with_backup(self):
        target = self.upload(filename="to-delete.pt", student="DEMO-STU-0001")
        keep = self.upload(filename="to-keep.pt", student="DEMO-STU-0002")
        file_path = Path(target["file_path"])
        self.assertTrue(file_path.exists())

        response = self.delete(target["submission_id"])
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body["record_removed"])
        self.assertTrue(body["file_removed"])
        self.assertEqual(body["submission_id"], target["submission_id"])
        self.assertEqual(body["deleted_by"], "teacher-1")

        # store：目標消失、其他提交原樣保留
        remaining = {item["submission_id"] for item in self.center.store.data["submissions"]}
        self.assertNotIn(target["submission_id"], remaining)
        self.assertIn(keep["submission_id"], remaining)
        # 磁盤：.pt 目錄已移除
        self.assertFalse(file_path.exists())
        # 備份：store JSON 與原 .pt 位元組都在
        backup_dir = Path(body["backup_path"])
        self.assertTrue((backup_dir / "vision_center.json").exists())
        backup_store = json.loads((backup_dir / "vision_center.json").read_text(encoding="utf-8"))
        self.assertIn(target["submission_id"], {s["submission_id"] for s in backup_store["submissions"]})
        self.assertTrue((backup_dir / "submission_file" / "submission.pt").exists())
        self.assertEqual(
            (backup_dir / "submission_file" / "submission.pt").read_bytes(), b"fixture-pt-bytes"
        )

    # ---- 2. 有模型依賴 → 拒絕（記錄與檔案均不動） ----
    def test_delete_refuses_when_model_depends_on_submission(self):
        submission = self.upload(filename="imported.pt")
        model = self.import_submission(submission["submission_id"])
        model_id = model["model_id"]
        before = [dict(item) for item in self.center.store.data["submissions"]]

        response = self.delete(submission["submission_id"])
        self.assertEqual(response.status_code, 422, response.text)
        body = response.json()
        self.assertEqual(body["error"]["code"], "submission_delete_failed")
        self.assertIn(model_id, body["error"]["message"])

        # 拒絕後 store 與磁盤都必須原樣
        after = [dict(item) for item in self.center.store.data["submissions"]]
        self.assertEqual(before, after)
        self.assertTrue(Path(submission["file_path"]).exists())
        # 被拒絕的刪除也不得留下任何备份副作用之外的模型改動
        self.assertIsNotNone(self.center.get_model(model_id))

    # ---- 3. 未知提交 → 404 ----
    def test_delete_unknown_submission_returns_404(self):
        response = self.delete("sub-does-not-exist")
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(response.json()["error"]["code"], "submission_not_found")

    # ---- 4. 未帶教師標頭 → 403 ----
    def test_delete_requires_teacher_header(self):
        submission = self.upload()
        response = self.delete(submission["submission_id"], headers={})
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()["error"]["code"], "teacher_required")
        # 被拒的請求不得留下任何改動
        self.assertTrue(Path(submission["file_path"]).exists())
        remaining = {item["submission_id"] for item in self.center.store.data["submissions"]}
        self.assertIn(submission["submission_id"], remaining)

    # ---- 5. 單位級：備份可在刪除後還原 ----
    def test_backup_snapshot_allows_restore(self):
        submission = self.upload(filename="restorable.pt")
        result = self.center.delete_submission(submission["submission_id"], deleted_by="teacher-1")
        backup_dir = Path(result["backup_path"])
        snapshot = json.loads((backup_dir / "vision_center.json").read_text(encoding="utf-8"))
        ids = {item["submission_id"] for item in snapshot["submissions"]}
        self.assertIn(submission["submission_id"], ids)
        restored_bytes = (backup_dir / "submission_file" / "submission.pt").read_bytes()
        self.assertEqual(restored_bytes, b"fixture-pt-bytes")


if __name__ == "__main__":
    unittest.main()
