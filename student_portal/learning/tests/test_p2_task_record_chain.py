"""P2 五階段任務與成長證據鏈整合測試（2026-10-13 教師指令）。

驗證重點（教師指令第五、六、七節）：
  1. 對應表以 growth_records_v1.json／tasks_v1.json 實際內容為準：
     T01–T05 與 R01–R05 的證據清單逐項相同；T09↔R06、T11↔R07 語義對應；
     每個 R 槽恰好歸屬一個階段。
  2. 任務卡顯示：名稱、要求、所屬五階段、對應 R01–R08 編號、真實提交狀態、
     教師複核狀態、查看／提交成果入口；無一對一對應的任務只顯示相關紀錄提示。
  3. 狀態規則：已提交 ≠ 已透過；沒有教師審核不得顯示「合格」或虛構回饋。
  4. 未實作功能只顯示「待開發／待接入」；不新建第二套 Evidence／Submission／
     成長日誌／教師審核資料庫（一律走既有路由與資料表）。
  5. P1 既有行為（五階段標題、0/8 計數、尚無回饋提示）不回退。
"""
import json
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from learning.growth_records import ensure_growth_submissions
from learning.growth_task_map import (
    RECORD_SLOT_STAGE,
    STAGE_RECORD_SLOTS,
    TASK_RECORD_MAP,
    TASK_RELATED_RECORDS,
    record_slot_stage,
    stage_record_slots,
    task_map_note,
    task_record_slot,
    task_related_records,
    validate_against_data,
)
from learning.models import Cohort, GrowthRecordReview, TaskDefinition
from learning.tests.helpers import create_student_account, enroll_student


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
ALL_SLOTS = tuple(f"R{index:02d}" for index in range(1, 9))
STUDENT_LABELS = {"○ 未開始", "🟡 進行中", "待教師複核", "需補充", "✅ 已完成", "未通過"}


def load_tasks():
    with (DATA_DIR / "tasks_v1.json").open(encoding="utf-8") as tasks_file:
        return {item["task_id"]: item for item in json.load(tasks_file)}


def load_records():
    with (DATA_DIR / "growth_records_v1.json").open(encoding="utf-8") as growth_file:
        return {item["slot_id"]: item for item in json.load(growth_file)}


class TaskRecordMapTests(TestCase):
    """對應表本身：純資料邏輯，不碰資料庫。"""

    def test_every_slot_belongs_to_exactly_one_stage(self):
        self.assertEqual(set(RECORD_SLOT_STAGE), set(ALL_SLOTS))
        counted = [slot for slots in STAGE_RECORD_SLOTS.values() for slot in slots]
        self.assertEqual(sorted(counted), sorted(ALL_SLOTS))

    def test_stage_assignment_matches_five_stage_design(self):
        self.assertEqual(
            {stage: list(slots) for stage, slots in STAGE_RECORD_SLOTS.items()},
            {
                "learn": ["R01"],
                "practice": ["R02", "R03", "R04"],
                "build": ["R05"],
                "assess": ["R06"],
                "certify": ["R07", "R08"],
            },
        )
        self.assertEqual(record_slot_stage("R03"), "practice")
        self.assertEqual(stage_record_slots("practice"), ("R02", "R03", "R04"))

    def test_r03_stage_follows_task_data_not_p1_guess(self):
        """R03 隸屬 practice 的依據是 tasks_v1.json 中 T03 的 stage，非任意指定。"""
        tasks = load_tasks()
        self.assertEqual(tasks["T03"]["stage"], "practice")
        self.assertEqual(RECORD_SLOT_STAGE["R03"], tasks["T03"]["stage"])

    def test_t01_to_t05_share_identical_evidence_lists(self):
        """T01–T05 與 R01–R05 的證據清單逐項相同（資料實證的一對一對應）。"""
        tasks = load_tasks()
        records = load_records()
        for task_id in ("T01", "T02", "T03", "T04", "T05"):
            slot = TASK_RECORD_MAP[task_id]
            self.assertEqual(tasks[task_id]["evidence_required"], records[slot]["evidence_requirement"])

    def test_semantic_pairs_t09_t11_are_declared(self):
        self.assertEqual(TASK_RECORD_MAP["T09"], "R06")
        self.assertEqual(TASK_RECORD_MAP["T11"], "R07")

    def test_unmapped_tasks_have_notes_and_no_slot(self):
        for task_id in ("T06", "T07", "T08", "T10", "T12"):
            self.assertIsNone(task_record_slot(task_id), task_id)
            self.assertTrue(task_map_note(task_id), task_id)

    def test_mapped_tasks_have_no_map_note(self):
        for task_id in TASK_RECORD_MAP:
            self.assertIsNone(task_map_note(task_id), task_id)

    def test_related_records_reference_existing_slots_only(self):
        for task_id, slots in TASK_RELATED_RECORDS.items():
            self.assertNotIn(task_id, TASK_RECORD_MAP)
            for slot in slots:
                self.assertIn(slot, RECORD_SLOT_STAGE)
            self.assertEqual(task_related_records(task_id.lower()), slots)

    def test_helpers_are_case_insensitive_and_safe(self):
        self.assertEqual(task_record_slot("t09"), "R06")
        self.assertEqual(record_slot_stage("r07"), "certify")
        self.assertIsNone(record_slot_stage("R99"))
        self.assertEqual(stage_record_slots("unknown-stage"), ())
        self.assertIsNone(task_record_slot("T99"))
        self.assertEqual(task_map_note("T99"), None)

    def test_validate_against_data_cross_checks_both_json_files(self):
        self.assertIs(validate_against_data(), True)


