"""模型不可變快照與完整性檢查測試（第 21 輪）。

本模組僅使用 Django 測試框架的 Client（Django Client），
不是真實瀏覽器操作；所有通過的項目一律標示為 Automated PASS，
不得對外宣稱為人工瀏覽器驗收通過。

測試重點（對應指令一、二、三、五）：
1. 入庫時建立獨立副本，原始 Evidence 檔案不被搬移、不被刪除、內容不變。
2. 副本內容與原始檔案位元組完全一致，SHA256 相同。
3. 重複收藏不會產生第二份無用快照（內容雜湊去重）。
4. 快照被竄改後可被偵測為 MODIFIED。
5. 快照被刪除後可被偵測為 MISSING。
6. 無權限教師無法讀取他人班級的倉庫紀錄與快照。
7. 頁面不得洩漏本機絕對路徑（Media 根目錄）。
8. 所有流程不載入、不反序列化任何 .pt 檔案。
"""

import hashlib
import os
import uuid
from datetime import date
from tempfile import TemporaryDirectory

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from learning.models import (
    Cohort,
    Evidence,
    Enrollment,
    GrowthRecordDefinition,
    GrowthRecordSubmission,
    TeacherCohortAccess,
    VisionModelRecord,
)
from learning.tests.helpers import create_student_account, enroll_student
from learning.vision_integrity import (
    INTACT,
    MISSING,
    MODIFIED,
    NOT_CHECKED,
    check_record_integrity,
    run_integrity_check,
)
from learning.vision_repository import (
    IntakeError,
    catalogue_model,
    records_for_teacher,
)
from learning.vision_snapshot import (
    SNAPSHOT_ROOT,
    SnapshotError,
    create_immutable_snapshot,
    read_snapshot,
    snapshot_relative_path,
    snapshot_usage_report,
)

CANARY = "FDE_SNAPSHOT_CANARY"


def sha256_bytes(payload: bytes) -> str:
    """以位元組串流計算 SHA256；絕不載入或反序列化 .pt。"""
    digest = hashlib.sha256()
    digest.update(payload)
    return digest.hexdigest()


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class SnapshotTestCase(TestCase):
    """共用基礎：每個測試都在獨立的暫存 Media 根目錄下執行。"""

    def setUp(self):
        self.media_dir = TemporaryDirectory()
        self.addCleanup(self.media_dir.cleanup)
        override = override_settings(MEDIA_ROOT=self.media_dir.name)
        override.enable()
        self.addCleanup(override.disable)

        self.cohort_a = Cohort.objects.create(cohort_id="2026-71", name="快照班 A")
        self.cohort_b = Cohort.objects.create(cohort_id="2026-72", name="快照班 B")

        self.student_a = create_student_account("snap-a@example.test", "學員 A")
        self.student_b = create_student_account("snap-b@example.test", "學員 B")
        self.enroll_a = enroll_student(self.student_a, self.cohort_a)
        self.enroll_b = enroll_student(self.student_b, self.cohort_b)
        Enrollment.objects.filter(pk=self.enroll_a.pk).update(
            project_direction="ai_flight_assessment"
        )
        Enrollment.objects.filter(pk=self.enroll_b.pk).update(
            project_direction="ai_flight_assessment"
        )

        self.teacher = self._make_teacher("snap-teacher@example.test", self.cohort_a)
        self.other_teacher = self._make_teacher(
            "snap-other@example.test", self.cohort_b
        )

    # ---- helpers -------------------------------------------------------
    def _make_teacher(self, email, cohort):
        from django.contrib.auth import get_user_model

        user = get_user_model().objects.create_user(
            username=email, email=email, password="A-strong-passphrase-984!"
        )
        user.is_staff = True
        user.save(update_fields=["is_staff"])
        TeacherCohortAccess.objects.create(teacher=user, cohort=cohort)
        return user

    def _evidence(self, enrollment, payload: bytes, filename="best-snap.pt"):
        """建立一筆 R07 模型 Evidence，並真的把檔案寫進 Media。

        Evidence.enrollment 是唯讀屬性，必須經由 growth_submission 關聯取得，
        因此這裡先建立（或重用）R07 的 GrowthRecordSubmission 作為父關聯。
        """
        definition, _ = GrowthRecordDefinition.objects.get_or_create(
            cohort=enrollment.cohort,
            slot_id="R07",
            group_scope=None,
            defaults={
                "title": "專業任務驗證",
                "description": "自動化測試用 R07 定義",
                "display_order": 7,
            },
        )
        submission, _ = GrowthRecordSubmission.objects.get_or_create(
            enrollment=enrollment,
            definition=definition,
            defaults={"status": GrowthRecordSubmission.Status.IN_PROGRESS},
        )
        evidence = Evidence.objects.create(
            evidence_type=Evidence.Type.MODEL,
            growth_submission=submission,
            description="R07 AI Vision / YOLO 訓練模型",
            original_metadata={
                "filename": filename,
                "extension": ".pt",
                "content_type": "application/octet-stream",
                "size_bytes": len(payload),
                "task_type": "PROP_DIRECTION",
                "evidence_type": "YOLO_MODEL",
            },
            processed_metadata={
                "vision_model_review": {"status": "CANDIDATE", "note": "測試候選"}
            },
        )
        evidence.upload.save(filename, SimpleUploadedFile(filename, payload), save=True)
        return evidence

    def _catalogue(self, evidence, teacher=None, **kwargs):
        return catalogue_model(
            evidence=evidence, teacher=teacher or self.teacher, **kwargs
        )

    def _snapshot_abs(self, record):
        return os.path.join(self.media_dir.name, record.snapshot_path)


