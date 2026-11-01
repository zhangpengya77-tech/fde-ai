"""還原 quarantine_orphans.py 隔離的記錄（移除隔離欄位，不動任何其他欄位）。

用法（必須先停 Live）：
    python demo/tools/restore_quarantine.py --apply     # 還原全部隔離記錄
    python demo/tools/restore_quarantine.py             # dry-run，只列出會被還原的記錄
    python demo/tools/restore_quarantine.py --id PROP_20261010_X_accv1 --apply

本腳本只刪除 4 個隔離欄位（quarantined / quarantined_at / quarantine_reason /
quarantined_by），不刪記錄、不搬檔、不改其他欄位。還原後記錄會重新出現在列表。
"""
from __future__ import annotations

import argparse
import json
import shutil
import socket
from datetime import datetime
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
STORE = PROJECT / "demo" / "runtime" / "vision-center" / "vision_center.json"
BIND = ("192.168.1.114", 8111)
QUARANTINE_FIELDS = ("quarantined", "quarantined_at", "quarantine_reason", "quarantined_by")


def port_open() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1.5)
        return sock.connect_ex(BIND) == 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="實際寫入；不加則只做 dry-run")
    parser.add_argument("--id", action="append", default=None,
                        help="只還原指定 model_id / dataset_id（可重複）")
    args = parser.parse_args()

    if port_open():
        print(f"REFUSED: Live Backend 仍在 {BIND[0]}:{BIND[1]} 監聽，請先停止 Live 再執行。")
        return 3

    data = json.loads(STORE.read_text(encoding="utf-8"))
    wanted = set(args.id or [])

    targets: list[tuple[str, str, dict]] = []
    for collection, key in (("models", "model_id"), ("datasets", "dataset_id")):
        for record in data.get(collection) or []:
            if not record.get("quarantined"):
                continue
            if wanted and record.get(key) not in wanted:
                continue
            targets.append((collection, record[key], record))

    if not targets:
        print("沒有符合條件的隔離記錄，無需還原。")
        return 0

    print(f"待還原 {len(targets)} 筆：")
    for collection, record_id, record in targets:
        print("  %-8s %-48s reason=%s at=%s" % (
            collection[:-1].upper(), record_id, record.get("quarantine_reason"),
            record.get("quarantined_at")))

    if not args.apply:
        print("DRY-RUN：未寫入。加上 --apply 才會生效。")
        return 0

    backup_dir = PROJECT / "backups" / "20261019-orphans"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = backup_dir / f"vision_center.restore.{stamp}.json"
    shutil.copy2(STORE, backup)

    for _collection, _record_id, record in targets:
        for field in QUARANTINE_FIELDS:
            record.pop(field, None)

    temp = STORE.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(STORE)

    remaining = sum(1 for c in ("models", "datasets") for r in (data.get(c) or []) if r.get("quarantined"))
    print("RESTORED: %d 筆；store 內仍隔離 %d 筆" % (len(targets), remaining))
    print("counts: models=%d datasets=%d submissions=%d hard_examples=%d" % (
        len(data["models"]), len(data["datasets"]), len(data["submissions"]),
        len(data.get("hard_examples") or [])))
    print("BACKUP:", backup)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
