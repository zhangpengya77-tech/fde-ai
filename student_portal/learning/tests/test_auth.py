import re
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.messages import get_messages
from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from learning.models import Cohort, EmailVerificationCode, StudentProfile


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class StudentRegistrationTests(TestCase):
    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="2026-01", name="2026 第一梯")
        self.profile = StudentProfile.objects.create(
            student_id="2026-01-S01",
            cohort=self.cohort,
            legal_name="張小雅",
            display_name="張某雅",
            expected_email="student@example.com",
        )

    def register(self, student_id="2026-01-S01", email="student@example.com"):
        return self.client.post(
            reverse("learning:register"),
            {
                "student_id": student_id,
                "email": email,
                "password1": "A-strong-passphrase-984!",
                "password2": "A-strong-passphrase-984!",
            },
        )

    def test_registration_uses_preloaded_id_and_emails_code_without_returning_it(self):
        response = self.register()

        self.assertEqual(response.status_code, 302)
        user = get_user_model().objects.get(username="2026-01-S01")
        self.assertFalse(user.is_active)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.user, user)
        self.assertEqual(self.profile.registered_email, "student@example.com")
        self.assertEqual(len(mail.outbox), 1)
        self.assertRegex(mail.outbox[0].body, r"\b\d{6}\b")
        self.assertNotRegex(response.content.decode(), r"\b\d{6}\b")

    def test_unlisted_student_id_cannot_register(self):
        response = self.register(student_id="2026-01-S29")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(get_user_model().objects.filter(username="2026-01-S29").exists())
        self.assertEqual(len(mail.outbox), 0)

    def test_registered_student_id_cannot_be_claimed_twice(self):
        existing = get_user_model().objects.create_user(
            username="2026-01-S01", email="student@example.com", password="A-strong-passphrase-984!"
        )
        self.profile.user = existing
        self.profile.save(update_fields=["user"])

        response = self.register()

        self.assertEqual(get_user_model().objects.filter(username="2026-01-S01").count(), 1)
        self.assertEqual(len(mail.outbox), 0)
        self.assertContains(response, "已註冊")

    def test_registered_email_is_bound_to_one_student_profile(self):
        self.register()
        second = StudentProfile.objects.create(
            student_id="2026-01-S02",
            cohort=self.cohort,
            legal_name="李小華",
            display_name="李某華",
        )

        response = self.register(student_id=second.student_id)

        self.assertEqual(response.status_code, 200)
        self.assertFalse(get_user_model().objects.filter(username=second.student_id).exists())
        self.assertContains(response, "電子郵件已用於其他學員")

    def test_activation_page_does_not_expose_full_email_and_code_can_be_resent(self):
        self.register()
        self.profile.refresh_from_db()
        user = self.profile.user
        activation_url = reverse("learning:activate", args=[self.profile.student_id])
        page = self.client.get(activation_url)
        self.assertNotContains(page, "student@example.com")
        EmailVerificationCode.objects.filter(user=user).update(
            created_at=timezone.now() - timedelta(seconds=61)
        )
        self.assertLess(
            EmailVerificationCode.objects.get(user=user).created_at,
            timezone.now() - timedelta(seconds=60),
        )
        self.assertTrue(
            StudentProfile.objects.filter(student_id=self.profile.student_id, active=True, user__is_active=False).exists()
        )

        response = self.client.post(reverse("learning:resend_activation", args=[self.profile.student_id]))

        self.assertRedirects(response, activation_url)
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(EmailVerificationCode.objects.filter(user=user, consumed_at__isnull=True).count(), 1)

    def test_activation_code_resend_is_rate_limited_with_generic_response(self):
        self.register()
        self.profile.refresh_from_db()
        user = self.profile.user
        EmailVerificationCode.objects.filter(user=user).update(
            created_at=timezone.now() - timedelta(seconds=61)
        )

        first = self.client.post(reverse("learning:resend_activation", args=[self.profile.student_id]))
        second = self.client.post(reverse("learning:resend_activation", args=[self.profile.student_id]))
        unknown = self.client.post(reverse("learning:resend_activation", args=["2026-01-S99"]))

        self.assertEqual(first.status_code, 302)
        self.assertEqual(second.status_code, 302)
        self.assertEqual(len(mail.outbox), 2)
        generic_message = str(list(get_messages(first.wsgi_request))[0])
        self.assertEqual(generic_message, str(list(get_messages(second.wsgi_request))[0]))
        self.assertEqual(generic_message, str(list(get_messages(unknown.wsgi_request))[0]))

    def test_student_password_reset_does_not_send_reset_to_teacher_account(self):
        teacher = get_user_model().objects.create_user(
            username="teacher", email="teacher@example.com", password="Another-strong-passphrase-911!", is_staff=True
        )

        response = self.client.post(reverse("learning:password_reset"), {"email": teacher.email})

        self.assertEqual(response.status_code, 302)
        self.assertEqual(len(mail.outbox), 0)

    def test_email_activation_enables_account_and_student_id_login_works(self):
        self.register()
        code = re.search(r"\b(\d{6})\b", mail.outbox[0].body).group(1)

        response = self.client.post(
            reverse("learning:activate", args=["2026-01-S01"]), {"code": code}
        )

        self.assertEqual(response.status_code, 302)
        user = get_user_model().objects.get(username="2026-01-S01")
        self.assertTrue(user.is_active)
        login = self.client.post(
            reverse("learning:student_login"),
            {"username": "2026-01-S01", "password": "A-strong-passphrase-984!"},
        )
        self.assertEqual(login.status_code, 302)

    def test_activation_code_stops_after_five_wrong_attempts(self):
        self.register()
        correct_code = re.search(r"\b(\d{6})\b", mail.outbox[0].body).group(1)
        wrong_code = "000000" if correct_code != "000000" else "000001"
        activation_url = reverse("learning:activate", args=[self.profile.student_id])

        for _ in range(5):
            self.client.post(activation_url, {"code": wrong_code})
        rejected = self.client.post(activation_url, {"code": correct_code})

        user = get_user_model().objects.get(username=self.profile.student_id)
        record = EmailVerificationCode.objects.get(user=user)
        self.assertFalse(user.is_active)
        self.assertEqual(record.attempts, 5)
        self.assertContains(rejected, "驗證碼無效")

    def test_password_reset_response_does_not_disclose_account_existence(self):
        user = get_user_model().objects.create_user(
            username="2026-01-S01", email="student@example.com", password="A-strong-passphrase-984!"
        )
        self.profile.user = user
        self.profile.save(update_fields=["user"])

        existing = self.client.post(
            reverse("learning:password_reset"), {"email": "student@example.com"}
        )
        unknown = self.client.post(
            reverse("learning:password_reset"), {"email": "unknown@example.com"}
        )

        self.assertEqual(existing.status_code, unknown.status_code)
        self.assertEqual(existing.content, unknown.content)
