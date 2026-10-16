# Test Report

## P1-1 Project Skeleton

Status: PASS

Date: 2026-10-16

| Verification | Result | Evidence |
|---|---|---|
| TDD unit RED | PASS | `render-config.test.ts` failed because `src/app/render-config` did not exist |
| Unit GREEN | PASS | Vitest: 1 file, 2 tests passed |
| Browser RED | PASS | Root application was absent and the page could not satisfy the shell test |
| Desktop browser | PASS | Playwright Chrome, 1920×1080, non-empty canvas, zero page errors |
| Mobile browser simulation | PASS | Playwright Chromium with iPhone 13 viewport/touch profile |
| Production build | PASS | TypeScript and Vite build completed; 8 modules transformed |
| Visual review | PASS | Desktop and mobile screenshots show no incoherent overlap |

Screenshots:

- `screenshots/p1-1-desktop-chrome.png`
- `screenshots/p1-1-mobile-chrome.png`

Notes:

- The Chrome `NO_COLOR` warning comes from the test runner environment and is not an application error.
- No F450, flight controls, mission logic or AI behavior is claimed in P1-1.

## P1-2 F450 Entity and Keyboard Flight

Status: PASS

Date: 2026-10-16

Verification order for this stage was **sequential**, not concurrent, per the handoff instruction.

| Verification | Result | Evidence |
|---|---|---|
| Unit `npm test` | PASS | Vitest: 2 files, **6 tests passed** (`render-config` 2 + `simple-flight-controller` 4) |
| Browser `npm run test:browser` | PASS | Playwright: **4 tests passed** — desktop-chrome and mobile-chrome × `flight.spec.ts` + `shell.spec.ts` |
| Production build `npm run build` | PASS | `tsc -b` clean; Vite: **12 modules** transformed, JS 497.23 kB (gzip 126.61 kB) |
| Visual review | PASS | Desktop 1920×1080 and iPhone-13-size mobile screenshots: F450 framed centre, X-frame arms and propellers coherent, non-blank canvas, no layout overlap |
| Landing behaviour | PASS | After `降落`, altitude returns to `0` and state returns to `已解锁`; then `上锁` is reachable |
| Keyboard control | PASS | `W/S/A/D/Q/E/R/F` produce bounded pitch/roll/yaw/throttle motion through `KeyboardInputAdapter` |

Screenshots:

- `screenshots/p1-2-flight-desktop-chrome.png`
- `screenshots/p1-2-flight-mobile-chrome.png`
- `screenshots/p1-2-shell-desktop-chrome.png`
- `screenshots/p1-2-shell-mobile-chrome.png`
- P1-1 evidence `screenshots/p1-1-*.png` is retained byte-identical to commit `604c251`.

Notes:

- The F450 is the **programmatic** fallback. The candidate `F450_Assembly.glb` was inspected read-only but **not** copied because its source project carries no license/reuse statement; it must not be added before provenance is confirmed in `THIRD_PARTY_NOTICES.md`.
- One real defect was found while finishing this stage: `tests/browser/shell.spec.ts` wrote its screenshots to `screenshots/p1-1-<project>.png`, which **overwrote the P1-1 evidence files**. Fixed by renaming to `screenshots/p1-2-shell-<project>.png`; the two clobbered P1-1 screenshots were then restored bit-identical from `HEAD` (verified by SHA-256) and `p1-1-project-shell.png` was never touched.
- `playwright.config.ts` no longer retains traces or failure screenshots in `test-results/`. In this environment the runner's file-write guard blocked those artifact paths and turned otherwise-passing tests into failures; artifact output now goes to the git-ignored `.playwright-output/`. Application behaviour is unaffected.
- No controller brand, scene mission, scoring, persistence or AI behaviour is claimed in P1-2.

## P1-3 Generic USB / Gamepad Input and Calibration

Status: PASS

Date: 2026-10-16

Verification order for this stage was **sequential**, per the handoff instruction, and followed TDD (failing test first, then implementation) for every module.