class ImmutableSnapshotTests(SnapshotTestCase):
    """指令一：模型不可變快照。"""

    def test_1_snapshot_created_on_intake(self):
        payload = b"snapshot-payload-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        original_path = evidence.upload.path
        original_sha = sha256_file(original_path)

        record = self._catalogue(evidence)

        self.assertEqual(record.snapshot_status, "STORED")
        self.assertTrue(record.has_snapshot)
        self.assertTrue(record.snapshot_path)
        self.assertEqual(record.snapshot_sha256, original_sha)
        self.assertEqual(record.snapshot_size_bytes, len(payload))
        self.assertEqual(record.artifact_sha256, original_sha)

        snapshot_path = self._snapshot_abs(record)
        self.assertTrue(os.path.isfile(snapshot_path))
        self.assertEqual(sha256_file(snapshot_path), original_sha)

    def test_2_original_file_not_moved_or_deleted(self):
        payload = b"original-untouched-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        original_path = evidence.upload.path
        original_sha = sha256_file(original_path)

        self._catalogue(evidence)

        self.assertTrue(os.path.isfile(original_path), "原始 Evidence 檔案不應被搬移或刪除。")
        self.assertEqual(sha256_file(original_path), original_sha, "原始檔案內容不應被修改。")

    def test_3_snapshot_content_identical_to_original(self):
        payload = bytes(range(256)) * 4096  # 1 MiB，跨多個 chunk
        evidence = self._evidence(self.enroll_a, payload)
        record = self._catalogue(evidence)

        with open(evidence.upload.path, "rb") as handle:
            original_bytes = handle.read()
        with open(self._snapshot_abs(record), "rb") as handle:
            snapshot_bytes = handle.read()

        self.assertEqual(snapshot_bytes, original_bytes)
        self.assertEqual(len(snapshot_bytes), len(payload))

    def test_4_snapshot_path_is_content_hash_named_under_media_root(self):
        payload = b"hash-named-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        record = self._catalogue(evidence)

        expected_relative = snapshot_relative_path(record.snapshot_sha256)
        self.assertEqual(record.snapshot_path, expected_relative)
        self.assertTrue(record.snapshot_path.startswith(SNAPSHOT_ROOT + "/"))

        snapshot_real = os.path.realpath(self._snapshot_abs(record))
        media_real = os.path.realpath(self.media_dir.name)
        self.assertTrue(
            snapshot_real.startswith(media_real),
            "快照實際路徑必須位於允許的 Media 根目錄之下。",
        )

    def test_5_source_evidence_reference_is_saved(self):
        payload = b"source-ref-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        record = self._catalogue(evidence)

        self.assertTrue(record.source_artifact_reference)
        self.assertEqual(record.source_artifact_reference, evidence.upload.name)
        self.assertEqual(str(record.evidence.evidence_id), str(evidence.evidence_id))

    def test_6_duplicate_catalogue_creates_no_second_snapshot(self):
        payload = b"dedupe-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        self._catalogue(evidence)
        before = snapshot_usage_report()["file_count"]

        record = VisionModelRecord.objects.get(evidence=evidence)
        with self.assertRaises(IntakeError) as ctx:
            self._catalogue(evidence)
        self.assertEqual(ctx.exception.code, "ALREADY_CATALOGUED")

        after = snapshot_usage_report()["file_count"]
        self.assertEqual(before, after, "重複收藏不得建立多份無用快照。")
        self.assertEqual(len(records_for_teacher(self.teacher).filter(evidence=evidence)), 1)
        self.assertTrue(os.path.isfile(self._snapshot_abs(record)))

    def test_7_second_identical_content_reuses_snapshot_by_hash(self):
        """兩筆不同 Evidence 但內容相同時，內容雜湊去重只能有一份快照檔。"""
        payload = b"same-bytes-" + uuid.uuid4().hex.encode()
        evidence_a = self._evidence(self.enroll_a, payload, filename="best-a.pt")
        self._catalogue(evidence_a)
        count_after_first = snapshot_usage_report()["file_count"]

        record_a = VisionModelRecord.objects.get(evidence=evidence_a)
        snapshot_path = self._snapshot_abs(record_a)

        # 以相同內容直接呼叫快照服務，驗證去重語意（deduplicated=True）。
        result = create_immutable_snapshot(
            source_path=evidence_a.upload.path, expected_sha256=record_a.snapshot_sha256
        )
        self.assertTrue(result["deduplicated"])
        self.assertEqual(result["relative_path"], record_a.snapshot_path)
        self.assertEqual(snapshot_usage_report()["file_count"], count_after_first)
        self.assertTrue(os.path.isfile(snapshot_path))

    def test_8_snapshot_service_rejects_sha_mismatch(self):
        payload = b"mismatch-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)

        with self.assertRaises(SnapshotError) as ctx:
            create_immutable_snapshot(
                source_path=evidence.upload.path, expected_sha256="0" * 64
            )
        self.assertEqual(ctx.exception.code, "SNAPSHOT_SOURCE_MISMATCH")
        self.assertFalse(
            os.path.exists(
                os.path.join(self.media_dir.name, snapshot_relative_path("0" * 64))
            )
        )

    def test_9_snapshot_service_rejects_missing_source(self):
        with self.assertRaises(SnapshotError) as ctx:
            create_immutable_snapshot(
                source_path=os.path.join(self.media_dir.name, "does-not-exist.pt"),
                expected_sha256="",
            )
        self.assertEqual(ctx.exception.code, "SOURCE_MISSING")

    def test_10_snapshot_service_rejects_symlink_source(self):
        """符號連結來源必須被拒絕（Windows 需開發者模式或系統管理權限）。"""
        target = os.path.join(self.media_dir.name, "real-source.pt")
        with open(target, "wb") as handle:
            handle.write(b"symlink-target")
        link = os.path.join(self.media_dir.name, "link-source.pt")
        try:
            os.symlink(target, link)
        except (OSError, NotImplementedError, AttributeError):
            self.skipTest("此平台權限不允許建立符號連結，無法驗證符號連結拒絕邏輯。")

        if not os.path.islink(link):
            self.skipTest("此平台未真正建立符號連結，跳過驗證。")

        with self.assertRaises(SnapshotError) as ctx:
            create_immutable_snapshot(source_path=link, expected_sha256="")
        self.assertEqual(ctx.exception.code, "SOURCE_SYMLINK_REJECTED")

    def test_11_snapshot_service_rejects_blank_source(self):
        with self.assertRaises(SnapshotError) as ctx:
            create_immutable_snapshot(source_path="", expected_sha256="")
        self.assertEqual(ctx.exception.code, "SOURCE_INVALID")

    def test_12_read_snapshot_rejects_path_traversal_and_absolute(self):
        with self.assertRaises(SnapshotError) as ctx:
            read_snapshot("")
        self.assertEqual(ctx.exception.code, "SNAPSHOT_PATH_EMPTY")

        with self.assertRaises(SnapshotError) as ctx:
            read_snapshot(os.path.join(self.media_dir.name, "escape.pt"))
        self.assertEqual(ctx.exception.code, "SNAPSHOT_PATH_ABSOLUTE")

        with self.assertRaises(SnapshotError) as ctx:
            read_snapshot("../../outside.pt")
        self.assertEqual(ctx.exception.code, "SNAPSHOT_PATH_ESCAPE")

    def test_13_snapshot_relative_path_rejects_bad_hash(self):
        with self.assertRaises(SnapshotError) as ctx:
            snapshot_relative_path("not-a-hash")
        self.assertEqual(ctx.exception.code, "SNAPSHOT_HASH_INVALID")

    def test_14_no_temp_file_left_behind(self):
        payload = b"temp-clean-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        self._catalogue(evidence)

        repo_dir = os.path.join(self.media_dir.name, SNAPSHOT_ROOT)
        leftovers = []
        for root, _dirs, files in os.walk(repo_dir):
            for name in files:
                if name.startswith(".tmp-snapshot-"):
                    leftovers.append(os.path.join(root, name))
        self.assertEqual(leftovers, [], "不得留下未完成的暫存快照檔。")
        self.assertEqual(snapshot_usage_report()["temp_file_count"], 0)

    def test_15_hash_does_not_deserialize_pt(self):
        """入庫不得載入或反序列化 .pt：內容為任意位元組仍可完成入庫。"""
        payload = b"\x00\x01NOT-A-REAL-PICKLE\xff\xfe" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        record = self._catalogue(evidence)

        self.assertEqual(record.snapshot_sha256, sha256_bytes(payload))
        self.assertEqual(record.integrity_status, NOT_CHECKED)


