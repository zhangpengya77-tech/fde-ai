"""Contract tests for the localhost-only Physics Pro gateway.

These tests deliberately use the gateway's in-process command validator: they
prove that a browser-facing control request can never select a real flight
endpoint and that unsafe transitions are rejected before any transport exists.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "fde_dt_gateway", ROOT / "tools" / "fde_dt_gateway.py"
)
assert SPEC and SPEC.loader
gateway = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gateway)


class GatewayContractTests(unittest.TestCase):
    def test_gateway_defaults_to_loopback_and_simulated_endpoint_only(self) -> None:
        config = gateway.GatewayConfig.from_environment({})

        self.assertEqual(config.bind_host, "127.0.0.1")
        self.assertTrue(config.sitl_endpoint.startswith("udp:127.0.0.1:"))
        self.assertFalse(config.allow_real_vehicle)


    def test_command_requires_matching_session_token_and_safe_transition(self) -> None:
        registry = gateway.SessionRegistry(token="dev-token")
        session = registry.create()

        self.assertEqual(registry.command(session.session_id, "wrong", "arm", {}), gateway.CommandResult.UNAUTHORIZED)
        self.assertEqual(registry.command(session.session_id, "dev-token", "takeoff", {"altitude_m": 1.5}), gateway.CommandResult.INVALID_STATE)
        self.assertEqual(registry.command(session.session_id, "dev-token", "arm", {}), gateway.CommandResult.ACCEPTED)
        self.assertEqual(registry.command(session.session_id, "dev-token", "takeoff", {"altitude_m": 1.5}), gateway.CommandResult.ACCEPTED)
        self.assertEqual(registry.command(session.session_id, "dev-token", "set_mode", {"mode": "GUIDED"}), gateway.CommandResult.REJECTED)


    def test_rc_is_rate_limited_and_rejected_after_session_close(self) -> None:
        registry = gateway.SessionRegistry(token="dev-token", min_command_interval_ms=50)
        session = registry.create(now_ms=100)

        self.assertEqual(registry.command(session.session_id, "dev-token", "rc", {"roll": 0, "pitch": 0, "yaw": 0, "throttle": 0.5}, now_ms=200), gateway.CommandResult.ACCEPTED)
        self.assertEqual(registry.command(session.session_id, "dev-token", "rc", {"roll": 0, "pitch": 0, "yaw": 0, "throttle": 0.5}, now_ms=210), gateway.CommandResult.RATE_LIMITED)
        self.assertTrue(registry.release(session.session_id, "dev-token"))
        self.assertEqual(registry.command(session.session_id, "dev-token", "arm", {}, now_ms=300), gateway.CommandResult.NOT_FOUND)


if __name__ == "__main__":
    unittest.main()
