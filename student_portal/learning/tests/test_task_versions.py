from django.test import TestCase

from learning.models import Cohort, StudentProfile, StudentTaskProgress, TaskDefinition, TaskDefinitionRevision


class TaskDefinitionVersionTests(TestCase):
    def test_editing_task_creates_revision_and_existing_progress_keeps_its_task_version(self):
        cohort = Cohort.objects.create(cohort_id="2026-01", name="2026 第一梯")
        student = StudentProfile.objects.create(
            student_id="2026-01-S01", cohort=cohort, legal_name="張小雅", display_name="張某雅"
        )
        task = TaskDefinition.objects.create(
            task_id="T06", sort_order=6, stage=TaskDefinition.Stage.BUILD, title="舊版組裝要求"
        )
        progress = StudentTaskProgress.objects.create(student=student, task=task)

        task.title = "新版組裝要求"
        task.description = "增加安全檢查"
        task.save()
        progress.refresh_from_db()

        self.assertEqual(task.version, 2)
        self.assertEqual(progress.task_version_snapshot, 1)
        self.assertEqual(progress.task_content.title, "舊版組裝要求")
        revision = TaskDefinitionRevision.objects.get(task=task, version=1)
        self.assertEqual(revision.description, "")

    def test_partial_admin_save_persists_the_new_task_version(self):
        cohort = Cohort.objects.create(cohort_id="2026-02", name="2026 第二梯")
        student = StudentProfile.objects.create(
            student_id="2026-02-S01", cohort=cohort, legal_name="陳小安", display_name="陳某安"
        )
        task = TaskDefinition.objects.create(
            task_id="T06", sort_order=6, stage=TaskDefinition.Stage.BUILD, title="舊版組裝要求"
        )
        progress = StudentTaskProgress.objects.create(student=student, task=task)

        task.description = "教師補充安全檢查"
        task.save(update_fields=["description"])
        task.refresh_from_db()
        progress.refresh_from_db()

        self.assertEqual(task.version, 2)
        self.assertEqual(progress.task_content.description, "")
        self.assertTrue(TaskDefinitionRevision.objects.filter(task=task, version=1).exists())
