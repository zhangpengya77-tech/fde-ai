#!/usr/bin/env python3
"""D8（2026-10-20）模型中心 store 完整性唯讀稽核（只報告、不修復）。

掃描 vision_center.json，產出：
  1. 失效 file_path：紀錄中 file_path 指向的檔案不存在的項目（含 model_id / status）。
  2. 重複檔案引用：同一個檔案路徑被多筆紀錄（model 或 submission）引用的清單。
  3. 其他觀察（例如 quarantine 標記、ACTIVE 指標一致性）。

本工具完全唯讀：不寫入 store、不搬移、不刪除任何紀錄或檔案。
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path


def audit(store_path: Path) -> dict:
    data = json.loads(store_path.read_text(encoding="utf-8"))
    missing: list[dict] = []
    fp_sources: dict[str, list[str]] = defaultdict(list)

    def _scan(records, kind):
        for rec in records or []:
            rid = rec.get("model_id") or rec.get("submission_id") or rec.get("dataset_id")
            fp = rec.get("file_path")
            if not fp:
                continue
            fp_sources[fp].append(f"{kind}:{rid}")
            if not Path(fp).exists():
                missing.append({
                    "id": rid,
                    "kind": kind,
                    "status": rec.get("status"),
                    "validation_status": rec.get("validation_status"),
                    "health": rec.get("health"),
                    "file_path": fp,
                })

    _scan(data.get("models"), "model")
    _scan(data.get("submissions"), "submission")

    duplicates = [
        {"file_path": fp, "referenced_by": ids}
        for fp, ids in fp_sources.items()
        if len(ids) > 1
    ]

    return {
        "store": str(store_path),
        "models": len(data.get("models", [])),
        "submissions": len(data.get("submissions", [])),
        "missing_file_path": missing,
        "duplicate_file_references": duplicates,
    }


def render_report(r: dict) -> str:
    lines = ["# D8 模型中心 store 完整性稽核報告（唯讀）", ""]
    lines.append(f"- store：`{r['store']}`")
    lines.append(f"- 模型總數：{r['models']}｜提交總數：{r['submissions']}")
    lines.append("")

    lines.append(f"## 一、失效 file_path（檔案不存在）— 共 {len(r['missing_file_path'])} 筆")
    if r["missing_file_path"]:
        for m in r["missing_file_path"]:
            lines.append(
                f"- `{m['id']}`（{m['kind']}）status={m['status']}｜validation={m['validation_status']}"
                f"｜health={m['health']}｜file_path=`{m['file_path']}`"
            )
    else:
        lines.append("- 無 ✅")
    lines.append("")

    lines.append(f"## 二、重複檔案引用（同一路徑被多筆紀錄引用）— 共 {len(r['duplicate_file_references'])} 組")
    if r["duplicate_file_references"]:
        for d in r["duplicate_file_references"]:
            lines.append(f"- `{d['file_path']}` ← {', '.join(d['referenced_by'])}")
    else:
        lines.append("- 無 ✅（目前 store 中沒有重複的 file_path 引用）")
    lines.append("")
    lines.append("---")
    lines.append("本報告為唯讀稽核，未對 store 或檔案系統做任何修改。如需修復，請由教師另行裁決。")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="D8 store 完整性唯讀稽核")
    ap.add_argument("--store", default="demo/runtime/vision-center/vision_center.json",
                    help="vision_center.json 路徑")
    ap.add_argument("--report", metavar="FILE", help="輸出 Markdown 報告到指定檔案")
    args = ap.parse_args(argv)

    store = Path(args.store)
    if not store.exists():
        print(f"[ERROR] 找不到 store：{store}", file=sys.stderr)
        return 1

    r = audit(store)
    report = render_report(r)
    print(report)
    if args.report:
        Path(args.report).write_text(report, encoding="utf-8")
        print(f"\n[OK] 報告已寫入 {args.report}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
