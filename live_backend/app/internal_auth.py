"""內部呼叫可信來源驗證（Django → Live Backend）。

為什麼需要這個模組
------------------
Live Backend 只綁 127.0.0.1，但 **localhost 不等於可信來源**：
同一台機器上的其他程序、被繞過的代理、或日後誤開對外綁定，
都可以送出 `X-FDE-Role: teacher` 這種可偽造的標頭。
因此教師級與學員級操作都必須帶「伺服器端才知道的密鑰」所產生的簽章。

簽章契約（與 Django 端 `learning/internal_auth.py` 必須完全一致）
------------------------------------------------------------------
    canonical = "\n".join([METHOD, PATH, ROLE, SUBJECT_ID, TIMESTAMP])
    signature = HMAC-SHA256(secret, canonical) 的十六進位小寫字串

    METHOD     : 大寫 HTTP 方法
    PATH       : 不含 query 的請求路徑，例如 /api/v1/vision/models
    ROLE       : "teacher" 或 "student"
    SUBJECT_ID : 教師用 X-FDE-Teacher-ID，學員用 X-FDE-Student-ID
    TIMESTAMP  : Unix 秒（字串）

必要標頭
--------
    X-FDE-Internal-Signature
    X-FDE-Internal-Timestamp

密鑰來源：環境變數 `FDE_INTERNAL_SHARED_SECRET`。

未設定密鑰時的行為
------------------
維持 `unsigned_legacy` 模式以相容既有 DEMO 與測試套件，
但 `/api/live/health` 會明確回報 `internal_auth: "unsigned_legacy"`，
正式部署前必須設為 `signed`（見發布 Runbook 的 P0 前置條件）。
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time

SIGNATURE_HEADER = "X-FDE-Internal-Signature"
TIMESTAMP_HEADER = "X-FDE-Internal-Timestamp"
MAX_SKEW_SECONDS = 300

REASON_SIGNED = "ok"
REASON_UNSIGNED_LEGACY = "unsigned_legacy"
REASON_SIGNATURE_REQUIRED = "signature_required"
REASON_BAD_TIMESTAMP = "bad_timestamp"
REASON_STALE_TIMESTAMP = "stale_timestamp"
REASON_BAD_SIGNATURE = "bad_signature"


def secret() -> str:
    return (os.environ.get("FDE_INTERNAL_SHARED_SECRET") or "").strip()


def auth_mode() -> str:
    return "signed" if secret() else "unsigned_legacy"


def canonical(method: str, path: str, role: str, subject_id: str, timestamp: str) -> str:
    return "\n".join([method.upper(), path, role, subject_id, timestamp])


def sign(
    method: str,
    path: str,
    role: str,
    subject_id: str,
    timestamp: str,
    *,
    shared_secret: str | None = None,
) -> str:
    key = shared_secret if shared_secret is not None else secret()
    message = canonical(method, path, role, subject_id, timestamp).encode("utf-8")
    return hmac.new(key.encode("utf-8"), message, hashlib.sha256).hexdigest()


def verify(request) -> tuple[bool, str]:
    """驗證請求是否來自可信的內部呼叫方。

    回傳 (是否通過, 原因碼)。未設定密鑰時一律通過並回報 unsigned_legacy，
    讓健康端點能暴露這個狀態（而不是靜默降級）。
    """
    key = secret()
    if not key:
        return True, REASON_UNSIGNED_LEGACY

    signature = (request.headers.get(SIGNATURE_HEADER) or "").strip().lower()
    timestamp = (request.headers.get(TIMESTAMP_HEADER) or "").strip()
    if not signature or not timestamp:
        return False, REASON_SIGNATURE_REQUIRED

    try:
        issued_at = int(timestamp)
    except (TypeError, ValueError):
        return False, REASON_BAD_TIMESTAMP

    if abs(time.time() - issued_at) > MAX_SKEW_SECONDS:
        return False, REASON_STALE_TIMESTAMP

    role = (request.headers.get("X-FDE-Role") or "").strip().casefold()
    subject_id = (
        request.headers.get("X-FDE-Teacher-ID")
        or request.headers.get("X-FDE-Student-ID")
        or ""
    ).strip()

    expected = sign(request.method, request.url.path, role, subject_id, timestamp)
    if not hmac.compare_digest(expected, signature):
        return False, REASON_BAD_SIGNATURE
    return True, REASON_SIGNED
