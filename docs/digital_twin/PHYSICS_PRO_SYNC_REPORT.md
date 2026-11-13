# Physics Pro Synchronization Report — P4-C

## Existing browser contract (unchanged)

```text
Browser SitlEngine
  -> HTTP 127.0.0.1:8200 session API
  -> WebSocket 127.0.0.1:8201/session/{id}
  -> FDE-DT pymavlink gateway
  -> local ArduCopter SITL (System ID 251)
  -> ENU telemetry consumed by browser Three.js rendering
```

The existing gateway converts MAVLink NED data to ENU in `fde_twin/coords.py`; the browser must not consume raw MAVLink NED coordinates directly.

## Verified direct-SITL behavior

- Targeted Playwright real-SITL test passed: switch engine, create session, arm, keyboard climb above 1m, display firmware identity, release session.
- Gateway binds HTTP and WebSocket services to `127.0.0.1`.
- SITL MAVLink endpoints are loopback-whitelisted.

## Gazebo result and integration boundary

P4-B proved the official Gazebo Harmonic sensor/physics world drives one Iris instance through the official JSON link at `127.0.0.1:9002`; ArduCopter supplies MAVLink authority on `tcp:127.0.0.1:5760`.

The FDE-DT gateway is **not modified in this phase**: its current SITL manager owns a direct `--model quad` process and has no approved external-Gazebo registration path. Therefore Gazebo→ArduCopter telemetry/control is **PASS**, while browser→registered Gazebo-backed instance is **BLOCKED** pending a dedicated FDE-DT isolated worktree and API review. This avoids falsely labelling existing browser telemetry as Gazebo-authoritative.

## Required next implementation

1. Create an isolated FDE-DT worktree; preserve its current dirty tree.
2. Add explicit loopback-only simulator registration while preserving 8200/8201 contracts.
3. Test NED→ENU conversion, units, update age, disconnect stop and reconnect.
4. Label `Physics Pro / Gazebo-backed` only after registration succeeds.

WEB LITE scoring and control mappings remain unchanged; a flight-session authority switch requires restart, never a silent mid-flight change.