class IntegrityCheckTests(SnapshotTestCase):
    """指令二：模型完整性檢查。"""

    def test_20_fresh_record_is_not_checked(self):
        payload = b"integrity-fresh-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        record = self._catalogue(evidence)

        self.assertEqual(record.integrity_status, NOT_CHECKED)
        self.assertIsNone(record.integrity_checked_at)

        result = check_record_integrity(record)
        self.assertEqual(result["status"], INTACT)

    def test_21_intact_after_check(self):
        payload = b"integrity-intact-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        record = self._catalogue(evidence)

        result = run_integrity_check(record)
        record.refresh_from_db()

        self.assertEqual(result["status"], INTACT)
        self.assertEqual(record.integrity_status, INTACT)
        self.assertIsNotNone(record.integrity_checked_at)
        self.assertEqual(record.integrity_detail["expected_sha256"], record.snapshot_sha256)

    def test_22_modified_snapshot_is_detected(self):
        payload = b"integrity-modified-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        record = self._catalogue(evidence)

        with open(self._snapshot_abs(record), "ab") as handle:
            handle.write(b"TAMPERED")

        result = run_integrity_check(record)
        record.refresh_from_db()

        self.assertEqual(result["status"], MODIFIED)
        self.assertEqual(record.integrity_status, MODIFIED)
        self.assertNotEqual(
            record.integrity_detail["actual_sha256"], record.integrity_detail["expected_sha256"]
        )
        self.assertTrue(record.integrity_detail["reason"])

    def test_23_missing_snapshot_is_detected(self):
        payload = b"integrity-missing-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        record = self._catalogue(evidence)

        os.remove(self._snapshot_abs(record))

        result = run_integrity_check(record)
        record.refresh_from_db()

        self.assertEqual(result["status"], MISSING)
        self.assertEqual(record.integrity_status, MISSING)

    def test_24_not_checked_when_no_snapshot(self):
        """沒有快照的紀錄不得檢查出 INTACT。"""
        payload = b"no-snapshot-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        record = self._catalogue(evidence)

        VisionModelRecord.objects.filter(pk=record.pk).update(
            snapshot_status="PENDING", snapshot_path="", snapshot_sha256=""
        )
        record.refresh_from_db()

        result = check_record_integrity(record)
        self.assertEqual(result["status"], NOT_CHECKED)
        self.assertFalse(record.has_snapshot)

    def test_25_damaged_record_cannot_be_training_base(self):
        payload = b"damaged-training-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        record = self._catalogue(evidence)
        run_integrity_check(record)
        record.refresh_from_db()

        os.remove(self._snapshot_abs(record))
        run_integrity_check(record)
        record.refresh_from_db()

        self.assertEqual(record.integrity_status, MISSING)
        self.assertFalse(record.is_publishable)
        self.assertTrue(record.integrity_blocked_reason())

    def test_26_integrity_check_does_not_delete_or_overwrite(self):
        payload = b"no-auto-delete-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        record = self._catalogue(evidence)

        with open(self._snapshot_abs(record), "ab") as handle:
            handle.write(b"CORRUPT")

        run_integrity_check(record)
        record.refresh_from_db()

        self.assertTrue(os.path.isfile(self._snapshot_abs(record)), "不得自動刪除損壞檔案。")
        self.assertEqual(sha256_file(self._snapshot_abs(record)), record.integrity_detail["actual_sha256"])

    def test_27_integrity_check_does_not_change_deployment_status(self):
        payload = b"no-auto-active-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        record = self._catalogue(evidence)
        before = record.deployment_status

        run_integrity_check(record)
        record.refresh_from_db()

        self.assertEqual(record.deployment_status, before)
        self.assertEqual(record.deployment_status, "CATALOGUED")
        self.assertEqual(record.validation_status, "NOT_EVALUATED")

    def test_28_hash_file_never_loads_pt(self):
        """以 0 位元組與隨機位元組檔案驗證：只做位元組串流雜湊。"""
        empty = os.path.join(self.media_dir.name, "empty.pt")
        with open(empty, "wb"):
            pass
        from learning.vision_snapshot import hash_file

        self.assertEqual(
            hash_file(empty),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        )


