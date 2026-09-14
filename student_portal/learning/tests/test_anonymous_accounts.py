import re

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse

from learning.models import StudentProfile


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class AnonymousAccountFlowTests(TestCase):
    def test_registration_verification_login_opens_student_page_and_platform_remains_available(self):
        response = self.client.post(
            reverse("learning:register"),
            {
                "nickname": "Eagle",
                "email": "Student@Example.com",
                "password1": "A-strong-passphrase-984!",
                "password2": "A-strong-passphrase-984!",
            },
        )

        self.assertEqual(response.status_code, 302)
        profile = StudentProfile.objects.get(email="student@example.com")
        self.assertRegex(profile.public_user_id, r"^FDE-\d{2}-[A-Z0-9]{6}$")
        self.assertEqual(profile.nickname, "Eagle")
        self.assertFalse(profile.user.is_active)

        activation_code = re.search(r"\b(\d{6})\b", mail.outbox[0].body).group(1)
        activation = self.client.post(
            reverse("learning:activate", args=[profile.public_user_id]),
            {"code": activation_code},
        )
        self.assertEqual(activation.status_code, 302)

        login = self.client.post(
            reverse("learning:student_login"),
            {"username": "STUDENT@example.com", "password": "A-strong-passphrase-984!"},
        )
        self.assertEqual(login.status_code, 302)
        self.assertEqual(login["Location"], reverse("learning:student_dashboard"))

        student_page = self.client.get(reverse("learning:student_dashboard"))
        self.assertEqual(student_page.status_code, 200)
        self.assertContains(student_page, profile.public_user_id)

        platform = self.client.get(reverse("learning:platform"))
        self.assertEqual(platform.status_code, 200)
        self.assertContains(platform, "FDE-AI")
        stylesheet = self.client.get(reverse("learning:platform_asset", args=["src/styles.css"]))
        self.assertEqual(stylesheet.status_code, 200)
        stylesheet_body = b"".join(stylesheet.streaming_content).decode()
        self.assertIn(".sidebar", stylesheet_body)
        self.assertEqual(get_user_model().objects.filter(email__iexact="student@example.com").count(), 1)
