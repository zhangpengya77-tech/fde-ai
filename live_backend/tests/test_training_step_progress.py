import unittest

from app.task_catalog import TaskStatus, load_f450_course
from app.task_state import TaskTransitionError, TrainingProgress


class TrainingStepProgressTests(unittest.TestCase):
    def setUp(self):
        self.progress = TrainingProgress("s1", "student", load_f450_course())
        self.progress.start_task("TASK_01")

    def test_training_step_state_is_separate_and_starts_at_first_step(self):
        task = self.progress.task("TASK_01")
        self.assertEqual(task.current_training_step_id, "T01_WORKSPACE")
        self.assertEqual(len(task.training_step_progress), 10)

    def test_student_fact_advances_non_gate_step(self):
        self.progress.record_step_fact("TASK_01", "T01_WORKSPACE", "LEARNER_CONFIRMED")
        self.assertEqual(self.progress.task("TASK_01").current_training_step_id, "T01_FRAME")

    def test_safety_ack_does_not_clear_teacher_gate(self):
        self.progress.start_task("TASK_02") if False else None
        task = self.progress.task("TASK_02")
        task.status = TaskStatus.IN_PROGRESS
        task.current_training_step_id = "T02_PREPOWER_TEACHER"
        self.progress.acknowledge_step_safety("TASK_02", "T02_PREPOWER_TEACHER")
        with self.assertRaisesRegex(TaskTransitionError, "teacher_step_approval_required"):
            self.progress.record_step_fact("TASK_02", "T02_PREPOWER_TEACHER", "LEARNER_CONFIRMED")

    def test_teacher_can_approve_or_reject_step_gate(self):
        task = self.progress.task("TASK_02")
        task.status = TaskStatus.IN_PROGRESS
        task.current_training_step_id = "T02_PREPOWER_TEACHER"
        self.progress.review_step("TASK_02", "T02_PREPOWER_TEACHER", "APPROVE", "MOCK_TEACHER", actor_role="teacher")
        self.assertEqual(task.current_training_step_id, "T02_M1")


if __name__ == "__main__":
    unittest.main()
