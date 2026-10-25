"""P3-D 最小身分閘道：以 Django Session 換取短效 Assertion 後轉送 Live。

設計邊界：
- 只處理 `/api/live/` 受保護路徑，其餘請求原樣轉送，不新增業務邏輯。
- 瀏覽器自帶的身分標頭一律剝除，角色與班級只採用 Django 簽發的 Assertion。
- 缺少任何一把金鑰、或 Django 不可用時一律 Fail Closed，不回退到信任標頭。
- 本模組不簽發任何 Assertion；簽發權僅在 Django。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

import httpx
from starlette.responses import Response


PROTECTED_PREFIX = "/api/live/"
EXEMPT_PATHS = frozenset({"/api/live/health"})
ASSERTION_PATH = "/api/live/auth/assertion/"

# 瀏覽器可能自行偽造的身分標頭；進入 Live 前必須全部剝除。
# `x-fde-gateway-auth` 也列入：它只屬於「閘道 → Django」這一段，絕不可由瀏覽器帶進
# 下游（否則內部金鑰有機會被當成一般標頭轉送到 Live 或寫進日誌）。
CLIENT_IDENTITY_HEADERS = frozenset(
    {
        "x-fde-proxy-auth",
        "x-fde-live-assertion",
        "x-fde-role",
        "x-fde-teacher-id",
        "x-fde-gateway-auth",
    }
)


@dataclass(frozen=True)
class GatewayConfig:
    """閘道執行期設定；任一必要值為空即視為不可用。"""

    django_origin: str
    gateway_key: str
    proxy_key: str
    timeout_seconds: float = 5.0

    @property
    def usable(self) -> bool:
        return bool(self.django_origin and self.gateway_key and self.proxy_key)

    @classmethod
    def from_environment(cls) -> "GatewayConfig":
        def read(name: str, default: str = "") -> str:
            return str(os.environ.get(name, default) or "").strip()

        try:
            timeout = float(read("FDE_GATEWAY_UPSTREAM_TIMEOUT_SECONDS", "5") or "5")
        except ValueError:
            timeout = 5.0
        return cls(
            django_origin=read("FDE_GATEWAY_DJANGO_ORIGIN", "http://127.0.0.1:8022").rstrip("/"),
            gateway_key=read("FDE_GATEWAY_INTERNAL_AUTH_KEY"),
            proxy_key=read("FDE_LIVE_PROXY_KEY"),
            timeout_seconds=max(0.5, min(timeout, 30.0)),
        )


def _json_response(status_code: int, code: str, message: str) -> Response:
    """與 Live 既有 `error_response` 相同的錯誤信封，前端不需分支處理。"""
    response = Response(
        json.dumps({"error": {"code": code, "message": message}}, ensure_ascii=False),
        status_code=status_code,
        media_type="application/json",
    )
    response.headers["Cache-Control"] = "no-store"
    return response


def _header_value(headers: list[tuple[bytes, bytes]], name: bytes) -> str:
    for header_name, value in headers:
        if header_name == name:
            return value.decode("latin-1")
    return ""


def _csrf_from_cookie(cookie_header: str) -> str:
    """Django 的 double-submit 契約：把 csrftoken cookie 回填到 X-CSRFToken。"""
    for chunk in cookie_header.split(";"):
        name, _, value = chunk.strip().partition("=")
        if name == "csrftoken" and value:
            return value
    return ""


def _read_payload(response: httpx.Response) -> dict:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _failure(response: httpx.Response) -> tuple[int, str, str]:
    """把 Django 的回應映射成閘道對外錯誤，不洩漏上游細節。"""
    payload = _read_payload(response)
    upstream_code = payload.get("error") if isinstance(payload.get("error"), str) else ""
    if response.status_code == 401:
        return 401, "live_session_required", "An authenticated session is required."
    if response.status_code == 403:
        return 403, upstream_code or "live_identity_forbidden", "Live identity is not authorized."
    if response.status_code == 409:
        return 409, upstream_code or "live_identity_ambiguous", "Live identity requires an explicit scope."
    return 503, "gateway_identity_unavailable", "Identity provider rejected the request."


class IdentityGateway:
    """包在 Live ASGI app 外層的最小身分閘道。"""

    def __init__(self, app, *, config: GatewayConfig, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.app = app
        self.config = config
        self.transport = transport

    def _is_protected(self, path: str) -> bool:
        return path.startswith(PROTECTED_PREFIX) and path not in EXEMPT_PATHS

    async def _reject(self, scope, receive, send, status_code: int, code: str, message: str) -> None:
        await _json_response(status_code, code, message)(scope, receive, send)

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = str(scope.get("path") or "")
        if not self._is_protected(path):
            await self.app(scope, receive, send)
            return

        incoming = list(scope.get("headers") or [])
        stripped = [
            (name, value)
            for name, value in incoming
            if name.decode("latin-1").lower() not in CLIENT_IDENTITY_HEADERS
        ]

        if not self.config.usable:
            await self._reject(
                scope,
                receive,
                send,
                503,
                "gateway_misconfigured",
                "Gateway identity settings are unavailable.",
            )
            return

        cookie = _header_value(stripped, b"cookie")
        upstream_headers = {
            "X-FDE-Gateway-Auth": self.config.gateway_key,
            "Origin": self.config.django_origin,
            "Accept": "application/json",
        }
        if cookie:
            upstream_headers["Cookie"] = cookie
        csrf_token = _csrf_from_cookie(cookie)
        if csrf_token:
            upstream_headers["X-CSRFToken"] = csrf_token

        try:
            async with httpx.AsyncClient(
                transport=self.transport,
                timeout=self.config.timeout_seconds,
                follow_redirects=False,
            ) as client:
                upstream = await client.post(
                    self.config.django_origin + ASSERTION_PATH,
                    headers=upstream_headers,
                    json={},
                )
        except httpx.HTTPError:
            await self._reject(
                scope,
                receive,
                send,
                503,
                "gateway_upstream_unavailable",
                "Identity provider is unavailable.",
            )
            return

        if upstream.status_code != 200:
            status_code, code, message = _failure(upstream)
            await self._reject(scope, receive, send, status_code, code, message)
            return

        assertion = _read_payload(upstream).get("assertion")
        if not isinstance(assertion, str) or not assertion.strip():
            await self._reject(
                scope,
                receive,
                send,
                503,
                "gateway_identity_unavailable",
                "Identity provider returned no assertion.",
            )
            return

        forwarded = list(stripped)
        forwarded.append((b"x-fde-proxy-auth", self.config.proxy_key.encode("latin-1")))
        forwarded.append((b"x-fde-live-assertion", assertion.strip().encode("latin-1")))

        forwarded_scope = dict(scope)
        forwarded_scope["headers"] = forwarded
        await self.app(forwarded_scope, receive, send)


def create_gateway_app(*, live_app=None, config: GatewayConfig | None = None, transport=None):
    """建立閘道 app；未提供 live_app 時以正式設定建立 Live。"""
    if live_app is None:
        from .main import create_app

        live_app = create_app()
    return IdentityGateway(live_app, config=config or GatewayConfig.from_environment(), transport=transport)