| Verification | Result | Evidence |
|---|---|---|
| Unit `npm test` | PASS | Vitest: **8 files, 78 tests passed** (`render-config` 2, `simple-flight-controller` 4, `input-normalizer` 19, `channel-mapper` 16, `gamepad-input-adapter` 8, `pilot-input-pipeline` 7, `profile-store` 12, `controller-calibration` 10) |
| Browser `npm run test:browser` | PASS | Playwright: **8 passed / 2 skipped** across desktop-chrome + mobile-chrome. New `gamepad.spec.ts` (connect-and-fly + lost-link-hover) plus the existing `flight.spec.ts` and `shell.spec.ts` all green |
| Production build `npm run build` | PASS | `tsc -b` clean; Vite: **20 modules** transformed, JS 516.86 kB (gzip 132.99 kB) |
| Calibration wizard | PASS | `ControllerCalibrationPanel`: live CH1–CH8 monitor, per-axis Min/Center/Max capture state machine, reverse/deadzone/expo controls, IndexedDB persistence and JSON import/export |
| IndexedDB store | PASS | `profile-store.ts` wraps IndexedDB behind a KV contract with an in-memory fallback; round-trips and rejects foreign payloads |
| 250 ms lost-link safety | PASS | Unit: `pilot-input-pipeline.test.ts` forces hover and holds throttle past 250 ms. Browser: dropping the controller link reverts to keyboard and holds hover with altitude maintained (the real-world trigger for the same contract) |
| Brand neutrality | PASS | Flight core only sees `DeviceProfile`/channels; no controller brand string reaches `SimpleFlightController` |

Implemented files:

- `src/input/PilotInputAdapter.ts` — brand-neutral `RawPilotInput` / `PilotInputAdapter` contract and `STALE_INPUT_MS = 250`.
- `src/input/InputNormalizer.ts` — bipolar/unipolar axis normalization with asymmetric center spans, deadzone (with rescale for centered axes) and expo.
- `src/input/ChannelMapper.ts` — maps normalized channels to `PilotCommand`; stale/disconnected input → hover with held throttle; never trusts a dead device's channels.
- `src/input/device-profile.ts` — `DeviceProfile`, Mode 2 default (throttle reversed because a standard gamepad reports -1 forward), stored-schema round-trip.
- `src/input/adapters/GamepadInputAdapter.ts` — generic Gamepad API polling; re-scans `getGamepads()` each call; injectable `GamepadSource` so it is unit-testable without a browser.
- `src/input/PilotInputPipeline.ts` — unifies keyboard fallback and radio adapters; first connected/fresh source wins; priority order is data, not brand.
- `src/ui/controller-calibration.ts` — calibration wizard and pure capture helpers.
- `src/ui/profile-store.ts` — IndexedDB + in-memory KV store, JSON import/export.
- `src/app/create-app.ts` — wired the pipeline, panel and a live input-source readout into the training shell; added a test seam (`window.__fdeInputClock`) for deterministic stale detection.
- `tests/unit/*` and `tests/browser/gamepad.spec.ts` — TDD coverage above.

Notes:

- P1-3 delivers the input + calibration layer for Phase 1; it does **not** claim a complete teaching loop. The transmission-tower scene (P1-4), inspection loop and simulated AI (P1-5), scoring (P1-6) and the teacher-review persistence layer (P1-7) remain. P1-3's IndexedDB store is reused by P1-7.
- Real hardware acceptance for RadioMaster EdgeTX / RadioLink AT9S / DJI FPV RC3 / CRSF-ELRS is recorded as `PENDING_DEVICE_TEST` (a skipped `test.fixme` in `gamepad.spec.ts`) and is **not** claimed as PASS. The simulated Gamepad API is a test double that proves wiring, wizard and lost-link fallback only.

## P1-4 Transmission-Line Inspection Scene & SafetyDistanceEngine

Status: PASS

Date: 2026-10-16

TDD was followed per module (failing test first, then implementation). The geometry and safety layers are deliberately Three.js-free so the business logic is unit-testable in plain Node and cannot silently drift from what the trainee sees.

