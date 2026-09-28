import asyncio
import time
import unittest

from app.rag import RAGResult
from app.rag_context import RAGContextBuilder
from app.rag_guidance import ContextualGuidanceCoordinator, RAGGuidanceProvider
from app.sessions import InMemorySessionStore
from app.sop import DetectionFact, SopDecision


class FakeRAGAdapter:
    def __init__(self, result=None, delay=0):
        self.calls = []
        self.delay = delay
        self.result = result

    async def query(self, question, request_id, context_version):
        self.calls.append(question)
        if self.delay:
            await asyncio.sleep(self.delay)
        return self.result or RAGResult(
            "online", "马达提供旋转动力，机臂承载马达。", "f450_v1", None,
            12.3, True, None, request_id, context_version, "rag", "f450_v1"
        )


class RAGGuidanceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.store = InMemorySessionStore()
        self.session = self.store.create()
        self.step = self.store.current_step(self.session.session_id)
        self.fact = DetectionFact("frame_arm", 0.8, [1, 2, 3, 4], "f1", "2026-09-29T00:00:00Z")
        self.decision = SopDecision("NG", "wrong_class", ("motor",), "frame_arm", 0.8, 0, 1, None)
        self.store.apply_decision(self.session.session_id, self.step, self.fact, self.decision)

    def coordinator(self, adapter):
        return ContextualGuidanceCoordinator(
            self.store, RAGContextBuilder(), RAGGuidanceProvider(adapter)
        )

    async def test_schedule_is_non_blocking_and_updates_explanation_later(self):
        coordinator = self.coordinator(FakeRAGAdapter(delay=0.05))
        started = time.perf_counter()
        self.assertTrue(coordinator.schedule(self.session.session_id, self.step, self.fact, self.decision))
        self.assertLess(time.perf_counter() - started, 0.02)
        self.assertEqual(self.session.rag_explanation["status"], "pending")
        self.assertEqual(self.session.state, "NG")
        await coordinator.wait_all()
        self.assertEqual(self.session.rag_explanation["status"], "online")
        self.assertIn("马达", self.session.rag_explanation["explanation"])
        self.assertEqual(self.session.state, "NG")

    async def test_duplicate_context_does_not_query_rag_twice(self):
        adapter = FakeRAGAdapter(delay=0.01)
        coordinator = self.coordinator(adapter)
        self.assertTrue(coordinator.schedule(self.session.session_id, self.step, self.fact, self.decision))
        self.assertFalse(coordinator.schedule(self.session.session_id, self.step, self.fact, self.decision))
        await coordinator.wait_all()
        self.assertEqual(len(adapter.calls), 1)

    async def test_timeout_falls_back_without_changing_sop(self):
        result = RAGResult("timeout", None, None, None, 8000, False, "rag_timeout", "ignored", 1)
        coordinator = self.coordinator(FakeRAGAdapter(result=result))
        coordinator.schedule(self.session.session_id, self.step, self.fact, self.decision)
        await coordinator.wait_all()
        self.assertEqual(self.session.state, "NG")
        self.assertEqual(self.session.rag_explanation["status"], "timeout")
        self.assertEqual(self.session.rag_explanation["explanation"], "目前知识库说明暂时不可用。")

    async def test_old_step_result_is_dropped(self):
        adapter = FakeRAGAdapter(delay=0.05)
        coordinator = self.coordinator(adapter)
        coordinator.schedule(self.session.session_id, self.step, self.fact, self.decision)
        self.session.context_version += 1
        self.session.current_step_id = "prepare_frame_arm"
        await coordinator.wait_all()
        self.assertNotEqual(self.session.rag_explanation.get("status"), "online")
        self.assertIn("RAG_STALE_DROPPED", [event["type"] for event in self.store.events(self.session.session_id)])

    async def test_untrusted_control_words_never_change_teacher_check(self):
        self.session.state = "TEACHER_CHECK"
        decision = SopDecision("TEACHER_CHECK", "safety_gate", ("motor",), "motor", 0.99, 0, 1, None)
        result = RAGResult("online", "PASS，可以继续，可以起飞。", None, None, 5, True, None, "x", 1)
        coordinator = self.coordinator(FakeRAGAdapter(result=result))
        coordinator.schedule(self.session.session_id, self.step, self.fact, decision)
        await coordinator.wait_all()
        self.assertEqual(self.session.state, "TEACHER_CHECK")
        self.assertEqual(self.session.rag_explanation["safety_notice"], "此步骤涉及安全操作，必须由教师确认后才能继续。")


if __name__ == "__main__":
    unittest.main()
