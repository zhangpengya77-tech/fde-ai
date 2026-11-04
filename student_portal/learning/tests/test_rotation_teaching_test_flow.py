"""V1.0 教學測試版閉環：學員上傳 → TEST 模型候選結果 → 教師覆核 → 正式紀錄（2026-11-03）。

Live 以替身回應；只驗證 Django 端保存、顯示與「未經教師確認不產生正式通過」。
"""

import tempfile
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from learning.models import Cohort, TeacherCohortAccess, VisionInspectionRecord
from learning.tests.helpers import create_student_account, enroll_student

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64


def _inference(candidate, reason_code, *, official=False):
    return {
        "model_id": "ROTATION_V6_TEST_20261103", "model_version": "v6_final_all_20261103_204027",
        "model_status": "TEST", "release_stage": "TEST", "notice": "測試結果，待教師確認",
        "model_sha256": "f" * 64, "image_width": 400, "image_height": 400, "learning_event_id": "evt",
        "detections": [{"class": "CW", "confidence": 0.82, "bbox": [90, 90, 110, 110]}],
        "best_detection": {"class": "CW", "confidence": 0.82, "bbox": [90, 90, 110, 110]},
        "rule_evaluation": {
            "rule_version": "PROP_ROTATION_TEST_RULE_v1", "candidate": candidate, "reason_code": reason_code,
            "reason": "測試", "motors": {"M3": {"position": "左前", "expected": "CW", "detected": "CW", "confidence": 0.82}},
            "confidence_threshold": 0.5, "notice": "測試結果，待教師確認", "is_official": official,
        },
    }


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class RotationTeachingTestFlowTests(TestCase):
    def setUp(self):
        media = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(media.cleanup)
        overrider = override_settings(MEDIA_ROOT=media.name)
        overrider.enable()
        self.addCleanup(overrider.disable)
        self.cohort = Cohort.objects.create(cohort_id="2099-TT", name="測試班")
        self.student = create_student_account("tt-student@example.test", "學員 T")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.teacher = get_user_model().objects.create_user(username="tt-teacher", password="test", is_staff=True)
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)

    def _client(self, user):
        client = Client()
        client.force_login(user)
        return client

    def _upload(self, result):
        url = reverse("learning:student_rotation_v5_scan", args=[self.enrollment.pk])
        with mock.patch("learning.views.vision_api.rotation_v5_student_infer", return_value=result):
            response = self._client(self.student.user).post(url, {"photo": SimpleUploadedFile("prop.jpg", JPEG)})
        self.assertEqual(response.status_code, 302)
        return VisionInspectionRecord.objects.latest("created_at")

    def test_pass_candidate_stays_pending_until_teacher_confirms(self):
        record = self._upload(_inference("PASS", "OK"))
        self.assertEqual(record.release_stage, "TEST")
        self.assertEqual(record.ai_candidate, "PASS")
        # AI 候選 PASS 不是正式結果：覆核狀態仍為待教師覆核。
        self.assertEqual(record.review_status, VisionInspectionRecord.ReviewStatus.PENDING)
        page = self._client(self.student.user).get(
            reverse("learning:student_rotation_v5_scan", args=[self.enrollment.pk]), {"record": record.pk},
        )
        self.assertContains(page, "TEST 教學測試版")
        self.assertContains(page, "測試結果，待教師確認")
        self.assertContains(page, "v6_final_all_20261103_204027")
        self.assertContains(page, "AI 候選結果：<strong>PASS</strong>")

        detail = reverse("learning:teacher_vision_inspection_detail", args=[record.pk])
        self.assertContains(self._client(self.teacher).get(detail), "AI 候選結果：<strong>PASS</strong>")
        self._client(self.teacher).post(detail, {"decision": "PASS", "note": "教師確認"})
        record.refresh_from_db()
        self.assertEqual(record.review_status, "PASS")
        self.assertEqual(record.review_events.count(), 1)

    def test_candidate_is_never_saved_as_official_even_if_upstream_says_so(self):
        record = self._upload(_inference("PASS", "OK", official=True))
        self.assertFalse(record.rule_evaluation["is_official"])

    def test_unknown_and_error_candidates_are_shown_and_reviewable(self):
        for candidate, code in (("UNKNOWN", "POSITION_AMBIGUOUS"), ("UNKNOWN", "LOW_CONFIDENCE"), ("ERROR", "ROTATION_REVERSED")):
            record = self._upload(_inference(candidate, code))
            self.assertEqual(record.ai_candidate, candidate)
            self.assertEqual(record.review_status, VisionInspectionRecord.ReviewStatus.PENDING)
        record = VisionInspectionRecord.objects.filter(rule_evaluation__candidate="UNKNOWN").first()
        detail = reverse("learning:teacher_vision_inspection_detail", args=[record.pk])
        self.assertContains(self._client(self.teacher).get(detail), "無法自動判定")
        self._client(self.teacher).post(detail, {"decision": "NG", "note": "位置無法判定"})
        record.refresh_from_db()
        self.assertEqual(record.review_status, "NG")
        self.assertTrue(record.failure_sample)

    def test_wrong_prop_shows_motor_fix_steps_and_rag_answer(self):
        result = _inference("ERROR", "WRONG_PROP")
        result["rule_evaluation"].update(
            reason="M3（左前） 槳葉旋向裝錯，請依下方步驟更換。",
            motors={"M3": {"position": "左前", "expected": "CW", "detected": "CCW", "confidence": 0.82, "wrong": True}},
            wrong_props=[{"motor": "M3", "position": "左前", "detected": "CCW", "expected": "CW", "confidence": 0.82}],
            fix_steps=["關閉電源並拔下電池。", "M3（左前）目前是 CCW，拆下後換成 CW 正槳（順時針）。"],
        )
        rag = {"available": True, "question": "q", "answer": "CW 是順時針槳，要依馬達旋轉方向交叉安裝。",
               "sources": [{"title": "03_CW_CCW_槳葉與馬達.md", "ref": "Q1"}], "source_type": "rag"}
        with mock.patch("learning.views.rotation_guidance.ask_rotation_guidance", return_value=rag) as ask:
            record = self._upload(result)
        ask.assert_called_once()
        self.assertEqual(record.rule_evaluation["rag_guidance"]["sources"][0]["ref"], "Q1")
        self.assertEqual(record.review_status, VisionInspectionRecord.ReviewStatus.PENDING)
        page = self._client(self.student.user).get(
            reverse("learning:student_rotation_v5_scan", args=[self.enrollment.pk]), {"record": record.pk},
        )
        self.assertContains(page, "正確應為 <strong>CW</strong>")
        self.assertContains(page, "M3（左前）目前是 CCW，拆下後換成 CW 正槳（順時針）。")
        self.assertContains(page, "RAG 知識庫說明")
        self.assertContains(page, "03_CW_CCW_槳葉與馬達.md Q1")

    def test_rag_unavailable_still_saves_with_fixed_steps(self):
        result = _inference("ERROR", "WRONG_PROP")
        result["rule_evaluation"].update(
            wrong_props=[{"motor": "M1", "position": "右前", "detected": "CW", "expected": "CCW", "confidence": 0.7}],
            fix_steps=["M1（右前）目前是 CW，拆下後換成 CCW 反槳（逆時針）。"],
        )
        with override_settings(PUBLIC_RAG_UPSTREAM_URL="http://127.0.0.1:9"):
            record = self._upload(result)
        self.assertFalse(record.rule_evaluation["rag_guidance"]["available"])
        page = self._client(self.student.user).get(
            reverse("learning:student_rotation_v5_scan", args=[self.enrollment.pk]), {"record": record.pk},
        )
        self.assertContains(page, "知識庫暫時沒有對應說明")
        self.assertContains(page, "拆下後換成 CCW 反槳")

    def test_pass_candidate_does_not_query_rag(self):
        with mock.patch("learning.views.rotation_guidance.ask_rotation_guidance") as ask:
            self._upload(_inference("PASS", "OK"))
        ask.assert_not_called()

    def _wrong_m3_record(self):
        result = _inference("ERROR", "WRONG_PROP")
        result["rule_evaluation"].update(
            motors={"M3": {"position": "左前", "expected": "CW", "detected": "CCW", "confidence": 0.82, "wrong": True}},
            wrong_props=[{"motor": "M3", "position": "左前", "detected": "CCW", "expected": "CW", "confidence": 0.82}],
            fix_steps=["M3（左前）目前是 CCW，拆下後換成 CW 正槳（順時針）。"],
        )
        rag = {"available": True, "question": "q", "answer": "左前 M3 裝 CW 正槳。", "sources": [{"title": "11_F450_槳葉裝錯修正SOP.md", "ref": "Q2"}], "source_type": "rag"}
        with mock.patch("learning.views.rotation_guidance.ask_rotation_guidance", return_value=rag):
            return self._upload(result)

    def test_ai_tutor_answers_which_prop_failed_and_caches(self):
        record = self._wrong_m3_record()
        url = reverse("learning:student_rotation_ai_tutor", args=[self.enrollment.pk, record.pk])
        page = self._client(self.student.user).get(
            reverse("learning:student_rotation_v5_scan", args=[self.enrollment.pk]), {"record": record.pk},
        )
        self.assertContains(page, "AI 助教解說")
        self.assertContains(page, url)
        with mock.patch("learning.rotation_tutor.llm_explanation", return_value="裝錯會讓機身自旋，請換成 CW。") as llm:
            data = self._client(self.student.user).post(url).json()
            again = self._client(self.student.user).post(url).json()
        self.assertTrue(data["ok"])
        self.assertIn("3 號槳（左前 M3）應該是 CW，但目前檢測是 CCW", data["verdict"])
        self.assertIn("未通過檢驗", data["verdict"])
        self.assertIn("老師覆核為準", data["verdict"])
        self.assertEqual(data["rag"]["sources"][0]["ref"], "Q2")
        self.assertIn("裝錯會讓機身自旋", data["speech_text"])
        self.assertEqual(again["speech_text"], data["speech_text"])
        llm.assert_called_once()
        record.refresh_from_db()
        self.assertFalse(record.rule_evaluation["is_official"])
        self.assertEqual(record.review_status, VisionInspectionRecord.ReviewStatus.PENDING)

    def test_ai_tutor_without_llm_key_still_answers(self):
        record = self._wrong_m3_record()
        url = reverse("learning:student_rotation_ai_tutor", args=[self.enrollment.pk, record.pk])
        with mock.patch.dict("os.environ", {"OPENAI_API_KEY": ""}):
            data = self._client(self.student.user).post(url).json()
        self.assertFalse(data["llm_available"])
        self.assertIn("未通過", data["speech_text"])
        self.assertIn("左前 M3 裝 CW 正槳", data["speech_text"])

    def test_ai_tutor_reflects_teacher_review_and_blocks_other_students(self):
        record = self._upload(_inference("PASS", "OK"))
        detail = reverse("learning:teacher_vision_inspection_detail", args=[record.pk])
        self._client(self.teacher).post(detail, {"decision": "PASS", "note": "ok"})
        url = reverse("learning:student_rotation_ai_tutor", args=[self.enrollment.pk, record.pk])
        with mock.patch("learning.rotation_tutor.llm_explanation", return_value=""):
            data = self._client(self.student.user).post(url).json()
        self.assertIn("此次檢測通過", data["verdict"])
        self.assertIn("老師已覆核：通過", data["verdict"])
        other = create_student_account("tt-other@example.test", "學員 O")
        enroll_student(other, self.cohort)
        self.assertEqual(self._client(other.user).post(url).status_code, 404)

    def test_old_v5_record_without_candidate_still_renders(self):
        legacy = _inference("PASS", "OK")
        legacy.pop("rule_evaluation")
        legacy.pop("release_stage")
        record = self._upload(legacy)
        self.assertEqual(record.rule_evaluation, {})
        page = self._client(self.student.user).get(
            reverse("learning:student_rotation_v5_scan", args=[self.enrollment.pk]), {"record": record.pk},
        )
        self.assertNotContains(page, "AI 候選結果")
