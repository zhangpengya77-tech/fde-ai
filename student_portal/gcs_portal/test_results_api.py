import json

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from learning.models import Cohort, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student

from .models import ParamBackup, ParamWriteRequest
from .results_api import parse_backup

OPEN = "2026-06"
OTHER = "2026-05"
BACKUPS = "/gcs/api/backups/"
BACKUP_TEXT = "# FDE-GCS 參數備份\nATC_RAT_RLL_P,0.135\nATC_RAT_PIT_P,0.135\nFRAME_CLASS,1\n"


def teacher(username, cohorts=()):
    user = get_user_model().objects.create_user(username=username, password="A-strong-passphrase-984!", is_staff=True)
    for cohort in cohorts:
        TeacherCohortAccess.objects.create(teacher=user, cohort=cohort)
    return user


class ParseBackupTests(TestCase):
    def test_parses_param_file_and_skips_comments(self):
        values, error = parse_backup(BACKUP_TEXT)
        self.assertEqual(error, "")
        self.assertEqual(values["FRAME_CLASS"], 1.0)

    def test_rejects_bad_lines_and_html(self):
        for text in ("", "<script>alert(1)</script>", "ATC_RAT_RLL_P,abc", "atc,1", "X,nan", "X," + "1" * 10 ** 6):
            self.assertIsNone(parse_backup(text)[0], text[:30])


@override_settings(FDE_GCS_ENABLED=True, FDE_GCS_COHORTS=frozenset({OPEN}))
class ResultsApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.open = Cohort.objects.create(cohort_id=OPEN, name="開放班")
        cls.other = Cohort.objects.create(cohort_id=OTHER, name="其他班")
        cls.student = create_student_account(email="s1@example.com")
        enroll_student(cls.student, cls.open)
        cls.teacher = teacher("t1@example.com", [cls.open])
        cls.other_teacher = teacher("t2@example.com", [cls.other])

    def post(self, url, data):
        return self.client.post(url, json.dumps(data), content_type="application/json")

    def upload(self, text=BACKUP_TEXT):
        self.client.force_login(self.student.user)
        response = self.post(BACKUPS, {"content": text, "vehicle_sysid": 1, "firmware": "4.5.0 official", "missing_count": 0})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["backup"]["id"]

    def test_upload_stores_canonical_content_without_comments(self):
        pk = self.upload()
        item = ParamBackup.objects.get(pk=pk)
        self.assertEqual(item.param_count, 3)
        self.assertEqual(item.cohort_id, OPEN)
        self.assertNotIn("#", item.content)
        self.assertEqual(len(item.sha256), 64)

    def test_diff_against_previous_backup(self):
        self.upload()
        pk = self.upload("ATC_RAT_RLL_P,0.15\nATC_RAT_PIT_P,0.135\nATC_RAT_YAW_P,0.18\n")
        diff = self.client.get(f"{BACKUPS}{pk}/diff/").json()
        self.assertEqual(diff["changed"], [{"name": "ATC_RAT_RLL_P", "before": 0.135, "after": 0.15}])
        self.assertEqual(diff["added"], ["ATC_RAT_YAW_P"])
        self.assertEqual(diff["removed"], ["FRAME_CLASS"])

    def test_teacher_reviews_backup_and_other_teacher_cannot(self):
        pk = self.upload()
        self.client.force_login(self.other_teacher)
        self.assertEqual(self.client.get(BACKUPS).json()["backups"], [])
        self.assertEqual(self.post(f"{BACKUPS}{pk}/review/", {"result": "PASS"}).status_code, 404)
        self.client.force_login(self.teacher)
        response = self.post(f"{BACKUPS}{pk}/review/", {"result": "NG", "note": "缺少說明"})
        self.assertEqual(response.json()["backup"]["review_status"], "NG")

    def test_student_cannot_review(self):
        pk = self.upload()
        self.assertEqual(self.post(f"{BACKUPS}{pk}/review/", {"result": "PASS"}).status_code, 403)

    def test_write_review_only_after_write_finished(self):
        item = ParamWriteRequest.objects.create(
            requester=self.student.user, student=self.student, cohort=self.open, param_name="ATC_RAT_RLL_P",
            allowlist_version="x", vehicle_sysid=1, old_value=0.135, new_value=0.15, safety_ack=True,
        )
        self.client.force_login(self.teacher)
        url = f"/gcs/api/param-requests/{item.pk}/review/"
        self.assertEqual(self.post(url, {"result": "PASS"}).status_code, 409)
        item.status = ParamWriteRequest.Status.APPLIED
        item.save()
        self.assertEqual(self.post(url, {"result": "PASS"}).json()["request"]["review_status"], "PASS")

    def test_task_card_reflects_server_records(self):
        self.client.force_login(self.student.user)
        tasks = {t["key"]: t["done"] for t in self.client.get("/gcs/api/summary/").json()["tasks"]}
        self.assertEqual(tasks, {"backup": False, "write": False, "review": False})
        pk = self.upload()
        self.client.force_login(self.teacher)
        self.post(f"{BACKUPS}{pk}/review/", {"result": "PASS"})
        self.client.force_login(self.student.user)
        tasks = {t["key"]: t["done"] for t in self.client.get("/gcs/api/summary/").json()["tasks"]}
        self.assertEqual(tasks, {"backup": True, "write": False, "review": True})

    def test_export_csv_for_own_cohort_only_and_formula_safe(self):
        self.upload()
        ParamBackup.objects.update(firmware="=HYPERLINK(1)")
        self.client.force_login(self.teacher)
        response = self.client.get(f"/gcs/api/export.csv?cohort={OPEN}")
        self.assertEqual(response.status_code, 200)
        body = response.content.decode("utf-8-sig")
        self.assertIn(self.student.public_user_id, body)
        self.assertNotIn("s1@example.com", body)
        self.assertNotIn(",=HYPERLINK", body)
        self.client.force_login(self.other_teacher)
        self.assertEqual(self.client.get(f"/gcs/api/export.csv?cohort={OPEN}").status_code, 404)
        self.client.force_login(self.student.user)
        self.assertEqual(self.client.get(f"/gcs/api/export.csv?cohort={OPEN}").status_code, 403)

    def test_allowlist_includes_teacher_explanations(self):
        self.client.force_login(self.student.user)
        data = self.client.get("/gcs/api/allowlist/").json()
        self.assertEqual(set(data["explanations"]["params"]), set(data["params"]))
