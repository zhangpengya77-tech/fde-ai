#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R07 測試資料精準清理工具（預設 dry-run；須 --apply 才實際刪除）。

安全設計：
  1. 預設 dry-run，不寫入任何檔案。
  2. --apply 前先重跑清單比對，與凍結基準不一致即中止（STEP 0 GATE）。
  3. 逐筆刪除，每筆記錄；任何失敗立即停止，不繼續刪其餘資料。
  4. 禁止清空整個 Registry / datasets / submissions / 資料庫。
  5. 保留：兩筆 ACTIVE、R07 GrowthRecordSubmission id=7、
     DEMO Submission sub-ea18f5eb...、demo_active_submissions 綁定。

Django 端順序（依教師指令第 6 條）：
  先刪 VisionModelRecord → 再刪對應 Evidence → 保留 GrowthRecordSubmission id=7
  （因 VisionModelRecord.evidence 為 on_delete=PROTECT，順序不可顛倒）
"""
import argparse
import hashlib
import json
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(r"D:\FDE-AI-UAS-v2.0")
VC_DIR = ROOT / "demo" / "runtime" / "vision-center"
VC_JSON = VC_DIR / "vision_center.json"
REGISTRY = VC_DIR / "model_registry"
DATASETS_DIR = VC_DIR / "datasets"
SUBMISSIONS_DIR = VC_DIR / "submissions"
DB = ROOT / "demo" / "runtime" / "db" / "demo.sqlite3"
LOGDIR = ROOT / "demo" / "runtime" / "logs"

KEEP_SUBMISSION_PREFIX = "sub-ea18f5eb"

# --- 凍結基準（前次 Dry-Run 已確認之範圍）---
EXPECTED = {
    "models_total": 42,
    "models_keep": 2,
    "models_delete": 40,
    "datasets_delete": 10,
    "datasets_keep": 2,
    "hard_examples_delete": 9,
    "registry_dirs_delete": 23,
    "registry_dirs_keep": 2,
    "submissions_keep": 1,
    "django_vmr_delete": 1,
    "django_evidence_delete": 1,
    "keep_model_ids": {"PROP_20261010_X_accv2_23fd", "HOVER_20261010_X_haccv1_abc8"},
    "keep_vmr_pk": "c291aaee7098450881d54edb7f7f1cae",
    "keep_evidence_pk": "74cb4253184b484dac54b24a25563c2f",
    "keep_growth_submission_pk": 7,
    "keep_demo_active": {"PROP_DIRECTION": "sub-ea18f5eb-a1a5-41f2-ae7d-512ad380f79e"},
}


class Abort(Exception):
    """遇到任何不一致即中止，避免擴大刪除範圍。"""


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_json():
    with open(VC_JSON, encoding="utf-8") as f:
        return json.load(f)


def build_plan(data):
    """依凍結規則建立計畫；不做任何寫入。"""
    active_ids = {m["model_id"] for m in data["models"] if m.get("status") == "ACTIVE"}
    demo_sub_ids = set(data.get("demo_active_submissions", {}).values())

    keep_models, del_models = [], []
    for m in data["models"]:
        reasons = []
        if m.get("status") == "ACTIVE":
            reasons.append("STATUS_ACTIVE")
        if m.get("source_submission_id") and m.get("source_submission_id") in demo_sub_ids:
            reasons.append("REFERENCED_BY_DEMO_ACTIVE_SUBMISSION")
        (keep_models if reasons else del_models).append(
            {"model_id": m["model_id"], "reasons": reasons, "record": m}
        )

    # datasets：僅保留被 ACTIVE 模型引用者
    keep_ds_ids = {
        m["dataset_id"] for m in data["models"]
        if m.get("status") == "ACTIVE" and m.get("dataset_id")
    }
    keep_ds = [d for d in data["datasets"] if d.get("dataset_id") in keep_ds_ids]
    del_ds = [d for d in data["datasets"] if d.get("dataset_id") not in keep_ds_ids]

    # hard_examples：全刪（無對外引用）
    del_he = list(data.get("hard_examples", []))

    # submissions：保留 DEMO 綁定者
    keep_subs = [
        s for s in data.get("submissions", [])
        if s.get("submission_id", "").startswith(KEEP_SUBMISSION_PREFIX)
        or s.get("submission_id") in demo_sub_ids
    ]
    del_subs = [
        s for s in data.get("submissions", [])
        if s not in keep_subs
    ]

    # registry 目錄
    del_ids = {m["model_id"] for m in del_models}
    keep_ids = {m["model_id"] for m in keep_models}
    dirs_on_disk = set()
    if REGISTRY.is_dir():
        for mt in REGISTRY.iterdir():
            if mt.is_dir():
                for mid in mt.iterdir():
                    if mid.is_dir():
                        dirs_on_disk.add(mid.name)
    dirs_del = sorted(dirs_on_disk & del_ids)
    dirs_keep = sorted(dirs_on_disk & keep_ids)
    orphan = sorted(dirs_on_disk - del_ids - keep_ids)

    return {
        "active_ids": active_ids,
        "demo_sub_ids": demo_sub_ids,
        "keep_models": keep_models,
        "del_models": del_models,
        "keep_ds": keep_ds,
        "del_ds": del_ds,
        "del_he": del_he,
        "keep_subs": keep_subs,
        "del_subs": del_subs,
        "dirs_del": dirs_del,
        "dirs_keep": dirs_keep,
        "dirs_on_disk": sorted(dirs_on_disk),
        "orphan_dirs": orphan,
    }


def django_plan():
    """讀 DB 建立 Django 端計畫（只讀）。"""
    con = sqlite3.connect(str(DB))
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    vmr = [dict(r) for r in cur.execute("SELECT * FROM learning_visionmodelrecord")]
    ev = [dict(r) for r in cur.execute("SELECT * FROM learning_evidence")]
    gs = [dict(r) for r in cur.execute("SELECT * FROM learning_growthrecordsubmission")]
    con.close()
    return vmr, ev, gs


def gate(plan, data, vmr, ev, gs):
    """STEP 0 閘門：與凍結基準逐項比對，任何不一致即中止。"""
    errs = []

    def chk(label, actual, expect):
        if actual != expect:
            errs.append(f"{label}: 實際={actual} 基準={expect}")

    chk("models_total", len(data["models"]), EXPECTED["models_total"])
    chk("models_keep", len(plan["keep_models"]), EXPECTED["models_keep"])
    chk("models_delete", len(plan["del_models"]), EXPECTED["models_delete"])
    chk("datasets_keep", len(plan["keep_ds"]), EXPECTED["datasets_keep"])
    chk("datasets_delete", len(plan["del_ds"]), EXPECTED["datasets_delete"])
    chk("hard_examples_delete", len(plan["del_he"]), EXPECTED["hard_examples_delete"])
    chk("registry_dirs_delete", len(plan["dirs_del"]), EXPECTED["registry_dirs_delete"])
    chk("registry_dirs_keep", len(plan["dirs_keep"]), EXPECTED["registry_dirs_keep"])
    chk("submissions_keep", len(plan["keep_subs"]), EXPECTED["submissions_keep"])

    # 保留模型必須精確等於基準
    actual_keep = {k["model_id"] for k in plan["keep_models"]}
    if actual_keep != EXPECTED["keep_model_ids"]:
        errs.append(f"保留模型集合不符: {actual_keep} != {EXPECTED['keep_model_ids']}")

    # 刪除清單中不得出現 ACTIVE
    active_in_del = [m["model_id"] for m in plan["del_models"] if m["record"].get("status") == "ACTIVE"]
    if active_in_del:
        errs.append(f"刪除清單含 ACTIVE 模型: {active_in_del}")

    # DEMO 綁定必須不變
    if data.get("demo_active_submissions") != EXPECTED["keep_demo_active"]:
        errs.append(
            f"DEMO 綁定不符: {data.get('demo_active_submissions')} != {EXPECTED['keep_demo_active']}"
        )

    # 無孤兒目錄
    if plan["orphan_dirs"]:
        errs.append(f"存在不明歸屬 registry 目錄: {plan['orphan_dirs']}")

    # 保留與刪除不得交集
    if set(plan["dirs_del"]) & set(plan["dirs_keep"]):
        errs.append("registry 待刪與保留目錄有交集")

    # Django 端一致性
    broken = [r for r in vmr if r.get("is_demo_test_only")]
    if len(broken) != EXPECTED["django_vmr_delete"]:
        errs.append(f"Django VMR 待刪筆數不符: {len(broken)} != {EXPECTED['django_vmr_delete']}")
    for r in broken:
        if r["model_id"] != EXPECTED["keep_vmr_pk"]:
            errs.append(f"Django VMR pk 不符: {r['model_id']} != {EXPECTED['keep_vmr_pk']}")

    model_ev = [e for e in ev if e.get("evidence_type") == "model"]
    if len(model_ev) != EXPECTED["django_evidence_delete"]:
        errs.append(f"Django Evidence 待刪筆數不符: {len(model_ev)}")
    for e in model_ev:
        if e["evidence_id"] != EXPECTED["keep_evidence_pk"]:
            errs.append(f"Django Evidence pk 不符: {e['evidence_id']}")

    if not any(g["id"] == EXPECTED["keep_growth_submission_pk"] for g in gs):
        errs.append(f"找無 GrowthRecordSubmission id={EXPECTED['keep_growth_submission_pk']}")

    return errs


class ApplyLog:
    def __init__(self, path):
        self.path = path
        self.entries = []

    def add(self, action, target, detail=""):
        rec = {
            "ts": datetime.now().isoformat(timespec="seconds"),
            "action": action,
            "target": str(target),
            "detail": detail,
        }
        self.entries.append(rec)
        line = f"[{rec['ts']}] {action:12s} {target}"
        if detail:
            line += f"  | {detail}"
        print(line, flush=True)

    def flush(self):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(
                {"log": self.entries, "count": len(self.entries)},
                f, ensure_ascii=False, indent=2,
            )


def do_apply(plan, data, vmr, ev_log, log):
    """逐筆執行；任何失敗立即中止。"""
    # --- A. registry 目錄 ---
    log.add("SECTION", "A. registry 目錄")
    for mid in plan["dirs_del"]:
        d = None
        for mt in REGISTRY.iterdir():
            cand = mt / mid
            if cand.is_dir():
                d = cand
                break
        if d is None:
            raise Abort(f"找不到 registry 目錄: {mid}")
        size = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
        shutil.rmtree(d)
        log.add("RM_DIR", d, f"{size} bytes")

    # --- B. datasets 目錄 + JSON ---
    log.add("SECTION", "B. datasets")
    for ds in plan["del_ds"]:
        did = ds["dataset_id"]
        d = DATASETS_DIR / did
        if d.is_dir():
            shutil.rmtree(d)
            log.add("RM_DIR", d, "dataset")
        else:
            log.add("SKIP", d, "目錄不存在，僅移除 JSON 記錄")

    # --- C. JSON 記錄 ---
    log.add("SECTION", "C. vision_center.json 記錄")
    del_model_ids = {m["model_id"] for m in plan["del_models"]}
    del_ds_ids = {d["dataset_id"] for d in plan["del_ds"]}
    del_he_ids = {h["sample_id"] for h in plan["del_he"]}

    before = {
        "models": len(data["models"]),
        "datasets": len(data["datasets"]),
        "hard_examples": len(data["hard_examples"]),
    }
    data["models"] = [m for m in data["models"] if m["model_id"] not in del_model_ids]
    data["datasets"] = [d for d in data["datasets"] if d.get("dataset_id") not in del_ds_ids]
    data["hard_examples"] = [h for h in data["hard_examples"] if h.get("sample_id") not in del_he_ids]

    log.add("JSON_FILTER", "models", f"{before['models']} -> {len(data['models'])}")
    log.add("JSON_FILTER", "datasets", f"{before['datasets']} -> {len(data['datasets'])}")
    log.add("JSON_FILTER", "hard_examples", f"{before['hard_examples']} -> {len(data['hard_examples'])}")

    # 保留 demo_active_submissions 不變（明確斷言）
    if data.get("demo_active_submissions") != EXPECTED["keep_demo_active"]:
        raise Abort("寫入前 DEMO 綁定已變動，中止")
    log.add("ASSERT", "demo_active_submissions", "保持不變 OK")

    tmp = VC_JSON.with_suffix(".json.applytmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    shutil.move(str(tmp), str(VC_JSON))
    log.add("WRITE", VC_JSON, "寫回完成")

    # --- D. Django：先 VMR 再 Evidence ---
    log.add("SECTION", "D. Django（先 VMR 後 Evidence）")
    con = sqlite3.connect(str(DB))
    con.execute("PRAGMA foreign_keys=ON")
    cur = con.cursor()

    broken = [r for r in vmr if r.get("is_demo_test_only")]
    for r in broken:
        cur.execute("DELETE FROM learning_visionmodelrecord WHERE model_id=?", (r["model_id"],))
        if cur.rowcount != 1:
            con.rollback()
            con.close()
            raise Abort(f"刪除 VMR 失敗，rowcount={cur.rowcount}")
        log.add("DB_DELETE", f"learning_visionmodelrecord {r['model_id']}", f"rows={cur.rowcount}")

    ev_ids = [e["evidence_id"] for e in ev_log if e.get("evidence_type") == "model"]
    for eid in ev_ids:
        cur.execute("DELETE FROM learning_evidence WHERE evidence_id=?", (eid,))
        if cur.rowcount != 1:
            con.rollback()
            con.close()
            raise Abort(f"刪除 Evidence 失敗，rowcount={cur.rowcount}")
        log.add("DB_DELETE", f"learning_evidence {eid}", f"rows={cur.rowcount}")

    # 驗證成長紀錄仍在
    n = cur.execute(
        "SELECT COUNT(*) FROM learning_growthrecordsubmission WHERE id=?",
        (EXPECTED["keep_growth_submission_pk"],),
    ).fetchone()[0]
    if n != 1:
        con.rollback()
        con.close()
        raise Abort(f"GrowthRecordSubmission id={EXPECTED['keep_growth_submission_pk']} 遺失，已回滾")
    con.commit()
    log.add("ASSERT", f"growthrecordsubmission id={EXPECTED['keep_growth_submission_pk']}", "保留 OK")
    con.close()


def main():
    ap = argparse.ArgumentParser(description="R07 測試資料精準清理")
    ap.add_argument("--apply", action="store_true", help="實際執行刪除（預設 dry-run）")
    args = ap.parse_args()

    LOGDIR.mkdir(parents=True, exist_ok=True)
    mode = "APPLY" if args.apply else "DRY-RUN"
    print("=" * 64)
    print(f"R07 測試資料精準清理 — {mode}")
    print("=" * 64)

    # 備份存在性檢查
    bk = ROOT / "demo" / "backup" / "r07-cleanup-20261011-080704"
    if not bk.is_dir():
        print(f"✗ 備份目錄不存在: {bk}")
        return 2
    if sha256_file(DB) != sha256_file(bk / "demo.sqlite3"):
        print("✗ 目前 DB 與備份不一致，中止（可能已被其他程序修改）")
        return 2
    if sha256_file(VC_JSON) != sha256_file(bk / "vision_center.json"):
        print("✗ 目前 vision_center.json 與備份不一致，中止")
        return 2
    print(f"✓ 備份完整：{bk}")

    data = load_json()
    plan = build_plan(data)
    vmr, ev, gs = django_plan()

    # STEP 0 GATE
    errs = gate(plan, data, vmr, ev, gs)
    if errs:
        print("\n✗ STEP 0 GATE 不通過，已中止（不刪除任何資料）：")
        for e in errs:
            print("   -", e)
        return 3
    print("✓ STEP 0 GATE 通過：與 Dry-Run 基準完全一致")

    print("\n--- 實際刪除範圍 ---")
    print(f"  registry 目錄      : {len(plan['dirs_del'])}")
    print(f"  datasets 目錄      : {len(plan['del_ds'])}")
    print(f"  hard_examples      : {len(plan['del_he'])}")
    print(f"  models (JSON 記錄) : {len(plan['del_models'])}")
    print(f"  Django VMR         : {len([r for r in vmr if r.get('is_demo_test_only')])}")
    print(f"  Django Evidence    : {len([e for e in ev if e.get('evidence_type') == 'model'])}")
    print("\n--- 保留 ---")
    for k in plan["keep_models"]:
        print(f"  KEEP {k['model_id']}  [{','.join(k['reasons'])}]")
    print(f"  KEEP datasets      : {[d['dataset_id'] for d in plan['keep_ds']]}")
    print(f"  KEEP submission    : {[s['submission_id'] for s in plan['keep_subs']]}")
    print(f"  KEEP DEMO 綁定     : {data.get('demo_active_submissions')}")
    print(f"  KEEP growth sub id : {EXPECTED['keep_growth_submission_pk']}")

    if not args.apply:
        print(f"\n（DRY-RUN，未刪除任何資料。加上 --apply 才會執行）")
        return 0

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    logpath = LOGDIR / f"r07_cleanup_apply_{ts}.json"
    log = ApplyLog(logpath)
    print(f"\n>>> 開始刪除，日誌：{logpath}\n")

    try:
        do_apply(plan, data, vmr, ev, log)
    except Abort as exc:
        log.add("ABORT", "已中止", str(exc))
        log.flush()
        print(f"\n✗ 中止：{exc}")
        print(f"  日誌已寫出：{logpath}")
        return 4
    except Exception as exc:  # noqa: BLE001
        log.add("ERROR", "未預期錯誤", repr(exc))
        log.flush()
        print(f"\n✗ 未預期錯誤：{exc!r}")
        return 5

    log.add("DONE", "清理完成")
    log.flush()
    print(f"\n✓ 清理完成，日誌：{logpath}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
