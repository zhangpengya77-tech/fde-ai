import unittest

from app.rag import RAGResult
from app.rag_context import RAGContextBuilder
from app.rag_guidance import ContextualGuidanceCoordinator, RAGGuidanceProvider
from app.sessions import InMemorySessionStore
from app.sop import DetectionFact, SopDecision


class RecordingAdapter:
    def __init__(self, explanation="NG PASS 允许继续 可以起飞"):
        self.calls = 0
        self.explanation = explanation

    async def query(self, _question, request_id, context_version):
        self.calls += 1
        return RAGResult(
            "online", self.explanation, None, None, 2, True, None,
            request_id, context_version, "rag", None
        )


class RAGSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def test_supported_sop_results_keep_backend_state_and_emit_monotonic_events(self):
        for status, detected, error in [
            ("NO_DETECTION", None, "no_detection"),
            ("UNCERTAIN", "motor", "low_confidence"),
            ("PASS_CANDIDATE", "motor", None),
        ]:
            with self.subTest(status=status):
                store = InMemorySessionStore()
                session = store.create()
                step = store.current_step(session.session_id)
                fact = None if detected is None else DetectionFact(detected, 0.4, [1, 2, 3, 4], status, "now")
                decision = SopDecision(status, error, ("motor",), detected, 0.4 if detected else None, 1 if status == "PASS_CANDIDATE" else 0, 1, None)
                store.apply_decision(session.session_id, step, fact, decision)
                coordinator = ContextualGuidanceCoordinator(store, RAGContextBuilder(), RAGGuidanceProvider(RecordingAdapter()))
                coordinator.schedule(session.session_id, step, fact, decision)
                await coordinator.wait_all()
                self.assertEqual(session.state, status)
                self.assertEqual(session.current_step_id, "prepare_motor")
                sequences = [item["sequence"] for item in store.events(session.session_id)]
                self.assertEqual(sequences, list(range(1, len(sequences) + 1)))
                self.assertIn("RAG_COMPLETED", [item["type"] for item in store.events(session.session_id)])

    async def test_changed_error_code_triggers_new_query_but_same_error_is_deduplicated(self):
        store = InMemorySessionStore()
        session = store.create()
        step = store.current_step(session.session_id)
        fact = DetectionFact("frame_arm", 0.8, [1, 2, 3, 4], "f1", "now")
        adapter = RecordingAdapter()
        coordinator = ContextualGuidanceCoordinator(store, RAGContextBuilder(), RAGGuidanceProvider(adapter))
        first = SopDecision("NG", "wrong_class", ("motor",), "frame_arm", 0.8, 0, 1, None)
        second = SopDecision("NG", "wrong_orientation", ("motor",), "frame_arm", 0.8, 0, 1, None)
        self.assertTrue(coordinator.schedule(session.session_id, step, fact, first))
        self.assertFalse(coordinator.schedule(session.session_id, step, fact, first))
        self.assertTrue(coordinator.schedule(session.session_id, step, fact, second))
        await coordinator.wait_all()
        self.assertEqual(adapter.calls, 2)
        self.assertEqual(session.state, "WAITING_FOR_OBJECT")

    async def test_control_language_is_display_only(self):
        store = InMemorySessionStore()
        session = store.create()
        step = store.current_step(session.session_id)
        fact = DetectionFact("frame_arm", 0.8, [1, 2, 3, 4], "f1", "now")
        decision = SopDecision("NG", "wrong_class", ("motor",), "frame_arm", 0.8, 0, 1, None)
        store.apply_decision(session.session_id, step, fact, decision)
        coordinator = ContextualGuidanceCoordinator(store, RAGContextBuilder(), RAGGuidanceProvider(RecordingAdapter()))
        coordinator.schedule(session.session_id, step, fact, decision)
        await coordinator.wait_all()
        self.assertEqual(session.state, "NG")
        self.assertEqual(session.pass_candidate_count, 0)
        self.assertEqual(session.current_step_id, "prepare_motor")
        self.assertIn("允许继续", session.rag_explanation["explanation"])


if __name__ == "__main__":
    unittest.main()
