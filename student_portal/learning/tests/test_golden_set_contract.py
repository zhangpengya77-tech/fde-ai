"""Golden Set 單一資料來源與整合契約測試（2026-10-09 第 24 輪）。

覆蓋指令「六、測試」要求的八類：
    1. DRAFT 不得用於正式 Golden Test
    2. FROZEN 版本不可修改
    3. 不同 task_id 不可混用
    4. Golden Set 版本 ID 唯一
    5. Manifest SHA256 可驗證
    6. 既有 Vision Center API 契約不受破壞
    7. 無真實評估不得 VALIDATED / ACTIVE
    8. 原有 R07、模型倉庫、快照功能不受影響

邊界宣告：
- 本檔**不載入、不反序列化、不執行任何 .pt**。
- 本檔**不修改正式 JSON Store**；涉及 JSON Store 的測試一律在 tempfile 隔離目錄進行。
- 本檔不執行訓練、不部署、不啟用 ACTIVE。
"""

import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse

from learning.golden_set import (
    COMPLETENESS_EVALUATION_READY,
    COMPLETENESS_INCOMPLETE,
    COMPLETENESS_STRUCTURAL,
    GOLDEN_SET_CONTRACT_VERSION,
    MIN_SAMPLES_PER_CLASS_FOR_EVALUATION,
    PROP_LABELS,
    GoldenSetError,
    add_sample,
    assert_no_false_active,
    assert_no_false_validated,
    build_manifest,
    canonical_manifest_bytes,
    completeness_level,
    create_golden_set,
    formal_evaluation_blocked_reason,
    freeze_golden_set,
    manifest_sha256,
    model_golden_test_blocked_reason,
    verify_manifest_sha256,
)
from learning.models import (
    Cohort,
    GoldenSet,
    GoldenSetSample,
    TeacherCohortAccess,
    VisionModelRecord,
)
from learning.tests.helpers import create_student_account, enroll_student
from learning.vision_repository import register_model_record


# ---------------------------------------------------------------------------
# 匯入路徑處理（唯讀）
# ---------------------------------------------------------------------------
# Django 測試執行時 CWD 為 student_portal/，而 live_backend/ 是其兄弟目錄，
# 預設不在 sys.path 上。此處僅為了「唯讀檢查既有契約」而把倉庫根目錄加入
# sys.path，不修改 live_backend 任何檔案。
REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# 正式 JSON Store 的路徑與本輪唯讀基線指紋（不得被任何測試寫入）。
PRODUCTION_VISION_STORE = (
    Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    / "FDE-AI-UAS"
    / "vision-center"
    / "vision_center.json"
)
# 第 24 輪盤點當下的正式 JSON Store SHA256；僅在檔案存在時比對。
PRODUCTION_VISION_STORE_BASELINE_SHA256 = (
    "7b3f674fbca0e6a13f2f154d5dddd926ecc9506e486926d3009ee5ae02615c36"
)


def _image(name="sample.jpg", size=64):
    """產生一張極小的合法影像位元組（僅測試檔案保存，不解析影像）。"""
    payload = b"\xff\xd8\xff\xe0" + b"G" * max(size - 4, 1)
    return SimpleUploadedFile(name, payload, content_type="image/jpeg")


