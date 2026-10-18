"""FDE-AI-UAS 2.0 DEMO — 建立 DEMO 資料庫（冪等）。

只在 demo/runtime/db/demo.sqlite3 上套用 migration。
若已存在則直接跳過，不刪除任何既有資料。
需要重建時請用 demo/tools/build_demo_db.sh --reset。
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(r"D:\FDE-AI-UAS-v2.0")
DEMO_ROOT = PROJECT_ROOT / "demo"
DEMO_DB = DEMO_ROOT / "runtime" / "db" / "demo.sqlite3"
DEMO_MEDIA = DEMO_ROOT / "runtime" / "media"
PY = PROJECT_ROOT / ".test-temp" / "django-venv" / "Scripts" / "python.exe"

# --- 安全护栏：目標必須在 demo/ 之下 ----------------------------------------
if not str(DEMO_DB).replace("\\", "/").lower().startswith(
    str(DEMO_ROOT).replace("\\", "/").lower()
):
    raise SystemExit("ABORT：DEMO DB 路徑不在 demo/ 之下。")

print(f"DEMO DB    : {DEMO_DB}")
print(f"DEMO MEDIA : {DEMO_MEDIA}")

DEMO_DB.parent.mkdir(parents=True, exist_ok=True)
DEMO_MEDIA.mkdir(parents=True, exist_ok=True)

if DEMO_DB.exists():
    size_kb = DEMO_DB.stat().st_size / 1024
    print(f"[SKIP] DEMO DB 已存在（{size_kb:.1f} KB），不重建。")
    sys.exit(0)

env = dict(os.environ)
env["DJANGO_DB_NAME"] = str(DEMO_DB)
env["DJANGO_MEDIA_ROOT"] = str(DEMO_MEDIA)
env["DJANGO_DEBUG"] = "true"
env["PYTHONNOUSERSITE"] = "1"

print("[ .. ] 套用 migration…")
result = subprocess.run(
    [str(PY), "manage.py", "migrate", "--no-input"],
    cwd=str(PROJECT_ROOT / "student_portal"),
    env=env,
    capture_output=True,
    text=True,
)
if result.returncode != 0:
    print(result.stdout[-3000:])
    print(result.stderr[-3000:], file=sys.stderr)
    raise SystemExit(f"ABORT：migrate 失敗（returncode={result.returncode}）")

print(f"[OK] DEMO DB 建立完成（{DEMO_DB.stat().st_size / 1024:.1f} KB）")
