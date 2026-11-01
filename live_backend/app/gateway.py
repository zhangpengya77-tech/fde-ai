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

from . import live_assertions


# P7-B5（2026-10-29）：受保護前綴原本只有 `/api/live/`，於是 `/api/v1/vision/*`
# 完全繞過閘道、拿不到 Assertion，但 Live 端的教師端點又要求 Assertion —— 兩邊
# 契約對不上，正向鏈路必然 `assertion_required`。
# 這裡只負責「把票送到」，**不取代**逐路由授權：實際能不能做仍由 Live 的
# `vision_api` 依路由逐一判定（見 docs/reports 的權限矩陣）。
PROTECTED_PREFIXES = ("/api/live/", "/api/v1/vision/", "/api/rc/")
# 舊名稱保留給既有匯入端（單一前綴語意已不成立，僅為相容）。
PROTECTED_PREFIX = PROTECTED_PREFIXES[0]
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
    csrf_origin: str = ""

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
            csrf_origin=read("FDE_GATEWAY_CSRF_ORIGIN").rstrip("/"),
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
    """從 Cookie 取出 ``csrftoken`` 作為 ``X-CSRFToken``。

    2026-10-29（P7-B3）實測修正：先前註解聲稱「Django 4.1+ 只接受遮罩後的 token」
    是**錯的**。Django 5.2 的 ``_does_token_match()`` 有一條長度分支——長度等於
    ``CSRF_TOKEN_LENGTH``（32）時直接以常數時間比對密文本身，否則才當成遮罩 token
    去 unmask。因此送 cookie 密文是合法且可用的（探針 B/C 兩者皆回 200）。
    真正讓換票一律 403 的是 ``Origin``（見 :func:`_resolve_csrf_origin`）。
    """
    # Django 的 ``parse_cookie`` 對同名 Cookie 採最後一個值；瀏覽器／測試代理
    # 若同時帶舊、新 csrftoken，Gateway 也必須選同一個有效值，否則 X-CSRFToken
    # 會和 Django 實際讀到的 Cookie 不一致而被拒絕。
    csrf_token = ""
    for chunk in cookie_header.split(";"):
        name, _, value = chunk.strip().partition("=")
        if name == "csrftoken" and value:
            csrf_token = value
    return csrf_token


def _resolve_csrf_origin(headers: list[tuple[bytes, bytes]], config: "GatewayConfig") -> str:
    """決定送往 Django 的 ``Origin``。

    Django 的 ``_origin_verified()`` 在「既無 Origin 也無 Referer」時直接判為未驗證
    → 403。因此閘道必須明確宣告來源，且該來源必須落在 Django 的
    ``CSRF_TRUSTED_ORIGINS`` 內。

    2026-10-29（P7-B3）根因：舊版把 ``Origin`` 設成 ``config.django_origin``
    （例如 ``http://127.0.0.1:8120``，內部位址），永遠不在信任清單裡，於是每一次
    換票都 403，再被映射成對外 503。

    優先序（皆為伺服器端可信值，不採信客戶端自稱的內部位址）：
      1. 瀏覽器自己送來的 ``Origin``：由 Django 依 CSRF_TRUSTED_ORIGINS 裁決，
         不信任的來源仍會被 403（等同原本的第二道防線）；
      2. 入口層產生的 ``X-Forwarded-Proto`` + ``X-Forwarded-Host``（入口會覆寫
         客戶端值，故可信）；
      3. 運維明確設定的 ``FDE_GATEWAY_CSRF_ORIGIN``；
      4. 都取不到 → 回空字串，呼叫端 fail closed（不猜、不降級）。
    """
    origin = _header_value(headers, b"origin").strip()
    if origin:
        return origin
    scheme = _header_value(headers, b"x-forwarded-proto").strip().lower()
    host = _header_value(headers, b"x-forwarded-host").strip()
    if scheme in ("http", "https") and host:
        return f"{scheme}://{host}"
    return config.csrf_origin


def _resolve_forwarded_proto(headers: list[tuple[bytes, bytes]], csrf_origin: str) -> str:
    """決定送往 Django 的 ``X-Forwarded-Proto``。

    2026-10-29（P7-B3 追加根因）：閘道換票請求原本不帶這個標頭，Django 因此把
    ``POST /api/live/auth/assertion/`` 判為「非 HTTPS」而回 301（SECURE_SSL_REDIRECT），
    閘道再把它映射成對外 503 ``gateway_identity_unavailable``。帶上與對外一致的
    scheme 後，換票才真的走進 view。
    """
    scheme = _header_value(headers, b"x-forwarded-proto").strip().lower()
    if scheme in ("http", "https"):
        return scheme
    if csrf_origin.startswith("https://"):
        return "https"
    return "http"


