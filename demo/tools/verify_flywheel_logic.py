"""推理無關的快速驗證：直接對 VisionCenter 的新邏輯做單元斷言。

不載入任何 .pt、不執行真實推論；以直接建構 store 紀錄（含一顆假的 best.pt 檔）
來測試 A（啟用硬規則）與 B（數據飛輪種子）的判定正確。
用來確認 2026-10-23 教師指令的邏輯無回歸。
"""
import os
import sys
import json
import hashlib
import tempfile
import shutil
from pathlib import Path

LIVE = os.path.join(os.path.dirname(__file__), "..", "..", "live_backend")
sys.path.insert(0, LIVE)

from app.vision_center import (
    VisionCenter, HEALTH_OK, HEALTH_LOW_QUALITY, PROP_CLASSES,
)

FOUR = list(PROP_CLASSES)
TMP = Path(tempfile.mkdtemp(prefix="vc-verify-"))


def make_center():
    c = VisionCenter(
        root=TMP / "store",
        model_health_inspector=lambda path: {
            "health": HEALTH_OK, "map50": 0.72, "nc": 4, "names_count": 4,
            "has_train_args": True, "has_epoch": True, "has_metrics": True,
            "class_names": FOUR,
        },
        model_runner=None,
        model_validator=None,
        demo_simulation_enabled=False,
    )
    ds = c.create_dataset({
        "model_type": "PROP_DIRECTION", "dataset_version": "dv1",
        "created_by": "t1", "notes": "verify",
    })
    c._ds_id = ds["dataset_id"]
    return c


def sha(content):
    return hashlib.sha256(content).hexdigest()


def add_model(c, *, model_id, content=b"FAKE_PT_CONTENT", health=HEALTH_OK, map50=0.72,
              class_names=FOUR, validation_status="VALIDATING", status="VALIDATING",
              is_seed=False, seed_generation=None, seed_parent_model_id=None,
              source_submission_id=None, file_hash=None):
    path = TMP / "models" / model_id / "best.pt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    fh = file_hash or sha(content)
    rec = {
        "model_id": model_id, "model_type": "PROP_DIRECTION",
        "model_name": model_id, "version": "v1",
        "file_path": str(path), "file_hash": fh, "file_size": len(content),
        "class_names": list(class_names), "class_count": len(class_names),
        "health": health, "health_map50": map50, "health_nc": len(class_names),
        "health_names_count": len(class_names),
        "validation_status": validation_status, "status": status,
        "uploaded_by": "t1", "uploaded_at": "2026-10-23T00:00:00Z",
        "is_seed": bool(is_seed), "source_submission_id": source_submission_id,
    }
    if seed_generation is not None:
        rec["seed_generation"] = seed_generation
    if seed_parent_model_id is not None:
        rec["seed_parent_model_id"] = seed_parent_model_id
    c.store.data["models"].append(rec)
    c.store.save()
    return rec


def remember(c, model_id, conf, decision="MATCH"):
    """直接寫一筆真實圖片驗證紀錄（與 validate_image_with_model 的持久化一致）。
    先清掉該模型舊紀錄，確保「最高信心」恰為本次設定的值（斷言具確定性）。"""
    c.store.data.setdefault("validations", [])
    c.store.data["validations"] = [
        r for r in c.store.data["validations"] if r.get("model_id") != model_id
    ]
    c._remember_validation(
        model_id=model_id, model_type="PROP_DIRECTION", decision=decision,
        max_confidence=conf, expected_class=None, confidence_threshold=0.5,
        validated_by="t1", reason_code="OK" if decision == "MATCH" else "NO_DETECTION",
    )


results = []
def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS" if cond else "FAIL"), name)


c = make_center()

# ---------- A. 啟用硬規則 ----------
good = add_model(c, model_id="good", content=b"FAKE_PT_PROP_GOOD")
remember(c, "good", 0.65)
elig, reason, detail = c._activation_eligibility(c.get_model("good"))
check("A-合格模型可啟用(0.65>=0.6)", elig is True and reason == "")

# 2. 0.59 < 0.6 → 不可啟用
remember(c, "good", 0.59)
elig, reason, detail = c._activation_eligibility(c.get_model("good"))
check("A-0.59不可啟用(confidence_too_low)", elig is False and reason == "model_validation_confidence_too_low")
remember(c, "good", 0.65)

# 3. health != OK
bad = add_model(c, model_id="badh", health=HEALTH_LOW_QUALITY, map50=0.3, content=b"FAKE_PT_LOWQ")
remember(c, "badh", 0.9)
elig, reason, detail = c._activation_eligibility(c.get_model("badh"))
check("A-health非OK不可啟用", elig is False and reason == "model_health_not_ok")

