"""Claude（Anthropic）通用大模型供應者：選用規則、請求格式、錯誤處理（2026-11-04）。不連網。"""
import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest import mock

import anthropic
import httpx

from app.providers.provider_anthropic import DEFAULT_MODEL, AnthropicTextProvider
from app.providers.provider_manager import GeneralAIProviderManager
from app.providers.provider_openai import OpenAITextProvider


def _png_bytes():
    """產生一張小圖，測試鏡頭畫面壓縮與上傳。"""
    from io import BytesIO
    from PIL import Image
    buffer = BytesIO()
    Image.new("RGB", (64, 48), (200, 50, 50)).save(buffer, format="PNG")
    return buffer.getvalue()


class FakeMessages:
    """模擬 client.beta.messages.create，記錄送出的參數。"""

    def __init__(self, response=None, error=None):
        self.calls = []
        self.response = response
        self.error = error

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.response


def fake_client(messages):
    return SimpleNamespace(beta=SimpleNamespace(messages=messages))


def answer(text, stop_reason="end_turn"):
    return SimpleNamespace(
        stop_reason=stop_reason,
        content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=text)],
        usage=SimpleNamespace(input_tokens=120, output_tokens=40),
    )


CONTEXT = {"session": {"session_id": "s1"}, "task": {"id": "TASK_03", "title": "電調接線"}, "step": {"step_id": "S2", "title": "接 M3"}}


class ManagerSelectionTests(unittest.TestCase):
    def test_prefers_anthropic_when_key_present(self):
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key", "OPENAI_API_KEY": "x", "FDE_GENERAL_MODEL": "gpt-5.6-luna"}, clear=False):
            manager = GeneralAIProviderManager.from_environment()
        self.assertIsInstance(manager.provider, AnthropicTextProvider)
        self.assertEqual(manager.provider.model, DEFAULT_MODEL, "GPT 模型名稱不得傳給 Claude")
        self.assertEqual(manager.health_status()["provider"], "anthropic")

    def test_explicit_openai_choice(self):
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key", "OPENAI_API_KEY": "x", "FDE_GENERAL_PROVIDER": "openai"}, clear=False):
            manager = GeneralAIProviderManager.from_environment()
        self.assertIsInstance(manager.provider, OpenAITextProvider)

    def test_disabled_without_keys(self):
        env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "FDE_GENERAL_PROVIDER")}
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertFalse(GeneralAIProviderManager.from_environment().enabled)


class AnthropicProviderTests(unittest.TestCase):
    def provider(self, messages):
        return AnthropicTextProvider("test-key", client=fake_client(messages))

    def test_text_answer_and_request_shape(self):
        messages = FakeMessages(answer("先把 M3 的電調三條線接上馬達，下一步檢查旋向。"))
        result = asyncio.run(self.provider(messages).generate(question="下一步呢？", **CONTEXT))
        self.assertEqual(result.answer, "先把 M3 的電調三條線接上馬達，下一步檢查旋向。")
        self.assertEqual(result.provider, "anthropic")
        call = messages.calls[0]
        self.assertEqual(call["model"], "claude-opus-5-5")
        self.assertEqual(call["output_config"], {"effort": "low"})
        self.assertEqual(call["fallbacks"], "default")
        self.assertIn("server-side-fallback-2026-07-01", call["betas"])
        self.assertNotIn("thinking", call, "Opus 5.5 不可停用思考，交給預設")
        self.assertIn("下一步呢？", call["messages"][0]["content"][0]["text"])

    def test_visual_sends_jpeg_image_block(self):
        messages = FakeMessages(answer("畫面中 M3 裝的是 CCW 槳，應該換成 CW。"))
        result = asyncio.run(self.provider(messages).generate_visual(question="幫我看這支槳", image_bytes=_png_bytes(), **CONTEXT))
        self.assertEqual(result.source, "AI_VISUAL_REFERENCE")
        image = messages.calls[0]["messages"][0]["content"][0]
        self.assertEqual(image["type"], "image")
        self.assertEqual(image["source"]["media_type"], "image/jpeg")
        self.assertTrue(image["source"]["data"])

    def test_refusal_is_not_shown(self):
        result = asyncio.run(self.provider(FakeMessages(answer("", stop_reason="refusal"))).generate(question="q", **CONTEXT))
        self.assertIsNone(result.answer)
        self.assertEqual(result.error, "provider_refusal")

    def test_invalid_key_reports_401(self):
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        error = anthropic.AuthenticationError("bad key", response=httpx.Response(401, request=request), body=None)
        result = asyncio.run(self.provider(FakeMessages(error=error)).generate(question="q", **CONTEXT))
        self.assertEqual(result.http_status, 401)
        self.assertEqual(result.error_type, "invalid_api_key")

    def test_bad_image_is_rejected_without_calling_api(self):
        messages = FakeMessages(answer("x"))
        result = asyncio.run(self.provider(messages).generate_visual(question="q", image_bytes=b"not-an-image", **CONTEXT))
        self.assertEqual(result.error, "invalid_image")
        self.assertEqual(messages.calls, [])


