from __future__ import annotations

import asyncio

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.routing import Route

from .config import LiveConfig
from .errors import json_response


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

    app = Starlette(routes=[Route("/api/live/health", health, methods=["GET"])])
    app.state.vision_adapter = adapter
    app.state.session_store = session_store
    return app


app = create_app()
