"""Live Backend 的內部呼叫驗證（P6）。

2026-10-28（P6）：舊的 ``X-FDE-Role`` / ``X-FDE-Teacher-ID`` 標頭任何本機程序
都能偽造，因此**不再被信任**。Live 只接受 Django 以 ``FDE_INTERNAL_SHARED_SECRET``
簽發的短效 Assertion（見 app/live_assertions.py），且該 Assertion 必須綁定本次
請求的 method、path 與 body，並通過單次使用的 replay ledger。

正式模式（預設）在下列任一情況一律拒絕（fail closed）：
  * 未設定 FDE_INTERNAL_SHARED_SECRET
  * 缺少 Assertion 標頭
  * 簽章／版本／issuer／audience／期限／欄位任一不符
  * method / path / body 與簽章內容不符
  * jti 已被使用過（重放）

相容模式只在「**沒有密鑰**」且 ``FDE_ALLOW_UNSIGNED_LEGACY == "1"`` 時存在，
且僅允許「沒有 Assertion 標頭」的請求通過。正式部署一定會設定
``FDE_INTERNAL_SHARED_SECRET``，因此即使有人誤設該旗標，相容模式也不會被
啟用——正式模式永遠 fail closed。
"""

from __future__ import annotations

import os

from . import live_assertions

ASSERTION_HEADER = live_assertions.ASSERTION_HEADER
LEGACY_ENV_FLAG = "FDE_ALLOW_UNSIGNED_LEGACY"
REPLAY_LEDGER_ENV = "FDE_REPLAY_LEDGER_PATH"

REASON_OK = "ok"
REASON_SECRET_NOT_CONFIGURED = "secret_not_configured"
REASON_ASSERTION_REQUIRED = "assertion_required"
REASON_METHOD_MISMATCH = "method_mismatch"
REASON_PATH_MISMATCH = "path_mismatch"
REASON_BODY_TAMPERED = "body_tampered"
REASON_BODY_UNAVAILABLE = "body_unavailable"
REASON_REPLAY = "replay_detected"
REASON_INVALID = "invalid_assertion"
REASON_UNSIGNED_LEGACY = "unsigned_legacy"

_IDENTITY_ATTR = "_fde_live_identity"
_LEDGERS: dict[str, live_assertions.SqliteReplayLedger] = {}


def secret() -> str:
    return (os.environ.get("FDE_INTERNAL_SHARED_SECRET") or "").strip()


def legacy_allowed() -> bool:
    """相容模式：僅在「沒有密鑰」且環境變數嚴格等於 "1" 時啟用。

    正式部署一定會設定 ``FDE_INTERNAL_SHARED_SECRET``，因此即使有人誤設
    ``FDE_ALLOW_UNSIGNED_LEGACY=1``，只要密鑰存在，相容模式就不會被啟用，
    正式模式永遠 fail closed。
    """
    if secret():
        return False
    return os.environ.get(LEGACY_ENV_FLAG, "") == "1"


def auth_mode() -> str:
    """健康端點回報用：signed / unsigned_legacy / fail_closed。"""
    if secret():
        return "signed"
    if legacy_allowed():
        return "unsigned_legacy"
    return "fail_closed"


def ledger_path() -> str:
    return live_assertions.default_ledger_path()


def ledger() -> live_assertions.SqliteReplayLedger:
    path = ledger_path()
    existing = _LEDGERS.get(path)
    if existing is None:
        existing = live_assertions.SqliteReplayLedger(path)
        _LEDGERS[path] = existing
    return existing


def _request_body(request, body=None) -> bytes | None:
    """取得 raw request body（bytes）。

    Starlette 在 ``await request.body()`` 後會把結果快取在 ``_body``；同步的
    :func:`verify` 只能讀這個快取值。呼叫端應改用 :func:`verify_async`，
    或在非 Starlette 的假請求物件上直接提供 ``body`` 屬性。
    """
    if body is not None:
        return body.encode("utf-8") if isinstance(body, str) else body
    for name in ("_body", "body", "body_bytes"):
        value = getattr(request, name, None)
        if isinstance(value, bytes):
            return value
        if isinstance(value, str):
            return value.encode("utf-8")
    return None


