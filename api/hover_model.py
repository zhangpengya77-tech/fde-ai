from __future__ import annotations

import argparse
import csv
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path

import cv2
import numpy as np


DEFAULT_SOURCE = Path(r"E:\四面懸停")
DEFAULT_OUTPUT = DEFAULT_SOURCE / "hover_model_v1"
VIDEO_EXTS = {".lrf", ".mp4", ".mov", ".avi", ".mkv"}


@dataclass
class HoverMetrics:
    video: str
    source_path: str
    duration_sec: float
    sampled_frames: int
    tracked_frames: int
    tracking_rate: float
    drift_px: float
    jitter_px: float
    max_offset_px: float
    stable_ratio: float
    out_of_zone_ratio: float
    direction_completion: int
    score: int
    status: str


def discover_videos(source: Path) -> list[Path]:
    files = [path for path in source.rglob("*") if path.is_file() and path.suffix.lower() in VIDEO_EXTS]
    by_stem: dict[str, Path] = {}
    for path in sorted(files, key=lambda item: (item.stem, item.suffix.lower() != ".lrf", item.stat().st_size)):
        key = path.stem.replace("_D", "")
        current = by_stem.get(key)
        if current is None or (current.suffix.lower() != ".lrf" and path.suffix.lower() == ".lrf"):
            by_stem[key] = path
    return sorted(by_stem.values(), key=lambda item: str(item))


def _safe_fps(cap: cv2.VideoCapture) -> float:
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not math.isfinite(fps) or fps <= 0 or fps > 240:
        return 30.0
    return fps


def _classify_quadrants(points: np.ndarray, center: np.ndarray) -> int:
    if len(points) < 4:
        return 0
    rel = points - center
    quadrants = {
        (x >= 0, y >= 0)
        for x, y in rel
        if abs(x) > 8 or abs(y) > 8
    }
    return min(4, len(quadrants))


def analyze_video(video_path: Path, sample_fps: float = 2.0, max_frames: int = 360) -> HoverMetrics | None:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return None

    fps = _safe_fps(cap)
    total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    duration_sec = float(total_frames / fps) if total_frames and total_frames > 0 else 0.0
    step = max(1, int(round(fps / sample_fps)))
    subtractor = cv2.createBackgroundSubtractorMOG2(history=80, varThreshold=32, detectShadows=False)
    points: list[tuple[float, float]] = []
    sampled = 0
    index = 0
    previous: np.ndarray | None = None

    while sampled < max_frames:
        ok, frame = cap.read()
        if not ok:
            break
        if index % step != 0:
            index += 1
            continue
        index += 1
        sampled += 1

        frame = cv2.resize(frame, (640, 360), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        mask = subtractor.apply(gray)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        candidates = []
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < 18 or area > 12000:
                continue
            x, y, w, h = cv2.boundingRect(contour)
            if w < 4 or h < 4:
                continue
            center = np.array([x + w / 2, y + h / 2], dtype=np.float32)
            compactness = area / max(1, w * h)
            score = area * (0.7 + compactness)
            if previous is not None:
                score -= float(np.linalg.norm(center - previous)) * 8
            candidates.append((score, center))

        if candidates:
            _, best = max(candidates, key=lambda item: item[0])
            previous = best
            points.append((float(best[0]), float(best[1])))

    cap.release()

    if sampled < 6:
        return HoverMetrics(str(video_path.name), str(video_path), duration_sec, sampled, len(points), 0, 0, 0, 0, 0, 1, 0, 0, "INSUFFICIENT")

    tracked = len(points)
    tracking_rate = tracked / sampled if sampled else 0.0
    if tracked < max(4, sampled * 0.18):
        return HoverMetrics(str(video_path.name), str(video_path), duration_sec, sampled, tracked, tracking_rate, 0, 0, 0, 0, 1, 0, 0, "INSUFFICIENT")

    arr = np.array(points, dtype=np.float32)
    center = np.median(arr, axis=0)
    offsets = np.linalg.norm(arr - center, axis=1)
    diffs = np.linalg.norm(np.diff(arr, axis=0), axis=1) if len(arr) > 1 else np.array([0], dtype=np.float32)
    drift_px = float(np.percentile(offsets, 90))
    jitter_px = float(np.percentile(diffs, 75))
    max_offset_px = float(np.max(offsets))
    stable_ratio = float(np.mean(offsets <= 42))
    out_of_zone_ratio = float(np.mean(offsets > 88))
    direction_completion = _classify_quadrants(arr, center)

    score = 100
    score -= min(34, int(drift_px / 3.2))
    score -= min(24, int(jitter_px / 2.8))
    score -= min(26, int(out_of_zone_ratio * 45))
    score -= min(16, int((1.0 - tracking_rate) * 22))
    score = max(0, min(100, score))
    status = "PASS" if score >= 78 else "WARNING" if score >= 60 else "FAIL"

    return HoverMetrics(
        str(video_path.name),
        str(video_path),
        duration_sec,
        sampled,
        tracked,
        tracking_rate,
        round(drift_px, 2),
        round(jitter_px, 2),
        round(max_offset_px, 2),
        round(stable_ratio, 3),
        round(out_of_zone_ratio, 3),
        direction_completion,
        int(score),
        status,
    )


def train_baseline(source: Path, output: Path, limit: int | None = None) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    videos = discover_videos(source)
    if limit:
        videos = videos[:limit]

    metrics = []
    for video in videos:
        item = analyze_video(video)
        if item is not None:
            metrics.append(item)

    usable = [item for item in metrics if item.status != "INSUFFICIENT"]
    drift_values = [item.drift_px for item in usable]
    jitter_values = [item.jitter_px for item in usable]
    out_values = [item.out_of_zone_ratio for item in usable]
    model = {
        "name": "fde_ai_hover_baseline_v1",
        "source": str(source),
        "video_count": len(metrics),
        "usable_video_count": len(usable),
        "method": "unsupervised_motion_baseline",
        "classes": ["PASS", "WARNING", "FAIL", "INSUFFICIENT"],
        "thresholds": {
            "pass_score": 78,
            "warning_score": 60,
            "drift_px_p50": float(np.percentile(drift_values, 50)) if drift_values else 0,
            "drift_px_p85": float(np.percentile(drift_values, 85)) if drift_values else 0,
            "jitter_px_p50": float(np.percentile(jitter_values, 50)) if jitter_values else 0,
            "jitter_px_p85": float(np.percentile(jitter_values, 85)) if jitter_values else 0,
            "out_of_zone_ratio_p85": float(np.percentile(out_values, 85)) if out_values else 0,
        },
        "metrics": [asdict(item) for item in metrics],
    }

    (output / "hover_model.json").write_text(json.dumps(model, ensure_ascii=False, indent=2), encoding="utf-8")
    with (output / "hover_metrics.csv").open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=list(asdict(metrics[0]).keys()) if metrics else ["video"])
        writer.writeheader()
        for item in metrics:
            writer.writerow(asdict(item))
    return model


def main():
    parser = argparse.ArgumentParser(description="Train FDE-AI four-side hover baseline model")
    parser.add_argument("--source", default=str(DEFAULT_SOURCE))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    model = train_baseline(Path(args.source), Path(args.output), args.limit)
    print(json.dumps({k: model[k] for k in ["name", "video_count", "usable_video_count", "thresholds"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
