from __future__ import annotations

import asyncio
import base64
import binascii
import time
from pathlib import Path
from uuid import uuid4

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from .config import LiveConfig
from .errors import error_response, json_response
from .guidance import DeterministicGuidanceProvider
from .mock_vision import MockVision
from .orchestrator import CoachOrchestrator
from .sessions import InMemorySessionStore, InvalidSessionTransition
from .sop import SopDecision, SopEngine
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


def create_app(*, vision_adapter=None, session_store=None, vision_health_timeout_seconds=None, max_image_bytes=None, dev_mode=None) -> Starlette:
    config = LiveConfig.from_environment()
    adapter = vision_adapter or VisionAdapter(config.yolo_base_url, timeout_seconds=config.vision_request_timeout_seconds)
    sessions = session_store or InMemorySessionStore()
    development = config.dev_mode if dev_mode is None else bool(dev_mode)
    orchestrator = CoachOrchestrator(sessions, SopEngine(), DeterministicGuidanceProvider())
    mock_vision = MockVision()
    health_timeout = config.vision_health_timeout_seconds if vision_health_timeout_seconds is None else vision_health_timeout_seconds
    image_limit = config.max_image_bytes if max_image_bytes is None else max_image_bytes

    async def health(_request):
        try:
            vision_online = bool(await asyncio.wait_for(adapter.health(), timeout=health_timeout))
        except (TimeoutError, OSError, ValueError):
            vision_online = False
        return json_response({"status": "online" if vision_online else "degraded", "components": {"live_backend": "online", "vision": "online" if vision_online else "offline"}})

    async def create_session(request):
        try: payload = await request.json()
        except (ValueError, UnicodeDecodeError): return error_response("invalid_json", "Request body must be a JSON object.", 400)
        if not isinstance(payload, dict): return error_response("invalid_json", "Request body must be a JSON object.", 400)
        forbidden = {"student_id", "teacher", "course_permission", "pass"}.intersection(payload)
        if forbidden: return error_response("untrusted_field", "Demo sessions do not accept identity, permission, or result fields.", 400)
        if payload.get("mode", "demo") != "demo": return error_response("unsupported_mode", "Phase 2 supports demo mode only.", 400)
        source = str(payload.get("vision_source", "REAL_VISION"))
        if source not in {"REAL_VISION", "MOCK_VISION"}: return error_response("invalid_vision_source", "Unknown vision source.", 400)
        if source == "MOCK_VISION" and not development: return error_response("dev_only", "Mock Vision is disabled.", 404)
        created = sessions.create(vision_source=source).as_dict()
        created["dev_mode"] = development
        return json_response(created, status_code=201)

    async def get_session(request):
        session = sessions.get(request.path_params["session_id"])
        if session is None: return error_response("session_not_found", "Live session was not found.", 404)
        step = sessions.current_step(session.session_id) if session.state != "TASK_COMPLETED" else None
        payload = session.as_dict()
        payload["course_title"] = sessions.course.title
        payload["task_title"] = sessions.task.title
        payload["step"] = None if step is None else {"step_id": step.step_id, "title": step.title, "instruction": step.instruction, "expected_classes": list(step.expected_classes)}
        payload["progress"] = {"current": session._step_index + 1, "total": len(sessions.task.steps)}
        return json_response(payload)

    async def snapshot(request):
        sid = request.path_params["session_id"]
        session = sessions.get(sid)
        if session is None: return error_response("session_not_found", "Live session was not found.", 404)
        try: payload = await request.json()
        except (ValueError, UnicodeDecodeError): return error_response("invalid_json", "Request body must be a JSON object.", 400)
        if not isinstance(payload, dict): return error_response("invalid_json", "Request body must be a JSON object.", 400)
        _decoded, image_error = _decode_image_data(payload.get("image_data"), image_limit)
        if image_error == "invalid_image": return error_response("invalid_image", "A valid base64 image data URL is required.", 400)
        if image_error == "image_too_large": return error_response("image_too_large", "The snapshot exceeds the Phase 1A size limit.", 413)
        frame_id = str(payload.get("frame_id") or uuid4())
        if len(frame_id) > 100: return error_response("invalid_frame_id", "Frame ID is too long.", 400)
        file_name = str(payload.get("file_name") or "live-snapshot.jpg")
        if len(file_name) > 255: return error_response("invalid_file_name", "File name is too long.", 400)
        try: confidence = float(payload.get("confidence", 0.25))
        except (TypeError, ValueError): return error_response("invalid_confidence", "Confidence must be between 0 and 1.", 400)
        if not 0 <= confidence <= 1: return error_response("invalid_confidence", "Confidence must be between 0 and 1.", 400)
        started = time.perf_counter()
        try: result = await adapter.detect(payload["image_data"], file_name, confidence)
        except VisionUnavailable: return error_response("vision_offline", "Vision service is currently unavailable.", 503)
        except VisionResponseError: return error_response("vision_invalid_response", "Vision service returned an invalid response.", 502)
        metrics = {"vision_upstream_ms": result.upstream_ms, **(result.timings or {}), "backend_ms": round((time.perf_counter() - started) * 1000, 1)}
        response = orchestrator.process(sid, result.detections, frame_id, "REAL_VISION", metrics)
        response["session_id"] = sid
        response["frame_id"] = frame_id
        return json_response(response)

    async def simulate(request):
        if not development: return error_response("dev_only", "Mock Vision is disabled.", 404)
        sid = request.path_params["session_id"]
        session = sessions.get(sid)
        if session is None: return error_response("session_not_found", "Live session was not found.", 404)
        try: payload = await request.json()
        except (ValueError, UnicodeDecodeError): return error_response("invalid_json", "Request body must be a JSON object.", 400)
        frame_id = str(payload.get("frame_id") or uuid4())
        try: detections = mock_vision.scenario(str(payload.get("scenario")), frame_id)
        except ValueError: return error_response("invalid_scenario", "Unsupported Mock Vision scenario.", 400)
        return json_response(orchestrator.process(sid, detections, frame_id, "MOCK_VISION", {"mock": True}))

    async def confirm(request):
        sid = request.path_params["session_id"]
        try: session = sessions.confirm(sid)
        except KeyError: return error_response("session_not_found", "Live session was not found.", 404)
        except InvalidSessionTransition: return error_response("invalid_transition", "PASS_CANDIDATE is required.", 409)
        status = "TASK_COMPLETED" if session.state == "TASK_COMPLETED" else "STEP_COMPLETED"
        decision = SopDecision(status, None, (session.expected_class,), session.last_detection, session.last_confidence, session.pass_candidate_count, 1, None)
        message = DeterministicGuidanceProvider().get_guidance(session.as_dict(), decision, None)
        return json_response({"session": session.as_dict(), "guidance": message.as_dict()})

    async def events(request):
        try: values = sessions.events(request.path_params["session_id"])
        except KeyError: return error_response("session_not_found", "Live session was not found.", 404)
        return json_response({"events": values})


    async def camera_started(request):
        try: event = sessions.append_event(request.path_params["session_id"], "CAMERA_STARTED")
        except KeyError: return error_response("session_not_found", "Live session was not found.", 404)
        return json_response({"event": event})

    async def auto_started(request):
        try: event = sessions.append_event(request.path_params["session_id"], "AUTO_OBSERVATION_STARTED")
        except KeyError: return error_response("session_not_found", "Live session was not found.", 404)
        return json_response({"event": event})

    async def auto_stopped(request):
        try: event = sessions.append_event(request.path_params["session_id"], "AUTO_OBSERVATION_STOPPED")
        except KeyError: return error_response("session_not_found", "Live session was not found.", 404)
        return json_response({"event": event})

    async def delete_session(request):
        if not sessions.delete(request.path_params["session_id"]): return error_response("session_not_found", "Live session was not found.", 404)
        return json_response({"deleted": True})

    routes = [
        Route("/api/live/health", health, methods=["GET"]),
        Route("/api/live/sessions", create_session, methods=["POST"]),
        Route("/api/live/sessions/{session_id}", get_session, methods=["GET"]),
        Route("/api/live/sessions/{session_id}/snapshot", snapshot, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/confirm", confirm, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/events", events, methods=["GET"]),
        Route("/api/live/sessions/{session_id}/simulate", simulate, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/camera/start", camera_started, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/auto/start", auto_started, methods=["POST"]),
        Route("/api/live/sessions/{session_id}/auto/stop", auto_stopped, methods=["POST"]),
        Route("/api/live/sessions/{session_id}", delete_session, methods=["DELETE"]),
        Mount("/live", app=StaticFiles(directory=str(Path(__file__).resolve().parents[2] / "live"), html=True), name="live"),
    ]
    app = Starlette(routes=routes)
    app.state.vision_adapter = adapter
    app.state.session_store = sessions
    app.state.dev_mode = development
    return app


app = create_app()
