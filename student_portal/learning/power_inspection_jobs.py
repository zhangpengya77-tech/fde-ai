"""POWER_INSPECTION_V1 的 Django 外部影片工作佇列。

本模組由管理命令或專屬 worker 呼叫；Django Web request 只寫入工作。
未明確允許的 MOCK 工作，以及任何沒有 real runner 的 REAL 工作，都不會
被靜默標成已完成。
"""

from __future__ import annotations

import base64
import binascii
import json
import subprocess
from pathlib import Path

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from .models import PowerInspectionAnomalyFrame, PowerInspectionJob


MAX_RETRIES = 3


def _decode_worker_frame_results(frame_results) -> list[dict]:
    """只解碼隔離 worker 的有效 base64 截圖；輸出不可信時使工作失敗。"""
    if not isinstance(frame_results, list):
        raise RuntimeError("worker_frame_results_invalid")
    decoded: list[dict] = []
    for frame in frame_results:
        if not isinstance(frame, dict):
            raise RuntimeError("worker_frame_results_invalid")
        item = dict(frame)
        screenshot_b64 = item.pop("screenshot_b64", None)
        if screenshot_b64 is not None:
            if not isinstance(screenshot_b64, str):
                raise RuntimeError("worker_screenshot_invalid")
            try:
                screenshot = base64.b64decode(screenshot_b64, validate=True)
            except (ValueError, binascii.Error) as exc:
                raise RuntimeError("worker_screenshot_invalid") from exc
            if not screenshot:
                raise RuntimeError("worker_screenshot_invalid")
            item["screenshot_bytes"] = screenshot
        decoded.append(item)
    return decoded


def build_timeline(
    frame_results: list[dict],
    *,
    max_gap_ms: int = 1500,
    confidence_threshold: float = 0.0,
    rule_version: str = "POWER_INSPECTION_RULE_V1",
) -> list[dict]:
    """依版本化門檻合併疑似異常；結果不能直接宣告設備已故障。"""
    records = []
    for frame in sorted(frame_results or [], key=lambda item: int(item.get("timestamp_ms", -1))):
        timestamp = frame.get("timestamp_ms")
        if not isinstance(timestamp, int) or timestamp < 0:
            continue
        for detection in frame.get("detections") or []:
            label = str(detection.get("class") or "").strip()
            confidence = detection.get("confidence")
            if (
                label
                and isinstance(confidence, (int, float))
                and confidence_threshold <= float(confidence) <= 1
            ):
                records.append({"timestamp_ms": timestamp, "class": label, "confidence": round(float(confidence), 6)})
    timeline = []
    for item in records:
        if timeline and timeline[-1]["class"] == item["class"] and item["timestamp_ms"] - timeline[-1]["end_ms"] <= max_gap_ms:
            entry = timeline[-1]
            entry["end_ms"] = item["timestamp_ms"]
            entry["frame_count"] += 1
            entry["max_confidence"] = max(entry["max_confidence"], item["confidence"])
        else:
            timeline.append({
                "class": item["class"], "start_ms": item["timestamp_ms"], "end_ms": item["timestamp_ms"],
                "frame_count": 1, "max_confidence": item["confidence"], "teacher_review": "PENDING",
                "classification": "SUSPECTED_ANOMALY",
                "rule_version": rule_version,
            })
    return timeline


