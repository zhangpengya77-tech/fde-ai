"""課程諮詢（2026-11-18）正式站部署輔助：建立獨立資料庫、部署後檢查。

使用正式站服務同一套環境（stack.env＋keys.env，由 run_service.build_env() 讀取），本程式不讀、不印任何金鑰。

    python inquiry_manage.py migrate     在獨立資料庫 inquiries.sqlite3 建立課程諮詢資料表（只動這個新資料庫，不動學員資料庫）
    python inquiry_manage.py verify      部署後檢查：資料表存在、API 只收 POST、教師頁需要登入
    python inquiry_manage.py count       顯示目前諮詢筆數與未讀筆數（不顯示個資）
"""
import json
import os
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.request

RUNTIME = r"D:\FDE-AI-Runtime\v2-integration"
SERVICES = os.path.join(RUNTIME, "services")
REPO = r"D:\FDE-AI-UAS-v2.0-integration"
DJANGO_DIR = os.path.join(REPO, "student_portal")
INQUIRY_DB = os.path.join(RUNTIME, "db", "inquiries.sqlite3")   # 與正式資料庫同資料夾（settings 依 DJANGO_DB_NAME 推得）

sys.path.insert(0, SERVICES)
import run_service  # noqa: E402  正式站服務腳本；只用它的 build_env() 與 VENV_PY


def manage(*args):
    env = run_service.build_env()
    result = subprocess.run([run_service.VENV_PY, "manage.py", *args], cwd=DJANGO_DIR, env=env)
    if result.returncode != 0:
        sys.exit(f"指令失敗：manage.py {' '.join(args)}")


def status(url, method="GET"):
    req = urllib.request.Request(url, method=method, headers={"X-Forwarded-Proto": "https"})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status
    except urllib.error.HTTPError as err:
        return err.code
    except OSError:
        return 0


def verify():
    problems = []
    if not os.path.exists(INQUIRY_DB):
        problems.append(f"找不到獨立資料庫：{INQUIRY_DB}")
    else:
        conn = sqlite3.connect(f"file:{INQUIRY_DB}?mode=ro", uri=True)
        if not conn.execute("select 1 from sqlite_master where name='inquiries_courseinquiry'").fetchone():
            problems.append("獨立資料庫沒有 inquiries_courseinquiry 資料表")
    if status("http://127.0.0.1:8140/api/public/course-inquiry/") != 405:
        problems.append("課程諮詢 API（GET）應回 405")
    if status("http://127.0.0.1:8140/teacher/course-inquiries/") not in (301, 302):
        problems.append("教師課程諮詢頁未登入時應轉到登入頁")
    print(json.dumps({"ok": not problems, "problems": problems}, ensure_ascii=False, indent=2))
    sys.exit(1 if problems else 0)


def count():
    conn = sqlite3.connect(f"file:{INQUIRY_DB}?mode=ro", uri=True)
    total, unread = conn.execute("select count(*), sum(case when is_read then 0 else 1 end) from inquiries_courseinquiry").fetchone()
    print(f"課程諮詢：共 {total} 筆，未讀 {unread or 0} 筆")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "migrate":
        manage("migrate", "inquiries", "--database=inquiries")
    elif cmd == "verify":
        verify()
    elif cmd == "count":
        count()
    else:
        print(__doc__)
