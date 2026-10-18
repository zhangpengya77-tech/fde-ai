"""第 22 輪：不可變快照安全審核（`vision_snapshot.py`）。

本模組針對教師指令「一、不可變快照安全審核」的 7 個面向逐一驗證：

    S1. 已存在相同 SHA256 快照時，是否會被覆寫。
    S2. 同時兩個請求收藏相同模型時，是否存在競爭條件。
    S3. 快照損壞時是否拒絕重用。
    S4. DB 交易失敗時是否可能誤刪其他紀錄共用的快照。
    S5. 暫存檔是否正確清理。
    S6. 快照來源是否可能經符號連結逃出允許目錄。
    S7. 原始檔案在雜湊與複製期間被替換時是否能偵測。

**不得載入或反序列化任何 .pt**：本模組只做位元組串流雜湊與檔案層級操作。

所有測試通過僅代表「自動化驗證通過」；Windows 權限不允許建立符號連結時，
相關項目一律標記為 SKIPPED（未驗證），不得宣稱安全測試全數通過。
"""

import hashlib
import os
import subprocess
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from tempfile import TemporaryDirectory

from django.db import connection, connections
from django.test import TestCase, override_settings

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
from learning.vision_repository import IntakeError, catalogue_model
from learning.vision_snapshot import (
    SNAPSHOT_ROOT,
    SnapshotError,
    cleanup_orphan_temp_files,
    create_immutable_snapshot,
    hash_file,
    snapshot_relative_path,
    snapshot_usage_report,
    validate_source_path,
)


def sha256_bytes(payload: bytes) -> str:
    digest = hashlib.sha256()
    digest.update(payload)
    return digest.hexdigest()


def list_temp_files(root: str) -> list:
    """列出倉庫底下所有 .tmp-snapshot-* 暫存檔。"""
    found = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if name.startswith(".tmp-snapshot-"):
                found.append(os.path.join(dirpath, name))
    return found


class SnapshotSecurityTestCase(TestCase):
    """共用基礎：每個測試在獨立暫存 Media 根目錄下執行。"""

    def setUp(self):
        self.media_dir = TemporaryDirectory()
        self.addCleanup(self.media_dir.cleanup)
        override = override_settings(MEDIA_ROOT=self.media_dir.name)
        override.enable()
        self.addCleanup(override.disable)

        self.cohort = Cohort.objects.create(cohort_id="2026-81", name="安全審核班")
        self.student = create_student_account("sec-audit@example.test", "審核學員")
        self.enrollment = enroll_student(self.student, self.cohort)
        Enrollment.objects.filter(pk=self.enrollment.pk).update(
            project_direction="ai_flight_assessment"
        )

        from django.contrib.auth import get_user_model

        User = get_user_model()
        self.teacher = User.objects.create_user(
            username="sec-teacher@example.test",
            email="sec-teacher@example.test",
            password="A-strong-passphrase-984!",
        )
        self.teacher.is_staff = True
        self.teacher.save(update_fields=["is_staff"])
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)

        definition, _ = GrowthRecordDefinition.objects.get_or_create(
            cohort=self.cohort, slot_id="R07", group_scope=None,
            defaults={"title": "專業任務驗證", "description": "測試", "display_order": 7},
        )
        self.submission, _ = GrowthRecordSubmission.objects.get_or_create(
            enrollment=self.enrollment, definition=definition
        )

    # ---- helpers -------------------------------------------------------
    def _evidence(self, payload: bytes, filename="best-sec.pt"):
        evidence = Evidence.objects.create(
            evidence_type=Evidence.Type.MODEL,
            growth_submission=self.submission,
            description="R07 AI Vision / YOLO 訓練模型",
            original_metadata={
                "filename": filename,
                "extension": ".pt",
                "content_type": "application/octet-stream",
                "size_bytes": len(payload),
                "task_type": "PROP_DIRECTION",
                "evidence_type": "YOLO_MODEL",
            },
            processed_metadata={"vision_model_review": {"status": "CANDIDATE", "note": "候選"}},
        )
        from django.core.files.base import ContentFile

        evidence.upload.save(filename, ContentFile(payload), save=True)
        return evidence

    def _snapshot_root(self):
        return os.path.join(self.media_dir.name, SNAPSHOT_ROOT)


