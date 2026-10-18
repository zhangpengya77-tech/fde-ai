import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.rag import RAGResult
from app.sessions import InMemorySessionStore
from app.teacher_style import TeacherPersonaConfig, TeacherStyleLayer
from app.vision import VisionResult


class FakeVision:
    async def health(self):
        return True

    async def detect(self, image_data, file_name, confidence):
        return VisionResult([], 1.0, {})


class FakeRAG:
    async def query(self, question, request_id, context_version):
        return RAGResult("online", "加速度計校準用來建立姿態基準，操作時需要保持機體穩定。", None, None, 1.0, True, None, request_id, context_version, "rag")


class TeacherCloneTests(unittest.TestCase):
    def test_teacher_style_is_action_first_short_traditional_and_has_next_step(self):
        layer = TeacherStyleLayer()
        answer = layer.apply(
            "加速度計校準用來建立姿態基準，操作時需要保持機體穩定。",
            next_action="把飛機平放在桌面上",
        )
        self.assertTrue(answer.startswith("先把飛機平放在桌面上。"))
        self.assertIn("下一步", answer)
        self.assertNotIn("校准", answer)
        self.assertTrue(all(len(line) <= 36 for line in answer.splitlines() if line))

    def test_persona_defaults_match_teacher_clone_contract(self):
        persona = TeacherPersonaConfig()
        self.assertEqual(persona.preferred_language, "zh-TW")
        self.assertEqual(persona.sentence_length, "short")
        self.assertEqual(persona.explanation_style, "step-by-step")
        self.assertEqual(persona.encouragement, "light")
        self.assertEqual(persona.humor, "off")

    def test_session_keeps_only_latest_twenty_conversation_turns(self):
        store = InMemorySessionStore()
        sid = store.create(training_track="F450_TWELVE_TASK").session_id
        for index in range(25):
            store.record_coach_turn(sid, f"問題 {index}", f"回答 {index}", "SESSION_SOP")
        history = store.coach_history(sid)
        self.assertEqual(len(history), 20)
        self.assertEqual(history[0]["question"], "問題 5")
        self.assertEqual(history[-1]["answer"], "回答 24")

    def test_approved_teacher_version_precedes_rag_and_is_saved_in_memory(self):
        store = InMemorySessionStore()
        client = TestClient(create_app(vision_adapter=FakeVision(), rag_adapter=FakeRAG(), session_store=store, dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "vision_source": "REAL_VISION", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        store.record_knowledge_candidate(
            sid, question="羅盤校準怎麼做？", task_id="TASK_01", step_id="T01_WORKSPACE",
            llm_answer="舊 AI 回答", answer_source="AI_REFERENCE",
        )
        candidate = store._knowledge_candidates[sid][-1]
        candidate.update({
            "teacher_correction": "先移除附近的金屬物品。再依畫面提示轉動飛機。",
            "final_answer": "先移除附近的金屬物品。再依畫面提示轉動飛機。",
            "review_status": "APPROVED",
            "candidate_type": "TEACHER_STYLE_CANDIDATE",
        })

        body = client.post(f"/api/live/sessions/{sid}/ask", json={"question": "羅盤校準怎麼做？"}).json()
        self.assertEqual(body["answer_source"], "TEACHER_VERSION")
        self.assertIn("先移除附近的金屬物品", body["answer"])
        self.assertEqual(store.coach_history(sid)[-1]["question"], "羅盤校準怎麼做？")


if __name__ == "__main__":
    unittest.main()