def probe_video(video_path: Path, *, ffprobe_binary: str = "ffprobe") -> dict:
    """由外部 ffprobe 讀取 MP4 metadata；失敗由 caller 記錄，不猜測數值。"""
    command = [
        ffprobe_binary, "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,duration",
        "-of", "json", str(video_path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=30, check=False)
    if completed.returncode != 0:
        raise RuntimeError("video_probe_failed")
    try:
        stream = json.loads(completed.stdout).get("streams", [])[0]
        numerator, denominator = str(stream["r_frame_rate"]).split("/", 1)
        fps = float(numerator) / float(denominator)
        return {
            "duration_ms": int(float(stream["duration"]) * 1000),
            "width": int(stream["width"]), "height": int(stream["height"]), "fps": fps,
        }
    except (IndexError, KeyError, TypeError, ValueError, ZeroDivisionError) as exc:
        raise RuntimeError("video_probe_result_invalid") from exc


def _claim_next_job():
    with transaction.atomic():
        job = (
            PowerInspectionJob.objects.select_for_update(skip_locked=True)
            .filter(status=PowerInspectionJob.Status.QUEUED)
            .order_by("created_at")
            .first()
        )
        if job is None:
            return None
        job.status = PowerInspectionJob.Status.PROCESSING
        job.last_attempt_at = timezone.now()
        job.last_error = ""
        job.save(update_fields=["status", "last_attempt_at", "last_error", "updated_at"])
        return job


def _complete(job, *, frame_results: list[dict], provenance: str, metadata: dict | None = None):
    config = job.rule_config if isinstance(job.rule_config, dict) else {}
    threshold = config.get("confidence_threshold", 0.0)
    max_gap_ms = config.get("max_gap_ms", 1500)
    if not isinstance(threshold, (int, float)) or not 0 <= float(threshold) <= 1:
        raise RuntimeError("power_rule_threshold_invalid")
    if not isinstance(max_gap_ms, int) or max_gap_ms <= 0:
        raise RuntimeError("power_rule_gap_invalid")
    timeline = build_timeline(
        frame_results,
        max_gap_ms=max_gap_ms,
        confidence_threshold=float(threshold),
        rule_version=job.rule_version or "POWER_INSPECTION_RULE_V1",
    )
    with transaction.atomic():
        job = PowerInspectionJob.objects.select_for_update().get(pk=job.pk)
        if job.status != PowerInspectionJob.Status.PROCESSING:
            return job
        job.anomaly_timeline = timeline
        job.video_metadata = metadata or job.video_metadata
        job.result_json = {
            "provenance": provenance,
            "frame_count": len(frame_results),
            "rule_version": job.rule_version,
            "rule_config": config,
            "timeline": timeline,
        }
        job.status = PowerInspectionJob.Status.COMPLETED
        job.processed_at = timezone.now()
        job.worker_detail = "測試合成資料" if provenance == "MOCK_TEST_ONLY" else "隔離 YOLO worker 已完成。"
        job.save()
        for entry in timeline:
            frame = PowerInspectionAnomalyFrame.objects.create(
                job=job, timestamp_ms=entry["start_ms"], class_name=entry["class"],
                confidence=entry["max_confidence"], inference_mode=job.inference_mode,
            )
            # 截圖僅接受 worker 交回的 bytes；沒有截圖時保留空值，而不是產生
            # 虛構影像。每個時間軸區段只保存起始異常幀作為覆核證據。
            screenshot = next(
                (
                    item.get("screenshot_bytes") for item in frame_results
                    if item.get("timestamp_ms") == entry["start_ms"]
                    and any(str(d.get("class")) == entry["class"] for d in item.get("detections") or [])
                    and isinstance(item.get("screenshot_bytes"), bytes)
                ),
                None,
            )
            if screenshot:
                frame.screenshot.save(f"anomaly-{entry['start_ms']}.png", ContentFile(screenshot), save=True)
        return job


def _fail(job, code: str):
    with transaction.atomic():
        job = PowerInspectionJob.objects.select_for_update().get(pk=job.pk)
        job.status = PowerInspectionJob.Status.FAILED
        job.last_error = code[:500]
        job.worker_detail = "隔離影片處理失敗；可由教師重試。"
        job.save(update_fields=["status", "last_error", "worker_detail", "updated_at"])
        return job


def process_next_job(*, allow_mock_test: bool = False, mock_frame_results: list[dict] | None = None, real_runner=None):
    """處理一個已排入佇列的工作；回傳工作或 None。

    ``real_runner(job)`` 必須回傳 ``{frame_results, metadata}``，且由隔離
    worker 實作。沒有 runner 時 REAL 工作會明確失敗，而不是回報無異常。
    """
    job = _claim_next_job()
    if job is None:
        return None
    if job.inference_mode == PowerInspectionJob.InferenceMode.MOCK:
        if not allow_mock_test:
            return _fail(job, "mock_worker_not_explicitly_enabled")
        return _complete(job, frame_results=mock_frame_results or [], provenance="MOCK_TEST_ONLY")
    if job.inference_mode != PowerInspectionJob.InferenceMode.REAL or real_runner is None:
        return _fail(job, "real_worker_unavailable")
    try:
        # 先由獨立 probe 取得影片事實資料，再交給隔離 YOLO runner；不猜測
        # 長度、解析度或 FPS，probe 失敗會落入 FAILED 分支。
        metadata = probe_video(Path(job.video.path))
        result = real_runner(job)
        if not isinstance(result, dict):
            raise RuntimeError("worker_result_invalid")
        metadata.update(dict(result.get("metadata") or {}))
        return _complete(
            job,
            frame_results=_decode_worker_frame_results(result.get("frame_results")),
            metadata=metadata,
            provenance="REAL_YOLO",
        )
    except Exception:
        return _fail(job, "isolated_worker_failed")


def retry_job(job_id) -> bool:
    """教師可重試失敗工作；已超過限制或非 FAILED 狀態一律拒絕。"""
    with transaction.atomic():
        job = PowerInspectionJob.objects.select_for_update().filter(job_id=job_id).first()
        if job is None or job.status != PowerInspectionJob.Status.FAILED or job.retry_count >= MAX_RETRIES:
            return False
        job.retry_count += 1
        job.status = PowerInspectionJob.Status.QUEUED
        job.last_error = ""
        job.save(update_fields=["retry_count", "status", "last_error", "updated_at"])
        return True