# =====================================================================
# S1. 已存在相同 SHA256 快照時，是否會被覆寫
# =====================================================================
class S1_ExistingSnapshotNotOverwrittenTests(SnapshotSecurityTestCase):
    def test_s1a_same_hash_reuses_without_overwriting(self):
        """相同內容的第二次入庫必須重用既有副本，且副本內容與 mtime 不變。"""
        payload = b"same-hash-reuse-" + uuid.uuid4().hex.encode()
        sha = sha256_bytes(payload)

        ev1 = self._evidence(payload, filename="best-a.pt")
        rec1 = catalogue_model(evidence=ev1, teacher=self.teacher)
        target = os.path.join(self.media_dir.name, rec1.snapshot_path.replace("/", os.sep))
        first_mtime = os.path.getmtime(target)
        first_inode = os.stat(target).st_ino

        # 以相同內容直接再呼叫快照服務：必須回報 deduplicated，不得重寫檔案。
        result = create_immutable_snapshot(
            source_path=ev1.upload.path, expected_sha256=sha
        )
        self.assertTrue(result["deduplicated"], "相同雜湊必須重用既有副本。")
        self.assertEqual(result["relative_path"], rec1.snapshot_path)
        self.assertEqual(hash_file(target), sha)
        # 檔案未被覆寫：mtime 與 inode 皆不變。
        self.assertEqual(
            os.path.getmtime(target), first_mtime, "既有副本不得被覆寫（mtime 改變）。"
        )
        self.assertEqual(os.stat(target).st_ino, first_inode, "既有副本不得被替換（inode 改變）。")

    def test_s1b_existing_corrupt_snapshot_is_refused_not_overwritten(self):
        """目標路徑已存在但內容不符時，必須拒絕而非覆蓋。"""
        payload = b"corrupt-existing-" + uuid.uuid4().hex.encode()
        sha = sha256_bytes(payload)
        relative = snapshot_relative_path(sha)
        target = os.path.join(self.media_dir.name, relative.replace("/", os.sep))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        # 人為放置一個「路徑正確但內容錯誤」的檔案，模擬檔案系統層異常 / 遭竄改。
        with open(target, "wb") as handle:
            handle.write(b"WRONG-CONTENT")

        source = os.path.join(self.media_dir.name, "source.pt")
        with open(source, "wb") as handle:
            handle.write(payload)

        with self.assertRaises(SnapshotError) as ctx:
            create_immutable_snapshot(source_path=source, expected_sha256=sha)
        self.assertEqual(ctx.exception.code, "SNAPSHOT_EXISTING_CORRUPT")

        # 損壞檔案必須原封不動保留，供追查；不得被「修好」或刪除。
        with open(target, "rb") as handle:
            self.assertEqual(handle.read(), b"WRONG-CONTENT", "損壞副本不得被覆寫或刪除。")

    def test_s1c_corrupt_existing_snapshot_blocks_catalogue(self):
        """既有副本損壞時，整筆入庫必須失敗，且不得留下倉庫紀錄。"""
        payload = b"corrupt-blocks-" + uuid.uuid4().hex.encode()
        sha = sha256_bytes(payload)
        target = os.path.join(
            self.media_dir.name, snapshot_relative_path(sha).replace("/", os.sep)
        )
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as handle:
            handle.write(b"WRONG")

        evidence = self._evidence(payload)
        with self.assertRaises(IntakeError) as ctx:
            catalogue_model(evidence=evidence, teacher=self.teacher)
        # 入庫層會把 SnapshotError 包成 IntakeError("SNAPSHOT_<code>")。
        self.assertEqual(ctx.exception.code, "SNAPSHOT_SNAPSHOT_EXISTING_CORRUPT")
        self.assertFalse(VisionModelRecord.objects.filter(evidence=evidence).exists())
        self.assertTrue(os.path.isfile(evidence.upload.path), "原始檔案不得被刪除。")


