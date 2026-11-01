from urllib.parse import parse_qs, urlsplit

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse

from learning.models import Cohort, StudentProfile


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class ProtectedPlatformTests(TestCase):
    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="2026-01", name="2026 第一梯")
        self.student_user = get_user_model().objects.create_user(
            username="2026-01-S01", email="s01@example.com", password="A-strong-passphrase-984!", is_active=True
        )
        StudentProfile.objects.create(
            student_id="2026-01-S01",
            cohort=self.cohort,
            legal_name="張小雅",
            display_name="張某雅",
            user=self.student_user,
        )

    def test_public_home_is_fde_ai_platform_landing_with_auth_entries(self):
        response = self.client.get(reverse("learning:home"))

        self.assertContains(response, "FDE-AI 無人載具學習平台")
        self.assertContains(response, "會學、會做、會應用")
        self.assertContains(response, "學員登入")
        self.assertContains(response, "學員註冊")
        self.assertContains(response, "教師登入")

    def test_guest_is_sent_to_public_entry_before_platform_content(self):
        response = self.client.get("/platform/fde")

        self.assertEqual(response.status_code, 302)
        redirect = urlsplit(response["Location"])
        self.assertEqual(redirect.path, reverse("learning:home"))
        self.assertEqual(parse_qs(redirect.query).get("next"), ["/platform/fde"])

    def test_guest_cannot_fetch_platform_source_assets(self):
        response = self.client.get(reverse("learning:platform_asset", args=["src/styles.css"]))

        self.assertEqual(response.status_code, 302)
        self.assertEqual(urlsplit(response["Location"]).path, reverse("learning:home"))

    def test_guest_return_path_is_preserved_only_for_local_login_links(self):
        landing = self.client.get(reverse("learning:home"), {"next": "/platform/fde"})
        login = self.client.get(reverse("learning:student_login"), {"next": "/platform/fde"})

        self.assertContains(landing, "/login/?next=%2Fplatform%2Ffde")
        self.assertContains(login, 'name="next" value="/platform/fde"')
        rejected_external_target = self.client.get(
            reverse("learning:home"), {"next": "https://attacker.example/"}
        )
        self.assertNotContains(rejected_external_target, "attacker.example")

    def test_authenticated_student_can_open_existing_v12_routes_and_assets(self):
        self.client.force_login(self.student_user)

        page = self.client.get("/platform/fde")
        stylesheet = self.client.get(reverse("learning:platform_asset", args=["src/styles.css"]))

        self.assertEqual(page.status_code, 200)
        self.assertContains(page, "FDE-AI | 無人載具學習控制中心")
        self.assertEqual(stylesheet.status_code, 200)
        self.assertEqual(stylesheet["Content-Type"], "text/css")
        self.assertContains(stylesheet, "--")

    def test_student_login_redirects_into_the_protected_platform(self):
        response = self.client.post(
            reverse("learning:student_login"),
            {"username": "2026-01-S01", "password": "A-strong-passphrase-984!"},
        )

        self.assertRedirects(response, reverse("learning:platform"), fetch_redirect_response=False)

    def test_platform_asset_route_cannot_escape_its_source_directory(self):
        self.client.force_login(self.student_user)

        response = self.client.get(
            reverse("learning:platform_asset", args=["src/../student_portal/manage.py"])
        )

        self.assertEqual(response.status_code, 404)
