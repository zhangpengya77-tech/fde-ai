"""FDE-GCS P4／S6：多機 SITL 仿真的短效票證（同源 JSON，使用既有 Django Session 與 CSRF）。

- 唯讀票：所有可使用 FDE-GCS 的人都能取得，只能看多機遙測。
- 控制票：只有教師（is_staff）能取得，可下達一鍵起飛、編隊、開始任務、降落、返航。
- 票證以 HMAC-SHA256 簽章，綁定使用者、SITL 機隊與 10 分鐘有效時間；Gateway 每個指令都會重新檢查。
- 教師可撤銷所有控制票（並可讓全部飛機原地停住）。
伺服器只簽票，不經手任何飛控資料；Gateway 只連本機 SITL，沒有連接真實飛控的路徑。
"""
import base64
import hashlib
import hmac
import json
import time
import urllib.request
import uuid

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_POST

from .api import _body, _guard, _json_error

TICKET_TTL_SECONDS = 600


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def sign_ticket(secret: str, user_id: int, scope: str, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    claims = {"v": 1, "inst": "sitl-fleet", "scope": scope, "sub": user_id,
              "iat": now, "exp": now + TICKET_TTL_SECONDS, "jti": uuid.uuid4().hex}
    body = _b64(json.dumps(claims, separators=(",", ":")).encode())
    sig = _b64(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
    return {"ticket": f"{body}.{sig}", "scope": scope, "exp": int(claims["exp"])}


@never_cache
@require_POST
def ticket(request):
    denied = _guard(request)
    if denied:
        return denied
    secret = getattr(settings, "FDE_GCS_GATEWAY_SECRET", "")
    if len(secret) < 16:
        return _json_error("sitl_not_configured", 503)
    data = _body(request)
    if data is None:
        return _json_error("bad_json", 400)
    scope = data.get("scope", "read")
    if scope not in ("read", "control"):
        return _json_error("bad_scope", 400)
    if scope == "control" and not request.user.is_staff:
        return _json_error("teacher_only", 403)
    payload = sign_ticket(secret, request.user.pk, scope)
    payload["gateway_url"] = settings.FDE_GCS_GATEWAY_URL
    return JsonResponse(payload)


@never_cache
@require_POST
def revoke(request):
    denied = _guard(request)
    if denied:
        return denied
    if not request.user.is_staff:
        return _json_error("teacher_only", 403)
    secret = getattr(settings, "FDE_GCS_GATEWAY_SECRET", "")
    if len(secret) < 16:
        return _json_error("sitl_not_configured", 503)
    data = _body(request) or {}
    req = urllib.request.Request(
        settings.FDE_GCS_GATEWAY_REVOKE_URL,
        data=json.dumps({"brake": bool(data.get("brake"))}).encode(),
        headers={"X-Gateway-Secret": secret, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:  # noqa: S310 — 位址來自伺服器設定，不是使用者輸入
            ok = resp.status == 200
    except OSError:
        ok = False
    return JsonResponse({"ok": ok}, status=200 if ok else 502)
