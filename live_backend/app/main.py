from __future__ import annotations

import asyncio
import base64
import binascii
import time
from uuid import uuid4

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.routing import Route

from .config import LiveConfig
from .errors import error_response, json_response
from .sessions import InMemorySessionStore
from .vision import VisionAdapter, VisionResponseError, VisionUnavailable


def _decode_image_data(image_data: object, max_image_bytes: int) -> tuple[bytes | None, str | None]:
    if not isinstance(image_data, str) or not image_data.startswith("data:image/"):
        return None, "invalid_image"
    header, separator, encoded = image_data.partition(",")
    if not separator or ";base64" not in header or not encoded:
        return None, "invalid_image"
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        return None, "invalid_image"
    if not decoded:
        return None, "invalid_image"
    if len(decoded) > max_image_bytes:
        return None, "image_too_large"
    return decoded, None


def create_app(
    *,
    vision_adapter=None,
    session_store=None,
    vision_health_timeout_seconds: float | None = None,
    max_image_bytes: int | None = None,
) -> Starlette:
    config = LiveConfig.from_environment()
    adapter = vision_adapter or VisionAdapter(
        config.yolo_base_url,
        timeout_seconds=config.vision_request_timeout_seconds,
    )
    sessions = session_store or InMemorySessionStore()
    health_timeout = (
        config.vision_health_timeout_seconds
        if vision_health_timeout_seconds is None
        else vision_health_timeout_seconds
    )
    image_limit = config.max_image_bytes if max_image_bytes is None else max_image_bytes

    async def health(_request: Request):
        try:
            vision_online = bool(
                await asyncio.wait_for(adapter.health(), timeout=health_timeout)
            )
        except (TimeoutError, OSError, ValueError):
            vision_online = False

        return json_response(
            {
                "status": "online" if vision_online else "degraded",
                "components": {
                    "live_backend": "online",
                    "vision": "online" if vision_online else "offline",
                },
            }
        )

    async def create_session(request: Request):
        try:
            payload = await request.json()
        except (ValueError, UnicodeDecodeError):
            return error_response("invalid_json", "Request body must be a JSON object.", 400)
        if not isinstance(payload, dict):
            return error_response("invalid_json", "Request body must be a JSON object.", 400)

        forbidden = {"student_id", "teacher", "course_permission", "pass"}.intersection(payload)
        if forbidden:
            return error_response(
                "untrusted_field",
                "Demo sessions do not accept identity, permission, or result fields.",
                400,
            )
        if payload.get("mode", "demo") != "demo":
            return error_response("unsupported_mode", "Phase 1A supports demo mode only.", 400)

        session = sessions.create()
        return json_response(session.as_dict(), status_code=201)

    async def snapshot(request: Request):
        session_id = request.path_params["session_id"]
        if sessions.get(session_id) is None:
            return error_response("session_not_found", "Live session was not found.", 404)
        try:
            payload = await request.json()
        except (ValueError, UnicodeDecodeError):
            return error_response("invalid_json", "Request body must be a JSON object.", 400)
        if not isinstance(payload, dict):
            return error_response("invalid_json", "Request body must be a JSON object.", 400)

        _decoded, image_error = _decode_image_data(payload.get("image_data"), image_limit)
        if image_error == "invalid_image":
            return error_response("invalid_image", "A valid base64 image data URL is required.", 400)
        if image_error == "image_too_large":
            return error_response("image_too_large", "The snapshot exceeds the Phase 1A size limit.", 413)

        frame_id = str(payload.get("frame_id") or uuid4())
        if len(frame_id) > 100:
            return error_response("invalid_frame_id", "Frame ID is too long.", 400)
        file_name = str(payload.get("file_name") or "live-snapshot.jpg")
        if len(file_name) > 255:
            return error_response("invalid_file_name", "File name is too long.", 400)
        try:
            confidence = float(payload.get("confidence", 0.25))
        except (TypeError, ValueError):
            return error_response("invalid_confidence", "Confidence must be between 0 and 1.", 400)
        if not 0 <= confidence <= 1:
            return error_response("invalid_confidence", "Confidence must be between 0 and 1.", 400)

        started = time.perf_counter()
        try:
            result = await adapter.detect(payload["image_data"], file_name, confidence)
        except VisionUnavailable:
            return error_response("vision_offline", "Vision service is currently unavailable.", 503)
        except VisionResponseError:
            return error_response("vision_invalid_response", "Vision service returned an invalid response.", 502)

        return json_response(
            {
                "session_id": session_id,
                "frame_id": frame_id,
                "detections": result.detections,
                "metrics": {
                    "vision_upstream_ms": result.upstream_ms,
                    "backend_ms": round((time.perf_counter() - started) * 1000, 1),
                },
            }
        )

    async def delete_session(request: Request):
        if not sessions.delete(request.path_params["session_id"]):
            return error_response("session_not_found", "Live session was not found.", 404)
        return json_response({"deleted": True})

    app = Starlette(
        routes=[
            Route("/api/live/health", health, methods=["GET"]),
            Route("/api/live/sessions", create_session, methods=["POST"]),
            Route(
                "/api/live/sessions/{session_id}/snapshot",
                snapshot,
                methods=["POST"],
            ),
            Route(
                "/api/live/sessions/{session_id}",
                delete_session,
                methods=["DELETE"],
            ),
        ]
    )
    app.state.vision_adapter = adapter
    app.state.session_store = sessions
    return app


app = create_app()
