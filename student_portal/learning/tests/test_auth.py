import re
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.messages import get_messages
from django.core import mail
from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from learning.models import EmailVerificationCode, StudentProfile


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class StudentRegistrationTests(TestCase):
    password = "A-strong-passphrase-984!"

    def register(self, email="student@example.com", nickname="Eagle"):
        return self.client.post(
            reverse("learning:register"),
            {
                "nickname": nickname,
                "email": email,
                "password1": self.password,
                "password2": self.password,
            },
        )

    def activate(self, profile):
        code = re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)
        return self.client.post(reverse("learning:activate", args=[profile.public_user_id]), {"code": code})

    def test_public_landing_shows_learning_flow_and_auth_entry_points(self):
        response = self.client.get(reverse("learning:home"))

        self.assertEqual(response.status_code, 200)
        for label in ("Learn", "Practice", "Build", "Assess", "Certify", "開始學習 / 註冊", "學員登入", "教師登入"):
            self.assertContains(response, label)

    def test_original_v12_page_and_assets_require_authentication(self):
        page = self.client.get(reverse("learning:platform"))
        asset = self.client.get(reverse("learning:platform_asset", args=["src/styles.css"]))

        self.assertEqual(page.status_code, 302)
        self.assertEqual(asset.status_code, 302)

    def test_registration_generates_anonymous_id_and_sends_verification_code(self):
        response = self.register("Student@Example.com", "Eagle")

        self.assertEqual(response.status_code, 302)
        profile = StudentProfile.objects.get(email="student@example.com")
        self.assertRegex(profile.public_user_id, r"^FDE-26-[A-Z0-9]{6}$")
        self.assertEqual(profile.nickname, "Eagle")
        self.assertFalse(profile.user.is_active)
        self.assertEqual(profile.user.username, "student@example.com")
        self.assertEqual(len(mail.outbox), 1)
        self.assertRegex(mail.outbox[0].body, r"\b\d{6}\b")
        code = re.search(r"\b\d{6}\b", mail.outbox[0].body).group(0)
        self.assertNotIn(code, response.content.decode())

    def test_duplicate_email_is_rejected_case_insensitively(self):
        self.register()
        response = self.register("STUDENT@example.com", "Second")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(StudentProfile.objects.filter(email="student@example.com").count(), 1)
        self.assertEqual(len(mail.outbox), 1)
        self.assertContains(response, "已註冊")

    def test_public_id_cannot_be_changed_after_creation(self):
        self.register()
        profile = StudentProfile.objects.get(email="student@example.com")
        original_id = profile.public_user_id
        profile.public_user_id = "FDE-26-ZZZZZZ"

        with self.assertRaises(ValidationError):
            profile.save()

        profile.refresh_from_db()
        self.assertEqual(profile.public_user_id, original_id)

    def test_activation_page_hides_email_and_resend_is_rate_limited(self):
        self.register()
        profile = StudentProfile.objects.get(email="student@example.com")
        activation_url = reverse("learning:activate", args=[profile.public_user_id])
        page = self.client.get(activation_url)
        self.assertNotContains(page, "student@example.com")

        EmailVerificationCode.objects.filter(user=profile.user).update(
            created_at=timezone.now() - timedelta(seconds=61)
        )
        first = self.client.post(reverse("learning:resend_activation", args=[profile.public_user_id]))
        second = self.client.post(reverse("learning:resend_activation", args=[profile.public_user_id]))
        self.assertEqual(first.status_code, 302)
        self.assertEqual(second.status_code, 302)
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(EmailVerificationCode.objects.filter(user=profile.user, consumed_at__isnull=True).count(), 1)

    def test_email_activation_enables_email_login_and_platform_access(self):
        self.register()
        profile = StudentProfile.objects.get(email="student@example.com")
        activation = self.activate(profile)
        self.assertEqual(activation.status_code, 302)
        profile.user.refresh_from_db()
        self.assertTrue(profile.user.is_active)

        login = self.client.post(
            reverse("learning:student_login"),
            {"username": "STUDENT@example.com", "password": self.password},
        )
        self.assertEqual(login.status_code, 302)
        self.assertEqual(login["Location"], reverse("learning:platform"))
        self.assertEqual(self.client.get(reverse("learning:platform")).status_code, 200)

    def test_student_password_reset_never_targets_teacher_accounts(self):
        get_user_model().objects.create_user(
            username="teacher", email="teacher@example.com", password=self.password, is_staff=True
        )

        response = self.client.post(reverse("learning:password_reset"), {"email": "teacher@example.com"})

        self.assertEqual(response.status_code, 302)
        self.assertEqual(len(mail.outbox), 0)

    def test_password_reset_response_does_not_disclose_account_existence(self):
        self.register()
        profile = StudentProfile.objects.get(email="student@example.com")
        self.activate(profile)

        existing = self.client.post(reverse("learning:password_reset"), {"email": "student@example.com"})
        unknown = self.client.post(reverse("learning:password_reset"), {"email": "unknown@example.com"})

        self.assertEqual(existing.status_code, unknown.status_code)
        self.assertEqual(existing.content, unknown.content)
