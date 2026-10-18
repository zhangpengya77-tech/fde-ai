"""Golden Test Center 框架測試（2026-10-09 第 23 輪指令「二、三」）。

覆蓋範圍：
A. 服務層 create_golden_set / add_sample / confirm_sample / reject_sample / freeze
B. FROZEN 鎖定語意：鎖定後不得新增、確認、退回樣本
C. 四類標籤強制：缺類別不得鎖定
D. golden_test_blocked_reason 前置條件
E. 教師頁面權限隔離（班級 / 角色）
F. HTTP 垂直切片：七條新路由可實際開啟並正確回應

邊界宣告：
- 本檔只處理照片與標籤，**不載入、不反序列化、不推論任何 .pt**。
- 本檔不執行訓練、不部署、不啟用 ACTIVE。
- 本檔不寫入正式資料庫；使用 Django 測試資料庫（記憶體 / 臨時檔）。
"""

import io
import uuid

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse

from learning.golden_set import (
    MAX_SAMPLE_BYTES,
    PROP_LABELS,
    GoldenSetError,
    add_sample,
    confirm_sample,
    create_golden_set,
    default_golden_set_id,
    freeze_golden_set,
    golden_set_summary,
    golden_sets_for_teacher,
    golden_test_blocked_reason,
    reject_sample,
    validate_label,
    validate_task_id,
)
from learning.models import Cohort, GoldenSet, GoldenSetSample, TeacherCohortAccess
from learning.tests.helpers import create_student_account, enroll_student
from learning.vision_repository import register_model_record


def _image(name="sample.jpg", size=64):
    """產生一張極小的合法影像位元組。

    只做檔案保存測試，不解析影像內容、不涉及任何模型檔。
    """
    payload = b"\xff\xd8\xff\xe0" + b"G" * max(size - 4, 1)
    return SimpleUploadedFile(name, payload, content_type="image/jpeg")


def _big_upload(name="huge.jpg", size=MAX_SAMPLE_BYTES + 1):
    """產生一張超過上限的假影像（僅測試大小檢查，不寫入磁碟）。"""
    return SimpleUploadedFile(name, b"G" * size, content_type="image/jpeg")