class WorkbenchTaskRecordChainTests(TestCase):
    """HTTP 層：工作台任務卡 ↔ 成長紀錄證據鏈。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="P2-2026", name="P2 整合測試班")
        self.student = create_student_account("p2-student@example.test", "P2 學員")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.url = reverse("learning:student_learning_path", args=[self.enrollment.pk])
        for item in load_tasks().values():
            TaskDefinition.objects.create(
                task_id=item["task_id"],
                sort_order=item["sort_order"],
                stage=item["stage"],
                title=item["title"],
                description=item["description"],
                requirements=item["requirements"],
                evidence_required=item["evidence_required"],
            )
        self.tasks = load_tasks()

    def _stage_row(self, response, stage_key):
        return next(row for row in response.context["stage_rows"] if row["key"] == stage_key)

    def test_task_cards_show_requirements_evidence_and_stage(self):
        self.client.force_login(self.student.user)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "任務要求")
        self.assertContains(response, "需附證據")
        self.assertContains(response, "M01")  # 任務卡編號（T01→M01）
        self.assertContains(response, self.tasks["T01"]["title"])
        self.assertContains(response, "認識基本安全與法規")  # T01 requirements
        row = self._stage_row(response, "learn")
        task_row = next(item for item in row["task_rows"] if item["task_id"] == "T01")
        self.assertEqual(task_row["stage_key"], "learn")
        self.assertEqual(task_row["requirements"], self.tasks["T01"]["requirements"])

    def test_t03_card_links_to_r03_record_with_real_status(self):
        self.client.force_login(self.student.user)
        response = self.client.get(self.url)
        row = self._stage_row(response, "practice")
        t03 = next(item for item in row["task_rows"] if item["task_id"] == "T03")
        self.assertEqual(t03["record_slot"], "R03")
        self.assertEqual(t03["record_title"], "真機飛行訓練")
        self.assertEqual(t03["record_status_label"], "○ 未開始")
        self.assertEqual(
            t03["record_url"],
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R03"]),
        )
        self.assertEqual(t03["url"], reverse("learning:task_detail", args=[self.enrollment.pk, "T03"]))
        body = response.content.decode("utf-8")
        self.assertIn(t03["record_url"], body)

    def test_growth_cards_show_requirements_evidence_and_resource(self):
        self.client.force_login(self.student.user)
        response = self.client.get(self.url)
        rows = {row["key"]: row for row in response.context["stage_rows"]}
        self.assertEqual(
            [item["slot_id"] for item in rows["practice"]["growth_rows"]], ["R02", "R03", "R04"]
        )
        self.assertEqual([item["slot_id"] for item in rows["assess"]["growth_rows"]], ["R06"])
        r01 = next(item for item in rows["learn"]["growth_rows"] if item["slot_id"] == "R01")
        records = load_records()
        self.assertEqual(r01["requirements"], records["R01"]["completion_requirements"])
        self.assertEqual(r01["evidence"], records["R01"]["evidence_requirement"])
        self.assertContains(response, "完成要求")

    def test_stage_slots_in_view_match_map_module(self):
        self.client.force_login(self.student.user)
        response = self.client.get(self.url)
        for row in response.context["stage_rows"]:
            with self.subTest(stage=row["key"]):
                self.assertEqual(
                    [item["slot_id"] for item in row["growth_rows"]],
                    list(STAGE_RECORD_SLOTS[row["key"]]),
                )

    def test_submitted_record_is_not_shown_as_approved(self):
        self.client.force_login(self.student.user)
        self.client.get(self.url)  # 讓 view 建立 submissions
        submission = self.enrollment.growth_submissions.get(definition__slot_id="R05")
        submission.status = "submitted"
        submission.save(update_fields=["status"])
        response = self.client.get(self.url)
        self.assertContains(response, "待教師複核")
        self.assertNotContains(response, "✅ 已完成")
        self.assertNotContains(response, "教師複核：合格")

    def test_teacher_review_shown_only_with_real_review(self):
        self.client.force_login(self.student.user)
        self.client.get(self.url)
        submission = self.enrollment.growth_submissions.get(definition__slot_id="R05")
        review = GrowthRecordReview.objects.create(
            submission=submission,
            reviewer=get_user_model().objects.create_user("p2-teacher@example.test"),
            review_status=GrowthRecordReview.Status.APPROVED,
            teacher_note="組裝檢查完整，槳葉方向正確。",
            score=92,
        )
        response = self.client.get(self.url)
        self.assertContains(response, "教師複核：合格")
        self.assertContains(response, "組裝檢查完整，槳葉方向正確。")
        self.assertContains(response, "92.00 分")
        submission.refresh_from_db()
        self.assertEqual(submission.reviews.first().pk, review.pk)

    def test_unmapped_tasks_show_related_records_not_fake_slot(self):
        self.client.force_login(self.student.user)
        response = self.client.get(self.url)
        row = self._stage_row(response, "build")
        t07 = next(item for item in row["task_rows"] if item["task_id"] == "T07")
        self.assertIsNone(t07["record_slot"])
        self.assertIsNone(t07["record_url"])
        self.assertEqual([item["slot_id"] for item in t07["related_records"]], ["R07"])
        self.assertTrue(t07["map_note"])
        body = response.content.decode("utf-8")
        self.assertIn("相關成長紀錄", body)
        self.assertIn(t07["map_note"], body)
        # 不變量：沒有對應槽位的任務卡不得帶有任何「對應成長紀錄」連結。
        for stage in response.context["stage_rows"]:
            for item in stage["task_rows"]:
                if item["record_slot"] is None:
                    self.assertIsNone(item["record_url"])
                    self.assertIsNone(item["record_status_label"])

    def test_p1_behavior_preserved(self):
        self.client.force_login(self.student.user)
        response = self.client.get(self.url)
        for title in ("學習知識", "模擬與練習", "專項實訓", "能力考核", "成長日誌"):
            self.assertContains(response, title)
        self.assertContains(response, "0 / 8")
        self.assertContains(response, "目前尚無教師回饋")

    def test_status_labels_come_from_existing_vocabulary(self):
        self.client.force_login(self.student.user)
        response = self.client.get(self.url)
        for row in response.context["stage_rows"]:
            for item in row["growth_rows"] + row["task_rows"]:
                with self.subTest(slot=item.get("slot_id"), task=item.get("task_id")):
                    self.assertIn(item["status_label"], STUDENT_LABELS)
