"""2026-11-14：T13 FPV 穿越機接線實訓任務卡——學員開卡、上傳接線圖 PNG、授權教師可下載。"""

import io
import tempfile
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from PIL import Image

from learning.models import Cohort, Evidence, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student


def png_bytes():
    buffer = io.BytesIO()
    Image.new("RGB", (32, 20), color="navy").save(buffer, format="PNG")
    return buffer.getvalue()


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class T13FpvTaskTests(TestCase):
    def setUp(self):
        call_command("seed_tasks", verbosity=0)
        self.cohort = Cohort.objects.create(cohort_id="2099-FPV", name="FPV 接線班")
        self.student = create_student_account("fpv@example.test", "接線學員")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.teacher = get_user_model().objects.create_user(username="fpv-teacher", password="not-used", is_staff=True)
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)

    def test_student_opens_m13_and_uploads_png_teacher_can_download(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.student.user)
        page = client.get(reverse("learning:task_detail", args=[self.enrollment.pk, "T13"]))
        self.assertEqual(page.status_code, 200)
        self.assertContains(page, "FPV 穿越機接線實訓")
        self.assertContains(page, "M13")
        self.assertContains(page, "FPV 接線圖 PNG")
        with tempfile.TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=Path(media_dir)):
            response = client.post(
                reverse("learning:evidence_add", args=[self.enrollment.pk, "T13"]),
                {"evidence_type": Evidence.Type.IMAGE, "description": "FC→ESC 訊號、VTX 供電",
                 "upload": SimpleUploadedFile("fpv-wiring.png", png_bytes(), content_type="image/png")},
                HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
                HTTP_ORIGIN="http://testserver",
            )
            self.assertEqual(response.status_code, 302, response.content[:300])
            evidence = Evidence.objects.get(progress__enrollment=self.enrollment, progress__task_id="T13")
            self.assertTrue(Path(evidence.upload.path).is_file())
            teacher = Client()
            teacher.force_login(self.teacher)
            download = teacher.get(reverse("learning:evidence_download", args=[str(evidence.pk)]))
            self.assertEqual(download.status_code, 200)
            self.assertTrue(b"".join(download.streaming_content).startswith(b"\x89PNG"))   # 下載回來的是 PNG
            download.close()   # Windows：先關檔，暫存資料夾才刪得掉
