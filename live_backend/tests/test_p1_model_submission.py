import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.sessions import InMemorySessionStore
from app.vision import VisionResult
from app.rag import RAGResult


class FakeVision:
    async def health(self):
        return True

    async def detect(self, image_data, file_name, confidence):
        return VisionResult([], 1.0, {})


class FakeRAG:
    async def query(self, question, request_id, context_version):
        return RAGResult("online", "ctx", None, None, 1.0, True, None, request_id, context_version, "rag")


class FakeCenter:
    """P1-1 測試用占位；不觸發 Vision Center 磁碟行為。"""


class P1ModelSubmissionTests(unittest.TestCase):
    def setUp(self):
        self.store = InMemorySessionStore()
        self.client = TestClient(create_app(
            vision_adapter=FakeVision(), rag_adapter=FakeRAG(),
            session_store=self.store, dev_mode=True, vision_center=FakeCenter(),
        ))
        self.sid = self.client.post(
            "/api/live/sessions", json={"mode": "demo", "training_track": "F450_TWELVE_TASK"}
        ).json()["session_id"]
        self.teacher_headers = {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "MOCK_TEACHER"}

    def upload_pt(self, filename="best.pt", task_type="PROP_DETECTION", size=12345):
        return self.client.post(
            f"/api/live/sessions/{self.sid}/training/evidence",
            json={"evidence_type": "YOLO_MODEL", "source": "STUDENT_UPLOAD",
                  "file_reference": f"dev-upload://{filename}",
                  "metadata": {"model_filename": filename, "model_task_type": task_type, "size_bytes": size}},
        )

    # 1. PROP_DETECTION 可以提交 .pt
    def test_prop_detection_pt_upload_accepted(self):
        resp = self.upload_pt()
        self.assertEqual(resp.status_code, 201)
        ev = resp.json()["evidence"]
        self.assertEqual(ev["evidence_type"], "YOLO_MODEL")
        self.assertEqual(ev["metadata"]["model_status"], "UPLOADED")
        self.assertEqual(ev["metadata"]["expected_classes"], ["CW_F", "CCW_F", "CW_B", "CCW_B"])
        self.assertEqual(ev["metadata"]["model_filename"], "best.pt")

    # 2. 非 .pt 主模型被拒絕
    def test_non_pt_model_rejected(self):
        resp = self.upload_pt(filename="model.onnx")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"]["code"], "invalid_evidence")

    # 3. 上傳不會執行模型（只作 Artifact Storage）
    def test_upload_does_not_execute_model(self):
        ev = self.upload_pt().json()["evidence"]
        meta = ev["metadata"]
        self.assertEqual(meta["model_status"], "UPLOADED")
        self.assertNotIn("ACTIVE", meta["model_status"])
        self.assertNotIn("PRODUCTION", meta["model_status"])
        self.assertTrue(ev["file_reference"].endswith("best.pt"))

    # 4. Teacher 可以看見 submission
    def test_teacher_can_view_submission(self):
        self.upload_pt()
        resp = self.client.get(
            f"/api/live/sessions/{self.sid}/training/model-submissions", headers=self.teacher_headers
        )
        self.assertEqual(resp.status_code, 200)
        items = resp.json()["model_submissions"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["metadata"]["model_filename"], "best.pt")
        self.assertEqual(items[0]["metadata"]["model_status"], "UPLOADED")

    # 學生不得查看教師收件匣
    def test_student_cannot_view_inbox(self):
        resp = self.client.get(f"/api/live/sessions/{self.sid}/training/model-submissions")
        self.assertEqual(resp.status_code, 403)

    # 5. Teacher 可以 APPROVED_FOR_BENCHMARK
    def test_teacher_approve_for_benchmark(self):
        ev_id = self.upload_pt().json()["evidence"]["evidence_id"]
        resp = self.client.post(
            f"/api/live/sessions/{self.sid}/training/model-submissions/{ev_id}/review",
            headers=self.teacher_headers,
            json={"decision": "APPROVED_FOR_BENCHMARK", "note": "可進入 Benchmark"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["review"]["metadata"]["model_status"], "APPROVED_FOR_BENCHMARK")

    # 6. Teacher 可以 REJECTED
    def test_teacher_reject(self):
        ev_id = self.upload_pt(filename="best2.pt").json()["evidence"]["evidence_id"]
        resp = self.client.post(
            f"/api/live/sessions/{self.sid}/training/model-submissions/{ev_id}/review",
            headers=self.teacher_headers, json={"decision": "REJECTED", "note": "檔名不符"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["review"]["metadata"]["model_status"], "REJECTED")

    # 7. teacher_note 保存
    def test_teacher_note_saved(self):
        ev_id = self.upload_pt().json()["evidence"]["evidence_id"]
        resp = self.client.post(
            f"/api/live/sessions/{self.sid}/training/model-submissions/{ev_id}/review",
            headers=self.teacher_headers, json={"decision": "REJECTED", "note": "請修正檔名後重傳"},
        )
        body = resp.json()["review"]
        self.assertEqual(body["metadata"]["teacher_note"], "請修正檔名後重傳")
        self.assertEqual(body["teacher_review"]["note"], "請修正檔名後重傳")

    # 8. 審核不觸發 A06 / Production / Deploy
    def test_no_a06_or_production_on_review(self):
        ev_id = self.upload_pt().json()["evidence"]["evidence_id"]
        resp = self.client.post(
            f"/api/live/sessions/{self.sid}/training/model-submissions/{ev_id}/review",
            headers=self.teacher_headers, json={"decision": "APPROVED_FOR_BENCHMARK", "note": ""},
        )
        meta = resp.json()["review"]["metadata"]
        self.assertEqual(meta["model_status"], "APPROVED_FOR_BENCHMARK")
        self.assertNotIn("ACTIVE", meta["model_status"])
        self.assertNotIn("DEPLOYED", meta["model_status"])

    # 非法審核決策被拒絕
    def test_invalid_review_decision_rejected(self):
        ev_id = self.upload_pt().json()["evidence"]["evidence_id"]
        resp = self.client.post(
            f"/api/live/sessions/{self.sid}/training/model-submissions/{ev_id}/review",
            headers=self.teacher_headers, json={"decision": "ACTIVATE", "note": ""},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"]["code"], "invalid_model_review")

    # 選用 student_note 會被保存
    def test_student_note_persisted_on_upload(self):
        resp = self.client.post(
            f"/api/live/sessions/{self.sid}/training/evidence",
            json={"evidence_type": "YOLO_MODEL", "source": "STUDENT_UPLOAD",
                  "file_reference": "dev-upload://best.pt",
                  "metadata": {"model_filename": "best.pt", "model_task_type": "PROP_DETECTION",
                               "size_bytes": 999, "student_note": "基於課堂數據訓練"}},
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()["evidence"]["metadata"]["student_note"], "基於課堂數據訓練")


if __name__ == "__main__":
    unittest.main()
