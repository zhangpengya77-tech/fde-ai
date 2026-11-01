"""學員圖片檢測紀錄與教師覆核：Live 以替身回應，只測 Django 閉環與權限。"""

import tempfile
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from learning.models import Cohort, TeacherCohortAccess, VisionInspectionRecord
from learning.tests.helpers import create_student_account, enroll_student

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64
INFERENCE = {
    "model_id": "ROTATION_V5_20261027", "model_version": "v5", "model_status": "TEACHING_TRIAL",
    "model_sha256": "a" * 64, "image_width": 100, "image_height": 50, "learning_event_id": "evt",
    "detections": [{"class": "CW", "confidence": 0.91, "bbox": [1, 2, 11, 22]}],
    "best_detection": {"class": "CW", "confidence": 0.91, "bbox": [1, 2, 11, 22]},
}


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class VisionInspectionRecordTests(TestCase):
    def setUp(self):
        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        overrider = override_settings(MEDIA_ROOT=media.name)
        overrider.enable()
        self.addCleanup(overrider.disable)
        self.cohort_a = Cohort.objects.create(cohort_id="2099-VA", name="A 班")
        self.cohort_b = Cohort.objects.create(cohort_id="2099-VB", name="B 班")
        self.student_a = create_student_account("vision-a@example.test", "學員 A")
        self.student_b = create_student_account("vision-b@example.test", "學員 B")
        self.enrollment_a = enroll_student(self.student_a, self.cohort_a)
        self.enrollment_b = enroll_student(self.student_b, self.cohort_b)
        self.teacher_a = get_user_model().objects.create_user(username="vision-t-a", password="test", is_staff=True)
        self.teacher_b = get_user_model().objects.create_user(username="vision-t-b", password="test", is_staff=True)
        TeacherCohortAccess.objects.create(teacher=self.teacher_a, cohort=self.cohort_a)
        TeacherCohortAccess.objects.create(teacher=self.teacher_b, cohort=self.cohort_b)

    def _client(self, user):
        client = Client()
        client.force_login(user)
        return client

    def _upload(self, name="prop.jpg", content=JPEG, result=INFERENCE, side_effect=None):
        client = self._client(self.student_a.user)
        url = reverse("learning:student_rotation_v5_scan", args=[self.enrollment_a.pk])
        with mock.patch("learning.views.vision_api.rotation_v5_student_infer", return_value=result, side_effect=side_effect):
            return client.post(url, {"photo": SimpleUploadedFile(name, content)})

    def _record(self):
        self.assertEqual(self._upload().status_code, 302)
        return VisionInspectionRecord.objects.get()

    def test_real_result_is_saved_with_model_version_and_boxes(self):
        record = self._record()
        self.assertEqual(record.best_class, "CW")
        self.assertEqual(record.model_version, "v5")
        self.assertEqual(record.review_status, VisionInspectionRecord.ReviewStatus.PENDING)
        page = self._client(self.student_a.user).get(
            reverse("learning:student_rotation_v5_scan", args=[self.enrollment_a.pk]), {"record": record.pk},
        )
        self.assertContains(page, 'viewBox="0 0 100 50"')
        self.assertContains(page, "CW 0.91")

    def test_inference_failure_stores_nothing(self):
        response = self._upload(side_effect=RuntimeError("vision_submission_unavailable"))
        self.assertEqual(response.status_code, 503)
        self.assertFalse(VisionInspectionRecord.objects.exists())

    def test_rejects_non_image_and_mismatched_suffix(self):
        self.assertEqual(self._upload(name="a.gif", content=b"GIF89a").status_code, 422)
        self.assertEqual(self._upload(name="a.png", content=JPEG).status_code, 422)
        self.assertFalse(VisionInspectionRecord.objects.exists())

    def test_png_accepted(self):
        self.assertEqual(self._upload(name="a.png", content=b"\x89PNG\r\n\x1a\n0000").status_code, 302)

    def test_image_visible_only_to_owner_and_cohort_teacher(self):
        url = reverse("learning:vision_inspection_image", args=[self._record().pk])
        self.assertEqual(self._client(self.student_a.user).get(url).status_code, 200)
        self.assertEqual(self._client(self.teacher_a).get(url).status_code, 200)
        self.assertEqual(self._client(self.student_b.user).get(url).status_code, 404)
        self.assertEqual(self._client(self.teacher_b).get(url).status_code, 404)

    def test_teacher_review_keeps_history_and_recycles_failures(self):
        record = self._record()
        url = reverse("learning:teacher_vision_inspection_detail", args=[record.pk])
        client = self._client(self.teacher_a)
        client.post(url, {"decision": "NG", "note": "方向錯"})
        record.refresh_from_db()
        self.assertTrue(record.failure_sample)
        client.post(url, {"decision": "PASS"})
        record.refresh_from_db()
        self.assertEqual(record.review_status, "PASS")
        self.assertFalse(record.failure_sample)
        self.assertEqual(record.review_events.count(), 2)
        self.assertEqual(record.reviewed_by, self.teacher_a)

    def test_other_cohort_teacher_cannot_review(self):
        record = self._record()
        url = reverse("learning:teacher_vision_inspection_detail", args=[record.pk])
        self.assertEqual(self._client(self.teacher_b).post(url, {"decision": "PASS"}).status_code, 404)
        self.assertIn(self._client(self.student_a.user).post(url, {"decision": "PASS"}).status_code, (302, 403))
        record.refresh_from_db()
        self.assertEqual(record.review_status, "PENDING")

    def test_invalid_decision_rejected(self):
        url = reverse("learning:teacher_vision_inspection_detail", args=[self._record().pk])
        self.assertEqual(self._client(self.teacher_a).post(url, {"decision": "PENDING"}).status_code, 422)

    def test_teacher_list_filters_and_scopes(self):
        self._record()
        url = reverse("learning:teacher_vision_inspections")
        self.assertContains(self._client(self.teacher_a).get(url), "學員 A")
        self.assertNotContains(self._client(self.teacher_b).get(url), "學員 A")
        self.assertNotContains(self._client(self.teacher_a).get(url, {"status": "PASS"}), "學員 A")

    def test_retry_of_same_image_keeps_one_pending_record(self):
        first = self._record()
        with mock.patch("learning.views.vision_api.rotation_v5_student_infer") as infer:
            response = self._client(self.student_a.user).post(
                reverse("learning:student_rotation_v5_scan", args=[self.enrollment_a.pk]),
                {"photo": SimpleUploadedFile("again.jpg", JPEG)},
            )
        self.assertEqual(response.status_code, 302)
        self.assertIn(str(first.pk), response["Location"])
        infer.assert_not_called()
        self.assertEqual(VisionInspectionRecord.objects.count(), 1)

    def test_concurrent_duplicate_save_returns_existing_record(self):
        from learning import views

        first = self._record()
        upload = SimpleUploadedFile("b.jpg", JPEG)
        with mock.patch("learning.views._pending_inspection_record", side_effect=[first]):
            saved = views._save_inspection_record(self.enrollment_a, first.task_type, upload, JPEG, INFERENCE)
        self.assertEqual(saved.pk, first.pk)
        self.assertEqual(VisionInspectionRecord.objects.count(), 1)

    def test_reviewed_image_can_be_inspected_again(self):
        record = self._record()
        self._client(self.teacher_a).post(
            reverse("learning:teacher_vision_inspection_detail", args=[record.pk]), {"decision": "RESUBMIT"},
        )
        self.assertEqual(self._upload().status_code, 302)
        self.assertEqual(VisionInspectionRecord.objects.count(), 2)
        record.refresh_from_db()
        self.assertEqual(record.review_status, "RESUBMIT")

    def test_real_timeout_shows_clear_message(self):
        response = self._upload(side_effect=RuntimeError("vision_api_rejected:503:rotation_inference_unavailable:sandbox_timeout"))
        self.assertEqual(response.status_code, 503)
        self.assertContains(response, "AI 檢測逾時或暫時無法使用", status_code=503)
        self.assertNotContains(response, "sandbox_timeout", status_code=503)
        self.assertFalse(VisionInspectionRecord.objects.exists())
