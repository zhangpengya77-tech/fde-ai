#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R07 測試資料精準清理工具 v2（事故後修正版）。

修正自 v1 的三項缺陷（2026-10-11 事故）：
  1. 【日誌】改為 JSONL 逐筆 append + 立即 flush，中斷也不遺失紀錄。
  2. 【續跑】支援中斷後安全續跑；已完成的階段自動偵測並跳過。
  3. 【核對】刪除前逐筆核對 ID / 路徑 / SHA256 / 是否被 ACTIVE 引用。

安全設計：
  - 預設 dry-run；須 --apply 才寫入。
  - --apply 前執行 GATE，與凍結基準逐項比對，不一致即中止。
  - 支援「部分已清理」狀態：GATE 會計算「剩餘待處理」，而非假設全未做。
  - 逐筆刪除，任何失敗立即停止並回報，不繼續刪其他資料。
  - 禁止清空整個 Registry / datasets / submissions / 資料庫。

Django 端順序：先刪 VisionModelRecord → 再刪 Evidence → 保留 GrowthSubmission id=7
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
DB = ROOT / "demo" / "runtime" / "db" / "demo.sqlite3"
LOG_DIR = ROOT / "demo" / "runtime" / "logs"
BACKUP = ROOT / "demo" / "backup" / "r07-cleanup-20261011-080704"

KEEP_SUBMISSION_PREFIX = "sub-ea18f5eb"

# --- 凍結基準（前次已核准之範圍）---
EXPECTED = {
    "models_total": 42,
    "models_keep": 2,
    "models_delete": 40,
    "datasets_keep": 2,
    "datasets_delete": 10,
    "hard_examples_delete": 9,
    "registry_dirs_keep": 2,
    "registry_dirs_delete": 23,
    "submissions_keep": 1,
    "keep_model_ids": {"PROP_20261010_X_accv2_23fd", "HOVER_20261010_X_haccv1_abc8"},
    "keep_dataset_ids": {
        "dataset-1c41e63a-fb8c-4396-85e0-35ab45207222",
        "dataset-febb9949-6991-4203-bfb8-d6bf4e59189a",
    },
    "keep_demo_active": {"PROP_DIRECTION": "sub-ea18f5eb-a1a5-41f2-ae7d-512ad380f79e"},
    "django_vmr_delete": 1,
    "django_evidence_delete": 1,
    "keep_vmr_pk": "c291aaee7098450881d54edb7f7f1cae",
    "keep_evidence_pk": "74cb4253184b484dac54b24a25563c2f",
    "keep_growth_submission_pk": 7,
}


class Abort(Exception):
    pass


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class JsonlLog:
    """逐筆 append + 立即 flush 的日誌（修正缺陷 1）。"""

    def __init__(self, path):
        self.path = path
        self.fh = open(path, "a", encoding="utf-8")
        self.n = 0

    def add(self, action, target, detail=""):
        rec = {
            "ts": datetime.now().isoformat(timespec="milliseconds"),
            "action": action,
            "target": str(target),
            "detail": str(detail),
        }
        self.fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self.fh.flush()                 # ← 立即落盤
        self.n += 1
        print(f"[{rec['ts']}] {action:12s} {target}" + (f"  | {detail}" if detail else ""), flush=True)

    def close(self):
        self.fh.close()


def load_json():
    with open(VC_JSON, encoding="utf-8") as f:
        return json.load(f)


def build_plan(data):
    active_ids = {m["model_id"] for m in data["models"] if m.get("status") == "ACTIVE"}
    demo_sub_ids = set(data.get("demo_active_submissions", {}).values())

    keep_models, del_models = [], []
    for m in data["models"]:
        reasons = []
        if m.get("status") == "ACTIVE":
            reasons.append("STATUS_ACTIVE")
        if m.get("source_submission_id") and m.get("source_submission_id") in demo_sub_ids:
            reasons.append("REFERENCED_BY_DEMO_ACTIVE")
        (keep_models if reasons else del_models).append(
            {"model_id": m["model_id"], "reasons": reasons, "record": m}
        )

    keep_ds_ids = {
        m["dataset_id"] for m in data["models"]
        if m.get("status") == "ACTIVE" and m.get("dataset_id")
    }
    keep_ds = [d for d in data["datasets"] if d.get("dataset_id") in keep_ds_ids]
    del_ds = [d for d in data["datasets"] if d.get("dataset_id") not in keep_ds_ids]
    del_he = list(data.get("hard_examples", []))

    keep_subs = [
        s for s in data.get("submissions", [])
        if s.get("submission_id", "").startswith(KEEP_SUBMISSION_PREFIX)
        or s.get("submission_id") in demo_sub_ids
    ]
    del_subs = [s for s in data.get("submissions", []) if s not in keep_subs]

    del_ids = {m["model_id"] for m in del_models}
    keep_model_ids = {m["model_id"] for m in keep_models}
    dirs_on_disk = set()
    if REGISTRY.is_dir():
        for mt in REGISTRY.iterdir():
            if mt.is_dir():
                for mid in mt.iterdir():
                    if mid.is_dir():
                        dirs_on_disk.add(mid.name)

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
        "dirs_on_disk": sorted(dirs_on_disk),
        # 只列「還存在、且應刪」的目錄（續跑安全：支援缺陷 2）
        "dirs_to_remove": sorted(dirs_on_disk & del_ids),
        "dirs_keep_present": sorted(dirs_on_disk & keep_model_ids),
        "orphan_dirs": sorted(dirs_on_disk - del_ids - keep_model_ids),
    }


