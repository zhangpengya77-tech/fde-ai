"""P9-A：報告唯讀化的「修正前後統計等價」對照測試（2026-10-13 教師 P9 指令第一節）。

背景
----
P8-A 稽核確認 `build_cohort_report()` 為「讀取 ＋ 冪等惰性初始化」：
資料齊備時零寫入；資料缺失時會補建 `GrowthRecordSubmission`（經
`ensure_growth_submissions`）與 `PhaseProgress`（`get_or_create`）。

P9 目標：讓 P5 報告、P6 結訓清單、P6 兩種 CSV、P7 成果展示的**讀取**不產生寫入，
且必須先證明**統計結果等價**才能實施修正（否則停止修改並提交方案）。

做法
----
1. **擷取基準**（在尚未修改任何產品程式碼前執行）：
     `FDE_P9_CAPTURE=1 python manage.py test learning.tests.test_p9_readonly_report`
   會把每個情境下 `build_cohort_report()` 的完整統計輸出正規化後寫入
   `tests/baselines/p9/<scenario>.json`。
2. **比對**（修正後執行同一套件）：
   重跑時讀取基準檔逐項比對，任何統計語意差異都會使測試失敗。

情境涵蓋 P9-B 要求的資料狀態：0 項提交、部分提交、8 項已提交、待教師複核、
需要補充、已複核、缺少 GrowthRecordSubmission、缺少 PhaseProgress、空班級、
多班級教師權限，另加「完全未 seed 定義」與「小組專屬定義覆寫」兩個強化情境。
"""
import json
import os
from datetime import timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.db import transaction
from django.test import TestCase
from django.utils import timezone

from learning.growth_records import ensure_growth_submissions
from learning.models import (
    Cohort,
    Enrollment,
    GrowthRecordDefinition,
    GrowthRecordReview,
    GrowthRecordSubmission,
    LearningGroup,
    PhaseProgress,
    TaskDefinition,
    TeacherCohortAccess,
)
from learning.tests.helpers import create_student_account, enroll_student
from learning.views import build_cohort_report

BASELINE_DIR = Path(__file__).resolve().parent / "baselines" / "p9"
CAPTURE = os.environ.get("FDE_P9_CAPTURE") == "1"

SUBMITTED = GrowthRecordSubmission.Status.SUBMITTED
APPROVED = GrowthRecordSubmission.Status.APPROVED
NEEDS_REVISION = GrowthRecordSubmission.Status.NEEDS_REVISION


def snapshot(report):
    """把 report 正規化為可逐項比較的純資料（去除 ORM 物件與時間戳）。"""
    return {
        "student_count": report["student_count"],
        "slot_titles": report["slot_titles"],
        "slot_stats": [
            {
                "slot_id": row["slot_id"],
                "title": row["title"],
                "submitted": row["submitted"],
                "reviewed": row["reviewed"],
                "total": row["total"],
            }
            for row in report["slot_stats"]
        ],
        "stage_rows": [
            {"key": row["key"], "done": row["done"], "total": row["total"]}
            for row in report["stage_rows"]
        ],
        "totals": {
            "total_submitted": report["total_submitted"],
            "total_reviewed": report["total_reviewed"],
            "not_submitted_count": report["not_submitted_count"],
            "all_submitted_count": report["all_submitted_count"],
            "pending_items_total": report["pending_items_total"],
            "needs_revision_total": report["needs_revision_total"],
            "pending_student_count": report["pending_student_count"],
            "unsubmitted_items_total": report["unsubmitted_items_total"],
            "outstanding_total": report["outstanding_total"],
            "reviewed_result_total": report["reviewed_result_total"],
            "feedback_rows": len(report["feedback_rows"]),
            "review_result_rows": len(report["review_result_rows"]),
            "pending_work_items": len(report["pending_work_items"]),
            "unsubmitted_items": len(report["unsubmitted_items"]),
        },
        # 以 enrollment.pk 排序與識別：public_user_id 每次測試隨機產生，
        # 且 build_cohort_report 內部依 public_user_id 排序，會使學生順序
        # 每次不同而產生假性差異（非統計語意差異）。
        "students": [
            {
                "enrollment_pk": row["enrollment"].pk,
                "submitted_count": row["submitted_count"],
                "reviewed_count": row["reviewed_count"],
                "pending_count": row["pending_count"],
                "needs_revision_count": row["needs_revision_count"],
                "outstanding_count": row["outstanding_count"],
                "unsubmitted_count": row["unsubmitted_count"],
                "reviewed_result_count": row["reviewed_result_count"],
                "completed_stages": row["completed_stages"],
                "stage_total": row["stage_total"],
                "evidence_count": row["evidence_count"],
                "slot_cells": [
                    {"slot_id": cell["slot_id"], "status_key": cell["status_key"]}
                    for cell in row["slot_cells"]
                ],
                # student_rows 內「未提交項」為 outstanding_items 中不帶 group 鍵者
                # （帶 group 者為待複核／需要補充的工作項目）。
                "unsubmitted_codes": sorted(
                    item["code"] for item in row["outstanding_items"] if "group" not in item
                ),
                "outstanding_codes": sorted(item["code"] for item in row["outstanding_items"]),
                "reviewed_codes": sorted(item["code"] for item in row["reviewed_items"]),
            }
            for row in sorted(report["student_rows"], key=lambda row: row["enrollment"].pk)
        ],
    }


