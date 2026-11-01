"""POWER_INSPECTION_V1 的隔離 YOLO 影片 worker。

此程式只能由受控的子程序啟動；Web 服務不可直接 import 或載入模型。
呼叫端必須先建立已驗證的 manifest，並在 OS 層配置無網路、CPU／RAM 與
逾時限制。本檔不提供網路下載、Registry 寫入或任何正式 ACTIVE 操作。
"""

from __future__ import annotations

import argparse
import base64
import json
import math
from pathlib import Path

from .power_inspection import (
    VIDEO_HEADER_BYTES,
    VIDEO_SUFFIXES,
    PowerInspectionValidationError,
    assess_model_delivery,
    build_anomaly_timeline,
    validate_video_upload,
    verify_model_manifest,
)


def validate_worker_frame_results(frame_results: list[dict], class_names: list[str]) -> list[dict]:
    """驗證 worker 回傳的偵測資料，拒絕契約外類別與不完整 bbox。"""
    allowed_labels = {str(item) for item in class_names}
    normalized: list[dict] = []
    for frame in frame_results or []:
        timestamp = frame.get("timestamp_ms")
        if not isinstance(timestamp, int) or timestamp < 0:
            raise PowerInspectionValidationError("worker_timestamp_invalid")
        detections = []
        for detection in frame.get("detections") or []:
            label = str(detection.get("class") or "").strip()
            if label not in allowed_labels:
                raise PowerInspectionValidationError("worker_class_not_in_contract")
            try:
                confidence = float(detection.get("confidence"))
                bbox = [float(value) for value in detection.get("bbox")]
            except (TypeError, ValueError) as exc:
                raise PowerInspectionValidationError("worker_detection_invalid") from exc
            if not 0 <= confidence <= 1 or len(bbox) != 4 or not all(math.isfinite(value) for value in bbox):
                raise PowerInspectionValidationError("worker_detection_invalid")
            detections.append({"class": label, "confidence": confidence, "bbox": bbox})
        entry = {"timestamp_ms": timestamp, "detections": detections}
        screenshot = frame.get("screenshot_bytes")
        if screenshot is not None:
            if not isinstance(screenshot, bytes) or not screenshot:
                raise PowerInspectionValidationError("worker_screenshot_invalid")
            entry["screenshot_bytes"] = screenshot
        normalized.append(entry)
    return normalized


def serialize_worker_result(result: dict) -> dict:
    """把 worker 截圖轉為 JSON-safe base64，讓 Web 程序仍可驗證後保存。"""
    serialized = {key: value for key, value in result.items() if key != "frame_results"}
    serialized_frames = []
    for frame in result.get("frame_results") or []:
        item = dict(frame)
        screenshot = item.pop("screenshot_bytes", None)
        if screenshot is not None:
            item["screenshot_b64"] = base64.b64encode(screenshot).decode("ascii")
        serialized_frames.append(item)
    serialized["frame_results"] = serialized_frames
    return serialized


def _video_frames(video_path: Path):
    """由 OpenCV 逐幀解碼，回傳 (fps, frames)；無法取得 FPS 時拒絕猜測時間軸。

    Ultralytics 的影片來源只接受固定副檔名，.3gp、.lrf、.mts 等會被拒絕，
    因此由 worker 解碼後逐幀交給模型。
    """
    import cv2  # type: ignore[import-not-found]

    capture = cv2.VideoCapture(str(video_path))
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    if not math.isfinite(fps) or fps <= 0:
        capture.release()
        raise PowerInspectionValidationError("video_fps_unavailable")

    def frames():
        try:
            while True:
                decoded, frame = capture.read()
                if not decoded:
                    return
                yield frame
        finally:
            capture.release()

    return fps, frames()


def verify_model(*, manifest: dict, allowed_root: Path) -> dict:
    """核驗交付資料後實際載入模型，確認類別與類別契約完全一致。"""
    delivery = assess_model_delivery(manifest, allowed_root)
    if delivery["status"] != "VALIDATED":
        raise PowerInspectionValidationError("model_delivery_pending")
    verified = delivery["verified"]

    import numpy as np  # type: ignore[import-not-found]
    from ultralytics import YOLO  # type: ignore[import-not-found]

    model = YOLO(verified["artifact_path"], task="detect")
    prediction = model.predict(source=np.zeros((64, 64, 3), dtype=np.uint8), verbose=False)
    names = model.names
    class_names = [str(names[key]) for key in sorted(names)] if isinstance(names, dict) else [str(item) for item in names]
    if class_names != verified["class_names"]:
        raise PowerInspectionValidationError("model_classes_mismatch")
    if not prediction or getattr(prediction[0], "boxes", None) is None:
        raise PowerInspectionValidationError("model_smoke_inference_failed")
    return {"class_names": class_names, "sha256": verified["sha256"]}


