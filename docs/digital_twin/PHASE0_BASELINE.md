# FDE-AI Flight Digital Twin — Phase 0 Baseline

Date: 2026-11-10  
Worktree: `D:\FDE-REA-Exam-Sim` / `feat/physics-pro`  
Base commit: `569122efc3b8893865bfdbf44ac159940112a084`

## Protected baseline

| Area | State | Protection |
| --- | --- | --- |
| WEB LITE exam simulator | Existing, working browser physics | Must remain selectable and unchanged in behavior |
| USB/Gamepad, keyboard, phone input | Existing adapters | Reused only through `PilotInputPipeline` |
| CourseRunner and scoring | Existing teaching evaluation | Physics Pro supplies state; it does not rewrite course rules |
| Existing Physics Pro draft | Uncommitted `engine.ts`, `sitl-client.ts`, UI changes and tests | Preserved; no destructive replacement |
| Production services and learner data | Outside this worktree | Out of scope; no deployment, database write, merge, or push |

## Reality labels

- `WEB LITE`: browser simplified physics, never presented as high-fidelity or SITL telemetry.
- `PHYSICS PRO`: only labelled `ardupilot_sitl` after a local gateway reports an identified SITL instance.
- Gateway mock/contract tests are not an ArduPilot or Gazebo pass.

## Environment snapshot

- Windows host with WSL2; the existing FDE-DT service is hosted in `FDE-DT-Ubuntu` and was started only for the isolated test.
- C drive has limited free capacity; D drive has roughly 33 GiB free.
- Existing ArduPilot SITL is available through the separate `D:\FDE-DT\fde-flight-twin` service. Gazebo is not installed or claimed.
- All gateway network defaults are loopback only.

## Rulings

1. Reuse the existing FDE-DT local command gate; keep the small Python gateway only as a contract-test prototype, not as a competing production service.
2. Start with ArduPilot SITL for the F450 teaching route. PX4 remains a later compatibility target because Prometheus is PX4-oriented.
3. Do not copy Prometheus or HyperQGC code until each source and its distribution terms have a specific approval record.

## Rollback

Remove only the newly introduced `docs/digital_twin/`, `tools/fde_dt_gateway.py`, and `tests/python/` files from this worktree after review. Do not reset, clean, or alter pre-existing uncommitted work.