class P9ScenarioBase(TestCase):
    """建立隔離測試資料；每個測試方法都從乾淨的測試資料庫開始。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="P9-A-2026", name="P9 甲班")
        self.cohort_b = Cohort.objects.create(cohort_id="P9-B-2026", name="P9 乙班")
        self.teacher = get_user_model().objects.create_user(
            username="p9-teacher",
            email="p9-teacher@example.test",
            password="Another-strong-passphrase-911!",
            is_staff=True,
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort_b)

    # ── 工具 ──────────────────────────────────────────────────────────
    def _students(self, count, cohort=None, prefix="p9"):
        cohort = cohort or self.cohort
        rows = []
        for index in range(1, count + 1):
            profile = create_student_account(
                "%s-%02d@example.test" % (prefix, index), "學員%02d" % index
            )
            rows.append((profile, enroll_student(profile, cohort)))
        return rows

    def _subs(self, enrollment):
        return ensure_growth_submissions(enrollment)

    def _set(self, enrollment, slot_id, status, days_ago=1):
        item = next(
            row for row in self._subs(enrollment) if row.definition.slot_id == slot_id
        )
        item.status = status
        item.submitted_at = timezone.now() - timedelta(days=days_ago)
        item.save(update_fields=["status", "submitted_at"])
        return item

    def _review(self, submission, status, note="", score=None):
        GrowthRecordReview.objects.create(
            submission=submission,
            reviewer=self.teacher,
            review_status=status,
            score=score,
            teacher_note=note,
            reviewed_at=timezone.now(),
        )
        submission.status = status
        submission.save(update_fields=["status"])
        return submission

    def _legacy_initialize(self, cohort):
        """重現 P9 修正前的行為：統計前先補建提交列與階段進度（會寫入）。"""
        for enrollment in Enrollment.objects.filter(cohort=cohort, active=True):
            ensure_growth_submissions(enrollment)
            for phase, _ in TaskDefinition.Stage.choices:
                PhaseProgress.objects.get_or_create(enrollment=enrollment, phase=phase)

    def _dump(self, name, payload):
        dump_dir = os.environ.get("FDE_P9_DUMP")
        if not dump_dir:
            return
        target = Path(dump_dir)
        target.mkdir(parents=True, exist_ok=True)
        (target / ("%s.actual.json" % name)).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    def _assert_matches(self, name, builder):
        """在同一份資料狀態上對照「修正前（補建後統計）」與「修正後（唯讀統計）」。

        做法：以 savepoint 包住補建動作，取完修正前統計後回滾，
        再對完全相同的資料狀態執行唯讀統計，逐項比對。
        如此不需依賴人工維護的基準檔，任何語意差異都會立即失敗。
        """
        cohort = builder()

        with transaction.atomic():
            savepoint = transaction.savepoint()
            self._legacy_initialize(cohort)
            before = snapshot(build_cohort_report(cohort))
            transaction.savepoint_rollback(savepoint)

        after = snapshot(build_cohort_report(cohort))

        if before != after:
            self._dump(name, {"before": before, "after": after})
        self.assertEqual(before, after, "情境 %s：唯讀統計與修正前（補建後）不一致" % name)

        # 另與黃金基準檔比對，鎖定修正後行為不再漂移（防止未來改動破壞統計）。
        path = BASELINE_DIR / ("%s.json" % name)
        if CAPTURE:
            BASELINE_DIR.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(after, ensure_ascii=False, indent=2, sort_keys=True),
                encoding="utf-8",
            )
            self.skipTest("已擷取基準：%s" % name)
        if path.exists():
            baseline = json.loads(path.read_text(encoding="utf-8"))
            if baseline != after:
                self._dump(name, after)
            self.assertEqual(baseline, after, "情境 %s 與黃金基準不一致" % name)

    # ── 情境 ──────────────────────────────────────────────────────────
    def _build_empty_cohort(self):
        """空班級：無任何在學學員。"""
        return self.cohort

    def _build_zero_submissions(self):
        """學員存在但 0 項提交（全部尚未開始）。"""
        self._students(2)
        return self.cohort

    def _build_partial_submitted(self):
        """部分提交：同一學員僅部分槽位提交。"""
        _profile, enrollment = self._students(1)[0]
        self._set(enrollment, "R01", SUBMITTED)
        self._set(enrollment, "R02", SUBMITTED, days_ago=2)
        return self.cohort

    def _build_all_submitted(self):
        """8 項已提交（尚未複核）。"""
        _profile, enrollment = self._students(1)[0]
        for slot_id in ("R%02d" % index for index in range(1, 9)):
            self._set(enrollment, slot_id, SUBMITTED)
        return self.cohort

    def _build_pending_review(self):
        """待教師複核（狀態 submitted）。"""
        _profile, enrollment = self._students(1)[0]
        self._set(enrollment, "R05", SUBMITTED)
        return self.cohort

    def _build_needs_revision(self):
        """需要補充（狀態 needs_revision）。"""
        _profile, enrollment = self._students(1)[0]
        item = self._set(enrollment, "R05", SUBMITTED)
        self._review(item, NEEDS_REVISION, note="請補上量測照片。")
        return self.cohort

    def _build_reviewed(self):
        """已複核（approved ＋ 教師評語）。"""
        _profile, enrollment = self._students(1)[0]
        item = self._set(enrollment, "R06", SUBMITTED)
        self._review(item, APPROVED, note="組裝完成度良好，走線可再加強。", score=92)
        return self.cohort

    def _build_missing_submission_rows(self):
        """缺少 GrowthRecordSubmission：學員與定義存在，但提交列被清空。"""
        self._students(2)
        GrowthRecordSubmission.objects.all().delete()
        return self.cohort

    def _build_missing_phase_progress(self):
        """缺少 PhaseProgress：提交資料存在，但階段進度列被清空。"""
        _profile, enrollment = self._students(1)[0]
        self._set(enrollment, "R01", SUBMITTED)
        PhaseProgress.objects.all().delete()
        return self.cohort

    def _build_missing_definitions(self):
        """完全未 seed 定義（連同提交列一併不存在）。"""
        self._students(1)
        GrowthRecordDefinition.objects.all().delete()
        GrowthRecordSubmission.objects.all().delete()
        PhaseProgress.objects.all().delete()
        return self.cohort

    def _build_mixed_multi_student(self):
        """混合情境：未提交／部分提交／待複核／需要補充／已複核並存。"""
        rows = self._students(5)
        # 學員 01：0 項提交
        # 學員 02：部分提交
        self._set(rows[1][1], "R01", SUBMITTED)
        self._set(rows[1][1], "R03", SUBMITTED, days_ago=3)
        # 學員 03：待複核
        self._set(rows[2][1], "R05", SUBMITTED)
        # 學員 04：需要補充
        item = self._set(rows[3][1], "R05", SUBMITTED)
        self._review(item, NEEDS_REVISION, note="缺少飛行影片。")
        # 學員 05：8 項提交且全部已複核
        for slot_id in ("R%02d" % index for index in range(1, 9)):
            submission = self._set(rows[4][1], slot_id, SUBMITTED)
            self._review(submission, APPROVED, note="", score=88)
        return self.cohort

    def _build_group_override(self):
        """小組專屬定義覆寫預設定義（驗證 selected_by_slot 選擇邏輯不變）。"""
        group = LearningGroup.objects.create(cohort=self.cohort, code="A", name="A 組")
        profile, enrollment = self._students(1)[0]
        enrollment.group = group
        enrollment.save(update_fields=["group"])
        ensure_growth_submissions(enrollment)
        GrowthRecordDefinition.objects.filter(
            cohort=self.cohort, slot_id="R02"
        ).update(enabled=False)
        return self.cohort

    def _build_multi_cohort(self):
        """多班級：兩班統計互不干擾。"""
        rows_a = self._students(2)
        rows_b = self._students(2, cohort=self.cohort_b, prefix="p9b")
        self._set(rows_a[0][1], "R01", SUBMITTED)
        self._set(rows_b[0][1], "R07", SUBMITTED)
        return self.cohort


class P9EquivalenceTests(P9ScenarioBase):
    """修正前後統計等價對照（每個情境對應一份基準檔）。"""

    # 差異需完整可讀，否則難以判斷是語意不同或僅格式不同。
    maxDiff = None

    def test_empty_cohort(self):
        self._assert_matches("empty_cohort", self._build_empty_cohort)

    def test_zero_submissions(self):
        self._assert_matches("zero_submissions", self._build_zero_submissions)

    def test_partial_submitted(self):
        self._assert_matches("partial_submitted", self._build_partial_submitted)

    def test_all_submitted(self):
        self._assert_matches("all_submitted", self._build_all_submitted)

    def test_pending_review(self):
        self._assert_matches("pending_review", self._build_pending_review)

    def test_needs_revision(self):
        self._assert_matches("needs_revision", self._build_needs_revision)

    def test_reviewed(self):
        self._assert_matches("reviewed", self._build_reviewed)

    def test_missing_submission_rows(self):
        self._assert_matches("missing_submission_rows", self._build_missing_submission_rows)

    def test_missing_phase_progress(self):
        self._assert_matches("missing_phase_progress", self._build_missing_phase_progress)

    def test_missing_definitions(self):
        self._assert_matches("missing_definitions", self._build_missing_definitions)

    def test_mixed_multi_student(self):
        self._assert_matches("mixed_multi_student", self._build_mixed_multi_student)

    def test_group_override(self):
        self._assert_matches("group_override", self._build_group_override)

    def test_multi_cohort(self):
        self._assert_matches("multi_cohort", self._build_multi_cohort)
