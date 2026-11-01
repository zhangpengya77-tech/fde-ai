"""Django → Live Backend 的內部呼叫簽章。

與 `live_backend/app/internal_auth.py` 必須使用完全相同的 canonical 形式，
否則簽章驗證會失敗（兩邊各有一份實作，是因為 Django 與 Live 用不同 Python
環境且不共用套件路徑；改動時務必同步修改並跑 P-11／P-12 測試）。

    canonical = "\n".join([METHOD, PATH, ROLE, SUBJECT_ID, TIMESTAMP])
    signature = HMAC-SHA256(secret, canonical)

密鑰來源：環境變數 `FDE_INTERNAL_SHARED_SECRET`。
未設定時不送簽章，Live 端會停留在 unsigned_legacy 相容模式。
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time

SIGNATURE_HEADER = "X-FDE-Internal-Signature"
TIMESTAMP_HEADER = "X-FDE-Internal-Timestamp"


def shared_secret() -> str:
    return (os.environ.get("FDE_INTERNAL_SHARED_SECRET") or "").strip()


def canonical(method: str, path: str, role: str, subject_id: str, timestamp: str) -> str:
    return "\n".join([method.upper(), path, role, subject_id, timestamp])


def sign(method: str, path: str, role: str, subject_id: str, timestamp: str, secret: str) -> str:
    message = canonical(method, path, role, subject_id, timestamp).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def signed_headers(method: str, path: str, headers: dict, *, subject_id: str = "") -> dict:
    """在既有標頭上補簽章。

    role 取決於呼叫端已設定的 X-FDE-Role；subject 取教師或學員 ID。
    未設定密鑰時原樣返回（Live 端會以 unsigned_legacy 處理）。
    """
    secret = shared_secret()
    if not secret:
        return headers

    role = str(headers.get("X-FDE-Role") or "").strip().casefold()
    subject = (
        subject_id
        or str(headers.get("X-FDE-Teacher-ID") or "").strip()
        or str(headers.get("X-FDE-Student-ID") or "").strip()
    )
    timestamp = str(int(time.time()))
    signature = sign(method, path, role, subject, timestamp, secret)

    headers = dict(headers)
    headers[SIGNATURE_HEADER] = signature
    headers[TIMESTAMP_HEADER] = timestamp
    return headers
