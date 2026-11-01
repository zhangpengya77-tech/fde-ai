"""教師資源守衛：排除清單只放行非 Live 資源，Live 資源仍依班級 fail closed。"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from learning import views
from learning.models import Cohort, GrowthRecordSubmission, TeacherCohortAccess
from learning.growth_records import ensure_growth_submissions
from learning.tests.helpers import create_student_account, enroll_student


class GuardFixture(TestCase):
    def setUp(self):
        self.cohort_a = Cohort.objects.create(cohort_id="G-A", name="守衛 A 班")
        self.cohort_b = Cohort.objects.create(cohort_id="G-B", name="守衛 B 班")
        self.student_a = create_student_account("guard-a@example.test", "守衛學員 A")
        self.student_b = create_student_account("guard-b@example.test", "守衛學員 B")
        self.enrollment_a = enroll_student(self.student_a, self.cohort_a)
        self.enrollment_b = enroll_student(self.student_b, self.cohort_b)
        users = get_user_model().objects
        self.teacher_a = users.create_user(username="guard-t-a", password="x", is_staff=True)
        self.teacher_b = users.create_user(username="guard-t-b", password="x", is_staff=True)
        TeacherCohortAccess.objects.create(teacher=self.teacher_a, cohort=self.cohort_a)
        TeacherCohortAccess.objects.create(teacher=self.teacher_b, cohort=self.cohort_b)


class GrowthReviewGuardTests(GuardFixture):
    def setUp(self):
        super().setUp()
        ensure_growth_submissions(self.enrollment_a)
        self.submission = GrowthRecordSubmission.objects.filter(enrollment=self.enrollment_a).first()
        self.url = reverse("learning:growth_review", args=[self.submission.pk])

    def test_other_cohort_teacher_gets_404_and_nothing_changes(self):
        before = self.submission.status
        self.client.force_login(self.teacher_b)
        self.assertEqual(self.client.post(self.url, {"status": "APPROVED"}).status_code, 404)
        self.submission.refresh_from_db()
        self.assertEqual(self.submission.status, before)

    def test_authorized_teacher_is_not_blocked_by_live_guard(self):
        self.client.force_login(self.teacher_a)
        with patch.object(views.vision_api, "list_submissions", side_effect=AssertionError("must not query Live")):
            response = self.client.post(self.url, {})
        self.assertNotIn(response.status_code, (403, 404))

    def test_student_cannot_review(self):
        self.client.force_login(self.student_a.user)
        self.assertEqual(self.client.post(self.url, {}).status_code, 403)

    def test_anonymous_is_redirected(self):
        self.assertEqual(self.client.post(self.url, {}).status_code, 302)


class LiveResourceGuardTests(GuardFixture):
    """排除清單不得涵蓋 Live 資源：未授權、查無或 Live 離線都必須拒絕。"""

    def _import(self, lookup=None, side_effect=None):
        with patch.object(views, "_vision_lookup_submission_student", return_value=lookup, side_effect=side_effect), \
                patch.object(views.vision_api, "import_submission") as import_submission, \
                patch.object(views.vision_api, "preflight_import", return_value={"outcome": "ready"}) as preflight:
            response = self.client.post(
                reverse("learning:teacher_vision_center_import"),
                {"submission_id": "sub-1", "task_id": "PROP_DIRECTION"},
            )
        return response, import_submission, preflight

    def test_other_cohort_owner_refused(self):
        self.client.force_login(self.teacher_a)
        response, import_submission, preflight = self._import((True, self.student_b.public_user_id))
        self.assertEqual(response.status_code, 403)
        import_submission.assert_not_called()
        preflight.assert_not_called()

    def test_unknown_owner_refused(self):
        self.client.force_login(self.teacher_a)
        response, import_submission, _ = self._import((False, None))
        self.assertEqual(response.status_code, 403)
        import_submission.assert_not_called()

    def test_live_outage_fails_closed(self):
        self.client.force_login(self.teacher_a)
        response, import_submission, _ = self._import(side_effect=RuntimeError("vision_api_unavailable"))
        self.assertEqual(response.status_code, 403)
        import_submission.assert_not_called()

    def test_own_cohort_passes_guard(self):
        self.client.force_login(self.teacher_a)
        response, _, preflight = self._import((True, self.student_a.public_user_id))
        self.assertNotEqual(response.status_code, 403)
        preflight.assert_called_once()

    def test_student_refused(self):
        self.client.force_login(self.student_a.user)
        response, import_submission, _ = self._import((True, self.student_a.public_user_id))
        self.assertEqual(response.status_code, 403)
        import_submission.assert_not_called()

    def test_exemptions_do_not_cover_live_routes(self):
        for path in ("/teacher/vision-center/import/", "/teacher/vision-center/activate/", "/teacher/vision-models/"):
            self.assertFalse(path.startswith(views.LIVE_GUARD_EXEMPT_PREFIXES), path)