# =====================================================================
# S2. 同時兩個請求收藏相同模型時的競爭條件
# =====================================================================
class S2_ConcurrentCatalogueRaceTests(SnapshotSecurityTestCase):
    def test_s2a_concurrent_snapshot_creation_leaves_one_valid_file(self):
        """多執行緒同時建立同一內容的快照：必須全部成功或明確失敗，且只留一份有效副本。"""
        payload = b"concurrent-" + uuid.uuid4().hex.encode()
        sha = sha256_bytes(payload)
        source = os.path.join(self.media_dir.name, "race-source.pt")
        with open(source, "wb") as handle:
            handle.write(payload)

        target = os.path.join(
            self.media_dir.name, snapshot_relative_path(sha).replace("/", os.sep)
        )
        os.makedirs(os.path.dirname(target), exist_ok=True)

        results = []
        errors = []

        def worker():
            try:
                results.append(
                    create_immutable_snapshot(source_path=source, expected_sha256=sha)
                )
            except SnapshotError as exc:
                errors.append(exc.code)
            finally:
                connections.close_all()

        threads = [threading.Thread(target=worker) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        # 所有成功者都必須指向同一路徑與同一雜湊。
        for item in results:
            self.assertEqual(item["relative_path"], snapshot_relative_path(sha))
            self.assertEqual(item["sha256"], sha)

        # 至少一個成功；失敗者必須是明確的錯誤碼（不得是無聲損毀）。
        self.assertGreaterEqual(len(results), 1, f"全部失敗：{errors}")
        for code in errors:
            self.assertIn(
                code,
                ("SNAPSHOT_EXISTING_CORRUPT", "SNAPSHOT_TEMP_LOST", "SNAPSHOT_IO_ERROR"),
                f"未預期的競爭錯誤碼：{code}",
            )

        # 關鍵：落定後的副本必須存在、內容正確，且目錄內只有這一份 .pt。
        self.assertTrue(os.path.isfile(target))
        self.assertEqual(hash_file(target), sha)
        pt_files = [
            name
            for name in os.listdir(os.path.dirname(target))
            if name.endswith(".pt")
        ]
        self.assertEqual(len(pt_files), 1, f"應只有一份副本，實際：{pt_files}")

    def test_s2b_concurrent_catalogue_same_evidence_only_one_record(self):
        """同一筆 Evidence 被並行收藏：最多只能產生一筆 VisionModelRecord。"""
        payload = b"concurrent-record-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(payload)

        created = []
        failures = []

        def worker():
            try:
                created.append(catalogue_model(evidence=evidence, teacher=self.teacher))
            except (IntakeError, Exception) as exc:  # noqa: BLE001
                failures.append(getattr(exc, "code", type(exc).__name__))
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(worker) for _ in range(4)]
            for future in futures:
                future.result()

        record_count = VisionModelRecord.objects.filter(evidence=evidence).count()
        self.assertLessEqual(
            record_count, 1, f"並行收藏不得產生多筆紀錄（實際 {record_count} 筆）。"
        )
        # 重複者必須以 ALREADY_CATALOGUED 等明確錯誤碼拒絕。
        for code in failures:
            self.assertIn(
                code,
                (
                    "ALREADY_CATALOGUED",
                    "VERSION_DUPLICATE",
                    "OperationalError",
                    "IntegrityError",
                ),
                f"未預期的並行錯誤：{code}",
            )


# =====================================================================
# S3. 快照損壞時是否拒絕重用
# =====================================================================
class S3_CorruptSnapshotNotReusedTests(SnapshotSecurityTestCase):
    def test_s3a_corrupt_snapshot_is_never_reused_as_valid(self):
        """已損壞的副本不得被當成有效副本重用。"""
        payload = b"corrupt-reuse-" + uuid.uuid4().hex.encode()
        sha = sha256_bytes(payload)
        ev1 = self._evidence(payload, filename="best-x.pt")
        rec1 = catalogue_model(evidence=ev1, teacher=self.teacher)
        target = os.path.join(self.media_dir.name, rec1.snapshot_path.replace("/", os.sep))

        # 竄改副本（模擬磁碟損毀 / 外部修改）。
        with open(target, "ab") as handle:
            handle.write(b"TAMPERED")

        # 再次以相同內容要求建立快照：必須拒絕，不得把損壞檔當成有效副本。
        with self.assertRaises(SnapshotError) as ctx:
            create_immutable_snapshot(source_path=ev1.upload.path, expected_sha256=sha)
        self.assertEqual(ctx.exception.code, "SNAPSHOT_EXISTING_CORRUPT")

        # 損壞副本保留原狀，未被「自動修復」。
        self.assertNotEqual(hash_file(target), sha, "損壞副本不得被自動覆寫修復。")

    def test_s3b_integrity_check_reports_modified_not_intact(self):
        """完整性檢查必須把被竄改的副本判為 MODIFIED。"""
        from learning.vision_integrity import MODIFIED, run_integrity_check

        payload = b"integrity-modified-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(payload)
        record = catalogue_model(evidence=evidence, teacher=self.teacher)
        target = os.path.join(self.media_dir.name, record.snapshot_path.replace("/", os.sep))

        with open(target, "ab") as handle:
            handle.write(b"X")

        result = run_integrity_check(record)
        record.refresh_from_db()
        self.assertEqual(result["status"], MODIFIED)
        self.assertEqual(record.integrity_status, MODIFIED)
        # 損壞時不得自動切換部署狀態。
        self.assertEqual(record.deployment_status, "CATALOGUED")
        self.assertFalse(record.is_publishable)


