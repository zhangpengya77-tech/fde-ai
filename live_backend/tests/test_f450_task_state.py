import unittest

from app.task_catalog import TaskStatus, load_f450_course
from app.task_state import TaskTransitionError, TrainingProgress


class F450TaskStateTests(unittest.TestCase):
    def setUp(self):
        self.progress = TrainingProgress("session-1", "student-1", load_f450_course())

    def _complete(self, task_id, *, teacher=False, evidence_type=None):
        self.progress.start_task(task_id)
        if evidence_type:
            self.progress.record_evidence(task_id, evidence_type, f"ref-{task_id}")
        self.progress.request_completion(task_id, actor="student")
        if teacher:
            self.progress.record_teacher_review(task_id, "APPROVE", "teacher-dev", "verified")

    def _complete_through(self, last_order):
        teacher_tasks = {"TASK_02", "TASK_04", "TASK_06", "TASK_07", "TASK_08", "TASK_10", "TASK_11", "TASK_12"}
        for order in range(1, last_order + 1):
            task_id = f"TASK_{order:02d}"
            evidence = "FLIGHT_LOG_REFERENCE" if task_id == "TASK_11" else None
            self._complete(task_id, teacher=task_id in teacher_tasks, evidence_type=evidence)

    def test_task02_pending_teacher_review_blocks_task03(self):
        self._complete("TASK_01")
        self.progress.start_task("TASK_02")
        self.progress.request_completion("TASK_02", actor="student")
        self.assertEqual(self.progress.task("TASK_02").status, TaskStatus.PENDING_TEACHER_REVIEW)
        with self.assertRaisesRegex(TaskTransitionError, "missing_prerequisites:TASK_02"):
            self.progress.start_task("TASK_03")
        self.assertEqual(self.progress.task("TASK_03").status, TaskStatus.BLOCKED)
        self.assertEqual(self.progress.task("TASK_03").missing_prerequisites, ("TASK_02",))

    def test_teacher_approve_unlocks_next_task_and_records_audit(self):
        self._complete("TASK_01")
        self.progress.start_task("TASK_02")
        self.progress.request_completion("TASK_02", actor="student")
        review = self.progress.record_teacher_review("TASK_02", "APPROVE", "teacher-dev", "bench test verified")
        self.assertEqual(self.progress.task("TASK_02").status, TaskStatus.COMPLETED)
        self.assertEqual(review.previous_state, TaskStatus.PENDING_TEACHER_REVIEW)
        self.assertEqual(review.new_state, TaskStatus.COMPLETED)
        self.assertEqual(review.session_id, "session-1")
        self.progress.start_task("TASK_03")
        self.assertEqual(self.progress.task("TASK_03").status, TaskStatus.IN_PROGRESS)

    def test_teacher_reject_moves_task_to_need_rework(self):
        self._complete("TASK_01")
        self.progress.start_task("TASK_02")
        self.progress.request_completion("TASK_02", actor="student")
        self.progress.record_teacher_review("TASK_02", "REJECT_REWORK", "teacher-dev", "repeat M2")
        self.assertEqual(self.progress.task("TASK_02").status, TaskStatus.NEED_REWORK)

    def test_student_cannot_complete_or_approve_teacher_gate(self):
        self._complete("TASK_01")
        self.progress.start_task("TASK_02")
        self.progress.request_completion("TASK_02", actor="student")
        with self.assertRaisesRegex(TaskTransitionError, "teacher_authority_required"):
            self.progress.record_teacher_review("TASK_02", "APPROVE", "student-1", "self approved", actor_role="student")
        self.assertEqual(self.progress.task("TASK_02").status, TaskStatus.PENDING_TEACHER_REVIEW)

    def test_task07_is_blocked_without_task06_teacher_release(self):
        self._complete_through(5)
        self.progress.start_task("TASK_06")
        self.progress.request_completion("TASK_06", actor="student")
        with self.assertRaisesRegex(TaskTransitionError, "missing_prerequisites:TASK_06"):
            self.progress.start_task("TASK_07")

    def test_task10_release_is_required_before_task11(self):
        self._complete_through(9)
        self.progress.start_task("TASK_10")
        self.progress.request_completion("TASK_10", actor="student")
        with self.assertRaisesRegex(TaskTransitionError, "missing_prerequisites:TASK_10"):
            self.progress.start_task("TASK_11")

    def test_task12_requires_real_flight_evidence(self):
        self._complete_through(10)
        self.progress.start_task("TASK_11")
        self.progress.request_completion("TASK_11", actor="student")
        self.progress.record_teacher_review("TASK_11", "APPROVE", "teacher-dev", "flight supervised")
        self.progress.start_task("TASK_12")
        with self.assertRaisesRegex(TaskTransitionError, "flight_evidence_required"):
            self.progress.request_completion("TASK_12", actor="student")

    def test_all_twelve_tasks_produce_12_of_12(self):
        self._complete_through(12)
        self.assertEqual(self.progress.completed_count, 12)
        self.assertEqual(self.progress.summary, "12 / 12")

    def test_viewing_future_task_does_not_mutate_state(self):
        task = self.progress.view_task("TASK_09")
        self.assertEqual(task.status, TaskStatus.NOT_STARTED)
        self.assertEqual(self.progress.task("TASK_09").status, TaskStatus.NOT_STARTED)


if __name__ == "__main__":
    unittest.main()
