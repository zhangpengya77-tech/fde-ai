# Codex -> WorkBuddy Phase 1 MVP Handoff

## 1. Current Scope

Continue the existing standalone project at:

`D:\FDE-Power-Inspection-Simulator`

The product is a browser-based Chinese teaching simulator for F450 power-line inspection. The Phase 1 MVP must prove one complete classroom loop:

Teacher/student opens the site -> F450 appears -> keyboard or real USB controller operates the aircraft -> takeoff -> fly to one transmission-tower inspection target -> maintain safe distance -> aim the gimbal -> take a photo -> validate photo quality -> clearly labeled Mock AI returns a defect result -> complete mission -> land -> generate score and mission record -> teacher can review the record.

Do not expand to three scenes, real YOLO, ROS, PX4, Gazebo, ArduPilot WASM, cloud accounts, or backend services before this loop passes.

## 2. Binding Design And Plan

Read these files before editing:

- `docs/superpowers/specs/2026-10-16-power-inspection-simulator-v1-design.md`
- `docs/superpowers/plans/2026-10-16-phase-1-mvp.md`

The approved architecture is fixed:

- Vite + TypeScript + Three.js
- SimpleFlightController behind FlightControllerAdapter
- IndexedDB local persistence
- Vitest + Playwright
- offline-first local browser application
- no React unless the approved design is formally changed

The controller architecture is a primary product requirement, not optional polish:

Keyboard / Touch / USB Joystick / Gamepad / RadioMaster EdgeTX USB Joystick / RadioLink AT9S Simulator Dongle / future DJI FPV Remote Controller 3 / future CRSF-ELRS bridge

-> `PilotInputAdapter`

-> `InputNormalizer`

-> `ChannelMapper`

-> `SimpleFlightController`

-> F450 simulation

The flight core must never bind directly to one controller brand.

## 3. Git State

- Branch: `phase1-mvp`
- HEAD: `604c251 feat: establish power inspection simulator skeleton`
- Working tree: DIRTY by design; P1-2 is in progress.
- Do not reset, clean, stash, checkout, or overwrite the uncommitted P1-2 files.
- No push or merge has been performed.

Run first:

```powershell
git status --short
git branch --show-current
git log -3 --oneline
```

Treat all current uncommitted paths listed below as Codex work to preserve and finish.

## 4. Completed

### P1-1 Project Skeleton

Committed in `604c251`:

- Vite + TypeScript + Three.js project shell
- Chinese desktop/mobile teaching layout
- Vitest and Playwright setup
- README, architecture, license and acceptance documents
- P1-1 desktop/mobile screenshots
- production build

Verified before commit:

- Vitest: 2/2 PASS
- Playwright desktop/mobile shell: 2/2 PASS
- `npm run build`: PASS

### P1-2 Implemented But Not Yet Committed

Current uncommitted implementation:

- `src/flight/types.ts`
- `src/flight/FlightControllerAdapter.ts`
- `src/flight/adapters/SimpleFlightController.ts`
- `src/drone/create-programmatic-f450.ts`
- `src/drone/load-f450.ts`
- `src/input/adapters/KeyboardInputAdapter.ts`
- `src/app/create-app.ts`
- `tests/unit/simple-flight-controller.test.ts`
- `tests/browser/flight.spec.ts`
- `screenshots/p1-2-flight-desktop-chrome.png`

Implemented behavior:

- standard programmatic X-frame F450 with four arms, motors and flat propellers
- center plates, Pixhawk, GPS, battery, gimbal/camera and landing skids
- propeller animation and chase camera
- arm/disarm, takeoff, hover, movement, yaw, altitude, land, RTL, pause/resume and emergency-stop controller contract
- keyboard adapter: W/S pitch, A/D roll, Q/E yaw, R/F throttle
- live height, speed, heading and mode telemetry
- browser flight test covering takeoff, movement, hover and safe landing

Verified in this round:

- `npm test -- tests/unit/simple-flight-controller.test.ts`: 4/4 PASS
- `npm run build`: PASS (12 modules)
- `npm run test:browser -- tests/browser/flight.spec.ts --project=desktop-chrome`: 1/1 PASS
- desktop screenshot visually inspected: F450 visible, standard X layout, no blank canvas or incoherent overlap

The subsequent combined full-suite run did not produce a reliable final result because the test runners were launched concurrently and their child-process output stalled. Codex terminated that diagnostic. Do not report the full suite as PASS until it is rerun sequentially.

## 5. Asset Decision

Candidate model inspected read-only:

`D:\FDE-Blender-MCP\F450-Interactive\public\models\F450_Assembly.glb`

