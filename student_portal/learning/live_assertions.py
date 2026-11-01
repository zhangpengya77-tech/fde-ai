"""Django 與 Live Backend 間的短效可信身分 Assertion（P6 合約）。

與 ``live_backend/app/live_assertions.py`` 使用**完全相同**的 token 格式與
欄位定義，兩邊任何一處改動都必須同步，否則跨元件驗證會失敗
（見 live_backend/tests/test_p3d_gateway_identity.py 的跨元件契約測試）。

格式：``v1.<b64url(canonical_payload_json)>.<b64url(hmac_sha256)>``
必備欄位：v / iss / aud / sub / role / enrollment_id / cohort_ids /
method / path / body_sha256 / iat / exp / jti（exp - iat <= 60）。
"""

import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid


# 2026-10-29（P7-A）：此常數原本只定義在 live_backend/app/live_assertions.py，
# 但 student_portal/learning/internal_auth.py:21 會讀取它，導致 Django 應用
# 在 import 階段就 AttributeError（無法啟動）。兩端標頭名必須完全一致，
# 因此在此補上同一常數；值與 Live 側相同，不改變任何行為。
ASSERTION_HEADER = "X-FDE-Live-Assertion"
ASSERTION_VERSION = 1
ASSERTION_VERSION_PREFIX = "v1"
ASSERTION_ISSUER = "fde-django"
ASSERTION_AUDIENCE = "fde-live"
MAX_TTL_SECONDS = 60
MAX_FUTURE_SKEW_SECONDS = 5
EMPTY_BODY_SHA256 = hashlib.sha256(b"").hexdigest()

REQUIRED_CLAIMS = (
    "v",
    "iss",
    "aud",
    "sub",
    "role",
    "enrollment_id",
    "cohort_ids",
    "method",
    "path",
    "body_sha256",
    "iat",
    "exp",
    "jti",
)

ROLES = ("teacher", "student")

REASON_MALFORMED = "malformed_assertion"
REASON_VERSION = "unsupported_version"
REASON_ISSUER = "bad_issuer"
REASON_AUDIENCE = "bad_audience"
REASON_SIGNATURE = "bad_signature"
REASON_EXPIRED = "expired_assertion"
REASON_FUTURE = "future_assertion"
REASON_TTL = "ttl_too_long"
REASON_MISSING = "missing_claim"
REASON_INVALID = "invalid_claim"
REASON_NO_KEY = "assertion_key_missing"


class LiveAssertionError(ValueError):
    """Assertion 缺欄位、簽章錯誤或已過期時使用。"""


def body_sha256(data=b"") -> str:
    return hashlib.sha256(data or b"").hexdigest()


def canonical_payload(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value):
    if not isinstance(value, str) or not value or any(char.isspace() for char in value):
        raise LiveAssertionError(REASON_MALFORMED)
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, TypeError) as error:
        raise LiveAssertionError(REASON_MALFORMED) from error


def _secret_bytes(secret):
    if not isinstance(secret, str) or not secret.strip():
        raise LiveAssertionError(REASON_NO_KEY)
    return secret.encode("utf-8")


def _sorted_cohort_ids(values):
    return sorted(list(values), key=str)


