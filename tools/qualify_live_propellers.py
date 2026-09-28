from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


CLASSES = ("cw_propeller", "ccw_propeller")
PREDICTION_COLUMNS = ("cw_propeller", "ccw_propeller", "other", "not_detected")


def _round_ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def _classify(record: dict, threshold: float) -> dict:
    detections = list(record.get("detections") or [])
    eligible = [item for item in detections if float(item.get("confidence", 0)) >= threshold]
    propellers = [item for item in eligible if item.get("class") in CLASSES]
    selected = max(propellers, key=lambda item: float(item["confidence"]), default=None)
    ground_truth = record["ground_truth"]
    if selected:
        prediction = selected["class"]
        error = "CORRECT" if prediction == ground_truth else ("CW_TO_CCW" if ground_truth == "cw_propeller" else "CCW_TO_CW")
    elif eligible:
        selected = max(eligible, key=lambda item: float(item["confidence"]))
        prediction = "other"
        error = "PROPELLER_TO_OTHER"
    else:
        prediction = "not_detected"
        error = "LOW_CONFIDENCE" if detections else "NO_DETECTION"
    return {
        **{key: value for key, value in record.items() if key != "detections"},
        "predicted_class": None if prediction == "not_detected" else prediction,
        "confidence": None if selected is None else round(float(selected["confidence"]), 4),
        "box": None if selected is None else selected.get("box"),
        "detected": prediction != "not_detected",
        "correct": prediction == ground_truth,
        "error_category": error,
        "_prediction_bucket": prediction,
    }


def evaluate_records(records: list[dict], threshold: float) -> dict:
    evaluated = [_classify(record, threshold) for record in records]
    matrix = {truth: {prediction: 0 for prediction in PREDICTION_COLUMNS} for truth in CLASSES}
    for row in evaluated:
        matrix[row["ground_truth"]][row["_prediction_bucket"]] += 1

    metrics = {}
    for name, short in (("cw_propeller", "cw"), ("ccw_propeller", "ccw")):
        tp = matrix[name][name]
        actual = sum(matrix[name].values())
        predicted = sum(matrix[truth][name] for truth in CLASSES)
        metrics[short] = {"precision": _round_ratio(tp, predicted), "recall": _round_ratio(tp, actual), "tested": actual}

    total = len(evaluated)
    correct = sum(row["correct"] for row in evaluated)
    mutual_errors = matrix["cw_propeller"]["ccw_propeller"] + matrix["ccw_propeller"]["cw_propeller"]
    qualified = (
        metrics["cw"]["tested"] >= 30
        and metrics["ccw"]["tested"] >= 30
        and metrics["cw"]["recall"] >= 0.85
        and metrics["ccw"]["recall"] >= 0.85
        and _round_ratio(mutual_errors, total) <= 0.10
    )
    clean_records = [{key: value for key, value in row.items() if not key.startswith("_")} for row in evaluated]
    return {
        "threshold": threshold,
        **metrics,
        "overall_accuracy": _round_ratio(correct, total),
        "mutual_misclassification_rate": _round_ratio(mutual_errors, total),
        "confusion_matrix": matrix,
        "error_categories": {category: sum(row["error_category"] == category for row in evaluated) for category in ("CW_TO_CCW", "CCW_TO_CW", "PROPELLER_TO_OTHER", "NO_DETECTION", "LOW_CONFIDENCE")},
        "qualification": "MODEL_QUALIFIED" if qualified else "MODEL_NOT_QUALIFIED",
        "records": clean_records,
    }


def load_manifest(manifest: Path, model_path: Path) -> tuple[list[dict], list[str]]:
    from ultralytics import YOLO

    rows = list(csv.DictReader(manifest.open(encoding="utf-8-sig", newline="")))
    valid, errors = [], []
    existing = []
    for row in rows:
        image_path = (manifest.parent / row.get("relative_path", "")).resolve()
        if row.get("ground_truth") not in CLASSES:
            errors.append(f"{row.get('image_id')}: invalid ground_truth")
        elif not image_path.is_file():
            errors.append(f"{row.get('image_id')}: missing image")
        else:
            existing.append((row, image_path))
    if not existing:
        return [], errors
    model = YOLO(str(model_path))
    for row, image_path in existing:
        result = model.predict(source=str(image_path), conf=0.01, verbose=False)[0]
        detections = []
        for box in result.boxes:
            detections.append({"class": result.names[int(box.cls[0])], "confidence": float(box.conf[0]), "box": [round(float(value), 1) for value in box.xyxy[0]]})
        valid.append({**row, "detections": detections})
    return valid, errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Qualify independent CW/CCW live propeller images")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    records, errors = load_manifest(args.manifest, args.model)
    thresholds = {f"{value:.2f}": evaluate_records(records, value) for value in (0.50, 0.60, 0.70, 0.80)}
    status = "MODEL_QUALIFIED" if any(result["qualification"] == "MODEL_QUALIFIED" for result in thresholds.values()) else "MODEL_NOT_QUALIFIED"
    payload = {"status": status, "independent_test_set_size": len(records), "manifest_errors": errors, "thresholds": thresholds}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": status, "count": len(records), "errors": len(errors)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

