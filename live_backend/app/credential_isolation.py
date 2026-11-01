"""P7-B2：客戶端憑證隔離（Live 側最後一道）。

背景
----
P6 為了阻止瀏覽器偽造身分，在入口層（``demo/tools/static_entry_server.py``）把
``Cookie`` 與 ``Authorization`` **一律**剝除。這道修補範圍過大：Live 同時代理
Django Portal（``/login/``、``/teacher/``、``/platform/`` 等），登入與 CSRF 全靠
瀏覽器的 Session／CSRF Cookie，於是正向鏈路全斷。

分流規則（依**實際路由**，不是依請求來源）
------------------------------------------
* **Django Portal 代理前綴** → 原樣放行：Cookie 必須到達 Django。
* **Live 自有路由**（含 ``/api/live/``、``/api/v1/vision/``、``/api/rc/`` 與
  前端靜態頁）→ 剝除 ``Cookie`` / ``Authorization``；這些端點只認 Django 簽發的
  Assertion，永遠不需要瀏覽器憑證。
* ``X-FDE-*`` 身分標頭：
  - ``X-FDE-Role`` / ``X-FDE-Teacher-ID`` / ``X-FDE-Student-ID`` 是**不可驗證**的
    自稱，任何人打了就能冒充，一律丟棄；
  - ``X-FDE-Live-Assertion`` **必須保留**：它是 HMAC 簽章票，偽造會在
    ``internal_auth.verify`` 被拒；而且 Django 直連 Live 的內部呼叫（不經閘道、
    沒有 proxy key）正是靠它，剝掉會把正向鏈路打死；
  - ``X-FDE-Proxy-Auth`` 保留，由 ``trusted_live_identity`` 以常數時間比對。

本層與入口層、閘道層規則一致，屬縱深防禦；任一層單獨失效都不會讓 Cookie 直達
Live 業務處理器。
"""

from __future__ import annotations

# 與 ``app/main.py`` 中走 ``django_portal_proxy`` 的路由前綴保持一對一。
# 新增 Portal 路由時必須同步加入此處；漏加的後果是「登入壞掉」這種立即可見的
# 失敗（Cookie 被剝除 → Django 看不到 Session），不會靜默降級成不安全狀態。
PORTAL_PROXY_PREFIXES = (
    "/login/",
    "/register/",
    "/activate/",
    "/logout/",
    "/password-reset/",
    "/reset/",
    "/student/",
    "/teacher/",
    "/courses/",
    "/evidence/",
    "/platform/",
    "/static/",
)

CREDENTIAL_HEADERS = (b"cookie", b"authorization")
# 只丟「無法驗證的自稱身分」；簽章票與代理金鑰由下游驗證，不能在此丟棄。
FORGED_IDENTITY_HEADERS = (b"x-fde-role", b"x-fde-teacher-id", b"x-fde-student-id")


def is_portal_route(path: str) -> bool:
    return str(path or "").startswith(PORTAL_PROXY_PREFIXES)


class ClientCredentialIsolation:
    """純 ASGI 中介層：在 Live 業務處理器之前完成憑證與身分標頭隔離。"""

    def __init__(self, app, *, proxy_key: str = "") -> None:
        self.app = app
        # 保留參數以維持呼叫端契約；本層不再用 proxy key 決定是否保留 Assertion
        # （Assertion 由下游驗章決定真偽，proxy key 只約束 /api/live/ session 路由）。
        self.proxy_key = str(proxy_key or "")

    def sanitize(self, path: str, headers) -> list[tuple[bytes, bytes]]:
        """回傳可安全交給 Live 業務處理器的標頭清單。"""
        headers = list(headers or [])
        if is_portal_route(path):
            # Django Portal：Cookie 是登入與 CSRF 的唯一憑證，必須原樣保留。
            return headers
        clean: list[tuple[bytes, bytes]] = []
        for name, value in headers:
            lower = name.lower()
            if lower in CREDENTIAL_HEADERS:
                continue
            if lower in FORGED_IDENTITY_HEADERS:
                continue
            clean.append((name, value))
        return clean

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        path = str(scope.get("path") or "")
        headers = scope.get("headers") or []
        sanitized = self.sanitize(path, headers)
        if sanitized is headers or sanitized == list(headers):
            await self.app(scope, receive, send)
            return
        forwarded_scope = dict(scope)
        forwarded_scope["headers"] = sanitized
        await self.app(forwarded_scope, receive, send)