- Size: 4,501,048 bytes
- SHA-256: `F9BFB9455C769FB2C6BEB76413BB0A8FEC4BD12A335133EABD66CDEE09FF035C`

No clear model-asset source/license statement was found in that source project. Therefore it has NOT been copied into this new project. The current programmatic F450 is the compliant fallback allowed by the approved design.

Do not copy that GLB unless provenance and reuse permission are confirmed and recorded in `THIRD_PARTY_NOTICES.md`.

## 6. Exact Next Actions

### NEXT ACTION 1 - Finish P1-2 Safely

1. Inspect the current diff; do not rewrite it from scratch.
2. Run sequentially, not concurrently:

```powershell
npm test
npm run test:browser
npm run build
```

3. Fix only real failures using failing tests first.
4. Inspect desktop and mobile screenshots.
5. Update the P1-2 checkboxes and evidence in the implementation plan, `TEST_REPORT.md`, and `acceptance-report.md`.
6. Commit P1-2 only after all named checks pass.

Suggested commit message:

`feat: add keyboard-controlled F450 flight`

### NEXT ACTION 2 - P1-3 Real Remote Controller Input (Highest Priority)

The MVP is primarily intended to be flown with a real remote controller through Windows USB HID/Gamepad API. Keyboard remains fallback only.

Implement with TDD:

- `PilotInputAdapter` interface
- browser Gamepad API device discovery/connect/disconnect
- normalized Roll/Pitch/Yaw/Throttle channels
- live CH1-CHn monitor
- per-channel Min/Center/Max calibration
- reverse switch
- deadzone
- channel mapping
- persistent Device Profile in IndexedDB/local storage as planned
- profile import/export only if already in the approved plan
- clear unsupported-device and disconnected states
- keyboard fallback through the same normalized control contract

Validate at least one real USB joystick or RadioMaster/EdgeTX USB Joystick when hardware is available. If no physical controller is connected, automated Gamepad API tests may verify the adapter, but label real hardware acceptance `PENDING_MANUAL`; never call mocked Gamepad data a real controller PASS.

RadioLink AT9S simulator dongle, DJI FPV Remote Controller 3 and future CRSF/ELRS bridge remain compatibility boundaries. Do not add brand-specific code to the flight core.

### NEXT ACTION 3 - P1-4 Through P1-7

Proceed one phase at a time only after the previous phase passes:

- P1-4: one minimal transmission-line scene, one tower target, one defect point, safe-distance rule
- P1-5: complete inspection loop, gimbal/photo/projection quality check, visibly labeled Mock AI
- P1-6: teaching score and control/path telemetry
- P1-7: IndexedDB session persistence and teacher-readable Student Mission Report

Do not start the distribution-line and substation scenes until the one-scene loop passes end to end.

## 7. Quality And Safety Rules

- Test every module immediately; do not defer all testing to the end.
- Use failing tests before behavior changes.
- Keep the Three.js scene full-bleed and stable at desktop/mobile sizes.
- Verify canvas pixels are nonblank and the F450 remains framed.
- Target ordinary teaching laptops and 30 FPS at 1920x1080.
- Every third-party asset/code source must have a recorded license.
- Mock AI must be visibly labeled `模拟 AI / 非真实视觉模型`.
- Do not modify any existing FDE-AI-UAS, F450, Mission Planner or HQGroundControl project.
- Do not download unlicensed or unknown 3D assets.
- Do not add cloud, account, Docker, ROS, PX4, Gazebo or real YOLO scope.
- Do not claim real Safari/physical-controller acceptance without real hardware testing.

## 8. Required Final Phase 1 Evidence

The Phase 1 MVP is not complete until a real browser demonstration proves:

1. Site opens without critical console errors.
2. F450 is visible and correctly framed.
3. Keyboard works and one real USB controller is tested when available.
4. Takeoff, hover, directional flight, yaw, altitude and landing work.
5. One transmission inspection target can be approached safely.
6. Gimbal can be aimed and a photo captured.
7. Photo validity is calculated, not hard-coded.
8. Mock AI is clearly disclosed.
9. Mission completion, safety events, score and report are generated.
10. Teacher can reopen the saved mission record.

Keep desktop/mobile screenshots and exact test counts for each phase.

## 9. Handoff Status

- P1-1: COMPLETE
- P1-2: IMPLEMENTED / TARGETED TESTS PASS / FULL SEQUENTIAL REGRESSION AND COMMIT PENDING
- P1-3: NOT STARTED; next major priority
- P1-4: NOT STARTED
- P1-5: NOT STARTED
- P1-6: NOT STARTED
- P1-7: NOT STARTED

Continue from the current uncommitted P1-2 state. Do not restart the project or redesign the architecture.
