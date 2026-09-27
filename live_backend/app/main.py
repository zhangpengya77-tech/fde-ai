from __future__ import annotations

import asyncio

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.routing import Route

from .config import LiveConfig
from .errors import error_response, json_response
from .sessions import InMemorySessionStore


class UnavailableVisionAdapter:
    async def health(self) -> bool:
        return False


def create_app(
    *,
    vision_adapter=None,
    session_store=None,
    vision_health_timeout_seconds: float | None = None,
) -> Starlette:
    config = LiveConfig.from_environment()
    adapter = vision_adapter or UnavailableVisionAdapter()
    sessions = session_store or InMemorySessionStore()
    health_timeout = (
        config.vision_health_timeout_seconds
        if vision_health_timeout_seconds is None
        else vision_health_timeout_seconds
    )

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

    async def delete_session(request: Request):
        if not sessions.delete(request.path_params["session_id"]):
            return error_response("session_not_found", "Live session was not found.", 404)
        return json_response({"deleted": True})

    app = Starlette(
        routes=[
            Route("/api/live/health", health, methods=["GET"]),
            Route("/api/live/sessions", create_session, methods=["POST"]),
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
