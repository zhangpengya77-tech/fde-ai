# Codex to Claude Handoff — Physics Pro

## Preserved existing work

Existing uncommitted Physics Pro draft files were not replaced: `src/rea/app.ts`, `src/rea/rea.css`, `src/rea/session.ts`, `src/rea/engine.ts`, `src/rea/sitl-client.ts`, their tests and screenshot remain intact.

## Additive work in this increment

- Phase 0 baseline, architecture, gateway contract, setup and report documents.
- `tools/fde_dt_gateway.py`: localhost-only, token-validated command state machine with no serial/LAN path.
- `tests/python/test_gateway_contract.py`: standard-library test coverage for loopback configuration, authorization, state transitions and RC rate limiting.

## Important discovery: do not replace the existing gateway

The actual FDE-DT service already exists at `D:\FDE-DT\fde-flight-twin` (WSL source mounted at `/mnt/d/FDE-DT/fde-flight-twin`). It is an aiohttp + pymavlink gateway with its own authorization, session lifecycle, localhost HTTP `8200`, WebSocket `8201`, ArduPilot SITL lifecycle, and audit/log handling. `src/rea/sitl-client.ts` already targets this service.

`tools/fde_dt_gateway.py` is a small contract-test prototype only. It is **not** the gateway to deploy or extend ahead of the existing FDE-DT implementation.

## Evidence collected

- WSL `FDE-DT-Ubuntu` has an existing ArduCopter binary at `/home/fde/ardupilot/build/sitl/bin/arducopter`.
- Existing FDE-DT Python test suite: `29 passed in 0.15s`.
- Existing gateway E2E: `D:\FDE-DT\logs\codex-e2e-20261110.json` verifies unauthorized rejection, session isolation, telemetry, GUIDED arm/takeoff (~1.978m), RC watchdog release and teardown.
- Frontend real integration: `tests/browser/rea-physics-pro.spec.ts` passed 1/1 in 56.6s against a manually started loopback-only FDE-DT service.
- Full Vitest regression: 65 files / 855 tests passed; TypeScript/Vite build passed.
- Full generic Playwright: 156 passed / 12 skipped / 2 timing-sensitive RC calibration failures; the failing test passed immediately when isolated (see `WEB_LITE_REGRESSION.md`).

## Next safe tasks

1. Consolidate all future gateway changes in `D:\FDE-DT\fde-flight-twin`, after checking its existing dirty `fde_twin/server.py` change and creating an isolated worktree.
2. Keep the browser client contract in sync with that existing gateway; do not parallel-develop a second control service.
3. Create an isolated FDE-DT worktree before adding an explicit registered Gazebo-backed instance to its existing gateway. Gazebo and the official plugin are now installed and functionally tested; the browser gateway registration path is not.
4. Run the full generic WEB LITE browser suite before any merge or release.

## Do not claim yet

Real local ArduPilot SITL, MAVLink HEARTBEAT and the targeted browser integration have passed. Official Gazebo Harmonic plus ArduCopter SITL has now passed headless sensor/telemetry and arm/takeoff/hover/land validation. QGC task upload and physical RadioMaster Physics Pro remain unverified.

## P4 continuation status

- Gazebo installed: `gz sim 8.15.0`, Harmonic / `gz-sim8`; official `ardupilot_gazebo` commit `f116b03552d05c8d0b0bed5ed67033a1183121d1` built on E:.
- Official Iris headless world, IMU/GPS/camera topics, JSON link on loopback 9002, and ArduCopter `Copter-4.7.2` MAVLink on loopback 5760 are verified. Evidence: `D:\FDE-DT\logs\gazebo-sitl-guided-flight-rerun-20261110.json`.
- Browser gateway integration remains deliberately blocked until a dedicated FDE-DT worktree can safely add external simulator registration.
- Existing FDE-DT already owns the required authoritative SITL transport; do not rebuild FlightEngine, SitlEngine or Gateway.
- QGC/HQGC installations were discovered but not started. QGC MAVLink observer/mission testing requires a separately approved loopback observer endpoint.
- Full browser regression has two repeatable-under-load but isolated-pass RC calibration timing failures. Treat it as a separate RC test-harness task.

P4 evidence files: `GAZEBO_ENV_REPORT.md`, `GAZEBO_INSTALL_REPORT.md`, `GAZEBO_SINGLE_VEHICLE_REPORT.md`, `PHYSICS_PRO_SYNC_REPORT.md`, `RESOURCE_BENCHMARK.md`, `ROLLBACK_PLAN.md`, `QGC_SINGLE_VEHICLE_REPORT.md`, `RC_FLAKY_TEST_ANALYSIS.md`, and `P4_REGRESSION_REPORT.md`.
