"""Validate and normalize short Growth Record videos with FFmpeg.

The module intentionally keeps the raw upload in a temporary file and only
returns a normalized MP4 for the caller to store as an Evidence record.
"""

from __future__ import annotations

import json
import logging
import math
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from django.conf import settings


logger = logging.getLogger(__name__)

SUPPORTED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".3gp", ".webm", ".mkv", ".avi"}
SUPPORTED_VIDEO_MIME_TYPES = {
    "video/mp4",
    "video/quicktime",
    "video/x-m4v",
    "video/3gpp",
    "video/webm",
    "video/x-matroska",
    "video/x-msvideo",
    "video/avi",
    "video/hevc",
    "video/x-hevc",
}
# Some mobile browsers report an unknown MIME type. The extension is still
# checked, and FFprobe remains authoritative for the actual media container.
UNKNOWN_MIME_TYPES = {"", "application/octet-stream", "binary/octet-stream"}
SUPPORTED_CONTAINER_NAMES = {"avi", "matroska", "mov", "mp4", "webm"}
FRIENDLY_INVALID_VIDEO = "這個影片無法處理，請換一個影片再試。"


class VideoProcessingError(Exception):
    """An expected upload/processing failure safe to show to a learner."""

    def __init__(self, user_message, *, reason="processing_error"):
        self.user_message = user_message
        self.reason = reason
        super().__init__(user_message)


@dataclass
class ProcessedVideo:
    path: Path
    original_metadata: dict
    processed_metadata: dict

    def cleanup(self):
        _unlink(self.path)


def _unlink(path):
    if not path:
        return
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        logger.warning("Unable to clean temporary growth video path=%s", path, exc_info=True)


def _setting(name, default):
    return getattr(settings, name, default)


def _max_upload_bytes():
    return int(_setting("GROWTH_VIDEO_MAX_UPLOAD_BYTES", 300 * 1024 * 1024))


def _binary(setting_name, default_name):
    configured = str(_setting(setting_name, default_name)).strip() or default_name
    return shutil.which(configured)


def _safe_upload_context(upload):
    filename = str(getattr(upload, "name", ""))
    extension = Path(filename).suffix.lower() or "unknown"
    content_type = (getattr(upload, "content_type", "") or "unknown").split(";", 1)[0].strip().lower()
    size = getattr(upload, "size", None)
    return extension, content_type, size


def _log_rejection(upload, reason, *, format_name="unknown", detail=""):
    extension, content_type, size = _safe_upload_context(upload)
    logger.warning(
        "Growth video rejected extension=%s content_type=%s size=%s format=%s reason=%s detail=%s",
        extension,
        content_type,
        size,
        format_name,
        reason,
        str(detail).replace("\r", " ").replace("\n", " ")[:500],
    )


def _rate_value(value):
    if not value or value in {"0/0", "N/A", "nan"}:
        return 0.0
    try:
        return float(Fraction(str(value)))
    except (ValueError, ZeroDivisionError):
        return 0.0


