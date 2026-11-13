# P5-J3 regression checkpoint

## 2026-11-11 update

- Gateway full pytest: **91 passed**.
- Frontend Vitest: **862 passed / 66 files**.
- TypeScript no-emit check: **PASS**.
- Real isolated Chrome Mission attach: **1 passed**; it is distinct from historical Guided evidence.
- Five independent Mission→Chrome→AUTO→RTL lifecycles: **NOT RUN** in this update; P5-J3 remains IN PROGRESS.
- Vite production build: **PASS** (2026-11-11); only the existing >500 kB Three.js chunk advisory was emitted.

## Acceptance gap discovered before five-run batch

The current real Chrome spec asserts attach identity, absence of Session POST/DELETE, fresh height and HUD/Three.js height agreement. It does **not** yet assert Three.js horizontal position, roll/pitch/yaw, `mission_current` / `mission_item_reached`, or RTL/Disarm state. The five-run batch is therefore deliberately not started: calling it a complete 3D mission acceptance would overstate the evidence. Add minimal telemetry-to-observable instrumentation and real-browser assertions first; retain the existing isolated Runner as the sole command owner.

## Executed this checkpoint

- Gateway full pytest: **83 passed** (`python3 -m pytest -q`, isolated Gateway worktree).
- Mission/Gateway focused regression before G5 run: **40 passed**.
- Real G5 Mission upload/readback: **PASS**, six stored items including explicit TAKEOFF.
- Real G5 ARM/AUTO/four-waypoint/RTL: **PASS**; see `P5_J3_AUTO_RTL_ACCEPTANCE.md`.

## Not rerun in this checkpoint

- Frontend Vitest historical baseline: 859 passed — **NOT RUN this checkpoint**.
- TypeScript/Vite build historical baseline: PASS — **NOT RUN this checkpoint**.
- Chrome AUTO/RTL trajectory: **BLOCKED**, not replaced by historical Guided Chrome result.
- New five-run P5-J3 mission lifecycle batch: **NOT RUN**; historic G5 no-camera cold-start 5/5 is not substituted.

No commit, push, merge, deploy, production change, or real-aircraft connection was performed.

## 2026-11-12 final regression

Status: **PASS**.

- Gateway full pytest: **97 passed**.
- Frontend Vitest: **864 passed / 66 files**.
- TypeScript no-emit: **PASS**.
- Vite production build: **PASS**; existing Three.js chunk-size advisory only.
- Real Windows Chrome evidence: baseline plus five independent current-session
  Mission lifecycles all passed; each has a separate `result.json` under
  `/home/fde/fde_p5j3_flight_runs/`.
- `git diff --check`: **PASS** in both isolated worktrees.
- Each final cold-start run released `8200/8201/8210/9002/5760/4173` and left
  no run-owned Gazebo or ArduPilot executable process.

The browser attach remains server-enforced read-only. Existing token, Origin,
session identity, mission verification and RC watchdog checks were not relaxed.
