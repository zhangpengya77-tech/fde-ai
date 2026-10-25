"""驗證 Django 簽發給 Live Backend 的短效身分 Assertion。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time


ASSERTION_VERSION = "v1"
ASSERTION_ISSUER = "fde-v2-django"
ASSERTION_AUDIENCE = "fde-live"
MAX_TTL_SECONDS = 60


class LiveAssertionError(ValueError):
    """Assertion 缺失、過期或簽章無效時使用。"""


def _canonical_json(value: dict) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    if not value or any(char.isspace() for char in value):
        raise LiveAssertionError("invalid_assertion")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _validate(claims: dict, now: int) -> None:
    if claims.get("ver") != ASSERTION_VERSION or claims.get("iss") != ASSERTION_ISSUER or claims.get("aud") != ASSERTION_AUDIENCE:
        raise LiveAssertionError("invalid_assertion")
    role = claims.get("role")
    subject = claims.get("sub")
    if role not in {"student", "teacher"} or not isinstance(subject, str) or not subject.startswith(f"{role}:"):
        raise LiveAssertionError("invalid_assertion")
    if not isinstance(claims.get("cohort_ids"), list) or not all(isinstance(item, str) and item for item in claims["cohort_ids"]):
        raise LiveAssertionError("invalid_assertion")
    # Django Enrollment 主鍵為整數；Live 必須使用相同協定而非將 DB 主鍵轉成字串。
    if role == "student" and (not isinstance(claims.get("enrollment_id"), int) or claims["enrollment_id"] <= 0):
        raise LiveAssertionError("invalid_assertion")
    if not isinstance(claims.get("iat"), int) or not isinstance(claims.get("exp"), int) or not isinstance(claims.get("jti"), str):
        raise LiveAssertionError("invalid_assertion")
    if claims["iat"] > now or claims["exp"] <= now or claims["exp"] - claims["iat"] > MAX_TTL_SECONDS:
        raise LiveAssertionError("expired_assertion")


def issue_live_assertion(claims: dict, secret: str, *, now: int | None = None) -> str:
    """僅供隔離測試建立與 Django 協定相同的短效 Assertion。"""
    issued_at = int(time.time()) if now is None else int(now)
    payload = dict(claims)
    payload.update({"ver": ASSERTION_VERSION, "iss": ASSERTION_ISSUER, "aud": ASSERTION_AUDIENCE, "iat": issued_at, "exp": issued_at + MAX_TTL_SECONDS, "jti": secrets.token_urlsafe(18)})
    body = _encode(_canonical_json(payload))
    signature = _encode(hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{signature}"


def verify_live_assertion(token: str, secret: str, *, now: int | None = None) -> dict:
    """驗證簽章與所有固定 Claim，任何例外都拒絕請求。"""
    try:
        body, provided_signature = token.split(".", 1)
        expected_signature = _encode(hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(provided_signature, expected_signature):
            raise LiveAssertionError("invalid_assertion")
        claims = json.loads(_decode(body).decode("utf-8"))
        if not isinstance(claims, dict):
            raise LiveAssertionError("invalid_assertion")
        _validate(claims, int(time.time()) if now is None else int(now))
        return claims
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as error:
        if isinstance(error, LiveAssertionError):
            raise
        raise LiveAssertionError("invalid_assertion") from error