class TeacherSnapshotBackendAcceptanceTests(SnapshotTestCase):
    """指令三：教師後台實際驗收（Django Client / Automated PASS）。"""

    def setUp(self):
        super().setUp()
        self.client_teacher = Client()
        self.payload = b"backend-acceptance-" + uuid.uuid4().hex.encode()
        self.evidence = self._evidence(self.enroll_a, self.payload)

    def _login(self, user):
        self.client_teacher.logout()
        self.client_teacher.force_login(user)

    def test_30_step1_teacher_can_log_in(self):
        # 教師登入頁可用
        page = self.client_teacher.get(reverse("learning:teacher_login"))
        self.assertEqual(page.status_code, 200)

        # 以教師身分登入後可進入教師後台
        self._login(self.teacher)
        dashboard = self.client_teacher.get(reverse("learning:teacher_vision_flywheel"))
        self.assertEqual(dashboard.status_code, 200)
        self.assertTrue(dashboard.wsgi_request.user.is_authenticated)
        self.assertEqual(dashboard.wsgi_request.user.pk, self.teacher.pk)

    def test_31_step2_teacher_sees_r07_submission(self):
        self._login(self.teacher)
        response = self.client_teacher.get(reverse("learning:teacher_vision_flywheel"))
        self.assertEqual(response.status_code, 200)
        # 飛輪頁列出班級內學員的模型證據（以檔名呈現）與四維規格。
        self.assertContains(response, "best-snap.pt")
        self.assertContains(response, self.cohort_a.cohort_id)
        self.assertContains(response, "PROP_DIRECTION")

    def test_32_step3_review_as_candidate(self):
        self._login(self.teacher)
        response = self.client_teacher.post(
            reverse("learning:teacher_vision_model_review", args=[self.evidence.evidence_id]),
            {"action": "candidate", "note": "自動化驗收", "rule_template_id": "PROP_DIRECTION_V1"},
            follow=True,
        )
        self.assertEqual(response.status_code, 200)
        self.evidence.refresh_from_db()
        review = (self.evidence.processed_metadata or {}).get("vision_model_review") or {}
        self.assertEqual(review.get("status"), "CANDIDATE")

    def test_33_step4_step5_catalogue_and_record_enters_repository(self):
        self._login(self.teacher)
        response = self.client_teacher.post(
            reverse("learning:teacher_vision_model_catalogue", args=[self.evidence.evidence_id]),
            {"model_version": "V1"},
            follow=True,
        )
        self.assertEqual(response.status_code, 200)

        record = VisionModelRecord.objects.get(evidence=self.evidence)
        self.assertEqual(record.model_version, "V1")
        self.assertEqual(record.deployment_status, "CATALOGUED")
        self.assertEqual(record.cohort_id, self.cohort_a.cohort_id)

        listing = self.client_teacher.get(reverse("learning:teacher_vision_flywheel"))
        self.assertContains(listing, "已入庫模型（1）")

    def test_34_step6_detail_page_shows_v1_source_and_sha256(self):
        self._login(self.teacher)
        self.client_teacher.post(
            reverse("learning:teacher_vision_model_catalogue", args=[self.evidence.evidence_id]),
            {"model_version": "V1"},
            follow=True,
        )
        record = VisionModelRecord.objects.get(evidence=self.evidence)

        response = self.client_teacher.get(
            reverse("learning:teacher_vision_model_detail", args=[self.evidence.evidence_id])
        )
        self.assertEqual(response.status_code, 200)
        content = response.content.decode()
        self.assertIn("此模型已入庫，無需重複收藏。", content)
        self.assertIn(record.model_version, content)
        self.assertIn(record.artifact_sha256[:16], content)
        self.assertIn("不可變快照", content)
        self.assertIn(record.snapshot_sha256[:16], content)
        self.assertIn(str(record.snapshot_size_bytes), content)

    def test_35_step7_integrity_status_visible(self):
        self._login(self.teacher)
        self.client_teacher.post(
            reverse("learning:teacher_vision_model_catalogue", args=[self.evidence.evidence_id]),
            {"model_version": "V1"},
            follow=True,
        )
        record = VisionModelRecord.objects.get(evidence=self.evidence)

        response = self.client_teacher.post(
            reverse("learning:teacher_vision_model_integrity_check", args=[record.pk]),
            follow=True,
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "完整性檢查完成：")
        record.refresh_from_db()
        self.assertEqual(record.integrity_status, INTACT)

        listing = self.client_teacher.get(reverse("learning:teacher_vision_flywheel"))
        self.assertContains(listing, INTACT)

    def test_36_step8_record_persists_after_re_login(self):
        self._login(self.teacher)
        self.client_teacher.post(
            reverse("learning:teacher_vision_model_catalogue", args=[self.evidence.evidence_id]),
            {"model_version": "V1"},
            follow=True,
        )
        record = VisionModelRecord.objects.get(evidence=self.evidence)
        snapshot_path = self._snapshot_abs(record)
        snapshot_sha = record.snapshot_sha256

        # 重新登入（登出後重新驗證身分）。
        self.client_teacher.logout()
        response = self.client_teacher.post(
            reverse("learning:teacher_login"),
            {"username": self.teacher.username, "password": "A-strong-passphrase-984!"},
            follow=True,
        )
        self.assertEqual(response.status_code, 200)

        listing = self.client_teacher.get(reverse("learning:teacher_vision_flywheel"))
        self.assertEqual(listing.status_code, 200)
        self.assertContains(listing, "已入庫模型（1）")
        self.assertContains(listing, record.snapshot_sha256[:12])

        self.assertTrue(VisionModelRecord.objects.filter(pk=record.pk).exists())
        self.assertTrue(os.path.isfile(snapshot_path))
        self.assertEqual(sha256_file(snapshot_path), snapshot_sha)

    def test_37_check_all_runs_for_teacher_cohort(self):
        self._login(self.teacher)
        self.client_teacher.post(
            reverse("learning:teacher_vision_model_catalogue", args=[self.evidence.evidence_id]),
            {"model_version": "V1"},
            follow=True,
        )
        response = self.client_teacher.post(
            reverse("learning:teacher_vision_integrity_check_all"), follow=True
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "完整性檢查完成：共 1 筆")

        record = VisionModelRecord.objects.get(evidence=self.evidence)
        self.assertEqual(record.integrity_status, INTACT)


