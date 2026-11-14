"""P8 部署輔助：用「正式站服務完全相同的環境」執行 Django 指令與部署後檢查。

- 環境變數由 D:\\FDE-AI-Runtime\\v2-integration\\services\\run_service.py 的 build_env() 產生
  （stack.env＋keys.env；與 FDE-Django 服務相同），本程式不讀、不印任何金鑰。
- 用法（由 p8_deploy.ps1／p8_rollback.ps1 呼叫）：
    python p8_manage.py migrate            執行 migrate learning（套用 0033，no-op）
    python p8_manage.py migrate-back       退回 learning 0032（no-op）
    python p8_manage.py seed               seed_tasks（只新增缺少的 T13，不覆寫老師改過的任務）
    python p8_manage.py deactivate-t13     把 T13 設成停用（回滾用，不刪資料）
    python p8_manage.py backup-db <路徑>   用 SQLite 線上備份 API 備份正式資料庫（不鎖定、不中斷服務）
    python p8_manage.py verify             部署後檢查（本機 8141 頁面、8140 成績 API）
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
DB = os.path.join(RUNTIME, "db", "integration.sqlite3")

sys.path.insert(0, SERVICES)
import run_service  # noqa: E402  正式站服務腳本；只用它的 build_env() 與 VENV_PY


def manage(*args):
    env = run_service.build_env()
    result = subprocess.run([run_service.VENV_PY, "manage.py", *args], cwd=DJANGO_DIR, env=env)
    if result.returncode != 0:
        sys.exit(f"指令失敗：manage.py {' '.join(args)}")


def get(url):
    """回傳（狀態碼, 內容）；404 等錯誤也回傳狀態碼，交給檢查列出問題，不中斷。
    Django 正式設定會把 http 轉址到 https；本機直連時帶上閘道會帶的 X-Forwarded-Proto，模擬經過閘道的請求。"""
    req = urllib.request.Request(url, headers={"X-Forwarded-Proto": "https"})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status, res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        return err.code, ""
    except OSError as err:
        return 0, str(err)


def verify():
    problems = []
    status, html = get("http://127.0.0.1:8141/f450-twin/")
    for text in ("無人機組裝與接線實訓", "train-session", "wiring-canvas.js", "M13 FPV 穿越機接線實訓"):
        if text not in html:
            problems.append(f"F450 頁面缺少：{text}")
    for name in ("model", "assembly-mode", "wiring-canvas", "bus", "sync3d", "scoring", "session", "records"):
        if get(f"http://127.0.0.1:8141/f450-twin/training/{name}.js")[0] != 200:
            problems.append(f"載入失敗：training/{name}.js")
    status, body = get("http://127.0.0.1:8140/student/sim-practice/api/")
    if status != 200 or '"logged_in"' not in body:
        problems.append("成績 API（8140）回應不正常")
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    if not conn.execute("select 1 from django_migrations where app='learning' and name='0033_sim_practice_f450_mode'").fetchone():
        problems.append("資料庫沒有 0033")
    if not conn.execute("select 1 from learning_taskdefinition where task_id='T13' and active=1").fetchone():
        problems.append("資料庫沒有啟用的 T13")
    print(json.dumps({"ok": not problems, "problems": problems}, ensure_ascii=False, indent=2))
    sys.exit(1 if problems else 0)


def backup_db(target):
    src = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    dst = sqlite3.connect(target)
    src.backup(dst)
    dst.close()
    print(f"資料庫已備份：{target}")


def deactivate_t13():
    # 透過 Django 修改，保留修訂紀錄；不刪除，避免學員已上傳的佐證失去任務
    code = "from learning.models import TaskDefinition as T; n=T.objects.filter(task_id='T13').update(active=False); print(f'T13 已停用（{n} 筆）')"
    manage("shell", "-c", code)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "migrate":
        manage("migrate", "learning")
    elif cmd == "migrate-back":
        manage("migrate", "learning", "0032")
    elif cmd == "seed":
        manage("seed_tasks")
    elif cmd == "deactivate-t13":
        deactivate_t13()
    elif cmd == "backup-db":
        backup_db(sys.argv[2])
    elif cmd == "verify":
        verify()
    else:
        sys.exit(__doc__)
