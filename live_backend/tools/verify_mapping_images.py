"""映射版模型圖片驗收工具（嚴格唯讀）。

用途：拿一批「已知正確類別」的圖片，比較同一次推論的
  - 原始 6 類輸出（模型原樣）
  - 映射後 4 類輸出（套用登記的筆誤映射 + 同框去重）
並輸出逐張對照 CSV、映射前後混淆矩陣、整體正確率。

輸入目錄結構：
    <images>/
        CW_F/*.jpg
        CCW_F/*.jpg
        CW_B/*.jpg
        CCW_B/*.jpg

用法：
    python verify_mapping_images.py --images DIR [--out DIR] [--conf 0.5]
                                    [--model PATH] [--submission SUB_ID]
                                    [--mapping-file PATH] [--runner real|stub]
                                    [--label SYNTHETIC]

安全邊界（重要）：
    - 只讀取 .pt 與設定檔，直接呼叫 UltralyticsModelRunner。
    - 不建立 VisionCenter、不寫 store、不匯入、不啟用、不改任何模型狀態。
    - 輸出檔只寫到 --out 指定目錄（預設 .test-temp/verify-mapping-images/<時間>）。
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "live_backend"))

from app import vision_center as vc  # noqa: E402

DEFAULT_SUBMISSION = "sub-5d87f027-80b2-4990-95d7-30ebb278b002"
DEFAULT_MODEL = (
    PROJECT / "demo" / "runtime" / "vision-center" / "submissions" / "prop_direction"
    / DEFAULT_SUBMISSION / "submission.pt"
)
EXPECTED_CLASSES = list(vc.PROP_CLASSES)  # CW_F, CCW_F, CW_B, CCW_B
NO_DETECTION = "NONE"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


class StubRunner:
    """自測用假 runner：依檔名雜湊產生可重現的 6 類偵測，不載入 .pt。

    會刻意讓部分圖片同時命中「同框的 CCE-F 與 CCW-F」，用來驗證去重是否生效。
    """

    RAW_CLASSES = ["CCE-F", "CCF-b", "CCW-F", "CCW-B", "CW-F", "CW-B"]

    def predict(self, _path, image_bytes):
        seed = int(hashlib.md5(image_bytes).hexdigest()[:8], 16)
        first = self.RAW_CLASSES[seed % len(self.RAW_CLASSES)]
        confidence = round(0.50 + (seed % 45) / 100, 4)
        detections = [
            {"class": first, "confidence": confidence, "bbox": [10, 10, 110, 110],
             "center_x": 60, "center_y": 60},
        ]
        if seed % 3 == 0:
            twin = "CCW-F" if first == "CCE-F" else "CCE-F"
            detections.append({
                "class": twin, "confidence": round(confidence - 0.05, 4),
                "bbox": [11, 11, 110, 110], "center_x": 60.5, "center_y": 60.5,
            })
        return detections

    def get_names(self, _path):
        return list(self.RAW_CLASSES)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect(images_dir: Path) -> tuple[list[tuple[str, Path]], list[str]]:
    items: list[tuple[str, Path]] = []
    skipped: list[str] = []
    for folder in sorted(p for p in images_dir.iterdir() if p.is_dir()):
        label = folder.name
        if label not in EXPECTED_CLASSES:
            skipped.append(folder.name)
            continue
        for file in sorted(folder.iterdir()):
            if file.is_file() and file.suffix.lower() in IMAGE_SUFFIXES:
                items.append((label, file))
    return items, skipped


def top1(detections: list[dict]) -> tuple[str, float | None]:
    if not detections:
        return NO_DETECTION, None
    best = max(detections, key=lambda item: float(item.get("confidence") or 0))
    return str(best.get("class")), round(float(best.get("confidence") or 0), 6)


def write_confusion(path: Path, rows: list[dict], columns: list[str]) -> None:
    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["true\\pred", *columns, "total"])
        for row in rows:
            writer.writerow([row["true"], *[row["cells"].get(col, 0) for col in columns], row["total"]])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="映射版模型圖片驗收（唯讀）")
    parser.add_argument("--images", required=True, help="圖片根目錄，子資料夾名＝正確類別")
    parser.add_argument("--out", default="", help="輸出目錄（預設 .test-temp/verify-mapping-images/<時間>）")
    parser.add_argument("--conf", type=float, default=0.5, help="信心門檻，僅記錄用（不影響推論）")
    parser.add_argument("--model", default="", help=".pt 路徑（預設取已登記提交的 submission.pt）")
    parser.add_argument("--submission", default=DEFAULT_SUBMISSION, help="用於解析映射的提交編號")
    parser.add_argument("--mapping-file", default="", help="自訂映射設定檔（預設 vision_class_mappings.json）")
    parser.add_argument("--runner", choices=("real", "stub"), default="real",
                        help="real=載入 .pt 真實推論；stub=假 runner（僅自測工具管線）")
    parser.add_argument("--label", default="", help="標記資料性質，例如 SYNTHETIC")
    args = parser.parse_args(argv)

    images_dir = Path(args.images)
    if not images_dir.exists():
        print(f"ERROR: images dir not found: {images_dir}")
        return 2

    model_path = Path(args.model) if args.model else DEFAULT_MODEL
    if args.runner == "real" and not model_path.exists():
        print(f"ERROR: model file not found: {model_path}")
        return 2

    if args.mapping_file:
        import os
        os.environ["FDE_VISION_CLASS_MAPPINGS"] = args.mapping_file
    registered = vc.registered_class_mapping(args.submission)
    if registered is None:
        print(f"ERROR: submission {args.submission} has no registered mapping in "
              f"{vc.vision_class_mappings_path()}")
        return 2
    mapping = registered["mapping"]

    items, skipped = collect(images_dir)
    if not items:
        print(f"ERROR: no images under {images_dir} (expected subfolders {EXPECTED_CLASSES})")
        return 2

    out_dir = Path(args.out) if args.out else (
        PROJECT / ".test-temp" / "verify-mapping-images" / datetime.now().strftime("%Y%m%d-%H%M%S")
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    runner = StubRunner() if args.runner == "stub" else vc.UltralyticsModelRunner()

    raw_columns = list(StubRunner.RAW_CLASSES) + [NO_DETECTION]
    mapped_columns = list(EXPECTED_CLASSES) + [NO_DETECTION]
    raw_matrix = {label: {col: 0 for col in raw_columns} for label in EXPECTED_CLASSES}
    mapped_matrix = {label: {col: 0 for col in mapped_columns} for label in EXPECTED_CLASSES}

    rows: list[dict] = []
    correct_before = correct_after = 0

    print("READ_ONLY: 不匯入、不啟用、不改模型狀態")
    print(f"images={images_dir}  model={model_path if args.runner == 'real' else '(stub)'}  "
          f"runner={args.runner}  mapping={mapping}")
    if skipped:
        print(f"WARN: 忽略非類別資料夾：{skipped}")

    for label, file in items:
        image_bytes = file.read_bytes()
        try:
            detections = runner.predict(model_path, image_bytes)
        except Exception as exc:  # noqa: BLE001
            rows.append({
                "image": str(file.relative_to(images_dir)), "true_class": label,
                "error": f"{type(exc).__name__}: {exc}",
            })
            print(f"  ERROR {file.name}: {exc}")
            continue

        mapped_detections, deduped = vc.apply_mapping_to_detections(detections, mapping)
        raw_top, raw_conf = top1(detections)
        mapped_top, mapped_conf = top1(mapped_detections)
        hit_before = raw_top == label
        hit_after = mapped_top == label
        correct_before += int(hit_before)
        correct_after += int(hit_after)
        raw_matrix[label][raw_top if raw_top in raw_columns else NO_DETECTION] += 1
        mapped_matrix[label][mapped_top if mapped_top in mapped_columns else NO_DETECTION] += 1

        rows.append({
            "image": str(file.relative_to(images_dir)),
            "true_class": label,
            "raw_top1": raw_top,
            "raw_confidence": raw_conf if raw_conf is not None else "",
            "raw_detection_count": len(detections),
            "raw_all": "; ".join(f"{d['class']}:{round(float(d.get('confidence') or 0), 4)}" for d in detections),
            "mapped_top1": mapped_top,
            "mapped_confidence": mapped_conf if mapped_conf is not None else "",
            "mapped_detection_count": len(mapped_detections),
            "deduped_count": deduped,
            "mapped_all": "; ".join(
                f"{d['class']}({d.get('class_raw')}):{round(float(d.get('confidence') or 0), 4)}"
                for d in mapped_detections
            ),
            "correct_before": int(hit_before),
            "correct_after": int(hit_after),
        })

    per_image = out_dir / "per_image.csv"
    fieldnames = [
        "image", "true_class", "raw_top1", "raw_confidence", "raw_detection_count", "raw_all",
        "mapped_top1", "mapped_confidence", "mapped_detection_count", "deduped_count", "mapped_all",
        "correct_before", "correct_after", "error",
    ]
    with open(per_image, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    raw_rows = [
        {"true": label, "cells": raw_matrix[label], "total": sum(raw_matrix[label].values())}
        for label in EXPECTED_CLASSES
    ]
    mapped_rows = [
        {"true": label, "cells": mapped_matrix[label], "total": sum(mapped_matrix[label].values())}
        for label in EXPECTED_CLASSES
    ]
    write_confusion(out_dir / "confusion_before_mapping.csv", raw_rows, raw_columns)
    write_confusion(out_dir / "confusion_after_mapping.csv", mapped_rows, mapped_columns)

    total = len(rows)
    scored = sum(1 for row in rows if "error" not in row)
    summary = {
        "marker": "PIPELINE_ONLY",
        "data_label": args.label or "",
        "runner": args.runner,
        "note": (
            "stub runner：假偵測，僅驗證工具管線，不是真實推理結果"
            if args.runner == "stub" else
            "real runner：真實 .pt 推論"
        ),
        "generated_at": datetime.now().astimezone().isoformat(),
        "images_dir": str(images_dir),
        "model_path": str(model_path) if args.runner == "real" else None,
        "model_sha256": sha256_file(model_path) if (args.runner == "real" and model_path.exists()) else None,
        "submission_id": args.submission,
        "class_name_mapping": mapping,
        "confidence_threshold_recorded": args.conf,
        "image_total": total,
        "image_scored": scored,
        "image_error": total - scored,
        "accuracy_before_mapping": round(correct_before / scored, 4) if scored else None,
        "accuracy_after_mapping": round(correct_after / scored, 4) if scored else None,
        "correct_before": correct_before,
        "correct_after": correct_after,
        "per_class_after": {
            label: {
                "total": sum(mapped_matrix[label].values()),
                "correct": mapped_matrix[label].get(label, 0),
                "accuracy": round(
                    mapped_matrix[label].get(label, 0) / sum(mapped_matrix[label].values()), 4
                ) if sum(mapped_matrix[label].values()) else None,
            }
            for label in EXPECTED_CLASSES
        },
        "ignored_folders": skipped,
        "outputs": {
            "per_image": str(per_image),
            "confusion_before": str(out_dir / "confusion_before_mapping.csv"),
            "confusion_after": str(out_dir / "confusion_after_mapping.csv"),
        },
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n圖片 {total} 張（成功評分 {scored}）")
    print(f"映射前正確率：{summary['accuracy_before_mapping']}")
    print(f"映射後正確率：{summary['accuracy_after_mapping']}")
    print("逐張對照：", per_image)
    print("混淆矩陣（前）：", out_dir / "confusion_before_mapping.csv")
    print("混淆矩陣（後）：", out_dir / "confusion_after_mapping.csv")
    print("摘要：", out_dir / "summary.json")
    if args.label:
        print(f"\n*** 資料標記：{args.label} —— 不得作為準確率結果 ***")
    print("PIPELINE_ONLY")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
