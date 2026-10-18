import asyncio
import base64
from io import BytesIO
import unittest

import httpx
from PIL import Image
from starlette.testclient import TestClient

from app.main import create_app
from app.providers.provider_base import GeneralAIResult
from app.providers.provider_manager import GeneralAIProviderManager
from app.providers.provider_openai import OpenAITextProvider
from app.providers.usage import ModelCostRegistry, ProviderUsageTelemetry


class GeneralAIP05Tests(unittest.TestCase):
    def test_credit_exhausted_is_classified_without_exposing_provider_error(self):
        async def upstream(_request):
            return httpx.Response(429, json={"error": {"code": "credit_balance_exhausted"}})
        provider = OpenAITextProvider("secret-test-key", client=httpx.AsyncClient(transport=httpx.MockTransport(upstream)))
        result = asyncio.run(provider.generate(question="AUX 是什麼？", session={}, task={}, step={}))
        self.assertEqual(result.http_status, 429)
        self.assertEqual(result.error_type, "credit_balance_exhausted")
        self.assertEqual(result.provider_status, "CREDIT_EXHAUSTED")
        self.assertNotIn("secret-test-key", repr(result))

    def test_usage_telemetry_summarizes_tokens_latency_and_429(self):
        telemetry = ProviderUsageTelemetry()
        telemetry.record(GeneralAIResult(None, "openai", "gpt-5.6-luna", 25.0, error="provider_http_429", http_status=429, error_type="credit_balance_exhausted", provider_status="CREDIT_EXHAUSTED"), request_id="r1", task_id="TASK_01", step_id="T01", vision_used=False)
        telemetry.record(GeneralAIResult("回答", "openai", "gpt-5.6-luna", 75.0, tokens={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}), request_id="r2", task_id="TASK_01", step_id="T01", vision_used=False)
        summary = telemetry.summary()
        self.assertEqual(summary["general_ai_requests"], 2)
        self.assertEqual(summary["successful_requests"], 1)
        self.assertEqual(summary["count_429"], 1)
        self.assertEqual(summary["input_tokens"], 10)
        self.assertEqual(summary["output_tokens"], 5)
        self.assertEqual(summary["average_latency_ms"], 50.0)

    def test_cost_registry_does_not_guess_unknown_live_prices(self):
        registry = ModelCostRegistry()
        self.assertIsNone(registry.estimate("gpt-5.6-luna", 100, 20))

    def test_visual_request_resizes_4k_to_one_compressed_frame(self):
        captured = []
        async def upstream(request):
            captured.append(request.json() if hasattr(request, "json") else None)
            import json
            body = json.loads(request.content)
            image_url = body["input"][0]["content"][1]["image_url"]
            raw = base64.b64decode(image_url.split(",", 1)[1])
            with Image.open(BytesIO(raw)) as image:
                self.assertLessEqual(max(image.size), 1024)
                self.assertEqual(image.format, "JPEG")
            return httpx.Response(200, json={"output": [{"type": "message", "content": [{"type": "output_text", "text": "目前看起來是四旋翼無人機。"}]}], "usage": {"input_tokens": 12, "output_tokens": 8, "total_tokens": 20}})
        original = BytesIO()
        Image.new("RGB", (4000, 3000), "blue").save(original, format="PNG")
        provider = OpenAITextProvider("secret-test-key", client=httpx.AsyncClient(transport=httpx.MockTransport(upstream)))
        result = asyncio.run(provider.generate_visual(question="這是什麼？", session={}, task={}, step={}, image_bytes=original.getvalue()))
        self.assertEqual(result.source, "AI_VISUAL_REFERENCE")
        self.assertEqual(result.answer, "目前看起來是四旋翼無人機。")

    def test_health_exposes_non_sensitive_general_ai_status(self):
        class Vision:
            async def health(self): return True
        manager = GeneralAIProviderManager()
        client = TestClient(create_app(vision_adapter=Vision(), general_ai_provider=manager))
        status = client.get("/api/live/health").json()["components"]["general_ai"]
        self.assertFalse(status["configured"])
        self.assertEqual(status["provider"], "openai")
        self.assertEqual(status["model"], "gpt-5.6-luna")
        self.assertNotIn("api_key", status)


if __name__ == "__main__":
    unittest.main()
