#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P4.2 多班級驗收 — 獨立測試資料庫種子（2026-10-13 教師指令第三項）。

建立：2 個班級、每班 3 位學員、2 位授權範圍不同的教師、
0／1–7／8 項提交的學員、待複核／已複核／需要補充紀錄、
不同提交時間與缺失時間，以及任務提交（含無 R 槽位對應者）。

安全設計：
  1. 僅允許寫入檔名含 p42_verify 的獨立測試庫（DJANGO_DB_NAME），否則中止。
  2. 不連線、不寫入 DEMO 庫與正式庫；不覆蓋既有 DEMO 學員紀錄。
  3. 冪等：先刪除本腳本建立的 P42 班級／教師／學員，再重建。
  4. 憑證不寫入程式：教師密碼由環境變數或既有憑證檔載入。
"""
import os
import sys
from datetime import timedelta

DB_PATH = os.environ.get("DJANGO_DB_NAME", "")
if "p42_verify" not in DB_PATH:
    print("[安全停止] DJANGO_DB_NAME 必須指向 p42_verify 獨立測試庫，目前為：%r" % DB_PATH)
    sys.exit(2)
if "demo.sqlite3" in DB_PATH or os.path.join("student_portal", "db.sqlite3") in DB_PATH:
    print("[安全停止] 拒絕對 DEMO／正式資料庫寫入：%r" % DB_PATH)
    sys.exit(2)

# P5：本腳本會建立成果證據（含圖片檔案）→ 媒體目錄必須是隔離的 demo/runtime 路徑，
# 否則會寫入正式媒體目錄。
MEDIA_PATH = os.environ.get("DJANGO_MEDIA_ROOT", "")
if not MEDIA_PATH or "runtime" not in MEDIA_PATH.replace("\\", "/"):
    print("[安全停止] 需設定隔離的 DJANGO_MEDIA_ROOT（含 runtime）：目前為 %r" % MEDIA_PATH)
    sys.exit(2)

sys.path.insert(0, r"D:\FDE-AI-UAS-v2.0\student_portal")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django.utils import timezone  # noqa: E402

from learning.growth_records import ensure_growth_submissions  # noqa: E402
from learning.models import (  # noqa: E402
    Cohort,
    Enrollment,
    GrowthRecordSubmission,
    PhaseProgress,
    StudentProfile,
    StudentTaskProgress,
    TaskDefinition,
    TeacherCohortAccess,
)

TEACHER_A_EMAIL = "p42.teacher.a@fde-demo.local"
TEACHER_B_EMAIL = "p42.teacher.b@fde-demo.local"
COHORT_A_ID = "P42-A-2026"
COHORT_B_ID = "P42-B-2026"
# P5：無任何學員的空班級（供「無資料空狀態」驗收；授權給 A 師）。
COHORT_C_ID = "P42-C-2026"

RESULTS = []


def step(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    print("%s - %s%s" % ("OK  " if ok else "FAIL", name, (" | " + detail) if detail else ""))


def load_teacher_password():
    """教師密碼：env → 既有 DEMO 憑證檔（不寫死於程式）。"""
    env_pw = (os.environ.get("FDE_DEMO_TEACHER_PASSWORD") or "").strip()
    if env_pw:
        return env_pw
    candidates = [
        os.environ.get("FDE_DEMO_CREDENTIALS_FILE"),
        os.path.join(os.path.expanduser("~"), ".fde-demo-credentials", "demo.shared.password.txt"),
    ]
    for path in candidates:
        if not path:
            continue
        try:
            lines = open(path, encoding="utf-8").read().splitlines()
        except OSError:
            continue
        for index, line in enumerate(lines):
            if "以下為密碼" in line and "----" in line:
                for follower in lines[index + 1:]:
                    text = follower.strip()
                    if text and not text.startswith("----"):
                        return text
    return None


def cleanup():
    """刪除本腳本先前建立的資料（僅限 P42 專屬 ID）。

    注意：Enrollment.cohort 與 GrowthRecordDefinition.cohort 為 PROTECT，
    必須先清掉學員端產物與報名，才能刪班級。
    """
    from learning.models import (
        Evidence,
        GrowthRecordDefinition,
        GrowthRecordReview,
        TeacherCohortAccess,
    )

    cohort_ids = [COHORT_A_ID, COHORT_B_ID, COHORT_C_ID]
    enrollments = Enrollment.objects.filter(cohort_id__in=cohort_ids)
    GrowthRecordReview.objects.filter(submission__enrollment__in=enrollments).delete()
    Evidence.objects.filter(growth_submission__enrollment__in=enrollments).delete()
    Evidence.objects.filter(progress__enrollment__in=enrollments).delete()
    GrowthRecordSubmission.objects.filter(enrollment__in=enrollments).delete()
    StudentTaskProgress.objects.filter(enrollment__in=enrollments).delete()
    PhaseProgress.objects.filter(enrollment__in=enrollments).delete()
    enrollments.delete()
    GrowthRecordDefinition.objects.filter(cohort_id__in=cohort_ids).delete()
    TeacherCohortAccess.objects.filter(cohort_id__in=cohort_ids).delete()
    Cohort.objects.filter(cohort_id__in=cohort_ids).delete()
    # 學員帳號（p42-a-0001@...）與教師帳號（p42.teacher.*）前綴不同，需一併清除。
    from django.db.models import Q

    StudentProfile.objects.filter(public_user_id__startswith="P42-").delete()
    get_user_model().objects.filter(
        Q(username__startswith="p42.") | Q(username__startswith="p42-")
    ).delete()


def make_student(public_id, nickname, password):
    email = "%s@fde-p42.local" % public_id.lower()
    user = get_user_model().objects.create_user(
        username=email, email=email, password=password, is_active=True
    )
    profile = StudentProfile.objects.create(
        public_user_id=public_id,
        nickname=nickname,
        email=email,
        user=user,
        account_type=StudentProfile.AccountType.STUDENT,
        active=True,
    )
    return profile


def set_slot(enrollment, slot_id, status, days_ago=None):
    submissions = ensure_growth_submissions(enrollment)
    item = next(row for row in submissions if row.definition.slot_id == slot_id)
    item.status = status
    item.submitted_at = (
        timezone.now() - timedelta(days=days_ago) if days_ago is not None else None
    )
    item.save(update_fields=["status", "submitted_at"])
    return item


def review_slot(enrollment, slot_id, review_status, reviewer, days_ago=None, note="", score=None):
    """P5：建立真實的 GrowthRecordReview 紀錄並同步 status。

    與既有 review_growth_record 行為一致（同一交易內建立複核紀錄＋更新狀態），
    使測試資料的「已複核」有真實紀錄可依，而非僅有狀態字串。
    """
    from django.db import transaction

    from learning.models import GrowthRecordReview

    submissions = ensure_growth_submissions(enrollment)
    item = next(row for row in submissions if row.definition.slot_id == slot_id)
    submitted_at = timezone.now() - timedelta(days=(days_ago or 0) + 1)
    reviewed_at = timezone.now() - timedelta(days=days_ago or 0)
    with transaction.atomic():
        GrowthRecordReview.objects.create(
            submission=item,
            reviewer=reviewer,
            review_status=review_status,
            score=score,
            teacher_note=note,
            reviewed_at=reviewed_at,
        )
        item.status = review_status
        item.teacher_final_score = score
        item.submitted_at = submitted_at
        item.save(update_fields=["status", "teacher_final_score", "submitted_at"])
    return item


# 1×1 透明 PNG（僅供縮圖／授權檢查驗證；非學員真實作品）。
TINY_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c6300010000050001"
    "0d0a2db40000000049454e44ae426082"
)


def add_evidence(submission, evidence_type, description="", external_url="", with_upload=False, prefix=""):
    """P5：建立成果證據（沿用既有 Evidence 模型；授權檢查在 evidence_download）。"""
    from django.core.files.base import ContentFile

    from learning.models import Evidence

    evidence = Evidence(
        growth_submission=submission,
        evidence_type=evidence_type,
        description=description,
        external_url=external_url,
    )
    if with_upload:
        evidence.upload.save(
            "p5-evidence-%s-%s.png" % (prefix or "x", submission.definition.slot_id.lower()),
            ContentFile(TINY_PNG),
            save=False,
        )
    evidence.save()
    return evidence


def set_task(enrollment, task_id, days_ago=None):
    task, _ = TaskDefinition.objects.get_or_create(
        task_id=task_id,
        defaults={
            "sort_order": int(task_id[1:]) if task_id[1:].isdigit() else 0,
            "stage": TaskDefinition.Stage.BUILD,
            "title": "P4.2 驗證任務 %s" % task_id,
        },
    )
    progress, _ = StudentTaskProgress.objects.get_or_create(enrollment=enrollment, task=task)
    progress.status = StudentTaskProgress.Status.SUBMITTED
    progress.submitted_at = (
        timezone.now() - timedelta(days=days_ago) if days_ago is not None else None
    )
    progress.save(update_fields=["status", "submitted_at"])
    return progress


def set_phases(enrollment, completed_phases):
    for phase in ("learn", "practice", "build", "assess", "certify"):
        row, _ = PhaseProgress.objects.get_or_create(enrollment=enrollment, phase=phase)
        row.status = (
            PhaseProgress.Status.COMPLETED if phase in completed_phases else PhaseProgress.Status.NOT_STARTED
        )
        row.save(update_fields=["status"])


def main():
    password = load_teacher_password()
    if not password:
        print("[安全停止] 無法取得教師密碼：請設定 FDE_DEMO_TEACHER_PASSWORD 或提供 ~/.fde-demo-credentials/demo.shared.password.txt。")
        return 2

    step("目標為獨立測試庫", True, DB_PATH)
    cleanup()

    cohort_a = Cohort.objects.create(cohort_id=COHORT_A_ID, name="P4.2 驗證 A 班")
    cohort_b = Cohort.objects.create(cohort_id=COHORT_B_ID, name="P4.2 驗證 B 班")
    cohort_c = Cohort.objects.create(cohort_id=COHORT_C_ID, name="P4.2 驗證 C 班（無學員）")
    step("建立 3 個班級（含 1 個無學員空班級）", True, "%s / %s / %s" % (COHORT_A_ID, COHORT_B_ID, COHORT_C_ID))

    user_model = get_user_model()
    teacher_a = user_model.objects.create_user(
        username=TEACHER_A_EMAIL, email=TEACHER_A_EMAIL, password=password, is_staff=True
    )
    teacher_b = user_model.objects.create_user(
        username=TEACHER_B_EMAIL, email=TEACHER_B_EMAIL, password=password, is_staff=True
    )
    # 授權範圍不同：A 師只見 A 班、B 師只見 B 班。
    TeacherCohortAccess.objects.create(teacher=teacher_a, cohort=cohort_a)
    TeacherCohortAccess.objects.create(teacher=teacher_b, cohort=cohort_b)
    # C 班（空班級）授權給 A 師，供「無資料空狀態」驗收。
    TeacherCohortAccess.objects.create(teacher=teacher_a, cohort=cohort_c)
    step("建立 2 位教師與不同授權範圍", True, "A→A班+C班（空）；B→B班")

    # --- A 班 3 位學員 ---
    a1 = make_student("P42-A-0001", "A班零提交", password)
    a2 = make_student("P42-A-0002", "A班部分提交", password)
    a3 = make_student("P42-A-0003", "A班八項提交", password)
    ea1 = Enrollment.objects.create(student=a1, cohort=cohort_a, active=True)
    ea2 = Enrollment.objects.create(student=a2, cohort=cohort_a, active=True)
    ea3 = Enrollment.objects.create(student=a3, cohort=cohort_a, active=True)
    # A1：0 項提交（none）
    # A2：4 項提交（partial）；含 1 筆無提交時間
    sub_a2_r01 = set_slot(ea2, "R01", GrowthRecordSubmission.Status.SUBMITTED, days_ago=1)
    review_slot(
        ea2, "R02", GrowthRecordSubmission.Status.APPROVED, teacher_a, days_ago=3,
        note="機架組裝步驟正確，線束固定確實。", score=88,
    )
    review_slot(
        ea2, "R03", GrowthRecordSubmission.Status.NEEDS_REVISION, teacher_a, days_ago=2,
        note="飛行前檢查表缺少電池電壓紀錄，請補齊後重新提交。", score=60,
    )
    set_slot(ea2, "R04", GrowthRecordSubmission.Status.SUBMITTED, days_ago=None)
    set_task(ea2, "T06", days_ago=4)   # T06 → R05（P2 對應表）
    set_task(ea2, "T10", days_ago=5)   # T10 無 R 槽位對應
    # A3：8 項全部提交（complete）
    for index, slot in enumerate(("R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08")):
        set_slot(ea3, slot, GrowthRecordSubmission.Status.SUBMITTED, days_ago=10 + index)
    # P5 證據：一筆外部連結（免檔案）、一筆圖片（縮圖＋授權檢查）
    add_evidence(sub_a2_r01, "github", description="開源專案連結", external_url="https://example.invalid/p5-demo")
    sub_a3_r05 = next(
        row for row in ensure_growth_submissions(ea3) if row.definition.slot_id == "R05"
    )
    add_evidence(sub_a3_r05, "image", description="組裝成果照片", with_upload=True, prefix="a3")
    set_phases(ea1, {"learn"})
    set_phases(ea2, {"learn", "practice"})
    set_phases(ea3, set())

    # --- B 班 3 位學員 ---
    b1 = make_student("P42-B-0001", "B班零提交", password)
    b2 = make_student("P42-B-0002", "B班部分提交", password)
    b3 = make_student("P42-B-0003", "B班八項提交", password)
    eb1 = Enrollment.objects.create(student=b1, cohort=cohort_b, active=True)
    eb2 = Enrollment.objects.create(student=b2, cohort=cohort_b, active=True)
    eb3 = Enrollment.objects.create(student=b3, cohort=cohort_b, active=True)
    # B1：0 項（none）
    # B2：3 項已複核／需補充（partial，且無待複核）；另有一筆任務提交待複核
    review_slot(
        eb2, "R05", GrowthRecordSubmission.Status.APPROVED, teacher_b, days_ago=2,
        note="馬達轉向與槳葉配對正確。", score=92,
    )
    review_slot(
        eb2, "R06", GrowthRecordSubmission.Status.APPROVED, teacher_b, days_ago=3,
        note="調參與試飛紀錄完整。", score=85,
    )
    review_slot(
        eb2, "R07", GrowthRecordSubmission.Status.NEEDS_REVISION, teacher_b, days_ago=1,
        note="專案報告缺少測試數據表，請補充後再送。", score=58,
    )
    set_task(eb2, "T06", days_ago=6)
    # B3：8 項全部已複核（complete，無待複核）
    for index, slot in enumerate(("R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08")):
        review_slot(
            eb3, slot, GrowthRecordSubmission.Status.APPROVED, teacher_b, days_ago=20 + index,
            note="紀錄完整，予以通過。" if slot in ("R01", "R07") else "",
            score=90,
        )
    sub_b3_r01 = next(
        row for row in ensure_growth_submissions(eb3) if row.definition.slot_id == "R01"
    )
    add_evidence(sub_b3_r01, "image", description="學員成果照片（測試用縮圖）", with_upload=True, prefix="b3")
    set_phases(eb1, {"learn"})
    set_phases(eb2, {"learn", "practice", "build"})
    set_phases(eb3, {"learn", "practice", "build", "assess", "certify"})

    step("建立 6 位學員（每班 3 位）", True, "A班 3 / B班 3")
    step("提交分布：0 項／1–7 項／8 項", True, "none×2、partial×2、complete×2")
    step("狀態分布：待複核／已複核／需要補充", True, "submitted／approved／needs_revision 皆有")
    step("提交時間含不同時間與缺失時間", True, "含 1 筆 submitted_at=NULL")

    # P5：真實複核紀錄與成果證據（使「已複核」有紀錄可依、教師回饋為真實資料）
    from learning.models import Evidence, GrowthRecordReview

    review_count = GrowthRecordReview.objects.count()
    evidence_count = Evidence.objects.count()
    note_count = GrowthRecordReview.objects.exclude(teacher_note="").count()
    step("建立真實教師複核紀錄（同步 status）", review_count > 0, "GrowthRecordReview %d 筆" % review_count)
    step("其中含教師評語（回饋區真實資料）", note_count > 0, "有評語 %d 筆" % note_count)
    step("建立成果證據（外部連結＋圖片）", evidence_count > 0, "Evidence %d 筆" % evidence_count)

    # 摘要輸出（供報告引用）
    summary = {}
    for cohort in (cohort_a, cohort_b):
        enrollments = Enrollment.objects.filter(cohort=cohort, active=True)
        counts = []
        for enrollment in enrollments:
            submissions = ensure_growth_submissions(enrollment)
            submitted = sum(
                1
                for item in submissions
                if item.status
                in (
                    GrowthRecordSubmission.Status.SUBMITTED,
                    GrowthRecordSubmission.Status.NEEDS_REVISION,
                    GrowthRecordSubmission.Status.APPROVED,
                    GrowthRecordSubmission.Status.REJECTED,
                )
            )
            pending = sum(
                1 for item in submissions if item.status == GrowthRecordSubmission.Status.SUBMITTED
            )
            reviewed = sum(
                1
                for item in submissions
                if item.status
                in (
                    GrowthRecordSubmission.Status.NEEDS_REVISION,
                    GrowthRecordSubmission.Status.APPROVED,
                    GrowthRecordSubmission.Status.REJECTED,
                )
            )
            needs = sum(
                1
                for item in submissions
                if item.status == GrowthRecordSubmission.Status.NEEDS_REVISION
            )
            counts.append(
                (enrollment.student.public_user_id, submitted, reviewed, pending, needs)
            )
        summary[cohort.cohort_id] = counts
    print("SEED SUMMARY (id, submitted, reviewed, pending, needs): %s" % summary)

    failed = [row for row in RESULTS if not row[1]]
    print("==== P4.2 種子結果：%d 項完成 / %d 項失敗 ====" % (len(RESULTS) - len(failed), len(failed)))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
