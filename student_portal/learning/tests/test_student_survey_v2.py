from django.urls import reverse
from django.test import TestCase

from learning.forms import StudentSurveyV2Form
from learning.models import Cohort, GrowthRecordSubmission, StudentSurvey
from learning.survey_recommendations import recommend_v2_paths
from learning.tests.helpers import create_student_account, enroll_student
from learning.growth_records import ensure_growth_submissions


class StudentSurveyV2FormTests(TestCase):
    def valid_data(self):
        return {
            "q1_helpfulness": "very_helpful",
            "q2_practice_ratio": "more_practice",
            "q3_topics": ["flight_license", "assembly_repair", "industry_tasks"],
            "q3_other": "",
            "q4_improvements": ["practical_time"],
            "q4_other": "",
            "q5_feedback": "增加實作時間",
            "q6_interests": ["flight_license", "assembly_repair", "physical_ai"],
            "q7_paths": ["industry_pilot", "technician"],
            "q8_intent": "deep_learning",
            "q9_courses": ["industry_pilot", "technician"],
            "contact_email": "",
            "contact_phone": "",
        }

    def test_v2_form_accepts_valid_answers_without_email(self):
        form = StudentSurveyV2Form(data=self.valid_data())
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(form.cleaned_data["contact_email"], "")

    def test_q9_accepts_fpv_professional_course(self):
        data = self.valid_data()
        data["q9_courses"] = ["fpv_professional"]
        form = StudentSurveyV2Form(data=data)
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(form.cleaned_data["q9_courses"], ["fpv_professional"])

    def test_phone_is_optional_and_accepts_common_formats(self):
        for phone in ("0912345678", "0912-345-678", "02-12345678", "+886912345678", "(02) 1234 5678"):
            data = self.valid_data()
            data["contact_phone"] = phone
            form = StudentSurveyV2Form(data=data)
            self.assertTrue(form.is_valid(), (phone, form.errors))
            self.assertEqual(form.cleaned_data["contact_phone"], phone)

        data = self.valid_data()
        data["contact_phone"] = "phone-not-valid"
        self.assertFalse(StudentSurveyV2Form(data=data).is_valid())

    def test_v2_selection_limits_are_enforced_server_side(self):
        data = self.valid_data()
        data["q3_topics"] = ["flight_license", "assembly_repair", "industry_tasks", "other"]
        data["q6_interests"] = ["flight_license", "assembly_repair", "mapping_printing", "physical_ai"]
        data["q7_paths"] = ["industry_pilot", "technician", "seed_instructor"]
        data["q9_courses"] = ["industry_pilot", "technician", "seed_instructor"]
        form = StudentSurveyV2Form(data=data)
        self.assertFalse(form.is_valid())
        for field in ("q3_topics", "q6_interests", "q7_paths", "q9_courses"):
            self.assertIn(field, form.errors)

    def test_undecided_path_is_exclusive(self):
        data = self.valid_data()
        data["q7_paths"] = ["undecided", "industry_pilot"]
        form = StudentSurveyV2Form(data=data)
        self.assertFalse(form.is_valid())
        self.assertIn("q7_paths", form.errors)

    def test_non_advanced_intent_clears_course_choices(self):
        data = self.valid_data()
        data["q8_intent"] = "practice_first"
        data["q9_courses"] = ["industry_pilot"]
        form = StudentSurveyV2Form(data=data)
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(form.cleaned_data["q9_courses"], [])


