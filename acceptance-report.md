# Acceptance Report

## Phase 1 MVP

Overall status: IN PROGRESS

| Stage | Status | Scope |
|---|---|---|
| P1-1 | PASS | Independent Vite/TypeScript/Three.js shell, responsive training UI, unit/browser test harness, license records |
| P1-2 | PASS | Programmatic F450 entity and keyboard flight with verified build, unit and browser evidence |
| P1-3 | PASS | Generic USB/Gamepad input, brand-neutral pipeline, calibration wizard and IndexedDB profile storage |
| P1-4 | PASS | First transmission-line inspection scene with a real SafetyDistanceEngine (tower/wire/target/obstacle distances + SAFE/WARNING/DANGER/COLLISION) |
| P1-5 | NOT STARTED | Inspection task loop and simulated AI |
| P1-6 | NOT STARTED | Teaching score and telemetry |
| P1-7 | NOT STARTED | Course records and teacher review |

P1-1 proves the independent offline-capable project shell only. It does not claim that the Phase 1 teaching loop is complete.

P1-2 passes with sequential verification: Vitest 6/6, Playwright 4/4 (desktop-chrome and mobile-chrome), production build 12 modules, and desktop/mobile screenshots showing the framed programmatic F450 with correct pre-takeoff, post-landing telemetry. P1-2 proves F450 rendering plus keyboard-controlled arm/takeoff/hover/translate/yaw/altitude/land only.

P1-3 passes with sequential verification: Vitest **78/78** across 8 files (including `input-normalizer`, `channel-mapper`, `gamepad-input-adapter`, `pilot-input-pipeline`, `profile-store`, `controller-calibration`), Playwright **8/8** across desktop-chrome and mobile-chrome (`gamepad.spec.ts` connect-and-fly + lost-link-hover, plus the P1-1/P1-2 specs which remain green), and a clean production build (20 modules). P1-3 proves a brand-neutral input pipeline (`PilotInputAdapter` → `InputNormalizer` → `ChannelMapper` → `PilotInputPipeline` → `SimpleFlightController`), a Mode 2 default profile, an on-first-use calibration wizard (live CH1–CH8 monitor, per-axis Min/Center/Max capture, reverse/deadzone/expo, IndexedDB persistence and JSON import/export), and the 250 ms lost-link → hover safety contract with throttle held. The flight core never learns a controller brand.

PENDING_DEVICE_TEST: real RadioMaster EdgeTX / RadioLink AT9S / DJI FPV RC3 / CRSF-ELRS hardware acceptance is recorded as a skipped `test.fixme` and is **not** claimed as PASS; the simulated Gamepad API only validates the wiring, wizard and lost-link fallback.

P1-4 passes with sequential verification: Vitest **116/116** across 10 files (the new `transmission-layout` 14 + `safety-engine` 24 on top of the P1-1/P1-2/P1-3 suites which stay green), Playwright **16 passed / 2 skipped** across desktop-chrome and mobile-chrome (the new `transmission-scene.spec.ts` CASE1–CASE4 plus the existing `shell`/`flight`/`gamepad` specs, all green; the only skips remain the `PENDING_DEVICE_TEST` fixme), and a clean production build (`tsc -b` clean; Vite **23 modules**). P1-4 proves the first inspection scene — ground, service road, two lattice towers, two sagging conductors, one obstacle tree, one inspection target and one programmatic teaching defect (a **missing insulator disc** on the right insulator string of tower 1, `MISSING_INSULATOR_DISC`) — and, crucially, a **real** `SafetyDistanceEngine` that computes the F450→tower, F450→nearest-wire and F450→target distances every frame, checks the inspection zone, and classifies the worst hazard as `SAFE` / `WARNING` / `DANGER` / `COLLISION`. The geometry and safety authority is Three.js-free (`src/scenes/SceneDefinition.ts`, `src/safety/SafetyEngine.ts`, `src/inspection/types.ts`) and consumes the brand-neutral input pipeline (`PilotInputPipeline` → `SimpleFlightController`) with keyboard and Gamepad fully preserved and not regressed. The HUD adds only the necessary teaching info (target, distance-to-target, distance-to-nearest-obstacle, colour-coded safety status, inspection-zone indicator, altitude, input device). The full trainee flow — takeoff → fly to tower → approach insulator → enter zone → safely leave → land — is exercisable with the existing controls; the acceptance screenshots capture the panorama, the in-zone pose and a WARNING/DANGER warning view. No scoring, no simulated AI, no teacher backend is claimed.

P1-4 note: `tests/browser/gamepad.spec.ts` (a P1-3 file already present in `HEAD`) carried a pre-existing return-type annotation (`: Promise<void>` on the `waitForAltitudeAbove` helper, whereas Playwright's `waitForFunction` returns `Promise<JSHandle<boolean>>`) that `tsc -b` rejects. Because `npm run build` must pass for P1-4, the annotation was corrected to let TypeScript infer the real type — a compile-only fix with **no** assertion, skip, strength or behaviour change; the paper PENDING_DEVICE_TEST stays skipped.

Not claimed yet: the inspection task loop and simulated AI (P1-5), scoring (P1-6), course records and teacher review (P1-7 — P1-3 already introduces the IndexedDB store used later). The Phase 1 MVP is therefore still IN PROGRESS.
