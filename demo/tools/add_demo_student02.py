"""FDE-AI-UAS 2.0 DEMO（合作展示版）— 新增獨立展示學員 02 與空白 R07。

用途：在**完全隔離的 DEMO 環境**建立第二組獨立展示案例，
讓教師可以體驗「學員第一次上傳模型」的完整流程，而不會被
既有的 DEMO_TEST_ONLY_best.pt（學員 01）干擾。

嚴格限制（與 seed_demo.py 一致）：
  * 只寫入 DJANGO_DB_NAME 指向的 DEMO DB。
  * 只寫入 DJANGO_MEDIA_ROOT 指向的 DEMO MEDIA。
  * 不載入、不反序列化、不推論任何 .pt。
  * 不發布 ACTIVE、不寫入正式 DB / 正式 JSON Store。
  * 不動既有學員 01 / 教師 / 任何已存在記錄。

關於密碼：
  * 學員 02 的密碼「只」寫入本機受限交付檔（chmod 0600），
    絕不印到 stdout / 日誌 / 報告 / Git。
  * 既有的學員 01 共用密碼完全不動。

用法：
    python add_demo_student02.py            # 建立（若已存在則跳過帳號，仍確保 R07 空白）
    python add_demo_student02.py --reset-r07 # 把學員 02 的 R07 重置為尚未提交（僅限該學員）
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import os
import secrets
import shutil
import string
import sys
from pathlib import Path

# --- 安全护栏（必須在 django.setup() 之前執行）-------------------------------
PROJECT_ROOT = Path(r"D:\FDE-AI-UAS-v2.0")
DEMO_ROOT = PROJECT_ROOT / "demo"
sys.path.insert(0, str(PROJECT_ROOT / "student_portal"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
os.environ["DJANGO_DEBUG"] = "true"

DEMO_DB = DEMO_ROOT / "runtime" / "db" / "demo.sqlite3"
DEMO_MEDIA = DEMO_ROOT / "runtime" / "media"
os.environ["DJANGO_DB_NAME"] = str(DEMO_DB)
os.environ["DJANGO_MEDIA_ROOT"] = str(DEMO_MEDIA)
os.environ["FDE_VISION_CENTER_ROOT"] = str(DEMO_ROOT / "runtime" / "vision-center")
os.environ["PYTHONNOUSERSITE"] = "1"

# 本機受限交付位置（非專案、非 Git、非日誌）
DELIVERY_DIR = Path(os.path.expanduser("~")) / ".fde-demo-credentials"
DELIVERY_FILE = DELIVERY_DIR / "demo.student02.password.txt"

PROD_DB = PROJECT_ROOT / "student_portal" / "db.sqlite3"

# --- 展示常數 ----------------------------------------------------------------
STUDENT_EMAIL = "demo.student02@fde-demo.local"
STUDENT_NICKNAME = "DEMO-STUDENT-02"
STUDENT_PUBLIC_ID = "DEMO-STU-0002"

COHORT_CODE = "F450-DEMO-2026"
GROUP_CODE = "DEMO-B"  # 故意與學員 01 的 DEMO-A 區分，作為獨立組別

# 沿用學員 01 的教師（同一班級同一教師），確保教師視覺中心能同時看到兩組。
TEACHER_EMAIL = "demo.teacher@fde-demo.local"

ALPHABET = string.ascii_letters + string.digits  # 純英數，無特殊符號


def banner(text: str) -> None:
    print(f"\n{'=' * 72}\n  {text}\n{'=' * 72}")


def guard_environment() -> None:
    """確認所有寫入路徑都在 demo/ 之下；否則直接中止。"""
    banner("環境隔離檢查")
    resolved = DEMO_DB.resolve()
    parts = [p.lower() for p in resolved.parts]
    if "fde-ai-uas-v2.0" not in parts or "demo" not in parts:
        raise SystemExit(f"ABORT：DEMO DB 不在 demo/ 之下：{resolved}")
    if resolved == PROD_DB.resolve():
        raise SystemExit("[ABORT] Refusing to operate on the production database.")
    inside = str(resolved).replace("\\", "/").lower().startswith(
        str(DEMO_ROOT).replace("\\", "/").lower()
    )
    print(f"  [OK] DB   = {resolved}")
    print(f"  [OK] MEDIA= {DEMO_MEDIA}")
    if not inside:
        raise SystemExit("ABORT：路徑不在 demo/ 之下，拒絕執行以免污染正式環境。")
    print("  → 隔離確認通過。")


def backup_demo_db() -> Path:
    """在修改前先備份 DEMO DB（僅複製單一檔案，保留可還原點）。"""
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = DEMO_ROOT / "backup"
    backup_dir.mkdir(parents=True, exist_ok=True)
    dest = backup_dir / f"demo-before-student02-{stamp}.sqlite3"
    shutil.copy2(DEMO_DB, dest)
    size_kb = dest.stat().st_size / 1024
    print(f"  [OK] 備份 DEMO DB → {dest}（{size_kb:.1f} KB）")
    return dest


def generate_password(length: int = 16) -> str:
    """產生純英數密碼；保證含大寫、小寫、數字各至少一。"""
    while True:
        pwd = "".join(secrets.choice(ALPHABET) for _ in range(length))
        if (any(c.islower() for c in pwd)
                and any(c.isupper() for c in pwd)
                and any(c.isdigit() for c in pwd)):
            return pwd


def write_password_file(pwd: str) -> None:
    """只寫入本機受限交付檔（0600），不印出明文。"""
    ts = datetime.datetime.now().isoformat(timespec="seconds")
    DELIVERY_DIR.mkdir(parents=True, exist_ok=True)
    DELIVERY_FILE.write_text(
        "# FDE-AI-UAS 2.0 DEMO 學員 02 測試密碼（本機受限交付）\n"
        "# 僅供本機 DEMO 人工驗收使用；請勿放入版本控制、雲端同步或共用資料夾。\n"
        f"# 產生時間：{ts}\n"
        "#\n"
        "---- 以下為密碼，複製這一行 ----\n"
        f"{pwd}\n"
        "---- 密碼結束 ----\n",
        encoding="utf-8",
    )
    try:
        os.chmod(DELIVERY_FILE, 0o600)
    except OSError:
        pass
    print(f"  [OK] 密碼已寫入受限交付檔：{DELIVERY_FILE}（權限 0600）")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset-r07", action="store_true",
                    help="把學員 02 的 R07 重置為尚未提交（僅限該學員）")
    args = ap.parse_args()

    guard_environment()

    import django
    django.setup()

    from django.contrib.auth import get_user_model
    from django.db import transaction

    from learning.growth_records import ensure_growth_submissions
    from learning.models import (
        Cohort,
        Enrollment,
        Evidence,
        GrowthRecordSubmission,
        LearningGroup,
        StudentProfile,
        TeacherCohortAccess,
    )

    backup_demo_db()

    banner("1. 建立 DEMO 學員 02 帳號")
    cohort, _ = Cohort.objects.get_or_create(
        cohort_id=COHORT_CODE,
        defaults={"name": "FDE-AI-UAS DEMO 展示班（苗栗合作）", "active": True},
    )
    group, _ = LearningGroup.objects.get_or_create(
        cohort=cohort, code=GROUP_CODE,
        defaults={"name": "DEMO 展示組 B", "active": True},
    )
    user, created = get_user_model().objects.get_or_create(
        username=STUDENT_EMAIL,
        defaults={"email": STUDENT_EMAIL, "is_active": True},
    )
    user.email = STUDENT_EMAIL
    user.is_active = True
    pwd = generate_password(16)
    user.set_password(pwd)
    user.save()
    print(f"  [{'NEW' if created else 'EXISTS'}] 使用者 {STUDENT_EMAIL}")

    profile, p_created = StudentProfile.objects.get_or_create(
        email=STUDENT_EMAIL,
        defaults={
            "student_id": "demo0000000000000000000000000002",
            "public_user_id": STUDENT_PUBLIC_ID,
            "nickname": STUDENT_NICKNAME,
            "account_type": StudentProfile.AccountType.FREE,
            "user": user,
            "active": True,
        },
    )
    profile.nickname = STUDENT_NICKNAME
    profile.user = user
    profile.active = True
    profile.save()
    print(f"  [{'NEW' if p_created else 'EXISTS'}] FDE ID = {profile.public_user_id}")

    enrollment, e_created = Enrollment.objects.get_or_create(
        student=profile, cohort=cohort,
        defaults={
            "group": group,
            "project_direction": "ai_flight_assessment",
            "training_source": Enrollment.TrainingSource.COLLEGE,
            "active": True,
            "teacher_verified": True,
            "teacher_verified_name": "DEMO 教師",
        },
    )
    enrollment.group = group
    enrollment.project_direction = "ai_flight_assessment"
    enrollment.active = True
    enrollment.teacher_verified = True
    enrollment.teacher_verified_name = "DEMO 教師"
    enrollment.save()
    print(f"  [{'NEW' if e_created else 'EXISTS'}] Enrollment #{enrollment.pk} "
          f"組別 {group.code} 方向 {enrollment.project_direction}")

    try:
        teacher = get_user_model().objects.get(username=TEACHER_EMAIL)
        TeacherCohortAccess.objects.get_or_create(teacher=teacher, cohort=cohort)
    except get_user_model().DoesNotExist:
        print("  [WARN] 教師帳號不存在，請先執行 seed_demo.py 建立教師。")

    banner("2. 確保 R07 成長紀錄處於『尚未提交模型』(NOT_STARTED)")
    submissions = ensure_growth_submissions(enrollment)
    r07 = next((s for s in submissions if s.definition.slot_id == "R07"), None)
    if r07 is None:
        raise SystemExit("ABORT：學員 02 缺少 R07 成長紀錄定義。")

    if args.reset_r07:
        with transaction.atomic():
            Evidence.objects.filter(
                growth_submission=r07, evidence_type=Evidence.Type.MODEL
            ).delete()
            r07.status = GrowthRecordSubmission.Status.NOT_STARTED
            r07.submitted_at = None
            r07.student_note = ""
            r07.save(update_fields=["status", "submitted_at", "student_note", "updated_at"])
        print("  [OK] 已重置學員 02 的 R07 為 NOT_STARTED（移除其模型證據）。")
    else:
        has_model = Evidence.objects.filter(
            growth_submission=r07, evidence_type=Evidence.Type.MODEL
        ).exists()
        if has_model:
            print("  [SKIP] 學員 02 的 R07 已存在模型證據，維持原狀（如需清空請加 --reset-r07）。")
        else:
            print(f"  [OK] 學員 02 的 R07 目前為 {r07.status}（無模型，可由學員第一次上傳）。")

    final_r07 = GrowthRecordSubmission.objects.get(pk=r07.pk)
    final_has_model = Evidence.objects.filter(
        growth_submission=final_r07, evidence_type=Evidence.Type.MODEL
    ).exists()
    assert final_r07.status in {
        GrowthRecordSubmission.Status.NOT_STARTED,
        GrowthRecordSubmission.Status.IN_PROGRESS,
    }, f"R07 狀態異常：{final_r07.status}"
    assert not final_has_model, "R07 不應含有任何模型證據。"

    # 密碼只在這裡寫入本機受限檔（chmod 0600），絕不印出明文。
    write_password_file(pwd)

    banner("完成")
    print(f"  學員 02 帳號 ： {STUDENT_EMAIL}")
    print(f"  FDE ID       ： {profile.public_user_id}")
    print(f"  所屬組別     ： {group.code}（獨立於學員 01 的 DEMO-A）")
    print(f"  Enrollment ID： {enrollment.pk}（R07 上傳 URL 使用此編號）")
    print(f"  R07 狀態     ： {final_r07.status}（無模型，等待第一次上傳）")
    print(f"  密碼交付     ： 本機受限檔 {DELIVERY_FILE}（已 chmod 0600，未印出明文）")
    print()
    print("  ℹ 下一步：以學員 02 登入 → 進入 R07 → 上傳 best.pt，")
    print("            再以教師登入視覺模型中心，即可看見全新的待審模型。")
    fp = hashlib.sha256(pwd.encode()).hexdigest()[:12]
    print(f"  [OK] 密碼指紋 sha256[:12] = {fp}（僅供核對，不含明文）")


if __name__ == "__main__":
    main()
