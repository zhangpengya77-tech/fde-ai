"""只讀探測：PROP_DIRECTION 真實模型是否訓練過、真實類別、真實推論輸出。

不修改任何資料；只讀 .pt 並推論。
禁止使用 fake_model.pt。
"""

from __future__ import annotations

import json
import os
import sys

PROJECT_ROOT = r"D:\FDE-AI-UAS-v2.0"
REGISTRY = os.path.join(PROJECT_ROOT, "demo", "runtime", "vision-center", "vision_center.json")
MODEL_DIR = os.path.join(PROJECT_ROOT, "demo", "runtime", "vision-center", "model_registry", "prop_direction")
IMAGES = [
    os.path.join(PROJECT_ROOT, "ops", "launch-20261028", "test-images", "prop_real_01.jpg"),
    os.path.join(PROJECT_ROOT, "ops", "launch-20261028", "test-images", "prop_real_02.jpg"),
]


def main() -> int:
    from ultralytics import YOLO

    reg = json.load(open(REGISTRY, encoding="utf-8"))
    models = [m for m in reg.get("models", []) if m.get("model_type") == "PROP_DIRECTION"]
    out = {"registry_models": [], "inference": []}

    for m in models:
        mid = m.get("model_id")
        pt = os.path.join(MODEL_DIR, mid, "best.pt")
        entry = {
            "model_id": mid,
            "version": m.get("version"),
            "status": m.get("status"),
            "registry_class_names": m.get("class_names"),
            "nc": m.get("nc"),
            "pt_exists": os.path.exists(pt),
            "pt_bytes": os.path.getsize(pt) if os.path.exists(pt) else None,
        }
        if os.path.exists(pt):
            try:
                y = YOLO(pt)
                names = y.model.names if hasattr(y.model, "names") else {}
                names = names if isinstance(names, dict) else dict(enumerate(names))
                entry["loaded_class_names"] = names
                entry["loaded_nc"] = len(names)
                ta = getattr(y.model, "train_args", None) or {}
                entry["train_args"] = {k: ta.get(k) for k in ("epochs", "batch", "imgsz", "data", "model")} if isinstance(ta, dict) else str(ta)
                ck = getattr(y, "ckpt", None) or {}
                entry["ckpt_train_metrics"] = {
                    k: ck.get(k) for k in ("train_results", "epoch", "best_fitness", "date")
                } if isinstance(ck, dict) else None
                # 真實推論
                for img in IMAGES:
                    if not os.path.exists(img):
                        continue
                    r = y.predict(source=img, conf=0.001, verbose=False)[0]
                    dets = []
                    for b in r.boxes:
                        cls = int(b.cls.item())
                        dets.append({
                            "class_index": cls,
                            "class_name": names.get(cls),
                            "confidence": round(float(b.conf.item()), 6),
                        })
                    out["inference"].append({
                        "model_id": mid,
                        "image": os.path.basename(img),
                        "detection_count": len(dets),
                        "detections": dets,
                    })
            except Exception as exc:  # noqa: BLE001
                entry["load_error"] = f"{type(exc).__name__}: {exc}"
        out["registry_models"].append(entry)

    json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
