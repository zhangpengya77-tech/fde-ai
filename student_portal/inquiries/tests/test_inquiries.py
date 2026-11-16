"""課程諮詢（2026-11-18）：官網表單 API、獨立資料庫、防濫用、教師後台統計與未讀通知。"""
import re
import time
from datetime import timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core import mail
from django.db import connections
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from inquiries.models import CourseInquiry
from inquiries.views import COURSES
from learning.tests.helpers import create_student_account

URL = "/api/public/course-inquiry/"
GOOD = {"name": "王小明", "contact": "0912345678", "course": "pilot", "format": "周末班", "message": "想問上課地點", "consent": "on", "started_ms": "0"}


def post(client, data=None, origin="https://fde-ai-v2.fde-ai-gateway.workers.dev", **extra):
    return client.post(URL, data or GOOD, HTTP_ORIGIN=origin, **extra)


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", COURSE_INQUIRY_NOTIFY_EMAILS="teacher@example.test")
class SubmitTests(TestCase):
    databases = {"default", "inquiries"}

    def test_saved_in_separate_database_and_teacher_notified(self):
        r = post(Client())
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["ok"])
        x = CourseInquiry.objects.get()
        self.assertEqual((x.course, x.course_title, x.class_format, x.is_read), ("pilot", COURSES["pilot"], "周末班", False))
        self.assertEqual(CourseInquiry.objects.db, "inquiries")
        self.assertTrue(x.email_sent)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("王小明", mail.outbox[0].body)
        # default（學員系統）資料庫裡沒有這張表
        self.assertNotIn("inquiries_courseinquiry", connections["default"].introspection.table_names())
        # 不存原始 IP
        self.assertNotIn("127.0.0.1", x.ip_hash)

    def test_github_pages_origin_accepted_and_unknown_origin_rejected(self):
        self.assertEqual(post(Client(), origin="https://zhangpengya77-tech.github.io").status_code, 200)
        self.assertEqual(post(Client(), origin="https://evil.example.com").status_code, 403)
        self.assertEqual(CourseInquiry.objects.count(), 1)

    def test_validation(self):
        for bad in [{"name": ""}, {"contact": "abc"}, {"course": "nope"}, {"consent": ""}]:
            r = post(Client(), {**GOOD, **bad})
            self.assertEqual(r.status_code, 400, bad)
            self.assertFalse(r.json()["ok"])
        self.assertEqual(post(Client(), {**GOOD, "contact": "a@b.co"}).status_code, 200)
        self.assertEqual(CourseInquiry.objects.count(), 1)

    def test_honeypot_and_too_fast_are_silently_dropped(self):
        self.assertTrue(post(Client(), {**GOOD, "website": "http://spam"}).json()["ok"])
        self.assertTrue(post(Client(), {**GOOD, "started_ms": str(int(time.time() * 1000))}).json()["ok"])
        self.assertEqual(CourseInquiry.objects.count(), 0)

    def test_rate_limit_per_source(self):
        c = Client()
        for _ in range(3):
            self.assertEqual(post(c).status_code, 200)
        self.assertEqual(post(c).status_code, 429)
        self.assertEqual(CourseInquiry.objects.count(), 3)

    def test_only_post(self):
        self.assertEqual(Client().get(URL).status_code, 405)

    @override_settings(COURSE_INQUIRY_NOTIFY_EMAILS="", EMAIL_HOST_USER="")
    def test_saved_even_without_email(self):
        self.assertEqual(post(Client()).status_code, 200)
        self.assertFalse(CourseInquiry.objects.get().email_sent)

    def test_expired_purged_after_180_days(self):
        old = CourseInquiry.objects.create(name="舊", contact="0911111111", course="rd", course_title=COURSES["rd"], consent_at=timezone.now(), ip_hash="x")
        CourseInquiry.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=181))
        post(Client())
        self.assertFalse(CourseInquiry.objects.filter(pk=old.pk).exists())

    def test_course_list_matches_platform_data(self):
        js = (Path(__file__).resolve().parents[3] / "src/data/vocational-programs.js").read_text(encoding="utf-8")
        pairs = re.findall(r"id: '(\w+)', slug: '[\w-]+', order: \d,\s*title: '([^']+)'", js)
        self.assertEqual(dict(pairs), COURSES)


class TeacherPageTests(TestCase):
    databases = {"default", "inquiries"}

    def setUp(self):
        now = timezone.now()
        for i, (c, f, read) in enumerate([("pilot", "周末班", False), ("pilot", "常日班", True), ("seed", "周末班", False)]):
            CourseInquiry.objects.create(name=f"訪客{i}", contact="0912345678", course=c, course_title=COURSES[c], class_format=f, consent_at=now, ip_hash=f"h{i}", is_read=read)
        self.teacher = get_user_model().objects.create_user(username="ci-teacher", password="x", is_staff=True)

    def test_teacher_sees_stats_and_unread(self):
        c = Client(); c.force_login(self.teacher)
        page = c.get(reverse("inquiries:teacher_inquiries"))
        self.assertEqual(page.status_code, 200)
        self.assertContains(page, '<b data-ci-unread>2</b>', html=False)
        self.assertContains(page, '<b data-ci-total>3</b>', html=False)
        self.assertContains(page, "訪客0")
        self.assertContains(page, COURSES["seed"])
        unread = c.get(reverse("inquiries:teacher_inquiries") + "?view=unread")
        self.assertNotContains(unread, "訪客1")

    def test_mark_read_and_read_all(self):
        c = Client(); c.force_login(self.teacher)
        first = CourseInquiry.objects.filter(is_read=False).first()
        c.post(reverse("inquiries:teacher_inquiries"), {"action": "read", "id": first.pk})
        first.refresh_from_db()
        self.assertTrue(first.is_read)
        self.assertEqual(first.read_by, "ci-teacher")
        c.post(reverse("inquiries:teacher_inquiries"), {"action": "read_all"})
        self.assertEqual(CourseInquiry.objects.filter(is_read=False).count(), 0)
        c.post(reverse("inquiries:teacher_inquiries"), {"action": "unread", "id": first.pk})
        self.assertEqual(CourseInquiry.objects.filter(is_read=False).count(), 1)

    def test_dashboard_shows_unread_notification(self):
        c = Client(); c.force_login(self.teacher)
        page = c.get(reverse("learning:teacher_dashboard"))
        self.assertContains(page, "🔔 2 筆新諮詢")
        self.assertContains(page, reverse("inquiries:teacher_inquiries"))

    def test_students_and_guests_cannot_open(self):
        student = create_student_account("s@example.test", "學員")
        c = Client(); c.force_login(student.user)
        self.assertEqual(c.get(reverse("inquiries:teacher_inquiries")).status_code, 403)
        self.assertEqual(Client().get(reverse("inquiries:teacher_inquiries")).status_code, 302)
