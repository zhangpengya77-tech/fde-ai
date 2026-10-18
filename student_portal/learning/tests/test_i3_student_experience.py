"""I3-C 學生操作體驗驗收（框架層，2026-10-13 教師 I3 指令第四節）。

驗收重點：
  1. 五階段導航一致性（五個階段區塊與導覽錨點一一對應）。
  2. 功能入口不重複（同階段內不得出現名稱＋目標完全相同的入口）。
  3. 四態顯示僅用於外部模組卡片（未來專項的「規劃中」不屬四態）。
  4. topbar 重複「五階段學習工作台」入口已移除，僅保留學習平台／成長日誌／加入課程。
  5. 多課程學生的選課行為（單一課程直接進入；多課程回總覽自行選擇）。
  6. 教師與學員權限區隔（雙向拒絕）。

手機 390×844 排版另由 Chrome 裝置模擬腳本驗收（非真實 iPhone Safari）。
"""
import re

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from learning.models import Cohort
from learning.tests.helpers import create_student_account, enroll_student

FOUR_STATES = {"已可使用", "尚未接入", "服務暫時不可用", "權限不足"}
STAGE_KEYS = ("learn", "practice", "build", "assess", "certify")


def _entries(body):
    """取出 (入口名稱, 目標網址) 清單。"""
    result = []
    for block in re.findall(r'<li class="lp-entry">(.*?)</li>', body, re.S):
        name_m = re.search(r"<strong>(.*?)</strong>", block, re.S)
        href_m = re.search(r'href="([^"]+)"', block)
        result.append(
            (
                name_m.group(1).strip() if name_m else "",
                href_m.group(1).strip() if href_m else "",
            )
        )
    return result


def _module_badges(body):
    labels = []
    for block in re.findall(r'<article class="lp-module[^"]*">(.*?)</article>', body, re.S):
        m = re.search(r"lp-badge[^>]*>([^<]+)<", block)
        if m:
            labels.append(m.group(1).strip())
    return labels


