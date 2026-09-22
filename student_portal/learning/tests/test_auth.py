import io
import re
from contextlib import redirect_stdout
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from django.contrib.auth import get_user_model
from django.contrib.messages import get_messages
from django.core import mail
from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from learning.models import ClassCode, Cohort, EmailVerificationCode, StudentProfile
from learning.tests.helpers import create_student_account


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class StudentRegistrationTests(TestCase):
    password = "A-strong-passphrase-984!"

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="2026-01", name="2026 第一梯")
        ClassCode.objects.create(code="2026-01", cohort=self.cohort)

    def register(self, email="student@example.com", nickname="Eagle"):
        return self.client.post(
            reverse("learning:register"),
            {
                "nickname": nickname,
                "email": email,
                "class_code": "2026-01",
                "training_source": "other",
                "project_direction": "",
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
        for label in (
            'id="missions"',
            'id="learn"',
            'id="inspection"',
            'id="teacher"',
            "開始學習 / 註冊",
            "學員登入",
            "教師登入",
        ):
            self.assertContains(response, label)

    def test_authenticated_student_home_remains_public_and_shows_identity_navigation(self):
        profile = create_student_account("home-student@example.com", "Home Student")
        self.client.force_login(profile.user)

        response = self.client.get(reverse("learning:home"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="moduleNav"')
        self.assertContains(response, profile.public_user_id)
        self.assertContains(response, "我的學習成長日誌")

    def test_authenticated_teacher_home_remains_public_and_links_real_dashboard(self):
        teacher = get_user_model().objects.create_user(
            username="home-teacher", email="home-teacher@example.com", password="Teacher-passphrase-998!", is_staff=True
        )
        self.client.force_login(teacher)

        response = self.client.get(reverse("learning:home"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="moduleNav"')
        self.assertContains(response, "教師後台")

    def test_original_v12_page_and_assets_are_public(self):
        page = self.client.get(reverse("learning:platform"))
        asset = self.client.get(reverse("learning:platform_asset", args=["src/styles.css"]))

        self.assertEqual(page.status_code, 200)
        self.assertContains(page, 'id="moduleNav"')
        self.assertEqual(asset.status_code, 200)

    def test_platform_hero_action_opens_student_growth_portal(self):
        self.register()
        profile = StudentProfile.objects.get(email="student@example.com")
        self.activate(profile)
        self.client.force_login(profile.user)

        response = self.client.get(
            reverse("learning:platform_asset", args=["src/platform-browser.js"])
        )
        source = b"".join(response.streaming_content).decode("utf-8")

        self.assertEqual(response.status_code, 200)
        self.assertIn("label: '我的學習日誌'", source)
        self.assertIn("target: '/student/'", source)

    def test_student_login_form_preserves_protected_page_destination(self):
        destination = reverse("learning:student_dashboard")

        response = self.client.get(f"{reverse('learning:student_login')}?next={destination}")

        self.assertContains(response, f'name="next" value="{destination}"')

    def test_registration_activation_and_login_preserve_protected_destination(self):
        destination = "/student/courses/42/growth/R01/"
        registration_page = self.client.get(f"{reverse('learning:register')}?next={destination}")
        self.assertContains(registration_page, f'name="next" value="{destination}"')

        response = self.client.post(
            reverse("learning:register"),
            {
                "nickname": "Return Path",
                "email": "return-path@example.com",
                "class_code": "2026-01",
                "training_source": "other",
                "project_direction": "",
                "password1": self.password,
                "password2": self.password,
                "next": destination,
            },
        )
        profile = StudentProfile.objects.get(email="return-path@example.com")
        self.assertEqual(response.status_code, 302)
        self.assertIn("next=%2Fstudent%2Fcourses%2F42%2Fgrowth%2FR01%2F", response["Location"])

        activation_page = self.client.get(response["Location"])
        self.assertContains(activation_page, f'name="next" value="{destination}"')
        code = re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)
        activation = self.client.post(
            reverse("learning:activate", args=[profile.public_user_id]),
            {"code": code, "next": destination},
        )
        self.assertEqual(parse_qs(urlsplit(activation["Location"]).query)["next"], [destination])

        login = self.client.post(
            reverse("learning:student_login"),
            {"username": profile.email, "password": self.password, "next": destination},
        )
        self.assertEqual(login["Location"], destination)

    def test_registration_discards_external_next_destination(self):
        response = self.client.post(
            reverse("learning:register"),
            {
                "nickname": "External Path",
                "email": "external-path@example.com",
                "class_code": "2026-01",
                "training_source": "other",
                "project_direction": "",
                "password1": self.password,
                "password2": self.password,
                "next": "https://attacker.example/collect",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.assertNotIn("next=", response["Location"])

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
        record = EmailVerificationCode.objects.get(user=profile.user)
        self.assertEqual(record.user.email, profile.email)
        self.assertIsNone(record.consumed_at)
        self.assertEqual(record.attempts, 0)
        self.assertGreater(record.expires_at, record.created_at)
        self.assertAlmostEqual((record.expires_at - record.created_at).total_seconds(), 900, delta=1)

    def test_registration_page_has_independent_accessible_password_toggles(self):
        response = self.client.get(reverse("learning:register"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content.decode().count('type="password"'), 2)
        self.assertContains(response, 'data-password-toggle="id_password1"')
        self.assertContains(response, 'data-password-toggle="id_password2"')
        self.assertEqual(response.content.decode().count('aria-label="顯示密碼"'), 2)
        self.assertContains(response, "input.type = visible ? 'text' : 'password'")

    def test_console_email_backend_is_explained_on_activation_page(self):
        console_output = io.StringIO()
        with override_settings(EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend"):
            with redirect_stdout(console_output):
                response = self.register()
                profile = StudentProfile.objects.get(email="student@example.com")
                activation = self.client.get(reverse("learning:activate", args=[profile.public_user_id]))

        self.assertEqual(response.status_code, 302)
        self.assertContains(activation, "開發模式：驗證碼已輸出至伺服器控制台")
        self.assertRegex(console_output.getvalue(), r"驗證碼是：\d{6}")

    def test_registration_mail_failure_is_visible_logged_and_rolls_back(self):
        with patch("learning.services.send_mail", side_effect=OSError("SMTP connection refused")):
            with self.assertLogs("learning.views", level="ERROR") as captured:
                response = self.register("failure@example.com")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "驗證碼寄送失敗，請稍後重試。")
        self.assertIn("SMTP connection refused", "\n".join(captured.output))
        self.assertFalse(StudentProfile.objects.filter(email="failure@example.com").exists())
        self.assertFalse(get_user_model().objects.filter(email="failure@example.com").exists())

    def test_registration_rejects_a_mail_backend_that_accepts_zero_messages(self):
        with patch("learning.services.send_mail", return_value=0):
            with self.assertLogs("learning.services", level="ERROR"):
                response = self.register("not-sent@example.com")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "驗證碼寄送失敗，請稍後重試。")
        self.assertFalse(StudentProfile.objects.filter(email="not-sent@example.com").exists())

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
        self.assertContains(page, "st***@example.com")

        EmailVerificationCode.objects.filter(user=profile.user).update(
            created_at=timezone.now() - timedelta(seconds=61)
        )
        first = self.client.post(reverse("learning:resend_activation", args=[profile.public_user_id]))
        second = self.client.post(reverse("learning:resend_activation", args=[profile.public_user_id]))
        self.assertEqual(first.status_code, 302)
        self.assertEqual(second.status_code, 302)
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(EmailVerificationCode.objects.filter(user=profile.user, consumed_at__isnull=True).count(), 1)

    def test_resend_mail_failure_is_reported_instead_of_success(self):
        self.register()
        profile = StudentProfile.objects.get(email="student@example.com")
        EmailVerificationCode.objects.filter(user=profile.user).update(
            created_at=timezone.now() - timedelta(seconds=61)
        )

        with patch("learning.services.send_mail", side_effect=OSError("SMTP unavailable")):
            with self.assertLogs("learning.views", level="ERROR") as captured:
                response = self.client.post(
                    reverse("learning:resend_activation", args=[profile.public_user_id]), follow=True
                )

        self.assertContains(response, "驗證碼寄送失敗，請稍後重試。")
        self.assertIn("SMTP unavailable", "\n".join(captured.output))
        self.assertNotContains(response, "若帳號符合驗證條件，系統已寄送驗證碼")

    def test_verification_email_resends_are_limited_per_hour(self):
        self.register()
        profile = StudentProfile.objects.get(email="student@example.com")
        resend_url = reverse("learning:resend_activation", args=[profile.public_user_id])

        for _ in range(4):
            EmailVerificationCode.objects.filter(user=profile.user).update(
                created_at=timezone.now() - timedelta(seconds=61)
            )
            self.client.post(resend_url)

        self.assertEqual(EmailVerificationCode.objects.filter(user=profile.user).count(), 5)
        EmailVerificationCode.objects.filter(user=profile.user).update(
            created_at=timezone.now() - timedelta(seconds=61)
        )
        response = self.client.post(resend_url, follow=True)

        self.assertContains(response, "驗證碼請求次數過多，請一小時後再試。")
        self.assertEqual(EmailVerificationCode.objects.filter(user=profile.user).count(), 5)

    def test_email_activation_enables_email_login_and_opens_student_dashboard(self):
        self.register()
        profile = StudentProfile.objects.get(email="student@example.com")
        activation = self.client.post(
            reverse("learning:activate", args=[profile.public_user_id]),
            {"code": re.search(r"\b\d{6}\b", mail.outbox[-1].body).group(0)},
            follow=True,
        )
        self.assertEqual(activation.status_code, 200)
        self.assertContains(activation, f"永久 FDE ID：{profile.public_user_id}")
        profile.user.refresh_from_db()
        self.assertTrue(profile.user.is_active)

        login = self.client.post(
            reverse("learning:student_login"),
            {"username": "STUDENT@example.com", "password": self.password},
        )
        self.assertEqual(login.status_code, 302)
        self.assertEqual(login["Location"], reverse("learning:student_dashboard"))
        self.assertEqual(self.client.get(reverse("learning:student_dashboard")).status_code, 200)

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
