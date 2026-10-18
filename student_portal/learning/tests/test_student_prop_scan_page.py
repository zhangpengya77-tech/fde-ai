"""學員手機端靜態圖片辨識頁面（PROP_DIRECTION_V1）HTTP 層驗收。

驗證重點（依 2026-10-10 教師指令）：
  1. 頁面可開啟，含圖片預覽區、四顆馬達選項、檢測框／類別／可信度顯示區。
  2. 含繁體中文 AI 解釋區與 TTS 語音播放按鈕。
  3. 未取得模型／無隔離推論環境時，明確顯示 BLOCKED 或 WAITING_FOR_MODEL。
  4. 絕不出現假檢測框、假可信度或假 PASS。
  5. 未登入不得存取。
"""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from learning import prop_scan
from learning.models import Cohort
from learning.tests.helpers import create_student_account, enroll_student


QUALIFIED_METRICS = {
    "precision": 0.9,
    "recall": 0.9,
    "map50": 0.9,
    "map50_95": 0.7,
    "per_class_metrics": {},
    "confusion_matrix": [],
    "error_count": 0,
    "low_confidence_count": 0,
}


class PropScanModelStatusTests(TestCase):
    def _active(self, path, **overrides):
        record = {
            "model_id": "PROP_REAL_v1",
            "model_type": "PROP_DIRECTION",
            "model_name": "best.pt",
            "version": "v1",
            "file_path": str(path),
            "class_names": ["CW_F", "CCW_F", "CW_B", "CCW_B"],
            "validation_status": "VALIDATED",
            "evaluation_status": "EVALUATED",
            "metrics": dict(QUALIFIED_METRICS),
            "status": "ACTIVE",
            "uploaded_by": "teacher-1",
            "notes": "teacher approved",
        }
        record.update(overrides)
        return record

    @patch("learning.vision_submission.list_models", return_value=[])
    def test_no_active_model_remains_waiting(self, _list_models):
        self.assertEqual(prop_scan.model_status()["status"], "WAITING_FOR_MODEL")

    def test_demo_fixture_is_blocked_even_when_marked_active(self):
        active = self._active(
            "D:/fixture/best.pt",
            model_name="FDE_R07_DEMO_TEST_ONLY_best.pt",
            uploaded_by="acceptance-teacher",
            notes="acceptance smoke fixture",
        )
        with patch("learning.prop_scan.Path.is_file", return_value=True), patch(
            "learning.vision_submission.list_models", return_value=[active]
        ):
            status = prop_scan.model_status()
        self.assertEqual(status["status"], "BLOCKED")
        self.assertIn("測試", status["reason"])

    def test_not_evaluated_active_model_is_blocked(self):
        active = self._active(
            "D:/models/best.pt", evaluation_status="NOT_EVALUATED", metrics={}
        )
        with patch("learning.prop_scan.Path.is_file", return_value=True), patch(
            "learning.vision_submission.list_models", return_value=[active]
        ):
            status = prop_scan.model_status()
        self.assertEqual(status["status"], "BLOCKED")
        self.assertIn("評估", status["reason"])

    def test_qualified_active_model_is_ready(self):
        with patch("learning.prop_scan.Path.is_file", return_value=True), patch(
            "learning.vision_submission.list_models",
            return_value=[self._active("D:/models/best.pt")],
        ):
            status = prop_scan.model_status()
        self.assertEqual(status["status"], "READY")
        self.assertEqual(status["model_id"], "PROP_REAL_v1")

    @override_settings(VISION_DEMO_SIMULATION_ENABLED=True)
    @patch("learning.vision_submission.prop_check_status")
    @patch("learning.vision_submission.list_models", return_value=[])
    def test_demo_approved_r07_submission_is_ready_only_in_demo(self, _models, demo_status):
        demo_status.return_value = {
            "status": "DEMO_REVIEW_APPROVED",
            "simulation_mode": True,
            "model_id": "DEMO_R07_sub-1",
            "submission_id": "sub-1",
            "model_version": "R07-DEMO",
        }

        status = prop_scan.model_status()

        self.assertEqual(status["status"], "READY")
        self.assertTrue(status["simulation_mode"])
        self.assertEqual(status["model_id"], "DEMO_R07_sub-1")


