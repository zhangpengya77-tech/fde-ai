from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from urllib.parse import parse_qs, urlsplit

from learning.tests.helpers import create_student_account


class PublicPlatformRouteTests(TestCase):
    def test_anonymous_home_serves_existing_fde_ai_platform(self):
        response = self.client.get(reverse("learning:home"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="moduleNav"')
        self.assertContains(response, 'id="teacher"')
        self.assertContains(response, "開始學習 / 註冊")
        self.assertContains(response, "學員登入")
        self.assertContains(response, "教師登入")
        self.assertContains(response, 'aria-label="平台学习分类"')
        for label in ("學", "練", "作", "測", "證", "歷屆學員成果", "教師復核參照"):
            self.assertContains(response, label)
        page = response.content.decode("utf-8")
        navigation_order = [
            'href="./">首頁',
            'href="./tasks">12 任務',
            'href="./courses">學',
            'href="./simulator">練',
            'href="./f450">作',
            'href="./eagle">測',
            'href="./github">證',
            'href="./results">歷屆學員成果',
            'href="./teacher">教師復核參照',
        ]
        positions = [page.index(item) for item in navigation_order]
        self.assertEqual(positions, sorted(positions))

    def test_anonymous_platform_and_static_assets_are_public(self):
        page = self.client.get(reverse("learning:platform"))
        asset = self.client.get(reverse("learning:platform_asset", args=["src/styles.css"]))

        self.assertEqual(page.status_code, 200)
        self.assertContains(page, 'id="moduleNav"')
        page_source = page.content.decode("utf-8")
        rag_config_index = page_source.index("src/rag-config.js")
        public_rag_config_index = page_source.index("public-rag-config.js")
        rag_client_index = page_source.index("src/rag-client.js")
        self.assertLess(rag_config_index, public_rag_config_index)
        self.assertLess(public_rag_config_index, rag_client_index)
        self.assertEqual(asset.status_code, 200)
        self.assertIn(b"--", b"".join(asset.streaming_content))

    def test_anonymous_navigation_marks_teacher_review_as_demo(self):
        response = self.client.get(reverse("learning:platform"))

        self.assertContains(response, "公開演示")
        self.assertContains(response, "靜態樣例資料")
        self.assertNotContains(response, "student@example.com")

    def test_student_navigation_shows_identity_and_growth_links_without_email(self):
        student = create_student_account("private-address@example.com", "Learner")
        self.client.force_login(student.user)

        response = self.client.get(reverse("learning:home"))

        self.assertContains(response, student.public_user_id)
        self.assertContains(response, "Learner")
        self.assertContains(response, "我的學習成長日誌")
        self.assertContains(response, "我的課程")
        self.assertContains(response, "登出")
        self.assertNotContains(response, "private-address@example.com")

    def test_teacher_navigation_links_to_real_dashboard_without_exposing_email(self):
        teacher = get_user_model().objects.create_user(
            username="course-reviewer", email="teacher-private@example.com", password="Teacher-pass-239!", is_staff=True
        )
        self.client.force_login(teacher)

        response = self.client.get(reverse("learning:platform"))

        self.assertContains(response, "教師後台")
        self.assertContains(response, "course-reviewer")
        self.assertContains(response, "登出")
        self.assertNotContains(response, "teacher-private@example.com")

    def test_authenticated_student_stays_on_public_home(self):
        student = create_student_account("public-student@example.com", "Public Student")
        self.client.force_login(student.user)

        response = self.client.get(reverse("learning:home"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="moduleNav"')

    def test_authenticated_teacher_stays_on_public_home(self):
        teacher = get_user_model().objects.create_user(
            username="public-teacher", password="Safe-test-pass-742!", is_staff=True
        )
        self.client.force_login(teacher)

        response = self.client.get(reverse("learning:home"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="moduleNav"')

    def test_protected_student_and_teacher_routes_deny_the_wrong_role(self):
        student = create_student_account("student-role@example.com", "Student")
        self.client.force_login(student.user)

        teacher_dashboard = self.client.get(reverse("learning:teacher_dashboard"))

        self.assertEqual(teacher_dashboard.status_code, 403)
        self.assertTrue(self.client.session.get("_auth_user_id"))

        teacher = get_user_model().objects.create_user(
            username="wrong-role-teacher", password="Teacher-pass-240!", is_staff=True
        )
        self.client.force_login(teacher)
        student_dashboard = self.client.get(reverse("learning:student_dashboard"))

        self.assertEqual(student_dashboard.status_code, 403)
        self.assertTrue(self.client.session.get("_auth_user_id"))

    def test_anonymous_protected_growth_url_redirects_to_login_with_local_next(self):
        destination = reverse("learning:growth_record_detail", args=[7, "R01"])

        response = self.client.get(destination)

        self.assertEqual(response.status_code, 302)
        self.assertEqual(urlsplit(response["Location"]).path, reverse("learning:student_login"))
        self.assertEqual(parse_qs(urlsplit(response["Location"]).query)["next"], [destination])

    def test_anonymous_teacher_url_redirects_to_teacher_login_with_local_next(self):
        destination = reverse("learning:teacher_dashboard")

        response = self.client.get(destination)

        self.assertEqual(response.status_code, 302)
        self.assertEqual(urlsplit(response["Location"]).path, reverse("learning:teacher_login"))
        self.assertEqual(parse_qs(urlsplit(response["Location"]).query)["next"], [destination])