| Verification | Result | Evidence |
|---|---|---|
| Unit `npm test` | PASS | Vitest: **10 files, 116 tests passed** — new `transmission-layout` (14) + `safety-engine` (24); the P1-1/P1-2/P1-3 files (78) stay green |
| Browser `npm run test:browser` | PASS | Playwright: **16 passed / 2 skipped** across desktop-chrome + mobile-chrome — new `transmission-scene.spec.ts` (CASE1–CASE4 × 2) plus existing `shell`/`flight`/`gamepad`; only skips are the `PENDING_DEVICE_TEST` fixme |
| Production build `npm run build` | PASS | `tsc -b` clean; Vite: **23 modules** transformed, JS 540.60 kB (gzip 140.29 kB) |
| Scene composition (CASE1) | PASS | Ground, road, ≥2 towers, ≥2 sagging wires, obstacle tree, one target, one defect all present (`data-tower-count=2`, `data-wire-count=2`, `data-target-set=true`, canvas non-blank, zero page errors) |
| SAFE band (CASE2) | PASS | Pose far (≥10 m) from every hazard classifies `SAFE` and HUD shows `安全` |
| WARNING/DANGER bands (CASE3) | PASS | West of tower 1 → `DANGER`; near conductor → `WARNING`; HUD shows `警告/危险`; `distanceToWire < 5 m` |
| Inspection Zone (CASE4) | PASS | Teleport inside the 3.5 m radius flips HUD to `已进入`; at-target distance < 0.001 m; +6 m X offset stays `区外` |
| Real distance math | PASS | `pointToPolylineDistance` over sampled sag gives `distanceToWire`; segment gives `distanceToTower`; point-to-point gives `distanceToTarget`; worst-case precedence `COLLISION > DANGER > WARNING > SAFE` |
| Input chain intact | PASS | Keyboard + simulated Gamepad specs still pass; `PilotInputPipeline` untouched; brand-neutral flight core unchanged |

New files:

- `src/inspection/types.ts` — `Vec3`, `SafetyState` (`SAFE|WARNING|DANGER|COLLISION`), `InspectionGeometryResult`, `InspectionDefectType`.
- `src/scenes/SceneDefinition.ts` — pure `buildTransmissionLayout()`, sagging-wire sampler `createSaggingWire()` (parabola `y -= sag·4t(1−t)`), and distance primitives (`distance`, `pointToSegmentDistance`, `pointToPolylineDistance`). Two towers (`T1` x=-9, `T2` x=11, height 12, cross-arm y=11), two sagging conductors, target `INS-T1-RIGHT` at `{x:-7.4,y:8,z:4}` (`MISSING_INSULATOR_DISC`), obstacle tree, zone radius 3.5 m.
- `src/safety/SafetyEngine.ts` — `SafetyDistanceEngine.evaluate(position)` computes tower/wire/target distances + zone membership and worst-case safety state; `nearestObstacleDistance()` for the HUD. Teaching radii: tower {1.5/4/8}, wire {0.8/2/4}, target {0.5/1.2/3}, obstacle {1.0/2.5/5} (capsule/danger/warning).
- `src/scenes/transmission/create-transmission-scene.ts` — Three.js scene: ground, road with dashes, lattice towers with cross arms, sagging wire tubes (same samples the engine measures), the right insulator string with a visible **missing-disc** defect + red marker, tree obstacle, translucent inspection-zone ring/volume and target marker beam.
- `tests/unit/transmission-layout.test.ts`, `tests/unit/safety-engine.test.ts`, `tests/browser/transmission-scene.spec.ts`.

Modified files:

- `src/app/create-app.ts` — replaced the reference scene with the transmission scene, instantiated `SafetyDistanceEngine`, added the per-frame HUD (target, distance-to-target, distance-to-obstacle, colour-coded safety status, zone indicator) and zone highlight, and added two test seams: `window.__fdeTeleport` and `window.__fdeInspection` (`layout`/`evaluate`/`lastResult`).
- `src/flight/adapters/SimpleFlightController.ts` — added `teleport(position)` (teaching/test seam only; production flight never calls it).
- `src/styles.css` — safety-block + colour classes `safety-safe/warning/danger/collision`.
- `docs/.../2026-10-16-phase-1-mvp.md` — Task 4 checkboxes and notes.

Screenshots (acceptance evidence; calibration panel folded for clarity via a test-only style):

- A panorama `screenshots/p1-4-panorama-desktop-chrome.png`
- B inside zone `screenshots/p1-4-inzone-desktop-chrome.png`
- C WARNING view `screenshots/p1-4-warning-desktop-chrome.png`
- (mobile-chrome copies of A/B/C also produced)

Notes:

- P1-4 provides the inspection scene + real safety distance engine only. It does **not** claim the guided task loop, simulated AI (P1-5), scoring (P1-6) or teacher persistence (P1-7). The identify-first lesson is the **missing insulator disc**; it is a programmatic teaching defect with no real AI.
- The simulated-Gamepad `PENDING_DEVICE_TEST` is unchanged and still **not** claimed PASS.
- One pre-existing P1-3 type error in `tests/browser/gamepad.spec.ts` (`waitForAltitudeAbove` return annotation vs Playwright's `Promise<JSHandle<boolean>>`) blocked `tsc -b`. Fixed by letting TypeScript infer the real return type — a compile-only change with no assertion/skip/behaviour impact, required so `npm run build` passes for P1-4.
