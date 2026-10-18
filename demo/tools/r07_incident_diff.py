#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R07 清理事故 — 備份 vs 現況差異比對（只讀）。

用途：
  1. 確認備份後 DB / JSON 是否有「新的學員提交或教師操作」（若有→不可覆蓋，須回報）。
  2. 精確列出 registry / datasets 中哪些項目被刪除、哪些仍一致。
  3. 產出「僅還原誤刪項目」的計畫，不觸碰其他資料。
"""
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(r"D:\FDE-AI-UAS-v2.0")
BK = ROOT / "demo" / "backup" / "r07-cleanup-20261011-080704"
LIVE_VC = ROOT / "demo" / "runtime" / "vision-center"
DB_LIVE = ROOT / "demo" / "runtime" / "db" / "demo.sqlite3"


def sha256(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def file_map(root):
    """root 下所有檔案的 {相對路徑: (sha256, size)}。"""
    out = {}
    root = Path(root)
    if not root.is_dir():
        return out
    for f in root.rglob("*"):
        if f.is_file():
            out[str(f.relative_to(root))] = (sha256(f), f.stat().st_size)
    return out


def db_fingerprint(path):
    """DB 內容指紋：關鍵表筆數 + 最新時間戳。"""
    con = sqlite3.connect(str(path))
    cur = con.cursor()
    fp = {}
    for t in [
        "auth_user", "learning_evidence", "learning_visionmodelrecord",
        "learning_growthrecordsubmission", "learning_studentprofile",
        "learning_enrollment", "learning_goldenset", "learning_goldensetsample",
        "learning_phaseprogress", "learning_candidatepool",
    ]:
        try:
            fp[t] = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        except Exception:
            fp[t] = "N/A"
    # 最新活動時間（偵測清理後是否有新操作）
    try:
        fp["_latest_evidence"] = cur.execute(
            "SELECT MAX(created_at) FROM learning_evidence").fetchone()[0]
    except Exception:
        fp["_latest_evidence"] = None
    try:
        fp["_latest_submission"] = cur.execute(
            "SELECT MAX(updated_at) FROM learning_growthrecordsubmission").fetchone()[0]
    except Exception:
        fp["_latest_submission"] = None
    con.close()
    return fp


def main():
    report = {"mode": "DIFF_ONLY", "backup": str(BK)}

    # --- DB ---
    fm_bk, fm_live = file_map(BK / "model_registry"), file_map(LIVE_VC / "model_registry")
    ds_bk, ds_live = file_map(BK / "datasets"), file_map(LIVE_VC / "datasets")
    sub_bk, sub_live = file_map(BK / "submissions"), file_map(LIVE_VC / "submissions")

    report["registry"] = {
        "backup_count": len(fm_bk),
        "live_count": len(fm_live),
        "missing_in_live": sorted(set(fm_bk) - set(fm_live)),
        "extra_in_live": sorted(set(fm_live) - set(fm_bk)),
        "content_differs": sorted(
            k for k in set(fm_bk) & set(fm_live) if fm_bk[k] != fm_live[k]
        ),
    }
    report["datasets"] = {
        "backup_count": len(ds_bk),
        "live_count": len(ds_live),
        "missing_in_live": sorted(set(ds_bk) - set(ds_live)),
        "extra_in_live": sorted(set(ds_live) - set(ds_bk)),
        "content_differs": sorted(
            k for k in set(ds_bk) & set(ds_live) if ds_bk[k] != ds_live[k]
        ),
    }
    report["submissions"] = {
        "backup_count": len(sub_bk),
        "live_count": len(sub_live),
        "missing_in_live": sorted(set(sub_bk) - set(sub_live)),
        "extra_in_live": sorted(set(sub_live) - set(sub_bk)),
        "content_differs": sorted(
            k for k in set(sub_bk) & set(sub_live) if sub_bk[k] != sub_live[k]
        ),
    }

    # --- DB 指紋 ---
    fp_bk = db_fingerprint(BK / "demo.sqlite3")
    fp_live = db_fingerprint(DB_LIVE)
    report["db_backup_fp"] = fp_bk
    report["db_live_fp"] = fp_live
    report["db_changed"] = {k: (fp_bk.get(k), fp_live.get(k)) for k in fp_bk if fp_bk.get(k) != fp_live.get(k)}

    # --- JSON ---
    j_bk = json.loads((BK / "vision_center.json").read_text(encoding="utf-8"))
    j_live = json.loads((LIVE_VC / "vision_center.json").read_text(encoding="utf-8"))
    report["json_backup"] = {
        "models": len(j_bk["models"]),
        "datasets": len(j_bk["datasets"]),
        "hard_examples": len(j_bk["hard_examples"]),
        "submissions": len(j_bk["submissions"]),
        "demo_active": j_bk.get("demo_active_submissions"),
    }
    report["json_live"] = {
        "models": len(j_live["models"]),
        "datasets": len(j_live["datasets"]),
        "hard_examples": len(j_live["hard_examples"]),
        "submissions": len(j_live["submissions"]),
        "demo_active": j_live.get("demo_active_submissions"),
    }
    report["json_same"] = sha256(BK / "vision_center.json") == sha256(LIVE_VC / "vision_center.json")

    # --- 統計 ---
    def top_dir(relpath):
        """取相對路徑的第一層目錄名稱，相容 / 與 \\ 分隔符。"""
        return relpath.replace("\\", "/").split("/")[0]

    r, d = report["registry"], report["datasets"]
    report["verdict"] = {
        "registry_dirs_deleted": len({top_dir(p) for p in r["missing_in_live"]}),
        "registry_files_deleted": len(r["missing_in_live"]),
        "datasets_dirs_deleted": len({top_dir(p) for p in d["missing_in_live"]}),
        "datasets_files_deleted": len(d["missing_in_live"]),
        "db_changed": bool(report["db_changed"]),
        "json_changed": not report["json_same"],
        "content_modified_anywhere": bool(
            r["content_differs"] or d["content_differs"] or report["submissions"]["content_differs"]
        ),
    }

    out = ROOT / "demo" / "runtime" / "logs" / "r07_incident_diff.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    # --- 輸出 ---
    v = report["verdict"]
    print("=" * 64)
    print("R07 事故差異比對（備份 08:07 vs 現況）")
    print("=" * 64)
    print(f"registry : 備份 {r['backup_count']} 檔 / 現況 {r['live_count']} 檔")
    print(f"           誤刪 {v['registry_files_deleted']} 檔（{v['registry_dirs_deleted']} 目錄）")
    print(f"           內容被改 {len(r['content_differs'])} / 多出 {len(r['extra_in_live'])}")
    print(f"datasets : 備份 {d['backup_count']} 檔 / 現況 {d['live_count']} 檔")
    print(f"           誤刪 {v['datasets_files_deleted']} 檔（{v['datasets_dirs_deleted']} 目錄）")
    print(f"           內容被改 {len(d['content_differs'])} / 多出 {len(d['extra_in_live'])}")
    print(f"submissions: 備份 {report['submissions']['backup_count']} / 現況 {report['submissions']['live_count']}")
    print()
    print(f"DB 是否有變更   : {v['db_changed']}")
    if report["db_changed"]:
        for k, (b, l) in report["db_changed"].items():
            print(f"    {k}: 備份={b} 現況={l}")
    print(f"JSON 是否有變更 : {v['json_changed']}")
    print(f"  備份: {report['json_backup']}")
    print(f"  現況: {report['json_live']}")
    print()
    print(f"報告：{out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
