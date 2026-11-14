"""Gateway 單元測試：票證驗證、隊形偏移（不需要 SITL）。執行：python -m unittest gcs-gateway/test_gateway.py"""
import base64
import hashlib
import hmac
import json
import time
import unittest

from fde_gcs_gateway import formation_offsets, verify_ticket

SECRET = b"test-secret-0123456789"


def make(claims, secret=SECRET):
    body = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    sig = base64.urlsafe_b64encode(hmac.new(secret, body.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    return f"{body}.{sig}"


def claims(**kw):
    now = time.time()
    c = {"v": 1, "inst": "sitl-fleet", "scope": "read", "sub": 7, "iat": now, "exp": now + 600, "jti": "abc"}
    c.update(kw)
    return c


class TicketTests(unittest.TestCase):
    def test_valid_read_and_control(self):
        self.assertEqual(verify_ticket(make(claims()), SECRET, set(), 0)["scope"], "read")
        self.assertEqual(verify_ticket(make(claims(scope="control")), SECRET, set(), 0)["scope"], "control")

    def test_rejects_bad_signature_expired_revoked_and_scope(self):
        self.assertIsNone(verify_ticket(make(claims(), b"other-secret-000000"), SECRET, set(), 0))
        self.assertIsNone(verify_ticket(make(claims(exp=time.time() - 1)), SECRET, set(), 0))
        self.assertIsNone(verify_ticket(make(claims()), SECRET, {"abc"}, 0))
        self.assertIsNone(verify_ticket(make(claims(scope="admin")), SECRET, set(), 0))
        self.assertIsNone(verify_ticket(make(claims(inst="real")), SECRET, set(), 0))
        self.assertIsNone(verify_ticket("garbage", SECRET, set(), 0))

    def test_revoke_all_only_affects_older_control_tickets(self):
        t = time.time()
        self.assertIsNone(verify_ticket(make(claims(scope="control", iat=t - 10)), SECRET, set(), t))
        self.assertIsNotNone(verify_ticket(make(claims(scope="read", iat=t - 10)), SECRET, set(), t))
        self.assertIsNotNone(verify_ticket(make(claims(scope="control", iat=t + 1)), SECRET, set(), t))


class FormationTests(unittest.TestCase):
    def test_shapes(self):
        line = formation_offsets("line", 3, 3, 0)
        self.assertAlmostEqual(line[2][0], 6)
        tri = formation_offsets("triangle", 3, 3, 0)
        self.assertAlmostEqual(tri[1][0], -3)
        self.assertAlmostEqual(tri[2][1], -3)
        col = formation_offsets("column", 2, 5, 90)
        self.assertAlmostEqual(col[1][0], -5)


if __name__ == "__main__":
    unittest.main()
