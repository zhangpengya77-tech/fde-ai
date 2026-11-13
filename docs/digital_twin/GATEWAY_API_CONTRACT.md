# FDE-DT Gateway API Contract

## Security boundary

- Bind host: `127.0.0.1` only.
- Allowed simulated MAVLink endpoint form: `udp:127.0.0.1:<port>` only.
- Serial devices, LAN addresses, broadcast addresses and real-aircraft bridges are unsupported and rejected.
- Browser writes require `X-FDE-DT-Token`.
- One session owns one simulated vehicle.

## HTTP (existing FDE-DT implementation)

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/v1/health` | GET | local service health and labels; no secrets |
| `/api/v1/sessions` | POST | allocate a local simulated session and return session ID / WS URL |
| `/api/v1/sessions/{id}` | DELETE | release a local session |

## WebSocket (existing FDE-DT implementation)

The service listens for WebSocket sessions on `127.0.0.1:8201/session/{id}`. Telemetry messages use `type: "telemetry"`, ENU position/velocity, attitude, heading, armed state, mode, battery, labels and simulation time. Browser writes are limited to:

- `rc`: normalized roll/pitch/yaw [-1,1], throttle [0,1], rate-limited;
- `cmd/arm`, `cmd/disarm`, `cmd/takeoff`, `cmd/land`;
- `cmd/set_mode`: only `LOITER`, `ALT_HOLD`, `RTL`;
- `cmd/set_wind` and `cmd/inject_fault` for explicitly marked simulation exercises.

`GUIDED`, arbitrary MAVLink packets, parameter writes, mission upload and raw serial forwarding are out of scope.
