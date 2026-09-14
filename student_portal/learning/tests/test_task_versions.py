from django.test import TestCase

from learning.models import Cohort, StudentTaskProgress, TaskDefinition, TaskDefinitionRevision
from learning.tests.helpers import create_student_account, enroll_student


class TaskDefinitionVersionTests(TestCase):
    def test_editing_task_creates_revision_and_existing_progress_keeps_its_task_version(self):
        cohort = Cohort.objects.create(cohort_id="2026-01", name="2026 第一梯")
        enrollment = enroll_student(create_student_account(), cohort)
        task = TaskDefinition.objects.create(
            task_id="T06", sort_order=6, stage=TaskDefinition.Stage.BUILD, title="舊版組裝要求"
        )
        progress = StudentTaskProgress.objects.create(enrollment=enrollment, task=task)

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
        enrollment = enroll_student(create_student_account("second@example.com", "Second"), cohort)
        task = TaskDefinition.objects.create(
            task_id="T06", sort_order=6, stage=TaskDefinition.Stage.BUILD, title="舊版組裝要求"
        )
        progress = StudentTaskProgress.objects.create(enrollment=enrollment, task=task)

        task.description = "教師補充安全檢查"
        task.save(update_fields=["description"])
        task.refresh_from_db()
        progress.refresh_from_db()

        self.assertEqual(task.version, 2)
        self.assertEqual(progress.task_content.description, "")
        self.assertTrue(TaskDefinitionRevision.objects.filter(task=task, version=1).exists())
