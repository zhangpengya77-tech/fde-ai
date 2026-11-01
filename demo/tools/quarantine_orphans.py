"""把孤兒模型 / dataset 記錄標記為隔離（quarantined=true），不刪除任何東西。

背景（2026-10-19）：
  匯入稽核發現 9 筆模型記錄的 best.pt 已不存在、2 筆 dataset 沒有任何模型引用。
  這些都是 2026-10-19 之前就存在的歷史遺留，不是本輪流程造成。
  依教師指令「孤兒用隔離，不用刪除」，本腳本只在記錄上加欄位，
  不搬檔、不改檔、不刪記錄。

為什麼是離線腳本：
  VisionCenter 的 JsonStore 啟動時載入記憶體、寫入時整檔覆寫，
  改 store 必須先停 Live，否則會被記憶體內容蓋回去。

用法（必須先停 Live）：
    python demo/tools/quarantine_orphans.py --apply
    python demo/tools/quarantine_orphans.py            # dry-run

還原：
    python demo/tools/restore_quarantine.py --apply
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

# 9 筆模型：best.pt 已缺失的孤兒記錄
QUARANTINE_MODELS = [
    "PROP_20261010_X_accv1",
    "PROP_20261010_X_accv2",
    "PROP_20261010_X_accv3",
    "PROP_20261010_X_accv1_5fcb",
    "PROP_20261010_X_accv1_f1f8",
    "PROP_20261010_X_accv2_9954",
    "PROP_20261010_X_accv3_2517",
    "HOVER_20261010_X_haccv1",
    "HOVER_20261010_X_haccv1_47e0",
]

# 2 筆 dataset：沒有任何模型引用
QUARANTINE_DATASETS = [
    "dataset-f1937bf1-f5d1-47de-a051-8ba861971d7e",
    "dataset-8464fdf7-4f68-4f9a-a483-5c65cb33adb9",
]

REASON_MODEL = "orphan_missing_model_file"
REASON_DATASET = "orphan_unreferenced_dataset"
QUARANTINE_FIELDS = ("quarantined", "quarantined_at", "quarantine_reason", "quarantined_by")


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def port_open() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1.5)
        return sock.connect_ex(BIND) == 0


def counts(data: dict) -> str:
    return "models=%d datasets=%d submissions=%d hard_examples=%d" % (
        len(data["models"]), len(data["datasets"]), len(data["submissions"]),
        len(data.get("hard_examples") or []),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="實際寫入；不加則只做 dry-run")
    parser.add_argument("--by", default="teacher")
    args = parser.parse_args()

    if port_open():
        print(f"REFUSED: Live Backend 仍在 {BIND[0]}:{BIND[1]} 監聽，請先停止 Live 再執行。")
        return 3

    data = json.loads(STORE.read_text(encoding="utf-8"))
    print("BEFORE counts:", counts(data))
    print()

    # ---- 前置檢查：目標存在、模型檔案確實缺失、dataset 確實無引用 ----
    problems: list[str] = []
    model_hits: list[dict] = []
    for model_id in QUARANTINE_MODELS:
        record = next((m for m in data["models"] if m["model_id"] == model_id), None)
        if record is None:
            problems.append(f"model not found: {model_id}")
            continue
        if record.get("status") == "ACTIVE":
            problems.append(f"model is ACTIVE, refusing: {model_id}")
            continue
        file_path = record.get("file_path")
        if file_path and Path(file_path).exists():
            problems.append(f"model file still exists, refusing: {model_id} -> {file_path}")
            continue
        model_hits.append(record)

    dataset_hits: list[dict] = []
    for dataset_id in QUARANTINE_DATASETS:
        record = next((d for d in data["datasets"] if d["dataset_id"] == dataset_id), None)
        if record is None:
            problems.append(f"dataset not found: {dataset_id}")
            continue
        refs = [m["model_id"] for m in data["models"] if m.get("dataset_id") == dataset_id]
        if refs:
            problems.append(f"dataset still referenced, refusing: {dataset_id} -> {refs}")
            continue
        dataset_hits.append(record)

    if problems:
        print("REFUSED: 前置檢查未通過，未寫入任何變更。")
        for item in problems:
            print("  -", item)
        return 4

    for record in model_hits:
        print("  MODEL  %-32s status=%-9s file_exists=%s" % (
            record["model_id"], record.get("status"), bool(record.get("file_path") and Path(record["file_path"]).exists())))
    for record in dataset_hits:
        print("  DATASET %-46s type=%-18s ver=%s" % (
            record["dataset_id"], record.get("model_type"), record.get("dataset_version")))
    print()

    if not args.apply:
        print(f"DRY-RUN：將隔離 {len(model_hits)} 筆模型 + {len(dataset_hits)} 筆 dataset，未寫入。")
        return 0

    # ---- 備份 ----
    backup_dir = PROJECT / "backups" / "20261019-orphans"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = backup_dir / f"vision_center.{stamp}.json"
    shutil.copy2(STORE, backup)

    # ---- 標記（只加欄位，不動既有欄位、不搬檔） ----
    now = utc_now()
    for record in model_hits:
        record["quarantined"] = True
        record["quarantined_at"] = now
        record["quarantine_reason"] = REASON_MODEL
        record["quarantined_by"] = str(args.by)
    for record in dataset_hits:
        record["quarantined"] = True
        record["quarantined_at"] = now
        record["quarantine_reason"] = REASON_DATASET
        record["quarantined_by"] = str(args.by)

    temp = STORE.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(STORE)

    print("AFTER counts:", counts(data))
    print("QUARANTINED: models=%d datasets=%d" % (len(model_hits), len(dataset_hits)))
    print("BACKUP:", backup)
    print()
    print("還原指令：python demo/tools/restore_quarantine.py --apply")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
