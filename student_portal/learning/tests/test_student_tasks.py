import tempfile
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from learning.models import Cohort, Evidence, StudentProfile, StudentTaskProgress, TaskDefinition, TeacherCohortAccess


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class StudentTaskWorkflowTests(TestCase):
    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="2026-01", name="2026 第一梯")
        self.user = get_user_model().objects.create_user(
            username="2026-01-S01", email="s01@example.com", password="A-strong-passphrase-984!", is_active=True
        )
        self.student = StudentProfile.objects.create(
            student_id="2026-01-S01", cohort=self.cohort, legal_name="張小雅", display_name="張某雅", user=self.user
        )
        self.t03 = TaskDefinition.objects.create(
            task_id="T03", sort_order=3, stage=TaskDefinition.Stage.PRACTICE, title="模擬器練習"
        )
        self.t04 = TaskDefinition.objects.create(
            task_id="T04", sort_order=4, stage=TaskDefinition.Stage.PRACTICE, title="真機基礎練習"
        )
        self.client.force_login(self.user)

    def test_student_dashboard_uses_masked_display_name(self):
        response = self.client.get(reverse("learning:student_dashboard"))

        self.assertContains(response, "張某雅")
        self.assertNotContains(response, "張小雅")
        self.assertEqual(
            [phase.phase for phase in response.context["phases"]],
            [phase for phase, _ in TaskDefinition.Stage.choices],
        )

    def test_t04_can_be_opened_and_progressed_when_t03_is_not_complete(self):
        response = self.client.get(reverse("learning:task_detail", args=["T04"]))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "真機基礎練習")

        response = self.client.post(
            reverse("learning:task_detail", args=["T04"]),
            {"status": StudentTaskProgress.Status.IN_PROGRESS, "student_note": "已開始練習"},
        )

        self.assertEqual(response.status_code, 302)
        t04 = StudentTaskProgress.objects.get(student=self.student, task=self.t04)
        self.assertEqual(t04.status, StudentTaskProgress.Status.IN_PROGRESS)
        self.assertEqual(t04.student_note, "已開始練習")
        self.assertFalse(StudentTaskProgress.objects.filter(student=self.student, task=self.t03).exists())

    def test_student_cannot_access_another_students_task_evidence(self):
        other_user = get_user_model().objects.create_user(
            username="2026-01-S02", email="s02@example.com", password="A-strong-passphrase-984!", is_active=True
        )
        other = StudentProfile.objects.create(
            student_id="2026-01-S02", cohort=self.cohort, legal_name="李小華", display_name="李某華", user=other_user
        )
        progress = StudentTaskProgress.objects.create(student=other, task=self.t04)

        with tempfile.TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=Path(media_dir)):
            self.client.force_login(other_user)
            upload = SimpleUploadedFile("proof.png", b"small-test-image", content_type="image/png")
            response = self.client.post(
                reverse("learning:evidence_add", args=["T04"]),
                {"evidence_type": Evidence.Type.IMAGE, "upload": upload, "description": "證據"},
            )
            self.assertEqual(response.status_code, 302)
            evidence = Evidence.objects.get(progress=progress)

            self.client.force_login(other_user)
            owner_response = self.client.get(reverse("learning:evidence_download", args=[str(evidence.pk)]))
            self.assertEqual(owner_response.status_code, 200)
            owner_response.close()

            assigned_teacher = get_user_model().objects.create_user(
                username="assigned-teacher", email="assigned@example.com", password="A-teacher-passphrase-984!", is_staff=True
            )
            TeacherCohortAccess.objects.create(teacher=assigned_teacher, cohort=self.cohort)
            self.client.force_login(assigned_teacher)
            teacher_response = self.client.get(reverse("learning:evidence_download", args=[str(evidence.pk)]))
            self.assertEqual(teacher_response.status_code, 200)
            teacher_response.close()

            unassigned_teacher = get_user_model().objects.create_user(
                username="unassigned-teacher", email="unassigned@example.com", password="A-teacher-passphrase-985!", is_staff=True
            )
            self.client.force_login(unassigned_teacher)
            unassigned_response = self.client.get(reverse("learning:evidence_download", args=[str(evidence.pk)]))
            self.assertEqual(unassigned_response.status_code, 404)

            self.client.force_login(self.user)
            response = self.client.get(reverse("learning:evidence_download", args=[str(evidence.pk)]))

        self.assertEqual(response.status_code, 404)

    def test_task_progress_requires_evidence_before_submission_when_configured(self):
        self.t04.evidence_required = ["圖片"]
        self.t04.save(update_fields=["evidence_required"])

        response = self.client.post(
            reverse("learning:task_detail", args=["T04"]),
            {"status": StudentTaskProgress.Status.SUBMITTED, "student_note": "已完成"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "至少一項證據")
        progress = StudentTaskProgress.objects.get(student=self.student, task=self.t04)
        self.assertEqual(progress.status, StudentTaskProgress.Status.NOT_STARTED)

    def test_student_cannot_withdraw_submitted_task_from_review_queue(self):
        progress = StudentTaskProgress.objects.create(
            student=self.student, task=self.t04, status=StudentTaskProgress.Status.SUBMITTED
        )

        response = self.client.post(
            reverse("learning:task_detail", args=["T04"]),
            {"status": StudentTaskProgress.Status.IN_PROGRESS, "student_note": "撤回提交"},
        )

        self.assertEqual(response.status_code, 200)
        progress.refresh_from_db()
        self.assertEqual(progress.status, StudentTaskProgress.Status.SUBMITTED)
        self.assertEqual(progress.student_note, "")

        response = self.client.post(
            reverse("learning:task_detail", args=["T04"]),
            {"status": StudentTaskProgress.Status.SUBMITTED, "student_note": "補充說明"},
        )

        self.assertEqual(response.status_code, 302)
        progress.refresh_from_db()
        self.assertEqual(progress.status, StudentTaskProgress.Status.SUBMITTED)
        self.assertEqual(progress.student_note, "補充說明")

    def test_reviewed_task_is_read_only_and_rejects_new_evidence(self):
        progress = StudentTaskProgress.objects.create(
            student=self.student,
            task=self.t04,
            status=StudentTaskProgress.Status.REVIEWED,
            student_note="送審說明",
        )

        detail = self.client.get(reverse("learning:task_detail", args=["T04"]))

        self.assertEqual(detail.status_code, 200)
        self.assertIsNone(detail.context["form"])
        self.assertContains(detail, "送審說明")
        self.assertNotContains(detail, "保存任務狀態")
        self.assertNotContains(detail, reverse("learning:evidence_add", args=["T04"]))

        response = self.client.post(
            reverse("learning:task_detail", args=["T04"]),
            {"status": StudentTaskProgress.Status.IN_PROGRESS, "student_note": "覆寫內容"},
        )

        self.assertEqual(response.status_code, 302)
        progress.refresh_from_db()
        self.assertEqual(progress.status, StudentTaskProgress.Status.REVIEWED)
        self.assertEqual(progress.student_note, "送審說明")

        response = self.client.post(
            reverse("learning:evidence_add", args=["T04"]),
            {
                "evidence_type": Evidence.Type.GITHUB,
                "external_url": "https://github.com/example/late-proof",
                "description": "覆核後證據",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.assertFalse(progress.evidence.exists())
