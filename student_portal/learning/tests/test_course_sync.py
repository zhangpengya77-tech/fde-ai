import json
from pathlib import Path

from django.core.management import call_command
from django.test import TestCase

from learning.models import Cohort, GrowthRecordDefinition, StudentTaskProgress, TaskDefinition
from learning.tests.helpers import create_student_account, enroll_student


class CourseDefinitionSyncTests(TestCase):
    def setUp(self):
        self.profile = create_student_account("sync@example.com", "Sync Student")
        self.cohort = Cohort.objects.create(cohort_id="2026-11", name="同步測試班")
        self.enrollment = enroll_student(self.profile, self.cohort)

    def test_sync_updates_definitions_without_deleting_progress_or_evidence(self):
        call_command("seed_tasks", verbosity=0)
        self.enrollment.project_direction = "uav_3d_mapping"
        self.enrollment.save(update_fields=["project_direction"])
        progress = StudentTaskProgress.objects.create(
            enrollment=self.enrollment,
            task=TaskDefinition.objects.get(task_id="T01"),
            status=StudentTaskProgress.Status.IN_PROGRESS,
            student_note="保留這筆進度",
        )
        task_config = json.loads(Path("learning/data/tasks_v1.json").read_text(encoding="utf-8"))
        growth_config = json.loads(Path("learning/data/growth_records_v1.json").read_text(encoding="utf-8"))
        TaskDefinition.objects.filter(task_id="T01").update(title="舊版任務標題")
        GrowthRecordDefinition.objects.create(
            cohort=self.cohort,
            slot_id="R07",
            title="本組專業成長記錄",
            description="舊版",
            display_order=7,
        )

        call_command("sync_course_definitions", verbosity=0)

        self.assertEqual(TaskDefinition.objects.get(task_id="T01").title, task_config[0]["title"])
        default_r07 = GrowthRecordDefinition.objects.get(cohort=self.cohort, slot_id="R07", group_scope=None)
        self.assertEqual(default_r07.title, growth_config[6]["title"])
        self.assertTrue(StudentTaskProgress.objects.filter(pk=progress.pk).exists())
        self.assertEqual(StudentTaskProgress.objects.get(pk=progress.pk).student_note, "保留這筆進度")

    def test_sync_is_idempotent_and_keeps_stable_ids(self):
        call_command("sync_course_definitions", verbosity=0)
        first_task_count = TaskDefinition.objects.count()
        first_growth_count = GrowthRecordDefinition.objects.filter(cohort=self.cohort).count()
        call_command("sync_course_definitions", verbosity=0)
        self.assertEqual(TaskDefinition.objects.count(), first_task_count)
        self.assertEqual(GrowthRecordDefinition.objects.filter(cohort=self.cohort).count(), first_growth_count)
        self.assertEqual(list(TaskDefinition.objects.values_list("task_id", flat=True)), [f"T{i:02d}" for i in range(1, 13)])
