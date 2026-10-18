import unittest

from app.task_catalog import (
    CompletionMode,
    Phase,
    TaskStatus,
    VerificationMode,
    load_f450_course,
    validate_course,
)


class F450TaskCatalogTests(unittest.TestCase):
    def setUp(self):
        self.course = load_f450_course()
        self.tasks = self.course.tasks
        self.by_id = {task.id: task for task in self.tasks}

    def test_course_has_exactly_twelve_fixed_tasks_in_order(self):
        self.assertEqual([task.id for task in self.tasks], [f"TASK_{n:02d}" for n in range(1, 13)])
        self.assertEqual([task.short_name for task in self.tasks], list("认测装焊接查调验演查飞析"))
        self.assertEqual([task.order for task in self.tasks], list(range(1, 13)))

    def test_phase_allocation_is_fixed(self):
        self.assertTrue(all(task.phase is Phase.BUILD_COACH for task in self.tasks[:6]))
        self.assertTrue(all(task.phase is Phase.SETUP_VERIFICATION_COACH for task in self.tasks[6:10]))
        self.assertTrue(all(task.phase is Phase.FLIGHT_HEALTH_COACH for task in self.tasks[10:]))

    def test_uniform_schema_is_populated(self):
        for index, task in enumerate(self.tasks):
            self.assertEqual(task.hardware_profile, "F450_PIXHAWK248")
            self.assertEqual(task.status, TaskStatus.NOT_STARTED)
            self.assertTrue(task.title and task.description and task.objective)
            self.assertTrue(task.steps)
            self.assertTrue(task.completion_rule)
            self.assertEqual(task.next_task, None if index == 11 else self.tasks[index + 1].id)

    def test_locked_prerequisites_are_encoded(self):
        self.assertEqual(self.by_id["TASK_02"].prerequisites, ("TASK_01",))
        self.assertEqual(self.by_id["TASK_07"].prerequisites, ("TASK_06",))
        self.assertEqual(self.by_id["TASK_10"].prerequisites, ("TASK_07", "TASK_08", "TASK_09"))
        self.assertEqual(self.by_id["TASK_11"].prerequisites, ("TASK_10",))
        self.assertEqual(self.by_id["TASK_12"].prerequisites, ("TASK_11",))

    def test_teacher_gates_are_bound_to_required_tasks(self):
        required = {"TASK_02", "TASK_04", "TASK_06", "TASK_07", "TASK_08", "TASK_10", "TASK_11", "TASK_12"}
        self.assertEqual({task.id for task in self.tasks if task.teacher_review_required}, required)
        self.assertTrue(all(self.by_id[item].safety_gate for item in required))
        self.assertEqual(self.by_id["TASK_02"].completion_mode, CompletionMode.TEACHER_CONFIRM)

    def test_verification_modes_do_not_force_vision_everywhere(self):
        self.assertIn(VerificationMode.VISION_ASSISTED, self.by_id["TASK_01"].verification_modes)
        self.assertNotIn(VerificationMode.VISION_ASSISTED, self.by_id["TASK_04"].verification_modes)
        self.assertIn(VerificationMode.TEACHER_CONFIRM, self.by_id["TASK_11"].verification_modes)

    def test_safety_reminder_bindings_cover_high_risk_tasks(self):
        self.assertEqual(set(self.by_id["TASK_02"].safety_reminders), {"REM_MOTOR_TEST_NO_PROP", "REM_ESC_POWER_POLARITY"})
        self.assertIn("REM_MOTOR_SCREW_TOO_LONG", self.by_id["TASK_03"].safety_reminders)
        self.assertTrue({"REM_HEATSHRINK_BEFORE_SOLDER", "REM_CONTINUITY_TEST_REQUIRED"} <= set(self.by_id["TASK_04"].safety_reminders))
        self.assertIn("REM_FIRST_POWER_TEACHER_REQUIRED", self.by_id["TASK_07"].safety_reminders)
        self.assertIn("REM_FLIGHT_TEACHER_REQUIRED", self.by_id["TASK_11"].safety_reminders)

    def test_task07_contains_full_mission_planner_structure(self):
        step_ids = [step.id for step in self.by_id["TASK_07"].steps]
        self.assertEqual(step_ids[0], "T07_PREPOWER_REVIEW")
        self.assertIn("T07_ACCEL_CALIBRATION", step_ids)
        self.assertIn("T07_COMPASS_CALIBRATION", step_ids)
        self.assertIn("T07_RADIO_CALIBRATION", step_ids)
        self.assertIn("T07_FAILSAFE", step_ids)
        self.assertIn("T07_RTL", step_ids)
        self.assertEqual(step_ids[-1], "T07_REFLECTION")

    def test_task08_is_verification_and_prop_vision_is_only_a_subtask(self):
        task = self.by_id["TASK_08"]
        step_ids = {step.id for step in task.steps}
        self.assertEqual(step_ids, {
            "T08_FLIGHT_MODE_CHECK", "T08_RC_INPUT_CHECK", "T08_GPS_COMPASS_STATUS",
            "T08_FAILSAFE_CONFIG", "T08_RTL_CONFIG", "T08_PAYLOAD_MAPPING",
            "T08_PROP_VISION", "T08_TEACHER_FINAL_REVIEW",
        })
        self.assertEqual(task.vision_tasks, ("propeller_orientation_assist",))

    def test_task09_is_qgc_simulation_not_real_arm_authority(self):
        task = self.by_id["TASK_09"]
        self.assertIn("QGC 综合联调与模拟任务演练", task.title)
        self.assertIn("SITL_MISSION_REHEARSAL", {step.id for step in task.steps})
        self.assertTrue(all("REAL_ARM" not in step.id for step in task.steps))

    def test_task12_only_references_existing_flight_health(self):
        task = self.by_id["TASK_12"]
        self.assertEqual(task.integration_entry, "EXISTING_FLIGHT_HEALTH")
        self.assertIn("FLIGHT_HEALTH_REFERENCE", task.evidence_requirements)
        self.assertNotIn("VISION_ASSISTED", {mode.value for mode in task.verification_modes})

    def test_course_validation_accepts_canonical_catalog(self):
        self.assertIsNone(validate_course(self.course))


if __name__ == "__main__":
    unittest.main()
