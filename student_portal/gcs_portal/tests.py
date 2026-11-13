from django.contrib.auth import get_user_model
from django.template.loader import render_to_string
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse

from learning.models import Cohort
from learning.tests.helpers import create_student_account, enroll_student

from .access import ALLOWED, ANONYMOUS, DISABLED, NOT_IN_COHORT, UNVERIFIED, evaluate_access
from .context_processors import gcs_entry

GCS_URL = "/gcs/"
OPEN_COHORT = "2026-06"
OTHER_COHORT = "2026-05"


def make_teacher(username="teacher@example.com"):
    return get_user_model().objects.create_user(
        username=username, password="A-strong-passphrase-984!", is_staff=True
    )


class GcsTestBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.open_cohort = Cohort.objects.create(cohort_id=OPEN_COHORT, name="2026-06 期")
        cls.other_cohort = Cohort.objects.create(cohort_id=OTHER_COHORT, name="2026-05 期")

    def make_student(self, email, cohort=None, active=True):
        profile = create_student_account(email=email, nickname="Eagle")
        if not active:
            profile.active = False
            profile.save(update_fields=["active"])
        if cohort is not None:
            enroll_student(profile, cohort)
        return profile


@override_settings(FDE_GCS_ENABLED=False, FDE_GCS_COHORTS=frozenset({OPEN_COHORT}))
class GcsDisabledTests(GcsTestBase):
    def test_route_is_404_for_everyone_when_flag_is_off(self):
        self.assertEqual(self.client.get(GCS_URL).status_code, 404)
        self.client.force_login(make_teacher())
        self.assertEqual(self.client.get(GCS_URL).status_code, 404)

    def test_no_entry_link_when_flag_is_off(self):
        request = RequestFactory().get("/")
        request.user = make_teacher()
        self.assertEqual(evaluate_access(request), DISABLED)
        self.assertEqual(gcs_entry(request), {"fde_gcs_url": ""})


@override_settings(FDE_GCS_ENABLED=True, FDE_GCS_COHORTS=frozenset({OPEN_COHORT}))
class GcsAccessTests(GcsTestBase):
    def test_anonymous_is_redirected_to_login(self):
        response = self.client.get(GCS_URL)
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response["Location"].startswith(reverse("learning:student_login")))
        self.assertIn("next=/gcs/", response["Location"])

    def test_teacher_can_open_page(self):
        self.client.force_login(make_teacher())
        response = self.client.get(GCS_URL)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "FDE-AI 地面站")

    def test_student_in_enabled_cohort_can_open_page(self):
        profile = self.make_student("open@example.com", self.open_cohort)
        self.client.force_login(profile.user)
        self.assertEqual(self.client.get(GCS_URL).status_code, 200)

    def test_student_in_other_cohort_is_denied(self):
        profile = self.make_student("other@example.com", self.other_cohort)
        self.client.force_login(profile.user)
        response = self.client.get(GCS_URL)
        self.assertEqual(response.status_code, 403)
        self.assertNotContains(response, "gcs.js", status_code=403)

    def test_inactive_enrollment_is_denied(self):
        profile = self.make_student("inactive-enrollment@example.com", self.open_cohort)
        profile.enrollments.update(active=False)
        self.client.force_login(profile.user)
        self.assertEqual(self.client.get(GCS_URL).status_code, 403)

    def test_unverified_student_is_denied(self):
        profile = self.make_student("unverified@example.com", self.open_cohort, active=False)
        request = RequestFactory().get(GCS_URL)
        request.user = profile.user
        self.assertEqual(evaluate_access(request), UNVERIFIED)

    @override_settings(FDE_GCS_COHORTS=frozenset())
    def test_students_are_denied_when_no_cohort_is_enabled(self):
        profile = self.make_student("nocohort@example.com", self.open_cohort)
        request = RequestFactory().get(GCS_URL)
        request.user = profile.user
        self.assertEqual(evaluate_access(request), NOT_IN_COHORT)

    def test_post_is_not_allowed(self):
        self.client.force_login(make_teacher())
        self.assertEqual(self.client.post(GCS_URL).status_code, 405)


@override_settings(FDE_GCS_ENABLED=True, FDE_GCS_COHORTS=frozenset({OPEN_COHORT}))
class GcsPageSafetyTests(GcsTestBase):
    def setUp(self):
        self.client.force_login(make_teacher())
        self.response = self.client.get(GCS_URL)
        self.html = self.response.content.decode("utf-8")

    def test_strict_csp_and_security_headers(self):
        csp = self.response["Content-Security-Policy"]
        for directive in ("default-src 'none'", "script-src 'self'", "style-src 'self'", "frame-ancestors 'none'"):
            self.assertIn(directive, csp)
        self.assertNotIn("unsafe-inline", csp)
        self.assertNotIn("http", csp)
        self.assertEqual(self.response["X-Frame-Options"], "DENY")
        self.assertIn("no-store", self.response["Cache-Control"])

    def test_page_has_no_inline_script_style_or_third_party_source(self):
        self.assertNotRegex(self.html, r"<script(?![^>]*\bsrc=)[^>]*>")
        self.assertNotIn("<style", self.html)
        self.assertNotIn(" style=", self.html)
        self.assertNotRegex(self.html, r"(src|href)=\"(https?:)?//")

    def test_page_is_clearly_marked_demo_and_has_six_sections(self):
        self.assertIn("DEMO 介面", self.html)
        for section_id in ("gcs-connection", "gcs-dashboard", "gcs-params", "gcs-sitl", "gcs-ai", "gcs-results"):
            self.assertIn(f'id="{section_id}"', self.html)

    def test_no_control_or_write_action_is_enabled(self):
        buttons = self.html.count("<button")
        disabled = self.html.count("<button type=\"button\" disabled>")
        self.assertEqual(buttons, disabled)
        for forbidden in ("ARM</button>", "起飛</button>", "寫入</button>"):
            self.assertNotIn(forbidden, self.html)


@override_settings(FDE_GCS_ENABLED=True, FDE_GCS_COHORTS=frozenset({OPEN_COHORT}))
class GcsEntryLinkTests(GcsTestBase):
    def render_nav(self, user):
        request = RequestFactory().get("/platform/")
        request.user = user
        context = {"role": "teacher" if user.is_staff else "student", "profile": getattr(user, "student_profile", None)}
        return render_to_string("learning/platform_identity_nav.html", context, request=request)

    def test_allowed_user_sees_entry_in_platform_nav(self):
        self.assertIn('href="/gcs/"', self.render_nav(make_teacher()))

    def test_student_outside_enabled_cohort_does_not_see_entry(self):
        profile = self.make_student("outside@example.com", self.other_cohort)
        self.assertNotIn("/gcs/", self.render_nav(profile.user))

    def test_anonymous_context_has_no_entry(self):
        request = RequestFactory().get("/")
        from django.contrib.auth.models import AnonymousUser

        request.user = AnonymousUser()
        self.assertEqual(evaluate_access(request), ANONYMOUS)
        self.assertEqual(gcs_entry(request), {"fde_gcs_url": ""})

    def test_entry_url_for_allowed_user(self):
        request = RequestFactory().get("/")
        request.user = make_teacher("t2@example.com")
        self.assertEqual(evaluate_access(request), ALLOWED)
        self.assertEqual(gcs_entry(request), {"fde_gcs_url": GCS_URL})