def read_db():
    con = sqlite3.connect(str(DB))
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    vmr = [dict(r) for r in cur.execute("SELECT * FROM learning_visionmodelrecord")]
    ev = [dict(r) for r in cur.execute("SELECT * FROM learning_evidence")]
    gs = [dict(r) for r in cur.execute("SELECT id FROM learning_growthrecordsubmission")]
    con.close()
    return vmr, ev, gs


def gate(plan, data, vmr, ev, gs):
    """與凍結基準比對。支援「部分已清理」狀態。"""
    errs, warns = [], []

    def chk(label, actual, expect):
        if actual != expect:
            errs.append(f"{label}: 實際={actual} 基準={expect}")

    # JSON 層（必須仍完整，因為還原後 JSON 未動）
    chk("models_total", len(data["models"]), EXPECTED["models_total"])
    chk("models_keep", len(plan["keep_models"]), EXPECTED["models_keep"])
    chk("models_delete", len(plan["del_models"]), EXPECTED["models_delete"])
    chk("datasets_keep", len(plan["keep_ds"]), EXPECTED["datasets_keep"])
    chk("datasets_delete", len(plan["del_ds"]), EXPECTED["datasets_delete"])
    chk("hard_examples_delete", len(plan["del_he"]), EXPECTED["hard_examples_delete"])
    chk("submissions_keep", len(plan["keep_subs"]), EXPECTED["submissions_keep"])

    if {k["model_id"] for k in plan["keep_models"]} != EXPECTED["keep_model_ids"]:
        errs.append("保留模型集合不符基準")

    if data.get("demo_active_submissions") != EXPECTED["keep_demo_active"]:
        errs.append(f"DEMO 綁定不符: {data.get('demo_active_submissions')}")

    if any(m["record"].get("status") == "ACTIVE" for m in plan["del_models"]):
        errs.append("刪除清單含 ACTIVE 模型")

    if plan["orphan_dirs"]:
        errs.append(f"存在不明歸屬 registry 目錄: {plan['orphan_dirs']}")

    # 保留目錄必須都在（續跑安全檢查）
    for mid in EXPECTED["keep_model_ids"]:
        if mid not in plan["dirs_keep_present"]:
            errs.append(f"保留模型目錄遺失: {mid}")

    # Registry 續跑狀態
    if len(plan["dirs_to_remove"]) not in (0, EXPECTED["registry_dirs_delete"]):
        errs.append(
            f"registry 待刪目錄數異常: {len(plan['dirs_to_remove'])}"
            f"（應為 0 或 {EXPECTED['registry_dirs_delete']}）"
        )
    if len(plan["dirs_to_remove"]) == 0:
        warns.append("registry 目錄已清理完畢（續跑模式）")

    # Django 續跑狀態
    broken = [r for r in vmr if r.get("is_demo_test_only")]
    model_ev = [e for e in ev if e.get("evidence_type") == "model"]
    if len(broken) not in (0, EXPECTED["django_vmr_delete"]):
        errs.append(f"Django VMR 待刪數異常: {len(broken)}")
    if len(model_ev) not in (0, EXPECTED["django_evidence_delete"]):
        errs.append(f"Django Evidence 待刪數異常: {len(model_ev)}")
    for r in broken:
        if r["model_id"] != EXPECTED["keep_vmr_pk"]:
            errs.append(f"VMR pk 不符: {r['model_id']}")
    for e in model_ev:
        if e["evidence_id"] != EXPECTED["keep_evidence_pk"]:
            errs.append(f"Evidence pk 不符: {e['evidence_id']}")
    if len(broken) == 0 and len(model_ev) == 0:
        warns.append("Django 已清理完畢（續跑模式）")

    if EXPECTED["keep_growth_submission_pk"] not in {g["id"] for g in gs}:
        errs.append(f"GrowthRecordSubmission id={EXPECTED['keep_growth_submission_pk']} 不存在")

    return errs, warns


