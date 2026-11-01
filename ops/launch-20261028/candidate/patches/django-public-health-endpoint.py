"""匿名健康端點（候選設計，未接線、未部署）。

放置建議：student_portal/learning/public_health.py
接線方式（一行）：learning/urls.py
    path("api/public/health/", public_health.public_health, name="public_health")

設計約束（依 2026-10-28 上線收尾指令「不得自行開放管理 API」）：
  * 僅 GET / HEAD；非 GET 一律 405。
  * 完全匿名，不讀 session、不要求登入、不寫任何資料。
  * 只回布林值與粗粒度原因碼；**不**回傳模型名稱、模型路徑、檔案大小、
    學員數、班級數、版本號、主機名、內部 URL、PID、資料庫名。
  * 不快取（no-store），避免狀態假象。
  * 下游探測有硬逾時，後端慢不得拖垮公開站。

回應範例（正常）：
    {"gateway": "online", "login": true,
     "vision": {"available": true, "reason": "ok"}}

回應範例（沒有 ACTIVE 模型）：
    {"gateway": "online", "login": true,
     "vision": {"available": false, "reason": "no_active_model"}}

原因碼（固定枚舉，不得任意擴充成可探測字串）：
    ok / not_configured / backend_unreachable / no_active_model / backend_error
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from django.db import connection
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

VISION_PROBE_TIMEOUT_SECONDS = 1.2
VISION_REASON_CODES = frozenset(
    {"ok", "not_configured", "backend_unreachable", "no_active_model", "backend_error"}
)


def _database_readable() -> bool:
    """登入服務是否可用＝資料庫可否完成一次連線與極輕量查詢。"""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return True
    except Exception:
        return False


def _vision_status() -> dict:
    """以最小契約向視覺後端取「是否有可用的 ACTIVE 模型」。

    契約：GET {FDE_HEALTH_VISION_URL} -> {"active_models": <int>}
    未設定即視為 not_configured；任何例外一律降級為固定原因碼。
    """
    url = (os.environ.get("FDE_HEALTH_VISION_URL") or "").strip()
    if not url:
        return {"available": False, "reason": "not_configured"}
    try:
        request = urllib.request.Request(url, method="GET", headers={"accept": "application/json"})
        with urllib.request.urlopen(request, timeout=VISION_PROBE_TIMEOUT_SECONDS) as response:
            if not 200 <= getattr(response, "status", 200) < 300:
                return {"available": False, "reason": "backend_error"}
            payload = json.loads(response.read(4096).decode("utf-8", "replace") or "{}")
    except (urllib.error.URLError, TimeoutError, OSError):
        return {"available": False, "reason": "backend_unreachable"}
    except Exception:
        return {"available": False, "reason": "backend_error"}

    try:
        active = int(payload.get("active_models", 0))
    except (TypeError, ValueError):
        return {"available": False, "reason": "backend_error"}

    if active <= 0:
        return {"available": False, "reason": "no_active_model"}
    return {"available": True, "reason": "ok"}


@csrf_exempt
@require_http_methods(["GET", "HEAD"])
@never_cache
def public_health(request):
    login_ok = _database_readable()
    vision = _vision_status()
    if vision.get("reason") not in VISION_REASON_CODES:
        vision = {"available": False, "reason": "backend_error"}

    response = JsonResponse(
        {
            "gateway": "online",
            "login": login_ok,
            "vision": {"available": bool(vision["available"]), "reason": vision["reason"]},
        }
    )
    response["Cache-Control"] = "no-store"
    response["X-Robots-Tag"] = "none"
    return response