def _run_ffprobe(path):
    binary = _binary("GROWTH_VIDEO_FFPROBE_BINARY", "ffprobe")
    if not binary:
        raise VideoProcessingError(
            "目前無法處理影片，伺服器尚未安裝影片處理工具。",
            reason="ffprobe_missing",
        )
    command = [
        binary,
        "-hide_banner",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=int(_setting("GROWTH_VIDEO_PROBE_TIMEOUT_SECONDS", 30)),
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.exception("FFprobe could not inspect a growth video")
        raise VideoProcessingError(FRIENDLY_INVALID_VIDEO, reason="ffprobe_error") from exc
    if result.returncode != 0:
        _log_rejection(path, "ffprobe_rejected", detail=result.stderr)
        raise VideoProcessingError(FRIENDLY_INVALID_VIDEO, reason="ffprobe_rejected")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        logger.error("FFprobe returned invalid JSON: %s", result.stdout[:500])
        raise VideoProcessingError(FRIENDLY_INVALID_VIDEO, reason="ffprobe_invalid_json") from exc


def _probe_video(path):
    payload = _run_ffprobe(path)
    streams = payload.get("streams") or []
    video_stream = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio_stream = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    if not video_stream:
        raise VideoProcessingError(FRIENDLY_INVALID_VIDEO, reason="no_video_stream")

    format_info = payload.get("format") or {}
    format_name = str(format_info.get("format_name") or "").lower()
    duration_value = format_info.get("duration") or video_stream.get("duration")
    try:
        duration = float(duration_value)
    except (TypeError, ValueError):
        duration = 0.0
    if not math.isfinite(duration) or duration <= 0:
        raise VideoProcessingError(FRIENDLY_INVALID_VIDEO, reason="invalid_duration")

    width = int(video_stream.get("width") or 0)
    height = int(video_stream.get("height") or 0)
    if width <= 0 or height <= 0:
        raise VideoProcessingError(FRIENDLY_INVALID_VIDEO, reason="invalid_dimensions")

    fps = max(
        _rate_value(video_stream.get("avg_frame_rate")),
        _rate_value(video_stream.get("r_frame_rate")),
    )
    rotation = (video_stream.get("tags") or {}).get("rotate")
    return {
        "format_name": format_name,
        "duration": duration,
        "width": width,
        "height": height,
        "fps": fps,
        "video_codec": str(video_stream.get("codec_name") or "unknown").lower(),
        "audio_codec": (
            str(audio_stream.get("codec_name") or "unknown").lower() if audio_stream else None
        ),
        "has_audio": audio_stream is not None,
        "rotation": rotation,
    }


def _write_upload_to_temp(upload):
    extension = Path(str(getattr(upload, "name", ""))).suffix.lower()
    fd, raw_path = tempfile.mkstemp(prefix="fde-growth-video-", suffix=extension or ".upload")
    path = Path(raw_path)
    try:
        with os.fdopen(fd, "wb") as destination:
            upload.seek(0)
            for chunk in upload.chunks():
                destination.write(chunk)
    except Exception:
        _unlink(path)
        raise
    finally:
        try:
            upload.seek(0)
        except (AttributeError, OSError):
            pass
    return path


def _transcode(source_path, output_path, source_probe, max_duration):
    binary = _binary("GROWTH_VIDEO_FFMPEG_BINARY", "ffmpeg")
    if not binary:
        raise VideoProcessingError(
            "目前無法處理影片，伺服器尚未安裝影片處理工具。",
            reason="ffmpeg_missing",
        )
    scale_filter = (
        "scale=w='min(1280,iw)':h='min(720,ih)':"
        "force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p"
    )
    command = [
        binary,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-autorotate",
        "-i",
        str(source_path),
        "-map",
        "0:v:0",
        "-vf",
        scale_filter,
        "-c:v",
        "libx264",
        "-r",
        "30",
        "-preset",
        str(_setting("GROWTH_VIDEO_PRESET", "veryfast")),
        "-crf",
        str(_setting("GROWTH_VIDEO_CRF", 28)),
        "-pix_fmt",
        "yuv420p",
        "-t",
        str(max_duration),
        "-movflags",
        "+faststart",
    ]
    if source_probe["has_audio"]:
        command.extend(["-map", "0:a:0?", "-c:a", "aac", "-b:a", "128k"])
    else:
        command.append("-an")
    command.append(str(output_path))

    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=int(_setting("GROWTH_VIDEO_PROCESS_TIMEOUT_SECONDS", 300)),
        )
    except subprocess.TimeoutExpired as exc:
        logger.exception("FFmpeg timed out while processing a growth video")
        raise VideoProcessingError("影片處理時間過長，請換一個較短的影片再試。", reason="ffmpeg_timeout") from exc
    except (OSError, subprocess.SubprocessError) as exc:
        logger.exception("FFmpeg could not process a growth video")
        raise VideoProcessingError(FRIENDLY_INVALID_VIDEO, reason="ffmpeg_error") from exc
    if result.returncode != 0:
        logger.error(
            "FFmpeg failed for growth video returncode=%s stderr=%s",
            result.returncode,
            (result.stderr or "")[:2000],
        )
        raise VideoProcessingError(FRIENDLY_INVALID_VIDEO, reason="ffmpeg_failed")


