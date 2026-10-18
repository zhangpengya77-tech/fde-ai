"""教師收藏模型至倉庫的驗收入庫測試（PROP_DIRECTION_V1）。

覆蓋 2026-10-08 指令「五、測試與驗收」的九項：
1. 教師正常入庫
2. 無權限教師被拒絕
3. 學員不可入庫
4. 重複入庫被阻擋
5. SHA256 不符被阻擋
6. DEMO_TEST_ONLY 不可作為正式訓練基底
7. Parent Model 不合法被阻擋
8. 未經 Golden Test 不可 ACTIVE
9. 原有 R07 與 Candidate / Return 不受影響

注意：本檔不載入、不反序列化任何 .pt；不執行推論；不執行正式 migration。
"""

import hashlib

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.test import Client, TestCase
from django.urls import reverse

from learning.growth_records import ensure_growth_submissions
from learning.models import (
    Cohort,
    Enrollment,
    Evidence,
    StudentProfile,
    TeacherCohortAccess,
    VisionModelRecord,
)
from learning.tests.helpers import create_student_account, enroll_student
from learning.vision_repository import (
    IntakeError,
    catalogue_model,
    check_intake_eligibility,
    hash_evidence_artifact,
)


class TeacherCatalogueAcceptanceTests(TestCase):
    """教師收藏入庫的完整驗收。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="CT-A", name="入庫班 A")
        self.other_cohort = Cohort.objects.create(cohort_id="CT-B", name="入庫班 B")
        self.student = create_student_account("ct-a@example.test", "入庫學員 A")
        self.other_student = create_student_account("ct-b@example.test", "入庫學員 B")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.other_enrollment = enroll_student(self.other_student, self.other_cohort)

        self.teacher = get_user_model().objects.create_user(
            username="ct-teacher@example.test", password="Teacher-pass-902!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.client.force_login(self.teacher)

    def _evidence(self, enrollment, filename="best-ct.pt", content=b"model-bytes", sha256=None):
        """建立帶真實檔案的 R07 模型證據。"""
        submission = next(
            item for item in ensure_growth_submissions(enrollment)
            if item.definition.slot_id == "R07"
        )
        metadata = {
            "filename": filename,
            "size_bytes": len(content),
            "task_type": "PROP_DIRECTION",
            "evidence_type": "YOLO_MODEL",
        }
        if sha256 is not None:
            metadata["sha256"] = sha256
        evidence = Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.MODEL,
            original_metadata=metadata,
            processed_metadata={"submission_status": "SUBMITTED"},
        )
        evidence.upload.save(filename, ContentFile(content), save=True)
        return evidence

    def _to_candidate(self, evidence):
        return self.client.post(
            reverse("learning:teacher_vision_model_review", args=[evidence.pk]),
            {
                "action": "candidate",
                "note": "列為候選。",
                "rule_template_id": "PROP_DIRECTION_V1",
            },
        )

    # ---------- 1. 教師正常入庫 ----------

    def test_1_teacher_catalogues_model_successfully(self):
        """教師可將候選模型收藏入庫，且狀態為保守預設。"""
        evidence = self._evidence(self.enrollment)
        self._to_candidate(evidence)

        response = self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        self.assertEqual(response.status_code, 302)
        record = VisionModelRecord.objects.get(evidence=evidence)
        # 入庫前提為教師已列候選，審核維度須沿用 Evidence 真實審核結果。
        self.assertEqual(record.review_status, "CANDIDATE")
        self.assertEqual(record.validation_status, "NOT_EVALUATED")
        self.assertEqual(record.training_usage, "NOT_FOR_TRAINING")
        self.assertEqual(record.deployment_status, "CATALOGUED")
        self.assertEqual(record.cohort_id, self.cohort.pk)
        self.assertEqual(record.student_id, self.student.pk)
        self.assertEqual(record.task_id, "PROP_DIRECTION")

    def test_1e_review_status_matches_evidence_review(self):
        """入庫後審核維度必須等於 Evidence 的審核結果，不得退成 SUBMITTED。"""
        evidence = self._evidence(self.enrollment, filename="review-sync.pt")
        self._to_candidate(evidence)
        evidence.refresh_from_db()
        evidence_review = evidence.processed_metadata["vision_model_review"]["status"]

        self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        record = VisionModelRecord.objects.get(evidence=evidence)
        self.assertEqual(record.review_status, evidence_review)
        self.assertEqual(record.review_status, "CANDIDATE")
        # 入庫不得把未驗證模型誤判為可啟用。
        self.assertNotEqual(record.deployment_status, "ACTIVE")
        self.assertEqual(record.active_blocked_reason(), "未通過 Golden Test 驗證，不可啟用 ACTIVE。")

    def test_1b_catalogue_preserves_original_evidence(self):
        """入庫必須保留原始 Evidence，不得改寫。"""
        evidence = self._evidence(self.enrollment)
        self._to_candidate(evidence)
        evidence.refresh_from_db()
        before_metadata = dict(evidence.processed_metadata)
        before_upload = evidence.upload.name

        self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        evidence.refresh_from_db()
        self.assertEqual(evidence.processed_metadata, before_metadata)
        self.assertEqual(evidence.upload.name, before_upload)
        self.assertTrue(Evidence.objects.filter(pk=evidence.pk).exists())

    def test_1c_catalogue_records_sha256_and_version(self):
        """入庫必須保存 SHA256、版本與來源資訊。"""
        content = b"catalogue-payload"
        evidence = self._evidence(self.enrollment, content=content)
        self._to_candidate(evidence)

        self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        record = VisionModelRecord.objects.get(evidence=evidence)
        self.assertEqual(record.artifact_sha256, hashlib.sha256(content).hexdigest())
        self.assertEqual(record.model_version, "V1")
        self.assertTrue(record.artifact_reference)

    def test_1d_catalogue_requires_candidate_status(self):
        """未列為候選的模型不得入庫。"""
        evidence = self._evidence(self.enrollment)

        response = self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        self.assertEqual(response.status_code, 302)
        self.assertFalse(VisionModelRecord.objects.filter(evidence=evidence).exists())

    # ---------- 2. 無權限教師被拒絕 ----------

    def test_2_unauthorized_teacher_cannot_catalogue(self):
        """無班級授權的教師不得入庫他班模型。"""
        evidence = self._evidence(self.other_enrollment)
        outsider = get_user_model().objects.create_user(
            username="ct-outsider@example.test", password="Teacher-pass-902!", is_staff=True
        )
        self.client.force_login(outsider)

        response = self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        self.assertEqual(response.status_code, 404)
        self.assertFalse(VisionModelRecord.objects.filter(evidence=evidence).exists())

    def test_2b_intake_check_reports_unauthorized_cohort(self):
        """服務層檢查必須以 COHORT_NOT_AUTHORIZED 拒絕。"""
        evidence = self._evidence(self.other_enrollment)
        outsider = get_user_model().objects.create_user(
            username="ct-outsider2@example.test", password="Teacher-pass-902!", is_staff=True
        )

        with self.assertRaises(IntakeError) as ctx:
            check_intake_eligibility(evidence=evidence, teacher=outsider)

        self.assertEqual(ctx.exception.code, "COHORT_NOT_AUTHORIZED")

    # ---------- 3. 學員不可入庫 ----------

    def test_3_student_cannot_catalogue(self):
        """學員不得呼叫入庫路由。"""
        evidence = self._evidence(self.enrollment)
        self.client.force_login(self.student.user)

        response = self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        self.assertIn(response.status_code, (302, 403))
        self.assertFalse(VisionModelRecord.objects.filter(evidence=evidence).exists())

    # ---------- 4. 重複入庫被阻擋 ----------

    def test_4_duplicate_catalogue_is_blocked(self):
        """同一模型不得重複入庫。"""
        evidence = self._evidence(self.enrollment)
        self._to_candidate(evidence)
        url = reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk])
        self.client.post(url, {"model_version": "V1"})

        self.client.post(url, {"model_version": "V1"})

        self.assertEqual(VisionModelRecord.objects.filter(evidence=evidence).count(), 1)

    def test_4b_intake_check_reports_already_catalogued(self):
        """服務層檢查必須以 ALREADY_CATALOGUED 拒絕重複入庫。"""
        evidence = self._evidence(self.enrollment)
        catalogue_model(evidence=evidence, teacher=self.teacher)

        with self.assertRaises(IntakeError) as ctx:
            check_intake_eligibility(evidence=evidence, teacher=self.teacher)

        self.assertEqual(ctx.exception.code, "ALREADY_CATALOGUED")

    # ---------- 5. SHA256 不符被阻擋 ----------

    def test_5_sha256_mismatch_is_blocked(self):
        """提交紀錄的 SHA256 與實際檔案不符時必須拒絕入庫。"""
        evidence = self._evidence(self.enrollment, sha256="f" * 64)
        self._to_candidate(evidence)

        response = self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        self.assertEqual(response.status_code, 302)
        self.assertFalse(VisionModelRecord.objects.filter(evidence=evidence).exists())

    def test_5b_intake_check_reports_sha256_mismatch(self):
        """服務層檢查必須以 SHA256_MISMATCH 拒絕。"""
        evidence = self._evidence(self.enrollment, sha256="a" * 64)

        with self.assertRaises(IntakeError) as ctx:
            check_intake_eligibility(evidence=evidence, teacher=self.teacher)

        self.assertEqual(ctx.exception.code, "SHA256_MISMATCH")

    def test_5c_matching_sha256_is_accepted(self):
        """SHA256 相符時必須允許入庫。"""
        content = b"consistent-payload"
        evidence = self._evidence(
            self.enrollment, content=content, sha256=hashlib.sha256(content).hexdigest()
        )

        digest = check_intake_eligibility(evidence=evidence, teacher=self.teacher)

        self.assertEqual(digest, hashlib.sha256(content).hexdigest())

    def test_5d_missing_artifact_is_blocked(self):
        """best.pt 不存在時必須拒絕入庫。"""
        submission = next(
            item for item in ensure_growth_submissions(self.enrollment)
            if item.definition.slot_id == "R07"
        )
        evidence = Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.MODEL,
            original_metadata={"filename": "ghost.pt", "task_type": "PROP_DIRECTION"},
        )

        with self.assertRaises(IntakeError) as ctx:
            check_intake_eligibility(evidence=evidence, teacher=self.teacher)

        self.assertEqual(ctx.exception.code, "ARTIFACT_MISSING")

    def test_5e_hash_does_not_load_or_deserialize_pt(self):
        """雜湊計算必須以純位元組方式處理，不反序列化檔案。"""
        content = b"\x80\x04pickle-like-bytes\x00\xff"
        evidence = self._evidence(self.enrollment, content=content, sha256=None)

        digest = check_intake_eligibility(evidence=evidence, teacher=self.teacher)

        self.assertEqual(digest, hashlib.sha256(content).hexdigest())

    # ---------- 6. DEMO_TEST_ONLY ----------

    def test_6_demo_model_cannot_be_training_base(self):
        """DEMO_TEST_ONLY 入庫後不得成為正式訓練基底。"""
        evidence = self._evidence(self.enrollment, filename="FDE_R07_DEMO_TEST_ONLY_best.pt")
        self._to_candidate(evidence)

        self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        record = VisionModelRecord.objects.get(evidence=evidence)
        self.assertTrue(record.is_demo_test_only)
        self.assertEqual(record.training_usage, "NOT_FOR_TRAINING")
        self.assertFalse(record.is_publishable)
        self.assertIn("DEMO_TEST_ONLY", record.active_blocked_reason())

    # ---------- 7. Parent Model 不合法 ----------

    def test_7_v2_without_parent_is_blocked(self):
        """V2 未指定父版本時必須拒絕入庫。"""
        evidence = self._evidence(self.enrollment)
        self._to_candidate(evidence)

        self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V2"},
        )

        self.assertFalse(VisionModelRecord.objects.filter(evidence=evidence).exists())

    def test_7b_cross_cohort_parent_is_blocked(self):
        """父版本屬於其他班級時必須拒絕（不得跨班級發布）。"""
        # 為建立其他班級的 V1，先暫時授予該班級權限（模擬教師同時帶兩班）。
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.other_cohort)
        other_evidence = self._evidence(self.other_enrollment, filename="other-v1.pt")
        other_record = catalogue_model(evidence=other_evidence, teacher=self.teacher)
        TeacherCohortAccess.objects.filter(
            teacher=self.teacher, cohort=self.other_cohort
        ).delete()

        evidence = self._evidence(self.enrollment, filename="mine-v2.pt")
        self._to_candidate(evidence)

        self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V2", "parent_record_id": str(other_record.pk)},
        )

        self.assertFalse(VisionModelRecord.objects.filter(evidence=evidence).exists())

    def test_7c_valid_v2_lineage_is_accepted(self):
        """同班級且合法的父版本必須允許建立 V2。"""
        v1_evidence = self._evidence(self.enrollment, filename="v1.pt")
        v1 = catalogue_model(evidence=v1_evidence, teacher=self.teacher)

        v2_evidence = self._evidence(self.enrollment, filename="v2.pt")
        v2 = catalogue_model(
            evidence=v2_evidence, teacher=self.teacher, model_version="V2", parent_record=v1
        )

        self.assertEqual(v2.parent_record_id, v1.pk)
        self.assertEqual(v2.lineage_root_id, v1.pk)

    def test_7d_intake_check_reports_parent_required(self):
        """服務層檢查必須以 PARENT_REQUIRED 拒絕缺父版本的 V2。"""
        evidence = self._evidence(self.enrollment)

        with self.assertRaises(IntakeError) as ctx:
            check_intake_eligibility(evidence=evidence, teacher=self.teacher, model_version="V2")

        self.assertEqual(ctx.exception.code, "PARENT_REQUIRED")

    # ---------- 8. 未經 Golden Test 不可 ACTIVE ----------

    def test_8_catalogued_model_cannot_be_active(self):
        """入庫後未驗證仍不可 ACTIVE。"""
        evidence = self._evidence(self.enrollment)
        self._to_candidate(evidence)
        self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        record = VisionModelRecord.objects.get(evidence=evidence)
        self.assertEqual(
            record.active_blocked_reason(), "未通過 Golden Test 驗證，不可啟用 ACTIVE。"
        )
        self.assertEqual(record.golden_test_summary, {})

    def test_8b_catalogue_is_not_validated(self):
        """入庫不得等同 VALIDATED。"""
        evidence = self._evidence(self.enrollment)
        self._to_candidate(evidence)
        self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        record = VisionModelRecord.objects.get(evidence=evidence)
        self.assertNotEqual(record.validation_status, "VALIDATED")
        self.assertNotEqual(record.deployment_status, "ACTIVE")

    # ---------- 9. 原有流程不受影響 ----------

    def test_9_candidate_and_return_still_work_after_catalogue(self):
        """入庫後 Candidate / Return 流程仍可運作。"""
        evidence = self._evidence(self.enrollment)
        self._to_candidate(evidence)
        self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        response = self.client.post(
            reverse("learning:teacher_vision_model_review", args=[evidence.pk]),
            {
                "action": "return",
                "note": "補件。",
                "rule_template_id": "PROP_DIRECTION_V1",
            },
        )

        self.assertEqual(response.status_code, 302)
        evidence.refresh_from_db()
        self.assertEqual(
            evidence.processed_metadata["vision_model_review"]["status"], "RETURNED"
        )

    def test_9b_r07_upload_route_unchanged(self):
        """既有 R07 上傳路由必須保留。"""
        url = reverse("learning:growth_model_upload", args=[self.enrollment.pk])
        self.assertTrue(url.endswith("/growth/R07/model/"))

    def test_9c_student_r07_page_still_opens(self):
        """學員 R07 頁面不受入庫功能影響。"""
        self.client.force_login(self.student.user)

        response = self.client.get(
            reverse("learning:growth_record_detail", args=[self.enrollment.pk, "R07"])
        )

        self.assertEqual(response.status_code, 200)

    # ---------- 倉庫清單可讀 ----------

    def test_repository_list_shows_catalogued_model(self):
        """入庫後教師可在飛輪倉庫清單看到該模型。"""
        evidence = self._evidence(self.enrollment, filename="visible-in-repo.pt")
        self._to_candidate(evidence)
        self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        response = self.client.get(reverse("learning:teacher_vision_flywheel"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "已入庫模型（1）")
        self.assertContains(response, "入庫學員 A")
        self.assertContains(response, "V1")

    def test_repository_list_excludes_other_cohort_records(self):
        """倉庫清單不得顯示未授權班級的已入庫模型。"""
        # 先以另一班教師身分入庫，再切回本班教師查看清單。
        other_teacher = get_user_model().objects.create_user(
            username="ct-other-teacher@example.test", password="Teacher-pass-902!", is_staff=True
        )
        TeacherCohortAccess.objects.create(teacher=other_teacher, cohort=self.other_cohort)
        other_evidence = self._evidence(self.other_enrollment, filename="other-cohort.pt")
        catalogue_model(evidence=other_evidence, teacher=other_teacher)

        response = self.client.get(reverse("learning:teacher_vision_flywheel"))

        self.assertContains(response, "已入庫模型（0）")
        self.assertNotContains(response, "入庫學員 B")

    def test_repository_does_not_expose_download_links(self):
        """倉庫清單不得提供學生 best.pt 下載連結。"""
        evidence = self._evidence(self.enrollment)
        catalogue_model(evidence=evidence, teacher=self.teacher)

        response = self.client.get(reverse("learning:teacher_vision_flywheel"))

        self.assertNotContains(
            response, reverse("learning:evidence_download", args=[evidence.pk])
        )

    def test_detail_page_shows_catalogued_state(self):
        """已入庫模型的詳情頁必須顯示入庫狀態，且不再顯示收藏表單。"""
        evidence = self._evidence(self.enrollment)
        self._to_candidate(evidence)
        self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        response = self.client.get(
            reverse("learning:teacher_vision_model_detail", args=[evidence.pk])
        )

        self.assertContains(response, "此模型已入庫，無需重複收藏。")
        self.assertNotContains(response, "收藏至模型倉庫</button>")


class RepositoryDefectRegressionTests(TestCase):
    """本輪端到端驗收發現的三項缺陷之回歸測試。

    缺陷來源（2026-10-08 隔離環境 E2E 驗收）：
        1. 入庫時 review_status 一律退成 SUBMITTED，與 Evidence 真實審核結果不一致。
        2. best.pt 事後遺失時，hash_evidence_artifact 拋出未預期的 ValueError。
        3. V1 誤帶父版本時，先回報 VERSION_DUPLICATE 而非 PARENT_NOT_ALLOWED。
    """

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="2026-61", name="缺陷回歸班")
        self.teacher = get_user_model().objects.create_user(
            username="defect-teacher@example.test",
            password="Teacher-pass-902!",
            is_staff=True,
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)
        self.student = create_student_account("defect-student@example.test", "缺陷回歸學員")
        self.enrollment = enroll_student(self.student, self.cohort)
        Enrollment.objects.filter(pk=self.enrollment.pk).update(
            project_direction="ai_flight_assessment"
        )
        self.enrollment.refresh_from_db()
        self.client = Client()
        self.client.force_login(self.teacher)

    def _evidence(self, filename="defect-best.pt", content=b"defect-model-bytes", sha256=None):
        submission = next(
            item
            for item in ensure_growth_submissions(self.enrollment)
            if item.definition.slot_id == "R07"
        )
        metadata = {
            "filename": filename,
            "size_bytes": len(content),
            "task_type": "PROP_DIRECTION",
            "evidence_type": "YOLO_MODEL",
        }
        if sha256 is not None:
            metadata["sha256"] = sha256
        evidence = Evidence.objects.create(
            growth_submission=submission,
            evidence_type=Evidence.Type.MODEL,
            original_metadata=metadata,
            processed_metadata={"submission_status": "SUBMITTED"},
        )
        evidence.upload.save(filename, ContentFile(content), save=True)
        return evidence

    def _to_candidate(self, evidence):
        return self.client.post(
            reverse("learning:teacher_vision_model_review", args=[evidence.pk]),
            {
                "action": "candidate",
                "note": "列為候選。",
                "rule_template_id": "PROP_DIRECTION_V1",
            },
        )

    def test_defect1_review_status_follows_evidence(self):
        """缺陷 1：入庫後 review_status 必須等於 Evidence 的真實審核結果。"""
        evidence = self._evidence()
        self._to_candidate(evidence)
        evidence.refresh_from_db()
        self.assertEqual(evidence.processed_metadata["vision_model_review"]["status"], "CANDIDATE")

        self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        record = VisionModelRecord.objects.get(evidence=evidence)
        self.assertEqual(record.review_status, "CANDIDATE")
        # 仍不得因此被誤判為可啟用。
        self.assertEqual(record.validation_status, "NOT_EVALUATED")
        self.assertEqual(record.deployment_status, "CATALOGUED")

    def test_defect2_missing_file_raises_intake_error_not_value_error(self):
        """缺陷 2：檔案事後遺失須拋出 IntakeError，不得洩漏 ValueError。"""
        evidence = self._evidence(filename="lost-best.pt", content=b"lost-bytes")

        # 先開啟一次，使 Django FileField 內部狀態進入「無法重新開啟」情境。
        hash_evidence_artifact(evidence)
        storage = evidence.upload.storage
        storage.delete(evidence.upload.name)

        with self.assertRaises(IntakeError) as ctx:
            hash_evidence_artifact(evidence)
        self.assertEqual(ctx.exception.code, "ARTIFACT_MISSING")

    def test_defect2b_missing_file_blocks_catalogue(self):
        """缺陷 2 延伸：檔案遺失時入庫必須被拒，不得產生 500。"""
        evidence = self._evidence(filename="lost2-best.pt", content=b"lost-bytes-2")
        self._to_candidate(evidence)
        evidence.refresh_from_db()
        evidence.upload.storage.delete(evidence.upload.name)

        response = self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.pk]),
            {"model_version": "V1"},
        )

        self.assertEqual(response.status_code, 302)
        self.assertFalse(VisionModelRecord.objects.filter(evidence=evidence).exists())

    def test_defect3_v1_with_parent_reports_parent_not_allowed(self):
        """缺陷 3：V1 帶父版本須回報 PARENT_NOT_ALLOWED，而非 VERSION_DUPLICATE。"""
        parent_evidence = self._evidence(filename="parent-best.pt", content=b"parent-bytes")
        self._to_candidate(parent_evidence)
        self.client.post(
            reverse("learning:teacher_vision_model_catalogue", args=[parent_evidence.pk]),
            {"model_version": "V1"},
        )
        parent = VisionModelRecord.objects.get(evidence=parent_evidence)

        child_evidence = self._evidence(filename="child-best.pt", content=b"child-bytes")
        self._to_candidate(child_evidence)

        with self.assertRaises(IntakeError) as ctx:
            catalogue_model(
                evidence=child_evidence,
                teacher=self.teacher,
                model_version="V1",
                parent_record=parent,
            )
        self.assertEqual(ctx.exception.code, "PARENT_NOT_ALLOWED")

    def test_defect3b_v2_without_parent_still_reports_parent_required(self):
        """缺陷 3 延伸：修正順序後，V2 無父版本仍須回報 PARENT_REQUIRED。"""
        evidence = self._evidence(filename="v2-no-parent.pt", content=b"v2-bytes")
        self._to_candidate(evidence)

        with self.assertRaises(IntakeError) as ctx:
            catalogue_model(evidence=evidence, teacher=self.teacher, model_version="V2")
        self.assertEqual(ctx.exception.code, "PARENT_REQUIRED")
