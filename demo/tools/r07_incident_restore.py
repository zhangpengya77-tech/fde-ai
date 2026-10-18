#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R07 清理事故 — 精準還原（只還原被誤刪的項目，不覆蓋任何現存資料）。

安全設計：
  1. 只還原「備份有、現況無」的檔案；現況已存在的檔案**一律不覆蓋**。
  2. 還原前逐檔比對：若現況檔案內容與備份不同 → 視為「新資料」→ 跳過並回報。
  3. 不碰 DB、不碰 vision_center.json（差異比對已確認兩者未變更）。
  4. 逐筆記錄並即時 flush。
"""
import argparse
import hashlib
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(r"D:\FDE-AI-UAS-v2.0")
BK = ROOT / "demo" / "backup" / "r07-cleanup-20261011-080704"
LIVE_VC = ROOT / "demo" / "runtime" / "vision-center"
LOG_DIR = ROOT / "demo" / "runtime" / "logs"

TARGETS = [
    ("model_registry", LIVE_VC / "model_registry"),
    ("datasets", LIVE_VC / "datasets"),
    ("submissions", LIVE_VC / "submissions"),
]


def sha256(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


class Log:
    def __init__(self, path):
        self.path = path
        self.fh = open(path, "a", encoding="utf-8")
        self.n = 0

    def add(self, action, target, detail=""):
        rec = {
            "ts": datetime.now().isoformat(timespec="milliseconds"),
            "action": action,
            "target": str(target),
            "detail": detail,
        }
        self.fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self.fh.flush()          # ← 逐筆立即落盤
        self.n += 1
        line = f"[{rec['ts']}] {action:10s} {target}"
        if detail:
            line += f"  | {detail}"
        print(line, flush=True)

    def close(self):
        self.fh.write(json.dumps(
            {"ts": datetime.now().isoformat(timespec="milliseconds"),
             "action": "SUMMARY", "target": "-", "detail": f"共 {self.n} 筆"}, ensure_ascii=False) + "\n")
        self.fh.close()


def plan_restore():
    """建立還原清單：備份有、現況無者。"""
    plan = []
    for label, live_dir in TARGETS:
        bk_dir = BK / label
        if not bk_dir.is_dir():
            continue
        for src in bk_dir.rglob("*"):
            if not src.is_file():
                continue
            rel = src.relative_to(bk_dir)
            dst = live_dir / rel
            if dst.exists():
                same = sha256(src) == sha256(dst)
                plan.append({
                    "label": label, "rel": str(rel), "src": str(src), "dst": str(dst),
                    "action": "SKIP_SAME" if same else "CONFLICT",
                })
            else:
                plan.append({
                    "label": label, "rel": str(rel), "src": str(src), "dst": str(dst),
                    "action": "RESTORE",
                })
    return plan


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    plan = plan_restore()
    restore = [p for p in plan if p["action"] == "RESTORE"]
    conflict = [p for p in plan if p["action"] == "CONFLICT"]
    same = [p for p in plan if p["action"] == "SKIP_SAME"]

    print("=" * 64)
    print(f"R07 事故精準還原 — {'APPLY' if args.apply else 'DRY-RUN'}")
    print("=" * 64)
    print(f"待還原 (備份有/現況無) : {len(restore)}")
    print(f"衝突   (內容不同)      : {len(conflict)}")
    print(f"已一致 (跳過)          : {len(same)}")

    if conflict:
        print("\n⚠️ 發現內容衝突（現況檔案與備份不同），這些檔案不會被覆蓋：")
        for c in conflict:
            print(f"   {c['label']}/{c['rel']}")

    if not args.apply:
        print("\n（DRY-RUN，未還原任何檔案）")
        return 0

    if conflict:
        print("\n✗ 存在衝突，依安全原則中止。請先確認是否為新資料。")
        return 3

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    log = Log(LOG_DIR / f"r07_restore_{ts}.jsonl")
    log.add("START", "還原開始", f"{len(restore)} 檔")

    for p in restore:
        src, dst = Path(p["src"]), Path(p["dst"])
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            if sha256(src) != sha256(dst):
                raise RuntimeError("還原後 SHA256 不一致")
            log.add("RESTORE", f"{p['label']}/{p['rel']}", "sha256 ok")
        except Exception as exc:  # noqa: BLE001
            log.add("ERROR", f"{p['label']}/{p['rel']}", repr(exc))
            log.close()
            print(f"\n✗ 還原失敗並中止：{exc!r}")
            return 4

    log.add("DONE", "還原完成")
    log.close()
    print(f"\n✓ 還原完成 {len(restore)} 檔")
    print(f"  日誌：{LOG_DIR / f'r07_restore_{ts}.jsonl'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