# =====================================================================
# S4. DB 交易失敗時是否可能誤刪其他紀錄共用的快照
# =====================================================================
class S4_SharedSnapshotNotDeletedTests(SnapshotSecurityTestCase):
    def test_s4a_shared_snapshot_survives_rollback_of_second_intake(self):
        """兩筆紀錄共用同一份副本（相同內容）時，第二筆失敗不得刪掉第一筆在用的副本。"""
        payload = b"shared-snapshot-" + uuid.uuid4().hex.encode()
        sha = sha256_bytes(payload)

        # 第一筆成功入庫並持有副本。
        ev1 = self._evidence(payload, filename="best-first.pt")
        rec1 = catalogue_model(evidence=ev1, teacher=self.teacher)
        target = os.path.join(self.media_dir.name, rec1.snapshot_path.replace("/", os.sep))
        self.assertTrue(os.path.isfile(target))

        # 第二筆為不同 Evidence、相同內容；讓 register_model_record 失敗。
        ev2 = self._evidence(payload, filename="best-second.pt")
        from learning import vision_repository as repo

        original = repo.register_model_record

        def boom(**_kwargs):
            raise RuntimeError("模擬資料庫寫入失敗")

        repo.register_model_record = boom
        try:
            with self.assertRaises(RuntimeError):
                repo.catalogue_model(evidence=ev2, teacher=self.teacher)
        finally:
            repo.register_model_record = original

        # 關鍵：第一筆紀錄的副本必須完好無損（不得被誤刪）。
        self.assertTrue(
            os.path.isfile(target), "共用副本在第一筆紀錄仍引用時不得被刪除。"
        )
        self.assertEqual(hash_file(target), sha)
        self.assertTrue(VisionModelRecord.objects.filter(pk=rec1.pk).exists())

    def test_s4b_discard_only_removes_unreferenced_new_snapshot(self):
        """新建立且無任何紀錄引用的副本，才可於失敗時清理。"""
        payload = b"orphan-cleanup-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(payload)

        from learning import vision_repository as repo

        original = repo.register_model_record

        def boom(**_kwargs):
            raise RuntimeError("模擬資料庫寫入失敗")

        repo.register_model_record = boom
        try:
            with self.assertRaises(RuntimeError):
                repo.catalogue_model(evidence=evidence, teacher=self.teacher)
        finally:
            repo.register_model_record = original

        # 無任何紀錄引用的孤兒副本應被清理。
        self.assertEqual(
            snapshot_usage_report()["file_count"], 0, "無人引用的孤兒副本應被清理。"
        )
        self.assertEqual(list_temp_files(self._snapshot_root()), [], "不得留下暫存檔。")

    def test_s4c_original_evidence_never_deleted_on_failure(self):
        """任何入庫失敗都不得刪除原始 Evidence 檔案。"""
        payload = b"original-safe-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(payload)
        original_path = evidence.upload.path
        original_sha = hash_file(original_path)

        from learning import vision_repository as repo

        orig = repo.register_model_record
        repo.register_model_record = lambda **_k: (_ for _ in ()).throw(RuntimeError("boom"))
        try:
            with self.assertRaises(RuntimeError):
                repo.catalogue_model(evidence=evidence, teacher=self.teacher)
        finally:
            repo.register_model_record = orig

        self.assertTrue(os.path.isfile(original_path), "原始檔案不得被刪除。")
        self.assertEqual(hash_file(original_path), original_sha, "原始檔案內容不得改變。")


