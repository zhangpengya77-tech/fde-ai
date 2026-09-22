from django.core.exceptions import ValidationError
from django.urls import reverse
from django.test import TestCase

from learning.forms import StudentSurveyForm
from learning.models import (
    Cohort,
    Enrollment,
    GrowthRecordDefinition,
    GrowthRecordSubmission,
    StudentSurvey,
)
from learning.tests.helpers import create_student_account, enroll_student
from learning.growth_records import ensure_growth_submissions


class StudentSurveyModelFormTests(TestCase):
    def setUp(self):
        self.profile = create_student_account("survey@example.com", "Survey Student")
        self.cohort = Cohort.objects.create(cohort_id="2099-08", name="Survey Cohort")
        self.enrollment = enroll_student(self.profile, self.cohort)
        self.definition = GrowthRecordDefinition.objects.create(
            cohort=self.cohort,
            slot_id="R08",
            title="綜合成果與能力檔案",
        )
        self.r08 = GrowthRecordSubmission.objects.create(
            enrollment=self.enrollment,
            definition=self.definition,
        )

    def valid_data(self):
        return {
            **{f"a0{index}": "4" for index in range(1, 8)},
            "helpful_topics": ["real_flight", "ai_detection"],
            "helpful_other": "",
            "future_interests": ["fpv", "ros2"],
            "path_20_interest": "interested",
            "path_25_interest": "learn_more",
            "path_30_interest": "not_now",
            "license_interest": ["g2"],
            "course_format_preferences": ["weekend"],
            "course_duration_preference": "4_6_weeks",
            "course_priority_factors": ["content", "project"],
            "advanced_course_intent": "HIGH",
            "contact_opt_in": False,
            "contact_email": "",
            "next_step_text": "想繼續學習 FPV。",
            "feedback_text": "希望增加更多實作時間。",
        }

    def save_survey(self, data=None):
        form = StudentSurveyForm(data=data or self.valid_data())
        self.assertTrue(form.is_valid(), form.errors)
        return form.save(
            commit=False,
        )

    def test_create_survey_and_relations(self):
        survey = self.save_survey()
        survey.student = self.profile
        survey.enrollment = self.enrollment
        survey.growth_record = self.r08
        survey.save()
        self.assertEqual(survey.public_user_id, self.profile.public_user_id)
        self.assertEqual(survey.cohort, self.cohort)
        self.assertEqual(survey.future_interests, ["fpv", "ros2"])

    def test_one_student_one_survey_per_enrollment(self):
        survey = self.save_survey()
        survey.student = self.profile
        survey.enrollment = self.enrollment
        survey.growth_record = self.r08
        survey.save()
        duplicate = self.save_survey()
        duplicate.student = self.profile
        duplicate.enrollment = self.enrollment
        duplicate.growth_record = self.r08
        with self.assertRaises(Exception):
            duplicate.save()

    def test_likert_values_are_required_and_limited_to_one_to_five(self):
        data = self.valid_data()
        data["a01"] = "6"
        form = StudentSurveyForm(data=data)
        self.assertFalse(form.is_valid())
        self.assertIn("a01", form.errors)

    def test_future_interests_allow_at_most_three(self):
        data = self.valid_data()
        data["future_interests"] = ["fpv", "ros2", "rover", "surveying"]
        form = StudentSurveyForm(data=data)
        self.assertFalse(form.is_valid())
        self.assertIn("future_interests", form.errors)

    def test_blank_contact_email_is_allowed(self):
        form = StudentSurveyForm(data=self.valid_data())
        self.assertTrue(form.is_valid(), form.errors)

    def test_contact_email_must_be_valid_when_present(self):
        data = self.valid_data()
        data["contact_email"] = "not-an-email"
        form = StudentSurveyForm(data=data)
        self.assertFalse(form.is_valid())
        self.assertIn("contact_email", form.errors)

    def test_contact_opt_in_defaults_to_false(self):
        survey = StudentSurvey(
            student=self.profile,
            enrollment=self.enrollment,
            growth_record=self.r08,
            **{f"a0{index}": 3 for index in range(1, 8)},
        )
        self.assertFalse(survey.contact_opt_in)

    def test_contact_email_is_not_copied_from_account_email(self):
        survey = self.save_survey()
        self.assertEqual(survey.contact_email, "")
        self.assertNotEqual(survey.contact_email, self.profile.email)

    def test_all_g03_states_are_valid(self):
        for value in StudentSurvey.AdvancedCourseIntent.values:
            data = self.valid_data()
            data["advanced_course_intent"] = value
            form = StudentSurveyForm(data=data)
            self.assertTrue(form.is_valid(), (value, form.errors))

    def test_survey_does_not_change_r08_submission(self):
        status = self.r08.status
        survey = self.save_survey()
        survey.student = self.profile
        survey.enrollment = self.enrollment
        survey.growth_record = self.r08
        survey.save()
        self.r08.refresh_from_db()
        self.assertEqual(self.r08.status, status)

    def test_survey_does_not_change_r08_review_or_evidence(self):
        survey = self.save_survey()
        survey.student = self.profile
        survey.enrollment = self.enrollment
        survey.growth_record = self.r08
        survey.save()
        self.assertEqual(self.r08.reviews.count(), 0)
        self.assertEqual(self.r08.evidence.count(), 0)

    def test_j_and_k_length_limits(self):
        data = self.valid_data()
        data["next_step_text"] = "x" * 301
        data["feedback_text"] = "x" * 501
        form = StudentSurveyForm(data=data)
        self.assertFalse(form.is_valid())
        self.assertIn("next_step_text", form.errors)
        self.assertIn("feedback_text", form.errors)


