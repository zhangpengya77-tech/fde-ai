# P6-HQGC-3D-MULTI Compatibility Register

## Scope and isolation

This register records a future extension only.  It does not alter the Taiwan
exam subjects, scoring, learner records, the Web Lite engine, or any released
site.  All vehicle-control experiments remain localhost-only SITL/Gazebo
experiments.  HyperQGC private APIs are **unverified**; interoperability is
therefore limited to standard MAVLink until public protocol evidence exists.

## Current verified single-vehicle foundation

| Capability | Evidence/status |
| --- | --- |
| Gazebo physics | Harmonic 8.15.0, isolated G5 no-camera-sensor diagnostic scene |
| Autopilot | ArduCopter 4.7.2 SITL, isolated only |
| State transport | Gateway HTTP 127.0.0.1:8200, WebSocket 127.0.0.1:8201, MAVLink UDP 8210 |
| State authority | `telemetry_v2` source `gazebo_ardupilot_sitl`; no Web Lite state may overwrite it |
| Cold-start lifecycle | Five G5 runs: health, authenticated WebSocket hold, DELETE, and port cleanup recorded in `/home/fde/fde_p5i_rca7_clean_runs` |
| Camera limitation | Full camera-sensor Iris exit SIGSEGV remains a separate unresolved issue; G5 is diagnostic-only, not a camera fix |
| ROS 2 | `ros2` CLI was not found during the 2026-11-11 audit; ROS bridging is NOT IMPLEMENTED |
| RadioMaster | Gamepad/HID software path and SOP exist; Physics Pro hardware acceptance is PENDING_MANUAL |

## Adapter boundary (reserved, not implemented)

```text
GCS (QGC / Mission Planner / future HyperQGC / FDE web GCS)
  -> per-vehicle MAVLink adapter and authenticated route policy
  -> gateway vehicle registry
  -> one SITL + one Gazebo model per vehicle
  -> normalized telemetry_v2 to the FDE web 3D view
```

Each adapter entry must include `vehicle_id`, `system_id`, `component_id`,
source endpoint, command allow-list, session owner, telemetry freshness, and
an explicit `simulation_only` capability label.  A route must never infer a
target vehicle from UDP source port alone, and a simulator route must never
fall through to a real-flight endpoint.

## Future three-vehicle contract

Before any P6 runtime work, create a separate worktree and require a registry
whose primary key is `(simulation_instance_id, system_id, component_id)`.
Each vehicle then owns separate MAVLink ingress/egress ports, mission version
namespace, telemetry cache, timeout/watchdog state, 3D entity, and audit log.
Leader/follower behaviour belongs above the safety and routing layers; it must
not share control channels or permit broadcast control by default.

| Future phase | Acceptance gate |
| --- | --- |
| P6-A | Static registry and route-policy tests; no second SITL |
| P6-B | Three isolated SITLs with non-colliding SYSIDs and routing tests |
| P6-C | Three Gazebo entities, independent telemetry and cleanup tests |
| P6-D | Standard MAVLink interoperability observation with an authorized GCS; no private HyperQGC API assumption |
| P6-E | Training-only formation scenarios, separate from Taiwan exam scoring |

## Taiwan exam 3D upgrade path

The priority path remains single vehicle: first validate a dedicated,
versioned exam-field scene against the existing field coordinates and scoring
contracts; then map authoritative SITL/Gazebo telemetry into the existing web
3D renderer through the current engine boundary.  Field dimensions, F450
parameters, materials, wind, and collision values require source-backed
acceptance data.  No visual animation may be labelled as physics-pro state.

## Blockers and next safe steps

1. Preserve the five G5 lifecycle artifacts and keep the camera-sensor SIGSEGV
   investigation separate.
2. Perform a real-browser Three.js telemetry numerical-sync test before calling
   the web 3D authority integration complete.
3. Create a dedicated exam-field scene worktree before changing any existing
   Taiwan exam scene assets or scoring-adjacent code.
4. Obtain public HyperQGC protocol/licensing evidence before adding a
   HyperQGC-specific adapter.
5. Treat ROS 2 as a future optional bridge until an isolated installation and
   data-contract test are approved.
