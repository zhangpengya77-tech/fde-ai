import unittest

from app.task_catalog import load_f450_course


class BuildCoachContentTests(unittest.TestCase):
    def setUp(self):
        self.course = load_f450_course()
        self.tasks = {task.id: task for task in self.course.tasks}

    def test_schema_and_content_versions_are_exposed(self):
        self.assertEqual(self.course.schema_version, "1.0")
        for task in self.course.tasks[:6]:
            self.assertEqual(task.schema_version, "1.0")
            self.assertTrue(task.content_version.startswith("2026.10"))
            self.assertTrue(all(step.schema_version == "1.0" for step in task.steps))

    def test_task01_through_06_have_complete_novice_step_counts(self):
        self.assertEqual({task_id: len(self.tasks[task_id].steps) for task_id in self.tasks if task_id <= "TASK_06"}, {
            "TASK_01": 10, "TASK_02": 12, "TASK_03": 11,
            "TASK_04": 12, "TASK_05": 11, "TASK_06": 11,
        })
        for task in self.course.tasks[:6]:
            for step in task.steps:
                self.assertTrue(step.student_instruction)
                self.assertTrue(step.why_it_matters)
                self.assertTrue(step.expected_action)
                self.assertTrue(step.completion_type)
                self.assertTrue(step.ai_guidance)
                self.assertTrue(step.fallback_guidance)

    def test_high_risk_bindings_and_vision_boundaries(self):
        task2 = self.tasks["TASK_02"]
        self.assertIn("REM_MOTOR_TEST_NO_PROP", task2.steps[1].safety_reminders)
        self.assertTrue(task2.steps[4].teacher_gate)
        task3 = self.tasks["TASK_03"]
        self.assertIn("REM_MOTOR_SCREW_TOO_LONG", task3.steps[6].safety_reminders)
        task4 = self.tasks["TASK_04"]
        self.assertIn("REM_HEATSHRINK_BEFORE_SOLDER", task4.steps[2].safety_reminders)
        self.assertIn("REM_CHECK_POWER_POLARITY", task4.steps[3].safety_reminders)
        self.assertTrue(task4.steps[5].teacher_gate)
        self.assertTrue(task4.steps[8].teacher_gate)
        self.assertTrue(all(step.vision_task is None for step in task4.steps))
        self.assertEqual(self.tasks["TASK_05"].steps[1].vision_task, "pixhawk_orientation_assist")
        self.assertTrue(self.tasks["TASK_06"].steps[9].teacher_gate)

    def test_evidence_rules_are_task_scoped_and_task07_to_12_remain_formal(self):
        self.assertEqual(self.tasks["TASK_01"].evidence_requirements, ("PHOTO",))
        self.assertIn("TEACHER_REVIEW", self.tasks["TASK_02"].evidence_requirements)
        self.assertIn("CHECKLIST", self.tasks["TASK_06"].evidence_requirements)
        self.assertEqual(self.tasks["TASK_07"].title, "Mission Planner 完整调参")
        self.assertEqual(self.tasks["TASK_08"].title, "调参后功能验证")
        self.assertEqual(self.tasks["TASK_09"].title, "QGC 综合联调与模拟任务演练")
        self.assertEqual(self.tasks["TASK_12"].integration_entry, "EXISTING_FLIGHT_HEALTH")


if __name__ == "__main__":
    unittest.main()