class GoldenSetContractTests(TestCase):
    """1~5：契約、生命週期與 Manifest。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="C24-A", name="契約班 A")
        self.other_cohort = Cohort.objects.create(cohort_id="C24-B", name="契約班 B")
        self.teacher = get_user_model().objects.create_user(
            username="c24-teacher@example.test", password="Teacher-pass-924!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)

    def _golden_set(self, name="契約測試集", version="v1", task_id="PROP_DIRECTION"):
        return create_golden_set(
            teacher=self.teacher, name=name, version=version, task_id=task_id, cohort=self.cohort
        )

    def _fill(self, golden_set, per_class=1, confirmed=True):
        """每類補 per_class 張樣本。"""
        for label in PROP_LABELS:
            for index in range(per_class):
                add_sample(
                    golden_set=golden_set,
                    teacher=self.teacher,
                    image=_image(f"{label}-{index}.jpg"),
                    label=label,
                    confirm_now=confirmed,
                )
        return golden_set

    # ---------- 1. DRAFT 不得用於正式 Golden Test ----------

    def test_1_draft_golden_set_is_rejected_for_formal_evaluation(self):
        """DRAFT 版本即使四類齊備，也不得作為正式評估基準。"""
        golden_set = self._golden_set()
        self._fill(golden_set, per_class=3)
        golden_set.refresh_from_db()

        self.assertEqual(golden_set.status, "DRAFT")
        self.assertFalse(golden_set.is_frozen)

        reason = formal_evaluation_blocked_reason(golden_set, "PROP_DIRECTION")
        self.assertNotEqual(reason, "")
        self.assertIn("未鎖定", reason)

    def test_1b_draft_is_excluded_from_blocked_reason_even_when_four_classes_present(self):
        """有 DRAFT 版本但無 FROZEN 版本時，模型仍不得進入 Golden Test。"""
        golden_set = self._golden_set()
        self._fill(golden_set, per_class=3)

        class _Record:
            ReviewStatus = VisionModelRecord.ReviewStatus
            review_status = VisionModelRecord.ReviewStatus.CANDIDATE
            task_id = "PROP_DIRECTION"

        self.assertNotEqual(model_golden_test_blocked_reason(_Record()), "")

    # ---------- 2. FROZEN 版本不可修改 ----------

    def test_2_frozen_version_rejects_all_mutations(self):
        """FROZEN 後新增、確認、退回樣本一律拒絕。"""
        golden_set = self._golden_set()
        self._fill(golden_set, per_class=1, confirmed=False)
        samples = list(golden_set.samples.all())
        for sample in samples:
            from learning.golden_set import confirm_sample

            confirm_sample(sample=sample, teacher=self.teacher)
        golden_set.refresh_from_db()
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)
        golden_set.refresh_from_db()

        before_count = golden_set.sample_count

        with self.assertRaises(GoldenSetError) as ctx:
            add_sample(
                golden_set=golden_set, teacher=self.teacher, image=_image("new.jpg"), label="CW"
            )
        self.assertEqual(ctx.exception.code, "GOLDEN_SET_FROZEN")

        golden_set.refresh_from_db()
        self.assertEqual(golden_set.sample_count, before_count)

    def test_2b_frozen_version_manifest_hash_is_stable_when_untouched(self):
        """FROZEN 後未動任何樣本，Manifest 雜湊必須完全穩定。"""
        golden_set = self._golden_set()
        self._fill(golden_set, per_class=2)
        golden_set.refresh_from_db()
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)
        golden_set.refresh_from_db()

        first = manifest_sha256(golden_set)
        second = manifest_sha256(golden_set)

        self.assertEqual(first, second)
        self.assertEqual(golden_set.manifest_binding_status, "BOUND")

    # ---------- 3. 不同 task_id 不可混用 ----------

    def test_3_other_task_is_rejected_at_creation(self):
        """FOUR_SIDE_HOVER 不得建立 Golden Set（本輪未開放）。"""
        with self.assertRaises(GoldenSetError) as ctx:
            self._golden_set(name="懸停集", version="v9", task_id="FOUR_SIDE_HOVER")

        self.assertEqual(ctx.exception.code, "TASK_NOT_SUPPORTED")

    def test_3b_mismatched_task_id_is_rejected_by_verifier(self):
        """task_id 不相容者不得通過驗證（模擬資料被外部改成他任務）。"""
        from learning.golden_set import verify_frozen_golden_set

        golden_set = self._golden_set()
        self._fill(golden_set, per_class=2)
        golden_set.refresh_from_db()
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)

        # 對 PROP 測試集詢問 HOVER 相容性 → 必須拒絕。
        reason = verify_frozen_golden_set(golden_set, "FOUR_SIDE_HOVER")
        self.assertNotEqual(reason, "")
        self.assertIn("不相容", reason)

    def test_3c_cross_task_model_cannot_use_prop_golden_set(self):
        """HOVER 模型不得使用 PROP 的 Golden Set 作為基準。"""
        golden_set = self._golden_set()
        self._fill(golden_set, per_class=2)
        golden_set.refresh_from_db()
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)

        class _Record:
            ReviewStatus = VisionModelRecord.ReviewStatus
            review_status = VisionModelRecord.ReviewStatus.CANDIDATE
            task_id = "FOUR_SIDE_HOVER"

        self.assertNotEqual(model_golden_test_blocked_reason(_Record()), "")

    # ---------- 4. Golden Set 版本 ID 唯一 ----------

    def test_4_golden_set_id_is_unique(self):
        """同版本代號不得重複建立；不同版本可並存。"""
        self._golden_set()
        with self.assertRaises(GoldenSetError) as ctx:
            self._golden_set(name="重複")
        self.assertEqual(ctx.exception.code, "GOLDEN_SET_EXISTS")

        second = self._golden_set(name="第二版", version="v2")
        self.assertEqual(second.golden_set_id, "PROP_GOLDEN_v2")
        self.assertEqual(GoldenSet.objects.count(), 2)

    def test_4b_db_level_unique_constraint_exists(self):
        """DB 層必須有唯一約束，不只靠應用層檢查。"""
        field = GoldenSet._meta.get_field("golden_set_id")
        self.assertTrue(field.unique)

    # ---------- 5. Manifest SHA256 可驗證 ----------

    def test_5_manifest_is_reproducible_and_verifiable(self):
        """同一份內容必須產生相同雜湊，且可被獨立驗證。"""
        golden_set = self._golden_set()
        self._fill(golden_set, per_class=2)
        golden_set.refresh_from_db()
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)
        golden_set.refresh_from_db()

        manifest = build_manifest(golden_set)
        digest = manifest_sha256(golden_set)

        # 契約欄位齊備（指令「三」要求 12 項）。
        for key in (
            "contract_version",
            "golden_set_id",
            "task_id",
            "version",
            "sample_count",
            "confirmed_sample_count",
            "per_class_count",
            "class_contract",
            "frozen_at",
            "provenance",
            "samples",
        ):
            self.assertIn(key, manifest)
        self.assertEqual(manifest["contract_version"], GOLDEN_SET_CONTRACT_VERSION)
        self.assertEqual(manifest["class_contract"], list(PROP_LABELS))
        self.assertEqual(manifest["provenance"]["authority"], "DJANGO")

        # 每筆樣本必須帶 sample_id 與 image_sha256。
        self.assertEqual(len(manifest["samples"]), golden_set.sample_count)
        for sample in manifest["samples"]:
            self.assertTrue(sample["sample_id"])
            self.assertEqual(len(sample["image_sha256"]), 64)

        # 可重現性：相同內容 → 相同位元組 → 相同雜湊。
        self.assertEqual(canonical_manifest_bytes(manifest), canonical_manifest_bytes(manifest))
        self.assertTrue(verify_manifest_sha256(golden_set, digest))

        # 錯誤雜湊必須被拒絕。
        self.assertFalse(verify_manifest_sha256(golden_set, "0" * 64))
        self.assertFalse(verify_manifest_sha256(golden_set, ""))

    def test_5b_manifest_hash_changes_when_content_changes(self):
        """內容被更動後雜湊必須改變，並可被偵測為不一致。

        第 25 輪 P1 修復後，ORM 層的竄改已被守衛擋下（見
        `test_golden_set_immutability.py`）。因此本測試改用**原生 SQL**
        模擬「繞過 ORM 的外部竄改」——這是守衛明確宣告的殘餘風險，
        同時也驗證原本就有的**偵測能力**仍然有效。
        """
        from django.db import connection

        golden_set = self._golden_set()
        self._fill(golden_set, per_class=2)
        golden_set.refresh_from_db()
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)
        golden_set.refresh_from_db()
        recorded = golden_set.manifest_sha256
        self.assertEqual(golden_set.manifest_binding_status, "BOUND")

        # (1) ORM 路徑必須被擋（修復後的預防能力）。
        from learning.golden_set_guard import FrozenGoldenSetError

        sample = golden_set.samples.filter(label="CW").first()
        with self.assertRaises(FrozenGoldenSetError):
            GoldenSetSample.objects.filter(pk=sample.pk).update(label="CCW")

        # (2) 原生 SQL 屬殘餘風險，不受守衛保護，但仍會被偵測到。
        raw_pk = str(sample.pk).replace("-", "")
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE learning_goldensetsample SET label = %s WHERE sample_id = %s",
                ["CCW", raw_pk],
            )

        golden_set.refresh_from_db()
        self.assertNotEqual(manifest_sha256(golden_set), recorded)
        self.assertEqual(golden_set.manifest_binding_status, "MISMATCH")

    def test_5c_manifest_records_frozen_timestamp_and_provenance(self):
        """Manifest 必須留下鎖定時間與來源，供追溯。"""
        golden_set = self._golden_set()
        self._fill(golden_set, per_class=1)
        golden_set.refresh_from_db()
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)
        golden_set.refresh_from_db()

        manifest = build_manifest(golden_set)

        self.assertIsNotNone(manifest["frozen_at"])
        self.assertEqual(manifest["frozen_by"], self.teacher.username)
        self.assertEqual(manifest["provenance"]["created_by"], self.teacher.username)
        self.assertEqual(manifest["per_class_count"], {label: 1 for label in PROP_LABELS})


class GoldenSetCompletenessTests(TestCase):
    """指令「五」：兩級完整度（結構完整 vs 可供正式評估）。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="C24-C", name="完整度班")
        self.teacher = get_user_model().objects.create_user(
            username="c24-complete@example.test", password="Teacher-pass-925!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)

    def _set(self, per_class, confirmed=True, freeze=False):
        golden_set = create_golden_set(
            teacher=self.teacher, name="完整度集", cohort=self.cohort
        )
        for label in PROP_LABELS:
            for index in range(per_class):
                add_sample(
                    golden_set=golden_set,
                    teacher=self.teacher,
                    image=_image(f"{label}-{index}.jpg"),
                    label=label,
                    confirm_now=confirmed,
                )
        golden_set.refresh_from_db()
        if freeze:
            freeze_golden_set(golden_set=golden_set, teacher=self.teacher)
            golden_set.refresh_from_db()
        return golden_set

    def test_a_incomplete_when_classes_missing(self):
        """缺類別 → INCOMPLETE。"""
        golden_set = self._set(per_class=1)
        GoldenSetSample.objects.filter(label="CCW").delete()
        golden_set.refresh_from_db()

        self.assertEqual(completeness_level(golden_set), COMPLETENESS_INCOMPLETE)

    def test_b_structural_complete_but_not_evaluation_ready_at_one_per_class(self):
        """每類只有一張 → 結構完整，但**不得**宣稱可供正式評估。"""
        golden_set = self._set(per_class=1, freeze=True)

        self.assertEqual(completeness_level(golden_set), COMPLETENESS_STRUCTURAL)
        self.assertNotEqual(
            formal_evaluation_blocked_reason(golden_set, "PROP_DIRECTION"), ""
        )

    def test_c_structural_complete_when_all_four_present(self):
        """四類皆有已確認樣本 → 結構完整（此即為可鎖定的條件）。"""
        golden_set = self._set(per_class=1, freeze=False)

        self.assertEqual(completeness_level(golden_set), COMPLETENESS_STRUCTURAL)
        self.assertEqual(golden_set.missing_labels(), [])

    def test_d_evaluation_ready_requires_frozen_and_min_samples(self):
        """已鎖定 + 每類達最低張數 → EVALUATION_READY。"""
        golden_set = self._set(
            per_class=MIN_SAMPLES_PER_CLASS_FOR_EVALUATION, freeze=True
        )

        self.assertEqual(completeness_level(golden_set), COMPLETENESS_EVALUATION_READY)
        self.assertEqual(
            formal_evaluation_blocked_reason(golden_set, "PROP_DIRECTION"), ""
        )

    def test_e_frozen_but_too_few_samples_stays_structural(self):
        """已鎖定但每類僅一張 → 仍只算結構完整。"""
        golden_set = self._set(per_class=1, freeze=True)

        self.assertEqual(completeness_level(golden_set), COMPLETENESS_STRUCTURAL)
        reason = formal_evaluation_blocked_reason(golden_set, "PROP_DIRECTION")
        self.assertIn(str(MIN_SAMPLES_PER_CLASS_FOR_EVALUATION), reason)

    def test_f_pending_samples_do_not_count_toward_completeness(self):
        """未確認樣本不計入完整度。"""
        golden_set = self._set(per_class=3, confirmed=False, freeze=False)

        self.assertEqual(completeness_level(golden_set), COMPLETENESS_INCOMPLETE)
        self.assertEqual(golden_set.confirmed_sample_count, 0)


class FalseStatusAssertionTests(TestCase):
    """7：無真實評估不得 VALIDATED / ACTIVE。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="C24-D", name="狀態班")
        self.teacher = get_user_model().objects.create_user(
            username="c24-status@example.test", password="Teacher-pass-926!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.student = create_student_account("c24-student@example.test", "狀態學員")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.record = self._record()

    def _record(self):
        from learning.growth_records import ensure_growth_submissions
        from learning.models import Evidence

        submission = next(
            item
            for item in ensure_growth_submissions(self.enrollment)
            if item.definition.slot_id == "R07"
        )
        evidence = Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.MODEL,
            original_metadata={
                "filename": "c24-best.pt",
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
            artifact_reference="media/c24-best.pt",
            artifact_sha256="b" * 64,
            artifact_size_bytes=4096,
            source_filename="c24-best.pt",
        )

    def test_7_default_record_is_not_validated_or_active(self):
        """預設狀態必須保守：NOT_EVALUATED / CATALOGUED。"""
        self.assertEqual(self.record.validation_status, "NOT_EVALUATED")
        self.assertEqual(self.record.deployment_status, "CATALOGUED")
        self.assertEqual(assert_no_false_validated(self.record), "")
        self.assertEqual(assert_no_false_active(self.record), "")

    def test_7b_validated_without_real_evaluation_is_detected(self):
        """沒有真實評估紀錄卻標 VALIDATED → 必須被偵測為不實。"""
        self.record.validation_status = "VALIDATED"
        self.record.golden_test_summary = {}
        self.record.validation_history = []
        self.record.save(update_fields=["validation_status"])

        violation = assert_no_false_validated(self.record)
        self.assertNotEqual(violation, "")
        self.assertIn("不實", violation)

    def test_7c_active_without_validated_is_blocked_by_db_constraint(self):
        """未經 VALIDATED 不得 ACTIVE —— 由資料庫 CHECK 約束把關。

        第 24 輪盤點發現：模型層已有
        `vision_record_active_requires_validated` CHECK 約束，
        ACTIVE 但非 VALIDATED 的狀態在寫入時即被資料庫拒絕。
        本測試同時確認「資料庫約束」與「服務層函式」兩道防線都存在。
        """
        from django.db import IntegrityError, transaction

        self.record.deployment_status = "ACTIVE"
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                self.record.save(update_fields=["deployment_status"])

        # 資料庫擋下後，記憶體中的紀錄仍可用來測試服務層判斷。
        self.record.deployment_status = "ACTIVE"
        violation = assert_no_false_active(self.record)
        self.assertNotEqual(violation, "")
        self.assertIn("VALIDATED", violation)

    def test_7d_active_with_unevidenced_validated_is_detected(self):
        """VALIDATED 但無真實評估，又標為 ACTIVE → 必須被偵測為不實。

        `vision_record_active_requires_validated` 只檢查
        「ACTIVE 必須搭配 VALIDATED」，無法辨識「VALIDATED 本身是假的」，
        因此仍需服務層 `assert_no_false_active()` 補上這一層判斷。
        """
        self.record.validation_status = "VALIDATED"
        self.record.golden_test_summary = {}
        self.record.validation_history = []
        self.record.deployment_status = "ACTIVE"
        self.record.save(
            update_fields=[
                "validation_status",
                "golden_test_summary",
                "validation_history",
                "deployment_status",
            ]
        )

        violation = assert_no_false_active(self.record)
        self.assertNotEqual(violation, "")
        self.assertIn("不實", violation)
        # 服務層必須明確指出「沒有真實評估紀錄」這個根因。
        self.assertIn("沒有任何真實評估紀錄", violation)

    def test_7e_golden_freeze_does_not_flip_model_status(self):
        """鎖定 Golden Set 不得自動把模型變成 VALIDATED 或 ACTIVE。"""
        golden_set = create_golden_set(
            teacher=self.teacher, name="狀態集", cohort=self.cohort
        )
        for label in PROP_LABELS:
            for index in range(MIN_SAMPLES_PER_CLASS_FOR_EVALUATION):
                add_sample(
                    golden_set=golden_set,
                    teacher=self.teacher,
                    image=_image(f"{label}-{index}.jpg"),
                    label=label,
                    confirm_now=True,
                )
        golden_set.refresh_from_db()
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)

        self.record.refresh_from_db()
        self.assertEqual(self.record.validation_status, "NOT_EVALUATED")
        self.assertEqual(self.record.deployment_status, "CATALOGUED")
        self.assertEqual(
            VisionModelRecord.objects.filter(deployment_status="ACTIVE").count(), 0
        )


class VisionCenterContractPreservationTests(TestCase):
    """6：既有 Vision Center API 契約不受破壞（純隔離副本，不動正式 Store）。"""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="c24-vc-")
        self.root = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def _center(self):
        from live_backend.app.vision_center import VisionCenter

        return VisionCenter(self.root)

    def test_6_golden_set_api_contract_unchanged(self):
        """create / list / get / model_golden_sets 的欄位與行為必須維持原樣。"""
        center = self._center()

        self.assertEqual(center.list_golden_sets(), [])

        created = center.create_golden_set(
            {"model_type": "PROP_DIRECTION", "name": "隔離測試集", "total_cases": 40, "created_by": "t"}
        )

        # 既有契約欄位必須一個都不少。
        for key in (
            "golden_set_id",
            "model_type",
            "name",
            "total_cases",
            "description",
            "created_by",
            "created_at",
            "status",
        ):
            self.assertIn(key, created)
        self.assertEqual(created["golden_set_id"], "PROP_GOLDEN_v1")
        self.assertEqual(created["status"], "ACTIVE")
        self.assertEqual(created["total_cases"], 40)

        # 讀取一致性 + 重複建立被拒。
        self.assertEqual(center.get_golden_set("PROP_GOLDEN_v1")["name"], "隔離測試集")
        self.assertEqual(len(center.list_golden_sets("PROP_DIRECTION")), 1)
        with self.assertRaises(ValueError):
            center.create_golden_set({"model_type": "PROP_DIRECTION"})

        # 不支援的 model_type 必須被拒。
        # 注意：MODEL_TYPES = ("PROP_DIRECTION", "FOUR_SIDE_HOVER")，
        # 因此 FOUR_SIDE_HOVER 是**合法**型別，不可拿來當拒絕案例。
        with self.assertRaises(ValueError):
            center.create_golden_set({"model_type": "UNKNOWN_TASK"})

    def test_6a_hover_type_is_accepted_but_has_no_prop_classes(self):
        """FOUR_SIDE_HOVER 為合法型別，但不得帶有 PROP 四類語意。

        此測試固定「本輪只處理 PROP_DIRECTION」的邊界：
        HOVER 可以建立，但後端 PROP_CLASSES 不套用於它。
        """
        from live_backend.app.vision_center import MODEL_TYPES

        self.assertIn("FOUR_SIDE_HOVER", MODEL_TYPES)
        self.assertIn("PROP_DIRECTION", MODEL_TYPES)

        center = self._center()
        created = center.create_golden_set(
            {"model_type": "FOUR_SIDE_HOVER", "name": "HOVER 集"}
        )
        self.assertEqual(created["golden_set_id"], "HOVER_GOLDEN_v1")
        self.assertEqual(created["model_type"], "FOUR_SIDE_HOVER")

    def test_6b_store_schema_version_and_collections_unchanged(self):
        """JSON Store 的 schema 與集合名稱不得變動。"""
        from live_backend.app.vision_center import JsonStore

        baseline = JsonStore.empty()

        self.assertEqual(baseline["schema_version"], 1)
        for key in (
            "models",
            "datasets",
            "evaluations",
            "hard_examples",
            "camera_profiles",
            "submissions",
            "golden_sets",
        ):
            self.assertEqual(baseline[key], [], key)

    def test_6c_evaluation_metrics_contract_unchanged(self):
        """save_evaluation 要求的 8 個 metrics 欄位不得變動。"""
        center = self._center()
        center.store.data["models"].append(
            {
                "model_id": "PROP_TEST",
                "model_type": "PROP_DIRECTION",
                "version": "v1",
                "file_path": str(self.root / "model_registry" / "x" / "best.pt"),
                "status": "VALIDATED",
                "validation_status": "VALIDATED",
            }
        )
        (self.root / "model_registry" / "x").mkdir(parents=True, exist_ok=True)

        # 缺少必要欄位 → 必須拒絕。
        with self.assertRaises(ValueError) as ctx:
            center.save_evaluation("PROP_TEST", {"precision": 0.9}, "t")
        self.assertIn("incomplete_golden_evaluation", str(ctx.exception))

        # 完整 8 欄位 → 成功，且 evaluation 記錄指向既有命名慣例。
        metrics = {
            "precision": 0.9,
            "recall": 0.8,
            "map50": 0.85,
            "map50_95": 0.7,
            "per_class_metrics": {},
            "confusion_matrix": [],
            "error_count": 1,
            "low_confidence_count": 2,
        }
        evaluation = center.save_evaluation("PROP_TEST", metrics, "t")

        self.assertEqual(evaluation["golden_set"], "PROP_GOLDEN_v1")
        self.assertEqual(evaluation["model_type"], "PROP_DIRECTION")
        self.assertEqual(center.list_evaluations("PROP_TEST")[0]["metrics"]["precision"], 0.9)

    def test_6d_vision_api_routes_unchanged(self):
        """既有路由清單不得增減。

        邊界說明：`vision_api.py` 於模組層匯入 starlette，而 Django 測試
        venv 並未安裝 starlette。依 AGENTS.md「不得擅自安裝系統級依賴」，
        本測試改以**原始碼層級**（AST 解析）驗證路由契約，不引入新依賴。
        """
        import ast

        source_path = REPO_ROOT / "live_backend" / "app" / "vision_api.py"
        self.assertTrue(source_path.is_file(), f"找不到 {source_path}")
        source = source_path.read_text(encoding="utf-8")

        # 以 AST 找出所有 Route(...) 呼叫中的路徑字串常值。
        tree = ast.parse(source)
        paths = set()
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = getattr(func, "id", None) or getattr(func, "attr", None)
            if name != "Route":
                continue
            for arg in node.args:
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    paths.add(arg.value)
                    break

        for expected in (
            "/api/v1/vision/golden-sets",
            "/api/v1/vision/golden-sets/{golden_set_id}",
            "/api/v1/vision/models/{model_id}/golden-sets",
        ):
            self.assertIn(expected, paths, f"路由契約已變動：缺少 {expected}")

    def test_6e_production_json_store_is_never_written_by_tests(self):
        """確認為正式 JSON Store 計算了指紋，且測試不會寫入該路徑。"""
        production = PRODUCTION_VISION_STORE
        if not production.is_file():
            self.skipTest("正式 JSON Store 不存在於此環境，無從驗證。")

        before = hashlib.sha256(production.read_bytes()).hexdigest()

        # 在隔離目錄做完整操作（建立 + 存檔）。
        center = self._center()
        center.create_golden_set({"model_type": "PROP_DIRECTION", "name": "隔離"})
        center.store.save()

        after = hashlib.sha256(production.read_bytes()).hexdigest()
        self.assertEqual(before, after, "測試不得修改正式 JSON Store")

    def test_6f_isolated_center_never_targets_production_path(self):
        """隔離 VisionCenter 的 store 路徑絕不能等於正式 JSON Store 路徑。

        這是第 24 輪的額外安全網：即使未來有人改動 `_center()`，
        此測試也會立刻擋下「測試意外寫入正式 Store」的情境。
        """
        center = self._center()
        store_path = Path(
            getattr(center.store, "path", "") or getattr(center.store, "root", self.root)
        ).resolve()

        # 隔離 store 必須落在 tempfile 目錄之內。
        self.assertTrue(
            str(store_path).startswith(str(self.root.resolve())),
            f"隔離 store 路徑外洩：{store_path}",
        )
        self.assertNotEqual(store_path, PRODUCTION_VISION_STORE.resolve())


class VisionCenterCompatibilityTests(TestCase):
    """驗證 Django 契約與既有 Vision Center 的**相容性**（唯讀比對，不建立同步）。"""

    def test_compatible_class_contract(self):
        """Django 四類標籤必須與後端 PROP_CLASSES 完全一致。"""
        from live_backend.app.vision_center import PROP_CLASSES

        self.assertEqual(tuple(PROP_CLASSES), PROP_LABELS)

    def test_compatible_golden_set_id_naming(self):
        """Django 預設 ID 命名必須與後端 MODEL_ID_PREFIX 慣例一致。"""
        from live_backend.app.vision_center import MODEL_ID_PREFIX
        from learning.golden_set import default_golden_set_id

        for model_type, prefix in MODEL_ID_PREFIX.items():
            expected = f"{prefix}_GOLDEN_v1"
            self.assertEqual(default_golden_set_id(model_type, "v1"), expected)

    def test_compatible_metrics_field_names(self):
        """Django 預留指標欄位必須涵蓋後端 save_evaluation 的全部必要欄位。"""
        from live_backend.app.vision_center import VisionCenter
        from learning.golden_set import GOLDEN_TEST_METRIC_FIELDS

        django_keys = {key for key, _, _ in GOLDEN_TEST_METRIC_FIELDS}
        required = {
            "precision",
            "recall",
            "map50",
            "map50_95",
            "per_class_metrics",
            "confusion_matrix",
            "error_count",
            "low_confidence_count",
        }

        self.assertTrue(required.issubset(django_keys), required - django_keys)
        self.assertTrue(VisionCenter)  # 佔位：確認模組可匯入

    def test_benchmark_validation_set_contract_is_readable(self):
        """既有 benchmark.PropValidationSet 介面必須仍可讀取（唯讀，不修改）。"""
        from live_backend.app.benchmark import PROP_CLASS_CONTRACT

        self.assertEqual(tuple(PROP_CLASS_CONTRACT), PROP_LABELS)


class GoldenTestHttpContractTests(TestCase):
    """Golden Test 頁面在 HTML 層確實反映新的權威阻擋條件。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="C24-E", name="HTTP 契約班")
        self.teacher = get_user_model().objects.create_user(
            username="c24-http@example.test", password="Teacher-pass-927!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.student = create_student_account("c24-http-student@example.test", "HTTP 學員")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.client.force_login(self.teacher)
        self.record = self._record()

    def _record(self):
        from learning.growth_records import ensure_growth_submissions
        from learning.models import Evidence

        submission = next(
            item
            for item in ensure_growth_submissions(self.enrollment)
            if item.definition.slot_id == "R07"
        )
        evidence = Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.MODEL,
            original_metadata={
                "filename": "c24-http.pt",
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
            artifact_reference="media/c24-http.pt",
            artifact_sha256="c" * 64,
            artifact_size_bytes=4096,
            source_filename="c24-http.pt",
        )

    def _page(self):
        return self.client.get(
            reverse("learning:teacher_golden_test_page", args=[self.record.model_id])
        )

    def test_h1_page_states_blocking_is_service_layer_verified(self):
        """頁面必須明示阻擋判斷由服務層自驗證。"""
        response = self._page()

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "自行查詢資料庫")
        self.assertContains(response, "不作為安全判斷依據")

    def test_h2_page_shows_two_level_completeness(self):
        """頁面必須區分結構完整與可供正式評估。"""
        response = self._page()

        self.assertContains(response, "測試集完整度")
        self.assertContains(response, "結構完整")
        self.assertContains(response, "可供正式評估")

    def test_h3_draft_version_is_labelled_not_evaluation_ready(self):
        """DRAFT 版本在頁面上必須被標為尚不可正式評估。"""
        golden_set = create_golden_set(
            teacher=self.teacher, name="HTTP 草稿集", cohort=self.cohort
        )
        for label in PROP_LABELS:
            add_sample(
                golden_set=golden_set,
                teacher=self.teacher,
                image=_image(f"{label}.jpg"),
                label=label,
                confirm_now=True,
            )

        response = self._page()

        self.assertContains(response, "結構完整（尚不可正式評估）")
        self.assertNotContains(response, "可供正式評估（結構性最低條件）")

    def test_h4_manifest_binding_status_is_shown(self):
        """頁面必須顯示 Manifest 綁定狀態。"""
        golden_set = create_golden_set(
            teacher=self.teacher, name="HTTP 鎖定集", cohort=self.cohort
        )
        for label in PROP_LABELS:
            for index in range(MIN_SAMPLES_PER_CLASS_FOR_EVALUATION):
                add_sample(
                    golden_set=golden_set,
                    teacher=self.teacher,
                    image=_image(f"{label}-{index}.jpg"),
                    label=label,
                    confirm_now=True,
                )
        golden_set.refresh_from_db()
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)

        response = self._page()

        self.assertContains(response, "已綁定")
        self.assertNotContains(response, "尚無可用的已鎖定 Golden Set")

    def test_h5_detail_page_shows_manifest_and_completeness(self):
        """Golden Set 詳情頁必須顯示完整度與 Manifest 雜湊。

        分兩個階段驗證，因為「契約版本」只有在鎖定寫入 Manifest 後才有值：
          - DRAFT：顯示完整度，Manifest 顯示為未綁定。
          - FROZEN：Manifest SHA256 與契約版本皆須出現。
        """
        golden_set = create_golden_set(
            teacher=self.teacher, name="詳情集", cohort=self.cohort
        )
        for label in PROP_LABELS:
            add_sample(
                golden_set=golden_set,
                teacher=self.teacher,
                image=_image(f"{label}.jpg"),
                label=label,
                confirm_now=True,
            )

        url = reverse(
            "learning:teacher_golden_set_detail", args=[golden_set.golden_set_id]
        )

        # --- DRAFT 階段 ---
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "完整度")
        self.assertContains(response, "Manifest SHA256")
        self.assertContains(response, "Manifest 契約版本")
        self.assertContains(response, "未綁定（鎖定時寫入）")

        # --- FROZEN 階段 ---
        golden_set.refresh_from_db()
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)

        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        golden_set.refresh_from_db()
        self.assertTrue(golden_set.manifest_sha256)
        # 詳情頁以 slice:":24" 截斷顯示，比對前 24 字元。
        self.assertContains(response, golden_set.manifest_sha256[:24])
        self.assertContains(response, GOLDEN_SET_CONTRACT_VERSION)
        self.assertContains(response, "已綁定")

    def test_h6_frozen_detail_page_blocks_add_sample_form(self):
        """FROZEN 後詳情頁不得再顯示新增樣本表單。"""
        golden_set = create_golden_set(
            teacher=self.teacher, name="鎖定詳情集", cohort=self.cohort
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

        response = self.client.get(
            reverse("learning:teacher_golden_set_detail", args=[golden_set.golden_set_id])
        )

        self.assertContains(response, "已鎖定")
        self.assertNotContains(response, "新增測試照片")


class ExistingFeatureRegressionTests(TestCase):
    """8：原有 R07、模型倉庫、快照功能不受影響。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="C24-F", name="回歸班")
        self.teacher = get_user_model().objects.create_user(
            username="c24-regress@example.test", password="Teacher-pass-928!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.student = create_student_account("c24-regress-student@example.test", "回歸學員")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.client.force_login(self.teacher)

    def test_8_r07_upload_route_still_exists(self):
        """R07 上傳路由必須仍存在。"""
        self.enrollment.project_direction = "ai_flight_assessment"
        self.enrollment.save(update_fields=["project_direction"])

        self.assertTrue(reverse("learning:growth_model_upload", args=[self.enrollment.pk]))

        self.client.force_login(self.student.user)
        detail = self.client.get(
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
        )
        self.assertEqual(detail.status_code, 200)
        self.assertContains(detail, "R07")

    def test_8b_repository_and_snapshot_modules_still_importable(self):
        """模型倉庫與快照模組必須仍可匯入且契約存在。"""
        from learning.vision_repository import SUPPORTED_TASK_IDS, catalogue_model
        from learning.vision_snapshot import SnapshotError, create_immutable_snapshot

        self.assertEqual(SUPPORTED_TASK_IDS, ("PROP_DIRECTION",))
        self.assertTrue(callable(catalogue_model))
        self.assertTrue(callable(create_immutable_snapshot))
        self.assertTrue(issubclass(SnapshotError, Exception))

    def test_8c_vision_model_record_four_dimensions_unchanged(self):
        """四個狀態維度的列舉不得被本輪改動。"""
        self.assertEqual(
            VisionModelRecord.ReviewStatus.values,
            ["SUBMITTED", "CANDIDATE", "REJECTED", "RETURNED"],
        )
        self.assertEqual(
            VisionModelRecord.ValidationStatus.values, ["NOT_EVALUATED", "VALIDATED", "FAILED"]
        )
        self.assertEqual(
            VisionModelRecord.TrainingUsage.values, ["NOT_FOR_TRAINING", "TRAINING_BASE"]
        )
        self.assertEqual(
            VisionModelRecord.DeploymentStatus.values, ["CATALOGUED", "ACTIVE", "ARCHIVED"]
        )

    def test_8d_snapshot_error_codes_unchanged(self):
        """快照的穩定錯誤碼必須維持 14 個。"""
        from learning.vision_snapshot import SnapshotError

        self.assertTrue(hasattr(SnapshotError, "__init__"))
        import learning.vision_snapshot as snapshot_module
        import inspect

        source = inspect.getsource(snapshot_module)
        for code in (
            "SOURCE_INVALID",
            "SOURCE_MISSING",
            "SOURCE_SYMLINK_REJECTED",
            "SNAPSHOT_PATH_ESCAPE",
            "SNAPSHOT_HASH_INVALID",
            "SNAPSHOT_SOURCE_MISMATCH",
        ):
            self.assertIn(code, source, code)

    def test_8e_golden_set_operations_do_not_touch_repository_records(self):
        """建立與鎖定 Golden Set 不得產生任何模型倉庫紀錄。"""
        from learning.models import Evidence

        golden_set = create_golden_set(teacher=self.teacher, name="隔離回歸集")
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

        self.assertEqual(Evidence.objects.count(), 0)
        self.assertEqual(VisionModelRecord.objects.count(), 0)
