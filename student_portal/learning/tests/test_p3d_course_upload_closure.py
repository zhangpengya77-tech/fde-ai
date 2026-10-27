"""P3-D：既有普通作業 Evidence 的登入、擁有權與班級閉環。"""

import tempfile
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from learning.models import Cohort, Evidence, TaskDefinition, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student

# P3-H 第十三階段：Evidence.upload 對 .pdf 增加 %PDF- 檔頭檢查後，
# 本測試的夾具需改用帶真實檔頭的內容；測試目的（上傳閉環與授權）不變。
VALID_PDF = b"%PDF-1.7\n% P3-D fixture\n%%EOF\n"


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
                {"evidence_type": Evidence.Type.FILE, "upload": SimpleUploadedFile("proof.pdf", VALID_PDF, content_type="application/pdf")},
                HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
                HTTP_ORIGIN="http://testserver",
            )
            self.assertEqual(response.status_code, 302)
            evidence = Evidence.objects.get(progress__enrollment=self.enrollment)
            self.assertTrue(Path(evidence.upload.path).is_file())
            teacher = Client(); teacher.force_login(self.teacher)
            download = teacher.get(reverse("learning:evidence_download", args=[str(evidence.pk)]))
            self.assertEqual(download.status_code, 200)
            self.assertEqual(b"".join(download.streaming_content), VALID_PDF)

    def test_cross_student_write_and_cross_cohort_teacher_read_are_rejected(self):
        with tempfile.TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=Path(media_dir)):
            owner = self._student_client(self.student)
            owner.post(reverse("learning:evidence_add", args=[self.enrollment.pk, self.task.task_id]), {"evidence_type": Evidence.Type.FILE, "upload": SimpleUploadedFile("proof.pdf", VALID_PDF)}, HTTP_X_CSRFTOKEN=owner.cookies["csrftoken"].value, HTTP_ORIGIN="http://testserver")
            evidence = Evidence.objects.get(progress__enrollment=self.enrollment)
            attacker = self._student_client(self.other_student)
            forged = attacker.post(reverse("learning:evidence_add", args=[self.enrollment.pk, self.task.task_id]), {"evidence_type": Evidence.Type.FILE, "upload": SimpleUploadedFile("forged.pdf", b"x")}, HTTP_X_CSRFTOKEN=attacker.cookies["csrftoken"].value, HTTP_ORIGIN="http://testserver")
            self.assertEqual(forged.status_code, 404)
            teacher = Client(); teacher.force_login(self.other_teacher)
            self.assertEqual(teacher.get(reverse("learning:evidence_download", args=[str(evidence.pk)])).status_code, 404)


class EvidencePdfHeaderValidatorTests(TestCase):
    """P3-H 第十三階段：Evidence.upload 的 %PDF- 檔頭檢查與檔案指標還原。"""

    def _file(self, name, content):
        return SimpleUploadedFile(name, content, content_type="application/pdf")

    def test_valid_pdf_passes_and_file_pointer_is_restored(self):
        from learning.models import validate_pdf_header

        upload = self._file("report.pdf", VALID_PDF)
        upload.seek(0)
        validate_pdf_header(upload)
        self.assertEqual(upload.tell(), 0)
        self.assertEqual(upload.read(), VALID_PDF)

        upload.seek(2)
        validate_pdf_header(upload)
        self.assertEqual(upload.tell(), 2)

    def test_renamed_binary_is_rejected(self):
        from django.core.exceptions import ValidationError

        from learning.models import validate_pdf_header

        for payload in (b"MZ\x90\x00windows-binary", b"PK\x03\x04zip", b"<html></html>", b"\x89PNG\r\n\x1a\n"):
            with self.subTest(payload=payload):
                with self.assertRaises(ValidationError):
                    validate_pdf_header(self._file("payload.pdf", payload))

    def test_non_pdf_extension_is_not_inspected(self):
        from learning.models import validate_pdf_header

        validate_pdf_header(self._file("archive.zip", b"PK\x03\x04"))
        validate_pdf_header(self._file("notes.txt", b"plain text"))