class StudentSurveyV2ViewTests(TestCase):
    def setUp(self):
        self.profile = create_student_account("survey-v2@example.com", "Survey V2 Student")
        self.cohort = Cohort.objects.create(cohort_id="2099-10", name="Survey V2 Cohort")
        self.enrollment = enroll_student(self.profile, self.cohort)
        ensure_growth_submissions(self.enrollment)
        self.r08 = GrowthRecordSubmission.objects.get(
            enrollment=self.enrollment, definition__slot_id="R08"
        )
        self.client.force_login(self.profile.user)

    def test_page_is_traditional_chinese_v2_without_legacy_field_names(self):
        response = self.client.get(reverse("learning:student_survey", args=[self.enrollment.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "R08｜職業人才成長路徑")
        self.assertContains(response, "Foundation Plus")
        self.assertContains(response, "Professional")
        self.assertContains(response, "行業無人機飛手")
        self.assertContains(response, "無人機種子教師／教官")
        self.assertContains(response, "AI／測繪／行業應用")
        self.assertContains(response, "Engineering（軟硬整合工程）")
        self.assertNotContains(response, "A01")
        self.assertNotContains(response, "advanced_course_intent")

    def test_page_explains_advanced_career_paths_before_course_choices(self):
        response = self.client.get(reverse("learning:student_survey", args=[self.enrollment.pk]))
        self.assertContains(response, "進階學習與職業發展方向")
        self.assertContains(response, "行業無人機飛手")
        self.assertContains(response, "FPV 專業飛手／工程應用")
        self.assertContains(response, "無人機種子教師／教官")
        self.assertContains(response, "無人機軟硬整合／軟體開發工程師")
        self.assertContains(response, "無人機足球")
        self.assertContains(response, "ROS 2")
        self.assertContains(response, "MAVLink")
        self.assertContains(response, "Gazebo")
        self.assertContains(response, "電力巡檢")
        self.assertContains(response, "物流運輸")
        self.assertContains(response, "FPV 專業飛手／工程應用課程")
        self.assertLess(
            response.content.index("無人機軟硬整合／軟體開發工程師".encode()),
            response.content.index("FPV 專業飛手／工程應用課程".encode()),
        )

    def test_career_intent_choices_are_saved_in_existing_v2_field(self):
        data = StudentSurveyV2FormTests().valid_data()
        data["q7_paths"] = ["engineering", "ai_industry"]
        self.client.post(reverse("learning:student_survey", args=[self.enrollment.pk]), data)
        survey = StudentSurvey.objects.get(enrollment=self.enrollment)
        self.assertEqual(survey.v2_responses["q7_paths"], ["engineering", "ai_industry"])

    def test_v2_submission_is_saved_and_does_not_copy_login_email(self):
        data = StudentSurveyV2FormTests().valid_data()
        data["contact_phone"] = "0912-345-678"
        response = self.client.post(reverse("learning:student_survey", args=[self.enrollment.pk]), data)
        self.assertRedirects(response, reverse("learning:student_survey", args=[self.enrollment.pk]))
        survey = StudentSurvey.objects.get(enrollment=self.enrollment)
        self.assertEqual(survey.survey_version, "v2")
        self.assertEqual(survey.contact_email, "")
        self.assertFalse(survey.contact_opt_in)
        self.assertEqual(survey.v2_responses["contact_phone"], "0912-345-678")
        self.assertEqual(survey.growth_record_id, self.r08.pk)

    def test_result_uses_q7_primary_and_q6_secondary(self):
        data = StudentSurveyV2FormTests().valid_data()
        data["q7_paths"] = ["software_engineer"]
        data["q6_interests"] = ["physical_ai"]
        response = self.client.post(reverse("learning:student_survey", args=[self.enrollment.pk]), data)
        self.assertEqual(response.status_code, 302)
        result = self.client.get(reverse("learning:student_survey_result", args=[self.enrollment.pk]))
        self.assertEqual(result.status_code, 200)
        self.assertContains(result, "無人機軟硬整合／軟體開發工程師")

    def test_undecided_without_ability_interest_shows_exploration(self):
        data = StudentSurveyV2FormTests().valid_data()
        data["q7_paths"] = ["undecided"]
        data["q6_interests"] = []
        self.client.post(reverse("learning:student_survey", args=[self.enrollment.pk]), data)
        result = self.client.get(reverse("learning:student_survey_result", args=[self.enrollment.pk]))
        self.assertContains(result, "你目前還在探索階段")

    def test_legacy_survey_without_v2_data_is_still_readable(self):
        survey = StudentSurvey.objects.create(
            student=self.profile,
            enrollment=self.enrollment,
            growth_record=self.r08,
            **{f"a0{index}": 3 for index in range(1, 8)},
        )
        self.assertEqual(survey.survey_version, "v1")
        result = self.client.get(reverse("learning:student_survey_result", args=[self.enrollment.pk]))
        self.assertEqual(result.status_code, 200)


class StudentSurveyV2RecommendationTests(TestCase):
    def test_email_and_intent_do_not_change_recommendation(self):
        survey = type("Survey", (), {
            "v2_responses": {
                "q6_interests": ["physical_ai"],
                "q7_paths": ["software_engineer"],
                "q8_intent": "none",
            }
        })()
        self.assertEqual(recommend_v2_paths(survey)[0]["key"], "software_engineer")
