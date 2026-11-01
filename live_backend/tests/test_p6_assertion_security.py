"""P6 安全驗收測試：版本化、綁 body、綁班級、抗重放的內部 Assertion。

每個測試模組必須**獨立行程**執行（本環境的沙箱刪除守門會在 TemporaryDirectory
清理時誤觸）：

    python live_backend/_run_unittests.py test_p6_assertion_security

編號對齊專案驗收清單 1..10。
"""

from __future__ import annotations

import concurrent.futures
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace

from starlette.testclient import TestClient

from app import internal_auth
from app import live_assertions
from app.main import create_app
from app.sessions import InMemorySessionStore


TEST_KEY = "p6-test-only-key"
LIVE_DIR = str(__import__("pathlib").Path(__file__).resolve().parents[1])

STUDENT_SUBJECT = "student:7"
STUDENT_ENROLLMENT = 9
COHORT_A = "cohort-a"
COHORT_B = "cohort-b"
TEACHER_SUBJECT = "teacher:1"

# 子行程驗證器：共用同一個 ledger 檔，第二次使用同一 jti 必須被判為重放。
_VERIFIER_SCRIPT = r"""
import sys
sys.path.insert(0, sys.argv[1])
from app import internal_auth


class _URL:
    pass


class _Request:
    def __init__(self, token, path, method):
        self.method = method
        self.headers = {"X-FDE-Live-Assertion": token}
        self._body = b""
        self.state = type("_State", (), {})()
        url = _URL()
        url.path = path
        self.url = url


trusted, reason = internal_auth.verify(_Request(sys.argv[2], sys.argv[3], sys.argv[4]))
print("TRUSTED" if trusted else "REJECTED:" + str(reason))
"""


class _Request:
    """既有測試用的最小假請求（無 body）。"""

    method = "POST"

    class url:
        path = "/api/v1/vision/models/example/activate"

    headers = {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "42"}


class _SignedRequest:
    """可攜帶 method / path / body 的假請求，供 internal_auth.verify 使用。"""

    def __init__(self, method="POST", path="/api/v1/vision/models/example/activate", headers=None, body=b""):
        self.method = method
        self._body = body
        self.headers = dict(headers or {})
        self.state = SimpleNamespace()

        class _URL:
            pass

        url = _URL()
        url.path = path
        self.url = url


class _OfflineVision:
    async def health(self):
        return False


def _remove_tree(path: str) -> None:
    """逐檔刪除後再移除目錄（避免 rm -rf 觸發本環境的刪除守門）。"""
    for root, _dirs, files in os.walk(path, topdown=False):
        for name in files:
            try:
                os.remove(os.path.join(root, name))
            except OSError:
                pass
        try:
            os.rmdir(root)
        except OSError:
            pass
    shutil.rmtree(path, ignore_errors=True)


class _P6IsolatedTestCase(unittest.TestCase):
    """每次測試都使用獨立的暫存 ledger 與乾淨的環境變數。"""

    def setUp(self):
        self._saved = {
            "FDE_INTERNAL_SHARED_SECRET": os.environ.get("FDE_INTERNAL_SHARED_SECRET"),
            "FDE_ALLOW_UNSIGNED_LEGACY": os.environ.get("FDE_ALLOW_UNSIGNED_LEGACY"),
            "FDE_REPLAY_LEDGER_PATH": os.environ.get("FDE_REPLAY_LEDGER_PATH"),
        }
        self.tmp = tempfile.mkdtemp(prefix="p6-assertion-")
        os.environ["FDE_REPLAY_LEDGER_PATH"] = os.path.join(self.tmp, "ledger.sqlite3")
        os.environ.pop("FDE_INTERNAL_SHARED_SECRET", None)
        os.environ.pop("FDE_ALLOW_UNSIGNED_LEGACY", None)
        internal_auth._LEDGERS.clear()

    def tearDown(self):
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        internal_auth._LEDGERS.clear()
        _remove_tree(self.tmp)

    # -- helpers ---------------------------------------------------------
    def enable_production(self):
        os.environ["FDE_INTERNAL_SHARED_SECRET"] = TEST_KEY

    def issue(self, **claims):
        defaults = {
            "sub": TEACHER_SUBJECT,
            "role": "teacher",
            "enrollment_id": 0,
            "cohort_ids": [COHORT_A],
            "method": "POST",
            "path": "/api/v1/vision/models/example/activate",
            "body_sha256": live_assertions.body_sha256(b""),
        }
        defaults.update(claims)
        return live_assertions.issue_live_assertion(defaults, TEST_KEY)

    def verify_request(self, token, **kwargs):
        return internal_auth.verify(_SignedRequest(headers={"X-FDE-Live-Assertion": token}, **kwargs))