# =====================================================================
# S5. 暫存檔是否正確清理
# =====================================================================
class S5_TempFileCleanupTests(SnapshotSecurityTestCase):
    def test_s5a_temp_file_naming_is_internal_only(self):
        """成功建立快照後不得留下任何 .tmp-snapshot-* 檔。"""
        payload = b"temp-clean-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(payload)
        catalogue_model(evidence=evidence, teacher=self.teacher)

        self.assertEqual(list_temp_files(self._snapshot_root()), [])
        self.assertEqual(snapshot_usage_report()["temp_file_count"], 0)

    def test_s5b_temp_cleaned_when_copy_fails(self):
        """複製過程中斷（目的雜湊與來源不符）時，必須清掉暫存檔且不得留下半成品。

        呼叫序列（已以追蹤腳本確認）：新建副本路徑下 `hash_file` 只會被呼叫
        **一次**（`create_immutable_snapshot` 第 166 行計算來源雜湊）；
        複製期間的目的雜湊是以迴圈內累積的 `digest` 產生，不經 `hash_file`。
        因此這裡改為在第 1 次 `hash_file` 時回傳錯誤值，
        使「來源雜湊」與「複製後雜湊」必然不符，觸發 `SNAPSHOT_COPY_MISMATCH`。
        """
        payload = b"temp-fail-" + uuid.uuid4().hex.encode()
        source = os.path.join(self.media_dir.name, "temp-source.pt")
        with open(source, "wb") as handle:
            handle.write(payload)

        import learning.vision_snapshot as vs

        real_hash_file = vs.hash_file

        def wrong_source_hash(path):
            """回傳一個確定錯誤的來源雜湊，使複製結果必然不一致。"""
            return "0" * 64

        vs.hash_file = wrong_source_hash
        try:
            with self.assertRaises(SnapshotError) as ctx:
                create_immutable_snapshot(source_path=source, expected_sha256="")
            self.assertEqual(ctx.exception.code, "SNAPSHOT_COPY_MISMATCH")
        finally:
            vs.hash_file = real_hash_file

        self.assertEqual(list_temp_files(self._snapshot_root()), [], "失敗時必須清除暫存檔。")
        # 不得留下已落定的 .pt。
        root = self._snapshot_root()
        landed = []
        for dirpath, _dirs, files in os.walk(root):
            landed.extend(f for f in files if f.endswith(".pt"))
        self.assertEqual(landed, [], "失敗時不得留下任何已落定副本。")

    def test_s5c_cleanup_orphan_temp_files_sweeps_leftovers(self):
        """清理函式能掃掉行程被強制終止後殘留的暫存檔。"""
        root_dir = os.path.join(self._snapshot_root(), "ab")
        os.makedirs(root_dir, exist_ok=True)
        leftover = os.path.join(root_dir, ".tmp-snapshot-deadbeef.part")
        with open(leftover, "wb") as handle:
            handle.write(b"partial")

        self.assertEqual(snapshot_usage_report()["temp_file_count"], 1)
        removed = cleanup_orphan_temp_files()
        self.assertEqual(removed, 1)
        self.assertFalse(os.path.exists(leftover))
        self.assertEqual(snapshot_usage_report()["temp_file_count"], 0)

    def test_s5d_orphan_cleanup_does_not_touch_real_snapshots(self):
        """孤兒暫存檔清理不得誤刪真實副本。"""
        payload = b"keep-real-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(payload)
        record = catalogue_model(evidence=evidence, teacher=self.teacher)
        target = os.path.join(self.media_dir.name, record.snapshot_path.replace("/", os.sep))

        # 人為放一個暫存檔。
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(os.path.join(os.path.dirname(target), ".tmp-snapshot-zz.part"), "wb") as fh:
            fh.write(b"junk")

        cleanup_orphan_temp_files()

        self.assertTrue(os.path.isfile(target), "真實副本不得被清理函式刪除。")
        self.assertEqual(snapshot_usage_report()["file_count"], 1)


