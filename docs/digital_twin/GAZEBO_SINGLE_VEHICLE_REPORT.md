# Gazebo Single Vehicle Report — P4-B

Date: 2026-11-10. Scope: a **local-only**, headless, single Iris quadcopter simulation. No physical flight controller, USB radio, real MAVLink endpoint, QGC runtime, or public network endpoint was used.

## Result

**PASS — official Gazebo Harmonic + official ArduPilot Gazebo plugin + ArduCopter SITL closed loop.**

| Check | Result | Evidence |
| --- | --- | --- |
| Gazebo server-only Iris world | PASS | `/world/iris_runway/*`, IMU, NavSat, camera and four rotor-force topics were enumerated. |
| Official plugin build | PASS | Four official plugin libraries built on E:. |
| SITL connection | PASS | ArduCopter logged JSON receipt from `127.0.0.1:9002`. |
| HEARTBEAT and six telemetry classes | PASS | ATTITUDE, GLOBAL/LOCAL position, SYS_STATUS, BATTERY_STATUS and VFR_HUD received. |
| Arm and 2 m takeoff | PASS | ARM and TAKEOFF ACKs were ACCEPTED; peak relative altitude `2.00 m`. |
| Hover and land | PASS | Held near `2.00 m`; LAND ended at `0.44 m`, inside this test's `0.45 m` ground threshold. |
| Process and port cleanup | PASS | Owned processes stopped; ports 9002 and 5760 released. |

## Tested stack

- Ubuntu 22.04 Jammy in `FDE-DT-Ubuntu` WSL2.
- `gz sim 8.15.0`, `gz-harmonic 1.0.0-1~jammy`.
- `ArduPilot/ardupilot_gazebo` commit `f116b03552d05c8d0b0bed5ed67033a1183121d1`, LGPL-3.0.
- Existing ArduCopter SITL `Copter-4.7.2 (fb77356789)`.
- Official `iris_runway.sdf`: Iris is **not** an FDE F450 calibration claim.

## Evidence

- `D:\FDE-DT\logs\gazebo-sitl-mavlink-stream-20261110.json`
- `D:\FDE-DT\logs\gazebo-sitl-guided-flight-rerun-20261110.json`
- `D:\FDE-DT\logs\gz-iris-headless-restart-20261110.log`
- `D:\FDE-DT\logs\arducopter-gazebo-iris-launch-20261110.log`

## Limitations

Horizontal movement, RTL, wind disturbance, collision-specific assertions, browser-rendered Gazebo telemetry, QGC mission upload, and physical RadioMaster acceptance remain incomplete. Headless WSL performance was variable; see `RESOURCE_BENCHMARK.md`.