class GoldenSetServiceTests(TestCase):
    """A/B/C 服務層語意測試。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="GS-A", name="黃金測試班 A")
        self.teacher = get_user_model().objects.create_user(
            username="gs-teacher@example.test", password="Teacher-pass-903!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)

    def _golden_set(self, name="黃金測試集 v1", version="v1", golden_set_id=""):
        return create_golden_set(
            teacher=self.teacher,
            name=name,
            version=version,
            golden_set_id=golden_set_id,
            cohort=self.cohort,
        )

    def _fill_four_labels(self, golden_set, confirmed=True):
        """四類各補一張樣本；預設直接確認。"""
        samples = []
        for label in PROP_LABELS:
            samples.append(
                add_sample(
                    golden_set=golden_set,
                    teacher=self.teacher,
                    image=_image(f"{label.lower()}.jpg"),
                    label=label,
                    confirm_now=confirmed,
                )
            )
        return samples

    # ---------- create_golden_set ----------

    def test_a1_default_golden_set_id_matches_backend_convention(self):
        """預設 ID 必須沿用既有後端慣例 PROP_GOLDEN_v1，不另創新命名。"""
        self.assertEqual(default_golden_set_id("PROP_DIRECTION", "v1"), "PROP_GOLDEN_v1")
        self.assertEqual(default_golden_set_id("PROP_DIRECTION", "2"), "PROP_GOLDEN_v2")

        golden_set = self._golden_set()

        self.assertEqual(golden_set.golden_set_id, "PROP_GOLDEN_v1")
        self.assertEqual(golden_set.task_id, "PROP_DIRECTION")
        self.assertEqual(golden_set.model_type, "PROP_DIRECTION")
        self.assertEqual(golden_set.status, "DRAFT")
        self.assertFalse(golden_set.is_frozen)
        self.assertIsNone(golden_set.frozen_at)

    def test_a2_duplicate_golden_set_id_is_rejected(self):
        """同一識別碼不得重複建立。"""
        self._golden_set()

        with self.assertRaises(GoldenSetError) as ctx:
            self._golden_set(name="重複版本")

        self.assertEqual(ctx.exception.code, "GOLDEN_SET_EXISTS")
        self.assertEqual(GoldenSet.objects.count(), 1)

    def test_a3_non_prop_task_is_rejected_this_round(self):
        """本輪只支援 PROP_DIRECTION；FOUR_SIDE_HOVER 必須被拒絕。"""
        with self.assertRaises(GoldenSetError) as ctx:
            create_golden_set(teacher=self.teacher, name="懸停測試集", task_id="FOUR_SIDE_HOVER")
        self.assertEqual(ctx.exception.code, "TASK_NOT_SUPPORTED")

        with self.assertRaises(GoldenSetError):
            validate_task_id("PROP_DIRECTION_V1")  # 規則模板代號不是任務代號
        self.assertEqual(validate_task_id("PROP_DIRECTION"), "PROP_DIRECTION")

    def test_a4_name_is_required(self):
        """名稱必填，避免出現無法辨識的測試集。"""
        with self.assertRaises(GoldenSetError) as ctx:
            create_golden_set(teacher=self.teacher, name="   ")

        self.assertEqual(ctx.exception.code, "NAME_REQUIRED")

    # ---------- add_sample ----------

    def test_b1_add_sample_records_label_source_count_and_hash(self):
        """新增樣本須記錄四類標籤、標註來源、確認狀態與內容雜湊。"""
        golden_set = self._golden_set()

        sample = add_sample(
            golden_set=golden_set,
            teacher=self.teacher,
            image=_image("cw_f.jpg"),
            label="CW_F",
            annotation_source=GoldenSet.AnnotationSource.TEACHER_PHOTO,
            note="教師實拍正面順時針",
            confirm_now=True,
        )

        golden_set.refresh_from_db()
        self.assertEqual(sample.label, "CW_F")
        self.assertEqual(sample.annotation_source, "TEACHER_PHOTO")
        self.assertEqual(sample.confirmation_status, "CONFIRMED")
        self.assertEqual(sample.confirmed_by_id, self.teacher.pk)
        self.assertIsNotNone(sample.confirmed_at)
        self.assertEqual(len(sample.content_sha256), 64)
        self.assertEqual(sample.note, "教師實拍正面順時針")
        self.assertEqual(golden_set.sample_count, 1)
        self.assertEqual(golden_set.confirmed_sample_count, 1)
        self.assertEqual(golden_set.label_distribution()["CW_F"], 1)
        self.assertEqual(golden_set.missing_labels(), ["CCW_F", "CW_B", "CCW_B"])

    def test_b2_invalid_label_is_rejected(self):
        """標籤必須為四類之一，不得自創類別。"""
        golden_set = self._golden_set()

        with self.assertRaises(GoldenSetError) as ctx:
            add_sample(
                golden_set=golden_set,
                teacher=self.teacher,
                image=_image(),
                label="CW_SIDE",
            )

        self.assertEqual(ctx.exception.code, "LABEL_INVALID")
        self.assertEqual(golden_set.sample_count, 0)

        self.assertEqual(validate_label("CCW_B"), "CCW_B")
        self.assertEqual(PROP_LABELS, ("CW_F", "CCW_F", "CW_B", "CCW_B"))

    def test_b3_invalid_annotation_source_is_rejected(self):
        """標註來源須為既有三種之一。"""
        golden_set = self._golden_set()

        with self.assertRaises(GoldenSetError) as ctx:
            add_sample(
                golden_set=golden_set,
                teacher=self.teacher,
                image=_image(),
                label="CW_F",
                annotation_source="MODEL_GUESS",
            )

        self.assertEqual(ctx.exception.code, "ANNOTATION_SOURCE_INVALID")

    def test_b4_non_image_upload_is_rejected(self):
        """僅接受影像檔；模型檔不得混入測試集。"""
        golden_set = self._golden_set()

        with self.assertRaises(GoldenSetError) as ctx:
            add_sample(
                golden_set=golden_set,
                teacher=self.teacher,
                image=SimpleUploadedFile("best.pt", b"pickle-bytes", content_type="application/octet-stream"),
                label="CW_F",
            )

        self.assertEqual(ctx.exception.code, "SAMPLE_IMAGE_TYPE_INVALID")
        self.assertEqual(golden_set.sample_count, 0)

    def test_b5_empty_upload_is_rejected(self):
        """空檔案不得入庫。"""
        golden_set = self._golden_set()

        with self.assertRaises(GoldenSetError) as ctx:
            add_sample(
                golden_set=golden_set,
                teacher=self.teacher,
                image=SimpleUploadedFile("empty.jpg", b"", content_type="image/jpeg"),
                label="CW_F",
            )

        self.assertEqual(ctx.exception.code, "SAMPLE_IMAGE_EMPTY")

    def test_b6_oversized_upload_is_rejected_without_writing_file(self):
        """超過上限的照片必須在寫入磁碟前被拒絕。"""
        golden_set = self._golden_set()

        with self.assertRaises(GoldenSetError) as ctx:
            add_sample(
                golden_set=golden_set,
                teacher=self.teacher,
                image=_big_upload(),
                label="CW_F",
            )

        self.assertEqual(ctx.exception.code, "SAMPLE_IMAGE_TOO_LARGE")
        self.assertEqual(golden_set.sample_count, 0)

    def test_b7_pending_sample_does_not_count_as_confirmed(self):
        """未確認樣本不計入正式評估，也不算已補類別。"""
        golden_set = self._golden_set()

        add_sample(
            golden_set=golden_set,
            teacher=self.teacher,
            image=_image(),
            label="CW_F",
            confirm_now=False,
        )

        golden_set.refresh_from_db()
        self.assertEqual(golden_set.sample_count, 1)
        self.assertEqual(golden_set.confirmed_sample_count, 0)
        self.assertEqual(golden_set.label_distribution()["CW_F"], 0)
        self.assertIn("CW_F", golden_set.missing_labels())

    # ---------- confirm / reject ----------

    def test_c1_confirm_and_reject_sample(self):
        """教師可確認或退回樣本，皆留下確認人與時間。"""
        golden_set = self._golden_set()
        sample = add_sample(
            golden_set=golden_set, teacher=self.teacher, image=_image(), label="CCW_F"
        )
        self.assertEqual(sample.confirmation_status, "PENDING")
        self.assertIsNone(sample.confirmed_at)

        confirm_sample(sample=sample, teacher=self.teacher, note="標籤正確")
        sample.refresh_from_db()
        self.assertEqual(sample.confirmation_status, "CONFIRMED")
        self.assertIsNotNone(sample.confirmed_at)
        self.assertEqual(sample.note, "標籤正確")

        reject_sample(sample=sample, teacher=self.teacher, note="標籤有誤")
        sample.refresh_from_db()
        self.assertEqual(sample.confirmation_status, "REJECTED")
        golden_set.refresh_from_db()
        # 退回後不得再計入已確認數量。
        self.assertEqual(golden_set.confirmed_sample_count, 0)

    # ---------- freeze ----------

    def test_d1_freeze_requires_all_four_labels(self):
        """缺任何一類都不得鎖定，避免鎖出無法評估的測試集。"""
        golden_set = self._golden_set()
        self._fill_four_labels(golden_set)
        GoldenSetSample.objects.filter(label="CCW_B").delete()
        golden_set.refresh_from_db()

        with self.assertRaises(GoldenSetError) as ctx:
            freeze_golden_set(golden_set=golden_set, teacher=self.teacher)

        self.assertEqual(ctx.exception.code, "GOLDEN_SET_INCOMPLETE")
        self.assertIn("CCW_B", ctx.exception.message)
        golden_set.refresh_from_db()
        self.assertFalse(golden_set.is_frozen)

    def test_d2_freeze_then_blocks_all_sample_mutations(self):
        """鎖定後不得新增、確認、退回樣本。"""
        golden_set = self._golden_set()
        samples = self._fill_four_labels(golden_set)
        golden_set.refresh_from_db()

        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)
        golden_set.refresh_from_db()
        self.assertEqual(golden_set.status, "FROZEN")
        self.assertTrue(golden_set.is_frozen)
        self.assertIsNotNone(golden_set.frozen_at)
        self.assertEqual(golden_set.frozen_by_id, self.teacher.pk)
        self.assertNotEqual(golden_set.mutation_blocked_reason(), "")

        # 新增樣本被拒
        with self.assertRaises(GoldenSetError) as ctx:
            add_sample(
                golden_set=golden_set,
                teacher=self.teacher,
                image=_image("new.jpg"),
                label="CW_F",
            )
        self.assertEqual(ctx.exception.code, "GOLDEN_SET_FROZEN")

        # 確認樣本被拒
        with self.assertRaises(GoldenSetError) as ctx:
            confirm_sample(sample=samples[0], teacher=self.teacher)
        self.assertEqual(ctx.exception.code, "GOLDEN_SET_FROZEN")

        # 退回樣本被拒
        with self.assertRaises(GoldenSetError) as ctx:
            reject_sample(sample=samples[0], teacher=self.teacher)
        self.assertEqual(ctx.exception.code, "GOLDEN_SET_FROZEN")

        golden_set.refresh_from_db()
        self.assertEqual(golden_set.sample_count, 4)
        self.assertEqual(golden_set.confirmed_sample_count, 4)

    def test_d3_double_freeze_is_rejected(self):
        """重複鎖定必須被拒，避免覆蓋原鎖定時間。"""
        golden_set = self._golden_set()
        self._fill_four_labels(golden_set)
        golden_set.refresh_from_db()
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)
        golden_set.refresh_from_db()
        first_frozen_at = golden_set.frozen_at

        with self.assertRaises(GoldenSetError) as ctx:
            freeze_golden_set(golden_set=golden_set, teacher=self.teacher)

        self.assertEqual(ctx.exception.code, "GOLDEN_SET_ALREADY_FROZEN")
        golden_set.refresh_from_db()
        self.assertEqual(golden_set.frozen_at, first_frozen_at)

    def test_d4_frozen_version_is_reproducible_snapshot(self):
        """鎖定後分佈與摘要固定，可供 Golden Test 重現。"""
        golden_set = self._golden_set()
        self._fill_four_labels(golden_set)
        golden_set.refresh_from_db()
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)

        summary = golden_set_summary(golden_set)

        self.assertEqual(summary["golden_set_id"], "PROP_GOLDEN_v1")
        self.assertTrue(summary["is_frozen"])
        self.assertEqual(summary["sample_count"], 4)
        self.assertEqual(summary["confirmed_sample_count"], 4)
        self.assertEqual(summary["missing_labels"], [])
        self.assertEqual(
            summary["label_distribution"],
            {"CW_F": 1, "CCW_F": 1, "CW_B": 1, "CCW_B": 1},
        )
        self.assertIsNotNone(summary["frozen_at"])

    def test_d5_second_version_is_independent_from_frozen_first(self):
        """建立 v2 不得影響已鎖定的 v1。"""
        v1 = self._golden_set()
        self._fill_four_labels(v1)
        v1.refresh_from_db()
        freeze_golden_set(golden_set=v1, teacher=self.teacher)

        v2 = self._golden_set(name="黃金測試集 v2", version="v2")

        self.assertEqual(v2.golden_set_id, "PROP_GOLDEN_v2")
        self.assertFalse(v2.is_frozen)
        add_sample(golden_set=v2, teacher=self.teacher, image=_image("v2.jpg"), label="CW_F")
        v1.refresh_from_db()
        self.assertEqual(v1.sample_count, 4)
        self.assertTrue(v1.is_frozen)

    # ---------- golden_test_blocked_reason ----------

    def test_e1_golden_test_requires_candidate_and_frozen_set(self):
        """未列候選、缺任務類型或缺已鎖定版本，皆不得進入 Golden Test。

        第 24 輪已把此判斷升級為**服務層自驗證**（`model_golden_test_blocked_reason`）：
        不再信任呼叫端傳入的清單，一律自行查詢資料庫。
        `golden_test_blocked_reason` 保留為相容別名，行為與權威版一致。
        """
        from learning.models import VisionModelRecord
        from learning.golden_set import model_golden_test_blocked_reason

        golden_set = self._golden_set()

        # 以真實模型的欄位與列舉建立替代物件。
        class _Record:
            ReviewStatus = VisionModelRecord.ReviewStatus

            def __init__(self, review_status, task_id="PROP_DIRECTION"):
                self.review_status = review_status
                self.task_id = task_id

        submitted = _Record(VisionModelRecord.ReviewStatus.SUBMITTED)
        candidate = _Record(VisionModelRecord.ReviewStatus.CANDIDATE)

        # 1. 尚未列候選：即使有已鎖定版本也不得進入。
        self.assertIn("候選", model_golden_test_blocked_reason(submitted))

        # 2. 已列候選但尚無任何 Golden Set：不得進入，且訊息須說明原因。
        self.assertNotEqual(model_golden_test_blocked_reason(candidate), "")
        self.assertIn("尚無可用的已鎖定 Golden Set", model_golden_test_blocked_reason(candidate))

        # 3. 缺少任務類型者不得進入（無法驗證相容性）。
        no_task = _Record(VisionModelRecord.ReviewStatus.CANDIDATE, task_id="")
        self.assertIn("任務類型", model_golden_test_blocked_reason(no_task))

        # 4. 有 DRAFT 版本但未鎖定：仍不得進入（權威版自行查 DB，不信任外部清單）。
        self.assertIn("未通過驗證", model_golden_test_blocked_reason(candidate))
        self.assertIn("FROZEN", model_golden_test_blocked_reason(candidate))

        # 5. 條件皆滿足：已列候選 + 任務相容 + 已鎖定 + 四類齊備。
        self._fill_four_labels(golden_set)
        golden_set.refresh_from_db()
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)
        self.assertEqual(model_golden_test_blocked_reason(candidate), "")

        # 6. 相容別名的行為必須與權威版一致。
        self.assertEqual(golden_test_blocked_reason(candidate, []), "")

    def test_e1b_authoritative_check_ignores_caller_supplied_list(self):
        """權威版不得因呼叫端傳入看似完整的清單而放行。"""
        from learning.models import VisionModelRecord
        from learning.golden_set import model_golden_test_blocked_reason

        # 清單裡塞一個「看起來已鎖定」的假 dict；權威版必須完全忽略它。
        fake_frozen = [
            {
                "golden_set_id": "PROP_GOLDEN_v1",
                "task_id": "PROP_DIRECTION",
                "is_frozen": True,
                "confirmed_sample_count": 4,
                "missing_labels": [],
            }
        ]

        class _Record:
            ReviewStatus = VisionModelRecord.ReviewStatus
            review_status = VisionModelRecord.ReviewStatus.CANDIDATE
            task_id = "PROP_DIRECTION"

        # 資料庫中其實沒有任何 Golden Set → 必須仍被擋下。
        self.assertNotEqual(
            model_golden_test_blocked_reason(_Record(), fake_frozen), ""
        )

    def test_e1c_frozen_but_audit_fields_missing_is_blocked(self):
        """FROZEN 但缺少鎖定審計欄位者，狀態不一致，必須擋下。

        第 24 輪盤點發現：模型層已有 `golden_set_frozen_requires_audit`
        CHECK 約束，FROZEN 但缺 frozen_at / frozen_by 的列在資料庫層
        根本無法寫入。因此本測試分兩段驗證：

          (a) 資料庫層：嘗試竄改必被 IntegrityError 拒絕。
          (b) 服務層：以不落地的記憶體物件模擬「繞過資料庫」的情境，
              確認 `verify_frozen_golden_set()` 仍會擋下。
        """
        from django.db import IntegrityError, transaction

        from learning.models import VisionModelRecord
        from learning.golden_set import verify_frozen_golden_set

        golden_set = self._golden_set()
        self._fill_four_labels(golden_set)
        golden_set.refresh_from_db()
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)

        self.assertEqual(verify_frozen_golden_set(golden_set, "PROP_DIRECTION"), "")

        # (a) 資料庫層防線：竄改審計欄位必須被 CHECK 約束拒絕。
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                GoldenSet.objects.filter(pk=golden_set.pk).update(frozen_by=None)

        # 確認資料庫仍是原狀。
        golden_set.refresh_from_db()
        self.assertIsNotNone(golden_set.frozen_by)
        self.assertEqual(verify_frozen_golden_set(golden_set, "PROP_DIRECTION"), "")

        # (b) 服務層防線：模擬「已繞過資料庫」的不一致狀態。
        original_frozen_by = golden_set.frozen_by
        golden_set.frozen_by = None
        try:
            self.assertIn(
                "缺少鎖定審計",
                verify_frozen_golden_set(golden_set, "PROP_DIRECTION"),
            )
        finally:
            golden_set.frozen_by = original_frozen_by


class GoldenSetTeacherVisibilityTests(TestCase):
    """E 權限隔離測試：教師只看到自己或授權班級的測試集。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="GS-V1", name="可見班")
        self.other_cohort = Cohort.objects.create(cohort_id="GS-V2", name="不可見班")
        self.teacher = get_user_model().objects.create_user(
            username="gs-visible@example.test", password="Teacher-pass-904!", is_staff=True
        )
        self.other_teacher = get_user_model().objects.create_user(
            username="gs-other@example.test", password="Teacher-pass-905!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        TeacherCohortAccess.objects.create(teacher=self.other_teacher, cohort=self.other_cohort)
        self.student = create_student_account("gs-student@example.test", "黃金測試學員")
        self.enrollment = enroll_student(self.student, self.cohort)

        self.visible = create_golden_set(
            teacher=self.teacher, name="可見測試集", cohort=self.cohort
        )
        self.stranger = create_golden_set(
            teacher=self.other_teacher,
            name="他人測試集",
            golden_set_id="PROP_GOLDEN_v9",
            cohort=self.other_cohort,
        )

    def test_e2_teacher_sees_own_and_authorized_only(self):
        """查詢集須排除他人非授權班級的測試集。"""
        visible_ids = set(
            golden_sets_for_teacher(self.teacher).values_list("golden_set_id", flat=True)
        )

        self.assertIn(self.visible.golden_set_id, visible_ids)
        self.assertNotIn(self.stranger.golden_set_id, visible_ids)

    def test_e3_unauthorized_golden_set_detail_returns_404(self):
        """直接輸入他人測試集網址須 404，不得洩漏。"""
        self.client.force_login(self.teacher)

        response = self.client.get(
            reverse("learning:teacher_golden_set_detail", args=[self.stranger.golden_set_id])
        )

        self.assertEqual(response.status_code, 404)

    def test_e4_student_cannot_open_golden_set_pages(self):
        """學員不得進入 Golden Set 管理中心。"""
        self.client.force_login(self.student.user)

        for name in (
            "learning:teacher_golden_set_list",
            "learning:teacher_golden_set_detail",
        ):
            args = [self.visible.golden_set_id] if name.endswith("detail") else []
            response = self.client.get(reverse(name, args=args))
            self.assertNotEqual(response.status_code, 200)

    def test_e5_anonymous_is_redirected(self):
        """未登入者一律被導向登入頁。"""
        response = self.client.get(reverse("learning:teacher_golden_set_list"))

        self.assertEqual(response.status_code, 302)
        self.assertIn("/login", response["Location"])


class GoldenSetHttpVerticalSliceTests(TestCase):
    """F HTTP 垂直切片：七條新路由實際可用。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="GS-H", name="HTTP 班")
        self.teacher = get_user_model().objects.create_user(
            username="gs-http@example.test", password="Teacher-pass-906!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.student = create_student_account("gs-http-student@example.test", "HTTP 學員")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.client.force_login(self.teacher)

    def _create_via_http(self, name="HTTP 測試集", version="v1"):
        return self.client.post(
            reverse("learning:teacher_golden_set_create"),
            {"name": name, "version": version, "description": "由測試建立。", "cohort_id": str(self.cohort.pk)},
        )

    def _upload(self, golden_set_id, label, filename="s.jpg", confirm_now=True):
        payload = {"label": label, "annotation_source": "TEACHER_PHOTO", "note": ""}
        if confirm_now:
            payload["confirm_now"] = "on"
        return self.client.post(
            reverse("learning:teacher_golden_set_add_sample", args=[golden_set_id]),
            {**payload, "image": _image(filename)},
        )

    def test_f1_list_page_opens_with_required_columns(self):
        """清單頁須呈現建立入口、版本狀態欄位與本輪未開放範圍。

        表格欄位只在已有測試集時才渲染，因此本測試先建立一筆再檢查欄位。
        """
        empty = self.client.get(reverse("learning:teacher_golden_set_list"))
        self.assertEqual(empty.status_code, 200)
        self.assertContains(empty, "建立測試集版本")
        self.assertContains(empty, "尚未啟用的功能")
        self.assertContains(empty, "目前尚無 Golden Set 版本")

        self._create_via_http()

        response = self.client.get(reverse("learning:teacher_golden_set_list"))
        self.assertEqual(response.status_code, 200)
        for column in ("Golden Set ID", "名稱", "版本", "狀態", "照片數", "四類分佈", "建立時間"):
            self.assertContains(response, column)
        self.assertContains(response, "PROP_GOLDEN_v1")
        self.assertContains(response, "DRAFT")

    def test_f2_create_redirects_to_detail_page(self):
        """建立後導向詳情頁，並以既有慣例命名。"""
        response = self._create_via_http()

        golden_set = GoldenSet.objects.get()
        self.assertEqual(golden_set.golden_set_id, "PROP_GOLDEN_v1")
        self.assertEqual(
            response["Location"],
            reverse("learning:teacher_golden_set_detail", args=["PROP_GOLDEN_v1"]),
        )

    def test_f3_detail_page_shows_summary_and_freeze_state(self):
        """詳情頁須呈現照片總數、已確認、四類分佈、尚缺類別與鎖定狀態。"""
        self._create_via_http()

        response = self.client.get(
            reverse("learning:teacher_golden_set_detail", args=["PROP_GOLDEN_v1"])
        )

        self.assertEqual(response.status_code, 200)
        for label in ("照片總數", "教師已確認", "四類分佈", "尚缺類別", "鎖定測試集"):
            self.assertContains(response, label)
        self.assertContains(response, "DRAFT（草稿，可調整）")

    def test_f4_upload_sample_through_http_records_four_labels(self):
        """四類照片皆可經 HTTP 上傳並記錄。"""
        self._create_via_http()

        for label in PROP_LABELS:
            response = self._upload("PROP_GOLDEN_v1", label, filename=f"{label}.jpg")
            self.assertEqual(response.status_code, 302)

        golden_set = GoldenSet.objects.get()
        self.assertEqual(golden_set.sample_count, 4)
        self.assertEqual(golden_set.confirmed_sample_count, 4)
        self.assertEqual(golden_set.missing_labels(), [])

    def test_f5_upload_non_image_through_http_shows_error_and_keeps_set_empty(self):
        """非影像檔經 HTTP 上傳須被擋下，且不得留下樣本。"""
        self._create_via_http()

        self.client.post(
            reverse("learning:teacher_golden_set_add_sample", args=["PROP_GOLDEN_v1"]),
            {
                "label": "CW_F",
                "annotation_source": "TEACHER_PHOTO",
                "image": SimpleUploadedFile("best.pt", b"x", content_type="application/octet-stream"),
            },
        )

        golden_set = GoldenSet.objects.get()
        self.assertEqual(golden_set.sample_count, 0)

    def test_f6_freeze_through_http_then_upload_is_rejected(self):
        """鎖定後再上傳樣本必須被拒。"""
        self._create_via_http()
        for label in PROP_LABELS:
            self._upload("PROP_GOLDEN_v1", label, filename=f"{label}.jpg")

        self.client.post(reverse("learning:teacher_golden_set_freeze", args=["PROP_GOLDEN_v1"]))

        golden_set = GoldenSet.objects.get()
        self.assertEqual(golden_set.status, "FROZEN")

        self._upload("PROP_GOLDEN_v1", "CW_F", filename="after-freeze.jpg")
        golden_set.refresh_from_db()
        self.assertEqual(golden_set.sample_count, 4)

    def test_f7_freeze_through_http_blocked_when_incomplete(self):
        """四類未滿時鎖定不得生效。"""
        self._create_via_http()
        self._upload("PROP_GOLDEN_v1", "CW_F", filename="only-cw-f.jpg")

        self.client.post(reverse("learning:teacher_golden_set_freeze", args=["PROP_GOLDEN_v1"]))

        golden_set = GoldenSet.objects.get()
        self.assertEqual(golden_set.status, "DRAFT")
        self.assertIsNone(golden_set.frozen_at)

    def test_f8_sample_confirm_and_reject_routes(self):
        """樣本確認 / 退回路由可正常改變狀態。"""
        self._create_via_http()
        self._upload("PROP_GOLDEN_v1", "CW_F", filename="pending.jpg", confirm_now=False)
        sample = GoldenSetSample.objects.get()

        self.client.post(
            reverse(
                "learning:teacher_golden_sample_confirm",
                args=["PROP_GOLDEN_v1", str(sample.sample_id)],
            ),
            {"action": "confirm", "note": "確認"},
        )
        sample.refresh_from_db()
        self.assertEqual(sample.confirmation_status, "CONFIRMED")

        self.client.post(
            reverse(
                "learning:teacher_golden_sample_confirm",
                args=["PROP_GOLDEN_v1", str(sample.sample_id)],
            ),
            {"action": "reject", "note": "退回"},
        )
        sample.refresh_from_db()
        self.assertEqual(sample.confirmation_status, "REJECTED")

    def test_f9_unknown_sample_id_returns_404(self):
        """不存在的樣本 ID 須 404。"""
        self._create_via_http()

        response = self.client.post(
            reverse(
                "learning:teacher_golden_sample_confirm",
                args=["PROP_GOLDEN_v1", str(uuid.uuid4())],
            ),
            {"action": "confirm"},
        )

        self.assertEqual(response.status_code, 404)

    def test_f10_get_is_not_allowed_on_post_only_routes(self):
        """建立 / 上傳 / 鎖定 / 確認皆為 POST-only。"""
        self._create_via_http()

        for name, args in (
            ("learning:teacher_golden_set_create", []),
            ("learning:teacher_golden_set_add_sample", ["PROP_GOLDEN_v1"]),
            ("learning:teacher_golden_set_freeze", ["PROP_GOLDEN_v1"]),
        ):
            response = self.client.get(reverse(name, args=args))
            self.assertEqual(response.status_code, 405, name)

    def test_f11_create_with_unauthorized_cohort_is_rejected(self):
        """指定未授權班級不得建立測試集。"""
        other = Cohort.objects.create(cohort_id="GS-X", name="未授權班")

        self.client.post(
            reverse("learning:teacher_golden_set_create"),
            {"name": "越權測試集", "version": "v7", "cohort_id": str(other.pk)},
        )

        self.assertFalse(GoldenSet.objects.filter(golden_set_id="PROP_GOLDEN_v7").exists())

    def test_f12_oversized_upload_through_http_is_rejected(self):
        """超過上限的照片經 HTTP 上傳須被擋下，且不得留下樣本。"""
        self._create_via_http()

        self.client.post(
            reverse("learning:teacher_golden_set_add_sample", args=["PROP_GOLDEN_v1"]),
            {
                "label": "CW_F",
                "annotation_source": "TEACHER_PHOTO",
                "image": _big_upload(),
            },
        )

        golden_set = GoldenSet.objects.get()
        self.assertEqual(golden_set.sample_count, 0)

    def test_f13_empty_file_upload_through_http_is_rejected(self):
        """空檔案經 HTTP 上傳須被擋下。"""
        self._create_via_http()

        self.client.post(
            reverse("learning:teacher_golden_set_add_sample", args=["PROP_GOLDEN_v1"]),
            {
                "label": "CW_F",
                "annotation_source": "TEACHER_PHOTO",
                "image": SimpleUploadedFile("empty.jpg", b"", content_type="image/jpeg"),
            },
        )

        golden_set = GoldenSet.objects.get()
        self.assertEqual(golden_set.sample_count, 0)

    def test_f14_invalid_label_and_source_through_http_are_rejected(self):
        """非法標籤與非法標註來源經 HTTP 上傳皆被擋下。"""
        self._create_via_http()

        self.client.post(
            reverse("learning:teacher_golden_set_add_sample", args=["PROP_GOLDEN_v1"]),
            {"label": "SIDE", "annotation_source": "TEACHER_PHOTO", "image": _image()},
        )
        self.client.post(
            reverse("learning:teacher_golden_set_add_sample", args=["PROP_GOLDEN_v1"]),
            {"label": "CW_F", "annotation_source": "MODEL_GUESS", "image": _image()},
        )

        golden_set = GoldenSet.objects.get()
        self.assertEqual(golden_set.sample_count, 0)


class GoldenTestPageFrameworkTests(TestCase):
    """三、Golden Test 評估中心框架頁。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="GT-A", name="Golden Test 班")
        self.other_cohort = Cohort.objects.create(cohort_id="GT-B", name="Golden Test 他人班")
        self.teacher = get_user_model().objects.create_user(
            username="gt-teacher@example.test", password="Teacher-pass-907!", is_staff=True
        )
        self.other_teacher = get_user_model().objects.create_user(
            username="gt-other@example.test", password="Teacher-pass-908!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        TeacherCohortAccess.objects.create(teacher=self.other_teacher, cohort=self.other_cohort)
        self.student = create_student_account("gt-student@example.test", "GT 學員")
        self.other_student = create_student_account("gt-other-student@example.test", "GT 他人學員")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.other_enrollment = enroll_student(self.other_student, self.other_cohort)
        self.record = self._record(self.enrollment, "gt-own.pt")
        self.other_record = self._record(self.other_enrollment, "gt-other.pt")
        self.client.force_login(self.teacher)

    def _record(self, enrollment, filename):
        """建立一筆倉庫紀錄，狀態為 CANDIDATE。

        只登錄既有的 Evidence，不載入任何 .pt 內容。
        """
        from learning.growth_records import ensure_growth_submissions
        from learning.models import Evidence

        submission = next(
            item for item in ensure_growth_submissions(enrollment)
            if item.definition.slot_id == "R07"
        )
        evidence = Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.MODEL,
            original_metadata={
                "filename": filename,
                "size_bytes": 4096,
                "task_type": "PROP_DIRECTION",
                "evidence_type": "YOLO_MODEL",
            },
            processed_metadata={
                "submission_status": "SUBMITTED",
                "vision_model_review": {"status": "CANDIDATE", "history": []},
            },
        )
        return register_model_record(
            evidence=evidence,
            task_id="PROP_DIRECTION",
            artifact_reference=f"media/{filename}",
            artifact_sha256="a" * 64,
            artifact_size_bytes=4096,
            source_filename=filename,
        )

    def _frozen_golden_set(self):
        golden_set = create_golden_set(
            teacher=self.teacher, name="GT 黃金測試集", cohort=self.cohort
        )
        for label in PROP_LABELS:
            add_sample(
                golden_set=golden_set,
                teacher=self.teacher,
                image=_image(f"{label}.jpg"),
                label=label,
                confirm_now=True,
            )
        golden_set.refresh_from_db()
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)
        return golden_set

    def test_g1_page_shows_all_reserved_fields(self):
        """頁面須預留：模型版本、Golden Set 版本、測試照片數、Class Mapping、Precision。"""
        response = self.client.get(
            reverse("learning:teacher_golden_test_page", args=[self.record.model_id])
        )

        self.assertEqual(response.status_code, 200)
        for field in ("模型版本", "Golden Set 版本", "測試照片數", "Class Mapping", "Precision"):
            self.assertContains(response, field)
        # 其餘既有指標欄位也須一併預留，避免與後端 metrics 定義不一致。
        for field in ("Recall", "mAP@50", "混淆矩陣", "低信心數"):
            self.assertContains(response, field)

    def test_g2_page_does_not_run_inference_and_keeps_submit_disabled(self):
        """本輪只建框架：不得執行推論，提交按鈕須停用。"""
        response = self.client.get(
            reverse("learning:teacher_golden_test_page", args=[self.record.model_id])
        )

        self.assertContains(response, "disabled")
        self.assertContains(response, "尚未啟用")
        self.record.refresh_from_db()
        # 開啟頁面不得變更任何狀態維度。
        self.assertEqual(self.record.validation_status, "NOT_EVALUATED")
        self.assertEqual(self.record.training_usage, "NOT_FOR_TRAINING")
        self.assertEqual(self.record.deployment_status, "CATALOGUED")

    def test_g3_page_is_blocked_without_frozen_golden_set(self):
        """尚無已鎖定 Golden Set 時，頁面須顯示前置條件未滿足。"""
        response = self.client.get(
            reverse("learning:teacher_golden_test_page", args=[self.record.model_id])
        )

        self.assertContains(response, "尚無已鎖定")

    def test_g4_page_is_ready_after_golden_set_frozen(self):
        """有 FROZEN 版本後，前置條件訊息消失。"""
        self._frozen_golden_set()

        response = self.client.get(
            reverse("learning:teacher_golden_test_page", args=[self.record.model_id])
        )

        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "尚無已鎖定")
        self.assertContains(response, "PROP_GOLDEN_v1")

    def test_g5_unauthorized_model_returns_404(self):
        """他人班級的模型不得開啟 Golden Test 頁。"""
        response = self.client.get(
            reverse("learning:teacher_golden_test_page", args=[self.other_record.model_id])
        )

        self.assertEqual(response.status_code, 404)

    def test_g6_student_cannot_open_golden_test_page(self):
        """學員不得進入 Golden Test 評估中心。"""
        self.client.force_login(self.student.user)

        response = self.client.get(
            reverse("learning:teacher_golden_test_page", args=[self.record.model_id])
        )

        self.assertNotEqual(response.status_code, 200)

    def test_g7_non_candidate_model_is_blocked(self):
        """尚未列為候選的模型不得進入 Golden Test。"""
        self._frozen_golden_set()
        record = self._record(self.enrollment, "gt-submitted-only.pt")
        record.review_status = "SUBMITTED"
        record.save(update_fields=["review_status"])

        response = self.client.get(
            reverse("learning:teacher_golden_test_page", args=[record.model_id])
        )

        self.assertContains(response, "尚未由教師列為候選")

    def test_g8_flywheel_page_links_to_golden_test(self):
        """飛輪頁每列須有 Golden Test 入口。"""
        response = self.client.get(reverse("learning:teacher_vision_flywheel"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Golden Test")
        self.assertContains(
            response, reverse("learning:teacher_golden_test_page", args=[self.record.model_id])
        )

    def test_g9_flywheel_page_links_to_golden_set_center(self):
        """飛輪頁須有 Golden Set 管理中心入口。"""
        response = self.client.get(reverse("learning:teacher_vision_flywheel"))

        self.assertContains(response, reverse("learning:teacher_golden_set_list"))

    def test_g10_golden_set_summary_matches_model_golden_set_naming(self):
        """Golden Set 版本下拉須沿用 PROP_GOLDEN_v1 命名，與既有後端一致。"""
        golden_set = self._frozen_golden_set()

        summary = golden_set_summary(golden_set)

        self.assertEqual(summary["golden_set_id"], "PROP_GOLDEN_v1")
        self.assertEqual(summary["task_id"], "PROP_DIRECTION")
        self.assertTrue(summary["is_frozen"])


class GoldenTestCenterIsolationTests(TestCase):
    """確認本輪未觸及既有模型倉庫狀態維度與學員端。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="GI-A", name="隔離班")
        self.teacher = get_user_model().objects.create_user(
            username="gi-teacher@example.test", password="Teacher-pass-909!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.client.force_login(self.teacher)
        self.golden_set = create_golden_set(
            teacher=self.teacher, name="隔離測試集", cohort=self.cohort
        )
        for label in PROP_LABELS:
            add_sample(
                golden_set=self.golden_set,
                teacher=self.teacher,
                image=_image(f"{label}.jpg"),
                label=label,
                confirm_now=True,
            )
        self.golden_set.refresh_from_db()
        freeze_golden_set(golden_set=self.golden_set, teacher=self.teacher)

    def test_h1_golden_test_center_does_not_touch_evidence_or_vision_records(self):
        """Golden Set 操作不得建立或修改任何模型倉庫紀錄。"""
        from learning.models import Evidence, VisionModelRecord

        self.assertEqual(Evidence.objects.count(), 0)
        self.assertEqual(VisionModelRecord.objects.count(), 0)

    def test_h2_no_active_deployment_after_golden_set_freeze(self):
        """鎖定 Golden Set 不等於模型已驗證或已部署。"""
        from learning.models import VisionModelRecord

        self.assertEqual(VisionModelRecord.objects.filter(deployment_status="ACTIVE").count(), 0)

    def test_h3_samples_are_never_model_files(self):
        """測試集樣本只收影像，不得出現任何模型檔。"""
        for sample in GoldenSetSample.objects.all():
            self.assertTrue(sample.image.name.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp")))
            self.assertNotIn(".pt", sample.image.name.lower())

    def test_h4_golden_set_does_not_write_back_to_evidence_metadata(self):
        """Golden Set 操作不得回寫任何 Evidence 的 processed_metadata。"""
        from learning.models import Evidence

        for evidence in Evidence.objects.all():
            self.assertNotIn("golden_set", evidence.processed_metadata or {})

    def test_h5_frozen_set_cannot_be_mutated_through_model_layer(self):
        """繞過服務層直接操作 Model 層，也必須被**擋下**（第 25 輪 P1 修復）。

        第 24 輪交付驗收時，本測試記錄的是「偵測得到、但擋不住」：
        直接 `objects.create()` 會**成功**，只能靠 Manifest 變成 MISMATCH 事後發現。
        第 25 輪已補上 Model 層守衛，因此本測試改為斷言**預防**生效。
        完整對抗性覆蓋見 `test_golden_set_immutability.py`。
        """
        from learning.golden_set_guard import FrozenGoldenSetError

        self.assertTrue(self.golden_set.is_frozen)
        self.assertNotEqual(self.golden_set.mutation_blocked_reason(), "")

        # (1) 直接新增樣本（繞過服務層）→ 必須被 Model 層守衛擋下。
        with self.assertRaises(FrozenGoldenSetError):
            GoldenSetSample.objects.create(
                golden_set=self.golden_set,
                image=_image("bypass.jpg"),
                label="CW_F",
            )

        # (2) 服務層既有的拒絕行為必須保持不變。
        with self.assertRaises(GoldenSetError) as ctx:
            add_sample(
                golden_set=self.golden_set,
                teacher=self.teacher,
                image=_image("bypass2.jpg"),
                label="CW_F",
            )
        self.assertEqual(ctx.exception.code, "GOLDEN_SET_FROZEN")

        # (3) 已被擋下的操作不得讓 Manifest 由 BOUND 變 MISMATCH。
        self.assertEqual(self.golden_set.manifest_binding_status, "BOUND")


class GoldenSetImageReadEdgeCaseTests(TestCase):
    """影像讀取異常路徑（不依賴真實檔案系統錯誤的穩定案例）。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="GE-A", name="影像邊界班")
        self.teacher = get_user_model().objects.create_user(
            username="ge-teacher@example.test", password="Teacher-pass-910!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.golden_set = create_golden_set(
            teacher=self.teacher, name="影像邊界測試集", cohort=self.cohort
        )

    def test_i1_upload_without_name_is_rejected(self):
        """沒有檔名的上傳不得入庫。"""
        with self.assertRaises(GoldenSetError) as ctx:
            add_sample(
                golden_set=self.golden_set,
                teacher=self.teacher,
                image=SimpleUploadedFile("noext", b"GGGG", content_type="application/octet-stream"),
                label="CW_F",
            )

        self.assertEqual(ctx.exception.code, "SAMPLE_IMAGE_TYPE_INVALID")

    def test_i2_allowed_suffixes_are_image_only(self):
        """允許清單必須只含影像副檔名。"""
        from learning.golden_set import ALLOWED_IMAGE_SUFFIXES

        self.assertEqual(
            tuple(ALLOWED_IMAGE_SUFFIXES), (".jpg", ".jpeg", ".png", ".webp", ".bmp")
        )
        for suffix in ALLOWED_IMAGE_SUFFIXES:
            self.assertNotIn("pt", suffix.strip("."))

    def test_i3_uppercase_suffix_is_accepted(self):
        """副檔名大小寫不影響判斷。"""
        sample = add_sample(
            golden_set=self.golden_set,
            teacher=self.teacher,
            image=_image("PHOTO.JPG"),
            label="CW_B",
            confirm_now=True,
        )

        self.assertEqual(sample.label, "CW_B")

    def test_i4_upload_over_10mb_boundary_is_rejected(self):
        """大小上限邊界：剛好超標即拒絕。"""
        with self.assertRaises(GoldenSetError) as ctx:
            add_sample(
                golden_set=self.golden_set,
                teacher=self.teacher,
                image=SimpleUploadedFile(
                    "boundary.jpg", b"G" * (MAX_SAMPLE_BYTES + 1), content_type="image/jpeg"
                ),
                label="CW_F",
            )

        self.assertEqual(ctx.exception.code, "SAMPLE_IMAGE_TOO_LARGE")

    def test_i5_bytes_based_helper_is_never_used_for_models(self):
        """本模組提供的雜湊只針對照片位元組，不用於模型檔。"""
        from learning.golden_set import hash_bytes

        self.assertEqual(len(hash_bytes(b"photo")), 64)
        self.assertNotEqual(hash_bytes(b"photo"), hash_bytes(b"photo2"))

    def test_i6_non_seekable_upload_still_processed(self):
        """不支援 seek 的物件不得讓流程崩潰（串流包裝常見）。"""
        class _NoSeek:
            name = "noseek.jpg"

            def __init__(self, payload):
                self._buffer = io.BytesIO(payload)

            def read(self, *args):
                return self._buffer.read(*args)

        sample = add_sample(
            golden_set=self.golden_set,
            teacher=self.teacher,
            image=_NoSeek(b"\xff\xd8\xff\xe0G" * 8),
            label="CCW_B",
            confirm_now=True,
        )

        self.assertEqual(sample.label, "CCW_B")
        # 無法 seek 時仍應完成寫入；雜湊可為空，但不得拋出例外。
        self.assertTrue(sample.image.name)
        self.assertEqual(len(sample.content_sha256 or ""), 64)

    def test_i7_seek_failure_after_read_is_tolerated_before_storage(self):
        """讀取後的還原 seek 失敗時，服務層不得拋出未處理例外。

        Django 儲存層在寫檔時會自行呼叫 seek(0)，因此本測試只驗證
        「服務層的清理動作」容忍 seek 失敗：以只有第 2 次會成功的物件
        模擬不支援重複 seek 的串流來源。
        """
        class _LateSeek:
            name = "lateseek.jpg"

            def __init__(self, payload):
                self._buffer = io.BytesIO(payload)
                self.calls = 0

            def seek(self, *args):
                self.calls += 1
                # 服務層的第一次 seek(0) 失敗（模擬不可重繞來源），
                # 之後交由 Django 儲存層需要的 seek 正常運作。
                if self.calls == 1:
                    raise OSError("seek not supported")
                return self._buffer.seek(*args)

            def read(self, *args):
                return self._buffer.read(*args)

        sample = add_sample(
            golden_set=self.golden_set,
            teacher=self.teacher,
            image=_LateSeek(b"\xff\xd8\xff\xe0G" * 8),
            label="CW_B",
            confirm_now=True,
        )

        self.assertEqual(sample.label, "CW_B")
        self.assertTrue(sample.image.name)
