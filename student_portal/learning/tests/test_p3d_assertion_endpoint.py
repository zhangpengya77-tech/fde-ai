"""P3-D：Django 只對 Gateway 簽發短效可信身份。"""

import json

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from learning.live_assertions import verify_assertion
from learning.models import Cohort, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student


@override_settings(
    FDE_LIVE_ASSERTION_KEY="p3d-test-signing-key",
    FDE_GATEWAY_INTERNAL_AUTH_KEY="p3d-test-gateway-key",
    FDE_LIVE_ASSERTION_TTL_SECONDS=60,
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class P3DAssertionEndpointTests(TestCase):
    def setUp(self):
        cohort = Cohort.objects.create(cohort_id="2099-P3D", name="P3-D 班級")
        self.student = create_student_account("p3d-student@example.test", "P3-D 學員")
        self.enrollment = enroll_student(self.student, cohort)
        self.endpoint = reverse("learning:live_identity_assertion")

    def _client(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.student.user)
        client.get(reverse("learning:live_session_auth"))
        return client

    def test_gateway_gets_verified_student_not_browser_forged_identity(self):
        client = self._client()
        response = client.post(
            self.endpoint,
            data=json.dumps({
                "enrollment_id": self.enrollment.pk,
                "student_id": 9999,
                "role": "teacher",
                # P7-B4：真實操作描述（偽造的 student_id / role 一律不採用）
                "method": "POST",
                "path": "/api/live/sessions",
                "body_sha256": "0" * 64,
            }),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            HTTP_X_FDE_GATEWAY_AUTH="p3d-test-gateway-key",
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 200)
        claims = verify_assertion(response.json()["assertion"], "p3d-test-signing-key")
        self.assertEqual(claims["sub"], f"student:{self.student.pk}")
        self.assertEqual(claims["enrollment_id"], self.enrollment.pk)
        self.assertEqual(claims["role"], "student")
        # P7-B4：簽出的票必須綁定真實操作，而不是預設的 GET /
        self.assertEqual(claims["method"], "POST")
        self.assertEqual(claims["path"], "/api/live/sessions")
        self.assertEqual(claims["body_sha256"], "0" * 64)

    def test_missing_gateway_key_does_not_issue_assertion(self):
        client = self._client()
        response = client.post(
            self.endpoint,
            data=json.dumps({"enrollment_id": self.enrollment.pk}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("assertion", response.json())

    # P7-B4：Assertion 必須綁定真實操作的 method / path / body hash。
    TARGET = {
        "method": "POST",
        "path": "/api/live/sessions",
        "body_sha256": "0" * 64,
    }

    def _post(self, client, payload=None, *, target=None):
        if "csrftoken" not in client.cookies:
            client.get(reverse("learning:live_session_auth"))
        body = dict(payload or {})
        body.update(self.TARGET if target is None else target)
        return client.post(
            self.endpoint,
            data=json.dumps(body),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            HTTP_X_FDE_GATEWAY_AUTH="p3d-test-gateway-key",
            HTTP_ORIGIN="http://testserver",
        )

    def test_assertion_endpoint_requires_csrf_token(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.student.user)
        response = client.post(
            self.endpoint,
            data=json.dumps({"enrollment_id": self.enrollment.pk}),
            content_type="application/json",
            HTTP_X_FDE_GATEWAY_AUTH="p3d-test-gateway-key",
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 403)
        # CSRF 拒絕走 Django 預設 HTML 頁，因此不可能帶回任何 assertion 欄位。
        self.assertNotIn("application/json", response.get("Content-Type", ""))

    def test_assertion_endpoint_requires_authenticated_session(self):
        response = Client().post(
            self.endpoint,
            data=json.dumps({}),
            content_type="application/json",
            HTTP_X_FDE_GATEWAY_AUTH="p3d-test-gateway-key",
            HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 401)

    def test_assertion_is_short_lived_and_not_reusable_for_other_subject(self):
        response = self._post(self._client())
        self.assertEqual(response.status_code, 200)
        claims = verify_assertion(response.json()["assertion"], "p3d-test-signing-key")
        self.assertLessEqual(claims["exp"] - claims["iat"], 60)
        self.assertEqual(response.json()["expires_in"], claims["exp"] - claims["iat"])
        self.assertTrue(claims["jti"])

    def test_teacher_without_cohort_access_is_rejected(self):
        teacher = get_user_model().objects.create_user(username="p3d-no-scope", password="x", is_staff=True)
        client = Client()
        client.force_login(teacher)
        self.assertEqual(self._post(client).status_code, 403)

    def test_teacher_assertion_carries_only_own_cohort_scope(self):
        teacher = get_user_model().objects.create_user(username="p3d-teacher", password="x", is_staff=True)
        TeacherCohortAccess.objects.create(teacher=teacher, cohort=self.enrollment.cohort)
        other = Cohort.objects.create(cohort_id="2099-P3E", name="其他班級")
        TeacherCohortAccess.objects.create(teacher=teacher, cohort=other)
        client = Client()
        client.force_login(teacher)
        response = self._post(client)
        self.assertEqual(response.status_code, 200)
        claims = verify_assertion(response.json()["assertion"], "p3d-test-signing-key")
        self.assertEqual(claims["role"], "teacher")
        self.assertEqual(sorted(claims["cohort_ids"]), sorted([self.enrollment.cohort_id, other.pk]))

    def test_multiple_active_enrollments_require_explicit_selection(self):
        second = Cohort.objects.create(cohort_id="2099-P3F", name="第二班")
        enroll_student(self.student, second)
        client = self._client()
        self.assertEqual(self._post(client).status_code, 409)
        selected = self._post(client, {"enrollment_id": self.enrollment.pk})
        self.assertEqual(selected.status_code, 200)
        claims = verify_assertion(selected.json()["assertion"], "p3d-test-signing-key")
        self.assertEqual(claims["enrollment_id"], self.enrollment.pk)
        self.assertEqual(claims["cohort_ids"], [self.enrollment.cohort_id])

    def test_enrollment_of_another_student_is_forbidden(self):
        other = create_student_account("p3d-else@example.test", "P3-D 他人")
        other_enrollment = enroll_student(other, self.enrollment.cohort)
        response = self._post(self._client(), {"enrollment_id": other_enrollment.pk})
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("assertion", response.json())

    def test_inactive_student_profile_is_rejected(self):
        self.student.active = False
        self.student.save(update_fields=["active"])
        self.assertEqual(self._post(self._client()).status_code, 403)

    def test_browser_supplied_identity_fields_are_ignored(self):
        response = self._post(self._client(), {"role": "teacher", "cohort_ids": ["2099-HACK"], "student_id": 1})
        self.assertEqual(response.status_code, 200)
        claims = verify_assertion(response.json()["assertion"], "p3d-test-signing-key")
        self.assertEqual(claims["role"], "student")
        # P7-B4：簽出的票必須綁定真實操作，而不是預設的 GET /
        self.assertEqual(claims["method"], "POST")
        self.assertEqual(claims["path"], "/api/live/sessions")
        self.assertEqual(claims["body_sha256"], "0" * 64)
        self.assertEqual(claims["cohort_ids"], [self.enrollment.cohort_id])