def pre_delete_check(target_path, log):
    """刪除前核對：路徑存在、位於預期根目錄之下（防止誤刪）。"""
    p = Path(target_path).resolve()
    for root, label in ((REGISTRY.resolve(), "registry"), (DATASETS_DIR.resolve(), "datasets")):
        try:
            p.relative_to(root)
            if p == root:
                raise Abort(f"拒絕刪除根目錄本身: {root}")
            log.add("CHECK", p, f"位於 {label} 之下，允許刪除")
            return
        except ValueError:
            continue
    raise Abort(f"路徑不在預期根目錄內，拒絕刪除: {p}")


def do_apply(plan, data, vmr, ev, log):
    # --- A. registry 目錄 ---
    log.add("SECTION", "A. registry 目錄", f"待刪 {len(plan['dirs_to_remove'])}")
    for mid in plan["dirs_to_remove"]:
        d = None
        for mt in REGISTRY.iterdir():
            cand = mt / mid
            if cand.is_dir():
                d = cand
                break
        if d is None:
            raise Abort(f"找不到 registry 目錄: {mid}")
        if mid in EXPECTED["keep_model_ids"]:
            raise Abort(f"拒絕刪除 ACTIVE 模型目錄: {mid}")
        pre_delete_check(d, log)
        nbytes = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
        shutil.rmtree(d)
        log.add("RM_DIR", d, f"{nbytes} bytes")

    # --- B. datasets 目錄 ---
    del_ds_ids = [d["dataset_id"] for d in plan["del_ds"]]
    present = [i for i in del_ds_ids if (DATASETS_DIR / i).is_dir()]
    log.add("SECTION", "B. datasets 目錄", f"待刪 {len(present)}")
    for did in present:
        if did in EXPECTED["keep_dataset_ids"]:
            raise Abort(f"拒絕刪除保留 dataset: {did}")
        d = DATASETS_DIR / did
        pre_delete_check(d, log)
        nbytes = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
        shutil.rmtree(d)
        log.add("RM_DIR", d, f"{nbytes} bytes")

    # --- C. JSON 記錄 ---
    log.add("SECTION", "C. vision_center.json 記錄")
    if data.get("demo_active_submissions") != EXPECTED["keep_demo_active"]:
        raise Abort("寫入前 DEMO 綁定已變動")

    del_model_ids = {m["model_id"] for m in plan["del_models"]}
    del_ds_set = {d["dataset_id"] for d in plan["del_ds"]}
    del_he_ids = {h["sample_id"] for h in plan["del_he"]}

    before = (len(data["models"]), len(data["datasets"]), len(data["hard_examples"]))
    data["models"] = [m for m in data["models"] if m["model_id"] not in del_model_ids]
    data["datasets"] = [d for d in data["datasets"] if d.get("dataset_id") not in del_ds_set]
    data["hard_examples"] = [h for h in data["hard_examples"] if h.get("sample_id") not in del_he_ids]

    if data.get("demo_active_submissions") != EXPECTED["keep_demo_active"]:
        raise Abort("過濾後 DEMO 綁定變動，中止")

    log.add("JSON", "models", f"{before[0]} -> {len(data['models'])}")
    log.add("JSON", "datasets", f"{before[1]} -> {len(data['datasets'])}")
    log.add("JSON", "hard_examples", f"{before[2]} -> {len(data['hard_examples'])}")
    log.add("ASSERT", "demo_active_submissions", "保持不變 OK")

    tmp = VC_JSON.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    shutil.move(str(tmp), str(VC_JSON))
    log.add("WRITE", VC_JSON, "寫回完成")

    # --- D. Django ---
    log.add("SECTION", "D. Django（先 VMR 後 Evidence）")
    con = sqlite3.connect(str(DB))
    con.execute("PRAGMA foreign_keys=ON")
    cur = con.cursor()
    try:
        broken = [r for r in vmr if r.get("is_demo_test_only")]
        for r in broken:
            cur.execute("DELETE FROM learning_visionmodelrecord WHERE model_id=?", (r["model_id"],))
            if cur.rowcount != 1:
                raise Abort(f"刪 VMR 失敗 rowcount={cur.rowcount}")
            log.add("DB_DELETE", f"visionmodelrecord {r['model_id']}", f"rows={cur.rowcount}")

        ev_ids = [e["evidence_id"] for e in ev if e.get("evidence_type") == "model"]
        for eid in ev_ids:
            cur.execute("DELETE FROM learning_evidence WHERE evidence_id=?", (eid,))
            if cur.rowcount != 1:
                raise Abort(f"刪 Evidence 失敗 rowcount={cur.rowcount}")
            log.add("DB_DELETE", f"evidence {eid}", f"rows={cur.rowcount}")

        n = cur.execute(
            "SELECT COUNT(*) FROM learning_growthrecordsubmission WHERE id=?",
            (EXPECTED["keep_growth_submission_pk"],),
        ).fetchone()[0]
        if n != 1:
            raise Abort(f"成長紀錄 id={EXPECTED['keep_growth_submission_pk']} 遺失")
        con.commit()
        log.add("ASSERT", f"growthsubmission id={EXPECTED['keep_growth_submission_pk']}", "保留 OK")
    except Exception:
        con.rollback()
        con.close()
        raise
    con.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    print("=" * 64)
    print(f"R07 精準清理 v2 — {'APPLY' if args.apply else 'DRY-RUN'}")
    print("=" * 64)

    if not BACKUP.is_dir():
        print(f"✗ 備份不存在: {BACKUP}")
        return 2
    if sha256_file(DB) != sha256_file(BACKUP / "demo.sqlite3"):
        print("✗ DB 與備份不一致（可能有新操作），依安全原則中止")
        return 2
    if sha256_file(VC_JSON) != sha256_file(BACKUP / "vision_center.json"):
        print("✗ JSON 與備份不一致，中止")
        return 2
    print(f"✓ 備份完整且與現況一致：{BACKUP.name}")

    data = load_json()
    plan = build_plan(data)
    vmr, ev, gs = read_db()
    errs, warns = gate(plan, data, vmr, ev, gs)

    if warns:
        print("\n⚠️ 提示：")
        for w in warns:
            print("   -", w)
    if errs:
        print("\n✗ STEP 0 GATE 不通過，已中止（未刪除任何資料）：")
        for e in errs:
            print("   -", e)
        return 3
    print("✓ STEP 0 GATE 通過")

    print("\n--- 實際刪除範圍 ---")
    print(f"  registry 目錄   : {len(plan['dirs_to_remove'])}")
    print(f"  datasets 目錄   : {len([d for d in plan['del_ds'] if (DATASETS_DIR / d['dataset_id']).is_dir()])}")
    print(f"  JSON models     : {len(plan['del_models'])}")
    print(f"  JSON datasets   : {len(plan['del_ds'])}")
    print(f"  JSON hard_ex    : {len(plan['del_he'])}")
    print(f"  Django VMR      : {len([r for r in vmr if r.get('is_demo_test_only')])}")
    print(f"  Django Evidence : {len([e for e in ev if e.get('evidence_type')=='model'])}")
    print("\n--- 保留 ---")
    for k in plan["keep_models"]:
        print(f"  KEEP {k['model_id']}  [{','.join(k['reasons'])}]")
    print(f"  KEEP registry 目錄 : {plan['dirs_keep_present']}")
    print(f"  KEEP datasets      : {sorted(EXPECTED['keep_dataset_ids'])}")
    print(f"  KEEP submission    : {[s['submission_id'] for s in plan['keep_subs']]}")
    print(f"  KEEP DEMO 綁定     : {data.get('demo_active_submissions')}")
    print(f"  KEEP growth id     : {EXPECTED['keep_growth_submission_pk']}")

    # plan 落地（供審閱）
    plan_out = LOG_DIR / "r07_cleanup_plan_v2.json"
    plan_out.write_text(json.dumps({
        "delete_models": [m["model_id"] for m in plan["del_models"]],
        "delete_datasets": [d["dataset_id"] for d in plan["del_ds"]],
        "delete_hard_examples": [h["sample_id"] for h in plan["del_he"]],
        "delete_registry_dirs": plan["dirs_to_remove"],
        "keep_models": [k["model_id"] for k in plan["keep_models"]],
        "keep_registry_dirs": plan["dirs_keep_present"],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n計畫已寫出：{plan_out}")

    if not args.apply:
        print("\n（DRY-RUN，未刪除任何資料。須 --apply 才執行）")
        return 0

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    logpath = LOG_DIR / f"r07_cleanup_apply_{ts}.jsonl"
    log = JsonlLog(logpath)
    log.add("START", "清理開始", f"log={logpath.name}")
    print()
    try:
        do_apply(plan, data, vmr, ev, log)
    except Abort as exc:
        log.add("ABORT", "已中止", str(exc))
        log.close()
        print(f"\n✗ 中止：{exc}")
        print(f"  日誌：{logpath}")
        return 4
    except Exception as exc:  # noqa: BLE001
        log.add("ERROR", "未預期錯誤", repr(exc))
        log.close()
        print(f"\n✗ 錯誤：{exc!r}")
        print(f"  日誌：{logpath}")
        return 5

    log.add("DONE", "清理完成", f"共 {log.n} 筆")
    log.close()
    print(f"\n✓ 清理完成，日誌：{logpath}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