# =====================================================================
# S6. 快照來源是否可能經符號連結逃出允許目錄
# =====================================================================
class S6_SymlinkEscapeTests(SnapshotSecurityTestCase):
    def _make_symlink(self, link_path, target_path):
        """嘗試建立符號連結；環境不允許時回傳 False。"""
        try:
            os.symlink(target_path, link_path)
        except (OSError, NotImplementedError, AttributeError):
            return False
        return os.path.islink(link_path)

    def test_s6a_source_symlink_rejected(self):
        """來源為符號連結時必須拒絕（防止把不可控內容帶進倉庫）。"""
        outside = os.path.join(self.media_dir.name, "outside-real.pt")
        with open(outside, "wb") as handle:
            handle.write(b"outside-content")
        link = os.path.join(self.media_dir.name, "link.pt")
        if not self._make_symlink(link, outside):
            self.skipTest("此平台權限不允許建立符號連結，S6 來源 symlink 防護【未驗證】。")

        with self.assertRaises(SnapshotError) as ctx:
            create_immutable_snapshot(source_path=link, expected_sha256="")
        self.assertEqual(ctx.exception.code, "SOURCE_SYMLINK_REJECTED")

    def test_s6b_snapshot_target_symlink_rejected(self):
        """快照目標為符號連結時必須拒絕。"""
        payload = b"target-symlink-" + uuid.uuid4().hex.encode()
        sha = sha256_bytes(payload)
        relative = snapshot_relative_path(sha)
        target = os.path.join(self.media_dir.name, relative.replace("/", os.sep))
        os.makedirs(os.path.dirname(target), exist_ok=True)

        outside_dir = os.path.join(self.media_dir.name, "outside-dir")
        os.makedirs(outside_dir, exist_ok=True)
        outside_file = os.path.join(outside_dir, "redirected.pt")
        with open(outside_file, "wb") as handle:
            handle.write(b"redirect-target")

        if not self._make_symlink(target, outside_file):
            self.skipTest("此平台權限不允許建立符號連結，S6 目標 symlink 防護【未驗證】。")

        source = os.path.join(self.media_dir.name, "src.pt")
        with open(source, "wb") as handle:
            handle.write(payload)

        with self.assertRaises(SnapshotError) as ctx:
            create_immutable_snapshot(source_path=source, expected_sha256=sha)
        self.assertEqual(ctx.exception.code, "SNAPSHOT_SYMLINK_REJECTED")

    def test_s6c_read_snapshot_rejects_escape_via_traversal(self):
        """讀取時必須阻擋 ../ 路徑穿越。"""
        from learning.vision_snapshot import read_snapshot

        with self.assertRaises(SnapshotError) as ctx:
            read_snapshot("../../outside.pt")
        self.assertEqual(ctx.exception.code, "SNAPSHOT_PATH_ESCAPE")

    def test_s6d_read_snapshot_rejects_absolute_path(self):
        """讀取時必須阻擋絕對路徑。"""
        from learning.vision_snapshot import read_snapshot

        with self.assertRaises(SnapshotError) as ctx:
            read_snapshot(os.path.join(self.media_dir.name, "x.pt"))
        self.assertEqual(ctx.exception.code, "SNAPSHOT_PATH_ABSOLUTE")

    def test_s6e_read_snapshot_rejects_symlinked_snapshot_file(self):
        """紀錄中的相對路徑若指向 symlink，讀取時仍須解析後確認位於 Media 之下。"""
        outside_dir = os.path.join(self.media_dir.name, "outside2")
        os.makedirs(outside_dir, exist_ok=True)
        outside_file = os.path.join(outside_dir, "secret.pt")
        with open(outside_file, "wb") as handle:
            handle.write(b"secret")

        link_name = "vision_repository/ab/link.pt"
        link_abs = os.path.join(self.media_dir.name, link_name.replace("/", os.sep))
        os.makedirs(os.path.dirname(link_abs), exist_ok=True)
        if not self._make_symlink(link_abs, outside_file):
            self.skipTest("此平台權限不允許建立符號連結，S6 symlink 讀取防護【未驗證】。")

        from learning.vision_snapshot import read_snapshot

        # 雖然指向 Media 內的檔案，仍必須能安全解析（不得逃逸）。
        resolved = read_snapshot(link_name)
        self.assertTrue(
            os.path.realpath(resolved).startswith(os.path.realpath(self.media_dir.name))
        )


