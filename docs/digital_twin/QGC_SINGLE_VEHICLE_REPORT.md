# QGC Single Vehicle Report — P4-D

## Discovery

- An HQGroundControl portable installation exists at `D:\FDE-AI-UAS\HQGC-STANDALONE\v2.3.0-LocalTest5\bin\HQGroundControl.exe`.
- A separate QGC development directory exists at `D:\FDE-AI-UAS\QGC-DEV` and is protected from this worktree.
- The FDE-DT gateway restricts current simulation MAVLink endpoints to loopback ports 8210–8219 and does not expose a LAN/serial bridge.

## Status

**Architecture prepared; QGC connection NOT RUN.** No QGC/HQGC process was started and no waypoint, mission upload, AUTO, RTL or log test was executed in this phase.

## Minimum future training entry

1. Start an isolated FDE-DT session.
2. Attach a dedicated, loopback-only MAVLink observer endpoint approved by the gateway safety allowlist.
3. Connect a separate QGC training instance to that endpoint.
4. Verify telemetry before any mission upload.
5. Test one simulated waypoint mission, execution, RTL and log capture.

This must use open QGC interfaces only; no HyperQGC code may be copied without a verified license.