class StudentSurveyViewTests(TestCase):
    def setUp(self):
        self.profile = create_student_account("survey-ui@example.com", "Survey UI Student")
        self.cohort = Cohort.objects.create(cohort_id="2099-09", name="Survey UI Cohort")
        self.enrollment = enroll_student(self.profile, self.cohort)
        ensure_growth_submissions(self.enrollment)
        self.r08 = GrowthRecordSubmission.objects.get(
            enrollment=self.enrollment,
            definition__slot_id="R08",
        )
        self.client.force_login(self.profile.user)

    def valid_post_data(self):
        return {
            **{f"a0{index}": "4" for index in range(1, 8)},
            "helpful_topics": ["real_flight", "ai_detection"],
            "future_interests": ["fpv", "ros2"],
            "helpful_other": "",
            "path_20_interest": "interested",
            "path_25_interest": "learn_more",
            "path_30_interest": "not_now",
            "license_interest": ["g2"],
            "course_format_preferences": ["weekend"],
            "course_duration_preference": "4_6_weeks",
            "course_priority_factors": ["content", "project"],
            "advanced_course_intent": "HIGH",
            "contact_opt_in": "false",
            "contact_email": "",
            "next_step_text": "想繼續學習 FPV。",
            "feedback_text": "希望增加更多實作時間。",
        }

    def test_r08_detail_shows_survey_entry_without_changing_evidence_flow(self):
        response = self.client.get(
            reverse(
                "learning:growth_record_detail",
                kwargs={"enrollment_id": self.enrollment.pk, "slot_id": "R08"},
            )
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "我的下一階段學習方向")
        self.assertContains(response, reverse("learning:student_survey", args=[self.enrollment.pk]))

    def test_survey_page_renders_all_sections(self):
        response = self.client.get(
            reverse("learning:student_survey", args=[self.enrollment.pk])
        )

        self.assertEqual(response.status_code, 200)
        for marker in "ABCDEFGHIJK":
            self.assertContains(response, f"SECTION {marker}")
        self.assertContains(response, "最多選擇 3 項")
        self.assertContains(response, "不會影響 R08 成績")

    def test_valid_survey_post_creates_survey_and_preserves_r08(self):
        original_status = self.r08.status
        response = self.client.post(
            reverse("learning:student_survey", args=[self.enrollment.pk]),
            self.valid_post_data(),
        )

        self.assertRedirects(
            response,
            reverse("learning:student_survey", args=[self.enrollment.pk]),
        )
        survey = StudentSurvey.objects.get(enrollment=self.enrollment)
        self.assertEqual(survey.student_id, self.profile.pk)
        self.assertEqual(survey.growth_record_id, self.r08.pk)
        self.assertEqual(survey.contact_email, "")
        self.assertEqual(survey.advanced_course_intent, "HIGH")
        self.r08.refresh_from_db()
        self.assertEqual(self.r08.status, original_status)

    def test_survey_post_with_four_future_interests_is_rejected(self):
        data = self.valid_post_data()
        data["future_interests"] = ["fpv", "ros2", "rover", "surveying"]

        response = self.client.post(
            reverse("learning:student_survey", args=[self.enrollment.pk]),
            data,
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "最多選 3 項")
        self.assertFalse(StudentSurvey.objects.filter(enrollment=self.enrollment).exists())

    def test_second_valid_post_updates_existing_survey(self):
        self.client.post(
            reverse("learning:student_survey", args=[self.enrollment.pk]),
            self.valid_post_data(),
        )
        data = self.valid_post_data()
        data["a01"] = "5"
        data["advanced_course_intent"] = "INFO_ONLY"

        response = self.client.post(
            reverse("learning:student_survey", args=[self.enrollment.pk]),
            data,
        )

        self.assertRedirects(
            response,
            reverse("learning:student_survey", args=[self.enrollment.pk]),
        )
        self.assertEqual(StudentSurvey.objects.filter(enrollment=self.enrollment).count(), 1)
        survey = StudentSurvey.objects.get(enrollment=self.enrollment)
        self.assertEqual(survey.a01, 5)
        self.assertEqual(survey.advanced_course_intent, "INFO_ONLY")