# =====================================================================
# S8. 目錄連結（NTFS junction / reparse point）逃逸 — 迴歸測試
#
# 背景（2026-10-08 安全審核發現並修復的真實缺陷）：
#     Windows 上除了符號連結之外，還有「目錄連結（junction / reparse point）」。
#     建立 junction **不需要管理員權限**（`mklink /J` 一般帳號即可成功），
#     且 `os.path.islink()` 對 junction **一律回傳 False**。
#     因此舊版 `validate_source_path()` 只檢查 `os.path.islink()` 時，
#     可以在 Media 內放一個 junction 指向 Media 之外，
#     讓外部檔案被當成合法來源複製進模型倉庫。
#
#     修復：額外要求「解析後的真實路徑」仍須位於 Media 根目錄之下。
#     本類別即為此修復的回歸測試；junction 不需管理員權限，
#     因此在本機（Windows、非管理員、未開開發者模式）可實際執行、不會 SKIP。
# =====================================================================
class S8_JunctionEscapeRegressionTests(SnapshotSecurityTestCase):
    def _make_junction(self, link_path, target_path):
        """嘗試建立 NTFS 目錄連結；環境不支援時回傳 False。"""
        if os.name != "nt":
            return False
        try:
            result = subprocess.run(
                ["cmd", "/c", "mklink", "/J", link_path, target_path],
                capture_output=True,
                text=True,
            )
        except (OSError, FileNotFoundError):
            return False
        if result.returncode != 0:
            return False
        # junction 通過 realpath 會解析到目標，但 islink() 為 False，以此確認。
        return os.path.isdir(link_path)

    def test_s8a_source_junction_escaping_media_is_rejected(self):
        """來源經 junction 指向 Media 之外時，必須拒絕（修復前的真實漏洞）。"""
        # Media 之外的獨立目錄（模擬攻擊者可控位置）。
        with TemporaryDirectory() as outside_dir:
            secret = os.path.join(outside_dir, "secret.pt")
            with open(secret, "wb") as handle:
                handle.write(b"OUTSIDE-SECRET-CONTENT")

            link = os.path.join(self.media_dir.name, "evil-junction")
            if not self._make_junction(link, outside_dir):
                self.skipTest("此平台不支援建立目錄連結，S8 junction 來源防護【未驗證】。")

            # 前提確認：junction 確實逃出 Media，且 islink() 看不到它。
            via_link = os.path.join(link, "secret.pt")
            self.assertTrue(os.path.isfile(via_link))
            self.assertFalse(os.path.islink(via_link))
            self.assertFalse(
                os.path.realpath(via_link).startswith(
                    os.path.realpath(self.media_dir.name)
                )
            )

            with self.assertRaises(SnapshotError) as ctx:
                validate_source_path(via_link)
            self.assertEqual(ctx.exception.code, "SOURCE_SYMLINK_REJECTED")

    def test_s8b_create_snapshot_from_junction_source_is_rejected(self):
        """create_immutable_snapshot 亦不得接受經 junction 逃逸的來源。"""
        with TemporaryDirectory() as outside_dir:
            secret = os.path.join(outside_dir, "secret.pt")
            payload = b"OUTSIDE-SECRET-" + uuid.uuid4().hex.encode()
            with open(secret, "wb") as handle:
                handle.write(payload)

            link = os.path.join(self.media_dir.name, "evil-junction-2")
            if not self._make_junction(link, outside_dir):
                self.skipTest("此平台不支援建立目錄連結，S8 junction 來源防護【未驗證】。")

            via_link = os.path.join(link, "secret.pt")
            with self.assertRaises(SnapshotError) as ctx:
                create_immutable_snapshot(
                    source_path=via_link, expected_sha256=sha256_bytes(payload)
                )
            self.assertEqual(ctx.exception.code, "SOURCE_SYMLINK_REJECTED")

            # 確認倉庫內沒有被寫入任何外部內容。
            repo_root = os.path.join(self.media_dir.name, "vision_repository")
            written = []
            for dirpath, _dirnames, filenames in os.walk(repo_root):
                for name in filenames:
                    written.append(os.path.join(dirpath, name))
            self.assertEqual(
                written, [], "junction 來源被拒絕後，倉庫內不得留下任何快照檔案。"
            )

    def test_s8c_legit_source_inside_media_still_accepted(self):
        """對照組：Media 內的正常來源仍必須被接受（避免修復過度）。"""
        payload = b"legit-" + uuid.uuid4().hex.encode()
        source = os.path.join(self.media_dir.name, "legit-best.pt")
        with open(source, "wb") as handle:
            handle.write(payload)

        resolved = validate_source_path(source)
        self.assertEqual(os.path.realpath(resolved), os.path.realpath(source))

        result = create_immutable_snapshot(
            source_path=source, expected_sha256=sha256_bytes(payload)
        )
        self.assertEqual(result["sha256"], sha256_bytes(payload))
        self.assertFalse(result["deduplicated"])
        self.assertEqual(result["size_bytes"], len(payload))


