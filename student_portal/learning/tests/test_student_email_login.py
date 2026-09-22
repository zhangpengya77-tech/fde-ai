import uuid
import re

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse

from learning.models import ClassCode, Cohort, EmailVerificationCode, Enrollment, StudentProfile


@override_settings(
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
)
class StudentEmailLoginTests(TestCase):
    password = "A-strong-passphrase-984!"

    def create_student(self, *, username, email, active=True):
        user = get_user_model().objects.create_user(
            username=username,
            email=email,
            password=self.password,
            is_active=active,
        )
        profile = StudentProfile.objects.create(
            student_id=uuid.uuid4().hex,
            nickname="Email Login Test",
            email=email,
            user=user,
        )
        cohort = Cohort.objects.create(cohort_id="2099-01", name="Login Test")
        Enrollment.objects.create(student=profile, cohort=cohort)
        return user

    def test_student_can_login_with_email_when_username_differs(self):
        user = self.create_student(
            username="legacy-user-1",
            email="email-login@example.com",
        )

        response = self.client.post(
            reverse("learning:student_login"),
            {"username": "  EMAIL-LOGIN@EXAMPLE.COM ", "password": self.password},
        )

        self.assertRedirects(response, reverse("learning:student_dashboard"))
        self.assertEqual(int(self.client.session["_auth_user_id"]), user.pk)

    def test_inactive_student_gets_verification_message(self):
        self.create_student(
            username="legacy-user-2",
            email="inactive-login@example.com",
            active=False,
        )

        response = self.client.post(
            reverse("learning:student_login"),
            {"username": "inactive-login@example.com", "password": self.password},
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "此帳號尚未完成電子郵件驗證")
        self.assertContains(response, "重新寄送驗證碼")

    def test_used_verification_record_repairs_inactive_account_during_login(self):
        user = self.create_student(
            username="verified-but-inactive",
            email="verified-but-inactive@example.com",
            active=False,
        )
        EmailVerificationCode.objects.create(
            user=user,
            code_hash="unused-in-test",
            expires_at="2099-01-01T00:00:00Z",
            consumed_at="2026-01-01T00:00:00Z",
        )

        response = self.client.post(
            reverse("learning:student_login"),
            {"username": "verified-but-inactive@example.com", "password": self.password},
        )

        self.assertRedirects(response, reverse("learning:student_dashboard"))
        user.refresh_from_db()
        self.assertTrue(user.is_active)

    def test_registration_activation_and_email_login_flow(self):
        cohort = Cohort.objects.create(cohort_id="2026-01", name="Registration Login Test")
        ClassCode.objects.create(code="2026-01", cohort=cohort)
        response = self.client.post(
            reverse("learning:register"),
            {
                "nickname": "Registration Login Test",
                "email": "registration-login@example.com",
                "class_code": "2026-01",
                "training_source": "other",
                "project_direction": "",
                "password1": self.password,
                "password2": self.password,
            },
        )
        self.assertEqual(response.status_code, 302)
        profile = StudentProfile.objects.get(email="registration-login@example.com")
        self.assertFalse(profile.user.is_active)
        code = re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)

        activation = self.client.post(
            reverse("learning:activate", args=[profile.public_user_id]),
            {"code": code},
        )
        self.assertRedirects(activation, reverse("learning:student_login"))
        profile.user.refresh_from_db()
        self.assertTrue(profile.user.is_active)

        login = self.client.post(
            reverse("learning:student_login"),
            {"username": "REGISTRATION-LOGIN@EXAMPLE.COM", "password": self.password},
        )
        self.assertRedirects(login, reverse("learning:student_dashboard"))
        growth = self.client.get(reverse("learning:student_growth_entry"))
        self.assertRedirects(growth, reverse("learning:student_growth_dashboard", args=[profile.enrollments.get().pk]))

    def test_duplicate_unverified_email_shows_existing_activation_recovery(self):
        user = self.create_student(
            username="pending-registration",
            email="pending-registration@example.com",
            active=False,
        )
        EmailVerificationCode.objects.create(
            user=user,
            code_hash="unused-in-test",
            expires_at="2099-01-01T00:00:00Z",
        )

        response = self.client.post(
            reverse("learning:register"),
            {
                "nickname": "Retry Registration",
                "email": "PENDING-REGISTRATION@EXAMPLE.COM",
                "class_code": "2026-01",
                "training_source": "other",
                "project_direction": "",
                "password1": self.password,
                "password2": self.password,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "繼續驗證此帳號")
        self.assertContains(
            response,
            reverse("learning:activate", args=[user.student_profile.public_user_id]),
        )

    def test_login_page_can_resend_verification_for_unverified_email(self):
        user = self.create_student(
            username="resend-from-login",
            email="resend-from-login@example.com",
            active=False,
        )

        response = self.client.post(
            reverse("learning:resend_activation_by_email"),
            {"email": " RESEND-FROM-LOGIN@EXAMPLE.COM "},
        )

        self.assertRedirects(response, reverse("learning:student_login"))
        self.assertEqual(len(mail.outbox), 1)
        self.assertTrue(
            EmailVerificationCode.objects.filter(user=user, consumed_at__isnull=True).exists()
        )