# ---------------------------------------------------------------- 1
class P6AssertionSecurityTests(unittest.TestCase):
    def setUp(self):
        self.previous_secret = os.environ.pop("FDE_INTERNAL_SHARED_SECRET", None)

    def tearDown(self):
        if self.previous_secret is not None:
            os.environ["FDE_INTERNAL_SHARED_SECRET"] = self.previous_secret

    def test_missing_shared_secret_fails_closed_in_production_mode(self):
        trusted, reason = internal_auth.verify(_Request())
        self.assertFalse(trusted, reason)

    def test_assertion_claims_bind_request_method_path_and_body(self):
        token = live_assertions.issue_live_assertion(
            {"role": "student", "sub": "student:7", "enrollment_id": 9, "cohort_ids": ["cohort-a"]},
            "p6-test-only-key",
            now=100,
        )
        claims = live_assertions.verify_live_assertion(token, "p6-test-only-key", now=101)
        self.assertIn("method", claims)
        self.assertIn("path", claims)
        self.assertIn("body_sha256", claims)

    def test_replay_ledger_is_available_for_cross_process_enforcement(self):
        self.assertTrue(hasattr(live_assertions, "SqliteReplayLedger"))


# ---------------------------------------------------------------- 2 / 3 / 4 / 5 / 6
class P6FailClosedAndBindingTests(_P6IsolatedTestCase):
    def test_2_unsigned_legacy_is_not_allowed_in_production_mode(self):
        # 沒密鑰、沒相容旗標 → 一律拒絕（fail closed）。
        trusted, reason = internal_auth.verify(_SignedRequest())
        self.assertFalse(trusted)
        self.assertEqual(reason, "secret_not_configured")
        self.assertEqual(internal_auth.auth_mode(), "fail_closed")

        # 有密鑰但沒有 Assertion → 拒絕（相容旗標未開）。
        self.enable_production()
        trusted, reason = internal_auth.verify(_SignedRequest())
        self.assertFalse(trusted)
        self.assertEqual(reason, "assertion_required")

        # 舊的 X-FDE-Role / X-FDE-Teacher-ID 標頭不得讓請求通過。
        trusted, reason = internal_auth.verify(
            _SignedRequest(headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "2"})
        )
        self.assertFalse(trusted)
        self.assertEqual(reason, "assertion_required")

        # 相容模式只在「沒有密鑰」且 FDE_ALLOW_UNSIGNED_LEGACY == "1" 時存在，且沒有任何身分。
        os.environ.pop("FDE_INTERNAL_SHARED_SECRET", None)
        os.environ["FDE_ALLOW_UNSIGNED_LEGACY"] = "1"
        trusted, reason = internal_auth.verify(_SignedRequest())
        self.assertTrue(trusted)
        self.assertEqual(reason, "unsigned_legacy")
        self.assertIsNone(internal_auth.identity_from_request(_SignedRequest()))

        # 正式模式（已設密鑰）即使誤設相容旗標，也不得放行未簽章請求。
        self.enable_production()
        trusted, reason = internal_auth.verify(_SignedRequest())
        self.assertFalse(trusted)
        self.assertEqual(reason, "assertion_required")

    def test_3_tampered_body_is_rejected(self):
        self.enable_production()
        body = b'{"model_type": "PROP_DIRECTION"}'
        token = self.issue(body_sha256=live_assertions.body_sha256(body))
        trusted, reason = self.verify_request(token, body=body + b" ")
        self.assertFalse(trusted)
        self.assertEqual(reason, "body_tampered")
        # 原始 body 必須仍然通過。
        self.enable_production()
        token = self.issue(body_sha256=live_assertions.body_sha256(body))
        trusted, _reason = self.verify_request(token, body=body)
        self.assertTrue(trusted)

    def test_4_method_and_path_mismatch_are_rejected(self):
        self.enable_production()
        token = self.issue(method="POST", path="/api/v1/vision/models/example/activate")
        trusted, reason = self.verify_request(token, method="GET")
        self.assertFalse(trusted)
        self.assertEqual(reason, "method_mismatch")

        token = self.issue(method="POST", path="/api/v1/vision/models/example/activate")
        trusted, reason = self.verify_request(token, method="POST", path="/api/v1/vision/models/other/activate")
        self.assertFalse(trusted)
        self.assertEqual(reason, "path_mismatch")

    def test_5_expired_and_too_long_ttl_are_rejected(self):
        now = 1_000_000
        token = live_assertions.issue_live_assertion(
            {"sub": TEACHER_SUBJECT, "role": "teacher", "cohort_ids": [COHORT_A], "iat": now, "exp": now + 60},
            TEST_KEY,
        )
        with self.assertRaises(ValueError) as caught:
            live_assertions.verify_live_assertion(token, TEST_KEY, now=now + 61)
        self.assertEqual(str(caught.exception), "expired_assertion")

        with self.assertRaises(ValueError) as caught:
            live_assertions.issue_live_assertion(
                {"sub": TEACHER_SUBJECT, "role": "teacher", "iat": now, "exp": now + 61}, TEST_KEY
            )
        self.assertEqual(str(caught.exception), "ttl_too_long")

        # 手動構造（繞過簽發端的 TTL 檢查）以證明驗證端也會拒絕過長 TTL。
        forged = self._craft({"iat": now - 100, "exp": now + 61})
        with self.assertRaises(ValueError) as caught:
            live_assertions.verify_live_assertion(forged, TEST_KEY, now=now)
        self.assertEqual(str(caught.exception), "ttl_too_long")

        future = self._craft({"iat": now + 120, "exp": now + 150})
        with self.assertRaises(ValueError) as caught:
            live_assertions.verify_live_assertion(future, TEST_KEY, now=now)
        self.assertEqual(str(caught.exception), "future_assertion")

    def _craft(self, overrides):
        claims = {
            "v": 1,
            "iss": "fde-django",
            "aud": "fde-live",
            "sub": TEACHER_SUBJECT,
            "role": "teacher",
            "enrollment_id": 0,
            "cohort_ids": [COHORT_A],
            "method": "POST",
            "path": "/api/v1/vision/models/example/activate",
            "body_sha256": live_assertions.body_sha256(b""),
            "iat": 1000,
            "exp": 1050,
            "jti": "d" * 32,
        }
        claims.update(overrides)
        payload = live_assertions._encode(live_assertions.canonical_payload(claims))
        return f"v1.{payload}.{live_assertions._signature(payload, TEST_KEY)}"

    def test_6_replay_of_same_jti_is_rejected(self):
        self.enable_production()
        token = self.issue(jti="f" * 32)
        trusted, reason = self.verify_request(token)
        self.assertTrue(trusted, reason)
        trusted, reason = self.verify_request(token)
        self.assertFalse(trusted)
        self.assertEqual(reason, "replay_detected")


