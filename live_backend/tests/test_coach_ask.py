import base64
import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.rag import RAGResult
from app.sessions import InMemorySessionStore
from app.vision import VisionResult, VisionUnavailable
from app.providers.provider_base import GeneralAIResult


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
    def __init__(self, *, status="online", answer="根据当前教材，请依照当前步骤继续。", source_type="rag"):
        self.status = status
        self.answer = answer
        self.source_type = source_type
        self.questions = []

    async def query(self, question, request_id, context_version):
        self.questions.append(question)
        hit = self.status == "online"
        return RAGResult(self.status, self.answer if hit else None, None, None, 2.0, hit, None if hit else "rag_no_hit", request_id, context_version, self.source_type if hit else None)


class FakeGeneralAI:
    enabled = True

    def __init__(self, answer="這是 OpenAI 提供的繁體中文參考回答。", error=None):
        self.answer = answer
        self.error = error
        self.calls = []

    async def generate(self, **values):
        self.calls.append(values)
        return GeneralAIResult(
            answer=None if self.error else self.answer,
            provider="openai", model="gpt-5.6-luna", latency_ms=12.5,
            tokens={"input_tokens": 20, "output_tokens": 12, "total_tokens": 32},
            confidence=None, source="AI_REFERENCE", error=self.error,
        )

    async def generate_visual(self, **values):
        self.calls.append(values)
        return GeneralAIResult(
            answer=None if self.error else self.answer,
            provider="openai", model="gpt-5.6-luna", latency_ms=18.0,
            tokens={"input_tokens": 24, "output_tokens": 10, "total_tokens": 34},
            confidence=None, source="AI_VISUAL_REFERENCE", error=self.error,
        )


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
        self.assertIn("Task 01", body["answer"])
        self.assertIn("下一步", body["answer"])
        self.assertFalse(body["uncertainty"])
        self.assertEqual(body["answer_source"], "SESSION_SOP")

    def test_verified_rag_answer_is_labelled_verified_knowledge(self):
        body = self.ask({"question": "为什么要认识飞控箭头？"}).json()
        self.assertEqual(body["answer_source"], "VERIFIED_KNOWLEDGE")
        self.assertFalse(body["needs_teacher"])

    def test_common_knowledge_answer_is_ai_reference_and_queued_for_review(self):
        store = InMemorySessionStore()
        rag = FakeRAG(answer="Common knowledge answer", source_type="common_knowledge")
        client = TestClient(create_app(vision_adapter=FakeVision(), rag_adapter=rag, session_store=store, dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "ESC 是做什麼的？"}).json()
        self.assertEqual(body["answer_source"], "AI_REFERENCE")
        self.assertTrue(body["answer"].strip())
        self.assertEqual(store.training_state(sid)["task_state"], "NOT_STARTED")
    def test_common_knowledge_safety_answer_cannot_approve_and_requires_teacher(self):
        rag = FakeRAG(answer="Check polarity first.", source_type="common_knowledge")
        client = TestClient(create_app(vision_adapter=FakeVision(), rag_adapter=rag, session_store=InMemorySessionStore(), dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "我現在可以上電嗎？"}).json()
        self.assertTrue(body["needs_teacher"])
        self.assertTrue(body["teacher_required"])
        self.assertIn("教師", body["answer"])
    def test_common_knowledge_visual_enrichment_is_queued_without_completing_step(self):
        store = InMemorySessionStore()
        vision = FakeVision([{"class": "motor", "confidence": 0.91, "box": [0, 0, 10, 10]}])
        client = TestClient(create_app(vision_adapter=vision, rag_adapter=FakeRAG(), session_store=store, dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        image = "data:image/jpeg;base64," + base64.b64encode(b"image").decode()
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "這是什麼？", "image_data": image}).json()
        self.assertEqual(body["answer_source"], "VISION_SOP")
        self.assertTrue(body["vision_used"])
        self.assertEqual(store.training_state(sid)["task_state"], "NOT_STARTED")
    def test_unreliable_model_fallback_explains_next_action_without_rag_jargon(self):
        client = TestClient(create_app(vision_adapter=FakeVision(), rag_adapter=FakeRAG(status="no_hit", answer=None), session_store=InMemorySessionStore(), dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "Unknown connector protocol?"}).json()
        self.assertNotIn("RAG", body["answer"])
        self.assertNotIn("Provider", body["answer"])
        self.assertTrue(body["answer"].strip())
    def test_visual_question_uses_exactly_one_frame(self):
        image = "data:image/jpeg;base64," + base64.b64encode(b"image").decode()
        response = self.ask({"question": "我这个桨叶方向对不对？", "image_data": image})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["vision_used"])
        self.assertTrue(response.json()["needs_teacher"], "propeller direction is safety-critical even when Vision is used")
        self.assertIn("教師現場確認", response.json()["answer"])
        self.assertEqual(self.vision.calls, 1)
        self.assertIn("propeller_ccw", self.rag.questions[0])

    def test_vision_unavailable_returns_reason_and_retry_action(self):
        class OfflineVision(FakeVision):
            async def detect(self, image_data, file_name, confidence):
                raise VisionUnavailable("offline")
        client = TestClient(create_app(vision_adapter=OfflineVision(), rag_adapter=FakeRAG(status="no_hit", answer=None), session_store=InMemorySessionStore(), dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        image = "data:image/jpeg;base64," + base64.b64encode(b"image").decode()
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "What do you see?", "image_data": image}).json()
        self.assertTrue(body["vision_used"])
        self.assertTrue(body["answer"].strip())
        self.assertNotIn("Provider", body["answer"])
    def test_no_hit_and_low_confidence_uses_fixed_uncertainty_fallback(self):
        vision = FakeVision([{"class": "propeller_ccw", "confidence": 0.2, "box": [0, 0, 10, 10]}])
        client = TestClient(create_app(vision_adapter=vision, rag_adapter=FakeRAG(status="no_hit", answer=None), session_store=InMemorySessionStore(), dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        image = "data:image/jpeg;base64," + base64.b64encode(b"image").decode()
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "這個方向對不對？", "image_data": image}).json()
        self.assertTrue(body["vision_used"])
        self.assertFalse(body["needs_teacher"])
        self.assertTrue(body["answer"].strip())
    def test_rag_miss_with_high_confidence_visual_fact_still_gives_basic_observation(self):
        vision = FakeVision([{"class": "motor", "confidence": 0.91, "box": [0, 0, 10, 10]}])
        client = TestClient(create_app(vision_adapter=vision, rag_adapter=FakeRAG(status="no_hit", answer=None), session_store=InMemorySessionStore(), dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        image = "data:image/jpeg;base64," + base64.b64encode(b"image").decode()
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "现在画面里有什么？", "image_data": image}).json()
        self.assertTrue(body["vision_used"])
        self.assertFalse(body["uncertainty"])
        self.assertIn("馬達", body["answer"])

    def test_rag_miss_visual_facts_compose_observation_current_step_and_next_action(self):
        vision = FakeVision([{"class": "motor", "confidence": 0.92, "box": [0, 0, 10, 10]}, {"class": "frame_arm", "confidence": 0.88, "box": [10, 0, 20, 10]}])
        client = TestClient(create_app(vision_adapter=vision, rag_adapter=FakeRAG(status="no_hit", answer=None), session_store=InMemorySessionStore(), dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        image = "data:image/jpeg;base64," + base64.b64encode(b"image").decode()
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "What is visible?", "image_data": image}).json()
        self.assertTrue(body["vision_used"])
        self.assertTrue(body["answer"].strip())
        self.assertNotIn("RAG", body["answer"])
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
        self.assertIn("教師", body["answer"])
        self.assertNotIn("可以安全上电", body["answer"])
        self.assertEqual(self.store.training_state(self.sid)["task_state"], "NOT_STARTED")

    def test_traditional_chinese_and_motor_test_safety_questions_require_teacher(self):
        for question in ("我現在可以上電嗎？", "現在可以 Motor Test 嗎？", "可以起飛嗎？", "ESC Calibration 怎么做？", "电机方向正确吗？", "PreArm 通过了吗？"):
            with self.subTest(question=question):
                body = self.ask({"question": question}).json()
                self.assertEqual(body["classification"], "safety")
                self.assertTrue(body["teacher_required"])

    def test_rag_miss_uses_general_text_provider_and_captures_candidate(self):
        store = InMemorySessionStore()
        provider = FakeGeneralAI()
        client = TestClient(create_app(
            vision_adapter=FakeVision(), rag_adapter=FakeRAG(status="no_hit", answer=None),
            general_ai_provider=provider, session_store=store, dev_mode=True,
        ))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "為什麼 GPS 在室內比較難定位？"}).json()
        self.assertEqual(body["answer_source"], "AI_REFERENCE")
        self.assertIn("OpenAI", body["answer"])
        self.assertIn("下一步", body["answer"])
        self.assertFalse(body["needs_teacher"])
        self.assertEqual(len(provider.calls), 1)
        candidate = store.knowledge_candidates(sid)[0]
        self.assertEqual(candidate["provider"], "openai")
        self.assertEqual(candidate["model"], "gpt-5.6-luna")
        self.assertEqual(candidate["language"], "zh-TW")
        self.assertEqual(candidate["session_id"], sid)
        self.assertEqual(candidate["answer"], provider.answer)
        self.assertEqual(candidate["task"], "TASK_01")
        self.assertEqual(candidate["step"], "T01_WORKSPACE")
        self.assertEqual(candidate["review_status"], "PENDING_REVIEW")
        client.post(f"/api/live/sessions/{sid}/ask", json={"question": "再說一次。"})
        context = provider.calls[1]["session"]
        self.assertEqual(context["student_id"], f"dev-student:{sid}")
        self.assertEqual(context["evidence_count"], 0)
        self.assertEqual(context["teacher_review_state"], "NOT_REQUIRED")
        self.assertEqual(context["conversation_history"][-1]["question"], "為什麼 GPS 在室內比較難定位？")

    def test_general_text_safety_answer_still_requires_teacher(self):
        provider = FakeGeneralAI("先確認電源正負極與接線狀態。")
        client = TestClient(create_app(
            vision_adapter=FakeVision(), rag_adapter=FakeRAG(status="no_hit", answer=None),
            general_ai_provider=provider, session_store=InMemorySessionStore(), dev_mode=True,
        ))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "我現在可以上電嗎？"}).json()
        self.assertTrue(body["needs_teacher"])
        self.assertIn("這一步涉及安全，需要教師現場確認", body["answer"])
        self.assertNotIn("可以安全上電", body["answer"])

    def test_general_provider_failure_uses_graceful_traditional_chinese_fallback(self):
        provider = FakeGeneralAI(error="provider_timeout")
        client = TestClient(create_app(vision_adapter=FakeVision(), rag_adapter=FakeRAG(status="no_hit", answer=None), general_ai_provider=provider, session_store=InMemorySessionStore(), dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "AUX 是什麼？"}).json()
        self.assertEqual(body["answer_source"], "SESSION_SOP")
        self.assertNotIn("Provider", body["answer"])
        self.assertTrue(body["answer"].strip())
    def test_low_confidence_yolo_uses_one_frame_general_visual_fallback(self):
        store = InMemorySessionStore()
        provider = FakeGeneralAI("目前看起來是一架小型四旋翼無人機。")
        vision = FakeVision([])
        client = TestClient(create_app(
            vision_adapter=vision, rag_adapter=FakeRAG(status="no_hit", answer=None),
            general_ai_provider=provider, session_store=store, dev_mode=True,
        ))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        image = "data:image/jpeg;base64," + base64.b64encode(b"image").decode()
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "你現在看到什麼？", "image_data": image}).json()
        self.assertEqual(body["answer_source"], "AI_VISUAL_REFERENCE")
        self.assertIn("小型四旋翼無人機", body["answer"])
        self.assertIn("下一步", body["answer"])
        self.assertEqual(vision.calls, 1)
        candidate = store.knowledge_candidates(sid)[0]
        self.assertTrue(candidate["vision_used"])
        self.assertEqual(candidate["answer_source"], "AI_VISUAL_REFERENCE")
        self.assertEqual(candidate["tokens"]["total_tokens"], 34)



    def test_general_ai_is_the_default_answer_even_when_rag_has_a_hit(self):
        provider = FakeGeneralAI("先把零件集中放在桌面上。完成後再告訴我。")
        client = TestClient(create_app(
            vision_adapter=FakeVision(), rag_adapter=FakeRAG(answer="舊知識庫回答"),
            general_ai_provider=provider, session_store=InMemorySessionStore(), dev_mode=True,
        ))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "為什麼要這樣做？"}).json()
        self.assertEqual(body["answer_source"], "AI_REFERENCE")
        self.assertIn("把零件集中", body["answer"])
        self.assertEqual(len(provider.calls), 1)

    def test_image_question_uses_general_visual_answer_even_with_high_confidence_yolo(self):
        provider = FakeGeneralAI("這是一個教學用的零件。請把它靠近鏡頭，我再說明用途。")
        vision = FakeVision([{"class": "motor", "confidence": 0.96, "box": [0, 0, 10, 10]}])
        client = TestClient(create_app(
            vision_adapter=vision, rag_adapter=FakeRAG(), general_ai_provider=provider,
            session_store=InMemorySessionStore(), dev_mode=True,
        ))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        image = "data:image/jpeg;base64," + base64.b64encode(b"image").decode()
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "這是什麼？", "image_data": image}).json()
        self.assertTrue(body["vision_used"])
        self.assertEqual(body["answer_source"], "AI_VISUAL_REFERENCE")
        self.assertIn("教學用的零件", body["answer"])
        self.assertEqual(len(provider.calls), 1)

    def test_general_provider_failure_never_exposes_provider_error_to_student(self):
        provider = FakeGeneralAI(error="provider_timeout")
        client = TestClient(create_app(
            vision_adapter=FakeVision(), rag_adapter=FakeRAG(status="no_hit", answer=None),
            general_ai_provider=provider, session_store=InMemorySessionStore(), dev_mode=True,
        ))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "AUX 是什麼？"}).json()
        self.assertNotIn("AI 暫時無法", body["answer"])
        self.assertNotIn("Provider", body["answer"])
        self.assertTrue(body["answer"].strip())

if __name__ == "__main__":
    unittest.main()
