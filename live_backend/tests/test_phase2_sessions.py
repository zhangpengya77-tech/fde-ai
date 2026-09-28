import unittest

from app.sessions import InMemorySessionStore, InvalidSessionTransition
from app.sop import DetectionFact, SopEngine, load_demo_course


class Phase2SessionTests(unittest.TestCase):
    def setUp(self):
        self.course = load_demo_course()
        self.store = InMemorySessionStore(course=self.course)
        self.session = self.store.create(vision_source="REAL_VISION")
        self.engine = SopEngine()

    def decision(self, name="motor", confidence=0.9, frame_id="f1"):
        step = self.store.current_step(self.session.session_id)
        fact = DetectionFact(name, confidence, [0, 0, 10, 10], frame_id, "2026-09-28T00:00:00Z")
        return step, fact, self.engine.evaluate(step, fact, self.store.get(self.session.session_id).pass_candidate_count, self.store.get(self.session.session_id).last_frame_id)

    def test_session_has_authoritative_fields_and_start_events(self):
        value = self.store.get(self.session.session_id).as_dict()
        self.assertEqual(value["current_step_id"], "prepare_motor")
        self.assertEqual(value["expected_class"], "motor")
        self.assertEqual(value["state"], "WAITING_FOR_OBJECT")
        self.assertEqual([e["type"] for e in self.store.events(self.session.session_id)], ["SESSION_STARTED", "STEP_STARTED"])

    def test_applies_decision_and_counts_unique_frames(self):
        step, fact, decision = self.decision()
        updated = self.store.apply_decision(self.session.session_id, step, fact, decision)
        self.assertEqual(updated.state, "PASS_CANDIDATE")
        self.assertEqual(updated.pass_candidate_count, 1)
        step, fact, decision = self.decision(frame_id="f1")
        updated = self.store.apply_decision(self.session.session_id, step, fact, decision)
        self.assertEqual(updated.pass_candidate_count, 1)

    def test_wrong_object_increments_fail_count(self):
        step, fact, decision = self.decision("frame_arm")
        updated = self.store.apply_decision(self.session.session_id, step, fact, decision)
        self.assertEqual(updated.state, "NG")
        self.assertEqual(updated.fail_count, 1)

    def test_confirm_advances_each_step_once_and_completes_task(self):
        for expected in ("motor", "frame_arm", "flight_controller"):
            step, fact, decision = self.decision(expected, frame_id=f"f-{expected}")
            self.store.apply_decision(self.session.session_id, step, fact, decision)
            self.store.confirm(self.session.session_id)
        final = self.store.get(self.session.session_id)
        self.assertEqual(final.state, "TASK_COMPLETED")
        self.assertIsNotNone(final.completed_at)
        with self.assertRaises(InvalidSessionTransition):
            self.store.confirm(self.session.session_id)

    def test_safety_gate_cannot_be_confirmed(self):
        session = self.store.get(self.session.session_id)
        session.state = "TEACHER_CHECK"
        with self.assertRaises(InvalidSessionTransition):
            self.store.confirm(self.session.session_id)

    def test_event_sequence_is_monotonic_and_sessions_are_isolated(self):
        other = self.store.create()
        step, fact, decision = self.decision()
        self.store.apply_decision(self.session.session_id, step, fact, decision)
        events = self.store.events(self.session.session_id)
        self.assertEqual([e["sequence"] for e in events], list(range(1, len(events) + 1)))
        self.assertEqual(len(self.store.events(other.session_id)), 2)


if __name__ == "__main__":
    unittest.main()
