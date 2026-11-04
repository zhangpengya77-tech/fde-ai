"""通用相容格式（Gemini／通義千問／OpenRouter）大模型供應者測試（2026-11-04）。不連網。"""
import asyncio
import os
import unittest
from unittest import mock

import httpx

from app.providers.provider_manager import GeneralAIProviderManager
from app.providers.provider_openai_compat import OpenAICompatibleProvider

CONTEXT = {"session": {"session_id": "s1"}, "task": {"id": "TASK_03"}, "step": {"step_id": "S2", "title": "接 M3"}}


def _png():
    from io import BytesIO
    from PIL import Image
    buffer = BytesIO()
    Image.new("RGB", (40, 30), (10, 120, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


def provider_with(handler, **kwargs):
    """用 httpx 的 MockTransport 攔截請求，記錄送出的內容。"""
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return OpenAICompatibleProvider("test-key", base_url="https://example.test/v1", model="gemini-3.8-flash", provider_name="gemini", client=client, **kwargs)


class CompatProviderTests(unittest.TestCase):
    def test_text_request_and_answer(self):
        seen = {}

        def handler(request):
            seen["url"] = str(request.url)
            seen["auth"] = request.headers.get("authorization")
            seen["body"] = __import__("json").loads(request.content)
            return httpx.Response(200, json={"choices": [{"message": {"content": "先把 M3 電調接上。"}}], "usage": {"prompt_tokens": 50, "completion_tokens": 10, "total_tokens": 60}})

        result = asyncio.run(provider_with(handler).generate(question="下一步？", **CONTEXT))
        self.assertEqual(result.answer, "先把 M3 電調接上。")
        self.assertEqual(result.provider, "gemini")
        self.assertEqual(seen["url"], "https://example.test/v1/chat/completions")
        self.assertEqual(seen["auth"], "Bearer test-key")
        self.assertEqual(seen["body"]["messages"][0]["role"], "system")
        self.assertIn("下一步？", seen["body"]["messages"][1]["content"])

    def test_visual_sends_data_url_image(self):
        seen = {}

        def handler(request):
            seen["body"] = __import__("json").loads(request.content)
            return httpx.Response(200, json={"choices": [{"message": {"content": "畫面中 M3 是 CCW。"}}]})

        result = asyncio.run(provider_with(handler).generate_visual(question="幫我看槳", image_bytes=_png(), **CONTEXT))
        self.assertEqual(result.source, "AI_VISUAL_REFERENCE")
        parts = seen["body"]["messages"][1]["content"]
        image = next(part for part in parts if part["type"] == "image_url")
        self.assertTrue(image["image_url"]["url"].startswith("data:image/jpeg;base64,"))

    def test_images_can_be_turned_off(self):
        seen = {}

        def handler(request):
            seen["body"] = __import__("json").loads(request.content)
            return httpx.Response(200, json={"choices": [{"message": {"content": "請依 V7 結果更換 M3。"}}]})

        asyncio.run(provider_with(handler, allow_images=False).generate_visual(question="幫我看槳", image_bytes=_png(), **CONTEXT))
        self.assertIsInstance(seen["body"]["messages"][1]["content"], str, "關閉傳圖時只送文字")

    def test_rate_limit_and_bad_key(self):
        result = asyncio.run(provider_with(lambda r: httpx.Response(429, json={})).generate(question="q", **CONTEXT))
        self.assertEqual(result.error_type, "rate_limited")
        result = asyncio.run(provider_with(lambda r: httpx.Response(401, json={})).generate(question="q", **CONTEXT))
        self.assertEqual(result.error_type, "invalid_api_key")
        self.assertIsNone(result.answer)


class CompatSelectionTests(unittest.TestCase):
    def clean_env(self, **extra):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "DASHSCOPE_API_KEY", "OPENROUTER_API_KEY", "FDE_GENERAL_"))}
        env.update(extra)
        return mock.patch.dict(os.environ, env, clear=True)

    def test_gemini_key_beats_stale_openai_key(self):
        with self.clean_env(GEMINI_API_KEY="g-key", OPENAI_API_KEY="old", FDE_GENERAL_MODEL="gpt-5.6-luna"):
            manager = GeneralAIProviderManager.from_environment()
        self.assertIsInstance(manager.provider, OpenAICompatibleProvider)
        self.assertEqual(manager.provider.model, "gemini-3.6-flash", "GPT 模型名稱不能傳給 Gemini")
        self.assertEqual(manager.health_status()["provider"], "gemini")

    def test_qwen_with_custom_base_and_send_images_off(self):
        with self.clean_env(FDE_GENERAL_PROVIDER="qwen", FDE_GENERAL_API_KEY="q-key", FDE_GENERAL_BASE_URL="https://ws.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", FDE_GENERAL_SEND_IMAGES="0"):
            provider = GeneralAIProviderManager.from_environment().provider
        self.assertEqual(provider.endpoint, "https://ws.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions")
        self.assertFalse(provider.allow_images)

    def test_openrouter_requires_model(self):
        with self.clean_env(FDE_GENERAL_PROVIDER="openrouter", OPENROUTER_API_KEY="o-key"):
            self.assertFalse(GeneralAIProviderManager.from_environment().enabled, "OpenRouter 未指定模型時不啟用")


if __name__ == "__main__":
    unittest.main()


class FallbackModelTests(unittest.TestCase):
    """2026-11-04：主模型忙碌（503）或額度用完（429）時自動改用備援模型。"""

    def test_busy_model_falls_back(self):
        import json as _json
        tried = []

        def handler(request):
            model = _json.loads(request.content)["model"]
            tried.append(model)
            if model == "gemini-3.6-flash":
                return httpx.Response(503, json={"error": {"code": 503}})
            return httpx.Response(200, json={"choices": [{"message": {"content": f"由 {model} 回答"}}]})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        provider = OpenAICompatibleProvider("k", base_url="https://example.test/v1", model="gemini-3.6-flash", provider_name="gemini",
                                            client=client, fallback_models=["gemini-3.5-flash", "gemini-3.8-flash"])
        result = asyncio.run(provider.generate(question="q", **CONTEXT))
        self.assertEqual(tried, ["gemini-3.6-flash", "gemini-3.5-flash"])
        self.assertEqual(result.answer, "由 gemini-3.5-flash 回答")
        self.assertEqual(result.model, "gemini-3.5-flash")

    def test_bad_key_does_not_retry(self):
        tried = []

        def handler(request):
            tried.append(1)
            return httpx.Response(401, json={})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        provider = OpenAICompatibleProvider("k", base_url="https://example.test/v1", model="a", client=client, fallback_models=["b", "c"])
        asyncio.run(provider.generate(question="q", **CONTEXT))
        self.assertEqual(len(tried), 1, "金鑰錯誤換模型也沒用，不重試")

    def test_gemini_preset_defaults(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "DASHSCOPE_API_KEY", "OPENROUTER_API_KEY", "FDE_GENERAL_"))}
        env["GEMINI_API_KEY"] = "g"
        with mock.patch.dict(os.environ, env, clear=True):
            provider = GeneralAIProviderManager.from_environment().provider
        self.assertEqual(provider.model, "gemini-3.6-flash")
        self.assertEqual(provider.fallback_models[0], "gemini-3.5-flash")
        self.assertGreaterEqual(len(provider.fallback_models), 4)
