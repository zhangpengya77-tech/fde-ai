# 02 Interface Contract

The complete HTTP/WebSocket contract is in [GATEWAY_API_CONTRACT.md](GATEWAY_API_CONTRACT.md).

Contract invariants:

1. `FlightEngine` owns state snapshots and exposes fidelity labels.
2. Gateway binds loopback only and checks a per-run local token for browser writes.
3. Control writes are whitelisted, validated, rate-limited and state-machine-gated.
4. Real and mock telemetry are labelled differently; a mock cannot identify as ArduPilot SITL.
5. The future MAVLink adapter is downstream of the command gate and cannot bypass it.