class StudentPropScanTests(TestCase):
    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="SCAN-A", name="辨識測試班")
        self.student = create_student_account("scan-a@example.test", "辨識學員")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.user = self.student.user
        self.url = reverse("learning:student_prop_scan", args=[self.enrollment.pk])

    def test_requires_login(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 302)
        self.assertIn("/login/", response["Location"])

    def test_page_opens_with_required_headings(self):
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        for label in ("槳葉方向與正反面辨識", "上傳照片", "已確認的安裝規則"):
            self.assertContains(response, label)

    def test_page_has_motor_options_m1_to_m4(self):
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        for motor in ("M1", "M2", "M3", "M4"):
            self.assertContains(response, 'name="motor_{}"'.format(motor))

    def test_page_has_detection_result_area(self):
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        self.assertContains(response, "辨識框")
        self.assertContains(response, "判定結果")

    def test_page_shows_blocked_or_waiting_state(self):
        """無隔離推論環境 → BLOCKED；有 Runner 但無模型 → WAITING_FOR_MODEL。"""
        self.client.force_login(self.user)
        body = self.client.get(self.url).content.decode("utf-8")
        self.assertTrue(
            "BLOCKED" in body or "WAITING_FOR_MODEL" in body,
            "頁面必須明確標示 BLOCKED 或 WAITING_FOR_MODEL",
        )

    def test_page_declares_no_fake_results(self):
        self.client.force_login(self.user)
        self.assertContains(
            self.client.get(self.url),
            "本頁不會顯示模擬的檢測框、可信度或 PASS 結果",
        )

    def test_submit_button_is_disabled_when_cannot_infer(self):
        """三.4：無模型／無隔離推論環境時，「開始辨識」按鈕必須停用（不得誘發假推論）。"""
        self.client.force_login(self.user)
        body = self.client.get(self.url).content.decode("utf-8")
        self.assertIn('id="scan-submit"', body)
        # 按鈕本身帶有 disabled，而非僅靠文字提示。
        self.assertRegex(body, r'id="scan-submit"[^>]*\bdisabled\b')
        self.assertIn("按鈕已停用", body)

    def test_page_includes_mobile_camera_capture_and_responsive_css(self):
        """三.6：手機頁面須支援相機擷取（capture=environment）與響應式佈局。"""
        self.client.force_login(self.user)
        body = self.client.get(self.url).content.decode("utf-8")
        self.assertIn('capture="environment"', body)
        self.assertIn("@media (max-width: 520px)", body)

    def test_submit_without_inference_never_produces_verdict(self):
        """閘門未開放時送出照片，不得產生 PASS 或 NG 判定。"""
        self.client.force_login(self.user)
        photo = SimpleUploadedFile("prop.jpg", b"\xff\xd8\xff\xe0demo-bytes", content_type="image/jpeg")
        response = self.client.post(self.url, {"photo": photo})
        self.assertEqual(response.status_code, 200)
        body = response.content.decode("utf-8")
        self.assertNotIn("PASS｜安裝正確", body)
        self.assertNotIn("NG｜安裝有誤", body)
        self.assertTrue(
            "BLOCKED" in body or "WAITING_FOR_MODEL" in body or "無法" in body,
            "必須明確回報無法推論",
        )

    def test_submit_rejects_non_image(self):
        self.client.force_login(self.user)
        bad = SimpleUploadedFile("prop.txt", b"not-an-image", content_type="text/plain")
        response = self.client.post(self.url, {"photo": bad})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "僅接受圖片檔案")

    def test_page_includes_tts_controls(self):
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        self.assertContains(response, "tts-play")
        self.assertContains(response, "語音朗讀結果")

    def test_rule_table_matches_confirmed_positions(self):
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        for text in ("右前", "左後", "左前", "右後"):
            self.assertContains(response, text)

    @patch("learning.views._prop_scan_gate")
    @patch("learning.views._run_prop_inference")
    def test_ready_model_posts_to_runner_and_renders_real_facts(self, inference, gate):
        """【模擬測試】本測試以 mock 提供推論結果，驗證視圖能正確呈現 BBOX／Class／
        Confidence／PASS 判定；不代表真實辨識 PASS（真實推論須由隔離 Runner 產生）。"""
        gate.return_value = {
            "can_infer": True,
            "state": "READY",
            "state_label": "可推論",
            "reason": "",
            "detail": "",
            "runner": {"available": True},
            "model": {"status": "READY"},
        }
        inference.return_value = {
            "detections": [
                {"class_name": "CCW_F", "confidence": 0.93, "box": [70, 10, 90, 30]},
                {"class_name": "CW_F", "confidence": 0.92, "box": [10, 10, 30, 30]},
                {"class_name": "CCW_F", "confidence": 0.91, "box": [10, 70, 30, 90]},
                {"class_name": "CW_F", "confidence": 0.90, "box": [70, 70, 90, 90]},
            ],
            "evaluation": {
                "status": "PASS",
                "checks": [
                    {"motor": motor, "position": position, "result": "PASS",
                     "detected_class": expected, "confidence": 0.9,
                     "expected_direction": expected.split("_")[0],
                     "expected_face": expected.split("_")[1],
                     "reason": "方向與槳面正確"}
                    for motor, position, expected in (
                        ("M1", "右前", "CCW_F"), ("M2", "左後", "CCW_F"),
                        ("M3", "左前", "CW_F"), ("M4", "右後", "CW_F"),
                    )
                ],
                "pass_count": 4,
                "ng_count": 0,
                "insufficient_count": 0,
            },
        }
        self.client.force_login(self.user)
        photo = SimpleUploadedFile("prop.png", b"\x89PNG\r\n\x1a\nmock", content_type="image/png")

        response = self.client.post(self.url, {"photo": photo})

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "CCW_F")
        self.assertContains(response, "0.93")
        self.assertContains(response, "PASS｜安裝正確")
        inference.assert_called_once()

    @patch("learning.views.vision_api.prop_check")
    def test_inference_adapter_uses_existing_prop_check_api(self, prop_check):
        """【模擬測試】驗證 _run_prop_inference 確實復用既有 POST /api/v1/vision/prop-check，
        並正確傳遞圖片與解析真實回傳結構（未接線到真實模型，避免假 PASS 冒充真實辨識）。"""
        prop_check.return_value = {
            "model": {"model_id": "PROP_REAL_v1", "model_version": "v1"},
            "detections": [
                {"class": "CCW_F", "confidence": 0.93, "bbox": [70, 10, 90, 30]},
            ],
            "positions": {
                "M1": {
                    "detected": "CCW_F", "expected": "CCW_F", "blade_face": "F",
                    "confidence": 0.93, "result": "PASS", "reason": "ok",
                },
            },
            "final_result": "INSUFFICIENT_DATA",
        }

        result = __import__("learning.views", fromlist=["_run_prop_inference"])._run_prop_inference(
            b"real-image-bytes", "prop.jpg"
        )

        self.assertEqual(result["detections"][0]["class_name"], "CCW_F")
        self.assertEqual(result["detections"][0]["box"], [70, 10, 90, 30])
        self.assertEqual(result["evaluation"]["status"], "INSUFFICIENT_DATA")
        prop_check.assert_called_once_with(
            image_bytes=b"real-image-bytes", input_reference="prop.jpg"
        )

    @patch("learning.views._prop_scan_gate")
    @patch("learning.views.vision_api.prop_check")
    def test_demo_adapter_result_is_clearly_labelled_and_explained_in_chinese(self, prop_check, gate):
        gate.return_value = {
            "can_infer": True,
            "state": "READY",
            "state_label": "DEMO 模擬推論",
            "reason": "",
            "detail": "",
            "runner": {"available": True},
            "model": {"status": "READY", "simulation_mode": True},
        }
        prop_check.return_value = {
            "status": "DEMO_SIMULATED",
            "simulation_mode": True,
            "result_label": "DEMO 模擬結果",
            "model": {
                "model_id": "DEMO_R07_sub-1",
                "model_version": "R07-DEMO",
                "submission_id": "sub-1",
            },
            "detections": [
                {"class": "CW_F", "confidence": 0.76, "bbox": [10, 10, 70, 70]},
            ],
            "positions": {},
            "final_result": "INSUFFICIENT_DATA",
        }
        self.client.force_login(self.user)
        photo = SimpleUploadedFile(
            "prop.png", b"\x89PNG\r\n\x1a\ndemo", content_type="image/png"
        )

        response = self.client.post(self.url, {"photo": photo})

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "DEMO 模擬結果")
        self.assertContains(response, "CW_F")
        self.assertContains(response, "0.76")
        self.assertContains(response, "AI 解釋（繁體中文）")
        self.assertContains(response, '<img src="data:image/png;base64,', html=False)


class TeacherImageTestPageTests(TestCase):
    def setUp(self):
        self.teacher = get_user_model().objects.create_user(
            username="scan-teacher@example.test",
            password="Teacher-pass-902!",
            is_staff=True,
        )

    def test_verify_route_requires_login(self):
        response = self.client.get("/teacher/vision-models/00000000-0000-0000-0000-000000000000/verify/")
        self.assertEqual(response.status_code, 302)
        self.assertIn("/login/", response["Location"])