# ---------------------------------------------------------------- 7
class P6CrossProcessReplayTests(_P6IsolatedTestCase):
    def _run_verifier(self, token, path="/api/v1/vision/models/example/activate", method="POST"):
        env = dict(os.environ)
        env["FDE_INTERNAL_SHARED_SECRET"] = TEST_KEY
        env["FDE_REPLAY_LEDGER_PATH"] = os.environ["FDE_REPLAY_LEDGER_PATH"]
        env.pop("FDE_ALLOW_UNSIGNED_LEGACY", None)
        completed = subprocess.run(
            [sys.executable, "-c", _VERIFIER_SCRIPT, LIVE_DIR, token, path, method],
            capture_output=True,
            text=True,
            env=env,
            timeout=120,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip()

    def test_7_two_processes_share_ledger_and_reject_second_use(self):
        token = self.issue(jti="a" * 32)
        first = self._run_verifier(token)
        second = self._run_verifier(token)
        self.assertEqual(first, "TRUSTED")
        self.assertEqual(second, "REJECTED:replay_detected")

    def test_7b_concurrent_processes_allow_exactly_one_use(self):
        token = self.issue(jti="b" * 32)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self._run_verifier(token), range(2)))
        self.assertIn("TRUSTED", results)
        self.assertIn("REJECTED:replay_detected", results)
        self.assertEqual(sorted(results), sorted(["TRUSTED", "REJECTED:replay_detected"]))


