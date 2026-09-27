from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class LiveConfig:
    yolo_base_url: str = "http://127.0.0.1:8765"
    vision_health_timeout_seconds: float = 1.0

    @classmethod
    def from_environment(cls) -> "LiveConfig":
        return cls(
            yolo_base_url=os.environ.get(
                "FDE_LIVE_YOLO_BASE_URL", "http://127.0.0.1:8765"
            ).rstrip("/"),
            vision_health_timeout_seconds=max(
                0.05,
                float(os.environ.get("FDE_LIVE_VISION_HEALTH_TIMEOUT_SECONDS", "1.0")),
            ),
        )
