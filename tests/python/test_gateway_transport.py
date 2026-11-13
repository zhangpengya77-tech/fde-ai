"""Loopback transport tests; these do not require ArduPilot or Gazebo."""

from __future__ import annotations

import asyncio
import importlib.util
import json
from pathlib import Path
import unittest
from urllib.request import Request, urlopen

import websockets


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "fde_dt_gateway", ROOT / "tools" / "fde_dt_gateway.py"
)
assert SPEC and SPEC.loader
gateway = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gateway)


def request_json(url: str, method: str = "GET", token: str | None = None) -> tuple[int, dict[str, object]]:
    headers = {"X-FDE-DT-Token": token} if token else {}
    req = Request(url, method=method, headers=headers)
    with urlopen(req, timeout=2) as response:  # nosec B310 - loopback test URL
        body = response.read()
        return response.status, json.loads(body) if body else {}


async def read_ws(url: str) -> tuple[dict[str, object], dict[str, object]]:
    async with websockets.connect(url, open_timeout=2) as ws:
        status = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
        await ws.send(json.dumps({"v": 1, "type": "cmd", "name": "arm", "args": {}}))
        ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
        return status, ack


class GatewayTransportTests(unittest.TestCase):
    def test_local_runtime_issues_a_loopback_session_and_never_claims_sitl(self) -> None:
        with gateway.GatewayRuntime(token="dev-token", http_port=0, ws_port=0) as runtime:
            status, health = request_json(f"{runtime.http_base}/healthz")
            self.assertEqual(status, 200)
            self.assertEqual(health["bind_host"], "127.0.0.1")
            self.assertEqual(health["adapter"], "mock_mavlink_adapter")
            self.assertEqual(health["firmware_version"], "not_connected")

            status, session = request_json(f"{runtime.http_base}/api/v1/sessions", method="POST", token="dev-token")
            self.assertEqual(status, 201)
            ws_url = str(session["ws_url"])
            self.assertTrue(ws_url.startswith("ws://127.0.0.1:"))
            message, ack = asyncio.run(read_ws(ws_url + "?token=dev-token"))
            self.assertEqual(message["type"], "status")
            self.assertEqual(message["state"], "ready")
            self.assertEqual(message["firmware_version"], "not_connected")
            self.assertEqual(ack, {"v": 1, "type": "ack", "result": "accepted"})

            status, _ = request_json(f"{runtime.http_base}/api/v1/sessions/{session['session_id']}", method="DELETE", token="dev-token")
            self.assertEqual(status, 204)


if __name__ == "__main__":
    unittest.main()