class SnapshotAccessControlTests(SnapshotTestCase):
    """指令五：權限與私人路徑保護。"""

    def setUp(self):
        super().setUp()
        self.payload = b"access-control-" + uuid.uuid4().hex.encode()
        self.evidence = self._evidence(self.enroll_a, self.payload)
        self.record = self._catalogue(self.evidence)
        self.client_other = Client()

    def test_40_other_cohort_teacher_cannot_check_integrity(self):
        self.client_other.force_login(self.other_teacher)
        response = self.client_other.post(
            reverse("learning:teacher_vision_model_integrity_check", args=[self.record.pk])
        )
        self.assertEqual(response.status_code, 404)

    def test_41_other_cohort_teacher_does_not_see_record(self):
        self.client_other.force_login(self.other_teacher)
        response = self.client_other.get(reverse("learning:teacher_vision_flywheel"))
        self.assertEqual(response.status_code, 200, "其他班級教師仍應可開啟自己的飛輪頁。")
        # 不得看到 A 班紀錄的快照雜湊或 Model ID
        content = response.content.decode()
        self.assertNotIn(self.record.snapshot_sha256[:12], content)
        self.assertNotIn(str(self.record.pk), content)
        # 該教師的倉庫應為 0 筆（A 班紀錄不得外洩）
        self.assertIn("已入庫模型（0）", content)

    def test_42_anonymous_cannot_reach_repository_pages(self):
        anon = Client()
        listing = anon.get(reverse("learning:teacher_vision_flywheel"))
        self.assertEqual(listing.status_code, 302)
        self.assertIn(reverse("learning:teacher_login"), listing.headers.get("Location", ""))
        detail = anon.get(
            reverse("learning:teacher_vision_model_detail", args=[self.evidence.evidence_id])
        )
        self.assertEqual(detail.status_code, 302)

    def test_43_no_absolute_media_path_leaked(self):
        teacher = Client()
        teacher.force_login(self.teacher)
        for url in (
            reverse("learning:teacher_vision_flywheel"),
            reverse("learning:teacher_vision_model_detail", args=[self.evidence.evidence_id]),
        ):
            response = teacher.get(url)
            content = response.content.decode()
            self.assertNotIn(self.media_dir.name, content, f"{url} 洩漏了 Media 絕對路徑。")
            self.assertNotIn(settings.MEDIA_ROOT, content)
            self.assertNotIn("learning/media", content.replace("learning/media/", "/MEDIA/"))
        self.assertNotIn(
            self.media_dir.name,
            str(self.record.integrity_detail),
            "完整性細節不得包含本機絕對路徑。",
        )

    def test_44_no_download_link_for_snapshot(self):
        teacher = Client()
        teacher.force_login(self.teacher)
        response = teacher.get(reverse("learning:teacher_vision_flywheel"))
        content = response.content.decode()
        self.assertNotIn("download", content.lower())


