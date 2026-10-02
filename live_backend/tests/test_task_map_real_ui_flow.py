import unittest

from app.task_catalog import TaskStatus, load_f450_course
from app.task_state import TaskTransitionError, TrainingProgress


class TaskMapRealUiFlowTests(unittest.TestCase):
    def setUp(self):
        self.progress = TrainingProgress('session-ui', 'student-ui', load_f450_course())

    def test_task_can_start_out_of_order_and_persists_in_progress(self):
        started = self.progress.start_task('TASK_03')
        self.assertEqual(started.status, TaskStatus.IN_PROGRESS)
        self.assertEqual(self.progress.view_task('TASK_03').status, TaskStatus.IN_PROGRESS)

    def test_normal_task_can_complete_without_previous_task(self):
        self.progress.start_task('TASK_03')
        task = self.progress.task('TASK_03')
        task.current_training_step_id = None
        self.progress.request_completion('TASK_03', actor='student')
        self.assertEqual(task.status, TaskStatus.COMPLETED)

    def test_task07_blocks_only_first_power_step_without_task06_release(self):
        self.progress.start_task('TASK_07')
        task = self.progress.task('TASK_07')
        self.assertEqual(task.status, TaskStatus.IN_PROGRESS)
        task.current_training_step_id = 'T07_FIRST_POWER_TEACHER'
        self.progress.acknowledge_step_safety('TASK_07', 'T07_FIRST_POWER_TEACHER')
        with self.assertRaisesRegex(TaskTransitionError, 'unsafe_step_prerequisites:TASK_06'):
            self.progress.record_step_fact('TASK_07', 'T07_FIRST_POWER_TEACHER', 'LEARNER_CONFIRMED')
        self.assertEqual(task.status, TaskStatus.IN_PROGRESS)

    def test_task11_blocks_only_controlled_flight_without_task10_release(self):
        self.progress.start_task('TASK_11')
        task = self.progress.task('TASK_11')
        task.current_training_step_id = 'TEACHER_CONTROLLED_FLIGHT'
        with self.assertRaisesRegex(TaskTransitionError, 'unsafe_step_prerequisites:TASK_10'):
            self.progress.record_step_fact('TASK_11', 'TEACHER_CONTROLLED_FLIGHT', 'LEARNER_CONFIRMED')

    def test_step_teacher_review_drives_orange_red_and_returns_to_blue(self):
        self.progress.start_task('TASK_02')
        task = self.progress.task('TASK_02')
        task.current_training_step_id = 'T02_PREPOWER_TEACHER'
        self.progress.record_step_fact('TASK_02', 'T02_PREPOWER_TEACHER', 'LEARNER_CONFIRMED')
        self.assertEqual(task.status, TaskStatus.PENDING_TEACHER_REVIEW)
        self.progress.review_step('TASK_02', 'T02_PREPOWER_TEACHER', 'REJECT_REWORK', 'teacher', note='recheck')
        self.assertEqual(task.status, TaskStatus.NEED_REWORK)
        task.status = TaskStatus.PENDING_TEACHER_REVIEW
        self.progress.review_step('TASK_02', 'T02_PREPOWER_TEACHER', 'APPROVE', 'teacher')
        self.assertEqual(task.status, TaskStatus.IN_PROGRESS)

    def test_task_teacher_review_drives_orange_green_and_red(self):
        approved = TrainingProgress('session-approved', 'student-ui', load_f450_course())
        approved.start_task('TASK_02')
        approved.task('TASK_02').current_training_step_id = None
        approved.request_completion('TASK_02', actor='student')
        self.assertEqual(approved.task('TASK_02').status, TaskStatus.PENDING_TEACHER_REVIEW)
        approved.record_teacher_review('TASK_02', 'APPROVE', 'teacher', 'checked')
        self.assertEqual(approved.task('TASK_02').status, TaskStatus.COMPLETED)

        rejected = TrainingProgress('session-rejected', 'student-ui', load_f450_course())
        rejected.start_task('TASK_02')
        rejected.task('TASK_02').current_training_step_id = None
        rejected.request_completion('TASK_02', actor='student')
        rejected.record_teacher_review('TASK_02', 'REJECT_REWORK', 'teacher', 'recheck')
        self.assertEqual(rejected.task('TASK_02').status, TaskStatus.NEED_REWORK)


if __name__ == '__main__':
    unittest.main()
