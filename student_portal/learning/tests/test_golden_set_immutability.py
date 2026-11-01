"""FROZEN 不可變性對抗性測試（2026-10-09 第 25 輪 P1 修復）。

本檔專門驗證「二、FROZEN 不可變性修復」所要求的每一條：

    A. ORM save()            → 必須被擋
    B. ORM delete()          → 必須被擋
    C. QuerySet.update()     → 必須被擋
    D. QuerySet.delete()     → 必須被擋
    E. bulk_update()         → 必須被擋
    F. bulk_create()         → 必須被擋
    G. 併發（執行緒）寫入    → 必須被擋
    H. 記憶體舊實例繞過      → 必須被擋（狀態以資料庫為準）
    I. Manifest SHA256       → 修復後仍可驗證、仍能偵測竄改
    J. 正常 FROZEN 操作      → 不受影響（回歸）
    K. DRAFT 版本            → 完全不受影響（回歸）
    L. 原生 SQL              → 殘餘風險，明確記錄為「未受保護」

邊界宣告：
- 本檔**不載入、不反序列化、不執行任何 .pt**。
- 本檔不執行訓練、不部署、不啟用 ACTIVE。
- 本檔不觸碰正式 DB / 正式 JSON Store（Django TestCase 自帶 transaction rollback）。
"""

import threading
import unittest

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, transaction
from django.test import TestCase

from learning.golden_set import (
    GoldenSetError,
    add_sample,
    confirm_sample,
    create_golden_set,
    freeze_golden_set,
    manifest_sha256,
    verify_manifest_sha256,
)
from learning.golden_set_guard import (
    FrozenGoldenSetError,
    is_installed,
    residual_risks,
)
from learning.models import Cohort, GoldenSet, GoldenSetSample, TeacherCohortAccess

PROP_LABELS = ("CW", "CCW")


def _image(name="sample.jpg", size=64):
    """產生一張極小的合法影像位元組（僅測試檔案保存，不解析影像）。"""
    payload = b"\xff\xd8\xff\xe0" + b"G" * max(size - 4, 1)
    return SimpleUploadedFile(name, payload, content_type="image/jpeg")


class _GoldenFixture(TestCase):
    """共用：建立一個教師、一個班級，以及可立即鎖定的 Golden Set。"""

    def setUp(self):
        self.cohort = Cohort.objects.create(cohort_id="R25-A", name="P1修復班")
        self.teacher = get_user_model().objects.create_user(
            username="r25-teacher@example.test",
            password="Teacher-pass-925!",
            is_staff=True,
        )
        TeacherCohortAccess.objects.create(teacher=self.teacher, cohort=self.cohort)

    def _draft_set(self, version="v1"):
        return create_golden_set(
            teacher=self.teacher, name="P1 修復測試集", cohort=self.cohort, version=version
        )

    def _fill_four(self, golden_set):
        """四類各一張且皆已確認（滿足鎖定條件）。"""
        samples = {}
        for label in PROP_LABELS:
            samples[label] = add_sample(
                golden_set=golden_set,
                teacher=self.teacher,
                image=_image(f"{label}.jpg"),
                label=label,
                confirm_now=True,
            )
        golden_set.refresh_from_db()
        return samples

    def _frozen_set(self, version="v1"):
        golden_set = self._draft_set(version=version)
        samples = self._fill_four(golden_set)
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)
        golden_set.refresh_from_db()
        return golden_set, samples


# ===========================================================================
# 0. 守衛確實已掛載
# ===========================================================================

class GuardInstallationTests(TestCase):
    def test_a_guard_is_installed(self):
        """守衛必須在模型載入時自動生效。"""
        self.assertTrue(is_installed())

    def test_b_residual_risks_are_declared(self):
        """殘餘風險清單不可為空——不得宣稱完全防護。"""
        risks = residual_risks()
        self.assertTrue(len(risks) >= 4)
        joined = "".join(risks)
        self.assertIn("原生 SQL", joined)
        self.assertIn("Trigger", joined)


# ===========================================================================
# A–F. ORM 全入口
# ===========================================================================

