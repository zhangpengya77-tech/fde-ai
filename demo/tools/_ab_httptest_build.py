import os, sys, hashlib, shutil
from pathlib import Path
LIVE = r"D:\FDE-AI-UAS-v2.0\live_backend"
sys.path.insert(0, LIVE)
from app.vision_center import VisionCenter, HEALTH_OK, HEALTH_LOW_QUALITY, PROP_CLASSES
FOUR = list(PROP_CLASSES)
BASE = Path(r"D:\FDE-AI-UAS-v2.0\demo\runtime\_ab_httptest")
ROOT = BASE / "store"
MODELS = BASE / "models"
for p in (ROOT, MODELS):
    if p.exists():
        shutil.rmtree(p)
ROOT.mkdir(parents=True)
c = VisionCenter(
    root=ROOT,
    model_health_inspector=lambda path: {"health": HEALTH_OK, "map50": 0.72, "nc": 4, "names_count": 4, "class_names": FOUR},
    model_runner=None, model_validator=None, demo_simulation_enabled=False,
)
c.create_dataset({"model_type": "PROP_DIRECTION", "dataset_version": "dv1", "created_by": "t1", "notes": "httptest"})

def add_model(model_id, content, health, validation_status="VALIDATED", status="VALIDATED", class_names=FOUR, map50=0.72):
    path = MODELS / model_id / "best.pt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    rec = {
        "model_id": model_id, "model_type": "PROP_DIRECTION", "model_name": model_id, "version": "v1",
        "file_path": str(path), "file_hash": hashlib.sha256(content).hexdigest(), "file_size": len(content),
        "class_names": list(class_names), "class_count": len(class_names),
        "health": health, "health_map50": map50, "health_nc": len(class_names), "health_names_count": len(class_names),
        "validation_status": validation_status, "status": status,
        "uploaded_by": "t1", "uploaded_at": "2026-10-23T00:00:00Z",
        "is_seed": False, "source_submission_id": None,
    }
    c.store.data["models"].append(rec)
    c.store.save()
    return rec

def remember(model_id, conf, decision="MATCH"):
    c.store.data.setdefault("validations", [])
    c.store.data["validations"] = [r for r in c.store.data["validations"] if r.get("model_id") != model_id]
    c._remember_validation(model_id=model_id, model_type="PROP_DIRECTION", decision=decision,
                           max_confidence=conf, expected_class=None, confidence_threshold=0.5,
                           validated_by="t1", reason_code="OK" if decision == "MATCH" else "NO_DETECTION")

add_model("good", b"FAKE_PT_PROP_GOOD", HEALTH_OK); remember("good", 0.65)
add_model("badh", b"FAKE_PT_LOWQ", HEALTH_LOW_QUALITY, map50=0.3); remember("badh", 0.9)
print("built store at", ROOT)
print("models:", [m["model_id"] for m in c.store.data["models"]])
print("good file:", (MODELS / "good" / "best.pt").exists(), "| badh file:", (MODELS / "badh" / "best.pt").exists())