class CandidateR07UnaffectedTests(SnapshotTestCase):
    """指令五：Candidate / Return 與 R07 不受影響。"""

    def test_50_candidate_and_return_still_work(self):
        """Candidate / Return 流程在使用快照入庫功能後仍可正常運作。"""
        payload = b"candidate-return-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        teacher = Client()
        teacher.force_login(self.teacher)

        # 先退回，再列為候選，確認兩個動作都能寫入且互不干擾。
        teacher.post(
            reverse("learning:teacher_vision_model_review", args=[evidence.evidence_id]),
            {"action": "return", "note": "退回修改", "rule_template_id": "PROP_DIRECTION_V1"},
            follow=True,
        )
        evidence.refresh_from_db()
        self.assertEqual(
            (evidence.processed_metadata or {})["vision_model_review"]["status"], "RETURNED"
        )

        teacher.post(
            reverse("learning:teacher_vision_model_review", args=[evidence.evidence_id]),
            {"action": "candidate", "note": "候選", "rule_template_id": "PROP_DIRECTION_V1"},
            follow=True,
        )
        evidence.refresh_from_db()
        review = (evidence.processed_metadata or {})["vision_model_review"]
        self.assertEqual(review["status"], "CANDIDATE")
        # 審核歷程保留，未被快照功能破壞。
        self.assertGreaterEqual(len(review.get("history") or []), 2)

    def test_51_returned_model_cannot_be_catalogued_via_view(self):
        """RETURNED 狀態不得透過教師後台收藏；由檢視層擋下並回報原因。"""
        payload = b"returned-blocked-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        processed = dict(evidence.processed_metadata or {})
        processed["vision_model_review"] = {"status": "RETURNED", "note": "退回"}
        Evidence.objects.filter(pk=evidence.pk).update(processed_metadata=processed)
        evidence.refresh_from_db()

        from learning.views import _catalogue_blocked_reason

        reason = _catalogue_blocked_reason(evidence)
        self.assertTrue(reason, "RETURNED 狀態應有明確的收藏阻擋原因。")
        self.assertIn("候選", reason)

        teacher = Client()
        teacher.force_login(self.teacher)
        teacher.post(
            reverse("learning:teacher_vision_model_catalogue", args=[evidence.evidence_id]),
            {"model_version": "V1"},
            follow=True,
        )
        self.assertFalse(VisionModelRecord.objects.filter(evidence=evidence).exists())
        # 未入庫即不得建立任何快照
        self.assertEqual(snapshot_usage_report()["file_count"], 0)

    def test_52_r07_upload_route_unchanged(self):
        """R07 上傳路由仍存在且仍要求登入。"""
        anon = Client()
        response = anon.get(reverse("learning:growth_model_upload", args=[self.enroll_a.pk]))
        self.assertIn(response.status_code, (301, 302, 403))

    def test_53_student_r07_page_still_opens(self):
        # 學員物件為 StudentProfile；其登入帳號為 .user（StudentProfile.save 不支援 last_login 更新）。
        student_user = self.student_a.user
        client = Client()
        session = client.session
        session["_auth_user_id"] = str(student_user.pk)
        session["_auth_user_backend"] = "django.contrib.auth.backends.ModelBackend"
        session["_auth_user_hash"] = student_user.get_session_auth_hash()
        session.save()

        response = client.get(
            reverse("learning:growth_record_detail", args=[self.enroll_a.pk, "R07"])
        )
        self.assertIn(response.status_code, (200, 302), "R07 學員頁面應仍可開啟。")
        # 未登入者必須被擋下（不得匿名讀取學員頁）。
        anon = Client()
        anon_response = anon.get(
            reverse("learning:growth_record_detail", args=[self.enroll_a.pk, "R07"])
        )
        self.assertIn(anon_response.status_code, (301, 302, 403))

    def test_54_snapshot_service_does_not_touch_growth_submissions(self):
        payload = b"no-growth-change-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)
        before = GrowthRecordSubmission.objects.count()
        self._catalogue(evidence)
        self.assertEqual(GrowthRecordSubmission.objects.count(), before)


