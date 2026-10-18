import asyncio
import json
import os
import unittest
from unittest.mock import patch

import httpx

from app.providers.provider_manager import GeneralAIProviderManager
from app.providers.provider_openai import OpenAITextProvider


class GeneralAIProviderTests(unittest.TestCase):
    def test_openai_text_provider_returns_unified_result(self):
        async def upstream(request):
            self.assertEqual(request.url.path, "/v1/responses")
            self.assertEqual(request.headers["authorization"], "Bearer secret-test-key")
            payload = json.loads(request.content)
            self.assertEqual(payload["model"], "gpt-5.6-luna")
            self.assertNotIn("image_url", request.content.decode("utf-8"))
            return httpx.Response(200, json={
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "這是繁體中文回答。"}]}],
                "usage": {"input_tokens": 10, "output_tokens": 6, "total_tokens": 16},
            })

        provider = OpenAITextProvider(
            "secret-test-key",
            model="gpt-5.6-luna",
            client=httpx.AsyncClient(transport=httpx.MockTransport(upstream)),
        )
        result = asyncio.run(provider.generate(
            question="為什麼？", session={"session_id": "s1"}, task={"title": "零件識別"},
            step={"title": "準備工作區域"}, language="zh-TW",
        ))
        self.assertEqual(result.answer, "這是繁體中文回答。")
        self.assertEqual(result.provider, "openai")
        self.assertEqual(result.model, "gpt-5.6-luna")
        self.assertEqual(result.tokens["total_tokens"], 16)
        self.assertEqual(result.source, "AI_REFERENCE")
        self.assertIsNone(result.error)

    def test_provider_http_failure_returns_error_without_raising(self):
        async def upstream(_request):
            return httpx.Response(429, json={"error": {"code": "rate_limit_exceeded"}})

        provider = OpenAITextProvider(
            "secret-test-key", client=httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        )
        result = asyncio.run(provider.generate(
            question="為什麼？", session={}, task={}, step={}, language="zh-TW",
        ))
        self.assertIsNone(result.answer)
        self.assertEqual(result.error, "provider_http_429")

    def test_manager_is_disabled_without_api_key(self):
        with patch.dict(os.environ, {}, clear=True):
            manager = GeneralAIProviderManager.from_environment()
        self.assertFalse(manager.enabled)

    def test_manager_defaults_to_luna_for_low_cost_text_fallback(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "secret-test-key"}, clear=True):
            manager = GeneralAIProviderManager.from_environment()
        self.assertTrue(manager.enabled)
        self.assertEqual(manager.provider.model, "gpt-5.6-luna")


if __name__ == "__main__":
    unittest.main()
