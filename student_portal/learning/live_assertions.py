"""Django 與 Live Backend 間的短效可信身分 Assertion。"""

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
    """Assertion 缺欄位、簽章錯誤或已過期時使用。"""


def _encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value):
    if not isinstance(value, str) or not value:
        raise LiveAssertionError("invalid_assertion_encoding")
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, UnicodeEncodeError) as error:
        raise LiveAssertionError("invalid_assertion_encoding") from error


def _canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _secret_bytes(secret):
    if not isinstance(secret, str) or not secret.strip():
        raise LiveAssertionError("assertion_signing_unavailable")
    return secret.encode("utf-8")


def _validate_claims(claims, now):
    if not isinstance(claims, dict):
        raise LiveAssertionError("invalid_assertion_claims")
    role = claims.get("role")
    subject = claims.get("sub")
    cohort_ids = claims.get("cohort_ids")
    if role not in {"student", "teacher"}:
        raise LiveAssertionError("invalid_assertion_role")
    if not isinstance(subject, str) or not subject.startswith(f"{role}:"):
        raise LiveAssertionError("invalid_assertion_subject")
    if not isinstance(cohort_ids, list) or not cohort_ids or not all(isinstance(item, str) and item for item in cohort_ids):
        raise LiveAssertionError("invalid_assertion_cohorts")
    if role == "student" and (not isinstance(claims.get("enrollment_id"), int) or claims["enrollment_id"] <= 0):
        raise LiveAssertionError("invalid_assertion_enrollment")
    if claims.get("iss") != ASSERTION_ISSUER or claims.get("aud") != ASSERTION_AUDIENCE or claims.get("ver") != ASSERTION_VERSION:
        raise LiveAssertionError("invalid_assertion_contract")
    if not isinstance(claims.get("iat"), int) or not isinstance(claims.get("exp"), int) or not isinstance(claims.get("jti"), str) or not claims["jti"]:
        raise LiveAssertionError("invalid_assertion_time")
    if claims["iat"] > now or claims["exp"] <= now or claims["exp"] - claims["iat"] > MAX_TTL_SECONDS:
        raise LiveAssertionError("expired_assertion")


def issue_assertion(claims, secret, *, now=None, ttl_seconds=MAX_TTL_SECONDS):
    """簽發最多 60 秒、固定 issuer 與 audience 的 compact Assertion。"""
    issued_at = int(time.time() if now is None else now)
    ttl = int(ttl_seconds)
    if ttl < 1 or ttl > MAX_TTL_SECONDS:
        raise LiveAssertionError("invalid_assertion_ttl")
    payload = dict(claims)
    payload.update({"ver": ASSERTION_VERSION, "iss": ASSERTION_ISSUER, "aud": ASSERTION_AUDIENCE, "iat": issued_at, "exp": issued_at + ttl, "jti": secrets.token_urlsafe(18)})
    _validate_claims(payload, issued_at)
    encoded = _encode(_canonical_json(payload))
    signature = hmac.new(_secret_bytes(secret), encoded.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded}.{_encode(signature)}"


def verify_assertion(token, secret, *, now=None):
    """驗證 HMAC、版本、issuer、audience 與短效期限。"""
    if not isinstance(token, str) or token.count(".") != 1:
        raise LiveAssertionError("invalid_assertion_format")
    encoded, provided_signature = token.split(".", 1)
    expected_signature = hmac.new(_secret_bytes(secret), encoded.encode("ascii"), hashlib.sha256).digest()
    if not hmac.compare_digest(_encode(expected_signature), provided_signature):
        raise LiveAssertionError("invalid_assertion_signature")
    try:
        payload = json.loads(_decode(encoded).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LiveAssertionError("invalid_assertion_payload") from error
    _validate_claims(payload, int(time.time() if now is None else now))
    return payload
