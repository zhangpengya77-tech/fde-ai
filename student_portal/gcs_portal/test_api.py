import json
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from learning.models import Cohort, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student

from .allowlist import FORBIDDEN_PREFIXES, is_forbidden, load_allowlist, readback_matches, validate_change
from .models import ParamWriteRequest

OPEN = "2026-06"
OTHER = "2026-05"
API = "/gcs/api/param-requests/"


def teacher(username, *, cohorts=()):
    user = get_user_model().objects.create_user(username=username, password="A-strong-passphrase-984!", is_staff=True)
    for cohort in cohorts:
        TeacherCohortAccess.objects.create(teacher=user, cohort=cohort)
    return user


def payload(**overrides):
    data = {"param_name": "ATC_RAT_RLL_P", "old_value": 0.135, "new_value": 0.15, "vehicle_sysid": 1,
            "firmware": "4.5.0 official", "safety_ack": True}
    data.update(overrides)
    return data


class AllowlistTests(TestCase):
    def test_allowlist_only_contains_rate_pid_and_no_forbidden_prefix(self):
        params = load_allowlist()["params"]
        self.assertEqual(len(params), 9)
        for name in params:
            self.assertTrue(name.startswith("ATC_RAT_"), name)
            self.assertFalse(is_forbidden(name), name)

    def test_safety_parameters_can_never_be_validated(self):
        for name in ("ARMING_CHECK", "FS_THR_ENABLE", "EK3_ENABLE", "BRD_SAFETYENABLE", "MOT_SPIN_ARM", "SERVO1_FUNCTION", "RC1_MIN"):
            self.assertTrue(validate_change(name, 1, 0), name)
        self.assertIn("ARMING_", FORBIDDEN_PREFIXES)

    def test_range_and_step_limits(self):
        self.assertEqual(validate_change("ATC_RAT_RLL_P", 0.135, 0.15), [])
        self.assertTrue(validate_change("ATC_RAT_RLL_P", 0.135, 0.5))  # 超出上限
        self.assertTrue(validate_change("ATC_RAT_RLL_P", 0.135, 0.25))  # 單次修改超過 30%
        self.assertTrue(validate_change("ATC_RAT_RLL_P", 0.135, 0.135))  # 沒有變化
        self.assertTrue(validate_change("ATC_RAT_RLL_P", 0.135, float("nan")))
        self.assertTrue(validate_change("ATC_RAT_RLL_P", 0.135, True))

    def test_readback_tolerates_float32_rounding_only(self):
        self.assertTrue(readback_matches(0.15, 0.15000000596046448))
        self.assertFalse(readback_matches(0.15, 0.151))


