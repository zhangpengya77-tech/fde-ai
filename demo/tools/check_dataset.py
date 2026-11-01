#!/usr/bin/env python3
"""D7（2026-10-20）資料集標籤檢查工具（唯讀，只報告不修改）。

檢查一個 YOLO 訓練資料集的「類別標籤」是否統一為 4 類：
    CW_F, CCW_F, CW_B, CCW_B
若出現非此 4 類的名稱（例如 CCE-F、CCF-b 等筆誤），列出並給出建議修正。

支援三種輸入來源（自動偵測，可混合）：
  1. classes.txt / classes.names        : 每行一個類別名
  2. data.yaml / dataset.yaml           : 讀取 names: 清單
  3. dataset_metadata.json              : 讀取 class_distribution 的 key
  4. labels/ 目錄下的 *.txt 標籤檔      : 第一欄為類別索引，配合 classes.txt 反查名稱
                                         （若無 classes.txt，則把索引當成名稱報告）

用法：
  python check_dataset.py <dataset_dir> [--report out.md] [--strict]
  python check_dataset.py --all-datasets <vision-center/datasets_dir> [--report out.md]

本工具完全唯讀：不寫入、不搬移、不刪除任何檔案，只在 stdout / 選用報告檔輸出結果。
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Iterable

# ---- 規格：任務要求的 4 類標準名稱 ----
CANONICAL = ("CW_F", "CCW_F", "CW_B", "CCW_B")
CANONICAL_SET = set(CANONICAL)

# ---- 建議修正用的筆誤對照（與 vision_class_mappings.json 的 name_mapping 一致）----
TYPO_SUGGESTIONS = {
    "CCE-F": "CCW_F", "CCE_F": "CCW_F", "CCE-F?": "CCW_F",
    "CCF-b": "CCW_B", "CCF_B": "CCW_B", "CCF-b?": "CCW_B",
    "CCW-F": "CCW_F", "CCW-B": "CCW_B",
    "CW-f": "CW_F", "CW-b": "CW_B", "CW-F": "CW_F", "CW-B": "CW_B",
    "CWF": "CW_F", "CCWF": "CCW_F", "CWB": "CW_B", "CCWB": "CCW_B",
}


def suggest_fix(name: str) -> str | None:
    """給出最接近的正確類別名建議；無法判斷則回傳 None。"""
    n = (name or "").strip()
    if n in CANONICAL_SET:
        return None
    if n in TYPO_SUGGESTIONS:
        return TYPO_SUGGESTIONS[n]
    # 大小寫 / 連字號容錯
    norm = n.replace("-", "_").upper()
    if norm in CANONICAL_SET:
        return norm
    if norm in TYPO_SUGGESTIONS:
        return TYPO_SUGGESTIONS[norm]
    # 去掉尾端問號
    base = norm.rstrip("?")
    if base in TYPO_SUGGESTIONS:
        return TYPO_SUGGESTIONS[base]
    return None


def _read_names_file(path: Path) -> list[str]:
    return [ln.strip() for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]


def _read_yaml_names(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    # 極簡 yaml names 解析：找 names: 後的清單（支援 [a, b] 或縮排 - item）
    import re
    inline = re.search(r"names\s*:\s*\[(.*?)\]", text)
    if inline:
        return [x.strip().strip("'\"") for x in inline.group(1).split(",") if x.strip()]
    names: list[str] = []
    in_block = False
    for line in text.splitlines():
        if re.match(r"^\s*names\s*:\s*$", line):
            in_block = True
            continue
        if in_block:
            m = re.match(r"^\s*-\s*(.+?)\s*$", line)
            if m:
                names.append(m.group(1).strip().strip("'\""))
            elif re.match(r"^\S", line):
                break
    return names


def _read_metadata_classes(path: Path) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    cd = data.get("class_distribution") or {}
    return [str(k) for k in cd.keys()]


def collect_class_names(dataset_dir: Path) -> tuple[list[str], list[str]]:
    """回傳 (發現的類別名清單, 資訊訊息清單)。"""
    notes: list[str] = []
    names: list[str] = []

    classes_file = None
    for cand in ("classes.txt", "classes.names"):
        p = dataset_dir / cand
        if p.exists():
            classes_file = p
            break

    yaml_file = None
    for cand in ("data.yaml", "dataset.yaml", "data.yml"):
        p = dataset_dir / cand
        if p.exists():
            yaml_file = p
            break

    meta_file = dataset_dir / "dataset_metadata.json"

    if classes_file:
        names += _read_names_file(classes_file)
        notes.append(f"讀取類別名：{classes_file.name}")
    if yaml_file:
        names += _read_yaml_names(yaml_file)
        notes.append(f"讀取類別名：{yaml_file.name}")
    if meta_file.exists():
        try:
            names += _read_metadata_classes(meta_file)
            notes.append(f"讀取類別名：{meta_file.name}（class_distribution）")
        except Exception as exc:
            notes.append(f"讀取 {meta_file.name} 失敗：{exc}")

    # 若有 labels/ 目錄，從標籤檔反查（需 classes.txt 才有名稱，否則用索引）
    labels_dir = dataset_dir / "labels"
    label_files = sorted(labels_dir.glob("*.txt")) if labels_dir.is_dir() else []
    if label_files:
        index_names = _read_names_file(classes_file) if classes_file else None
        idx_counter: Counter = Counter()
        for lf in label_files:
            for line in lf.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                first = line.split(maxsplit=1)[0]
                if not first.lstrip("-").isdigit():
                    continue
                idx = int(first)
                idx_counter[idx] += 1
                if index_names and 0 <= idx < len(index_names):
                    pass  # 名稱稍後由 index_names 提供
                else:
                    names.append(str(idx))  # 無名稱檔時以索引代稱
        if index_names:
            # 只加入實際在標籤中出現過的索引對應名稱
            for idx in idx_counter:
                if 0 <= idx < len(index_names):
                    names.append(index_names[idx])
        notes.append(f"掃描標籤檔：{len(label_files)} 個檔案，出現索引 {dict(sorted(idx_counter.items()))}")

    # 去重但保留順序
    seen: set[str] = set()
    ordered: list[str] = []
    for n in names:
        if n not in seen:
            seen.add(n)
            ordered.append(n)
    return ordered, notes


def check_dataset(dataset_dir: Path, strict: bool = False) -> dict:
    names, notes = collect_class_names(dataset_dir)
    if not names:
        return {
            "dataset": str(dataset_dir),
            "status": "EMPTY",
            "canonical": list(CANONICAL),
            "found": [],
            "problems": [],
            "notes": notes + ["未發現任何類別標籤（資料集可能為空）。"],
        }

    problems: list[dict] = []
    for name in names:
        # 正規化（連字號→底線、大寫）後再比對標準 4 類，
        # 避免把 CCW-F 這種「只是命名風格不同」的正確類別誤判為錯誤。
        norm = (name or "").replace("-", "_").upper()
        if norm in CANONICAL_SET:
            continue
        problems.append({
            "name": name,
            "suggestion": suggest_fix(name),
        })

    status = "OK" if not problems else ("WARN" if not strict else "FAIL")
    return {
        "dataset": str(dataset_dir),
        "status": status,
        "canonical": list(CANONICAL),
        "found": names,
        "problems": problems,
        "notes": notes,
    }


def render_report(results: Iterable[dict]) -> str:
    lines = ["# D7 資料集標籤檢查報告（唯讀）", ""]
    total_problems = 0
    for r in results:
        total_problems += len(r["problems"])
        lines.append(f"## {r['dataset']}")
        lines.append(f"- 狀態：**{r['status']}**")
        lines.append(f"- 標準 4 類：`{'、'.join(r['canonical'])}`")
        lines.append(f"- 發現類別（{len(r['found'])}）：`{'、'.join(r['found']) or '（無）'}`")
        if r["problems"]:
            lines.append("- 問題標籤：")
            for p in r["problems"]:
                sug = f" → 建議修正為 `{p['suggestion']}`" if p["suggestion"] else " → （無自動建議，請人工確認）"
                lines.append(f"  - `{p['name']}`{sug}")
        else:
            lines.append("- 問題標籤：無 ✅")
        for n in r["notes"]:
            lines.append(f"  - _來源：{n}_")
        lines.append("")
    lines.append("---")
    lines.append(f"合計問題標籤數：**{total_problems}**")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="D7 資料集標籤檢查（唯讀）")
    ap.add_argument("dataset_dir", nargs="?", help="單一資料集目錄")
    ap.add_argument("--all-datasets", metavar="DIR", help="掃描該目錄下所有子目錄（每個子目錄視為一筆資料集）")
    ap.add_argument("--report", metavar="FILE", help="輸出 Markdown 報告到指定檔案")
    ap.add_argument("--strict", action="store_true", help="出現任何非標準標籤即視為失敗（exit code 2）")
    args = ap.parse_args(argv)

    targets: list[Path] = []
    if args.all_datasets:
        base = Path(args.all_datasets)
        if not base.is_dir():
            print(f"[ERROR] 找不到目錄：{base}", file=sys.stderr)
            return 1
        targets = sorted(p for p in base.iterdir() if p.is_dir())
        if not targets:
            print(f"[WARN] {base} 下沒有子目錄。", file=sys.stderr)
    elif args.dataset_dir:
        targets = [Path(args.dataset_dir)]
    else:
        ap.print_help()
        return 1

    results = [check_dataset(t, strict=args.strict) for t in targets]
    report = render_report(results)
    print(report)

    if args.report:
        Path(args.report).write_text(report, encoding="utf-8")
        print(f"\n[OK] 報告已寫入 {args.report}", file=sys.stderr)

    if args.strict and any(r["problems"] for r in results):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
