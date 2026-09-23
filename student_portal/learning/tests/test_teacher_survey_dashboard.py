from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from learning.growth_records import ensure_growth_submissions
from learning.models import Cohort, Enrollment, GrowthRecordSubmission, StudentSurvey, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student


class TeacherSurveyDashboardTests(TestCase):
    def setUp(self):
        self.teacher = get_user_model().objects.create_user(
            username="survey-teacher",
            email="teacher@example.com",
            password="Teacher-passphrase-986!",
            is_staff=True,
        )
        self.cohort = Cohort.objects.create(cohort_id="2099-20", name="調查測試班")
        self.other_cohort = Cohort.objects.create(cohort_id="2099-21", name="未授權班")
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.profile = create_student_account("student-login@example.com", "調查學員")
        self.other_profile = create_student_account("other-login@example.com", "其他學員")
        self.enrollment = enroll_student(self.profile, self.cohort)
        self.other_enrollment = enroll_student(self.other_profile, self.other_cohort)
        ensure_growth_submissions(self.enrollment)
        ensure_growth_submissions(self.other_enrollment)
        self.client.force_login(self.teacher)

    def create_survey(self, enrollment=None, **overrides):
        enrollment = enrollment or self.enrollment
        r08 = GrowthRecordSubmission.objects.get(enrollment=enrollment, definition__slot_id="R08")
        values = {
            "student": enrollment.student,
            "enrollment": enrollment,
            "growth_record": r08,
            "a01": 4, "a02": 4, "a03": 4, "a04": 4,
            "a05": 4, "a06": 4, "a07": 4,
            "path_20_interest": "very_interested",
            "path_25_interest": "not_now",
            "path_30_interest": "not_now",
            "future_interests": ["route_planning", "ai_detection"],
            "license_interest": ["g2"],
            "course_format_preferences": ["weekend"],
            "course_duration_preference": "4_6_weeks",
            "course_priority_factors": ["content"],
            "advanced_course_intent": "HIGH",
            "contact_opt_in": True,
            "contact_email": "follow-up@example.com",
        }
        values.update(overrides)
        return StudentSurvey.objects.create(**values)

    def create_v2_survey(self, enrollment=None, contact_email="v2-contact@example.com", **overrides):
        enrollment = enrollment or self.enrollment
        r08 = GrowthRecordSubmission.objects.get(enrollment=enrollment, definition__slot_id="R08")
        responses = {
            "q1_helpfulness": "very_helpful",
            "q2_practice_ratio": "balanced",
            "q3_topics": ["ai_uas", "project_showcase"],
            "q4_improvements": ["practical_time"],
            "q5_feedback": "增加實作時間",
            "q6_interests": ["physical_ai", "industry_tasks"],
            "q7_paths": ["industry_pilot", "seed_instructor"],
            "q8_intent": "learn_more",
            "q9_courses": ["industry_pilot", "seed_instructor"],
        }
        responses.update(overrides.pop("v2_responses", {}))
        return StudentSurvey.objects.create(
            student=enrollment.student,
            enrollment=enrollment,
            growth_record=r08,
            a01=5,
            a02=2,
            a03=0,
            a04=0,
            a05=0,
            a06=0,
            a07=0,
            survey_version="v2",
            v2_responses=responses,
            contact_opt_in=bool(contact_email),
            contact_email=contact_email,
        )

    def test_teacher_dashboard_shows_scoped_survey_stats_and_privacy(self):
        self.create_survey()
        self.create_survey(self.other_enrollment, contact_email="other-contact@example.com")

        response = self.client.get(reverse("learning:teacher_survey_dashboard"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "R08 學員發展調查")
        self.assertContains(response, "已完成問卷")
        self.assertContains(response, "1")
        self.assertEqual(response.context["analytics"]["path_stats"]["path_2_0"]["levels"][0]["count"], 1)
        self.assertNotContains(response, "follow-up@example.com")
        self.assertNotContains(response, "student-login@example.com")
        self.assertNotContains(response, "other-contact@example.com")

    def test_student_and_unauthenticated_users_cannot_open_dashboard(self):
        self.client.force_login(self.profile.user)
        self.assertEqual(self.client.get(reverse("learning:teacher_survey_dashboard")).status_code, 403)
        self.client.logout()
        self.assertEqual(self.client.get(reverse("learning:teacher_survey_dashboard")).status_code, 302)

    def test_teacher_cannot_view_unauthorized_survey_detail(self):
        survey = self.create_survey(self.other_enrollment)
        response = self.client.get(reverse("learning:teacher_survey_detail", args=[survey.enrollment_id]))
        self.assertEqual(response.status_code, 404)

    def test_path_g03_and_interest_filters_are_real(self):
        self.create_survey(
            path_20_interest="not_now",
            path_25_interest="very_interested",
            future_interests=["fpv"],
            advanced_course_intent="INTERESTED",
            contact_opt_in=False,
            contact_email="",
        )

        response = self.client.get(
            reverse("learning:teacher_survey_dashboard"),
            {"path_25": "very_interested", "g03": "INTERESTED", "interest": "fpv"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["analytics"]["completed_surveys"], 1)
        self.assertEqual(response.context["analytics"]["g03_stats"][1]["count"], 1)

    def test_contact_statuses_never_fall_back_to_login_email(self):
        survey = self.create_survey(contact_opt_in=True, contact_email="")
        response = self.client.get(reverse("learning:teacher_survey_detail", args=[survey.enrollment_id]))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "願意收到資訊／未留 Email")
        self.assertNotContains(response, "student-login@example.com")

    def test_updated_survey_is_reflected_without_cached_counts(self):
        survey = self.create_survey()
        survey.path_20_interest = "not_now"
        survey.path_30_interest = "very_interested"
        survey.save()

        response = self.client.get(reverse("learning:teacher_survey_dashboard"))

        self.assertEqual(response.context["analytics"]["path_stats"]["path_3_0"]["levels"][0]["count"], 1)

    def test_overview_counts_incomplete_authorized_enrollments(self):
        response = self.client.get(reverse("learning:teacher_survey_dashboard"))
        analytics = response.context["analytics"]
        self.assertEqual(analytics["total_students"], 2 - 1)
        self.assertEqual(analytics["completed_surveys"], 0)
        self.assertEqual(analytics["incomplete_surveys"], 1)

    def test_path_25_and_path_30_stats_are_separate(self):
        self.create_survey(path_20_interest="not_now", path_25_interest="interested", path_30_interest="very_interested")
        stats = self.client.get(reverse("learning:teacher_survey_dashboard")).context["analytics"]["path_stats"]
        self.assertEqual(stats["path_2_5"]["levels"][1]["count"], 1)
        self.assertEqual(stats["path_3_0"]["levels"][0]["count"], 1)

    def test_all_g03_states_are_counted(self):
        states = ["HIGH", "INTERESTED", "TIME_UNCERTAIN", "INFO_ONLY", "NONE"]
        for index, state in enumerate(states):
            profile = create_student_account(f"g03-{index}@example.com", f"G03 {index}")
            enrollment = enroll_student(profile, self.cohort)
            ensure_growth_submissions(enrollment)
            self.create_survey(enrollment, advanced_course_intent=state)
        stats = self.client.get(reverse("learning:teacher_survey_dashboard")).context["analytics"]["g03_stats"]
        self.assertEqual([item["count"] for item in stats], [1, 1, 1, 1, 1])

    def test_path_g03_cross_counts_high_and_interested_separately(self):
        self.create_survey(advanced_course_intent="HIGH")
        cross = self.client.get(reverse("learning:teacher_survey_dashboard")).context["analytics"]["cross_stats"]
        self.assertEqual(cross["path_2_0"]["high"], 1)
        self.assertEqual(cross["path_2_0"]["interested_high"], 0)

    def test_interest_percentage_uses_completed_surveys(self):
        self.create_survey(future_interests=["fpv", "rover"])
        item = next(item for item in self.client.get(reverse("learning:teacher_survey_dashboard")).context["analytics"]["interest_stats"] if item["value"] == "fpv")
        self.assertEqual(item["count"], 1)
        self.assertEqual(item["percent"], 100.0)

    def test_license_format_duration_and_priority_stats(self):
        self.create_survey()
        analytics = self.client.get(reverse("learning:teacher_survey_dashboard")).context["analytics"]
        self.assertEqual(next(item for item in analytics["license_stats"] if item["value"] == "g2")["count"], 1)
        self.assertEqual(next(item for item in analytics["format_stats"] if item["value"] == "weekend")["count"], 1)
        self.assertEqual(next(item for item in analytics["duration_stats"] if item["value"] == "4_6_weeks")["count"], 1)
        self.assertEqual(next(item for item in analytics["priority_stats"] if item["value"] == "content")["count"], 1)

    def test_contactable_detail_shows_only_explicit_contact_email(self):
        survey = self.create_survey(contact_opt_in=True, contact_email="follow-up@example.com")
        response = self.client.get(reverse("learning:teacher_survey_detail", args=[survey.enrollment_id]))
        self.assertContains(response, "follow-up@example.com")
        self.assertNotContains(response, "student-login@example.com")

    def test_contact_filters_select_each_status(self):
        self.create_survey(contact_opt_in=False, contact_email="")
        for value, expected in (("survey_only", 1), ("willing_no_email", 0), ("contactable", 0)):
            context = self.client.get(reverse("learning:teacher_survey_dashboard"), {"contact": value}).context
            self.assertEqual(context["analytics"]["filtered_count"], expected)

    def test_cohort_filter_scopes_the_overview(self):
        response = self.client.get(reverse("learning:teacher_survey_dashboard"), {"cohort": self.cohort.pk})
        self.assertEqual(response.context["analytics"]["total_students"], 1)

    def test_teacher_dashboard_contains_survey_entry(self):
        response = self.client.get(reverse("learning:teacher_dashboard"))
        self.assertContains(response, "R08 學員發展調查")

    def test_detail_contains_b_to_k_answer_sections(self):
        survey = self.create_survey()
        response = self.client.get(reverse("learning:teacher_survey_detail", args=[survey.enrollment_id]))
        self.assertContains(response, "B～C 學習興趣")
        self.assertContains(response, "E～G 課程偏好")
        self.assertContains(response, "G03 實際進階學習意願")

    def test_dashboard_does_not_offer_email_sending_controls(self):
        response = self.client.get(reverse("learning:teacher_survey_dashboard"))
        self.assertNotContains(response, "mailto:")
        self.assertNotContains(response, "一鍵通知")
        self.assertNotContains(response, "群發")

    def test_v2_dashboard_reads_saved_responses(self):
        self.create_v2_survey()
        context = self.client.get(reverse("learning:teacher_survey_dashboard")).context
        analytics = context["analytics_v2"]
        self.assertEqual(analytics["completed"], 1)
        self.assertEqual(next(item for item in analytics["q1_stats"] if item["value"] == "very_helpful")["count"], 1)
        self.assertEqual(next(item for item in analytics["q6_stats"] if item["value"] == "physical_ai")["count"], 1)
        self.assertEqual(next(item for item in analytics["q7_stats"] if item["value"] == "industry_pilot")["count"], 1)
        self.assertEqual(next(item for item in analytics["q8_stats"] if item["value"] == "learn_more")["count"], 1)
        self.assertEqual(next(item for item in analytics["q9_stats"] if item["value"] == "seed_instructor")["count"], 1)
        self.assertEqual(analytics["contact_counts"]["with_email"], 1)

    def test_v2_dashboard_counts_fpv_course_choice(self):
        self.create_v2_survey(v2_responses={"q9_courses": ["fpv_professional"]})
        response = self.client.get(reverse("learning:teacher_survey_dashboard"))
        analytics = response.context["analytics_v2"]
        fpv = next(item for item in analytics["q9_stats"] if item["value"] == "fpv_professional")
        self.assertEqual(fpv["count"], 1)
        self.assertContains(response, "FPV 專業飛手／工程應用課程")

    def test_v2_filters_select_saved_responses_and_email_state(self):
        self.create_v2_survey()
        second_profile = create_student_account("v2-second@example.com", "第二位學員")
        second_enrollment = enroll_student(second_profile, self.cohort)
        ensure_growth_submissions(second_enrollment)
        self.create_v2_survey(
            enrollment=second_enrollment,
            contact_email="",
            v2_responses={"q7_paths": ["technician"], "q8_intent": "practice_first", "q9_courses": []},
        )
        url = reverse("learning:teacher_survey_dashboard")
        self.assertEqual(self.client.get(url, {"v2_path": "industry_pilot"}).context["analytics_v2"]["completed"], 1)
        self.assertEqual(self.client.get(url, {"v2_intent": "practice_first"}).context["analytics_v2"]["completed"], 1)
        self.assertEqual(self.client.get(url, {"v2_contact": "without_email"}).context["analytics_v2"]["completed"], 1)