# =====================================================================
# S7. 原始檔案在雜湊與複製期間被替換時是否能偵測
# =====================================================================
class S7_SourceSwapDetectionTests(SnapshotSecurityTestCase):
    def test_s7a_source_swapped_before_copy_is_detected(self):
        """來源在雜湊完成後、複製前被替換 → 複製後雜湊不符，必須偵測並拒絕。"""
        original = b"original-payload-" + uuid.uuid4().hex.encode()
        swapped = b"swapped-payload-" + uuid.uuid4().hex.encode()
        self.assertNotEqual(sha256_bytes(original), sha256_bytes(swapped))

        source = os.path.join(self.media_dir.name, "swap-source.pt")
        with open(source, "wb") as handle:
            handle.write(original)

        import learning.vision_snapshot as vs

        real_hash_file = vs.hash_file
        call_state = {"count": 0}

        def swapping_hash_file(path):
            """第一次計算來源雜湊後，立刻把來源換成不同內容。"""
            digest = real_hash_file(path)
            call_state["count"] += 1
            if call_state["count"] == 1:
                with open(path, "wb") as handle:
                    handle.write(swapped)
            return digest

        vs.hash_file = swapping_hash_file
        try:
            with self.assertRaises(SnapshotError) as ctx:
                create_immutable_snapshot(source_path=source, expected_sha256="")
            self.assertEqual(
                ctx.exception.code,
                "SNAPSHOT_COPY_MISMATCH",
                "來源被替換後，複製期間計算的雜湊應與來源雜湊不符。",
            )
        finally:
            vs.hash_file = real_hash_file

        self.assertEqual(list_temp_files(self._snapshot_root()), [], "失敗時必須清除暫存檔。")

    def test_s7b_catalogue_detects_source_swapped_after_intake_hash(self):
        """入庫流程中來源被替換 → 應以雜湊不符拒絕，不得建立紀錄。

        呼叫序列（已以追蹤腳本確認，新建副本路徑）：
            1. `hash_evidence_artifact()` — 入庫前完整性檢查（經 storage 讀取）。
            2. `create_immutable_snapshot()` 內 `hash_file()` — 計算來源雜湊。
        因此在第 1 步完成後立刻替換來源，第 2 步就會讀到不同內容，
        其結果與第 1 步的 `expected_sha256` 不符 ⇒ `SNAPSHOT_SOURCE_MISMATCH`。
        """
        original = b"intake-original-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(original)

        import learning.vision_repository as repo

        real_hash_evidence = repo.hash_evidence_artifact
        state = {"swapped": False}

        def hash_then_swap(ev):
            digest = real_hash_evidence(ev)
            if not state["swapped"]:
                state["swapped"] = True
                # 在入庫檢查完成後、建立快照之前替換來源內容。
                with open(ev.upload.path, "wb") as handle:
                    handle.write(b"TOTALLY-DIFFERENT-CONTENT")
            return digest

        repo.hash_evidence_artifact = hash_then_swap
        try:
            with self.assertRaises(IntakeError) as ctx:
                repo.catalogue_model(evidence=evidence, teacher=self.teacher)
            self.assertIn(
                ctx.exception.code,
                (
                    "SNAPSHOT_SNAPSHOT_SOURCE_MISMATCH",
                    "SNAPSHOT_SNAPSHOT_COPY_MISMATCH",
                    "SHA256_MISMATCH",
                ),
                f"來源被替換必須被偵測；實際錯誤碼 {ctx.exception.code}",
            )
        finally:
            repo.hash_evidence_artifact = real_hash_evidence

        self.assertFalse(VisionModelRecord.objects.filter(evidence=evidence).exists())
        self.assertEqual(snapshot_usage_report()["file_count"], 0)
        self.assertEqual(list_temp_files(self._snapshot_root()), [], "不得留下暫存檔。")

    def test_s7c_snapshot_matches_source_at_creation_time(self):
        """正常路徑下，副本內容必須與「建立當下」的來源完全一致。"""
        payload = b"match-at-creation-" + uuid.uuid4().hex.encode()
        evidence = self._evidence(payload)
        expected = hash_file(evidence.upload.path)

        record = catalogue_model(evidence=evidence, teacher=self.teacher)
        target = os.path.join(self.media_dir.name, record.snapshot_path.replace("/", os.sep))

        self.assertEqual(hash_file(target), expected)
        self.assertEqual(record.snapshot_sha256, expected)
        self.assertEqual(record.artifact_sha256, expected)


# =====================================================================
# 附加：整體性驗證（不得載入 .pt）
# =====================================================================
class SnapshotNoDeserializationTests(SnapshotSecurityTestCase):
    def test_x1_no_pt_loading_api_used(self):
        """確認模組未引用任何模型載入 / 反序列化 API。"""
        import ast
        import inspect

        import learning.vision_snapshot as vs

        source = inspect.getsource(vs)
        tree = ast.parse(source)
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    imported.add(alias.name.split(".")[0])
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])

        forbidden = {"torch", "pickle", "joblib", "dill", "cloudpickle", "onnx", "tensorflow"}
        self.assertEqual(
            imported & forbidden,
            set(),
            f"快照模組不得匯入任何模型反序列化套件：{imported & forbidden}",
        )

    def test_x2_arbitrary_bytes_are_treated_as_opaque(self):
        """任意位元組（含 pickle 魔數）皆以純位元組處理，不被解析。"""
        # 這段位元組刻意以 pickle protocol 魔數開頭，若被反序列化會嘗試執行。
        payload = b"\x80\x04\x95\x00\x00\x00\x00\x00\x00\x00\x00NOT-A-REAL-OBJECT"
        evidence = self._evidence(payload)
        record = catalogue_model(evidence=evidence, teacher=self.teacher)

        self.assertEqual(record.snapshot_sha256, sha256_bytes(payload))
        target = os.path.join(self.media_dir.name, record.snapshot_path.replace("/", os.sep))
        with open(target, "rb") as handle:
            self.assertEqual(handle.read(), payload, "副本必須逐位元組相同。")