@override_settings(FDE_GCS_ENABLED=True, FDE_GCS_COHORTS=frozenset({OPEN}))
class ParamRequestApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.open = Cohort.objects.create(cohort_id=OPEN, name="開放班")
        cls.other = Cohort.objects.create(cohort_id=OTHER, name="其他班")
        cls.student = create_student_account(email="s1@example.com")
        enroll_student(cls.student, cls.open)
        cls.outsider = create_student_account(email="s2@example.com")
        enroll_student(cls.outsider, cls.other)
        cls.teacher = teacher("t-open@example.com", cohorts=[cls.open])
        cls.other_teacher = teacher("t-other@example.com", cohorts=[cls.other])

    def post(self, url, data):
        return self.client.post(url, json.dumps(data), content_type="application/json")

    def create_request(self, **overrides):
        self.client.force_login(self.student.user)
        response = self.post(API, payload(**overrides))
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["request"]["id"]

    def decide(self, pk, decision, user=None):
        self.client.force_login(user or self.teacher)
        return self.post(f"{API}{pk}/decision/", {"decision": decision})

    def test_student_creates_pending_request_for_own_cohort(self):
        pk = self.create_request()
        item = ParamWriteRequest.objects.get(pk=pk)
        self.assertEqual(item.status, "PENDING")
        self.assertEqual(item.cohort_id, OPEN)
        self.assertEqual(item.allowlist_version, load_allowlist()["version"])

    def test_create_rejects_missing_safety_ack_and_out_of_range(self):
        self.client.force_login(self.student.user)
        self.assertEqual(self.post(API, payload(safety_ack=False)).status_code, 400)
        self.assertEqual(self.post(API, payload(new_value=0.9)).status_code, 400)
        self.assertEqual(self.post(API, payload(param_name="ARMING_CHECK", old_value=1, new_value=0)).status_code, 400)
        self.assertEqual(ParamWriteRequest.objects.count(), 0)

    def test_only_one_open_request_per_parameter(self):
        self.create_request()
        self.assertEqual(self.post(API, payload(new_value=0.14)).status_code, 409)

    def test_students_outside_enabled_cohorts_and_anonymous_are_blocked(self):
        self.client.force_login(self.outsider.user)
        self.assertEqual(self.post(API, payload()).status_code, 403)
        self.client.logout()
        self.assertEqual(self.client.get(API).status_code, 401)

    def test_student_cannot_approve(self):
        pk = self.create_request()
        self.assertEqual(self.decide(pk, "approve", user=self.student.user).status_code, 403)

    def test_teacher_only_sees_and_decides_own_cohorts(self):
        pk = self.create_request()
        self.client.force_login(self.other_teacher)
        self.assertEqual(self.client.get(API).json()["requests"], [])
        self.assertEqual(self.decide(pk, "approve", user=self.other_teacher).status_code, 404)
        self.client.force_login(self.teacher)
        listed = self.client.get(API).json()["requests"]
        self.assertEqual([r["id"] for r in listed], [pk])
        self.assertTrue(listed[0]["can_decide"])

    def test_students_only_see_their_own_requests(self):
        self.create_request()
        other = create_student_account(email="s3@example.com")
        enroll_student(other, self.open)
        self.client.force_login(other.user)
        self.assertEqual(self.client.get(API).json()["requests"], [])

    def test_approval_then_successful_result_is_applied_once(self):
        pk = self.create_request()
        self.assertEqual(self.decide(pk, "approve").status_code, 200)
        self.client.force_login(self.student.user)
        response = self.post(f"{API}{pk}/result/", {"success": True, "readback_value": 0.15000000596046448})
        self.assertEqual(response.json()["request"]["status"], "APPLIED")
        self.assertEqual(self.post(f"{API}{pk}/result/", {"success": True, "readback_value": 0.15}).status_code, 409)

    def test_claimed_success_with_wrong_readback_is_failed(self):
        pk = self.create_request()
        self.decide(pk, "approve")
        self.client.force_login(self.student.user)
        response = self.post(f"{API}{pk}/result/", {"success": True, "readback_value": 0.2})
        self.assertEqual(response.json()["request"]["status"], "FAILED")

    def test_result_requires_approval(self):
        pk = self.create_request()
        self.assertEqual(self.post(f"{API}{pk}/result/", {"success": True, "readback_value": 0.15}).status_code, 409)
        self.decide(pk, "reject")
        self.client.force_login(self.student.user)
        self.assertEqual(self.post(f"{API}{pk}/result/", {"success": True, "readback_value": 0.15}).status_code, 409)

    def test_approval_expires_after_ten_minutes(self):
        pk = self.create_request()
        self.decide(pk, "approve")
        self.client.force_login(self.student.user)
        later = timezone.now() + timedelta(minutes=11)
        with mock.patch("django.utils.timezone.now", return_value=later):
            response = self.post(f"{API}{pk}/result/", {"success": True, "readback_value": 0.15})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(ParamWriteRequest.objects.get(pk=pk).status, "EXPIRED")

    def test_decision_is_final(self):
        pk = self.create_request()
        self.decide(pk, "reject")
        self.assertEqual(self.decide(pk, "approve").status_code, 409)

    def test_requester_can_cancel_open_request(self):
        pk = self.create_request()
        self.assertEqual(self.post(f"{API}{pk}/cancel/", {}).json()["request"]["status"], "CANCELLED")

    def test_api_requires_csrf_token(self):
        from django.test import Client

        client = Client(enforce_csrf_checks=True)
        client.force_login(self.student.user)
        response = client.post(API, json.dumps(payload()), content_type="application/json")
        self.assertEqual(response.status_code, 403)

    @override_settings(FDE_GCS_ENABLED=False)
    def test_api_is_404_when_flag_is_off(self):
        self.client.force_login(self.teacher)
        self.assertEqual(self.client.get(API).status_code, 404)
