"""P4／S6 多機仿真：票證權限、簽章格式、CSP 與撤銷。"""
import base64
import hashlib
import hmac
import json
import time
from unittest import mock

from django.test import override_settings

from .tests import OPEN_COHORT, GcsTestBase, make_teacher

SECRET = "unit-test-gateway-secret-0123"
TICKET_URL = "/gcs/api/sitl/ticket/"
REVOKE_URL = "/gcs/api/sitl/revoke/"


def decode(ticket):
    body, sig = ticket.split(".")
    pad = lambda s: s + "=" * (-len(s) % 4)  # noqa: E731
    expect = hmac.new(SECRET.encode(), body.encode(), hashlib.sha256).digest()
    assert hmac.compare_digest(expect, base64.urlsafe_b64decode(pad(sig)))
    return json.loads(base64.urlsafe_b64decode(pad(body)))


@override_settings(FDE_GCS_ENABLED=True, FDE_GCS_COHORTS=frozenset({OPEN_COHORT}), FDE_GCS_GATEWAY_SECRET=SECRET)
class SitlTicketTests(GcsTestBase):
    def post(self, url, data):
        return self.client.post(url, data=json.dumps(data), content_type="application/json")

    def test_student_gets_read_ticket_only(self):
        profile = self.make_student("s1@example.com", self.open_cohort)
        self.client.force_login(profile.user)
        res = self.post(TICKET_URL, {"scope": "read"})
        self.assertEqual(res.status_code, 200)
        claims = decode(res.json()["ticket"])
        self.assertEqual((claims["scope"], claims["sub"], claims["inst"]), ("read", profile.user.pk, "sitl-fleet"))
        self.assertAlmostEqual(claims["exp"] - claims["iat"], 600, delta=1)
        self.assertEqual(self.post(TICKET_URL, {"scope": "control"}).status_code, 403)

    def test_teacher_gets_control_ticket(self):
        self.client.force_login(make_teacher())
        res = self.post(TICKET_URL, {"scope": "control"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(decode(res.json()["ticket"])["scope"], "control")
        self.assertEqual(res.json()["gateway_url"], "ws://127.0.0.1:8261")

    def test_rejects_anonymous_outside_cohort_and_bad_scope(self):
        self.assertEqual(self.post(TICKET_URL, {"scope": "read"}).status_code, 401)
        outsider = self.make_student("s2@example.com", self.other_cohort)
        self.client.force_login(outsider.user)
        self.assertEqual(self.post(TICKET_URL, {"scope": "read"}).status_code, 403)
        self.client.force_login(make_teacher())
        self.assertEqual(self.post(TICKET_URL, {"scope": "admin"}).status_code, 400)

    def test_each_ticket_is_unique(self):
        self.client.force_login(make_teacher())
        a = decode(self.post(TICKET_URL, {"scope": "read"}).json()["ticket"])
        b = decode(self.post(TICKET_URL, {"scope": "read"}).json()["ticket"])
        self.assertNotEqual(a["jti"], b["jti"])
        self.assertLessEqual(a["iat"], time.time())

    def test_page_csp_allows_only_gateway_and_scene(self):
        self.client.force_login(make_teacher())
        res = self.client.get("/gcs/")
        csp = res["Content-Security-Policy"]
        self.assertIn("connect-src 'self' ws://127.0.0.1:8261", csp)
        self.assertIn("frame-src http://127.0.0.1:8252", csp)
        self.assertNotIn("unsafe-inline", csp)
        self.assertIn('id="gcsSitlControls"', res.content.decode())

    def test_student_page_has_no_control_panel(self):
        profile = self.make_student("s3@example.com", self.open_cohort)
        self.client.force_login(profile.user)
        html = self.client.get("/gcs/").content.decode()
        self.assertIn('id="gcsSitlConnect"', html)
        self.assertNotIn('id="gcsSitlControls"', html)
        self.assertNotIn('id="gcsSitlControl"', html)

    def test_revoke_is_teacher_only_and_reports_gateway_failure(self):
        profile = self.make_student("s4@example.com", self.open_cohort)
        self.client.force_login(profile.user)
        self.assertEqual(self.post(REVOKE_URL, {}).status_code, 403)
        self.client.force_login(make_teacher())
        with mock.patch("gcs_portal.sitl_api.urllib.request.urlopen", side_effect=OSError("down")):
            self.assertEqual(self.post(REVOKE_URL, {"brake": True}).status_code, 502)
        resp = mock.MagicMock(status=200)
        resp.__enter__.return_value = resp
        with mock.patch("gcs_portal.sitl_api.urllib.request.urlopen", return_value=resp) as urlopen:
            self.assertEqual(self.post(REVOKE_URL, {"brake": True}).status_code, 200)
            req = urlopen.call_args.args[0]
            self.assertEqual(req.get_header("X-gateway-secret"), SECRET)
            self.assertEqual(json.loads(req.data), {"brake": True})


@override_settings(FDE_GCS_ENABLED=True, FDE_GCS_COHORTS=frozenset({OPEN_COHORT}), FDE_GCS_GATEWAY_SECRET="")
class SitlNotConfiguredTests(GcsTestBase):
    def test_no_secret_means_no_ticket_and_strict_csp(self):
        self.client.force_login(make_teacher())
        res = self.client.post(TICKET_URL, data="{}", content_type="application/json")
        self.assertEqual(res.status_code, 503)
        page = self.client.get("/gcs/")
        self.assertNotIn("8261", page["Content-Security-Policy"])
        self.assertIn("尚未設定", page.content.decode())
