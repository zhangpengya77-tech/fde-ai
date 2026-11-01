"""R6-B「測｜AI 視覺檢測」兩入口契約測試。

2026-11-01 教師指令：正式檢測入口固定為
① F450 螺旋槳 CW/CCW 方向辨識、② 電力巡檢影片上傳與分析；
四面懸停保留於「歷史／擴充」區，不得佔用電力巡檢正式入口。
"""

import json
import tempfile
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from learning.models import PowerInspectionJob
from learning.tests.helpers import create_student_account, enroll_student

REPO_ROOT = Path(__file__).resolve().parents[3]


class PowerInspectionEntryContractTests(TestCase):
    """平台「測」模組的 DOM 與靜態資料契約。"""

    def setUp(self):
        self.page = (REPO_ROOT / "index.html").read_text(encoding="utf-8")

    def test_formal_entries_are_propeller_and_power_inspection(self):
        self.assertIn('id="propellerInput"', self.page)
        self.assertIn('id="powerInspectionInput"', self.page)
        self.assertIn('id="powerInspectionButton"', self.page)
        self.assertIn('id="powerInspectionResult"', self.page)
        self.assertIn("電力巡檢影片上傳與分析", self.page)

    def test_hover_is_moved_into_legacy_details_block(self):
        self.assertIn('class="inspection-legacy-panel"', self.page)
        self.assertIn('id="legacyAssessmentWorkflows"', self.page)
        self.assertIn('id="hoverInput"', self.page)
        # 懸停面板必須落在 <details> 區塊之後，不可搶在正式入口之前。
        legacy_index = self.page.index('class="inspection-legacy-panel"')
        hover_index = self.page.index('id="hoverInput"')
        power_index = self.page.index('id="powerInspectionInput"')
        self.assertLess(power_index, legacy_index)
        self.assertLess(legacy_index, hover_index)

    def test_workflow_data_keeps_two_formal_and_marks_hover_legacy(self):
        for name in ("platform.js", "platform-browser.js"):
            source = (REPO_ROOT / "src" / name).read_text(encoding="utf-8")
            self.assertIn("key: 'power-inspection'", source)
            self.assertIn("key: 'hover-scoring'", source)
            self.assertIn("legacy: true", source)
            self.assertIn("WAITING_FOR_REAL_MODEL", source)

    def test_platform_js_and_browser_js_stay_in_sync(self):
        """雙檔手工同步是本專案既有鐵律：assessmentWorkflows 區塊必須逐字一致。"""

        def block(name):
            source = (REPO_ROOT / "src" / name).read_text(encoding="utf-8")
            start = source.index("assessmentWorkflows = [")
            end = source.index("];", start)
            return source[start:end]

        self.assertEqual(block("platform.js"), block("platform-browser.js"))

    def test_app_js_uploads_to_django_power_inspection_endpoint(self):
        source = (REPO_ROOT / "src" / "app.js").read_text(encoding="utf-8")
        self.assertIn("/student/power-inspection/upload/", source)
        self.assertIn("WAITING_FOR_REAL_MODEL", source)
        self.assertIn("BLOCKED", source)


class PowerInspectionApiUploadTests(TestCase):
    """「測」模組 JSON 上傳端點的權限與誠實阻擋。"""

    def setUp(self):
        from learning.models import Cohort

        self.cohort = Cohort.objects.create(cohort_id="2099-PE", name="電力巡檢 E 班")
        self.student = create_student_account("power-e@example.test", "巡檢學員 E")
        self.enrollment = enroll_student(self.student, self.cohort)

    def test_get_reports_denial_before_the_video_is_sent(self):
        response = self.client.get(reverse("learning:power_inspection_api_upload"))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["csrf_token"])
        self.assertEqual(response.json()["denied"]["code"], "login_required")

    def _mp4(self):
        return SimpleUploadedFile(
            "tower.mp4", b"\x00\x00\x00\x18ftypisompayload", content_type="video/mp4"
        )

    def test_anonymous_upload_is_blocked_with_login_hint(self):
        client = Client()
        response = client.post(
            reverse("learning:power_inspection_api_upload"), {"video": self._mp4()}
        )
        self.assertEqual(response.status_code, 401)
        body = json.loads(response.content.decode("utf-8"))
        self.assertFalse(body["ok"])
        self.assertEqual(body["code"], "login_required")
        self.assertTrue(body["login_url"])

    def test_student_upload_without_real_model_is_blocked_not_faked(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.student.user)
        client.get(reverse("learning:power_inspection_api_upload"))
        with tempfile.TemporaryDirectory() as media, override_settings(MEDIA_ROOT=Path(media)):
            response = client.post(
                reverse("learning:power_inspection_api_upload"),
                {"video": self._mp4()},
                HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
                HTTP_ORIGIN="http://testserver",
            )
            self.assertEqual(response.status_code, 201)
            body = json.loads(response.content.decode("utf-8"))
            self.assertTrue(body["ok"])
            self.assertEqual(body["status"], "WAITING_FOR_REAL_MODEL")
            self.assertEqual(body["inference_mode"], "BLOCKED")
            job = PowerInspectionJob.objects.get()
            self.assertEqual(job.enrollment_id, self.enrollment.pk)
            # 沒有真實模型時不得產生任何異常結果或推論輸出。
            self.assertEqual(job.anomaly_timeline, [])
            self.assertEqual(job.result_json, {})
            self.assertEqual(job.anomaly_frames.count(), 0)
            self.assertEqual(job.processed_at, None)

    def test_student_entry_redirects_to_unique_enrollment_task(self):
        client = Client()
        client.force_login(self.student.user)
        response = client.get(reverse("learning:power_inspection_entry"))
        self.assertRedirects(
            response,
            reverse("learning:power_inspection_task", args=[self.enrollment.pk]),
        )
