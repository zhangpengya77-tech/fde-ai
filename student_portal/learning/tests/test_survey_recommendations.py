from django.test import TestCase
from django.urls import reverse

from learning.models import Cohort, Enrollment, GrowthRecordSubmission, StudentSurvey
from learning.survey_recommendations import recommend_paths
from learning.tests.helpers import create_student_account, enroll_student
from learning.growth_records import ensure_growth_submissions


def survey_for(**overrides):
    values = {
        "path_20_interest": "not_now",
        "path_25_interest": "not_now",
        "path_30_interest": "not_now",
        "future_interests": [],
        "advanced_course_intent": "NONE",
        "contact_opt_in": False,
        "contact_email": "",
    }
    values.update(overrides)
    return StudentSurvey(**values)


class SurveyRecommendationTests(TestCase):
    def test_path_20_high_interest_is_first_recommendation(self):
        result = recommend_paths(
            survey_for(
                path_20_interest="very_interested",
                path_25_interest="interested",
                future_interests=["route_planning", "rover"],
            )
        )

        self.assertEqual(result[0]["key"], "2.0")

    def test_path_25_high_interest_is_first_recommendation(self):
        result = recommend_paths(
            survey_for(
                path_20_interest="not_now",
                path_25_interest="very_interested",
                path_30_interest="interested",
                future_interests=["fpv", "drone_repair"],
            )
        )

        self.assertEqual(result[0]["key"], "2.5")

    def test_path_30_high_interest_is_first_recommendation(self):
        result = recommend_paths(
            survey_for(
                path_30_interest="very_interested",
                future_interests=["ai_training", "ros2"],
            )
        )

        self.assertEqual(result[0]["key"], "3.0")

    def test_c_interest_breaks_a_path_tie(self):
        result = recommend_paths(
            survey_for(
                path_20_interest="interested",
                path_25_interest="interested",
                future_interests=["rover"],
            )
        )

        self.assertEqual(result[0]["key"], "2.0")
        self.assertIn("無人車 Rover", result[0]["reasons"])

    def test_g03_and_email_do_not_change_recommendation(self):
        base = recommend_paths(
            survey_for(
                path_30_interest="very_interested",
                future_interests=["ros2"],
            )
        )
        changed = recommend_paths(
            survey_for(
                path_30_interest="very_interested",
                future_interests=["ros2"],
                advanced_course_intent="HIGH",
                contact_opt_in=True,
                contact_email="contact@example.com",
            )
        )

        self.assertEqual([item["key"] for item in base], [item["key"] for item in changed])

    def test_low_scores_return_exploration_state(self):
        self.assertEqual(recommend_paths(survey_for()), [])

    def test_at_most_two_paths_are_returned(self):
        result = recommend_paths(
            survey_for(
                path_20_interest="interested",
                path_25_interest="interested",
                path_30_interest="interested",
            )
        )

        self.assertLessEqual(len(result), 2)


class SurveyRecommendationViewTests(TestCase):
    def setUp(self):
        self.profile = create_student_account("recommendation@example.com", "Recommendation Student")
        self.other_profile = create_student_account("other-recommendation@example.com", "Other Student")
        self.cohort = Cohort.objects.create(cohort_id="2099-10", name="Recommendation Cohort")
        self.enrollment = enroll_student(self.profile, self.cohort)
        self.other_enrollment = enroll_student(self.other_profile, self.cohort)
        ensure_growth_submissions(self.enrollment)
        ensure_growth_submissions(self.other_enrollment)
        self.r08 = GrowthRecordSubmission.objects.get(
            enrollment=self.enrollment,
            definition__slot_id="R08",
        )
        self.client.force_login(self.profile.user)

    def create_survey(self, enrollment=None):
        enrollment = enrollment or self.enrollment
        r08 = GrowthRecordSubmission.objects.get(enrollment=enrollment, definition__slot_id="R08")
        return StudentSurvey.objects.create(
            student=enrollment.student,
            enrollment=enrollment,
            growth_record=r08,
            a01=4,
            a02=4,
            a03=4,
            a04=4,
            a05=4,
            a06=4,
            a07=4,
            path_20_interest="very_interested",
            path_25_interest="not_now",
            path_30_interest="not_now",
            future_interests=["route_planning", "rover"],
        )

    def test_completed_survey_shows_result_page(self):
        self.create_survey()

        response = self.client.get(reverse("learning:student_survey_result", args=[self.enrollment.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "調查已完成")
        self.assertContains(response, "2.0 無人系統專業人才")
        self.assertContains(response, "為什麼推薦給我？")

    def test_missing_survey_redirects_to_survey_page(self):
        response = self.client.get(reverse("learning:student_survey_result", args=[self.enrollment.pk]))

        self.assertRedirects(response, reverse("learning:student_survey", args=[self.enrollment.pk]))

    def test_student_cannot_view_another_students_result(self):
        self.create_survey(self.other_enrollment)

        response = self.client.get(
            reverse("learning:student_survey_result", args=[self.other_enrollment.pk])
        )

        self.assertEqual(response.status_code, 404)

    def test_result_recomputes_after_survey_change(self):
        survey = self.create_survey()
        response = self.client.get(reverse("learning:student_survey_result", args=[self.enrollment.pk]))
        self.assertContains(response, "2.0 無人系統專業人才")

        survey.path_20_interest = "not_now"
        survey.path_30_interest = "very_interested"
        survey.future_interests = ["ros2"]
        survey.save()

        response = self.client.get(reverse("learning:student_survey_result", args=[self.enrollment.pk]))
        self.assertContains(response, "3.0 無人系統軟體工程師")
        self.assertNotContains(response, "2.0 無人系統專業人才")

    def test_r08_detail_has_result_link_after_survey(self):
        self.create_survey()

        response = self.client.get(
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R08"])
        )

        self.assertContains(response, "查看我的學習方向")

    def test_result_page_requires_login(self):
        self.client.logout()

        response = self.client.get(reverse("learning:student_survey_result", args=[self.enrollment.pk]))

        self.assertEqual(response.status_code, 302)
