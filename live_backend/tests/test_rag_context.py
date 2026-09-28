import unittest

from app.rag_context import RAGContextBuilder, build_question
from app.sessions import InMemorySessionStore
from app.sop import DetectionFact, SopDecision


class RAGContextTests(unittest.TestCase):
    def setUp(self):
        self.store = InMemorySessionStore()
        self.session = self.store.create()
        self.step = self.store.current_step(self.session.session_id)
        self.builder = RAGContextBuilder()

    def apply_error(self, index):
        fact = DetectionFact("frame_arm", 0.8, [1, 2, 3, 4], f"f{index}", "2026-09-29T00:00:00Z")
        decision = SopDecision("NG", f"wrong_{index}", ("motor",), "frame_arm", 0.8, 0, 1, None)
        self.store.apply_decision(self.session.session_id, self.step, fact, decision)
        return fact, decision

    def test_context_uses_backend_session_step_fact_and_latest_five_errors(self):
        fact = decision = None
        for index in range(7):
            fact, decision = self.apply_error(index)
        context = self.builder.build(
            self.store.get(self.session.session_id),
            self.step,
            fact,
            decision,
            self.store.events(self.session.session_id),
        )
        self.assertEqual(context.course_id, "F450_BASIC_ASSEMBLY")
        self.assertEqual(context.step_title, "准备马达")
        self.assertEqual(context.expected_class, "motor")
        self.assertEqual(context.detected_class, "frame_arm")
        self.assertEqual(context.sop_result, "NG")
        self.assertEqual(len(context.recent_error_history), 5)
        self.assertEqual(context.recent_error_history[-1]["error_code"], "wrong_6")
        self.assertNotIn("client_context", context.as_dict())

    def test_question_is_instructional_and_forbids_control_decisions(self):
        fact, decision = self.apply_error(1)
        context = self.builder.build(self.session, self.step, fact, decision, self.store.events(self.session.session_id))
        question = build_question(context)
        self.assertIn("motor", question)
        self.assertIn("frame_arm", question)
        self.assertIn("不要判断 PASS 或 NG", question)

    def test_step_advance_increments_context_version_and_resets_explanation(self):
        initial = self.session.context_version
        fact = DetectionFact("motor", 0.9, [1, 2, 3, 4], "pass", "2026-09-29T00:00:00Z")
        decision = SopDecision("PASS_CANDIDATE", None, ("motor",), "motor", 0.9, 1, 1, None)
        self.store.apply_decision(self.session.session_id, self.step, fact, decision)
        self.session.rag_explanation = {"status": "online", "explanation": "old"}
        self.store.confirm(self.session.session_id)
        self.assertEqual(self.session.context_version, initial + 1)
        self.assertEqual(self.session.rag_explanation["status"], "idle")


if __name__ == "__main__":
    unittest.main()