class FrozenSampleOrmBlockingTests(_GoldenFixture):
    """A~F：所有 ORM 寫入入口在 FROZEN 後必須全部被擋。"""

    def setUp(self):
        super().setUp()
        self.golden_set, self.samples = self._frozen_set()
        self.sample = self.samples["CW"]

    # --- A. save() --------------------------------------------------------
    def test_a_save_is_blocked(self):
        """修改欄位後 save() 必須被擋，且資料庫內容不變。"""
        before = GoldenSetSample.objects.get(pk=self.sample.pk).label
        self.sample.label = "CCW"
        with self.assertRaises(FrozenGoldenSetError) as ctx:
            self.sample.save()
        self.assertEqual(ctx.exception.code, "GOLDEN_SET_FROZEN")
        after = GoldenSetSample.objects.get(pk=self.sample.pk).label
        self.assertEqual(before, after, "save() 被擋後資料庫不得有任何變更。")

    def test_a2_save_with_update_fields_is_blocked(self):
        """save(update_fields=...) 同樣必須被擋（常見的窄寫入繞道）。"""
        with self.assertRaises(FrozenGoldenSetError):
            GoldenSetSample.objects.get(pk=self.sample.pk).save(update_fields=["label"])

    def test_a3_full_clean_does_not_bypass(self):
        """full_clean() 通過不代表可以寫入；save() 仍須被擋。"""
        s = GoldenSetSample.objects.get(pk=self.sample.pk)
        s.label = "CCW"
        try:
            s.full_clean()
        except Exception:
            pass  # 驗證結果不是重點
        with self.assertRaises(FrozenGoldenSetError):
            s.save()

    # --- B. delete() ------------------------------------------------------
    def test_b_delete_is_blocked(self):
        """實例 delete() 必須被擋，樣本數不變。"""
        count_before = GoldenSetSample.objects.filter(golden_set=self.golden_set).count()
        with self.assertRaises(FrozenGoldenSetError):
            self.sample.delete()
        count_after = GoldenSetSample.objects.filter(golden_set=self.golden_set).count()
        self.assertEqual(count_before, count_after)
        self.assertTrue(GoldenSetSample.objects.filter(pk=self.sample.pk).exists())

    # --- C. QuerySet.update() --------------------------------------------
    def test_c_queryset_update_is_blocked(self):
        """QuerySet.update() 必須被擋（服務層原本完全擋不住這條）。"""
        with self.assertRaises(FrozenGoldenSetError):
            GoldenSetSample.objects.filter(golden_set=self.golden_set).update(label="CW")
        self.assertEqual(
            GoldenSetSample.objects.get(pk=self.sample.pk).label, "CW"
        )

    def test_c2_queryset_update_on_single_pk_is_blocked(self):
        with self.assertRaises(FrozenGoldenSetError):
            GoldenSetSample.objects.filter(pk=self.sample.pk).update(label="CW")

    def test_c3_queryset_update_with_related_filter_is_blocked(self):
        """即使過濾條件走關聯（golden_set__status），也必須命中守衛。"""
        with self.assertRaises(FrozenGoldenSetError):
            GoldenSetSample.objects.filter(
                golden_set__golden_set_id=self.golden_set.golden_set_id
            ).update(note="tampered")

    # --- D. QuerySet.delete() --------------------------------------------
    def test_d_queryset_delete_is_blocked(self):
        """QuerySet.delete() 必須被擋。"""
        count_before = GoldenSetSample.objects.filter(golden_set=self.golden_set).count()
        with self.assertRaises(FrozenGoldenSetError):
            GoldenSetSample.objects.filter(golden_set=self.golden_set).delete()
        self.assertEqual(
            GoldenSetSample.objects.filter(golden_set=self.golden_set).count(), count_before
        )

    def test_d2_queryset_delete_by_label_is_blocked(self):
        """依 label 篩選刪除（測試檔既有的繞道手法）必須被擋。"""
        with self.assertRaises(FrozenGoldenSetError):
            GoldenSetSample.objects.filter(label="CCW").delete()
        self.assertTrue(GoldenSetSample.objects.filter(label="CCW").exists())

    def test_d3_queryset_delete_all_is_blocked(self):
        with self.assertRaises(FrozenGoldenSetError):
            GoldenSetSample.objects.all().delete()

    # --- E. bulk_update() -------------------------------------------------
    def test_e_bulk_update_is_blocked(self):
        """bulk_update() 必須被擋。"""
        rows = list(GoldenSetSample.objects.filter(golden_set=self.golden_set))
        for row in rows:
            row.label = "CW"
        with self.assertRaises(FrozenGoldenSetError):
            GoldenSetSample.objects.bulk_update(rows, ["label"])
        self.assertEqual(
            GoldenSetSample.objects.get(pk=self.sample.pk).label, "CW"
        )

    # --- F. bulk_create() -------------------------------------------------
    def test_f_bulk_create_is_blocked(self):
        """bulk_create() 新增樣本必須被擋。"""
        count_before = GoldenSetSample.objects.filter(golden_set=self.golden_set).count()
        new_rows = [
            GoldenSetSample(
                golden_set=self.golden_set,
                image=f"golden_set/bulk{i}.jpg",
                label="CW",
            )
            for i in range(2)
        ]
        with self.assertRaises(FrozenGoldenSetError):
            GoldenSetSample.objects.bulk_create(new_rows)
        self.assertEqual(
            GoldenSetSample.objects.filter(golden_set=self.golden_set).count(), count_before
        )

    def test_f2_queryset_create_is_blocked(self):
        """Manager.create() 亦為新增入口，必須被擋。"""
        with self.assertRaises(FrozenGoldenSetError):
            GoldenSetSample.objects.create(
                golden_set=self.golden_set,
                image="golden_set/create-bypass.jpg",
                label="CW",
            )

    def test_f3_get_or_create_is_blocked(self):
        """get_or_create() 的**新增分支**必須被擋。

        注意：必須用一個「尚未存在」的查詢條件，否則會走 GET 命中既有列
        的分支（該分支不寫入，本來就應該放行）。
        """
        with self.assertRaises(FrozenGoldenSetError):
            GoldenSetSample.objects.get_or_create(
                golden_set=self.golden_set,
                note="不存在的備註",
                defaults={"image": "golden_set/goc.jpg", "label": "CW"},
            )

    def test_f3b_get_or_create_existing_row_is_allowed(self):
        """既有列命中的分支不得被守衛誤擋（避免破壞正常呼叫端）。"""
        existing, created = GoldenSetSample.objects.get_or_create(
            golden_set=self.golden_set,
            label="CW",
            defaults={"image": "golden_set/should-not-be-used.jpg"},
        )
        self.assertFalse(created)
        self.assertEqual(existing.pk, self.sample.pk)


