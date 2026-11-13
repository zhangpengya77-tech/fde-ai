"""FDE-DT localhost-only command gate.

This module is deliberately transport- and firmware-neutral.  It validates
browser control intent before a future ArduPilot adapter receives anything.
No configuration path can select a serial device or a non-loopback MAVLink
endpoint; a real-aircraft bridge is outside this project and not implemented.
"""

from __future__ import annotations

from enum import Enum
import asyncio
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from secrets import token_urlsafe
from threading import Event, Thread
from time import monotonic
from typing import Mapping
from urllib.parse import parse_qs, urlparse

import websockets


class CommandResult(str, Enum):
    ACCEPTED = "accepted"
    UNAUTHORIZED = "unauthorized"
    NOT_FOUND = "not_found"
    INVALID_STATE = "invalid_state"
    REJECTED = "rejected"
    RATE_LIMITED = "rate_limited"


class GatewayConfig:
    """Immutable-at-startup boundary configuration for one simulated vehicle."""

    def __init__(
        self,
        bind_host: str = "127.0.0.1",
        sitl_endpoint: str = "udp:127.0.0.1:14550",
        system_id: int = 1,
        component_id: int = 1,
        allow_real_vehicle: bool = False,
    ) -> None:
        if bind_host != "127.0.0.1":
            raise ValueError("gateway may only bind to 127.0.0.1")
        if not sitl_endpoint.startswith("udp:127.0.0.1:"):
            raise ValueError("only loopback UDP SITL endpoints are allowed")
        if allow_real_vehicle:
            raise ValueError("real vehicle bridging is not implemented")
        self.bind_host = bind_host
        self.sitl_endpoint = sitl_endpoint
        self.system_id = system_id
        self.component_id = component_id
        self.allow_real_vehicle = False

    @classmethod
    def from_environment(cls, env: Mapping[str, str]) -> "GatewayConfig":
        # Do not offer an environment escape hatch for bind host or real devices.
        endpoint = env.get("FDE_DT_SITL_ENDPOINT", "udp:127.0.0.1:14550")
        return cls(
            sitl_endpoint=endpoint,
            system_id=int(env.get("FDE_DT_SYSTEM_ID", "1")),
            component_id=int(env.get("FDE_DT_COMPONENT_ID", "1")),
        )


class GatewaySession:
    def __init__(self, session_id: str, created_ms: int) -> None:
        self.session_id = session_id
        self.created_ms = created_ms
        self.phase = "created"
        self.last_command_ms = -10**12


