"""FDE-AI-UAS 2.0 DEMO — 展示資料備份。

把 DEMO DB 與 DEMO MEDIA 打包到 demo/backup/。
只讀取 DEMO 資源，不觸碰正式環境。
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path

DEMO_ROOT = Path(r"D:\FDE-AI-UAS-v2.0\demo")
RUNTIME = DEMO_ROOT / "runtime"
BACKUP_DIR = DEMO_ROOT / "backup"

DEMO_DB = RUNTIME / "db" / "demo.sqlite3"
DEMO_MEDIA = RUNTIME / "media"
DEMO_VISION = RUNTIME / "vision-center"

# 安全护栏：來源必須在 demo/ 之下
for path in (DEMO_DB, DEMO_MEDIA, DEMO_VISION):
    norm = str(path).replace("\\", "/").lower()
    if not norm.startswith(str(DEMO_ROOT).replace("\\", "/").lower()):
        raise SystemExit(f"ABORT：{path} 不在 demo/ 之下。")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    archive = BACKUP_DIR / f"demo-baseline-{stamp}.zip"

    if not DEMO_DB.exists():
        raise SystemExit(f"ABORT：找不到 DEMO DB：{DEMO_DB}")

    db_hash = sha256_file(DEMO_DB)
    manifest = {
        "created_at": datetime.now().isoformat(),
        "demo_db_sha256": db_hash,
        "demo_db_size": DEMO_DB.stat().st_size,
        "vision_store_exists": (DEMO_VISION / "vision_center.json").exists(),
        "files": [],
    }

    print(f"建立備份：{archive}")
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        # DB
        zf.write(DEMO_DB, "db/demo.sqlite3")
        manifest["files"].append("db/demo.sqlite3")

        # MEDIA（遞迴）
        if DEMO_MEDIA.exists():
            for p in sorted(DEMO_MEDIA.rglob("*")):
                if p.is_file():
                    rel = "media/" + p.relative_to(DEMO_MEDIA).as_posix()
                    zf.write(p, rel)
                    manifest["files"].append(rel)

        # Vision Center JSON Store
        if DEMO_VISION.exists():
            for p in sorted(DEMO_VISION.rglob("*")):
                if p.is_file():
                    rel = "vision-center/" + p.relative_to(DEMO_VISION).as_posix()
                    zf.write(p, rel)
                    manifest["files"].append(rel)

        zf.writestr(
            "MANIFEST.json",
            json.dumps(manifest, ensure_ascii=False, indent=2),
        )

    size_kb = archive.stat().st_size / 1024
    print(f"  檔案數   : {len(manifest['files'])}")
    print(f"  壓縮大小 : {size_kb:.1f} KB")
    print(f"  DB SHA256: {db_hash}")
    print()
    print("[OK] DEMO 展示資料備份完成。")
    print()

    # 同時更新「基準」指標檔，供 READINESS REPORT 引用
    baseline = BACKUP_DIR / "LATEST.json"
    baseline.write_text(json.dumps({
        "archive": archive.name,
        "created_at": manifest["created_at"],
        "demo_db_sha256": db_hash,
        "file_count": len(manifest["files"]),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  最新備份指標：{baseline}")


if __name__ == "__main__":
    main()