def inspect_video(*, manifest: dict, video_path: Path, allowed_root: Path, confidence: float = 0.25) -> dict:
    """在 worker 程序中執行一次真實 Ultralytics YOLO 影片推論。

    函式僅於 artifact 與影片都完成前置驗證後才 import ultralytics；任何
    缺失依賴或解碼／推論錯誤都讓 worker 失敗，由上游標為不可用而非「無異常」。
    """
    delivery = assess_model_delivery(manifest, allowed_root)
    if delivery["status"] != "VALIDATED":
        raise PowerInspectionValidationError("model_delivery_pending")
    verified = delivery["verified"]
    video_path = Path(video_path)
    if not video_path.is_file() or not _is_inside(allowed_root, video_path):
        raise PowerInspectionValidationError("video_artifact_missing")
    if video_path.suffix.lower() not in VIDEO_SUFFIXES or video_path.stat().st_size <= 0:
        raise PowerInspectionValidationError("video_artifact_invalid")
    with video_path.open("rb") as handle:
        validate_video_upload(video_path.name, handle.read(VIDEO_HEADER_BYTES))
    if not 0 < float(confidence) <= 1:
        raise PowerInspectionValidationError("confidence_invalid")

    # 延遲匯入：主 Web 服務不需具備或載入 PyTorch/Ultralytics。
    from ultralytics import YOLO  # type: ignore[import-not-found]
    import cv2  # type: ignore[import-not-found]

    model = YOLO(verified["artifact_path"])
    frame_results: list[dict] = []
    fps, frames = _video_frames(video_path)
    frame_stride = verified["inference"]["frame_stride"]
    for frame_index, image in enumerate(frames):
        if frame_index % frame_stride:
            continue
        result = model.predict(source=image, conf=float(confidence), verbose=False)[0]
        names = result.names or {}
        detections = []
        for box in (result.boxes if result.boxes is not None else []):
            class_id = int(box.cls[0].item())
            label = str(names[class_id] if isinstance(names, list) else names.get(class_id, class_id))
            confidence_value = float(box.conf[0].item())
            bbox = [float(value) for value in box.xyxy[0].tolist()]
            detections.append({"class": label, "confidence": confidence_value, "bbox": bbox})
        frame = {"timestamp_ms": int(frame_index * 1000 / fps), "detections": detections}
        if detections:
            encoded_ok, encoded = cv2.imencode(".jpg", result.plot())
            if not encoded_ok:
                raise PowerInspectionValidationError("worker_screenshot_encode_failed")
            frame["screenshot_bytes"] = encoded.tobytes()
        frame_results.append(frame)
    if not frame_results:
        raise PowerInspectionValidationError("video_decode_failed")
    frame_results = validate_worker_frame_results(frame_results, verified["class_names"])
    return {
        "model": {key: verified[key] for key in ("task_type", "model_name", "version", "sha256", "class_names")},
        "frame_count": len(frame_results),
        "frame_results": frame_results,
        "timeline": build_anomaly_timeline(frame_results),
        "metadata": {"fps": fps, "frame_stride": frame_stride, "timestamp_source": "frame_index_and_container_fps"},
    }


def _is_inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="FDE POWER_INSPECTION_V1 isolated YOLO worker")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--video")
    parser.add_argument("--allowed-root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--confidence", type=float, default=0.25)
    args = parser.parse_args()
    manifest_path = Path(args.manifest)
    output_path = Path(args.output)
    try:
        if not _is_inside(Path(args.allowed_root), manifest_path) or not _is_inside(Path(args.allowed_root), output_path):
            raise PowerInspectionValidationError("worker_path_outside_allowed_root")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if args.video:
            result = inspect_video(manifest=manifest, video_path=Path(args.video), allowed_root=Path(args.allowed_root), confidence=args.confidence)
            payload = serialize_worker_result(result)
        else:
            payload = verify_model(manifest=manifest, allowed_root=Path(args.allowed_root))
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return 0
    except (OSError, ValueError, PowerInspectionValidationError) as exc:
        # 標準錯誤只寫安全代碼／類型，不回傳檔案路徑、環境或秘密。
        print(f"power_inspection_worker_failed:{type(exc).__name__}:{exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
