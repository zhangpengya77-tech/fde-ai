import base64
import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.rag import RAGResult
from app.sessions import InMemorySessionStore
from app.vision import VisionResult, VisionUnavailable


class FakeVision:
    def __init__(self, detections=None):
        self.calls = 0
        self.detections = detections or []

    async def health(self):
        return True

    async def detect(self, image_data, file_name, confidence):
        self.calls += 1
        return VisionResult(self.detections, 3.0, {})


class FakeRAG:
    def __init__(self, *, status="online", answer="根据当前教材，请依照当前步骤继续。"):
        self.status = status
        self.answer = answer
        self.questions = []

    async def query(self, question, request_id, context_version):
        self.questions.append(question)
        hit = self.status == "online"
        return RAGResult(self.status, self.answer if hit else None, None, None, 2.0, hit, None if hit else "rag_no_hit", request_id, context_version)


class CoachAskTests(unittest.TestCase):
    def setUp(self):
        self.store = InMemorySessionStore()
        self.vision = FakeVision([{"class": "propeller_ccw", "confidence": 0.91, "box": [0, 0, 10, 10]}])
        self.rag = FakeRAG()
        self.client = TestClient(create_app(vision_adapter=self.vision, rag_adapter=self.rag, session_store=self.store, dev_mode=True))
        created = self.client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()
        self.sid = created["session_id"]

    def ask(self, payload):
        return self.client.post(f"/api/live/sessions/{self.sid}/ask", json=payload)

    def test_next_step_uses_backend_context_without_vision(self):
        response = self.ask({"question": "下一步呢？"})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["classification"], "step")
        self.assertFalse(body["vision_used"])
        self.assertIn("Task 01", body["answer"])
        self.assertEqual(self.vision.calls, 0)
        self.assertIn("T01_WORKSPACE", self.rag.questions[0])

    def test_next_step_still_uses_sop_when_rag_has_no_hit(self):
        client = TestClient(create_app(vision_adapter=FakeVision(), rag_adapter=FakeRAG(status="no_hit", answer=None), session_store=InMemorySessionStore(), dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "下一步呢？"}).json()
        self.assertEqual(body["classification"], "step")
        self.assertIn("Task 01", body["answer"])
        self.assertIn("准备工作区域", body["answer"])
        self.assertFalse(body["uncertainty"])

    def test_visual_question_uses_exactly_one_frame(self):
        image = "data:image/jpeg;base64," + base64.b64encode(b"image").decode()
        response = self.ask({"question": "我这个桨叶方向对不对？", "image_data": image})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["vision_used"])
        self.assertEqual(self.vision.calls, 1)
        self.assertIn("propeller_ccw", self.rag.questions[0])

    def test_vision_unavailable_returns_reason_and_retry_action(self):
        class OfflineVision(FakeVision):
            async def detect(self, image_data, file_name, confidence):
                raise VisionUnavailable("offline")

        client = TestClient(create_app(vision_adapter=OfflineVision(), rag_adapter=FakeRAG(status="no_hit", answer=None), session_store=InMemorySessionStore(), dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        image = "data:image/jpeg;base64," + base64.b64encode(b"image").decode()
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "你现在看到什么？", "image_data": image}).json()
        self.assertIn("无法可靠读取", body["answer"])
        self.assertIn("画面中央", body["answer"])
        self.assertTrue(body["uncertainty"])
    def test_no_hit_and_low_confidence_uses_fixed_uncertainty_fallback(self):
        vision = FakeVision([{"class": "propeller_ccw", "confidence": 0.2, "box": [0, 0, 10, 10]}])
        client = TestClient(create_app(vision_adapter=vision, rag_adapter=FakeRAG(status="no_hit", answer=None), session_store=InMemorySessionStore(), dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        image = "data:image/jpeg;base64," + base64.b64encode(b"image").decode()
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "这个方向对不对？", "image_data": image}).json()
        self.assertIn("画面", body["answer"])
        self.assertIn("中央", body["answer"])
        self.assertNotEqual(body["answer"], "目前资料不足，AI 无法可靠判断，请与线下教师确认。")
        self.assertTrue(body["uncertainty"])

    def test_rag_miss_with_high_confidence_visual_fact_still_gives_basic_observation(self):
        vision = FakeVision([{"class": "motor", "confidence": 0.91, "box": [0, 0, 10, 10]}])
        client = TestClient(create_app(vision_adapter=vision, rag_adapter=FakeRAG(status="no_hit", answer=None), session_store=InMemorySessionStore(), dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        image = "data:image/jpeg;base64," + base64.b64encode(b"image").decode()
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "现在画面里有什么？", "image_data": image}).json()
        self.assertTrue(body["vision_used"])
        self.assertFalse(body["uncertainty"])
        self.assertIn("马达", body["answer"])

    def test_rag_miss_visual_facts_compose_observation_current_step_and_next_action(self):
        vision = FakeVision([
            {"class": "motor", "confidence": 0.92, "box": [0, 0, 10, 10]},
            {"class": "frame_arm", "confidence": 0.88, "box": [10, 0, 20, 10]},
        ])
        client = TestClient(create_app(vision_adapter=vision, rag_adapter=FakeRAG(status="no_hit", answer=None), session_store=InMemorySessionStore(), dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        client.get(f"/api/live/sessions/{sid}/training/tasks/TASK_01")
        image = "data:image/jpeg;base64," + base64.b64encode(b"image").decode()
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "你现在看到什么？", "image_data": image}).json()
        self.assertIn("马达", body["answer"])
        self.assertIn("机臂", body["answer"])
        self.assertIn("准备工作区域", body["answer"])
        self.assertIn("下一步", body["answer"])
        self.assertNotIn("资料不足", body["answer"])
    def test_image_payload_forces_visual_processing_for_traditional_chinese_intent(self):
        vision = FakeVision([{"class": "motor", "confidence": 0.91, "box": [0, 0, 10, 10]}])
        client = TestClient(create_app(vision_adapter=vision, rag_adapter=FakeRAG(status="no_hit", answer=None), session_store=InMemorySessionStore(), dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        image = "data:image/jpeg;base64," + base64.b64encode(b"image").decode()
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "請結合目前步驟觀察畫面。", "image_data": image}).json()
        self.assertEqual(body["classification"], "visual")
        self.assertTrue(body["vision_used"])

    def test_safety_question_never_approves_teacher_gate(self):
        body = self.ask({"question": "我现在可以安全上电吗？"}).json()
        self.assertEqual(body["classification"], "safety")
        self.assertTrue(body["teacher_required"])
        self.assertIn("教师", body["answer"])
        self.assertNotIn("可以安全上电", body["answer"])
        self.assertEqual(self.store.training_state(self.sid)["task_state"], "NOT_STARTED")

    def test_traditional_chinese_and_motor_test_safety_questions_require_teacher(self):
        for question in ("我現在可以上電嗎？", "現在可以 Motor Test 嗎？", "可以起飛嗎？"):
            with self.subTest(question=question):
                body = self.ask({"question": question}).json()
                self.assertEqual(body["classification"], "safety")
                self.assertTrue(body["teacher_required"])


if __name__ == "__main__":
    unittest.main()