# ===========================================================================
# G. 併發
# ===========================================================================

class FrozenConcurrencyTests(_GoldenFixture):
    """G：併發寫入不得繞過鎖定。

    SQLite 在同檔多連線下的寫入鎖行為較特殊，因此本測試以兩種方式驗證：

    1. **執行緒競態**：多執行緒同時嘗試改寫同一樣本，期望「全數失敗」。
    2. **交錯時序**：先載入 DRAFT 實例 → 另一路徑鎖定 → 再用舊實例寫入，
       這是實務上最真實的繞道情境。
    """

    def test_g1_concurrent_save_all_blocked(self):
        golden_set, samples = self._frozen_set()
        target_pk = samples["CW"].pk
        errors = []
        successes = []

        def worker(new_label):
            try:
                row = GoldenSetSample.objects.get(pk=target_pk)
                row.label = new_label
                row.save()
                successes.append(new_label)
            except FrozenGoldenSetError:
                errors.append(new_label)
            except Exception as exc:  # DB 鎖等其他錯誤也算「未成功寫入」
                errors.append(f"other:{type(exc).__name__}")

        threads = [
            threading.Thread(target=worker, args=(label,))
            for label in ("CW", "CCW", "CCW", "CW")
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(successes, [], f"不得有任何執行緒寫入成功：{successes}")
        self.assertEqual(len(errors), 4)
        self.assertEqual(
            GoldenSetSample.objects.get(pk=target_pk).label, "CW"
        )

    def test_g2_stale_in_memory_instance_cannot_bypass(self):
        """先載入（DRAFT）→ 他處鎖定 → 用舊實例寫入，仍必須被擋。

        守衛以資料庫狀態為準，不信任 `self.golden_set.status` 記憶體值。
        """
        golden_set = self._draft_set(version="v9")
        samples = self._fill_four(golden_set)
        golden_set.refresh_from_db()

        # 在鎖定「之前」就把樣本實例載入記憶體，且此時父集合仍是 DRAFT。
        stale = GoldenSetSample.objects.get(pk=samples["CW"].pk)
        self.assertFalse(stale.golden_set.is_frozen, "前置條件：載入時仍為 DRAFT")

        # 另一路徑完成鎖定（stale 實例記憶體中的父集合狀態不會被更新）。
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)

        stale.label = "CCW"
        with self.assertRaises(FrozenGoldenSetError) as ctx:
            stale.save()
        self.assertEqual(ctx.exception.code, "GOLDEN_SET_FROZEN")
        self.assertEqual(
            GoldenSetSample.objects.get(pk=stale.pk).label, "CW"
        )

    def test_g3_stale_instance_delete_cannot_bypass(self):
        """同上情境，但走 delete()。"""
        golden_set = self._draft_set(version="v10")
        samples = self._fill_four(golden_set)
        golden_set.refresh_from_db()
        stale = GoldenSetSample.objects.get(pk=samples["CW"].pk)
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)

        with self.assertRaises(FrozenGoldenSetError):
            stale.delete()
        self.assertTrue(GoldenSetSample.objects.filter(pk=stale.pk).exists())

    def test_g4_cached_queryset_result_cannot_bypass_update(self):
        """先建立 QuerySet（DRAFT 時）→ 鎖定 → 再 update，仍必須被擋。

        QuerySet 是惰性的，真正的 SQL 在求值時才產生，因此必須以
        「求值當下的資料庫狀態」判定，不能以建立時的快照判定。
        """
        golden_set = self._draft_set(version="v11")
        self._fill_four(golden_set)
        golden_set.refresh_from_db()

        lazy_qs = GoldenSetSample.objects.filter(golden_set=golden_set)
        freeze_golden_set(golden_set=golden_set, teacher=self.teacher)

        with self.assertRaises(FrozenGoldenSetError):
            lazy_qs.update(label="CW")


