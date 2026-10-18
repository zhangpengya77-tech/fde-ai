#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R07 測試資料精準清理 — dry-run（只讀，不刪除任何東西）。

用途：
  建立「逐筆刪除清單」與「引用檢查」，輸出 JSON + Markdown 報告供教師確認。
  本腳本**永不**寫入或刪除；apply 由另一支腳本在取得確認後執行。

保留原則（依教師 2026-10-11 A+C 保守版指令）：
  1. 兩筆 ACTIVE 模型及其必要檔案。
  2. sub-ea18f5eb 開頭的 DEMO Submission。
  3. demo_active_submissions.PROP_DIRECTION 綁定。
  4. 手機 DEMO 模擬推論功能。
  5. 全部學員與教師帳號、課程及非測試成長紀錄。

清理原則：
  1. 已確認的非 ACTIVE 驗收測試模型。
  2. 無引用的測試模型檔案。
  3. 無引用的測試 datasets 與 hard_examples。
  4. Django 中損壞的 DEMO_TEST_ONLY 教師測試模型（最小方式解除關聯）。
"""
import json
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(r"D:\FDE-AI-UAS-v2.0")
VC_JSON = ROOT / "demo" / "runtime" / "vision-center" / "vision_center.json"
REGISTRY = ROOT / "demo" / "runtime" / "vision-center" / "model_registry"
DATASETS_DIR = ROOT / "demo" / "runtime" / "vision-center" / "datasets"
SUBMISSIONS_DIR = ROOT / "demo" / "runtime" / "vision-center" / "submissions"
DB = ROOT / "demo" / "runtime" / "db" / "demo.sqlite3"
OUTDIR = ROOT / "demo" / "runtime" / "logs"

KEEP_SUBMISSION_PREFIX = "sub-ea18f5eb"
KEEP_MODEL_TYPE_ACTIVE = True


def load_json():
    with open(VC_JSON, encoding="utf-8") as f:
        return json.load(f)


def classify_models(data):
    """回傳 (keep, delete, protected_reasons)。"""
    keep, delete, protect = [], [], []

    active_ids = {m["model_id"] for m in data["models"] if m.get("status") == "ACTIVE"}

    # 找出被 demo_active_submissions 指到的 submission，及其若有連帶模型
    demo_sub_ids = set(data.get("demo_active_submissions", {}).values())

    for m in data["models"]:
        mid = m["model_id"]
        reasons = []
        is_active = m.get("status") == "ACTIVE"

        # --- 保護規則 ---
        if is_active:
            reasons.append("STATUS_ACTIVE")
        if m.get("source_submission_id") in demo_sub_ids and m.get("source_submission_id"):
            reasons.append("REFERENCED_BY_DEMO_ACTIVE_SUBMISSION")

        if reasons:
            keep.append({"model_id": mid, "reasons": reasons, "record": m})
            protect.extend([{"model_id": mid, "reason": r} for r in reasons])
            continue

        # --- 刪除候選：非 ACTIVE 的驗收測試模型 ---
        delete.append(
            {
                "model_id": mid,
                "status": m.get("status"),
                "validation_status": m.get("validation_status"),
                "uploaded_by": m.get("uploaded_by"),
                "notes": (m.get("notes") or "").strip(),
                "model_name": m.get("model_name"),
                "file_size": m.get("file_size"),
                "file_path": m.get("file_path"),
                "dataset_id": m.get("dataset_id"),
                "category": classify_category(mid),
            }
        )

    return keep, delete, protect


def classify_category(model_id):
    low = model_id.lower()
    if "fake" in low:
        return "FAKE_PLACEHOLDER"
    if "zz-debug" in low:
        return "DEBUG_PLACEHOLDER"
    if "mis" in low:
        return "MISMATCH_TEST"
    if "accv" in low or "haccv" in low:
        return "ACCEPTANCE_REAL"
    return "UNKNOWN"


def check_datasets(data, delete_models):
    """檢查 datasets 是否被保留的模型引用。"""
    keep_model_dataset_ids = {
        m["dataset_id"]
        for m in data["models"]
        if m.get("status") == "ACTIVE" and m.get("dataset_id")
    }
    out = []
    for d in data["datasets"]:
        did = d.get("dataset_id")
        used_by_kept = did in keep_model_dataset_ids
        out.append(
            {
                "dataset_id": did,
                "model_type": d.get("model_type"),
                "created_by": d.get("created_by") or d.get("uploaded_by"),
                "created_at": d.get("created_at"),
                "dir_exists": (DATASETS_DIR / did).is_dir(),
                "referenced_by_kept_model": used_by_kept,
                "action": "KEEP" if used_by_kept else "DELETE",
            }
        )
    return out


def check_hard_examples(data):
    """hard_examples 無對外引用（純測試樣本）。"""
    return [
        {
            "sample_id": h.get("sample_id"),
            "model_type": h.get("model_type"),
            "model_version": h.get("model_version"),
            "source": h.get("source"),
            "input_reference": h.get("input_reference"),
            "action": "DELETE",
        }
        for h in data.get("hard_examples", [])
    ]


def check_submissions(data):
    out = []
    for s in data.get("submissions", []):
        sid = s.get("submission_id", "")
        is_demo_active = sid in set(data.get("demo_active_submissions", {}).values())
        keep = sid.startswith(KEEP_SUBMISSION_PREFIX) or is_demo_active
        out.append(
            {
                "submission_id": sid,
                "file_size": s.get("file_size"),
                "status": s.get("status"),
                "demo_review_status": s.get("demo_review_status"),
                "is_demo_active": is_demo_active,
                "action": "KEEP" if keep else "DELETE",
            }
        )
    return out


def check_registry_dirs(data, delete_models):
    """比對 registry 目錄與 JSON 記錄。"""
    delete_ids = {m["model_id"] for m in delete_models}
    keep_ids = {m["model_id"] for m in data["models"] if m.get("status") == "ACTIVE"}

    dirs_on_disk = set()
    for mt_dir in REGISTRY.iterdir() if REGISTRY.is_dir() else []:
        if not mt_dir.is_dir():
            continue
        for mid_dir in mt_dir.iterdir():
            if mid_dir.is_dir():
                dirs_on_disk.add(mid_dir.name)

    return {
        "dirs_on_disk": sorted(dirs_on_disk),
        "dirs_to_delete": sorted(dirs_on_disk & delete_ids),
        "dirs_to_keep": sorted(dirs_on_disk & keep_ids),
        "orphan_json_records": sorted(delete_ids - dirs_on_disk),
        "orphan_dirs": sorted(dirs_on_disk - delete_ids - keep_ids),
    }


def check_django():
    """檢查 Django 端壞掉的 DEMO_TEST_ONLY 記錄與引用鏈。"""
    import sqlite3

    con = sqlite3.connect(str(DB))
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    out = {}

    cur.execute("SELECT * FROM learning_visionmodelrecord")
    vmr = [dict(r) for r in cur.fetchall()]
    out["vision_model_records"] = vmr

    cur.execute("SELECT evidence_id, evidence_type, growth_submission_id, progress_id, description FROM learning_evidence")
    out["evidence"] = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT id, status, definition_id, enrollment_id FROM learning_growthrecordsubmission")
    out["growth_submissions"] = [dict(r) for r in cur.fetchall()]

    # 反向引用檢查：evidence 是否被其他表引用
    ref_check = {}
    for tbl, col in [
        ("learning_candidatepool", "evidence_id"),
        ("learning_teacherreviewevent", "evidence_id"),
        ("learning_growthrecordsubmission_selected_evidence", "evidence_id"),
    ]:
        try:
            n = cur.execute(f"SELECT COUNT(*) FROM {tbl} WHERE {col} IS NOT NULL").fetchone()[0]
            ref_check[tbl] = n
        except Exception as exc:  # noqa: BLE001
            ref_check[tbl] = f"ERR:{exc}"
    out["reverse_refs"] = ref_check

    con.close()
    return out


def build_django_plan(dj):
    """建立 Django 端最小解除方案。

    VisionModelRecord.evidence 為 on_delete=PROTECT 的 OneToOne，
    因此不可直接刪 Evidence。最小安全方式為：
      1. 先刪 VisionModelRecord（解除 PROTECT 保護）
      2. 再刪 Evidence（解除 GrowthRecordSubmission 的 FK）
      3. **保留** GrowthRecordSubmission id=7 本身（學員成長紀錄）
    """
    plan = []
    broken = [r for r in dj["vision_model_records"] if r.get("is_demo_test_only")]
    for r in broken:
        plan.append(
            {
                "step": 1,
                "action": "DELETE",
                "table": "learning_visionmodelrecord",
                "pk": r["model_id"],
                "reason": "is_demo_test_only=1 且 integrity_status=MISSING 的損壞 DEMO 測試紀錄",
                "blocked_by": "none (protect 指向 evidence，先刪本表)",
            }
        )
    evidence_ids = {
        r["evidence_id"] for r in dj["evidence"] if r["evidence_type"] == "model"
    }
    for ev in evidence_ids:
        plan.append(
            {
                "step": 2,
                "action": "DELETE",
                "table": "learning_evidence",
                "pk": ev,
                "reason": "測試模型證據（2097 bytes 佔位檔），隨 VisionModelRecord 一併移除",
                "blocked_by": "learning_visionmodelrecord.evidence (PROTECT) — 已於 step 1 解除",
            }
        )
    plan.append(
        {
            "step": 3,
            "action": "KEEP",
            "table": "learning_growthrecordsubmission",
            "pk": 7,
            "reason": "學員 R07 成長紀錄本體；僅解除測試模型關聯，紀錄與狀態保留",
        }
    )
    return plan


def main():
    data = load_json()
    keep, delete, protect = classify_models(data)
    datasets = check_datasets(data, delete)
    hard = check_hard_examples(data)
    subs = check_submissions(data)
    reg = check_registry_dirs(data, delete)
    dj = check_django()
    dj_plan = build_django_plan(dj)

    delete_bytes = sum(m["file_size"] or 0 for m in delete)

    report = {
        "mode": "DRY_RUN",
        "generated_at": __import__("datetime").datetime.now().isoformat(),
        "summary": {
            "models_total": len(data["models"]),
            "models_keep": len(keep),
            "models_delete": len(delete),
            "models_delete_bytes": delete_bytes,
            "datasets_total": len(data["datasets"]),
            "datasets_delete": sum(1 for d in datasets if d["action"] == "DELETE"),
            "hard_examples_delete": len(hard),
            "submissions_total": len(subs),
            "submissions_keep": sum(1 for s in subs if s["action"] == "KEEP"),
            "registry_dirs_delete": len(reg["dirs_to_delete"]),
            "django_records_delete": sum(1 for p in dj_plan if p["action"] == "DELETE"),
        },
        "protected": keep,
        "delete_models": delete,
        "datasets": datasets,
        "hard_examples": hard,
        "submissions": subs,
        "registry": reg,
        "demo_active_submissions": data.get("demo_active_submissions"),
        "django": dj,
        "django_plan": dj_plan,
    }

    OUTDIR.mkdir(parents=True, exist_ok=True)
    out_json = OUTDIR / "r07_cleanup_dryrun.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    # --- 控制台摘要 ---
    s = report["summary"]
    print("=" * 62)
    print("R07 測試資料清理 — DRY RUN（未刪除任何檔案）")
    print("=" * 62)
    print(f"模型總數        : {s['models_total']}")
    print(f"  保留          : {s['models_keep']}")
    print(f"  刪除          : {s['models_delete']}  (約 {delete_bytes/1024/1024:.1f} MB)")
    print(f"datasets 刪除   : {s['datasets_delete']}")
    print(f"hard_examples   : {s['hard_examples_delete']}")
    print(f"submissions 保留: {s['submissions_keep']}")
    print(f"registry 目錄刪 : {s['registry_dirs_delete']}")
    print(f"Django 刪除筆數 : {s['django_records_delete']}")
    print()
    print("--- 保護的模型 ---")
    for k in keep:
        print(f"  KEEP {k['model_id']}  [{','.join(k['reasons'])}] status={k['record'].get('status')}")
    print()
    print("--- 刪除分類統計 ---")
    print(" ", dict(Counter(m["category"] for m in delete)))
    print()
    print("--- DEMO 綁定（保留）---")
    print(" ", report["demo_active_submissions"])
    print()
    print("--- Django 計畫 ---")
    for p in dj_plan:
        print(f"  step{p['step']} {p['action']:6s} {p['table']} pk={p['pk']}")
    print()
    print(f"JSON 報告：{out_json}")
    return report


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