class SessionRegistry:
    """Single-process session and command state machine.

    It is intentionally testable without SITL.  A later adapter may observe
    ACCEPTED results, but it must never bypass this registry.
    """

    _MODES = {"LOITER", "ALT_HOLD", "RTL"}

    def __init__(self, token: str, min_command_interval_ms: int = 50) -> None:
        if not token:
            raise ValueError("a non-empty local token is required")
        self._token = token
        self._interval = min_command_interval_ms
        self._sessions: dict[str, GatewaySession] = {}

    def create(self, now_ms: int | None = None) -> GatewaySession:
        now = self._now_ms() if now_ms is None else now_ms
        session = GatewaySession(token_urlsafe(18), now)
        self._sessions[session.session_id] = session
        return session

    def release(self, session_id: str, token: str) -> bool:
        if token != self._token or session_id not in self._sessions:
            return False
        del self._sessions[session_id]
        return True

    def command(
        self,
        session_id: str,
        token: str,
        name: str,
        args: Mapping[str, object],
        now_ms: int | None = None,
    ) -> CommandResult:
        if token != self._token:
            return CommandResult.UNAUTHORIZED
        session = self._sessions.get(session_id)
        if session is None:
            return CommandResult.NOT_FOUND
        now = self._now_ms() if now_ms is None else now_ms

        if name == "rc":
            if now - session.last_command_ms < self._interval:
                return CommandResult.RATE_LIMITED
            if not self._valid_rc(args):
                return CommandResult.REJECTED
            session.last_command_ms = now
            return CommandResult.ACCEPTED

        if name == "arm":
            if session.phase not in {"created", "landed"}:
                return CommandResult.INVALID_STATE
            session.phase = "armed"
            return CommandResult.ACCEPTED
        if name == "disarm":
            session.phase = "created"
            return CommandResult.ACCEPTED
        if name == "takeoff":
            altitude = args.get("altitude_m")
            if session.phase != "armed":
                return CommandResult.INVALID_STATE
            if not isinstance(altitude, (int, float)) or not 0.5 <= float(altitude) <= 20:
                return CommandResult.REJECTED
            session.phase = "flying"
            return CommandResult.ACCEPTED
        if name == "land":
            if session.phase != "flying":
                return CommandResult.INVALID_STATE
            session.phase = "landed"
            return CommandResult.ACCEPTED
        if name == "set_mode":
            return CommandResult.ACCEPTED if args.get("mode") in self._MODES else CommandResult.REJECTED
        if name in {"set_wind", "inject_fault"}:
            return CommandResult.ACCEPTED
        return CommandResult.REJECTED

    @staticmethod
    def _valid_rc(args: Mapping[str, object]) -> bool:
        values = [args.get(key) for key in ("roll", "pitch", "yaw", "throttle")]
        if not all(isinstance(value, (int, float)) for value in values):
            return False
        roll, pitch, yaw, throttle = (float(value) for value in values)
        return all(-1 <= value <= 1 for value in (roll, pitch, yaw)) and 0 <= throttle <= 1

    @staticmethod
    def _now_ms() -> int:
        return round(monotonic() * 1000)