# ===========================================================================
# H. GoldenSet 版本層
# ===========================================================================

class FrozenGoldenSetVersionTests(_GoldenFixture):
    """H：FROZEN 的 GoldenSet 本身也不得被改動鎖定契約。"""

    def test_h1_status_cannot_be_reverted_to_draft(self):
        """不得把 FROZEN 改回 DRAFT（否則等於解鎖）。"""
        golden_set, _ = self._frozen_set(version="v20")
        golden_set.status = GoldenSet.Status.DRAFT
        with self.assertRaises(FrozenGoldenSetError):
            golden_set.save()
        self.assertEqual(
            GoldenSet.objects.get(pk=golden_set.pk).status, "FROZEN"
        )

    def test_h2_manifest_sha256_cannot_be_rewritten(self):
        """不得改寫已鎖定的 Manifest 雜湊。"""
        golden_set, _ = self._frozen_set(version="v21")
        golden_set.manifest_sha256 = "0" * 64
        with self.assertRaises(FrozenGoldenSetError):
            golden_set.save()
        self.assertNotEqual(
            GoldenSet.objects.get(pk=golden_set.pk).manifest_sha256, "0" * 64
        )

    def test_h3_frozen_at_cannot_be_rewritten(self):
        golden_set, _ = self._frozen_set(version="v22")
        golden_set.frozen_at = None
        with self.assertRaises(FrozenGoldenSetError):
            golden_set.save()
        self.assertIsNotNone(GoldenSet.objects.get(pk=golden_set.pk).frozen_at)

    def test_h4_frozen_set_delete_is_blocked(self):
        """不得刪除已鎖定的 Golden Set（連帶會刪掉全部樣本）。"""
        golden_set, _ = self._frozen_set(version="v23")
        with self.assertRaises(FrozenGoldenSetError):
            golden_set.delete()
        self.assertTrue(GoldenSet.objects.filter(pk=golden_set.pk).exists())

    def test_h5_queryset_delete_of_frozen_set_is_blocked(self):
        golden_set, _ = self._frozen_set(version="v24")
        with self.assertRaises(FrozenGoldenSetError):
            GoldenSet.objects.filter(pk=golden_set.pk).delete()
        self.assertTrue(GoldenSet.objects.filter(pk=golden_set.pk).exists())


# ===========================================================================
# I. Manifest SHA256 一致性（保留原有驗證）
# ===========================================================================

