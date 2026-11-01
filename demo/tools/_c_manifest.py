import json, hashlib, os, sys
from pathlib import Path

TS = sys.argv[1] if len(sys.argv) > 1 else "manual"
ROOT = Path(r"D:\FDE-AI-UAS-v2.0\demo\runtime\vision-center")
STORE = ROOT / "vision_center.json"
LOGS = Path(r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs")

def sha256_file(p):
    p = Path(p)
    if not p.exists():
        return None
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

store_bytes = STORE.read_bytes()
store_sha = hashlib.sha256(store_bytes).hexdigest()
d = json.loads(store_bytes.decode("utf-8"))

manifest = {
    "operation": "C_CLEAR_demo_vision_data",
    "timestamp": TS,
    "store_path": str(STORE),
    "store_sha256_before": store_sha,
    "store_bytes_before": len(store_bytes),
    "models": [],
    "submissions": [],
    "model_registry_pt_folders": [],
    "safety_scan": {},
}

# models
for m in d.get("models", []):
    fp = m.get("file_path", "")
    manifest["models"].append({
        "model_id": m.get("model_id"),
        "status": m.get("status"),
        "validation_status": m.get("validation_status"),
        "health": m.get("health"),
        "is_seed": m.get("is_seed"),
        "class_names": m.get("class_names"),
        "file_hash": m.get("file_hash"),
        "source_submission_id": m.get("source_submission_id"),
        "file_path": fp,
        "file_exists": os.path.exists(fp),
        "file_sha256": sha256_file(fp),
    })

# submissions
for s in d.get("submissions", []):
    fp = s.get("file_path", "")
    manifest["submissions"].append({
        "submission_id": s.get("submission_id"),
        "status": s.get("status"),
        "student_id": s.get("student_id"),
        "file_hash": s.get("file_hash"),
        "file_path": fp,
        "file_exists": os.path.exists(fp),
        "file_sha256": sha256_file(fp),
    })

# model_registry .pt folders (tracked vs orphan)
tracked_paths = {m.get("file_path") for m in d.get("models", [])}
reg = ROOT / "model_registry"
for task_dir in sorted(reg.iterdir()):
    if not task_dir.is_dir():
        continue
    for folder in sorted(task_dir.iterdir()):
        if not folder.is_dir():
            continue
        pt = folder / "best.pt"
        manifest["model_registry_pt_folders"].append({
            "task": task_dir.name,
            "folder": folder.name,
            "folder_path": str(folder),
            "best_pt_path": str(pt),
            "best_pt_exists": pt.exists(),
            "best_pt_sha256": sha256_file(pt),
            "tracked_by_store": (str(pt) in tracked_paths),
        })

# safety scan: any preserved collection referencing model_registry or .pt?
def scan(collection):
    hits = []
    for item in d.get(collection, []):
        blob = json.dumps(item, ensure_ascii=False)
        if "model_registry" in blob or ".pt" in blob:
            hits.append(item.get(list(item.keys())[0]) if item else item)
    return hits

for coll in ["datasets", "golden_sets", "evaluations", "hard_examples", "camera_profiles"]:
    manifest["safety_scan"][coll] = {
        "count": len(d.get(coll, [])),
        "refs_model_registry_or_pt": scan(coll),
    }

# summary counts
manifest["summary"] = {
    "models_count": len(manifest["models"]),
    "submissions_count": len(manifest["submissions"]),
    "model_registry_folders_total": len(manifest["model_registry_pt_folders"]),
    "model_registry_folders_tracked": sum(1 for x in manifest["model_registry_pt_folders"] if x["tracked_by_store"]),
    "model_registry_folders_orphan": sum(1 for x in manifest["model_registry_pt_folders"] if not x["tracked_by_store"]),
    "preserved": {k: len(d.get(k, [])) for k in ["datasets", "hard_examples", "golden_sets", "camera_profiles", "evaluations"]},
    "demo_active_submissions": d.get("demo_active_submissions", {}),
}

LOGS.mkdir(parents=True, exist_ok=True)
out = LOGS / f"C_CLEAR_{TS}_manifest.json"
out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

print("MANIFEST WRITTEN:", out)
print("STORE SHA256 BEFORE:", store_sha)
print("TIMESTAMP:", TS)
print("-" * 60)
print("models:", manifest["summary"]["models_count"],
      "| submissions:", manifest["summary"]["submissions_count"])
print("model_registry folders: total", manifest["summary"]["model_registry_folders_total"],
      "| tracked", manifest["summary"]["model_registry_folders_tracked"],
      "| orphan", manifest["summary"]["model_registry_folders_orphan"])
print("preserved:", manifest["summary"]["preserved"])
print("demo_active_submissions:", manifest["summary"]["demo_active_submissions"])
print("-" * 60)
print("SAFETY SCAN (refs to model_registry/.pt in preserved collections):")
for coll, info in manifest["safety_scan"].items():
    flag = "CLEAN" if not info["refs_model_registry_or_pt"] else f"!!! {len(info['refs_model_registry_or_pt'])} REFS !!!"
    print(f"  {coll}: count={info['count']} -> {flag}")
    for ref in info["refs_model_registry_or_pt"]:
        print("     REF:", ref)