def _read_payload(response: httpx.Response) -> dict:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


async def _drain_body(receive) -> tuple[bytes, list]:
    """把 ASGI 請求本文完整讀出，同時保留原始訊息以便重放給下游。"""
    messages: list = []
    chunks: list[bytes] = []
    while True:
        message = await receive()
        messages.append(message)
        if message.get("type") == "http.request":
            chunks.append(message.get("body", b"") or b"")
            if not message.get("more_body", False):
                break
        elif message.get("type") == "http.disconnect":
            break
        else:  # pragma: no cover - 非預期訊息型別
            break
    return b"".join(chunks), messages


class _ReplayReceive:
    """把已讀取的訊息重放給下游 app，並在耗盡後回傳空的最後一段。"""

    def __init__(self, messages: list) -> None:
        self._queue = list(messages)
        self._exhausted = False

    async def __call__(self):
        if self._queue:
            return self._queue.pop(0)
        if not self._exhausted:
            self._exhausted = True
            return {"type": "http.request", "body": b"", "more_body": False}
        return {"type": "http.disconnect"}


def _body_sha256(body: bytes) -> str:
    """與 Live 端**同一個**函式計算 body hash，避免兩邊算法漂移。

    刻意不自製摘要：閘道不應具備任何簽章／摘要能力
    （見 test_p3e_gateway_security.GatewayDoesNotSignTests），
    共用 live_assertions.body_sha256 也保證簽章值與驗證值必然一致。
    """
    return live_assertions.body_sha256(body or b"")


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
        return path.startswith(PROTECTED_PREFIXES) and path not in EXEMPT_PATHS

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
        csrf_origin = _resolve_csrf_origin(stripped, self.config)
        if not csrf_origin:
            # 取不到可信來源就不猜：寧可 fail closed，也不要送出一個可能被信任的
            # 偽造 Origin 讓 CSRF 第二道防線失效。
            await self._reject(
                scope,
                receive,
                send,
                503,
                "gateway_csrf_origin_unavailable",
                "Gateway could not determine a trusted request origin.",
            )
            return

        # P7-B4（2026-10-29）：Assertion 必須綁定「這次真正要執行的操作」。
        # 舊版送 json={}，Django 於是簽出預設的 method=GET / path="/" / 空 body hash，
        # 拿這張票打任何真實端點都必然 method_mismatch 或 path_mismatch。
        # 這裡先讀出原始本文（之後重放給下游），再把 method / path / body_sha256
        # 一併交給 Django 簽進 claims。
        request_body, replay_messages = await _drain_body(receive)
        target = {
            "method": str(scope.get("method") or "").upper(),
            "path": str(scope.get("path") or ""),
            "body_sha256": _body_sha256(request_body),
        }

        upstream_headers = {
            "X-FDE-Gateway-Auth": self.config.gateway_key,
            "Origin": csrf_origin,
            "X-Forwarded-Proto": _resolve_forwarded_proto(stripped, csrf_origin),
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
                # 換票會攜帶瀏覽器 Session／CSRF；只允許 loopback Django origin，
                # 不得繼承開發者電腦的 HTTP(S)_PROXY 或被導往外部代理。
                trust_env=False,
            ) as client:
                upstream = await client.post(
                    self.config.django_origin + ASSERTION_PATH,
                    headers=upstream_headers,
                    json=target,
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

        # P7-B2（2026-10-29 修正）：瀏覽器 Session Cookie 到此為止。
        # 閘道**需要**這顆 Cookie 才能向 Django 換 Assertion（那是它的職責），
        # 但 Live 只需要 Assertion，絕不該看到瀏覽器憑證。先前只剝除
        # CLIENT_IDENTITY_HEADERS，Cookie 會被原樣帶進 Live；現在在轉發前
        # 明確移除，與 Live 端 `credential_isolation` 形成兩層防護。
        forwarded = [
            (name, value)
            for name, value in stripped
            if name.decode("latin-1").lower() != "cookie"
        ]
        forwarded.append((b"x-fde-proxy-auth", self.config.proxy_key.encode("latin-1")))
        forwarded.append((b"x-fde-live-assertion", assertion.strip().encode("latin-1")))

        forwarded_scope = dict(scope)
        forwarded_scope["headers"] = forwarded
        # 本文已被讀走，必須重放，否則下游會收到空 body（且與簽章的 hash 不符）。
        await self.app(forwarded_scope, _ReplayReceive(replay_messages), send)


def create_gateway_app(*, live_app=None, config: GatewayConfig | None = None, transport=None):
    """建立閘道 app；未提供 live_app 時以正式設定建立 Live。"""
    if live_app is None:
        from .main import create_app

        live_app = create_app()
    return IdentityGateway(live_app, config=config or GatewayConfig.from_environment(), transport=transport)
