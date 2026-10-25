"""P3-F（2026-10-25）：Live 的 Django Portal 代理不得轉送客戶端自帶的轉發標頭。

背景：入口（`static_entry_server.py`）已丟棄客戶端自帶的 `X-Forwarded-*`，但
Live 的 `/login/` 等代理路由舊版只排除 host/connection/content-length/
accept-encoding，其餘標頭原樣傳給 Django —— 客戶端自帶的 `X-Forwarded-For`／
`Forwarded`／`X-Real-IP` 因此可直達上游，等於由外部決定上游看到的來源。

本檔驗證四件事：
  1. 客戶端自帶 `X-Forwarded-Proto: https` 不被採信（純 HTTP 仍是 http）。
  2. 客戶端自帶的 `X-Forwarded-For`／`Forwarded`／`X-Real-IP` 一律不出現在上游。
  3. 上游 `Host` 固定為 Django 位址（不隨客戶端變動）。
  4. 明確的 HTTPS 連線（TLS 終結器之後）仍如實標記為 https，不被降級。

全部離線：以假的 httpx.AsyncClient 攔截上游請求，不發出任何真實網路請求。
"""

import unittest
from unittest.mock import patch

import httpx
from app.main import create_app
from app.sessions import InMemorySessionStore
from starlette.testclient import TestClient


class _CapturingClient:
    """攔截 httpx.AsyncClient，記錄實際送往上游的標頭。"""

    captured: dict = {}

    def __init__(self, *_args, **_kwargs) -> None:
        pass

    async def __aenter__(self) -> "_CapturingClient":
        return self

    async def __aexit__(self, *_exc) -> bool:
        return False

    async def request(self, method, url, headers=None, content=None):
        _CapturingClient.captured = dict(headers or {})
        return httpx.Response(200, json={"ok": True}, request=httpx.Request(method, url))


class PortalProxyForwardedHeaderTests(unittest.TestCase):
    def setUp(self):
        _CapturingClient.captured = {}
        self.app = create_app(
            dev_mode=True,
            require_live_auth=False,
            session_store=InMemorySessionStore(),
            django_portal_url="http://django.internal:8022",
        )

    def _forward(self, *, base_url="http://testserver", headers=None):
        client = TestClient(self.app, base_url=base_url)
        with patch("app.main.httpx.AsyncClient", _CapturingClient):
            response = client.get("/login/", headers=headers or {})
        return response, dict(_CapturingClient.captured)

    def test_client_supplied_forwarded_proto_is_ignored(self):
        response, forwarded = self._forward(headers={"X-Forwarded-Proto": "https"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(forwarded.get("x-forwarded-proto"), "http")

    def test_client_supplied_forwarded_for_is_replaced(self):
        _, forwarded = self._forward(headers={"X-Forwarded-For": "6.6.6.6"})
        self.assertNotEqual(forwarded.get("x-forwarded-for"), "6.6.6.6")
        self.assertTrue(forwarded.get("x-forwarded-for"), "上游仍應收到本層判定的來源位址")

    def test_client_supplied_forwarded_and_real_ip_are_dropped(self):
        _, forwarded = self._forward(
            headers={"Forwarded": "for=6.6.6.6;proto=https", "X-Real-IP": "6.6.6.6"}
        )
        self.assertNotIn("forwarded", forwarded)
        self.assertNotIn("x-real-ip", forwarded)

    def test_upstream_host_is_fixed_to_django(self):
        _, forwarded = self._forward(headers={"Host": "evil.example.test"})
        self.assertEqual(forwarded.get("host"), "127.0.0.1:8022")

    def test_https_connection_is_forwarded_as_https(self):
        _, forwarded = self._forward(base_url="https://testserver")
        self.assertEqual(forwarded.get("x-forwarded-proto"), "https")


if __name__ == "__main__":
    unittest.main()
