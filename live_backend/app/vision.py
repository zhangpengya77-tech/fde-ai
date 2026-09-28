from __future__ import annotations

import math
import time
from dataclasses import dataclass

import httpx


class VisionUnavailable(Exception):
    """The local YOLO service could not be reached."""


class VisionResponseError(Exception):
    """The local YOLO service returned an invalid response."""


TIMING_KEYS = (
    "server_decode_ms",
    "queue_wait_ms",
    "model_preprocess_ms",
    "model_inference_ms",
    "postprocess_ms",
)


@dataclass(frozen=True)
class VisionResult:
    detections: list[dict]
    upstream_ms: float
    timings: dict[str, float] | None = None


class VisionAdapter:
    def __init__(self, base_url: str, *, timeout_seconds: float = 20.0, transport=None):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.transport = transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=self.transport, timeout=self.timeout_seconds, trust_env=False)

    async def health(self) -> bool:
        try:
            async with self._client() as client:
                response = await client.get(f"{self.base_url}/api/health")
                return response.is_success
        except httpx.HTTPError:
            return False

    async def detect(self, image_data: str, file_name: str, confidence: float) -> VisionResult:
        started = time.perf_counter()
        try:
            async with self._client() as client:
                response = await client.post(f"{self.base_url}/api/detect", json={"imageData": image_data, "fileName": file_name, "conf": confidence})
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPError as exc:
            raise VisionUnavailable() from exc
        except ValueError as exc:
            raise VisionResponseError() from exc

        try:
            result_payload = payload["result"]
            raw_detections = result_payload["detections"]
            if not isinstance(raw_detections, list):
                raise TypeError("detections must be a list")
            detections = [self._normalize_detection(item) for item in raw_detections]
            timings = self._normalize_timings(result_payload.get("timings", {}))
        except (KeyError, TypeError, ValueError) as exc:
            raise VisionResponseError() from exc

        return VisionResult(detections=detections, upstream_ms=round((time.perf_counter() - started) * 1000, 1), timings=timings)

    @staticmethod
    def _normalize_timings(value: object) -> dict[str, float]:
        if not isinstance(value, dict):
            raise TypeError("timings must be an object")
        normalized = {}
        for key in TIMING_KEYS:
            number = value.get(key, 0.0)
            if not isinstance(number, (int, float)) or not math.isfinite(number) or number < 0:
                raise ValueError("invalid timing")
            normalized[key] = round(float(number), 1)
        return normalized

    @staticmethod
    def _normalize_detection(item: dict) -> dict:
        if not isinstance(item, dict):
            raise TypeError("detection must be an object")
        class_name = item.get("className")
        confidence = item.get("confidence")
        box = item.get("box")
        if not isinstance(class_name, str) or not class_name:
            raise ValueError("invalid detection class")
        if not isinstance(confidence, (int, float)) or not math.isfinite(confidence):
            raise ValueError("invalid detection confidence")
        if not isinstance(box, list) or len(box) != 4 or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in box):
            raise ValueError("invalid detection box")
        return {"class": class_name, "confidence": round(float(confidence), 3), "box": [round(float(value)) for value in box]}