if __name__ == "__main__":
    unittest.main()


class CourseReferenceTests(unittest.TestCase):
    """2026-11-04：大模型回答前先附上知識庫教材段落；查不到或出錯時不影響回答。"""

    def service(self, rag_result=None, error=None):
        from app.coach_ask import LiveCoachAskService

        class FakeRag:
            async def query(self, question, request_id, version):
                if error:
                    raise error
                return rag_result

        return LiveCoachAskService(sessions=None, vision_adapter=None, rag_adapter=FakeRag(), general_ai_provider=None)

    def test_reference_is_appended(self):
        rag = SimpleNamespace(hit=True, explanation="羅盤校準：點選初始設定→必要硬體→指南針，開始校準並轉動飛控。", sources=[{"title": "Pixhawk 與飛控"}])
        question = asyncio.run(self.service(rag)._question_with_course_reference("羅盤怎麼校準？"))
        self.assertTrue(question.startswith("羅盤怎麼校準？"))
        self.assertIn("教材參考（Pixhawk 與飛控）", question)
        self.assertIn("必要硬體", question)

    def test_no_hit_or_error_keeps_question(self):
        miss = SimpleNamespace(hit=False, explanation=None, sources=None)
        self.assertEqual(asyncio.run(self.service(miss)._question_with_course_reference("下一步？")), "下一步？")
        self.assertEqual(asyncio.run(self.service(error=RuntimeError("down"))._question_with_course_reference("下一步？")), "下一步？")


class TeacherStyleFixTests(unittest.TestCase):
    """2026-11-04：斷行不再留下殘字、完整簡轉繁；大模型不可用時用原問題查知識庫。"""

    def test_long_sentence_has_no_tiny_fragment(self):
        from app.teacher_style import TeacherStyleLayer
        lines = TeacherStyleLayer._short_lines("請告訴我你看到的名稱、標示或目前卡住的地方，我會依照當前步驟一步一步說明")
        self.assertTrue(all(len(line) <= 35 for line in lines))
        self.assertTrue(all(len(line) >= 6 for line in lines), lines)
        self.assertEqual("".join(lines).replace("，", ""), "請告訴我你看到的名稱、標示或目前卡住的地方我會依照當前步驟一步一步說明")

    def test_full_simplified_to_traditional(self):
        from app.teacher_style import TeacherStyleLayer
        answer = TeacherStyleLayer().apply("根据常识补充：先断电再检查。", next_action="清空桌面并集中摆放零件，暂时不要组装")
        for simplified in ("并", "摆", "暂", "组装", "根据", "补充"):
            self.assertNotIn(simplified, answer)
        self.assertIn("擺放", answer)

    def test_fallback_queries_rag_with_raw_question(self):
        from app.coach_ask import LiveCoachAskService
        asked = []

        class FakeRag:
            async def query(self, question, request_id, version):
                asked.append(question)
                return SimpleNamespace(hit=True, explanation="羅盤校準：初始設定→必要硬體→指南針。", sources=None, status="online", source_type="rag")

        class FakeSessions:
            def training_state(self, sid):
                return {"task": {"id": "TASK_01", "order": 1, "title": "準備"}, "current_step": {"step_id": "S1", "title": "清點"}}

        service = LiveCoachAskService(sessions=FakeSessions(), vision_adapter=None, rag_adapter=FakeRag(), general_ai_provider=None)
        result = asyncio.run(service._answer_unstyled("s1", "Pixhawk 羅盤校準要怎麼做？"))
        self.assertTrue(asked[0].startswith("Pixhawk 羅盤校準要怎麼做？"))  # 問題在最前面，後面附步驟線索
        self.assertLess(len(asked[0]), 400)
        self.assertIn("指南針", result["answer"])
        self.assertEqual(result["answer_source"], "VERIFIED_KNOWLEDGE")


