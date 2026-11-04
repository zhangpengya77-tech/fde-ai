"""鷹眼 AI 檢測頁 AI 助教：判定說明、知識庫、大模型解說、權限與輸入驗證（2026-11-04）。"""

import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase
from django.urls import reverse

from learning.models import Cohort
from learning.tests.helpers import create_student_account, enroll_student


def motors(**detected):
    """組成前台送出的 M1～M4 結果；未指定的槳依標準安裝。"""
    standard = {"M1": "CCW", "M2": "CCW", "M3": "CW", "M4": "CW"}
    standard.update(detected)
    return [{"motor": motor, "detected": value} for motor, value in standard.items()]


RAG_OK = {"available": True, "question": "q", "answer": "CW 正槳順時針，請換成正確的槳。", "sources": [{"title": "F450 SOP", "ref": "S1"}], "source_type": "rag"}


class EagleInspectionAiTutorTests(TestCase):
    def setUp(self):
        cache.clear()
        cohort = Cohort.objects.create(cohort_id="2099-EG", name="鷹眼助教班")
        self.student = create_student_account("eagle-tutor@example.test", "鷹眼學員")
        enroll_student(self.student, cohort)
        self.url = reverse("learning:eagle_inspection_ai_tutor")
        self.client = Client()
        self.client.force_login(self.student.user)  # create_student_account 回傳學員檔案，登入要用其帳號

    def post(self, payload, client=None):
        return (client or self.client).post(self.url, data=json.dumps(payload), content_type="application/json")

    def test_requires_login(self):
        response = self.post({"task": "f450_propeller_check", "motors": motors()}, client=Client())
        self.assertEqual(response.status_code, 401)

    @mock.patch("learning.inspection_tutor.rotation_guidance.ask_rotation_guidance", return_value=RAG_OK)
    @mock.patch("learning.inspection_tutor.rotation_tutor.llm_explanation", return_value="")
    def test_wrong_prop_verdict_and_rag(self, llm, rag):
        data = self.post({"task": "f450_propeller_check", "motors": motors(M3="CCW")}).json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["candidate"], "ERROR")
        self.assertIn("3 號槳（左前 M3）應該是 CW，但目前檢測是 CCW", data["verdict"])
        self.assertIn("未通過", data["verdict"])
        self.assertEqual(data["wrong_props"], [{"motor": "M3", "position": "左前", "expected": "CW", "detected": "CCW"}])
        self.assertIn("CW 正槳順時針", data["speech_text"])
        rag.assert_called_once()
        llm.assert_not_called()  # 自動回覆不呼叫大模型，要按按鈕才呼叫

    @mock.patch("learning.inspection_tutor.rotation_guidance.ask_rotation_guidance", return_value=RAG_OK)
    @mock.patch("learning.inspection_tutor.rotation_tutor.llm_explanation", return_value="M3 裝反會讓扭力不平衡。")
    def test_llm_only_when_requested(self, llm, _rag):
        data = self.post({"task": "f450_propeller_check", "motors": motors(M3="CCW"), "with_llm": True}).json()
        self.assertTrue(data["llm_available"])
        self.assertIn("扭力不平衡", data["speech_text"])
        llm.assert_called_once()

    @mock.patch("learning.inspection_tutor.rotation_guidance.ask_rotation_guidance")
    def test_pass_does_not_query_rag(self, rag):
        data = self.post({"task": "f450_propeller_check", "motors": motors()}).json()
        self.assertEqual(data["candidate"], "PASS")
        self.assertIn("此次檢測通過", data["verdict"])
        rag.assert_not_called()

    def test_incomplete_is_unknown(self):
        data = self.post({"task": "f450_propeller_check", "motors": motors(M2="")}).json()
        self.assertEqual(data["candidate"], "UNKNOWN")
        self.assertIn("無法自動判定", data["verdict"])

    def test_rejects_invalid_input(self):
        self.assertEqual(self.post({"task": "anything", "motors": motors()}).status_code, 400)
        self.assertEqual(self.post({"task": "f450_propeller_check", "motors": [{"motor": "M9", "detected": "CW"}]}).status_code, 400)
        self.assertEqual(self.post({"task": "f450_propeller_check", "motors": "x"}).status_code, 400)

    @mock.patch("learning.inspection_tutor.rotation_guidance.ask_rotation_guidance", return_value=RAG_OK)
    @mock.patch("learning.inspection_tutor.rotation_tutor.llm_explanation", return_value="解說")
    def test_llm_quota_per_user(self, llm, _rag):
        from learning import views
        with mock.patch.object(views, "EAGLE_TUTOR_LLM_LIMIT_PER_HOUR", 1):
            first = self.post({"task": "f450_propeller_check", "motors": motors(M1="CW"), "with_llm": True}).json()
            second = self.post({"task": "f450_propeller_check", "motors": motors(M4="CCW"), "with_llm": True}).json()
        self.assertTrue(first["llm_requested"])
        self.assertFalse(second["llm_requested"])  # 超過上限：仍回判定與知識庫，但不呼叫大模型
        self.assertEqual(llm.call_count, 1)

    def test_teacher_can_use(self):
        teacher = get_user_model().objects.create_user(username="eagle-teacher", password="x", is_staff=True)
        client = Client()
        client.force_login(teacher)
        self.assertEqual(self.post({"task": "f450_propeller_check", "motors": motors()}, client=client).status_code, 200)


class CompatLlmTests(TestCase):
    """2026-11-04：Django 端 AI 助教改用免費的通用相容服務（Gemini 等）。"""

    def test_gemini_key_uses_chat_completions(self):
        from learning import rotation_tutor
        seen = {}

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return json.dumps({"choices": [{"message": {"content": "M3 要換 CW 槳。"}}]}).encode("utf-8")

        def opener(request, timeout):
            seen["url"] = request.full_url
            seen["body"] = json.loads(request.data.decode("utf-8"))
            return FakeResponse()

        env = {"GEMINI_API_KEY": "g-key", "OPENAI_API_KEY": "old", "FDE_GENERAL_MODEL": "gpt-5.6-luna"}
        with mock.patch.dict("os.environ", env):
            answer = rotation_tutor.call_llm("說明", {"x": 1}, opener=opener)
        self.assertEqual(answer, "M3 要換 CW 槳。")
        self.assertTrue(seen["url"].endswith("/v1beta/openai/chat/completions"))
        self.assertEqual(seen["body"]["model"], "gemini-3.6-flash")