def _validate_processed_video(probe):
    formats = set(probe["format_name"].split(","))
    if "mp4" not in formats:
        raise VideoProcessingError(FRIENDLY_INVALID_VIDEO, reason="output_not_mp4")
    if probe["video_codec"] != "h264":
        raise VideoProcessingError(FRIENDLY_INVALID_VIDEO, reason="output_not_h264")
    if probe["width"] > 1280 or probe["height"] > 720:
        raise VideoProcessingError(FRIENDLY_INVALID_VIDEO, reason="output_too_large")
    if probe["fps"] > float(_setting("GROWTH_VIDEO_MAX_FPS", 30)) + 0.01:
        raise VideoProcessingError(FRIENDLY_INVALID_VIDEO, reason="output_fps_too_high")
    if probe["has_audio"] and probe["audio_codec"] != "aac":
        raise VideoProcessingError(FRIENDLY_INVALID_VIDEO, reason="output_not_aac")


def process_growth_video(upload):
    """Validate and transcode one uploaded video, returning a temp MP4 result."""
    ffmpeg_binary = _binary("GROWTH_VIDEO_FFMPEG_BINARY", "ffmpeg")
    ffprobe_binary = _binary("GROWTH_VIDEO_FFPROBE_BINARY", "ffprobe")
    if not ffmpeg_binary or not ffprobe_binary:
        raise VideoProcessingError(
            "目前無法處理影片，伺服器尚未安裝影片處理工具。",
            reason="video_tools_missing",
        )

    extension, content_type, size = _safe_upload_context(upload)
    if extension not in SUPPORTED_VIDEO_EXTENSIONS or (
        content_type not in SUPPORTED_VIDEO_MIME_TYPES and content_type not in UNKNOWN_MIME_TYPES
    ):
        _log_rejection(upload, "extension_or_mime_rejected")
        raise VideoProcessingError(
            "影片格式無效，請上傳 MP4、MOV、M4V、3GP、WEBM、MKV 或 AVI 影片。",
            reason="extension_or_mime_rejected",
        )
    max_bytes = _max_upload_bytes()
    if size is not None and size > max_bytes:
        _log_rejection(upload, "size_limit")
        max_mb = max(1, math.ceil(max_bytes / (1024 * 1024)))
        raise VideoProcessingError(
            f"影片檔案過大，單個影片請控制在{max_mb} MB以內。",
            reason="size_limit",
        )

    source_path = None
    output_path = None
    try:
        source_path = _write_upload_to_temp(upload)
        source_probe = _probe_video(source_path)
        formats = set(source_probe["format_name"].split(","))
        if not formats.intersection(SUPPORTED_CONTAINER_NAMES):
            _log_rejection(upload, "unsupported_container", format_name=source_probe["format_name"])
            raise VideoProcessingError(FRIENDLY_INVALID_VIDEO, reason="unsupported_container")
        max_duration = float(_setting("GROWTH_VIDEO_MAX_DURATION_SECONDS", 30))

        output_fd, output_name = tempfile.mkstemp(prefix="fde-growth-video-processed-", suffix=".mp4")
        os.close(output_fd)
        output_path = Path(output_name)
        _transcode(source_path, output_path, source_probe, max_duration)
        processed_probe = _probe_video(output_path)
        _validate_processed_video(processed_probe)
        original_filename = Path(str(getattr(upload, "name", "video"))).name
        original_metadata = {
            "filename": original_filename,
            "extension": extension,
            "content_type": content_type,
            "size_bytes": size,
            **source_probe,
        }
        processed_metadata = {
            "format": "MP4",
            "content_type": "video/mp4",
            "size_bytes": output_path.stat().st_size,
            "width": processed_probe["width"],
            "height": processed_probe["height"],
            "duration": round(processed_probe["duration"], 3),
            "fps": round(processed_probe["fps"], 3),
            "video_codec": "h264",
            "audio_codec": processed_probe["audio_codec"],
            "crf": int(_setting("GROWTH_VIDEO_CRF", 28)),
            "preset": str(_setting("GROWTH_VIDEO_PRESET", "veryfast")),
            "faststart": True,
        }
        return ProcessedVideo(
            path=output_path,
            original_metadata=original_metadata,
            processed_metadata=processed_metadata,
        )
    except VideoProcessingError:
        _unlink(output_path)
        raise
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        logger.exception("Unexpected growth video processing failure")
        _unlink(output_path)
        raise VideoProcessingError(FRIENDLY_INVALID_VIDEO, reason="unexpected_processing_error") from exc
    finally:
        _unlink(source_path)
