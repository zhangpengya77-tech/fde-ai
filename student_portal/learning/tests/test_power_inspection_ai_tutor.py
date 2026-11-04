"""電力巡檢 AI 助教：判定說明、處理建議、LLM 解說與權限（2026-11-04）。"""

from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase
from django.urls import reverse

from learning.models import Cohort, PowerInspectionJob, PowerInspectionModel, PowerInspectionReview
from learning.tests.helpers import create_student_account, enroll_student


TIMELINE = [
    {"class": "bird_nest", "start_ms": 12000, "end_ms": 13500, "max_confidence": 0.81},
    {"class": "insulator_damage", "start_ms": 40000, "end_ms": 40000, "max_confidence": 0.66},
]


class PowerInspectionAiTutorTests(TestCase):
    def setUp(self):
        cache.clear()
        self.cohort = Cohort.objects.create(cohort_id="2099-PT", name="巡檢助教班")
        self.student = create_student_account("power-tutor@example.test", "巡檢學員")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.teacher = get_user_model().objects.create_user(username="pt-teacher", password="x", is_staff=True)
        self.model = PowerInspectionModel.objects.create(
            version="R7-TEST", imported_by=self.teacher, class_contract=["bird_nest", "foreign_object", "insulator_damage", "conductor_disconnection"],
        )
        self.job = PowerInspectionJob.objects.create(
            enrollment=self.enrollment, model=self.model, status=PowerInspectionJob.Status.COMPLETED,
            inference_mode=PowerInspectionJob.InferenceMode.REAL, anomaly_timeline=TIMELINE, result_json={"frame_count": 120},
        )
        self.url = reverse("learning:power_inspection_ai_tutor", args=[self.job.job_id])

    def _client(self, user):
        client = Client()
        client.force_login(user)
        return client

    def test_page_shows_button_and_answer_lists_anomalies_with_advice(self):
        page = self._client(self.student.user).get(reverse("learning:power_inspection_task", args=[self.enrollment.pk]))
        self.assertContains(page, "AI 助教解說")
        self.assertContains(page, self.url)
        with mock.patch("learning.power_tutor.call_llm", return_value="鳥巢可能造成跳電，請回報維護單位。") as llm:
            data = self._client(self.student.user).post(self.url).json()
            again = self._client(self.student.user).post(self.url).json()
        self.assertTrue(data["ok"])
        self.assertIn("發現 2 段疑似異常", data["verdict"])
        self.assertIn("12.0–13.5 秒 發現疑似鳥巢（信心 81%）", data["verdict"])
        self.assertIn("40.0 秒 發現疑似絕緣子損傷（信心 66%）", data["verdict"])
        self.assertIn("老師覆核為準", data["verdict"])
        self.assertIn("停電清除", data["advice"])
        self.assertIn("更近距離", data["advice"])
        self.assertIn("回報維護單位", data["speech_text"])
        self.assertTrue(data["llm_available"])
        self.assertEqual(again, data)
        llm.assert_called_once()
        evidence = llm.call_args.args[1]
        self.assertNotIn("video", str(evidence).lower())

    def test_no_anomaly_without_llm_key(self):
        self.job.anomaly_timeline = []
        self.job.save()
        with mock.patch.dict("os.environ", {"OPENAI_API_KEY": ""}):
            data = self._client(self.student.user).post(self.url).json()
        self.assertIn("未發現疑似異常，共分析 120 幀", data["verdict"])
        self.assertIn("正常情況下", data["advice"])
        self.assertFalse(data["llm_available"])

    def test_teacher_review_is_announced_and_refreshes_cache(self):
        with mock.patch("learning.power_tutor.call_llm", return_value=""):
            self._client(self.student.user).post(self.url)
            PowerInspectionReview.objects.create(job=self.job, reviewer=self.teacher, decision="CORRECT", score=90, note="")
            data = self._client(self.student.user).post(self.url).json()
        self.assertIn("老師已覆核", data["verdict"])
        self.assertIn("90 分", data["verdict"])

    def test_unfinished_job_and_other_students_are_rejected(self):
        other = create_student_account("power-other@example.test", "別班學員")
        enroll_student(other, self.cohort)
        self.assertEqual(self._client(other.user).post(self.url).status_code, 404)
        self.job.status = PowerInspectionJob.Status.PROCESSING
        self.job.save()
        self.assertEqual(self._client(self.student.user).post(self.url).status_code, 409)

    def test_mock_job_never_calls_llm(self):
        self.job.inference_mode = PowerInspectionJob.InferenceMode.MOCK
        self.job.save()
        with mock.patch("learning.power_tutor.call_llm") as llm:
            data = self._client(self.student.user).post(self.url).json()
        llm.assert_not_called()
        self.assertIn("模擬流程", data["verdict"])
