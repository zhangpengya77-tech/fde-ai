"""P3-D：既有普通作業 Evidence 的登入、擁有權與班級閉環。"""

import tempfile
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from learning.models import Cohort, Evidence, TaskDefinition, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class P3DCourseUploadClosureTests(TestCase):
    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="2099-P3D-A", name="P3-D A 班")
        self.other_cohort = Cohort.objects.create(cohort_id="2099-P3D-B", name="P3-D B 班")
        self.student = create_student_account("p3d-owner@example.test", "P3-D 學員 A")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.other_student = create_student_account("p3d-other@example.test", "P3-D 學員 B")
        self.other_enrollment = enroll_student(self.other_student, self.other_cohort)
        self.task = TaskDefinition.objects.create(task_id="T10", sort_order=10, stage="assess", title="P3-D 普通作業")
        self.teacher = get_user_model().objects.create_user(username="p3d-teacher", password="not-used", is_staff=True)
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.other_teacher = get_user_model().objects.create_user(username="p3d-other-teacher", password="not-used", is_staff=True)

    def _student_client(self, account):
        client = Client(enforce_csrf_checks=True)
        client.force_login(account.user)
        client.get(reverse("learning:task_detail", args=[self.enrollment.pk if account == self.student else self.other_enrollment.pk, self.task.task_id]))
        return client

    def test_upload_creates_owned_evidence_and_authorized_teacher_can_download(self):
        with tempfile.TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=Path(media_dir)):
            client = self._student_client(self.student)
            response = client.post(
                reverse("learning:evidence_add", args=[self.enrollment.pk, self.task.task_id]),
                {"evidence_type": Evidence.Type.FILE, "upload": SimpleUploadedFile("proof.pdf", b"p3d-pdf", content_type="application/pdf")},
                HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
                HTTP_ORIGIN="http://testserver",
            )
            self.assertEqual(response.status_code, 302)
            evidence = Evidence.objects.get(progress__enrollment=self.enrollment)
            self.assertTrue(Path(evidence.upload.path).is_file())
            teacher = Client(); teacher.force_login(self.teacher)
            download = teacher.get(reverse("learning:evidence_download", args=[str(evidence.pk)]))
            self.assertEqual(download.status_code, 200)
            self.assertEqual(b"".join(download.streaming_content), b"p3d-pdf")

    def test_cross_student_write_and_cross_cohort_teacher_read_are_rejected(self):
        with tempfile.TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=Path(media_dir)):
            owner = self._student_client(self.student)
            owner.post(reverse("learning:evidence_add", args=[self.enrollment.pk, self.task.task_id]), {"evidence_type": Evidence.Type.FILE, "upload": SimpleUploadedFile("proof.pdf", b"p3d-pdf")}, HTTP_X_CSRFTOKEN=owner.cookies["csrftoken"].value, HTTP_ORIGIN="http://testserver")
            evidence = Evidence.objects.get(progress__enrollment=self.enrollment)
            attacker = self._student_client(self.other_student)
            forged = attacker.post(reverse("learning:evidence_add", args=[self.enrollment.pk, self.task.task_id]), {"evidence_type": Evidence.Type.FILE, "upload": SimpleUploadedFile("forged.pdf", b"x")}, HTTP_X_CSRFTOKEN=attacker.cookies["csrftoken"].value, HTTP_ORIGIN="http://testserver")
            self.assertEqual(forged.status_code, 404)
            teacher = Client(); teacher.force_login(self.other_teacher)
            self.assertEqual(teacher.get(reverse("learning:evidence_download", args=[str(evidence.pk)])).status_code, 404)
