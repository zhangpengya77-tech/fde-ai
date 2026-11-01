"""P6：Django 簽發、Live 驗證的短效內部身分 Assertion。

Token 格式（compact、三段的 base64url，無 padding）::

    v1.<b64url(canonical_payload_json)>.<b64url(hmac_sha256)>

簽章輸入為 ``v1.<payload 段>``（版本前綴 + payload 段），密鑰為
``FDE_INTERNAL_SHARED_SECRET``。Canonical payload 為
``json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)``
的 UTF-8 bytes。

Payload 必備欄位（缺任一欄即拒絕）::

    v            整數版本，固定 1
    iss          簽發者，固定 "fde-django"
    aud          接收者，固定 "fde-live"
    sub          主體字串，例如 "teacher:1" / "student:7"
    role         "teacher" / "student"
    enrollment_id  整數，不適用時為 0
    cohort_ids  字串（或 Django Cohort 主鍵整數）清單，簽發時排序
    method       大寫 HTTP method
    path         請求路徑（不含 query string）
    body_sha256  raw request body 的 hex sha256；空 body 為 sha256(b"")
    iat          簽發時間（epoch 秒）
    exp          到期時間（epoch 秒），exp - iat <= 60
    jti          uuid4 hex（32 字元），供 replay ledger 單次使用

任何驗證失敗都拋出 :class:`LiveAssertionError`（``ValueError`` 子類），
錯誤字串為穩定的 reason code，供 Live 直接回報給呼叫端。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sqlite3
import time
import uuid
from pathlib import Path

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
    """Assertion 缺失、過期、簽章無效或欄位不合法時拋出。"""


def body_sha256(data: bytes = b"") -> str:
    """回傳 request body 的 hex sha256；未給資料時等同 sha256(b"")。"""
    return hashlib.sha256(data or b"").hexdigest()


def canonical_payload(payload: dict) -> bytes:
    """Canonical JSON：sort_keys、無多餘空白、UTF-8。"""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    if not value or any(char.isspace() for char in value):
        raise LiveAssertionError(REASON_MALFORMED)
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, TypeError) as error:  # pragma: no cover - b64 容錯
        raise LiveAssertionError(REASON_MALFORMED) from error


def _signing_input(payload_segment: str) -> str:
    return f"{ASSERTION_VERSION_PREFIX}.{payload_segment}"


def _signature(payload_segment: str, key: str) -> str:
    if not isinstance(key, str) or not key:
        raise LiveAssertionError(REASON_NO_KEY)
    digest = hmac.new(key.encode("utf-8"), _signing_input(payload_segment).encode("ascii"), hashlib.sha256).digest()
    return _encode(digest)


def _sorted_cohort_ids(values) -> list:
    """排序班級清單。

    P3-D 起 Django 以 Cohort 主鍵（整數）表示班級，Live 端班級比對必須維持
    相同型別，因此這裡只排序、不轉型；key=str 讓混和型別也能決定性排序。
    """
    return sorted(list(values), key=str)


def _validate_shape(payload: dict) -> None:
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


def issue_live_assertion(claims: dict, key: str, now: int | None = None) -> str:
    """簽發一個短效 Assertion。

    ``claims`` 覆寫下列預設值：method="GET"、path="/"、body_sha256=sha256(b"")、
    enrollment_id=0、cohort_ids=[]、iss/aud/v 固定值。``now`` 預設為目前 epoch 秒，
    ``exp`` 預設 ``now + 60``；``exp - iat`` 超過 60 秒一律 ValueError（拒絕簽發）。
    """
    if not isinstance(claims, dict):
        raise LiveAssertionError(REASON_INVALID)
    issued_at = int(time.time()) if now is None else int(now)
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
        "exp": issued_at + MAX_TTL_SECONDS,
        "jti": uuid.uuid4().hex,
    }
    payload.update(claims)
    if "cohort_ids" in payload:
        payload["cohort_ids"] = _sorted_cohort_ids(payload["cohort_ids"] or [])
    if isinstance(payload.get("method"), str):
        payload["method"] = payload["method"].upper()
    if payload.get("exp") is not None and payload.get("iat") is not None:
        if int(payload["exp"]) - int(payload["iat"]) > MAX_TTL_SECONDS:
            raise LiveAssertionError(REASON_TTL)
    payload["cohort_ids"] = _sorted_cohort_ids(payload["cohort_ids"])
    segment = _encode(canonical_payload(payload))
    return f"{ASSERTION_VERSION_PREFIX}.{segment}.{_signature(segment, key)}"


def verify_live_assertion(token: str, key: str, now: int | None = None) -> dict:
    """驗證 Assertion；任何一項不符都拋出 LiveAssertionError（stable reason）。"""
    checked_at = int(time.time()) if now is None else int(now)
    if not isinstance(token, str) or not token:
        raise LiveAssertionError(REASON_MALFORMED)
    parts = token.split(".")
    if len(parts) != 3:
        raise LiveAssertionError(REASON_MALFORMED)
    version_segment, payload_segment, signature_segment = parts
    if version_segment != ASSERTION_VERSION_PREFIX:
        raise LiveAssertionError(REASON_VERSION)
    if signature_segment != _signature(payload_segment, key):
        raise LiveAssertionError(REASON_SIGNATURE)
    if not hmac.compare_digest(signature_segment, _signature(payload_segment, key)):
        raise LiveAssertionError(REASON_SIGNATURE)
    try:
        payload = json.loads(_decode(payload_segment).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LiveAssertionError(REASON_MALFORMED) from error
    if not isinstance(payload, dict):
        raise LiveAssertionError(REASON_MALFORMED)
    _validate_shape(payload)
    if payload["exp"] <= checked_at:
        raise LiveAssertionError(REASON_EXPIRED)
    if payload["iat"] > checked_at + MAX_FUTURE_SKEW_SECONDS:
        raise LiveAssertionError(REASON_FUTURE)
    if payload["exp"] - payload["iat"] > MAX_TTL_SECONDS:
        raise LiveAssertionError(REASON_TTL)
    return payload


def default_ledger_path() -> str:
    """預設 replay ledger 位置：Live 資料目錄下方（候選根目錄內）。"""
    configured = (os.environ.get("FDE_REPLAY_LEDGER_PATH") or "").strip()
    if configured:
        return configured
    root = Path(__file__).resolve().parents[2]
    return str(root / "live_backend" / "var" / "p6_replay_ledger.sqlite3")


class SqliteReplayLedger:
    """單次使用 jti 的 SQLite 帳本。

    以 ``BEGIN IMMEDIATE`` + 主鍵唯一插入實作：兩個行程共用同一個檔案時，
    第二個使用同一 jti 的行程一定拿到 IntegrityError（= replay）。
    """

    def __init__(self, path: str | os.PathLike, *, cleanup_every: int = 64, timeout: float = 30.0):
        self.path = str(path)
        self.cleanup_every = max(1, int(cleanup_every))
        self.timeout = timeout
        self._inserts = 0
        parent = Path(self.path).parent
        if str(parent):
            parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=self.timeout, isolation_level=None)
        return connection

    def _ensure_schema(self) -> None:
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("CREATE TABLE IF NOT EXISTS replay (jti TEXT PRIMARY KEY, exp INTEGER NOT NULL)")
            connection.execute("COMMIT")
        finally:
            connection.close()

    def check_and_record(self, jti: str, exp: int) -> bool:
        """回傳 True 表示 jti 首次使用（並已記錄）；False 表示重放。"""
        if not jti:
            return False
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("INSERT INTO replay(jti, exp) VALUES (?, ?)", (str(jti), int(exp)))
            connection.execute("COMMIT")
            fresh = True
        except sqlite3.IntegrityError:
            try:
                connection.execute("ROLLBACK")
            except sqlite3.Error:  # pragma: no cover - 連線已壞則忽略
                pass
            fresh = False
        finally:
            connection.close()
        if fresh:
            self._inserts += 1
            if self._inserts % self.cleanup_every == 0:
                self.cleanup()
        return fresh

    def cleanup(self, now: int | None = None) -> int:
        """刪除已過期的 jti，避免帳本無限成長。回傳刪除筆數。"""
        checked_at = int(time.time()) if now is None else int(now)
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute("DELETE FROM replay WHERE exp <= ?", (checked_at,))
            removed = int(cursor.rowcount or 0)
            connection.execute("COMMIT")
        except sqlite3.Error:  # pragma: no cover - 帳本清理失敗不影響拒絕決策
            return 0
        finally:
            connection.close()
        return removed

    def close(self) -> None:
        """保留給呼叫端明確關閉；目前每次操作都自行開關連線。"""
        return None
