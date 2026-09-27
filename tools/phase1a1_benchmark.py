from __future__ import annotations

import argparse
import json
import statistics
import tempfile
import time
from pathlib import Path

from PIL import Image, ImageOps
from ultralytics import YOLO


def parse_yolo_labels(path: Path, width: int, height: int, names: dict[int, str]) -> list[dict]:
    labels = []
    for line in path.read_text(encoding="utf-8").splitlines():
        class_id, cx, cy, bw, bh = line.split()[:5]
        cx, cy, bw, bh = map(float, (cx, cy, bw, bh))
        labels.append({
            "class": names[int(class_id)],
            "box": [(cx - bw / 2) * width, (cy - bh / 2) * height, (cx + bw / 2) * width, (cy + bh / 2) * height],
        })
    return labels


def iou(a, b) -> float:
    left, top = max(a[0], b[0]), max(a[1], b[1])
    right, bottom = min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0, right - left) * max(0, bottom - top)
    if not intersection:
        return 0.0
    area_a = max(0, a[2] - a[0]) * max(0, a[3] - a[1])
    area_b = max(0, b[2] - b[0]) * max(0, b[3] - b[1])
    return intersection / (area_a + area_b - intersection)


def detections(result) -> list[dict]:
    found = []
    for box in result.boxes:
        found.append({"class": result.names[int(box.cls[0])], "confidence": round(float(box.conf[0]), 3), "box": [float(v) for v in box.xyxy[0]]})
    return found


def encode_variant(source: Path, destination: Path, kind: str) -> float:
    started = time.perf_counter()
    with Image.open(source) as image:
        rgb = image.convert("RGB")
        contained = ImageOps.contain(rgb, (640, 480))
        canvas = Image.new("RGB", (640, 480), "black")
        canvas.paste(contained, ((640 - contained.width) // 2, (480 - contained.height) // 2))
        if kind == "jpeg":
            canvas.save(destination, "JPEG", quality=75)
        else:
            canvas.save(destination, "WEBP", quality=75)
    return round((time.perf_counter() - started) * 1000, 1)


def run(model_path: Path, dataset: Path) -> dict:
    model = YOLO(str(model_path))
    names = dict(model.names)
    records = []
    counts = {"cw_propeller": 0, "ccw_propeller": 0}
    image_paths = sorted((dataset / "images" / "val").glob("*")) + sorted((dataset / "images" / "train").glob("*"))
    for image_path in image_paths:
        label_path = dataset / "labels" / image_path.parent.name / f"{image_path.stem}.txt"
        if not label_path.exists():
            continue
        with Image.open(image_path) as image:
            truth = parse_yolo_labels(label_path, image.width, image.height, names)
        result = model.predict(source=str(image_path), conf=0.25, verbose=False)[0]
        predicted = detections(result)
        used = set()
        for expected in truth:
            class_name = expected["class"]
            if class_name not in counts or counts[class_name] >= 10:
                continue
            candidates = [(iou(expected["box"], item["box"]), index, item) for index, item in enumerate(predicted) if index not in used]
            overlap, index, best = max(candidates, default=(0.0, -1, {"class": None, "confidence": None}), key=lambda item: item[0])
            if index >= 0:
                used.add(index)
            correct = overlap >= 0.5 and best["class"] == class_name
            records.append({"image": image_path.name, "ground_truth": class_name, "prediction": best["class"], "confidence": best["confidence"], "iou": round(overlap, 3), "correct": correct})
            counts[class_name] += 1
        if all(value >= 10 for value in counts.values()):
            break

    representative = image_paths[0]
    formats = []
    with tempfile.TemporaryDirectory() as directory:
        variants = [("original", representative, 0.0)]
        for kind, suffix in (("jpeg_640x480_q75", ".jpg"), ("webp_640x480_q75", ".webp")):
            path = Path(directory) / f"variant{suffix}"
            encode_ms = encode_variant(representative, path, "jpeg" if suffix == ".jpg" else "webp")
            variants.append((kind, path, encode_ms))
        for kind, path, encode_ms in variants:
            started = time.perf_counter()
            result = model.predict(source=str(path), conf=0.25, verbose=False)[0]
            round_trip = (time.perf_counter() - started) * 1000
            formats.append({"variant": kind, "bytes": path.stat().st_size, "encode_ms": encode_ms, "model_inference_ms": round(float(result.speed.get("inference", 0)), 1), "local_predict_total_ms": round(round_trip, 1), "detections": detections(result)})

    return {
        "model_path": str(model_path),
        "model_names": names,
        "sample_source": "YOLO training/validation labels; not an independent field test set",
        "cw_ccw_records": records,
        "cw_ccw_summary": {name: {"tested": sum(r["ground_truth"] == name for r in records), "correct": sum(r["ground_truth"] == name and r["correct"] for r in records)} for name in counts},
        "format_comparison": formats,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    payload = run(args.model, args.dataset)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "summary": payload["cw_ccw_summary"], "formats": payload["format_comparison"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