class StudentNavigationTests(TestCase):
    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="I3-NAV", name="I3 導航測試班")
        self.student = create_student_account("i3-nav@example.test", "I3 導航學員")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.client.force_login(self.student.user)
        self.url = reverse("learning:student_learning_path", args=[self.enrollment.pk])

    def _body(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        return response.content.decode("utf-8")

    def test_five_stage_sections_and_nav_anchors_match(self):
        """五階段區塊與導覽錨點一一對應（導航一致性）。"""
        body = self._body()
        for key in STAGE_KEYS:
            self.assertIn('id="stage-%s"' % key, body, msg="缺少階段區塊 %s" % key)
            self.assertIn('href="#stage-%s"' % key, body, msg="缺少導覽錨點 %s" % key)

    def test_no_duplicate_entries_within_stage(self):
        """同一階段內不得出現名稱＋目標完全相同的重複入口。"""
        body = self._body()
        for key in STAGE_KEYS:
            seg = re.search(
                r'id="stage-%s"(.*?)(?=id="stage-|id="stage-feedback")' % key, body, re.S
            )
            if not seg:
                continue
            pairs = _entries(seg.group(1))
            self.assertEqual(
                len(pairs), len(set(pairs)), msg="階段 %s 出現重複入口：%s" % (key, pairs)
            )

    def test_entries_have_names_and_targets(self):
        """每個入口都要有名稱與目標網址（不得出現空入口）。"""
        body = self._body()
        pairs = _entries(body)
        self.assertGreaterEqual(len(pairs), 8)
        for name, href in pairs:
            self.assertTrue(name, msg="入口缺名稱")
            self.assertTrue(href.startswith("/"), msg="入口 %s 目標異常：%s" % (name, href))

    def test_planned_items_are_not_four_state_badges(self):
        """「規劃中」屬未來專項，不得混入外部模組四態徽章。"""
        body = self._body()
        badges = _module_badges(body)
        self.assertEqual(len(badges), 3)
        self.assertTrue(set(badges) <= FOUR_STATES, msg="模組徽章出現非四態標籤：%s" % badges)
        self.assertNotIn("規劃中", badges)

    def test_topbar_retains_platform_and_growth_entries(self):
        """重複主導航清理後，topbar 仍保留學習平台／成長日誌／加入課程（登入與其他功能不受影響）。"""
        body = self._body()
        for href in ('href="/platform/"', 'href="/student/growth/"', 'href="/courses/join/"'):
            self.assertIn(href, body)

    def test_topbar_no_longer_repeats_workbench_entry(self):
        """教師 2026-10-15 最終裁決：Django topbar 移除重複的「五階段學習工作台」連結
        （唯一主導航＝平台左側 #moduleNav；工作台頁面與路由保留，由首頁課程卡按鈕進入）。
        工作台可達性另由 test_student_learning_path.test_dashboard_offers_workbench_entry 保護。"""
        body = self._body()
        self.assertNotIn('href="/student/learning-path/"', body)

    def test_mobile_viewport_declared(self):
        body = self._body()
        self.assertIn("width=device-width", body)


class MultiCourseSelectionTests(TestCase):
    """多課程學生的選課行為（I3-C）。"""

    def setUp(self):
        self.cohort_a = Cohort.objects.create(cohort_id="I3-A", name="I3 課程 A")
        self.cohort_b = Cohort.objects.create(cohort_id="I3-B", name="I3 課程 B")
        self.student = create_student_account("i3-multi@example.test", "I3 多課程學員")
        self.client.force_login(self.student.user)

    def test_single_course_goes_directly_to_workbench(self):
        enrollment = enroll_student(self.student, self.cohort_a)
        response = self.client.get(reverse("learning:student_learning_path_entry"))
        self.assertEqual(response.status_code, 302)
        self.assertIn(
            reverse("learning:student_learning_path", args=[enrollment.pk]),
            response["Location"],
        )

    def test_multi_course_returns_to_dashboard_for_choice(self):
        """多課程時回總覽自行選擇，不擅自挑一門課。"""
        enroll_student(self.student, self.cohort_a)
        enroll_student(self.student, self.cohort_b)
        response = self.client.get(reverse("learning:student_learning_path_entry"))
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], reverse("learning:student_dashboard"))

    def test_dashboard_lists_both_courses(self):
        enroll_student(self.student, self.cohort_a)
        enroll_student(self.student, self.cohort_b)
        body = self.client.get(reverse("learning:student_dashboard")).content.decode("utf-8")
        self.assertIn("I3 課程 A", body)
        self.assertIn("I3 課程 B", body)

    def test_workbench_requires_own_enrollment(self):
        """僅能進入自己的課程工作台（不得跨課程）。"""
        mine = enroll_student(self.student, self.cohort_a)
        other = create_student_account("i3-other@example.test", "I3 他人")
        foreign = enroll_student(other, self.cohort_b)
        self.assertNotEqual(mine.pk, foreign.pk)
        response = self.client.get(
            reverse("learning:student_learning_path", args=[foreign.pk])
        )
        self.assertEqual(response.status_code, 404)


class RoleSeparationTests(TestCase):
    """教師與學員權限區隔（I3-C）。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="I3-ROLE", name="I3 角色測試班")
        self.student = create_student_account("i3-role@example.test", "I3 角色學員")
        self.enrollment = enroll_student(self.student, self.cohort)
        User = get_user_model()
        self.teacher = User.objects.create_user(
            username="i3-teacher@example.test",
            password="A-strong-passphrase-984!",
            is_staff=True,
        )

    def test_teacher_cannot_open_student_workbench(self):
        self.client.force_login(self.teacher)
        response = self.client.get(
            reverse("learning:student_learning_path", args=[self.enrollment.pk])
        )
        self.assertEqual(response.status_code, 403)

    def test_student_cannot_open_teacher_pages(self):
        self.client.force_login(self.student.user)
        for name in (
            "learning:teacher_class_outcomes",
            "learning:teacher_dashboard",
        ):
            response = self.client.get(reverse(name))
            self.assertEqual(response.status_code, 403, msg=name)

    def test_anonymous_is_redirected_to_login(self):
        response = self.client.get(reverse("learning:student_learning_path_entry"))
        self.assertEqual(response.status_code, 302)
        self.assertIn("/login/", response["Location"])
