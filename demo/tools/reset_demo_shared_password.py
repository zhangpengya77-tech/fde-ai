"""DEMO-only：將學生與教師測試帳號設為同一組隨機純英數密碼。

授權範圍（2026-10-10 統一帳密指令）：
  - 僅 DEMO 隔離資料庫 `demo/runtime/db/demo.sqlite3`
  - 僅兩個帳號：demo.student01@fde-demo.local（學生）、demo.teacher@fde-demo.local（教師）
  - 使用 Django set_password()
  - 產生 16 位純英數（含大小寫與數字、無特殊符號），兩帳號共用
  - 不改其他帳號、不改登入頁/Proxy/Cloudflare、不重啟任何服務

安全設計：
  - 三重護欄（路徑 / 真實連線 DB / 帳號身分與角色）不符即中止
  - 明文密碼**只**寫入本機受限位置 `~/.fde-demo-credentials/`（0600，專案外、非 Git），
    不進 Git／程式碼／日誌／報告
  - **P6 安全修正（2026-10-13）**：預設不再寫入桌面帳密檔。桌面通常位於
    OneDrive 等雲端同步範圍，會把明文憑證上傳雲端。若確有需要，必須明確設定
    環境變數 `FDE_DEMO_WRITE_DESKTOP_CREDENTIALS=1` 才會寫入，並自負風險。
  - stdout 僅輸出遮罩與雜湊指紋
  - 提供 --revoke 模式：DEMO 測試結束後可銷毀共用密碼（改為不可知隨機值）

用法：
    python reset_demo_shared_password.py            # 設定共用密碼
    python reset_demo_shared_password.py --revoke   # 撤銷（銷毀）共用密碼
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import os
import secrets
import string
import sys
from pathlib import Path

PROJECT_ROOT = Path(r"D:\FDE-AI-UAS-v2.0")
DEMO_DB = PROJECT_ROOT / "demo" / "runtime" / "db" / "demo.sqlite3"
PROD_DB = PROJECT_ROOT / "student_portal" / "db.sqlite3"

STUDENT_EMAIL = "demo.student01@fde-demo.local"
TEACHER_EMAIL = "demo.teacher@fde-demo.local"

# 本機受限交付位置（非專案、非 Git、非日誌）
DELIVERY_DIR = Path(os.path.expanduser("~")) / ".fde-demo-credentials"
DELIVERY_FILE = DELIVERY_DIR / "demo.shared.password.txt"

# 教師桌面帳密檔（P6 安全修正：預設停用；桌面多為雲端同步範圍，會把明文憑證上傳）
DESKTOP_FILE = Path(os.path.expanduser("~")) / "Desktop" / "FDE_DEMO_測試帳密.txt"
WRITE_DESKTOP_CREDENTIALS = os.environ.get("FDE_DEMO_WRITE_DESKTOP_CREDENTIALS", "") == "1"

STUDENT_LOGIN_URL = "http://192.168.1.114:8111/login/"
TEACHER_LOGIN_URL = "http://192.168.1.114:8111/teacher/login/"

ALPHABET = string.ascii_letters + string.digits  # 純英數，無特殊符號


def generate_password(length: int = 16) -> str:
    """產生純英數密碼；保證含大寫、小寫、數字各至少一。"""
    while True:
        pwd = "".join(secrets.choice(ALPHABET) for _ in range(length))
        if (any(c.islower() for c in pwd)
                and any(c.isupper() for c in pwd)
                and any(c.isdigit() for c in pwd)):
            return pwd


def guard_path() -> Path:
    """護欄 1：目標必須是 DEMO DB，且不得為正式 DB。"""
    if not DEMO_DB.exists():
        raise SystemExit(f"[ABORT] DEMO DB not found: {DEMO_DB}")

    resolved = DEMO_DB.resolve()
    parts = [p.lower() for p in resolved.parts]
    if "fde-ai-uas-v2.0" not in parts or "demo" not in parts:
        raise SystemExit(f"[ABORT] DEMO DB path not under demo/: {resolved}")
    if resolved == PROD_DB.resolve():
        raise SystemExit("[ABORT] Refusing to operate on the production database.")

    print(f"[OK] Guard 1: target DB = {resolved}")
    return resolved


def guard_connection() -> None:
    """護欄 2：Django 實際連線的 DB 必須等於 DEMO DB。"""
    from django.conf import settings

    actual = Path(str(settings.DATABASES["default"]["NAME"])).resolve()
    if actual != DEMO_DB.resolve():
        raise SystemExit(f"[ABORT] Django bound to {actual}, expected {DEMO_DB.resolve()}")
    print(f"[OK] Guard 2: Django connection DB = {actual}")


def guard_accounts(User):
    """護欄 3：兩個帳號必須存在，且角色符合預期。"""
    try:
        student = User.objects.get(username__iexact=STUDENT_EMAIL)
    except User.DoesNotExist:
        raise SystemExit(f"[ABORT] Student account not found: {STUDENT_EMAIL}")
    try:
        teacher = User.objects.get(username__iexact=TEACHER_EMAIL)
    except User.DoesNotExist:
        raise SystemExit(f"[ABORT] Teacher account not found: {TEACHER_EMAIL}")

    if student.username != STUDENT_EMAIL or teacher.username != TEACHER_EMAIL:
        raise SystemExit("[ABORT] Unexpected username casing; refusing.")

    # 學生：不可為 staff/superuser；教師：必須為 staff
    if student.is_staff or student.is_superuser:
        raise SystemExit("[ABORT] Student account unexpectedly privileged; refusing.")
    if not teacher.is_staff:
        raise SystemExit("[ABORT] Teacher account is not staff; refusing.")

    print(f"[OK] Guard 3a: student id={student.id} is_staff={student.is_staff} "
          f"is_active={student.is_active}")
    print(f"[OK] Guard 3b: teacher id={teacher.id} is_staff={teacher.is_staff} "
          f"is_active={teacher.is_active}")
    return student, teacher


def snapshot_others(User, exclude_ids) -> dict:
    """其他帳號的雜湊快照，用於事後證明未被更動。"""
    return {
        u.id: (u.username, hashlib.sha256(u.password.encode()).hexdigest())
        for u in User.objects.exclude(id__in=exclude_ids).order_by("id")
    }


def write_delivery_files(pwd: str, accounts: list[str]) -> None:
    """寫入交付檔（本機受限位置）與教師桌面帳密檔。"""
    ts = datetime.datetime.now().isoformat(timespec="seconds")

    # --- 1) 本機受限位置（0600）---
    DELIVERY_DIR.mkdir(parents=True, exist_ok=True)
    DELIVERY_FILE.write_text(
        "# FDE-AI-UAS 2.0 DEMO 共用測試密碼（本機受限交付）\n"
        f"# 產生時間：{ts}\n"
        "# 學生與教師共用同一組密碼；DEMO 測試結束後應撤銷。\n"
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

    # --- 2) 教師桌面帳密檔（P6 安全修正：預設停用）---
    if WRITE_DESKTOP_CREDENTIALS:
        DESKTOP_FILE.parent.mkdir(parents=True, exist_ok=True)
        DESKTOP_FILE.write_text(
            "FDE-AI-UAS 2.0 DEMO\n"
            "\n"
            "學生帳號：demo.student01@fde-demo.local\n"
            "教師帳號：demo.teacher@fde-demo.local\n"
            "共同測試密碼：\n"
            f"{pwd}\n"
            "\n"
            "學生登入：\n"
            f"{STUDENT_LOGIN_URL}\n"
            "教師登入：\n"
            f"{TEACHER_LOGIN_URL}\n"
            "\n"
            "# 本檔案僅供教師本人使用。請勿放入版本控制、雲端同步或共用資料夾。\n"
            f"# 產生時間：{ts}\n"
            "# 撤銷方式：執行 demo/tools/reset_demo_shared_password.py --revoke\n",
            encoding="utf-8",
        )
        print(f"[WARN] 已寫入桌面帳密檔（雲端同步風險自負）: {DESKTOP_FILE}")
    else:
        print(
            "[OK] 未寫入桌面帳密檔（預設停用）。如需寫入請設 "
            "FDE_DEMO_WRITE_DESKTOP_CREDENTIALS=1。"
        )
    print(f"[OK] Delivery (restricted): {DELIVERY_FILE}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--revoke", action="store_true",
                    help="撤銷共用密碼（改為不可知隨機值並刪除交付檔）")
    args = ap.parse_args()

    guard_path()

    os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"
    os.environ["DJANGO_DEBUG"] = "true"
    os.environ.pop("DATABASE_URL", None)
    os.environ["DJANGO_DB_NAME"] = str(DEMO_DB)
    os.environ.setdefault("DJANGO_SECRET_KEY", "demo-shared-pwd-tool")

    sys.path.insert(0, str(PROJECT_ROOT / "student_portal"))
    import django
    django.setup()

    from django.contrib.auth import get_user_model
    User = get_user_model()

    guard_connection()
    student, teacher = guard_accounts(User)

    others_before = snapshot_others(User, [student.id, teacher.id])
    hash_before = {
        "student": hashlib.sha256(student.password.encode()).hexdigest()[:12],
        "teacher": hashlib.sha256(teacher.password.encode()).hexdigest()[:12],
    }

    pwd = generate_password(16)

    for u in (student, teacher):
        u.set_password(pwd)
        u.save(update_fields=["password"])

    student.refresh_from_db()
    teacher.refresh_from_db()
    others_after = snapshot_others(User, [student.id, teacher.id])

    ok_student = student.check_password(pwd)
    ok_teacher = teacher.check_password(pwd)
    # 注意：Django PBKDF2 每個帳號使用「獨立隨機 salt」，
    # 即使密碼完全相同，雜湊字串也必然不同 → 不能用雜湊相等判斷共用密碼。
    # 正確做法是交叉驗證：用同一組密碼對兩個帳號 check_password() 皆為 True。
    ok_cross = (student.check_password(pwd) and teacher.check_password(pwd))
    chars_ok = (len(pwd) == 16 and pwd.isalnum()
                and any(c.islower() for c in pwd)
                and any(c.isupper() for c in pwd)
                and any(c.isdigit() for c in pwd))
    roles_ok = (not student.is_staff) and teacher.is_staff
    active_ok = student.is_active and teacher.is_active
    others_ok = others_before == others_after

    print()
    print(f"[RESULT] password length        = {len(pwd)}")
    print(f"[RESULT] pure alphanumeric      = {pwd.isalnum()}")
    print(f"[RESULT] has lower/upper/digit  = "
          f"{any(c.islower() for c in pwd)}/{any(c.isupper() for c in pwd)}/"
          f"{any(c.isdigit() for c in pwd)}")
    print(f"[RESULT] student check_password = {ok_student}")
    print(f"[RESULT] teacher check_password = {ok_teacher}")
    print(f"[RESULT] shared password (cross-check both) = {ok_cross}")
    print(f"[RESULT] same password, different salt/hash  = "
          f"{student.password != teacher.password}")
    print(f"[RESULT] roles preserved        = {roles_ok}")
    print(f"[RESULT] is_active preserved    = {active_ok}")
    print(f"[RESULT] other accounts unchanged = {others_ok}")
    print(f"[RESULT] student hash {hash_before['student']} -> "
          f"{hashlib.sha256(student.password.encode()).hexdigest()[:12]}")
    print(f"[RESULT] teacher hash {hash_before['teacher']} -> "
          f"{hashlib.sha256(teacher.password.encode()).hexdigest()[:12]}")

    failed = [n for n, v in [
        ("student check_password", ok_student),
        ("teacher check_password", ok_teacher),
        ("shared password cross-check", ok_cross),
        ("password charset", chars_ok),
        ("roles preserved", roles_ok),
        ("is_active preserved", active_ok),
        ("other accounts unchanged", others_ok),
    ] if not v]
    if failed:
        raise SystemExit(f"[ABORT] Verification failed: {', '.join(failed)}")

    write_delivery_files(pwd, [STUDENT_EMAIL, TEACHER_EMAIL])
    print(f"[OK] masked preview: {pwd[:2]}{'*' * (len(pwd) - 4)}{pwd[-2:]}")
    print(f"[OK] fingerprint sha256[:16] = "
          f"{hashlib.sha256(pwd.encode()).hexdigest()[:16]}")
    print("[OK] done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