class ManifestAfterRepairTests(_GoldenFixture):
    """I：修復不得破壞原有 Manifest SHA256 驗證。"""

    def test_i1_frozen_set_is_bound_after_freeze(self):
        golden_set, _ = self._frozen_set(version="v30")
        self.assertEqual(golden_set.manifest_binding_status, "BOUND")
        self.assertTrue(
            verify_manifest_sha256(golden_set, golden_set.manifest_sha256)
        )
        self.assertFalse(verify_manifest_sha256(golden_set, "0" * 64))

    def test_i2_manifest_is_reproducible(self):
        """同一份內容重算兩次必須得到相同雜湊（可重現）。"""
        golden_set, _ = self._frozen_set(version="v31")
        first = manifest_sha256(golden_set)
        second = manifest_sha256(golden_set)
        self.assertEqual(first, second)
        self.assertEqual(first, golden_set.manifest_sha256)

    def test_i3_blocked_write_does_not_change_manifest(self):
        """被擋下的寫入不得讓 Manifest 從 BOUND 變成 MISMATCH。"""
        golden_set, samples = self._frozen_set(version="v32")
        recorded = golden_set.manifest_sha256

        for attempt in (
            lambda: setattr(samples["CW"], "label", "CW") or samples["CW"].save(),
            lambda: GoldenSetSample.objects.filter(golden_set=golden_set).update(label="CW"),
            lambda: GoldenSetSample.objects.filter(golden_set=golden_set).delete(),
        ):
            with self.assertRaises(FrozenGoldenSetError):
                attempt()

        golden_set.refresh_from_db()
        self.assertEqual(golden_set.manifest_sha256, recorded)
        self.assertEqual(golden_set.manifest_binding_status, "BOUND")
        self.assertEqual(manifest_sha256(golden_set), recorded)

    def test_i4_detection_still_works_via_raw_sql(self):
        """**殘餘風險示範**：原生 SQL 繞過守衛，但仍被 Manifest 偵測到。

        本測試刻意使用 raw SQL 以證明兩件事：
          (1) 守衛**確實擋不住**原生 SQL → 列為殘餘風險，不得宣稱完全防護；
          (2) 原本就有的**偵測能力**（manifest_binding_status = MISMATCH）仍在。
        """
        golden_set, samples = self._frozen_set(version="v33")
        self.assertEqual(golden_set.manifest_binding_status, "BOUND")
        recorded = golden_set.manifest_sha256

        raw_pk = str(samples["CW"].pk).replace("-", "")
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE learning_goldensetsample SET label = %s WHERE sample_id = %s",
                ["CCW", raw_pk],
            )
            self.assertEqual(cursor.rowcount, 1, "前置條件：原生 SQL 應能寫入")

        golden_set.refresh_from_db()
        self.assertNotEqual(manifest_sha256(golden_set), recorded)
        self.assertEqual(golden_set.manifest_binding_status, "MISMATCH")


# ===========================================================================
# J/K. 回歸：正常操作不受影響
# ===========================================================================

class DraftUnaffectedTests(_GoldenFixture):
    """K：DRAFT 版本的所有操作必須完全不受守衛影響。"""

    def test_k1_draft_save_update_delete_still_work(self):
        golden_set = self._draft_set(version="v40")
        samples = self._fill_four(golden_set)

        # save()
        target = GoldenSetSample.objects.get(pk=samples["CW"].pk)
        target.label = "CW"
        target.save()
        self.assertEqual(
            GoldenSetSample.objects.get(pk=target.pk).label, "CW"
        )

        # QuerySet.update()
        GoldenSetSample.objects.filter(pk=target.pk).update(label="CW")
        self.assertEqual(
            GoldenSetSample.objects.get(pk=target.pk).label, "CW"
        )

        # bulk_update()
        rows = list(GoldenSetSample.objects.filter(golden_set=golden_set))
        for row in rows:
            row.note = "draft-note"
        GoldenSetSample.objects.bulk_update(rows, ["note"])
        self.assertEqual(
            GoldenSetSample.objects.filter(note="draft-note").count(), len(rows)
        )

        # QuerySet.delete()
        GoldenSetSample.objects.filter(pk=target.pk).delete()
        self.assertFalse(GoldenSetSample.objects.filter(pk=target.pk).exists())

    def test_k2_draft_add_sample_service_still_works(self):
        """服務層 add_sample 在 DRAFT 下必須照常運作。"""
        golden_set = self._draft_set(version="v41")
        sample = add_sample(
            golden_set=golden_set,
            teacher=self.teacher,
            image=_image("draft-ok.jpg"),
            label="CW",
        )
        self.assertIsNotNone(sample.pk)
        self.assertEqual(sample.confirmation_status, "PENDING")

    def test_k3_draft_golden_set_metadata_editable(self):
        golden_set = self._draft_set(version="v42")
        golden_set.name = "改名後的測試集"
        golden_set.description = "更新說明"
        golden_set.save()
        golden_set.refresh_from_db()
        self.assertEqual(golden_set.name, "改名後的測試集")

    def test_k4_draft_set_can_be_deleted(self):
        golden_set = self._draft_set(version="v43")
        pk = golden_set.pk
        golden_set.delete()
        self.assertFalse(GoldenSet.objects.filter(pk=pk).exists())


