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

    def test_task02_pending_teacher_review_does_not_block_task03_learning(self):
        self._complete("TASK_01")
        self.progress.start_task("TASK_02")
        self.progress.request_completion("TASK_02", actor="student")
        self.assertEqual(self.progress.task("TASK_02").status, TaskStatus.PENDING_TEACHER_REVIEW)
        self.progress.start_task("TASK_03")
        self.assertEqual(self.progress.task("TASK_03").status, TaskStatus.IN_PROGRESS)
        self.assertEqual(self.progress.task("TASK_03").missing_prerequisites, ())

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

    def test_task07_learning_is_open_but_first_power_is_blocked_without_task06_release(self):
        self._complete_through(5)
        self.progress.start_task("TASK_06")
        self.progress.request_completion("TASK_06", actor="student")
        task = self.progress.start_task("TASK_07")
        self.assertEqual(task.status, TaskStatus.IN_PROGRESS)
        task.current_training_step_id = "T07_FIRST_POWER_TEACHER"
        self.progress.acknowledge_step_safety("TASK_07", "T07_FIRST_POWER_TEACHER")
        with self.assertRaisesRegex(TaskTransitionError, "unsafe_step_prerequisites:TASK_06"):
            self.progress.record_step_fact("TASK_07", "T07_FIRST_POWER_TEACHER", "LEARNER_CONFIRMED")

    def test_task11_learning_is_open_but_controlled_flight_requires_task10_release(self):
        self._complete_through(9)
        self.progress.start_task("TASK_10")
        self.progress.request_completion("TASK_10", actor="student")
        task = self.progress.start_task("TASK_11")
        self.assertEqual(task.status, TaskStatus.IN_PROGRESS)
        task.current_training_step_id = "TEACHER_CONTROLLED_FLIGHT"
        with self.assertRaisesRegex(TaskTransitionError, "unsafe_step_prerequisites:TASK_10"):
            self.progress.record_step_fact("TASK_11", "TEACHER_CONTROLLED_FLIGHT", "LEARNER_CONFIRMED")

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

    def test_task08_vision_model_not_ready_only_allowed_on_prop_vision(self):
        self.progress.start_task("TASK_08")
        self.progress.task("TASK_08").current_training_step_id = "T08_PROP_VISION"
        # VISION_MODEL_NOT_READY 仅允许出现在 PROP_VISION 步骤，且应被记录为 check_status。
        self.progress.record_step_fact("TASK_08", "T08_PROP_VISION", "VISION_MODEL_NOT_READY", student_note="active model not ready")
        step_state = self.progress.task("TASK_08").training_step_progress["T08_PROP_VISION"]
        self.assertEqual(step_state["check_status"], "VISION_MODEL_NOT_READY")
        # 在非 PROP_VISION 步骤记录 VISION_MODEL_NOT_READY 必须被拒绝。
        self.progress.task("TASK_08").current_training_step_id = "T08_GPS_COMPASS_STATUS"
        with self.assertRaisesRegex(TaskTransitionError, "vision_pending_only_allowed_for_prop"):
            self.progress.record_step_fact("TASK_08", "T08_GPS_COMPASS_STATUS", "VISION_MODEL_NOT_READY")

    def test_task08_evidence_rejects_vision_model_not_ready_status(self):
        self.progress.start_task("TASK_08")
        # 选一个有 evidence_required 的 TASK_08 步骤（FLIGHT_MODE_CHECK 要求 SCREENSHOT），
        # 才能走到 check_status 校验分支（PROP_VISION 本身无 evidence_required，会先被 wrong_evidence_type 挡住）。
        self.progress.task("TASK_08").current_training_step_id = "T08_FLIGHT_MODE_CHECK"
        # VISION_MODEL_NOT_READY 不得作为 evidence check_status（需求 #7：不可用不得伪装成检测通过）。
        with self.assertRaisesRegex(TaskTransitionError, "invalid_task08_evidence_status"):
            self.progress.record_step_evidence(
                "TASK_08", "T08_FLIGHT_MODE_CHECK", "SCREENSHOT", check_status="VISION_MODEL_NOT_READY"
            )
        # 正向对照：合法的 check_status（如 PASS）应当被接受，证明上面的拒绝来自 check_status 校验而非证据类型。
        self.progress.record_step_evidence(
            "TASK_08", "T08_FLIGHT_MODE_CHECK", "SCREENSHOT", check_status="PASS"
        )
        step_state = self.progress.task("TASK_08").training_step_progress["T08_FLIGHT_MODE_CHECK"]
        self.assertEqual(step_state["check_status"], "PASS")


if __name__ == "__main__":
    unittest.main()
