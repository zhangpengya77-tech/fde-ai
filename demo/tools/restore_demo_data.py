"""FDE-AI-UAS 2.0 DEMO — 展示資料還原。

把備份檔還原到 DEMO 環境。還原前會：
  1. 確認目標路徑全部在 demo/ 之下（否則中止）。
  2. 列出即將覆寫的內容並要求 --yes 才實際寫入。
絕不觸碰正式 DB / 正式 MEDIA / 正式 JSON Store。

用法：
    python restore_demo_data.py                 # 列出最新備份，僅預覽
    python restore_demo_data.py --yes           # 還原最新備份
    python restore_demo_data.py <zip> --yes     # 還原指定備份
"""

from __future__ import annotations

import json
import shutil
import sys
import zipfile
from pathlib import Path

DEMO_ROOT = Path(r"D:\FDE-AI-UAS-v2.0\demo")
RUNTIME = DEMO_ROOT / "runtime"
BACKUP_DIR = DEMO_ROOT / "backup"

DEMO_DB = RUNTIME / "db" / "demo.sqlite3"
DEMO_MEDIA = RUNTIME / "media"
DEMO_VISION = RUNTIME / "vision-center"

# --- 安全护栏：任何寫入目標都必須在 demo/ 之下 ------------------------------
DEMO_PREFIX = str(DEMO_ROOT).replace("\\", "/").lower()
for path in (DEMO_DB, DEMO_MEDIA, DEMO_VISION):
    norm = str(path).replace("\\", "/").lower()
    if not norm.startswith(DEMO_PREFIX):
        raise SystemExit(f"ABORT：還原目標不在 demo/ 之下：{path}")


def pick_archive() -> Path | None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if args:
        p = Path(args[0])
        return p if p.is_absolute() else (BACKUP_DIR / p)
    latest = BACKUP_DIR / "LATEST.json"
    if latest.exists():
        name = json.loads(latest.read_text(encoding="utf-8"))["archive"]
        return BACKUP_DIR / name
    zips = sorted(BACKUP_DIR.glob("demo-baseline-*.zip"))
    return zips[-1] if zips else None


def main() -> None:
    archive = pick_archive()
    if archive is None or not archive.exists():
        raise SystemExit("ABORT：找不到任何 DEMO 備份檔（demo/backup/demo-baseline-*.zip）。")

    do_it = "--yes" in sys.argv

    print("=" * 72)
    print("  DEMO 展示資料還原")
    print("=" * 72)
    print(f"  備份來源 : {archive}")
    print(f"  備份大小 : {archive.stat().st_size / 1024:.1f} KB")
    print()
    print("  還原目標（全部在 demo/ 之下）：")
    print(f"    DEMO DB     → {DEMO_DB}")
    print(f"    DEMO MEDIA  → {DEMO_MEDIA}")
    print(f"    DEMO VISION → {DEMO_VISION}")
    print()

    with zipfile.ZipFile(archive) as zf:
        names = zf.namelist()
        if "MANIFEST.json" in names:
            man = json.loads(zf.read("MANIFEST.json").decode("utf-8"))
            print(f"  備份建立時間 : {man.get('created_at')}")
            print(f"  備份內檔案數 : {len(man.get('files', []))}")
            print(f"  DB SHA256    : {man.get('demo_db_sha256')}")
            print()

    if not do_it:
        print("  [預覽模式] 未寫入任何檔案。")
        print()
        print("  若確認要還原，請執行：")
        print(f"    python demo/tools/restore_demo_data.py {archive.name} --yes")
        print()
        return

    # 額外確認：目標確實是 DEMO
    ans = "y"
    if not sys.stdin.isatty():
        print("  [非互動模式] 已指定 --yes 且目標在 demo/ 之下，繼續還原。")
    else:
        ans = input("  即將覆寫上述 DEMO 資源，確定嗎？(yes/no): ").strip().lower()
    if ans not in ("y", "yes"):
        print("  已取消，未做任何變更。")
        return

    print()
    print("  還原中…")
    with zipfile.ZipFile(archive) as zf:
        for name in zf.namelist():
            if name == "MANIFEST.json" or name.endswith("/"):
                continue
            if name.startswith("db/"):
                target = RUNTIME / name
            elif name.startswith("media/"):
                target = RUNTIME / name
            elif name.startswith("vision-center/"):
                target = RUNTIME / name
            else:
                print(f"    [SKIP] 未知路徑：{name}")
                continue

            # 再次確認目標在 demo/ 之下
            if not str(target).replace("\\", "/").lower().startswith(DEMO_PREFIX):
                print(f"    [SKIP] 目標越界：{target}")
                continue

            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(name) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)
            print(f"    還原 {name}")

    print()
    print("[OK] DEMO 展示資料已還原。")
    print()
    print("  下一步：執行 CHECK_FDE_2_DEMO.cmd 確認展示環境健康。")


if __name__ == "__main__":
    main()
