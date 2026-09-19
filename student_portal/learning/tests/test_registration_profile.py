from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse

from learning.models import ClassCode, Cohort, Enrollment, StudentProfile, TeacherCohortAccess
from learning.forms import StudentRegistrationForm
from learning.tests.helpers import create_student_account


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class RegistrationProfileTests(TestCase):
    password = "A-strong-passphrase-984!"

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="2026-01", name="2026 第一梯")
        ClassCode.objects.create(code="2026-01", cohort=self.cohort)

    def test_registration_reuses_identity_and_creates_enrollment_from_class_code(self):
        page = self.client.get(reverse("learning:register"))
        self.assertContains(page, "暱稱")
        self.assertContains(page, "脫敏姓名")
        self.assertContains(page, "班級代碼")
        self.assertContains(page, "組別／專案方向")
        response = self.client.post(
            reverse("learning:register"),
            {
                "nickname": "課堂學員",
                "email": "classroom@example.com",
                "class_code": "2026-01",
                "training_source": "in_service",
                "project_direction": "flight_f450",
                "password1": self.password,
                "password2": self.password,
            },
        )
        profile = StudentProfile.objects.get(email="classroom@example.com")
        enrollment = Enrollment.objects.get(student=profile)
        self.assertEqual(response.status_code, 302)
        self.assertRegex(profile.public_user_id, r"^FDE-\d{2}-[A-Z0-9]{6}$")
        self.assertEqual(enrollment.cohort_id, "2026-01")
        self.assertEqual(enrollment.project_direction, "flight_f450")
        self.assertFalse(enrollment.teacher_verified)
        self.assertFalse(profile.user.is_active)
        self.assertEqual(len(mail.outbox), 1)

    def test_existing_identity_and_email_activation_flow_remain_unchanged(self):
        profile = create_student_account("existing@example.com", "Existing")
        public_id = profile.public_user_id
        self.client.post(
            reverse("learning:register"),
            {
                "nickname": "Changed",
                "email": profile.email,
                "class_code": "2026-01",
                "training_source": "in_service",
                "project_direction": "flight_f450",
                "password1": self.password,
                "password2": self.password,
            },
        )
        self.assertEqual(StudentProfile.objects.get(pk=profile.pk).public_user_id, public_id)
        self.assertEqual(StudentProfile.objects.filter(email=profile.email).count(), 1)

    def test_teacher_can_confirm_enrollment_without_changing_identity(self):
        profile = create_student_account("verify@example.com", "Verify")
        enrollment = Enrollment.objects.create(student=profile, cohort=self.cohort)
        teacher = get_user_model().objects.create_user(
            username="classroom-teacher", email="teacher@example.com", password=self.password, is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=teacher, cohort=self.cohort)
        self.client.force_login(teacher)

        dashboard = self.client.get(reverse("learning:teacher_dashboard"))
        self.assertContains(dashboard, "待核對")
        self.assertContains(dashboard, profile.public_user_id)
        self.assertContains(dashboard, "verify@example.com")
        response = self.client.post(reverse("learning:teacher_toggle_verified", args=[enrollment.pk]))
        self.assertRedirects(response, reverse("learning:teacher_dashboard"))
        enrollment.refresh_from_db()
        self.assertTrue(enrollment.teacher_verified)

    def test_teacher_can_copy_nickname_and_save_verified_name_without_student_exposure(self):
        profile = create_student_account("identity@example.com", "張×亞")
        enrollment = Enrollment.objects.create(student=profile, cohort=self.cohort)
        teacher = get_user_model().objects.create_user(
            username="identity-teacher", email="identity-teacher@example.com", password=self.password, is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=teacher, cohort=self.cohort)
        self.client.force_login(teacher)

        detail = self.client.get(reverse("learning:teacher_student_detail", args=[enrollment.pk]))
        self.assertContains(detail, "帶入暱稱")
        self.assertContains(detail, "保存身份資料")
        self.assertContains(detail, "identity@example.com")

        response = self.client.post(
            reverse("learning:teacher_save_identity", args=[enrollment.pk]),
            {"teacher_verified_name": "張鵬亞"},
        )
        self.assertRedirects(response, reverse("learning:teacher_student_detail", args=[enrollment.pk]))
        enrollment.refresh_from_db()
        self.assertEqual(enrollment.teacher_verified_name, "張鵬亞")

        self.client.force_login(profile.user)
        student_page = self.client.get(reverse("learning:student_dashboard"))
        self.assertNotContains(student_page, "張鵬亞")

    def test_existing_enrollment_without_verified_name_remains_compatible(self):
        profile = create_student_account("legacy-identity@example.com", "Legacy")
        enrollment = Enrollment.objects.create(student=profile, cohort=self.cohort)
        self.assertEqual(enrollment.teacher_verified_name, "")

    def test_invalid_class_code_does_not_create_enrollment(self):
        response = self.client.post(
            reverse("learning:register"),
            {
                "nickname": "No Class",
                "email": "no-class@example.com",
                "class_code": "9999-99",
                "training_source": "in_service",
                "project_direction": "",
                "password1": self.password,
                "password2": self.password,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "不是一個可用的選項")
        self.assertFalse(StudentProfile.objects.filter(email="no-class@example.com").exists())

    def test_registration_class_code_is_a_fixed_select_with_2026_default(self):
        form = StudentRegistrationForm()

        self.assertEqual(form.fields["class_code"].initial, "2026-01")
        self.assertEqual(
            [value for value, _label in form.fields["class_code"].choices],
            ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"],
        )
        self.assertTrue(form.fields["class_code"].required)
        self.assertEqual(form.fields["class_code"].help_text, "請依教師指示選擇本期班級代碼。")

    def test_all_2026_registration_class_codes_are_backend_valid(self):
        for code in ("2026-02", "2026-03", "2026-04", "2026-05", "2026-06"):
            cohort = Cohort.objects.create(cohort_id=code, name=f"{code} 班")
            ClassCode.objects.create(code=code, cohort=cohort)

        for index, code in enumerate(("2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06")):
            form = StudentRegistrationForm(
                data={
                    "nickname": f"班級 {code}",
                    "email": f"class-{index}@example.com",
                    "class_code": code,
                    "training_source": "in_service",
                    "project_direction": "",
                    "password1": self.password,
                    "password2": self.password,
                }
            )
            self.assertTrue(form.is_valid(), form.errors)

    def test_registration_requires_training_source_and_saves_it_on_enrollment(self):
        form = StudentRegistrationForm()
        self.assertEqual(form.fields["training_source"].initial, None)
        self.assertTrue(form.fields["training_source"].required)
        self.assertEqual(
            list(form.fields["training_source"].choices),
            [
                ("", "請選擇班型來源"),
                ("pre_employment", "職前培訓"),
                ("in_service", "在職培訓"),
                ("college", "大中專院校"),
                ("other", "其他"),
            ],
        )

        data = {
            "nickname": "班型測試",
            "email": "training-source@example.com",
            "class_code": "2026-01",
            "training_source": "college",
            "project_direction": "",
            "password1": self.password,
            "password2": self.password,
        }
        form = StudentRegistrationForm(data=data)
        self.assertTrue(form.is_valid(), form.errors)
        profile = form.create_account()
        self.assertEqual(profile.enrollments.get().training_source, "college")

        data["email"] = "training-source-missing@example.com"
        data["training_source"] = ""
        self.assertFalse(StudentRegistrationForm(data=data).is_valid())
