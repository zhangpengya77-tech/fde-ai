from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class LiveConfig:
    yolo_base_url: str = "http://127.0.0.1:8765"
    vision_health_timeout_seconds: float = 3.0
    vision_request_timeout_seconds: float = 20.0
    max_image_bytes: int = 8 * 1024 * 1024
    dev_mode: bool = False
    rag_base_url: str = "http://127.0.0.1:8770"
    rag_timeout_seconds: float = 8.0

    @classmethod
    def from_environment(cls) -> "LiveConfig":
        return cls(
            yolo_base_url=os.environ.get("FDE_LIVE_YOLO_BASE_URL", "http://127.0.0.1:8765").rstrip("/"),
            vision_health_timeout_seconds=max(0.05, float(os.environ.get("FDE_LIVE_VISION_HEALTH_TIMEOUT_SECONDS", "3.0"))),
            vision_request_timeout_seconds=max(1.0, float(os.environ.get("FDE_LIVE_VISION_REQUEST_TIMEOUT_SECONDS", "20.0"))),
            max_image_bytes=max(1024, int(os.environ.get("FDE_LIVE_MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))),
            dev_mode=os.environ.get("FDE_LIVE_DEV_MODE", "").lower() in {"1", "true", "yes"},
            rag_base_url=os.environ.get("FDE_LIVE_RAG_BASE_URL", "http://127.0.0.1:8770").rstrip("/"),
            rag_timeout_seconds=max(0.1, float(os.environ.get("FDE_LIVE_RAG_TIMEOUT_SECONDS", "8.0"))),
        )