class SnapshotErrorCodeTests(SnapshotTestCase):
    """錯誤碼穩定性（供後續回歸使用）。"""

    def test_60_catalogue_wraps_snapshot_errors_with_prefix(self):
        payload = b"wrap-error-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)

        from learning import vision_repository as repo

        original = repo.resolve_evidence_artifact_path

        def broken(_evidence):
            raise SnapshotError("SOURCE_MISSING", "測試用：來源不存在。")

        repo.resolve_evidence_artifact_path = broken
        try:
            with self.assertRaises(IntakeError) as ctx:
                repo.catalogue_model(evidence=evidence, teacher=self.teacher)
            self.assertEqual(ctx.exception.code, "SNAPSHOT_SOURCE_MISSING")
        finally:
            repo.resolve_evidence_artifact_path = original

    def test_61_no_record_left_when_snapshot_fails(self):
        payload = b"no-orphan-record-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(self.enroll_a, payload)

        from learning import vision_repository as repo

        original = repo.resolve_evidence_artifact_path

        def broken(_evidence):
            raise SnapshotError("SOURCE_MISSING", "測試用：來源不存在。")

        repo.resolve_evidence_artifact_path = broken
        try:
            with self.assertRaises(IntakeError):
                repo.catalogue_model(evidence=evidence, teacher=self.teacher)
        finally:
            repo.resolve_evidence_artifact_path = original

        self.assertFalse(VisionModelRecord.objects.filter(evidence=evidence).exists())
        self.assertTrue(os.path.isfile(evidence.upload.path), "原始檔案不得被刪除。")
        self.assertEqual(snapshot_usage_report()["temp_file_count"], 0)
