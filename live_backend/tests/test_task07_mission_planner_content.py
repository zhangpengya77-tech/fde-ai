import unittest

from app.task_catalog import CompletionMode, TaskStatus, load_f450_course
from app.task_state import TaskTransitionError, TrainingProgress


class Task07MissionPlannerContentTests(unittest.TestCase):
    def setUp(self):
        self.task = next(task for task in load_f450_course().tasks if task.id == "TASK_07")
        self.steps = {step.step_id: step for step in self.task.steps}

    def test_task07_has_versioned_ordered_mission_planner_groups(self):
        expected = [
            "T07_PREPOWER_REVIEW", "T07_FIRST_POWER_TEACHER", "T07_MP_CONNECT",
            "T07_FC_FIRMWARE_AIRFRAME", "T07_ACCEL_PREP", "T07_ACCEL_CALIBRATION",
            "T07_COMPASS_PREP", "T07_COMPASS_CALIBRATION", "T07_RADIO_PREP",
            "T07_RADIO_CALIBRATION", "T07_RECEIVER_STATUS", "T07_MOTOR_OUTPUT_MAPPING",
            "T07_FLIGHT_MODES", "T07_FAILSAFE", "T07_GPS_STATUS", "T07_RTL",
            "T07_BASE_PARAMETERS", "T07_FINAL_CONFIG_REVIEW", "T07_EVIDENCE", "T07_REFLECTION",
        ]
        self.assertEqual([step.step_id for step in self.task.steps], expected)
        self.assertEqual([step.order for step in self.task.steps], list(range(1, 21)))
        self.assertTrue(all(step.schema_version == "1.0" for step in self.task.steps))
        self.assertTrue(all(step.content_version.startswith("2026.10") for step in self.task.steps))

    def test_each_step_teaches_action_reason_expected_result_stop_condition_and_teacher_boundary(self):
        for step in self.task.steps:
            self.assertTrue(step.student_instruction, step.step_id)
            self.assertTrue(step.why_it_matters, step.step_id)
            self.assertTrue(step.expected_action, step.step_id)
            self.assertTrue(step.ai_guidance, step.step_id)
            self.assertIn("不能继续", step.fallback_guidance, step.step_id)
            self.assertIn("教师", step.fallback_guidance, step.step_id)

    def test_first_power_and_high_risk_checks_require_teacher_authority(self):
        gated = {
            "T07_FIRST_POWER_TEACHER", "T07_RECEIVER_STATUS", "T07_MOTOR_OUTPUT_MAPPING",
            "T07_FAILSAFE", "T07_GPS_STATUS", "T07_RTL", "T07_FINAL_CONFIG_REVIEW",
        }
        self.assertTrue(gated <= {step.step_id for step in self.task.steps if step.teacher_gate})
        self.assertIn("REM_FIRST_POWER_TEACHER_REQUIRED", self.steps["T07_FIRST_POWER_TEACHER"].safety_reminders)
        self.assertTrue(self.task.teacher_review_required)
        self.assertEqual(self.task.completion_mode, CompletionMode.HYBRID)

    def test_key_results_use_existing_evidence_contract(self):
        expected = {
            "T07_MP_CONNECT": ("SCREENSHOT",), "T07_ACCEL_CALIBRATION": ("MP_RESULT",),
            "T07_COMPASS_CALIBRATION": ("MP_RESULT",), "T07_RADIO_CALIBRATION": ("MP_RESULT",),
            "T07_FLIGHT_MODES": ("SCREENSHOT",), "T07_FAILSAFE": ("SCREENSHOT",),
            "T07_GPS_STATUS": ("SCREENSHOT",), "T07_RTL": ("SCREENSHOT",),
            "T07_FINAL_CONFIG_REVIEW": ("CHECKLIST",),
        }
        for step_id, evidence in expected.items():
            self.assertEqual(self.steps[step_id].evidence_required, evidence)
        self.assertEqual(self.task.evidence_requirements, ("SCREENSHOT", "MP_RESULT", "CHECKLIST", "TEACHER_REVIEW"))

    def test_reflection_is_final_step_and_preserves_student_authorship_boundary(self):
        reflection = self.task.steps[-1]
        self.assertEqual(reflection.step_id, "T07_REFLECTION")
        self.assertIn("我完成了哪些", reflection.student_instruction)
        self.assertIn("仍需要户外验证", reflection.student_instruction)
        self.assertIsNone(reflection.next_step)

    def test_ai_guidance_never_claims_parameter_write_arm_or_flight_authority(self):
        combined = " ".join(value for step in self.task.steps for value in (
            step.student_instruction, step.why_it_matters, step.expected_action,
            step.ai_guidance, step.fallback_guidance
        ))
        self.assertIn("AI 不会自动写入参数", combined)
        self.assertIn("不得解锁", combined)
        self.assertNotIn("AI 自动保存", combined)
        self.assertNotIn("AI 自动解锁", combined)

    def test_evidence_does_not_bypass_task07_teacher_gate(self):
        progress = TrainingProgress("session-07", "student-07", load_f450_course())
        progress.task("TASK_06").status = TaskStatus.COMPLETED
        progress.start_task("TASK_07")
        task = progress.task("TASK_07")
        task.current_training_step_id = "T07_FAILSAFE"

        progress.record_step_evidence("TASK_07", "T07_FAILSAFE", "SCREENSHOT")

        self.assertEqual(task.current_training_step_id, "T07_FAILSAFE")
        self.assertEqual(task.training_step_progress["T07_FAILSAFE"]["status"], "PENDING_TEACHER_REVIEW")
        self.assertIsNone(task.training_step_progress["T07_FAILSAFE"]["teacher_decision"])

    def test_task08_stays_blocked_until_task07_final_teacher_review(self):
        progress = TrainingProgress("session-07", "student-07", load_f450_course())
        progress.task("TASK_06").status = TaskStatus.COMPLETED
        progress.start_task("TASK_07")
        progress.task("TASK_07").status = TaskStatus.PENDING_TEACHER_REVIEW

        with self.assertRaisesRegex(TaskTransitionError, "missing_prerequisites:TASK_07"):
            progress.start_task("TASK_08")

        progress.record_teacher_review("TASK_07", "APPROVE", "MOCK_TEACHER", "软件流程复核", actor_role="teacher")
        self.assertEqual(progress.start_task("TASK_08").status, TaskStatus.IN_PROGRESS)


if __name__ == "__main__":
    unittest.main()