class GatewayRuntime:
    """Small local-only HTTP/WebSocket runtime for contract and adapter tests.

    The runtime exposes a *mock MAVLink adapter* only. It never opens a serial
    port, discovers network peers, or claims to run ArduPilot. The same
    transport can later receive a verified local SITL adapter behind the
    `SessionRegistry` command gate.
    """

    def __init__(
        self,
        token: str,
        config: GatewayConfig | None = None,
        http_port: int = 8200,
        ws_port: int = 8201,
    ) -> None:
        self.config = config or GatewayConfig.from_environment({})
        self.registry = SessionRegistry(token)
        self._token = token
        self._http_port = http_port
        self._ws_port = ws_port
        self._http: ThreadingHTTPServer | None = None
        self._http_thread: Thread | None = None
        self._ws_thread: Thread | None = None
        self._ws_ready = Event()
        self._ws_stop: asyncio.Event | None = None
        self._ws_loop: asyncio.AbstractEventLoop | None = None
        self._ws_server: object | None = None
        self._ws_error: BaseException | None = None

    @property
    def http_base(self) -> str:
        if self._http is None:
            raise RuntimeError("gateway is not started")
        return f"http://127.0.0.1:{self._http.server_port}"

    @property
    def ws_base(self) -> str:
        return f"ws://127.0.0.1:{self._ws_port}"

    def __enter__(self) -> "GatewayRuntime":
        self.start()
        return self

    def __exit__(self, _type: object, _value: object, _traceback: object) -> None:
        self.stop()

    def start(self) -> None:
        if self._http is not None:
            return
        self._start_ws()
        if self._ws_error:
            raise RuntimeError("cannot start local WebSocket gateway") from self._ws_error
        runtime = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                if self.path != "/healthz":
                    self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                    return
                self._json(HTTPStatus.OK, {
                    "bind_host": runtime.config.bind_host,
                    "adapter": "mock_mavlink_adapter",
                    "firmware_version": "not_connected",
                    "system_id": runtime.config.system_id,
                    "component_id": runtime.config.component_id,
                })

            def do_POST(self) -> None:  # noqa: N802
                if self.path != "/api/v1/sessions":
                    self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                    return
                if self.headers.get("X-FDE-DT-Token") != runtime._token:
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                session = runtime.registry.create()
                self._json(HTTPStatus.CREATED, {
                    "session_id": session.session_id,
                    "ws_url": f"{runtime.ws_base}/session/{session.session_id}",
                    "simulator_type": "mock_mavlink_adapter",
                    "physics_model_version": "not_connected",
                    "firmware_version": "not_connected",
                })

            def do_DELETE(self) -> None:  # noqa: N802
                prefix = "/api/v1/sessions/"
                if not self.path.startswith(prefix):
                    self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                    return
                if not runtime.registry.release(self.path[len(prefix):], self.headers.get("X-FDE-DT-Token", "")):
                    self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                    return
                self.send_response(HTTPStatus.NO_CONTENT)
                self.end_headers()

            def log_message(self, _format: str, *_args: object) -> None:
                return

            def _json(self, status: HTTPStatus, payload: Mapping[str, object]) -> None:
                data = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self._http = ThreadingHTTPServer((self.config.bind_host, self._http_port), Handler)
        self._http_thread = Thread(target=self._http.serve_forever, name="fde-dt-http", daemon=True)
        self._http_thread.start()

    def stop(self) -> None:
        if self._http is not None:
            self._http.shutdown()
            self._http.server_close()
            self._http = None
        if self._http_thread is not None:
            self._http_thread.join(timeout=2)
            self._http_thread = None
        if self._ws_loop is not None and self._ws_stop is not None:
            self._ws_loop.call_soon_threadsafe(self._ws_stop.set)
        if self._ws_thread is not None:
            self._ws_thread.join(timeout=2)
            self._ws_thread = None
        self._ws_loop = None
        self._ws_stop = None
        self._ws_ready.clear()

    def _start_ws(self) -> None:
        self._ws_ready.clear()
        self._ws_error = None
        self._ws_thread = Thread(target=self._run_ws, name="fde-dt-ws", daemon=True)
        self._ws_thread.start()
        if not self._ws_ready.wait(timeout=3):
            raise RuntimeError("local WebSocket gateway did not start")

    def _run_ws(self) -> None:
        try:
            asyncio.run(self._serve_ws())
        except BaseException as exc:  # surfaced to start() without swallowing startup errors
            self._ws_error = exc
            self._ws_ready.set()

    async def _serve_ws(self) -> None:
        self._ws_loop = asyncio.get_running_loop()
        self._ws_stop = asyncio.Event()
        async with websockets.serve(self._handle_ws, self.config.bind_host, self._ws_port) as server:
            sockets = getattr(server, "sockets", [])
            if sockets:
                self._ws_port = int(sockets[0].getsockname()[1])
            self._ws_ready.set()
            await self._ws_stop.wait()

    async def _handle_ws(self, connection: object) -> None:
        request = getattr(connection, "request")
        parsed = urlparse(request.path)
        session_id = parsed.path.removeprefix("/session/")
        token = parse_qs(parsed.query).get("token", [""])[0]
        if token != self._token or not session_id:
            await connection.close(code=4401, reason="unauthorized")
            return
        await connection.send(json.dumps({
            "v": 1,
            "type": "status",
            "state": "ready",
            "simulator_type": "mock_mavlink_adapter",
            "physics_model_version": "not_connected",
            "firmware_version": "not_connected",
        }))
        async for raw in connection:
            try:
                message = json.loads(raw)
                if message.get("type") == "cmd":
                    result = self.registry.command(session_id, token, str(message.get("name", "")), message.get("args", {}))
                elif message.get("type") == "rc":
                    result = self.registry.command(session_id, token, "rc", message.get("ch", {}))
                else:
                    result = CommandResult.REJECTED
            except (TypeError, ValueError, json.JSONDecodeError):
                result = CommandResult.REJECTED
            await connection.send(json.dumps({"v": 1, "type": "ack", "result": result.value}))
