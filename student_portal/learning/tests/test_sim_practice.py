"""模擬器練飛紀錄（2026-11-07）：成績 API、學員紀錄頁、教師班級隔離"""
import json

from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.urls import reverse

from learning.models import Cohort, SimPracticeRecord, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student

GOOD = {
    "mode": "inspection",
    "title": "輸電塔右側絕緣子串巡檢",
    "score": 86,
    "grade": "B",
    "duration_seconds": 142,
    "input_source": "手機遙控器",
    "summary": {"pathLengthM": 52.3},
}


class SimPracticeApiTests(TestCase):
    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="2099-01", name="模擬練飛班")
        self.student = create_student_account("sim@example.test", "練飛學員")
        enroll_student(self.student, self.cohort)
        self.api = reverse("learning:sim_practice_api")

    def _client(self, user=None):
        client = Client(enforce_csrf_checks=True)
        if user is not None:
            client.force_login(user)
        return client

    def _post(self, client, payload):
        # 照模擬器的做法：先 GET 拿 CSRF token，再帶在標頭送出
        token = client.get(self.api).json()["csrf_token"]
        return client.post(self.api, data=json.dumps(payload), content_type="application/json", HTTP_X_CSRFTOKEN=token)

    def test_get_reports_login_state_without_redirect(self):
        anon = self._client().get(self.api)
        self.assertEqual(anon.status_code, 200)
        self.assertFalse(anon.json()["logged_in"])
        me = self._client(self.student.user).get(self.api).json()
        self.assertTrue(me["logged_in"])
        self.assertEqual(me["nickname"], "練飛學員")

    def test_anonymous_post_is_401_and_saves_nothing(self):
        res = self._post(self._client(), GOOD)
        self.assertEqual(res.status_code, 401)
        self.assertEqual(SimPracticeRecord.objects.count(), 0)

    def test_student_post_saves_record_with_own_cohort(self):
        res = self._post(self._client(self.student.user), GOOD)
        self.assertEqual(res.status_code, 201)
        rec = SimPracticeRecord.objects.get()
        self.assertEqual(rec.student, self.student)
        self.assertEqual(rec.cohort, self.cohort)
        self.assertEqual(rec.score, 86)
        self.assertEqual(rec.input_source, "手機遙控器")

    def test_cannot_choose_other_student_or_cohort(self):
        other = Cohort.objects.create(cohort_id="2099-02", name="別班")
        payload = dict(GOOD, student="someone-else", cohort=other.pk)
        self._post(self._client(self.student.user), payload)
        rec = SimPracticeRecord.objects.get()
        self.assertEqual(rec.student, self.student)
        self.assertEqual(rec.cohort, self.cohort)

    def test_post_without_csrf_is_rejected(self):
        client = self._client(self.student.user)
        res = client.post(self.api, data=json.dumps(GOOD), content_type="application/json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(SimPracticeRecord.objects.count(), 0)

    def test_invalid_values_are_rejected(self):
        client = self._client(self.student.user)
        for bad in (dict(GOOD, mode="hack"), dict(GOOD, score=150), dict(GOOD, title=""), dict(GOOD, passed="yes"),
                    dict(GOOD, summary={"x": "a" * 3000}), dict(GOOD, duration_seconds=-5)):
            self.assertEqual(self._post(client, bad).status_code, 422, bad)
        self.assertEqual(SimPracticeRecord.objects.count(), 0)

    def test_exam_record_without_score(self):
        res = self._post(self._client(self.student.user), {"mode": "exam", "title": "C 8字水平圓", "passed": True, "duration_seconds": 95})
        self.assertEqual(res.status_code, 201)
        self.assertTrue(SimPracticeRecord.objects.get().passed)

    def test_unknown_input_source_is_blanked(self):
        self._post(self._client(self.student.user), dict(GOOD, input_source="<script>"))
        self.assertEqual(SimPracticeRecord.objects.get().input_source, "")


class SimPracticePagesTests(TestCase):
    def setUp(self):
        self.mine = Cohort.objects.create(cohort_id="2099-01", name="本班")
        self.other = Cohort.objects.create(cohort_id="2099-02", name="別班")
        self.a = create_student_account("a@example.test", "本班學員")
        self.b = create_student_account("b@example.test", "別班學員")
        enroll_student(self.a, self.mine)
        enroll_student(self.b, self.other)
        SimPracticeRecord.objects.create(student=self.a, cohort=self.mine, mode="inspection", title="巡檢", score=90)
        SimPracticeRecord.objects.create(student=self.b, cohort=self.other, mode="inspection", title="巡檢", score=40)
        self.teacher = get_user_model().objects.create_user(username="sim-teacher", password="x", is_staff=True)
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.mine)

    def test_student_sees_only_own_records(self):
        client = Client()
        client.force_login(self.a.user)
        page = client.get(reverse("learning:student_sim_practice"))
        self.assertContains(page, "最佳分數 90 分")
        self.assertNotContains(page, "40 分")

    def test_teacher_sees_only_own_cohort(self):
        client = Client()
        client.force_login(self.teacher)
        page = client.get(reverse("learning:teacher_sim_practice"))
        self.assertContains(page, "本班學員")
        self.assertNotContains(page, "別班學員")

    def test_student_cannot_open_teacher_page(self):
        client = Client()
        client.force_login(self.a.user)
        self.assertEqual(client.get(reverse("learning:teacher_sim_practice")).status_code, 403)

    def test_dashboards_link_to_pages(self):
        client = Client()
        client.force_login(self.a.user)
        self.assertContains(client.get(reverse("learning:student_dashboard")), reverse("learning:student_sim_practice"))
        client.force_login(self.teacher)
        self.assertContains(client.get(reverse("learning:teacher_dashboard")), reverse("learning:teacher_sim_practice"))