def _request_method(request) -> str:
    return str(getattr(request, "method", "") or "").upper()


def _request_path(request) -> str:
    url = getattr(request, "url", None)
    path = getattr(url, "path", None)
    if path:
        return str(path)
    return str(getattr(request, "path", "") or "")


def _remember_identity(request, claims: dict) -> None:
    state = getattr(request, "state", None)
    if state is not None:
        try:
            state.fde_live_identity = claims
        except Exception:  # pragma: no cover - 只作為額外快取
            pass
    try:
        setattr(request, _IDENTITY_ATTR, claims)
    except Exception:  # pragma: no cover - 只作為額外快取
        pass


def _cached_claims(request):
    state = getattr(request, "state", None)
    claims = getattr(state, "fde_live_identity", None) if state is not None else None
    if isinstance(claims, dict):
        return claims
    claims = getattr(request, _IDENTITY_ATTR, None)
    return claims if isinstance(claims, dict) else None


def identity_from_request(request) -> dict | None:
    """從**已驗證的** Assertion claims 取出身分；標頭一律不採用。"""
    claims = _cached_claims(request)
    if not claims:
        return None
    role = str(claims.get("role") or "")
    subject = str(claims.get("sub") or "")
    teacher_id = ""
    student_id = ""
    if ":" in subject:
        prefix, _, value = subject.partition(":")
        if prefix == "teacher":
            teacher_id = value
        elif prefix == "student":
            student_id = value
    return {
        "role": role,
        "sub": subject,
        "teacher_id": teacher_id,
        "student_id": student_id,
        "enrollment_id": claims.get("enrollment_id", 0),
        "cohort_ids": list(claims.get("cohort_ids") or []),
    }


def verify(request, body: bytes | None = None) -> tuple[bool, str]:
    """驗證內部呼叫。回傳 ``(trusted, reason)``。"""
    key = secret()
    token = ""
    headers = getattr(request, "headers", None)
    if headers is not None:
        try:
            token = (headers.get(ASSERTION_HEADER) or "").strip()
        except Exception:  # pragma: no cover - 非標準 headers 物件
            token = ""
    if not token:
        # 相容模式：僅在明確設定 FDE_ALLOW_UNSIGNED_LEGACY=1 時接受無 Assertion。
        if legacy_allowed():
            return True, REASON_UNSIGNED_LEGACY
        if not key:
            return False, REASON_SECRET_NOT_CONFIGURED
        return False, REASON_ASSERTION_REQUIRED
    if not key:
        return False, REASON_SECRET_NOT_CONFIGURED
    try:
        claims = live_assertions.verify_live_assertion(token, key)
    except ValueError as error:
        return False, str(error) or REASON_INVALID

    if str(claims.get("method") or "").upper() != _request_method(request):
        return False, REASON_METHOD_MISMATCH
    if str(claims.get("path") or "") != _request_path(request):
        return False, REASON_PATH_MISMATCH
    raw_body = _request_body(request, body)
    if raw_body is None:
        return False, REASON_BODY_UNAVAILABLE
    if str(claims.get("body_sha256") or "") != live_assertions.body_sha256(raw_body):
        return False, REASON_BODY_TAMPERED

    if not ledger().check_and_record(str(claims.get("jti") or ""), int(claims.get("exp") or 0)):
        return False, REASON_REPLAY

    _remember_identity(request, claims)
    return True, REASON_OK


async def verify_async(request) -> tuple[bool, str]:
    """ASGI 版本：先把 raw body 讀出（Starlette 會快取到 ``_body``）再驗證。"""
    body = None
    reader = getattr(request, "body", None)
    if callable(reader):
        try:
            body = await reader()
        except Exception:  # pragma: no cover - 讀不到就走 fail closed
            body = None
    return verify(request, body=body)