class CoachPropCheckTests(unittest.TestCase):
    """2026-11-04：AI 陪做問槳葉時用 V7 判讀；沒有大模型就直接回答哪一支錯。"""

    WRONG_M3 = {"final_result": "NG", "positions": {
        "M1": {"detected": "CCW", "expected": "CCW", "result": "PASS"},
        "M2": {"detected": "CCW", "expected": "CCW", "result": "PASS"},
        "M3": {"detected": "CCW", "expected": "CW", "result": "NG"},
        "M4": {"detected": "CW", "expected": "CW", "result": "PASS"}}}

    def service(self, checker, provider=None):
        from app.coach_ask import LiveCoachAskService

        class FakeSessions:
            def training_state(self, sid):
                return {"task": {"id": "TASK_08", "order": 8}, "current_step": {"step_id": "T08_PROP_VISION", "title": "槳葉檢查"}}

        class OfflineVision:
            async def detect(self, *args):
                from app.vision import VisionUnavailable
                raise VisionUnavailable("offline")

        class NoRag:
            async def query(self, *args):
                return SimpleNamespace(hit=False, explanation=None, sources=None, status="no_hit", source_type=None)

        return LiveCoachAskService(sessions=FakeSessions(), vision_adapter=OfflineVision(), rag_adapter=NoRag(), general_ai_provider=provider, prop_checker=checker)

    def frame(self):
        import base64 as b64
        return "data:image/png;base64," + b64.b64encode(_png_bytes()).decode()

    def test_wrong_prop_answer_without_llm(self):
        result = asyncio.run(self.service(lambda image: self.WRONG_M3)._answer_unstyled("s1", "幫我看槳葉裝對嗎？", self.frame()))
        self.assertEqual(result["answer_source"], "VISION_MODEL")
        self.assertIn("3 號槳（左前 M3）應該是 CW，但目前看到的是 CCW", result["answer"])

    def test_pass_answer(self):
        ok = {"final_result": "PASS", "positions": {m: {"result": "PASS", "detected": e, "expected": e} for m, e in (("M1", "CCW"), ("M2", "CCW"), ("M3", "CW"), ("M4", "CW"))}}
        result = asyncio.run(self.service(lambda image: ok)._answer_unstyled("s1", "這樣螺旋槳對嗎", self.frame()))
        self.assertIn("四支槳旋向都正確", result["answer"])

    def test_not_run_for_non_prop_or_safety_question(self):
        calls = []
        service = self.service(lambda image: calls.append(1) or self.WRONG_M3)
        asyncio.run(service._answer_unstyled("s1", "幫我看電調接線", self.frame()))
        asyncio.run(service._answer_unstyled("s1", "槳裝好了可以上電嗎", self.frame()))
        self.assertEqual(calls, [], "非槳葉問題與安全問題不跑 V7")

    def test_checker_error_falls_back(self):
        def broken(image):
            raise RuntimeError("model down")
        result = asyncio.run(self.service(broken)._answer_unstyled("s1", "幫我看槳葉", self.frame()))
        self.assertNotEqual(result["answer_source"], "VISION_MODEL")

    def test_v7_fact_is_given_to_llm(self):
        seen = {}

        class Provider:
            enabled = True

            async def generate_visual(self, **values):
                seen.update(values)
                return SimpleNamespace(answer="M3 要換成 CW 槳。", provider="anthropic", model="m", source="AI_VISUAL_REFERENCE", tokens={}, latency_ms=1.0)

        service = self.service(lambda image: self.WRONG_M3, provider=Provider())
        service.sessions.get = lambda sid: None
        service.sessions.training_progress = lambda sid: None
        service.sessions.coach_history = lambda sid: []
        service.sessions.record_knowledge_candidate = lambda *a, **k: None
        result = asyncio.run(service._answer_unstyled("s1", "幫我看槳葉裝對嗎？", self.frame()))
        self.assertIn("槳葉模型判讀結果", seen["question"])
        self.assertIn("M3", seen["question"])
        self.assertTrue(result["answer"].startswith("M3 要換成 CW 槳"))
        self.assertIn("教師現場確認", result["answer"])  # 槳葉屬安全項目
