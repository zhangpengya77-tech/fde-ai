import unittest

from app.sop import DetectionFact, SopEngine, SopStep, load_demo_course, select_detection


class SopTests(unittest.TestCase):
    def setUp(self):
        self.engine = SopEngine()
        self.course = load_demo_course()
        self.task = self.course.tasks[0]
        self.step = self.task.steps[0]

    def fact(self, name="motor", confidence=0.9, frame_id="f1"):
        return DetectionFact(name, confidence, [1, 2, 30, 40], frame_id, "2026-09-28T00:00:00Z")

    def test_demo_definition_is_configurable(self):
        self.assertEqual(self.course.course_id, "F450_BASIC_ASSEMBLY")
        self.assertEqual(self.task.task_id, "PARTS_PREPARATION")
        self.assertEqual([step.step_id for step in self.task.steps], ["prepare_motor", "prepare_frame_arm", "prepare_flight_controller"])
        self.assertEqual([step.expected_classes[0] for step in self.task.steps], ["motor", "frame_arm", "flight_controller"])

    def test_decision_rules(self):
        self.assertEqual(self.engine.evaluate(self.step, None, 0, None).status, "NO_DETECTION")
        self.assertEqual(self.engine.evaluate(self.step, self.fact(confidence=0.1), 0, None).status, "UNCERTAIN")
        self.assertEqual(self.engine.evaluate(self.step, self.fact("frame_arm"), 0, None).status, "NG")
        passed = self.engine.evaluate(self.step, self.fact(), 0, None)
        self.assertEqual(passed.status, "PASS_CANDIDATE")
        self.assertEqual(passed.pass_candidate_count, 1)

    def test_duplicate_frame_does_not_increment(self):
        decision = self.engine.evaluate(self.step, self.fact(frame_id="same"), 1, "same")
        self.assertEqual(decision.pass_candidate_count, 1)
        self.assertEqual(decision.error_code, "duplicate_frame")

    def test_safety_gate_requires_teacher(self):
        step = SopStep("power", "通电", "等待教师", ("battery",), 0.6, 1, {}, True, None)
        self.assertEqual(self.engine.evaluate(step, self.fact("battery"), 0, None).status, "TEACHER_CHECK")

    def test_selects_highest_confidence_detection(self):
        selected = select_detection([
            {"class": "motor", "confidence": 0.4, "box": [0, 0, 1, 1]},
            {"class": "frame_arm", "confidence": 0.8, "box": [1, 1, 2, 2]},
        ], "f1", "2026-09-28T00:00:00Z")
        self.assertEqual(selected.class_name, "frame_arm")


if __name__ == "__main__":
    unittest.main()
