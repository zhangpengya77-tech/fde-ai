"""把指定學員提交標記為 REJECTED（不刪除任何資料）。

為什麼是離線腳本而不是 API：
  Live Backend 目前沒有「駁回提交」路由（`vision_api.py` 只有 import-preflight /
  import / validate-image），而 VisionCenter 的 JsonStore 是啟動時載入記憶體、
  寫入時整檔覆寫，因此改 store 必須先停 Live，否則會被記憶體內容蓋回去。

用法（必須先停 Live，腳本會自己檢查 8111 是否還在監聽）：
    python demo/tools/reject_submission.py --submission sub-xxxx --reason "duplicate_of:sub-yyyy" --apply

安全保證：
  - 先備份 store 到 backups/<日期>-reject/
  - 只改 status / rejected_by / rejected_at / rejection_reason 四個欄位
  - 不刪除任何記錄或檔案
  - 若該提交已有模型（source_submission_id 指向它），拒絕執行
"""
from __future__ import annotations

import argparse
import json
import shutil
import socket
from datetime import UTC, datetime
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
STORE = PROJECT / "demo" / "runtime" / "vision-center" / "vision_center.json"
BIND = ("192.168.1.114", 8111)


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def port_open() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1.5)
        return sock.connect_ex(BIND) == 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--submission", required=True)
    parser.add_argument("--reason", required=True)
    parser.add_argument("--rejected-by", default="teacher")
    parser.add_argument("--apply", action="store_true", help="實際寫入；不加則只做 dry-run")
    args = parser.parse_args()

    if port_open():
        print(f"REFUSED: Live Backend 仍在 {BIND[0]}:{BIND[1]} 監聽，請先停止 Live 再執行。")
        return 3

    data = json.loads(STORE.read_text(encoding="utf-8"))
    target = next(
        (item for item in data["submissions"] if item["submission_id"] == args.submission), None
    )
    if target is None:
        print(f"ERROR: submission not found: {args.submission}")
        return 2

    linked = [
        item["model_id"] for item in data["models"]
        if item.get("source_submission_id") == args.submission
    ]
    if linked:
        print(f"REFUSED: 此提交已匯入模型 {linked}，不可標記為 REJECTED。")
        return 3

    before = {key: target.get(key) for key in ("status", "rejected_by", "rejected_at", "rejection_reason")}
    print("BEFORE:", json.dumps(before, ensure_ascii=False))

    if not args.apply:
        print("DRY-RUN：未寫入。加上 --apply 才會生效。")
        return 0

    backup_dir = PROJECT / "backups" / f"{datetime.now().strftime('%Y%m%d')}-reject"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = backup_dir / f"vision_center.{stamp}.json"
    shutil.copy2(STORE, backup)

    target.update(
        status="REJECTED",
        rejected_by=str(args.rejected_by),
        rejected_at=utc_now(),
        rejection_reason=str(args.reason),
    )
    temp = STORE.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(STORE)

    after = {key: target.get(key) for key in ("status", "rejected_by", "rejected_at", "rejection_reason")}
    print("AFTER :", json.dumps(after, ensure_ascii=False))
    print("BACKUP:", backup)
    print("counts: models=%d datasets=%d submissions=%d hard_examples=%d" % (
        len(data["models"]), len(data["datasets"]), len(data["submissions"]),
        len(data.get("hard_examples") or []),
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