def _validate_shape(payload, now):
    for name in REQUIRED_CLAIMS:
        if name not in payload:
            raise LiveAssertionError(REASON_MISSING)
    if payload["v"] != ASSERTION_VERSION:
        raise LiveAssertionError(REASON_VERSION)
    if payload["iss"] != ASSERTION_ISSUER:
        raise LiveAssertionError(REASON_ISSUER)
    if payload["aud"] != ASSERTION_AUDIENCE:
        raise LiveAssertionError(REASON_AUDIENCE)
    role = payload["role"]
    subject = payload["sub"]
    if role not in ROLES or not isinstance(subject, str) or not subject.startswith(f"{role}:"):
        raise LiveAssertionError(REASON_INVALID)
    cohort_ids = payload["cohort_ids"]
    if not isinstance(cohort_ids, list):
        raise LiveAssertionError(REASON_INVALID)
    for item in cohort_ids:
        if isinstance(item, bool) or not isinstance(item, (str, int)):
            raise LiveAssertionError(REASON_INVALID)
        if isinstance(item, str) and not item:
            raise LiveAssertionError(REASON_INVALID)
    enrollment_id = payload["enrollment_id"]
    if isinstance(enrollment_id, bool) or not isinstance(enrollment_id, int):
        raise LiveAssertionError(REASON_INVALID)
    if role == "student" and enrollment_id <= 0:
        raise LiveAssertionError(REASON_INVALID)
    for name in ("method", "path", "body_sha256", "jti"):
        if not isinstance(payload[name], str) or not payload[name]:
            raise LiveAssertionError(REASON_INVALID)
    for name in ("iat", "exp"):
        if isinstance(payload[name], bool) or not isinstance(payload[name], int):
            raise LiveAssertionError(REASON_INVALID)
    if payload["exp"] <= now:
        raise LiveAssertionError(REASON_EXPIRED)
    if payload["iat"] > now + MAX_FUTURE_SKEW_SECONDS:
        raise LiveAssertionError(REASON_FUTURE)
    if payload["exp"] - payload["iat"] > MAX_TTL_SECONDS:
        raise LiveAssertionError(REASON_TTL)


def _signature(secret, payload_segment):
    return _encode(hmac.new(_secret_bytes(secret), f"{ASSERTION_VERSION_PREFIX}.{payload_segment}".encode("ascii"), hashlib.sha256).digest())


def issue_assertion(claims, secret, *, now=None, ttl_seconds=MAX_TTL_SECONDS):
    """簽發最多 60 秒、固定 issuer 與 audience 的 P6 compact Assertion。"""
    issued_at = int(time.time() if now is None else now)
    ttl = int(ttl_seconds)
    if ttl < 1 or ttl > MAX_TTL_SECONDS:
        raise LiveAssertionError(REASON_TTL)
    payload = {
        "v": ASSERTION_VERSION,
        "iss": ASSERTION_ISSUER,
        "aud": ASSERTION_AUDIENCE,
        "sub": "",
        "role": "",
        "enrollment_id": 0,
        "cohort_ids": [],
        "method": "GET",
        "path": "/",
        "body_sha256": EMPTY_BODY_SHA256,
        "iat": issued_at,
        "exp": issued_at + ttl,
        "jti": uuid.uuid4().hex,
    }
    payload.update(claims)
    payload["cohort_ids"] = _sorted_cohort_ids(payload.get("cohort_ids") or [])
    if isinstance(payload.get("method"), str):
        payload["method"] = payload["method"].upper()
    if int(payload["exp"]) - int(payload["iat"]) > MAX_TTL_SECONDS:
        raise LiveAssertionError(REASON_TTL)
    segment = _encode(canonical_payload(payload))
    return f"{ASSERTION_VERSION_PREFIX}.{segment}.{_signature(secret, segment)}"


def verify_assertion(token, secret, *, now=None):
    """驗證 HMAC、版本、issuer、audience、短效期限與必備欄位。"""
    if not isinstance(token, str) or token.count(".") != 2:
        raise LiveAssertionError(REASON_MALFORMED)
    version_segment, payload_segment, provided_signature = token.split(".", 2)
    if version_segment != ASSERTION_VERSION_PREFIX:
        raise LiveAssertionError(REASON_VERSION)
    expected_signature = _signature(secret, payload_segment)
    if not hmac.compare_digest(expected_signature, provided_signature):
        raise LiveAssertionError(REASON_SIGNATURE)
    try:
        payload = json.loads(_decode(payload_segment).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LiveAssertionError(REASON_MALFORMED) from error
    if not isinstance(payload, dict):
        raise LiveAssertionError(REASON_MALFORMED)
    _validate_shape(payload, int(time.time() if now is None else now))
    return payload