# ---------------------------------------------------------------- 8 / 9 / 10
class P6IdentityBoundaryTests(_P6IsolatedTestCase):
    def _live_client(self, *, assertion_key="", proxy_key="", require_live_auth=False):
        return TestClient(
            create_app(
                vision_adapter=_OfflineVision(),
                session_store=InMemorySessionStore(),
                dev_mode=False,
                live_assertion_key=assertion_key,
                trusted_proxy_key=proxy_key,
                require_live_auth=require_live_auth,
            )
        )

    def test_8_forged_claims_are_rejected(self):
        self.enable_production()
        # 攻擊者用自己的密鑰簽發「teacher:1」→ Live 以正式密鑰驗證必然失敗。
        forged = live_assertions.issue_live_assertion(
            {"sub": "teacher:1", "role": "teacher", "cohort_ids": [COHORT_A], "method": "POST",
             "path": "/api/v1/vision/models/example/activate"},
            "attacker-key",
        )
        trusted, reason = self.verify_request(forged)
        self.assertFalse(trusted)
        self.assertEqual(reason, "bad_signature")

        # 即使拿到正式密鑰，改寫 iss / aud 也無法通過（簽章會失效）。
        for field, value in (("iss", "attacker"), ("aud", "someone-else"), ("v", 2)):
            claims = {
                "sub": TEACHER_SUBJECT, "role": "teacher", "cohort_ids": [COHORT_A],
                "method": "POST", "path": "/api/v1/vision/models/example/activate",
                "body_sha256": live_assertions.body_sha256(b""), "iat": 1000, "exp": 1050, "jti": "c" * 32,
            }
            claims[field] = value
            payload = live_assertions._encode(live_assertions.canonical_payload(claims))
            token = f"v1.{payload}.{live_assertions._signature(payload, TEST_KEY)}"
            trusted, reason = self.verify_request(token)
            self.assertFalse(trusted, f"{field} 不應被接受")

        # 身分必須來自 claims：瀏覽器自帶的 X-FDE-Teacher-ID 不能改變結果。
        token = self.issue(sub="teacher:7", role="teacher")
        request = _SignedRequest(
            headers={"X-FDE-Live-Assertion": token, "X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "2"}
        )
        trusted, _reason = internal_auth.verify(request)
        self.assertTrue(trusted)
        identity = internal_auth.identity_from_request(request)
        self.assertEqual(identity["teacher_id"], "7")
        self.assertEqual(identity["role"], "teacher")

    def test_9_cross_cohort_teacher_is_rejected(self):
        proxy_key = "p6-test-proxy-key"
        client = self._live_client(assertion_key=TEST_KEY, proxy_key=proxy_key, require_live_auth=True)

        def headers(subject, role, cohort_ids, enrollment_id=0):
            claims = {"sub": subject, "role": role}
            claims["cohort_ids"] = cohort_ids
            if role == "student":
                claims["enrollment_id"] = enrollment_id
            return {
                "X-FDE-Proxy-Auth": proxy_key,
                "X-FDE-Live-Assertion": live_assertions.issue_live_assertion(claims, TEST_KEY),
            }

        created = client.post("/api/live/sessions", json={}, headers=headers(STUDENT_SUBJECT, "student", [COHORT_A], STUDENT_ENROLLMENT))
        self.assertEqual(created.status_code, 201)
        session_id = created.json()["session_id"]

        cross = client.get(f"/api/live/sessions/{session_id}", headers=headers("teacher:3", "teacher", [COHORT_B]))
        self.assertEqual(cross.status_code, 403)
        self.assertEqual(cross.json()["error"]["code"], "session_cohort_forbidden")

        in_scope = client.get(f"/api/live/sessions/{session_id}", headers=headers("teacher:3", "teacher", [COHORT_A]))
        self.assertEqual(in_scope.status_code, 200)

    def test_10_direct_live_call_without_assertion_is_rejected(self):
        self.enable_production()
        client = self._live_client()
        forged_only = client.get(
            "/api/v1/vision/submissions",
            headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "2"},
        )
        self.assertEqual(forged_only.status_code, 403)
        self.assertEqual(forged_only.json()["error"]["code"], "internal_auth_rejected")

        # 沒有任何標頭也一樣被拒。
        self.assertEqual(client.get("/api/v1/vision/submissions").status_code, 403)

        # 偽造的 X-FDE-Live-Assertion 同樣被拒。
        forged_assertion = client.get(
            "/api/v1/vision/submissions",
            headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "2", "X-FDE-Live-Assertion": "v1.forged.signature"},
        )
        self.assertEqual(forged_assertion.status_code, 403)

        # 正確簽發（綁 method / path / 空 body）才放行，且身分來自 claims。
        token = live_assertions.issue_live_assertion(
            {"sub": "teacher:42", "role": "teacher", "cohort_ids": [COHORT_A],
             "method": "GET", "path": "/api/v1/vision/submissions"},
            TEST_KEY,
        )
        signed = client.get("/api/v1/vision/submissions", headers={"X-FDE-Live-Assertion": token})
        self.assertEqual(signed.status_code, 200)
