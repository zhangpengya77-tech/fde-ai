"""Django → Live 的內部呼叫簽章（P6 合約）。

2026-10-28（P6）：改用與 ``live_backend/app/live_assertions.py`` 相同的版本化
Assertion（``v1.<payload>.<sig>``，綁定 method / path / body、含 iss / aud /
sub / role / enrollment_id / cohort_ids / iat / exp / jti）。

身分一律由 Django 依資料庫關係（教師 → TeacherCohortAccess、學員 → Enrollment）
組出 claims 後簽發；Live 端只信任簽章結果，不再讀 ``X-FDE-Role`` /
``X-FDE-Teacher-ID`` 等可被偽造的標頭。

未設定 ``FDE_INTERNAL_SHARED_SECRET`` 時本模組回傳原樣 headers（不讓開發環境
崩潰），但 Live 端會 fail closed 拒絕該請求——這是刻意的。
"""

from __future__ import annotations

import os

from . import live_assertions

ASSERTION_HEADER = live_assertions.ASSERTION_HEADER

__all__ = [
    "ASSERTION_HEADER",
    "shared_secret",
    "canonical",
    "body_sha256",
    "signed_headers",
]


def shared_secret() -> str:
    """簽章密鑰：環境變數優先，其次 Django settings（P7 修正）。

    2026-10-29（P7-B6）：原本只讀環境變數，但正式／隔離環境是透過 settings 的
    ``FDE_LIVE_ASSERTION_KEY`` 注入；兩者不一致時會簽出 Live 無法驗證的票。
    """
    configured = (os.environ.get("FDE_INTERNAL_SHARED_SECRET") or "").strip()
    if configured:
        return configured
    try:
        from django.conf import settings

        return str(getattr(settings, "FDE_LIVE_ASSERTION_KEY", "") or "").strip()
    except Exception:  # pragma: no cover - 非 Django 環境（例如純單元測試）
        return ""


def canonical(payload: dict) -> bytes:
    """Canonical JSON bytes（與 Live 端同一序列化方式）。"""
    return live_assertions.canonical_payload(payload)


def body_sha256(data: bytes = b"") -> str:
    return live_assertions.body_sha256(data or b"")


def signed_headers(
    method: str,
    path: str,
    headers: dict,
    *,
    subject_id: str = "",
    role: str = "",
    enrollment_id: int = 0,
    cohort_ids=None,
    body: bytes = b"",
) -> dict:
    """回傳**新的** dict：原 headers + ``X-FDE-Live-Assertion``。

    未設定共享密鑰時回傳原 headers 的複本（Live 端會拒絕，屬刻意行為）。
    """
    result = dict(headers or {})
    secret = shared_secret()
    if not secret:
        return result
    subject = str(subject_id or "").strip()
    claims = {
        "sub": f"{role}:{subject}" if role and subject else "",
        "role": str(role or ""),
        "enrollment_id": int(enrollment_id or 0),
        "cohort_ids": list(cohort_ids or []),
        "method": str(method or "GET").upper(),
        "path": str(path or "/"),
        "body_sha256": body_sha256(body),
    }
    result[ASSERTION_HEADER] = live_assertions.issue_assertion(claims, secret)
    return result
