import asyncio
import json
import unittest

import httpx

from app.rag import RAGAdapter


class RAGAdapterTests(unittest.TestCase):
    def adapter(self, handler, timeout=0.05):
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        self.addCleanup(lambda: asyncio.run(client.aclose()))
        return RAGAdapter("http://127.0.0.1:8770", timeout_seconds=timeout, client=client)

    def test_health_success_and_offline(self):
        online = self.adapter(lambda request: httpx.Response(200, json={"status": "online"}))
        offline = self.adapter(lambda request: httpx.Response(503, json={"status": "offline"}))
        self.assertTrue(asyncio.run(online.health()))
        self.assertFalse(asyncio.run(offline.health()))

    def test_query_success_preserves_only_real_metadata(self):
        seen = {}
        def handler(request):
            seen["path"] = request.url.path
            seen["body"] = json.loads(request.content)
            return httpx.Response(200, json={
                "answer": "马达提供旋转动力，机臂承载马达。",
                "source_type": "rag",
                "version": "f450_v1",
                "sources": [{"title": "F450 教材"}],
            })
        result = asyncio.run(self.adapter(handler).query("教学问题", "req-1", 3))
        self.assertEqual(seen, {"path": "/api/rag/ask", "body": {"question": "教学问题"}})
        self.assertEqual(result.status, "online")
        self.assertTrue(result.hit)
        self.assertEqual(result.explanation, "马达提供旋转动力，机臂承载马达。")
        self.assertEqual(result.sources, [{"title": "F450 教材"}])
        self.assertGreaterEqual(result.latency_ms, 0)
        self.assertEqual(result.request_id, "req-1")
        self.assertEqual(result.context_version, 3)

    def test_query_normalizes_timeout_http_invalid_empty_and_no_hit(self):
        async def timeout_handler(_request):
            await asyncio.sleep(0.05)
            return httpx.Response(200, json={"answer": "late"})

        cases = [
            (lambda request: httpx.Response(500), "error"),
            (lambda request: httpx.Response(200, content=b"not-json"), "error"),
            (lambda request: httpx.Response(200, json={"answer": ""}), "no_hit"),
            (lambda request: httpx.Response(200, json={"answer": "没有找到相关资料", "source_type": "refuse"}), "no_hit"),
        ]
        for handler, expected in cases:
            with self.subTest(expected=expected):
                result = asyncio.run(self.adapter(handler).query("q", "r", 1))
                self.assertEqual(result.status, expected)
                self.assertFalse(result.hit)
        timed = asyncio.run(self.adapter(timeout_handler, timeout=0.01).query("q", "r", 1))
        self.assertEqual(timed.status, "timeout")
        self.assertEqual(timed.error_code, "rag_timeout")


if __name__ == "__main__":
    unittest.main()
