"""P7-B3 驗收：Gateway ↔ Django 的 CSRF 流程必須真的可用，且不得自我豁免。

實測結論（2026-10-29，`ops/p7/tools/probe_b3_csrf.py`）：

* Django 5.2 的 ``_does_token_match()`` 對長度等於 32 的 token 直接常數時間比對
  密文，因此把 ``csrftoken`` cookie 的值放進 ``X-CSRFToken`` **是有效的**；
* 真正讓換票一律 403 的是 ``Origin``——舊版 Gateway 把 ``config.django_origin``
  （內部位址 ``http://127.0.0.1:8120``）當 Origin 送出，永遠不在
  ``CSRF_TRUSTED_ORIGINS`` 內；
* 完全沒有 Origin／Referer 時 Django 一律判為未驗證 → 403。

因此本檔鎖定六件事（對應批准令 §二 第三優先的六項驗證）。
"""

from __future__ import annotations

import contextlib
import io
import json
import unittest
from pathlib import Path

import httpx
from starlette.testclient import TestClient

from app.gateway import GatewayConfig, IdentityGateway
from app.gateway import _csrf_from_cookie
from app.main import create_app
from app.sessions import InMemorySessionStore


ASSERTION_KEY = "p7-b3-assertion-key"
PROXY_KEY = "p7-b3-proxy-key"
GATEWAY_KEY = "p7-b3-gateway-key"
DJANGO_ORIGIN = "http://127.0.0.1:8120"
PUBLIC_ORIGIN = "https://127.0.0.1:8443"
SESSION_VALUE = "sessionid=session-value-should-never-be-logged"
CSRF_SECRET = "csrfsecretvalue0123456789abcdef"
COOKIE = f"{SESSION_VALUE}; csrftoken={CSRF_SECRET}"


class OfflineVision:
    async def health(self):
        return False


def _build(handler, *, csrf_origin=""):
    live_app = create_app(
        vision_adapter=OfflineVision(),
        session_store=InMemorySessionStore(),
        dev_mode=False,
        live_assertion_key=ASSERTION_KEY,
        trusted_proxy_key=PROXY_KEY,
        require_live_auth=True,
    )
    config = GatewayConfig(
        django_origin=DJANGO_ORIGIN,
        gateway_key=GATEWAY_KEY,
        proxy_key=PROXY_KEY,
        timeout_seconds=2.0,
        csrf_origin=csrf_origin,
    )
    return TestClient(
        IdentityGateway(live_app, config=config, transport=httpx.MockTransport(handler))
    )


def _recording_handler(calls: list):
    """記錄送往 Django 的請求；回 401 讓流程停在換票階段（不進入 Live）。"""

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(401, json={"authenticated": False})

    return handler


class CsrfOriginTests(unittest.TestCase):
    def test_b3_0_duplicate_csrf_cookie_uses_django_effective_last_value(self):
        """Django 同名 Cookie 以最後一個值為準，Gateway 必須使用相同值。"""
        duplicate = "csrftoken=stale-token; sessionid=session-value; csrftoken=fresh-token"
        self.assertEqual(_csrf_from_cookie(duplicate), "fresh-token")

    def test_b3_1_forwards_browser_origin_instead_of_internal_origin(self):
        calls = []
        client = _build(_recording_handler(calls))
        client.post("/api/live/sessions", json={}, headers={"Cookie": COOKIE, "Origin": PUBLIC_ORIGIN})
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].headers.get("Origin"), PUBLIC_ORIGIN)
        self.assertNotEqual(calls[0].headers.get("Origin"), DJANGO_ORIGIN)

    def test_b3_2_uses_entry_forwarded_headers_when_browser_sends_no_origin(self):
        calls = []
        client = _build(_recording_handler(calls))
        client.post(
            "/api/live/sessions",
            json={},
            headers={
                "Cookie": COOKIE,
                "X-Forwarded-Proto": "https",
                "X-Forwarded-Host": "127.0.0.1:8443",
            },
        )
        self.assertEqual(calls[0].headers.get("Origin"), PUBLIC_ORIGIN)

    def test_b3_3_falls_back_to_configured_csrf_origin(self):
        calls = []
        client = _build(_recording_handler(calls), csrf_origin="https://portal.example.edu")
        client.post("/api/live/sessions", json={}, headers={"Cookie": COOKIE})
        self.assertEqual(calls[0].headers.get("Origin"), "https://portal.example.edu")

    def test_b3_4_fails_closed_when_no_trusted_origin_is_available(self):
        calls = []
        client = _build(_recording_handler(calls), csrf_origin="")
        response = client.post("/api/live/sessions", json={}, headers={"Cookie": COOKIE})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "gateway_csrf_origin_unavailable")
        self.assertEqual(calls, [], "取不到可信來源時不得向 Django 發請求")

    def test_b3_5_sends_csrf_token_and_cookie_to_django(self):
        calls = []
        client = _build(_recording_handler(calls))
        client.post("/api/live/sessions", json={}, headers={"Cookie": COOKIE, "Origin": PUBLIC_ORIGIN})
        self.assertEqual(calls[0].headers.get("X-CSRFToken"), CSRF_SECRET)
        self.assertIn("csrftoken=" + CSRF_SECRET, calls[0].headers.get("Cookie", ""))
        self.assertEqual(calls[0].headers.get("X-FDE-Gateway-Auth"), GATEWAY_KEY)


