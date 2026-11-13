# 03 Safety and Isolation

## Network and device isolation

- Gateway: `127.0.0.1` only.
- Simulated endpoint: `udp:127.0.0.1:<port>` only.
- Real serial devices, LAN/broadcast MAVLink, raw MAVLink forwarding and public tunnels are prohibited.
- A browser disconnect is expected to expire/release its session; a future SITL adapter must remove RC override on timeout.

## Control safety

- Command whitelist: arm, disarm, takeoff, land, LOITER, ALT_HOLD, RTL, test wind/fault injection.
- `takeoff` requires a locally armed simulated session.
- RC channels are normalized and rate-limited.
- Mission upload, parameter write, arbitrary mode and direct actuator control are excluded.

## Operational boundary

No real hardware test, firmware parameter change, vehicle arm or physical flight is authorized by this development phase.