# 4. 類別名不符四類
badc = add_model(c, model_id="badc", class_names=["A", "B", "C", "D", "E", "F"], content=b"FAKE_PT_CLS")
remember(c, "badc", 0.9)
elig, reason, detail = c._activation_eligibility(c.get_model("badc"))
check("A-類別名不符四類不可啟用", elig is False and reason == "model_class_names_invalid")

# 5. DEMO_IMPORTED
badd = add_model(c, model_id="badd", validation_status="DEMO_IMPORTED", status="DEMO_IMPORTED", content=b"FAKE_PT_DEMO")
remember(c, "badd", 0.9)
elig, reason, detail = c._activation_eligibility(c.get_model("badd"))
check("A-DEMO_IMPORTED不可啟用", elig is False and reason == "model_demo_imported_not_allowed")

# 6. 無驗證紀錄
nov = add_model(c, model_id="nov", content=b"FAKE_PT_NOVER")
elig, reason, detail = c._activation_eligibility(c.get_model("nov"))
check("A-無驗證紀錄不可啟用", elig is False and reason == "model_validation_required")

# 7. override 被拒絕
try:
    c.activate_model("good", "t1", override=True)
    check("A-override被拒(teacher_override_disabled)", False)
except ValueError as e:
    check("A-override被拒(teacher_override_disabled)", "teacher_override_disabled" in str(e))

# 8. 合格模型可啟用（硬規則）
try:
    r = c.activate_model("good", "t1")
    check("A-合格模型activate成功(ACTIVE)", r.get("status") == "ACTIVE")
except ValueError as e:
    check("A-合格模型activate成功(ACTIVE)", False)
    print("  activate failed:", e)

# ---------- B. 數據飛輪（種子） ----------
# 9. 合格模型入庫為種子 → 成為推薦
seed = c.seed_model("good", "t1")
check("B-種子入庫成功", seed.get("is_seed") is True)
check("B-入庫後成為推薦", c.recommended_seed_model_id("PROP_DIRECTION") == "good")
check("B-seed_generation=1", seed.get("seed_generation") == 1)
check("B-版本鏈含1筆", len(c.seed_version_chain("PROP_DIRECTION")) == 1)

# 10. 種子不可永久刪除（用一顆 VALIDATED 的種子，避免 ACTIVE/VALIDATING 守衛干擾）
seedm = add_model(c, model_id="seedm", status="VALIDATED", validation_status="VALIDATED", content=b"FAKE_PT_SEED")
remember(c, "seedm", 0.65)
c.seed_model("seedm", "t1")
try:
    c.delete_model("seedm", "t1", "x")
    check("B-種子不可永久刪除", False)
except Exception as e:
    check("B-種子不可永久刪除", "model_is_seed_cannot_delete" in str(e))

# 11. 取消種子 → 可刪除 + 推薦清空
un = c.unseed_model("seedm", "t1")
check("B-取消種子成功", un.get("is_seed") is False)
check("B-取消後推薦清空", c.recommended_seed_model_id("PROP_DIRECTION") == "good")
d = c.delete_model("seedm", "t1", "x")
check("B-取消後可永久刪除", d.get("model_id") == "seedm")

# 12. 父模型版本鏈：新模型以種子(good)為 parent，且指標更高無警告
s2 = add_model(c, model_id="s2", status="VALIDATED", validation_status="VALIDATED", content=b"FAKE_PT_PROP2")
remember(c, "s2", 0.7)
seed2 = c.seed_model("s2", "t1", parent_model_id="good", recommended=True)
chain = c.seed_version_chain("PROP_DIRECTION")
check("B-版本鏈含2筆", len(chain) == 2)
check("B-版本鏈s2.parent=good", any(it["model_id"] == "s2" and it["parent_model_id"] == "good" for it in chain))
cmp = seed2.get("seed_comparison", {})
check("B-版本鏈對比(0.7>0.65無警告)", cmp.get("warning") == "")

# 13. 下載種子寫審計 + 回傳 base64（good 是種子）
dl = c.download_seed_model(model_id="good", downloaded_by="studentX")
check("B-下載種子回傳base64", isinstance(dl.get("file_base64"), str) and len(dl["file_base64"]) > 0)
audit_path = TMP / "store" / "audit" / "model_management_audit.jsonl"
audit_lines = audit_path.read_text(encoding="utf-8").splitlines() if audit_path.exists() else []
check("B-下載寫入審計(seed_downloaded)", any("seed_downloaded" in line for line in audit_lines))

# 14. 下載非種子被拒
plain = add_model(c, model_id="plain", status="VALIDATED", validation_status="VALIDATED", content=b"FAKE_PT_PLAIN")
remember(c, "plain", 0.65)
try:
    c.download_seed_model(model_id="plain")
    check("B-下載非種子被拒", False)
except Exception:
    check("B-下載非種子被拒", True)

print("\n==== 總結 ====")
passed = sum(1 for _, ok in results if ok)
print(f"{passed}/{len(results)} 通過")
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(0 if passed == len(results) else 1)
