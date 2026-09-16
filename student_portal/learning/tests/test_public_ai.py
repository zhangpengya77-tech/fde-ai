import json
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.urls import reverse


class FakeUpstreamResponse:
    status = 200

    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit=-1):
        return self.payload


class PublicAiProxyTests(TestCase):
    def setUp(self):
        cache.clear()

    @override_settings(
        PUBLIC_RAG_UPSTREAM_URL="http://rag.internal.test",
        PUBLIC_AI_TIMEOUT_SECONDS=2,
        PUBLIC_AI_MAX_REQUEST_BYTES=1024,
        PUBLIC_RAG_REQUESTS_PER_MINUTE=5,
    )
    @patch("learning.public_ai.urlopen")
    def test_anonymous_rag_request_reaches_same_origin_proxy_and_upstream(self, mock_urlopen):
        mock_urlopen.return_value = FakeUpstreamResponse(
            {"answer": "檢查槳葉方向", "source_type": "rag", "version": "test"}
        )
        response = self.client.post(
            reverse("learning:public_rag_ask"),
            data=json.dumps({"question": "槳葉方向如何確認"}),
            content_type="text/plain",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["answer"], "檢查槳葉方向")
        self.assertEqual(mock_urlopen.call_args.args[0].full_url, "http://rag.internal.test/api/rag/ask")
        self.assertEqual(json.loads(mock_urlopen.call_args.args[0].data)["question"], "槳葉方向如何確認")

    @override_settings(PUBLIC_RAG_UPSTREAM_URL="")
    @patch("learning.public_ai.urlopen")
    def test_missing_rag_upstream_returns_service_unavailable_without_login(self, mock_urlopen):
        response = self.client.post(
            reverse("learning:public_rag_ask"),
            data=json.dumps({"question": "飛控如何校準"}),
            content_type="text/plain",
        )

        self.assertEqual(response.status_code, 503)
        self.assertIn("error", response.json())
        mock_urlopen.assert_not_called()

    @override_settings(PUBLIC_AI_MAX_REQUEST_BYTES=64)
    def test_public_ai_rejects_oversized_body(self):
        response = self.client.post(
            reverse("learning:public_rag_ask"),
            data=json.dumps({"question": "x" * 100}),
            content_type="text/plain",
        )

        self.assertEqual(response.status_code, 413)

    @override_settings(
        PUBLIC_RAG_UPSTREAM_URL="http://rag.internal.test",
        PUBLIC_RAG_REQUESTS_PER_MINUTE=1,
    )
    @patch("learning.public_ai.urlopen")
    def test_public_rag_requests_are_rate_limited(self, mock_urlopen):
        mock_urlopen.return_value = FakeUpstreamResponse(
            {"answer": "檢查槳葉方向", "source_type": "rag", "version": "test"}
        )
        url = reverse("learning:public_rag_ask")
        body = json.dumps({"question": "槳葉方向"})

        first = self.client.post(url, data=body, content_type="text/plain")
        second = self.client.post(url, data=body, content_type="text/plain")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        self.assertEqual(mock_urlopen.call_count, 1)

    @override_settings(
        PUBLIC_RAG_UPSTREAM_URL="http://rag.internal.test",
        PUBLIC_RAG_REQUESTS_PER_MINUTE=1,
        PUBLIC_AI_TRUSTED_PROXY_IPS={"10.0.0.1"},
    )
    @patch("learning.public_ai.urlopen")
    def test_trusted_proxy_forwarded_client_ip_has_independent_rate_limit(self, mock_urlopen):
        mock_urlopen.return_value = FakeUpstreamResponse(
            {"answer": "檢查槳葉方向", "source_type": "rag", "version": "test"}
        )
        url = reverse("learning:public_rag_ask")
        body = json.dumps({"question": "槳葉方向"})

        first = self.client.post(
            url,
            data=body,
            content_type="text/plain",
            REMOTE_ADDR="10.0.0.1",
            HTTP_CF_CONNECTING_IP="198.51.100.10",
        )
        second = self.client.post(
            url,
            data=body,
            content_type="text/plain",
            REMOTE_ADDR="10.0.0.1",
            HTTP_CF_CONNECTING_IP="198.51.100.11",
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(mock_urlopen.call_count, 2)

    @override_settings(
        PUBLIC_INSPECTION_UPSTREAM_URL="http://inspection.internal.test",
        PUBLIC_INSPECTION_REQUESTS_PER_MINUTE=5,
    )
    @patch("learning.public_ai.urlopen")
    def test_anonymous_image_inspection_is_proxied_without_persisting_user_data(self, mock_urlopen):
        mock_urlopen.return_value = FakeUpstreamResponse({"ok": True, "status": "CHECK"})
        response = self.client.post(
            reverse("learning:public_inspection_detect"),
            data=json.dumps({"fileName": "propeller.jpg", "imageData": "data:image/jpeg;base64,AAAA", "conf": 0.25}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "CHECK")
        self.assertEqual(
            mock_urlopen.call_args.args[0].full_url,
            "http://inspection.internal.test/api/detect",
        )

    @override_settings(
        PUBLIC_INSPECTION_UPSTREAM_URL="http://inspection.internal.test",
        PUBLIC_INSPECTION_REQUESTS_PER_MINUTE=5,
    )
    @patch("learning.public_ai.urlopen")
    def test_anonymous_hover_analysis_is_proxied(self, mock_urlopen):
        mock_urlopen.return_value = FakeUpstreamResponse({"ok": True, "score": 82})
        response = self.client.post(
            reverse("learning:public_inspection_hover"),
            data=json.dumps({"fileName": "hover.mp4", "videoData": "data:video/mp4;base64,AAAA"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["score"], 82)
        self.assertEqual(
            mock_urlopen.call_args.args[0].full_url,
            "http://inspection.internal.test/api/hover",
        )

    @override_settings(
        PUBLIC_VOICE_UPSTREAM_URL="http://inspection.internal.test",
        PUBLIC_VOICE_REQUESTS_PER_MINUTE=5,
    )
    @patch("learning.public_ai.urlopen")
    def test_anonymous_voice_assistant_is_proxied(self, mock_urlopen):
        mock_urlopen.return_value = FakeUpstreamResponse(
            {"ok": True, "result": {"answer": "請先確認飛控箭頭朝向機頭。"}}
        )
        response = self.client.post(
            reverse("learning:public_voice_ask"),
            data=json.dumps({"question": "飛控要朝哪裡", "locale": "zh-TW"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(
            mock_urlopen.call_args.args[0].full_url,
            "http://inspection.internal.test/api/voice/ask",
        )

    @override_settings(
        PUBLIC_RAG_UPSTREAM_URL="http://rag.internal.test",
        PUBLIC_AI_TIMEOUT_SECONDS=1,
    )
    @patch("learning.public_ai.urlopen", side_effect=TimeoutError("upstream timed out"))
    def test_upstream_timeout_returns_service_error_not_server_error(self, _mock_urlopen):
        response = self.client.post(
            reverse("learning:public_rag_ask"),
            data=json.dumps({"question": "飛控如何校準"}),
            content_type="text/plain",
        )

        self.assertEqual(response.status_code, 503)
        self.assertIn("error", response.json())

    def test_public_ai_post_still_requires_csrf(self):
        client = Client(enforce_csrf_checks=True)
        client.get(reverse("learning:home"))

        response = client.post(
            reverse("learning:public_rag_ask"),
            data=json.dumps({"question": "槳葉方向"}),
            content_type="text/plain",
        )

        self.assertEqual(response.status_code, 403)
