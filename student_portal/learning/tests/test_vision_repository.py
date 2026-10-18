"""模型倉庫持久化測試（PROP_DIRECTION_V1）。

覆蓋 2026-10-08 指令要求的七項驗證：
1. 教師可查看有權限的模型。
2. 模型入庫資料契約正確。
3. Parent Model 血緣正確。
4. 不同學生及班級資料隔離。
5. DEMO_TEST_ONLY 不可正式發布。
6. 無 Golden Test 不可 ACTIVE。
7. 原有 R07 / Candidate / Return 流程不受影響。

注意：本檔不執行任何推論、不載入任何 .pt、不執行正式 migration。
"""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.urls import reverse

from learning.growth_records import ensure_growth_submissions
from learning.models import Cohort, Evidence, TeacherCohortAccess, VisionModelRecord
from learning.tests.helpers import create_student_account, enroll_student
from learning.vision_repository import (
    compute_sha256,
    is_demo_test_only,
    lineage_of,
    mark_demo_never_training_base,
    records_for_teacher,
    register_model_record,
)


class VisionRepositoryTests(TestCase):
    """模型倉庫資料契約、血緣、隔離與安全規則測試。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="RP-A", name="倉庫班 A")
        self.other_cohort = Cohort.objects.create(cohort_id="RP-B", name="倉庫班 B")
        self.student = create_student_account("rp-a@example.test", "倉庫學員 A")
        self.peer = create_student_account("rp-a2@example.test", "倉庫學員 A2")
        self.other_student = create_student_account("rp-b@example.test", "倉庫學員 B")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.peer_enrollment = enroll_student(self.peer, self.cohort)
        self.other_enrollment = enroll_student(self.other_student, self.other_cohort)

        self.evidence = self._evidence(self.enrollment, "best-a-v1.pt")
        self.peer_evidence = self._evidence(self.peer_enrollment, "best-a2-v1.pt")
        self.other_evidence = self._evidence(self.other_enrollment, "best-b-v1.pt")

        self.teacher = get_user_model().objects.create_user(
            username="rp-teacher@example.test", password="Teacher-pass-902!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.client.force_login(self.teacher)

    @staticmethod
    def _evidence(enrollment, filename):
        submission = next(
            item for item in ensure_growth_submissions(enrollment)
            if item.definition.slot_id == "R07"
        )
        return Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.MODEL,
            original_metadata={
                "filename": filename,
                "size_bytes": 4096,
                "task_type": "PROP_DIRECTION",
                "evidence_type": "YOLO_MODEL",
            },
            processed_metadata={"submission_status": "SUBMITTED"},
        )

    def _register(self, evidence, version="V1", parent=None, filename=None):
        return register_model_record(
            evidence=evidence,
            task_id="PROP_DIRECTION",
            artifact_reference=f"artifacts/{version.lower()}/best.pt",
            artifact_sha256=compute_sha256(f"{version}-payload".encode()),
            artifact_size_bytes=4096,
            model_version=version,
            parent_record=parent,
            source_filename=filename,
        )

    # ---------- 1 & 2. 入庫資料契約 ----------

    def test_register_creates_record_with_conservative_defaults(self):
        """入庫後四個狀態維度必須為保守預設，不得自動進階。"""
        record = self._register(self.evidence)

        self.assertEqual(record.review_status, VisionModelRecord.ReviewStatus.SUBMITTED)
        self.assertEqual(
            record.validation_status, VisionModelRecord.ValidationStatus.NOT_EVALUATED
        )
        self.assertEqual(
            record.training_usage, VisionModelRecord.TrainingUsage.NOT_FOR_TRAINING
        )
        self.assertEqual(
            record.deployment_status, VisionModelRecord.DeploymentStatus.CATALOGUED
        )
        self.assertFalse(record.is_publishable)

    def test_register_copies_source_metadata_and_keeps_evidence_untouched(self):
        """入庫不得複製或改寫既有 R07 提交紀錄。"""
        before_metadata = dict(self.evidence.processed_metadata)
        record = self._register(self.evidence)

        self.evidence.refresh_from_db()
        self.assertEqual(self.evidence.processed_metadata, before_metadata)
        self.assertEqual(record.evidence_id, self.evidence.pk)
        self.assertEqual(record.student_id, self.student.pk)
        self.assertEqual(record.cohort_id, self.cohort.pk)
        self.assertEqual(record.task_id, "PROP_DIRECTION")
        self.assertEqual(record.model_version, "V1")

    def test_register_preserves_artifact_integrity(self):
        """入庫必須保留 SHA256 與檔案參照，供完整性校驗。"""
        record = self._register(self.evidence)

        self.assertEqual(len(record.artifact_sha256), 64)
        self.assertTrue(record.artifact_reference)
        self.assertEqual(record.artifact_size_bytes, 4096)

    def test_register_requires_sha256_and_artifact_reference(self):
        """缺少 SHA256 或檔案參照時必須拒絕入庫。"""
        with self.assertRaises(ValidationError):
            register_model_record(
                evidence=self.evidence,
                task_id="PROP_DIRECTION",
                artifact_reference="",
                artifact_sha256="abc",
            )
        with self.assertRaises(ValidationError):
            register_model_record(
                evidence=self.evidence,
                task_id="PROP_DIRECTION",
                artifact_reference="artifacts/best.pt",
                artifact_sha256="",
            )

    def test_register_rejects_unsupported_task_type(self):
        """本輪僅支援 PROP_DIRECTION，其他任務類型必須拒絕。"""
        with self.assertRaises(ValidationError):
            register_model_record(
                evidence=self.evidence,
                task_id="FOUR_SIDE_HOVER",
                artifact_reference="artifacts/best.pt",
                artifact_sha256="a" * 64,
            )

    def test_register_rejects_duplicate_evidence(self):
        """同一筆證據不得重複入庫。"""
        self._register(self.evidence)

        with self.assertRaises(ValidationError):
            self._register(self.evidence)

    def test_class_mapping_is_empty_by_default_not_guessed(self):
        """類別對應表未提供時必須留空，不得猜測。"""
        record = self._register(self.evidence)

        self.assertEqual(record.class_mapping, [])

    # ---------- 3. 血緣 ----------

    def test_v1_record_points_lineage_root_to_itself(self):
        """V1 版本的血緣起源指向自己，父版本為空。"""
        record = self._register(self.evidence)

        self.assertIsNone(record.parent_record)
        self.assertEqual(record.lineage_root_id, record.pk)

    def test_v2_requires_parent_and_records_lineage(self):
        """V2 必須指定父版本，且血緣鏈可完整追溯。"""
        v1 = self._register(self.evidence)

        v2_evidence = self._evidence(self.enrollment, "best-a-v2.pt")
        v2 = self._register(v2_evidence, version="V2", parent=v1)

        self.assertEqual(v2.parent_record_id, v1.pk)
        self.assertEqual(v2.lineage_root_id, v1.pk)
        self.assertEqual([item.pk for item in lineage_of(v2)], [v1.pk, v2.pk])

    def test_v3_lineage_is_fully_traceable(self):
        """V3 血緣鏈必須可回溯至 V1 起源。"""
        v1 = self._register(self.evidence)
        v2 = self._register(self._evidence(self.enrollment, "v2.pt"), version="V2", parent=v1)
        v3 = self._register(self._evidence(self.enrollment, "v3.pt"), version="V3", parent=v2)

        chain = lineage_of(v3)
        self.assertEqual([item.model_version for item in chain], ["V1", "V2", "V3"])
        self.assertEqual(chain[0].pk, v1.pk)
        self.assertEqual(v3.lineage_root_id, v1.pk)

    def test_v2_without_parent_is_rejected(self):
        """非 V1 版本缺少父版本時必須拒絕。"""
        with self.assertRaises(ValidationError):
            self._register(self.evidence, version="V2", parent=None)

    def test_v1_with_parent_is_rejected(self):
        """V1 版本帶父版本時必須拒絕。"""
        v1 = self._register(self.evidence)
        with self.assertRaises(ValidationError):
            self._register(self._evidence(self.enrollment, "bad.pt"), version="V1", parent=v1)

    def test_parent_from_other_cohort_is_rejected(self):
        """父版本與子版本必須同班，避免跨班級血緣洩漏。"""
        other_v1 = self._register(self.other_evidence)

        with self.assertRaises(ValidationError):
            self._register(self._evidence(self.enrollment, "cross.pt"), version="V2", parent=other_v1)

    # ---------- 4. 班級與學生隔離 ----------

    def test_teacher_only_sees_records_from_authorized_cohort(self):
        """教師只能取得已授權班級的倉庫紀錄。"""
        mine = self._register(self.evidence)
        self._register(self.other_evidence)

        visible = list(records_for_teacher(self.teacher))

        self.assertEqual([item.pk for item in visible], [mine.pk])

    def test_same_cohort_peer_models_do_not_leak_to_student(self):
        """同班另一位學員的模型不得出現在學員端任何頁面。"""
        self._register(self.peer_evidence)

        self.client.force_login(self.student.user)
        response = self.client.get(
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
        )

        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "best-a2-v1.pt")

    def test_teacher_without_cohort_access_sees_no_records(self):
        """未取得任何班級授權的教師不得看到任何紀錄。"""
        self._register(self.evidence)
        outsider = get_user_model().objects.create_user(
            username="rp-outsider@example.test", password="Teacher-pass-902!", is_staff=True
        )

        self.assertEqual(list(records_for_teacher(outsider)), [])

    def test_record_from_other_cohort_not_visible_to_teacher(self):
        """其他班級的紀錄不得計入授權教師的可見範圍。"""
        self._register(self.other_evidence)

        self.assertEqual(list(records_for_teacher(self.teacher)), [])

    # ---------- 5. DEMO_TEST_ONLY ----------

    def test_demo_marker_detected_from_filename(self):
        """檔名含 DEMO_TEST_ONLY 時必須被標記。"""
        self.assertTrue(is_demo_test_only("FDE_R07_DEMO_TEST_ONLY_best.pt"))
        self.assertTrue(is_demo_test_only("demo_test_only.pt"))
        self.assertFalse(is_demo_test_only("best-prod-v1.pt"))

    def test_demo_record_is_flagged_and_not_publishable(self):
        """DEMO 紀錄必須被標記，且不得可發布。"""
        record = self._register(
            self.evidence, filename="FDE_R07_DEMO_TEST_ONLY_best.pt"
        )

        self.assertTrue(record.is_demo_test_only)
        self.assertFalse(record.is_publishable)

    def test_demo_record_cannot_become_training_base(self):
        """DEMO 紀錄不得被標為 TRAINING_BASE（資料庫約束 + 服務層防護）。"""
        record = self._register(
            self.evidence, filename="FDE_R07_DEMO_TEST_ONLY_best.pt"
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                VisionModelRecord.objects.filter(pk=record.pk).update(
                    training_usage=VisionModelRecord.TrainingUsage.TRAINING_BASE
                )

    def test_demo_guard_resets_inconsistent_state(self):
        """若 DEMO 紀錄狀態不一致，防護函式必須強制回正。

        注意：資料庫約束本身即阻擋 DEMO + TRAINING_BASE，
        故以 in-memory 物件模擬「已不一致」的狀態，驗證服務層防護仍有效。
        """
        record = self._register(
            self.evidence, filename="FDE_R07_DEMO_TEST_ONLY_best.pt"
        )
        # 記憶體中模擬不一致狀態，繞過已生效的資料庫約束。
        record.training_usage = VisionModelRecord.TrainingUsage.TRAINING_BASE

        result = mark_demo_never_training_base(record)

        record.refresh_from_db()
        self.assertFalse(result)
        self.assertEqual(
            record.training_usage, VisionModelRecord.TrainingUsage.NOT_FOR_TRAINING
        )

    def test_demo_guard_leaves_consistent_record_untouched(self):
        """狀態一致時防護函式不得改動任何欄位。"""
        record = self._register(
            self.evidence, filename="FDE_R07_DEMO_TEST_ONLY_best.pt"
        )

        result = mark_demo_never_training_base(record)

        self.assertTrue(result)
        record.refresh_from_db()
        self.assertEqual(
            record.training_usage, VisionModelRecord.TrainingUsage.NOT_FOR_TRAINING
        )

    def test_demo_record_active_is_blocked(self):
        """DEMO 紀錄的 ACTIVE 阻擋原因必須明確指向 DEMO 規則。"""
        record = self._register(
            self.evidence, filename="FDE_R07_DEMO_TEST_ONLY_best.pt"
        )

        self.assertIn("DEMO_TEST_ONLY", record.active_blocked_reason())

    # ---------- 6. Golden Test 與 ACTIVE ----------

    def test_active_blocked_without_golden_validation(self):
        """未通過 Golden Test 驗證時不可啟用 ACTIVE。"""
        record = self._register(self.evidence)

        self.assertEqual(
            record.active_blocked_reason(), "未通過 Golden Test 驗證，不可啟用 ACTIVE。"
        )

    def test_active_blocked_when_validated_but_not_candidate(self):
        """已驗證但未列為候選時，仍不可啟用 ACTIVE。"""
        record = self._register(self.evidence)
        VisionModelRecord.objects.filter(pk=record.pk).update(validation_status="VALIDATED")
        record.refresh_from_db()

        self.assertEqual(
            record.active_blocked_reason(), "尚未由教師列為候選，不可啟用 ACTIVE。"
        )

    def test_active_allowed_only_when_validated_and_candidate(self):
        """驗證通過且列為候選時，阻擋原因為空（本輪仍無啟用路徑）。"""
        record = self._register(self.evidence)
        VisionModelRecord.objects.filter(pk=record.pk).update(
            validation_status="VALIDATED", review_status="CANDIDATE"
        )
        record.refresh_from_db()

        self.assertEqual(record.active_blocked_reason(), "")

    def test_active_without_validation_is_rejected_by_database(self):
        """資料庫層必須阻擋未驗證即 ACTIVE。"""
        record = self._register(self.evidence)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                VisionModelRecord.objects.filter(pk=record.pk).update(
                    deployment_status=VisionModelRecord.DeploymentStatus.ACTIVE
                )

    def test_active_not_demo_is_rejected_by_database(self):
        """資料庫層必須阻擋 DEMO 紀錄成為 ACTIVE。"""
        record = self._register(
            self.evidence, filename="FDE_R07_DEMO_TEST_ONLY_best.pt"
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                VisionModelRecord.objects.filter(pk=record.pk).update(
                    validation_status="VALIDATED",
                    deployment_status=VisionModelRecord.DeploymentStatus.ACTIVE,
                )

    def test_golden_test_summary_starts_empty(self):
        """入庫時不得虛構 Golden Test 結果。"""
        record = self._register(self.evidence)

        self.assertEqual(record.golden_test_summary, {})
        self.assertEqual(record.validation_history, [])

    # ---------- 7. 既有流程不受影響 ----------

    def test_candidate_and_return_flow_unchanged_after_registration(self):
        """入庫後既有 Candidate / Return 流程仍可運作。"""
        self._register(self.evidence)

        response = self.client.post(
            reverse("learning:teacher_vision_model_review", args=[self.evidence.pk]),
            {
                "action": "candidate",
                "note": "入庫後列為候選。",
                "rule_template_id": "PROP_DIRECTION_V1",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.evidence.refresh_from_db()
        review = self.evidence.processed_metadata.get("vision_model_review", {})
        self.assertEqual(review.get("status"), "CANDIDATE")

    def test_registration_does_not_write_review_into_evidence(self):
        """入庫不得改寫 Evidence 的審核欄位（避免第二套提交系統）。"""
        before = dict(self.evidence.processed_metadata)
        self._register(self.evidence)

        self.evidence.refresh_from_db()
        self.assertEqual(self.evidence.processed_metadata, before)

    def test_student_r07_upload_route_still_exists(self):
        """既有 R07 上傳路由必須保留。"""
        url = reverse("learning:growth_model_upload", args=[self.enrollment.pk])
        self.assertTrue(url.endswith("/growth/R07/model/"))

    def test_vision_center_pages_still_open_after_registration(self):
        """入庫後教師 Vision 頁面仍可正常開啟。"""
        self._register(self.evidence)

        for name in (
            "teacher_vision_model_list",
            "teacher_vision_flywheel",
        ):
            response = self.client.get(reverse(f"learning:{name}"))
            self.assertEqual(response.status_code, 200)