class FrozenNormalOperationsTests(_GoldenFixture):
    """J：FROZEN 後「合法的唯讀／既有流程」必須照常運作。"""

    def test_j1_frozen_reads_work(self):
        golden_set, _ = self._frozen_set(version="v50")
        self.assertEqual(golden_set.sample_count, 2)
        self.assertEqual(golden_set.confirmed_sample_count, 2)
        self.assertEqual(golden_set.missing_labels(), [])
        self.assertEqual(
            GoldenSetSample.objects.filter(golden_set=golden_set).count(), 2
        )

    def test_j2_frozen_description_edit_is_allowed(self):
        """`description` 不在 Manifest 契約中，FROZEN 後允許調整。

        注意：`name` **有**進入 build_manifest()，因此 FROZEN 後
        **不可**改名——否則 Manifest 會變成 MISMATCH。改名需求必須建新版本。
        """
        golden_set, _ = self._frozen_set(version="v51")
        recorded = golden_set.manifest_sha256
        golden_set.description = "學期結束後補充說明"
        golden_set.save(update_fields=["description", "updated_at"])
        golden_set.refresh_from_db()
        self.assertEqual(golden_set.description, "學期結束後補充說明")
        self.assertEqual(golden_set.manifest_sha256, recorded)
        self.assertEqual(golden_set.manifest_binding_status, "BOUND")

    def test_j2b_frozen_name_change_is_blocked(self):
        """`name` 屬 Manifest 契約欄位，FROZEN 後改名必須被擋。"""
        golden_set, _ = self._frozen_set(version="v51b")
        recorded = golden_set.manifest_sha256
        golden_set.name = "偷偷改名"
        with self.assertRaises(FrozenGoldenSetError):
            golden_set.save(update_fields=["name", "updated_at"])
        golden_set.refresh_from_db()
        self.assertNotEqual(golden_set.name, "偷偷改名")
        self.assertEqual(golden_set.manifest_sha256, recorded)
        self.assertEqual(golden_set.manifest_binding_status, "BOUND")

    def test_j3_freeze_twice_is_still_rejected_by_service_layer(self):
        """服務層原本的「已鎖定不得再鎖」行為必須保留。"""
        golden_set, _ = self._frozen_set(version="v52")
        with self.assertRaises(GoldenSetError) as ctx:
            freeze_golden_set(golden_set=golden_set, teacher=self.teacher)
        self.assertEqual(ctx.exception.code, "GOLDEN_SET_ALREADY_FROZEN")

    def test_j4_service_layer_still_rejects_add_and_confirm(self):
        """服務層既有的拒絕碼 GOLDEN_SET_FROZEN 必須保持不變。"""
        golden_set, samples = self._frozen_set(version="v53")
        with self.assertRaises(GoldenSetError) as ctx:
            add_sample(
                golden_set=golden_set,
                teacher=self.teacher,
                image=_image("blocked.jpg"),
                label="CW",
            )
        self.assertEqual(ctx.exception.code, "GOLDEN_SET_FROZEN")

        with self.assertRaises(GoldenSetError) as ctx:
            confirm_sample(sample=samples["CW"], teacher=self.teacher)
        self.assertEqual(ctx.exception.code, "GOLDEN_SET_FROZEN")

    def test_j5_mutation_blocked_reason_unchanged(self):
        """既有 View 層使用的文案不得改變。"""
        golden_set, _ = self._frozen_set(version="v54")
        self.assertEqual(
            golden_set.mutation_blocked_reason(),
            "此測試集版本已鎖定（FROZEN），不得再新增、修改或刪除樣本。",
        )


class ResiduaRiskDocumentedTests(TestCase):
    """L：殘餘風險必須被明確記錄（不得宣稱完全防護）。"""

    def test_l1_raw_sql_is_not_protected(self):
        """明確記錄：原生 SQL 不受守衛保護。"""
        risks = "".join(residual_risks())
        self.assertIn("原生 SQL", risks)

    def test_l2_no_db_trigger_on_sqlite(self):
        """明確記錄：SQLite 未建立 DB Trigger。"""
        vendor = connection.vendor
        if vendor != "sqlite":
            self.skipTest("本專案正式環境為 PostgreSQL，此項針對 SQLite 驗證。")
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type = 'trigger'"
            )
            triggers = [row[0] for row in cursor.fetchall()]
        self.assertEqual(
            triggers,
            [],
            "目前不建立 DB Trigger；若未來新增，本測試與報告須同步更新。",
        )
        self.assertIn("Trigger", "".join(residual_risks()))