class GatewayDoesNotBypassCsrfTests(unittest.TestCase):
    """閘道只能「正確地帶 CSRF」，不得自行跳過 Django 的 CSRF 檢查。"""

    def test_b3_6_untrusted_origin_rejection_is_surfaced_not_swallowed(self):
        def handler(request):
            # 模擬 Django 對不受信任 Origin 的回應。
            return httpx.Response(403, json={"error": "live_identity_forbidden"})

        client = _build(handler)
        response = client.post(
            "/api/live/sessions",
            json={},
            headers={"Cookie": COOKIE, "Origin": "https://evil.example"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "live_identity_forbidden")

    def test_b3_7_no_assertion_is_injected_when_django_rejects(self):
        def handler(request):
            return httpx.Response(403, json={"error": "csrf_failed"})

        client = _build(handler)
        response = client.post("/api/live/sessions", json={}, headers={"Cookie": COOKIE, "Origin": PUBLIC_ORIGIN})
        self.assertNotEqual(response.status_code, 201)
        # 回應不得回顯任何 assertion（含失敗路徑）。
        self.assertNotIn("assertion", response.text.lower())

    def test_b3_8_missing_csrf_token_does_not_become_a_success(self):
        """沒有 csrftoken cookie 時仍會送空 X-CSRFToken，由 Django 決定拒絕。"""

        def handler(request):
            # 沒有 csrftoken cookie 時就不帶 X-CSRFToken（不偽造空值），
            # 由 Django 依 CSRF 規則拒絕。
            self.assertFalse(request.headers.get("X-CSRFToken"))
            return httpx.Response(403, json={"error": "csrf_failed"})

        client = _build(handler)
        response = client.post("/api/live/sessions", json={}, headers={"Cookie": SESSION_VALUE, "Origin": PUBLIC_ORIGIN})
        self.assertEqual(response.status_code, 403)


class SecretNeverLoggedTests(unittest.TestCase):
    """批准令第 6 項：CSRF Token 與 Session 值不得寫入日誌。"""

    def test_b3_9_gateway_writes_no_secret_to_stdout_or_stderr(self):
        calls = []
        client = _build(_recording_handler(calls))
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
            client.post("/api/live/sessions", json={}, headers={"Cookie": COOKIE, "Origin": PUBLIC_ORIGIN})
        output = captured.getvalue()
        self.assertNotIn(CSRF_SECRET, output)
        self.assertNotIn(SESSION_VALUE, output)

    def test_b3_10_gateway_source_has_no_secret_logging(self):
        source = (Path(__file__).resolve().parents[1] / "app" / "gateway.py").read_text(encoding="utf-8")
        for needle in ("print(", "logging.", "logger."):
            self.assertNotIn(needle, source, f"gateway.py 不應出現 {needle}（避免誤印 Cookie／Token）")
