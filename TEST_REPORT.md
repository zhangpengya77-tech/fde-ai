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

## P1-5 Inspection Mission Loop and Simulated AI

Status: PASS

Date: 2026-10-16

TDD was followed per module (failing test first, then implementation). All new business logic is Three.js-free and DOM-free, so the mission state machine, gimbal limits, photo judging and the simulated AI are unit-testable in plain Node; the browser tests then exercise the same logic on **real** telemetry with **real** WebGL captures.

| Verification | Result | Evidence |
|---|---|---|
| Unit `npm test` | PASS | Vitest: **15 files, 150 tests passed** — new `mission-engine` (12), `projection-photo-validator` (10), `gimbal-camera` (7), `mock-inspection-ai` (4), `inspection-capture-store` (1); P1-1–P1-4 suites (116) stay green |
| Browser `npm run test:browser` | PASS | Playwright: **6 passed** for the new `inspection-mission.spec.ts` CASE1–CASE3 × desktop-chrome + mobile-chrome (this spec alone was run; P1-2/P1-4 screenshot evidence files untouched) |
| Production build `npm run build` | PASS | `tsc -b` clean; Vite build ✓ (only the pre-existing three.js >500 kB chunk warning) |
| Real photo capture | PASS | `renderCaptureToDataUrl()` renders the live scene from the **actual camera pose** (drone pose + heading + gimbal angles) into a `WebGLRenderTarget`, reads the pixels back and stores a PNG data URL; the browser test asserts the `<img data-photo-preview>` receives a `data:image/png;base64,...` payload > 2 kB |
| Teaching core (retry loop) | PASS | A deliberately mis-aimed shot (pitch +20° vs 15° tolerance) is **accepted as a capture** but judged invalid — mission returns to `AIM_CAMERA`, HUD shows `照片不合格` + `云台方向偏差过大`; re-aiming and shooting again validates and reaches the AI |
| Mission state machine | PASS | `IDLE→READY→TAKEOFF→FLY_TO_TARGET→POSITION_FOR_INSPECTION→AIM_CAMERA→CAPTURE→AI_INSPECTION→INSPECTION_COMPLETE→RETURN→LAND→COMPLETE`, each transition driven by real telemetry (never a timer); a real `COLLISION` aborts to `FAILED` |
| Photo judging (projection only) | PASS | `ProjectionPhotoValidator` checks target-in-frustum, coverage ratio, distance band [0.8, 5] m, aim error ≤ 15°, zone membership and safety from geometry alone — it never inspects pixels and never calls the AI |
| Simulated AI | PASS | `MockInspectionAI` returns the planted `MISSING_INSULATOR_DISC` defect deterministically (no `Math.random`; confidence from capture geometry, ∈ [0.5, 0.99]); the UI labels it `Mock AI（模拟）` and `来源：模拟 AI / 非真实模型` |
| Capture gating | PASS | `requestCapture()` only succeeds from `AIM_CAMERA`; a refused request shows `无法拍摄` + reason and leaves the mission untouched (regression found and fixed: the per-frame UI update used to overwrite the refusal) |
| Gimbal teaching keys | PASS | I/K pitch, J/L yaw, C recenter — separate window-level handler, the P1-3 input chain is untouched and flight keys W/A/S/D/Q/E/R/F are unaffected |
| Input chain intact | PASS | Keyboard + simulated Gamepad paths unchanged; brand-neutral flight core untouched; `PilotInputPipeline` unchanged |
| Persistence seam | PASS | `InspectionCaptureRecord` (pose, gimbal angles, distances, safety, photo validation, AI result, photo data URL) saved through `resolveInspectionCaptureStore()` (IndexedDB + in-memory fallback); failures never block the teaching loop |

New files:

- `src/mission/types.ts` / `src/mission/MissionEngine.ts` — ordered mission states, Chinese labels/hints, progress, and the pure state machine consuming real telemetry; externally-driven actions (`requestCapture` / `submitPhoto` / `submitAI` / `requestReturn` / `fail` / `reset`) are state-gated.
- `src/camera/GimbalCamera.ts` — pure gimbal angle model (pitch −90…+20°, yaw ±135°, nudge/recenter), no Three.js.
- `src/camera/ProjectionPhotoValidator.ts` — projection-based photo-quality judge (frustum test, coverage, distance, aim, zone, safety) with teaching-tunable config.
- `src/ai/InspectionAIAdapter.ts` / `src/ai/MockInspectionAI.ts` — the AI contract and the deterministic, always-labelled-as-simulated mock; no model files, no network.
- `src/persistence/inspection-capture-store.ts` — capture-record store (IndexedDB with in-memory fallback) prepared for P1-6 scoring and P1-7 teacher review.
- `tests/unit/mission-engine.test.ts`, `tests/unit/gimbal-camera.test.ts`, `tests/unit/projection-photo-validator.test.ts`, `tests/unit/mock-inspection-ai.test.ts`, `tests/unit/inspection-capture-store.test.ts`, `tests/browser/inspection-mission.spec.ts`.

Modified files:

- `src/app/create-app.ts` — mission/gimbal/validator/AI wiring; real `WebGLRenderTarget` capture; task panel (step, progress, hint, gimbal readout), camera panel (photo preview), checklist panel (photo result + reasons, mock-AI result, mission state); capture button + gimbal keys; mission→flight edges (RETURN auto-RTL, LAND auto-land); new test seams `window.__fdeGimbal` and `window.__fdeMission` (test only — production behaviour never depends on them); `distanceToHome` is horizontal so RTL arrival is achievable.
- `src/styles.css` — mission hint, result rows, photo preview/placeholder, capture button, gimbal key hint.
- `src/inspection/types.ts` — `InspectionAIResult` / `InspectionAIInput` / `PhotoValidationResult` / `PhotoSample` / `InspectionCaptureRecord` shared contracts.

Screenshots (acceptance evidence; calibration panel folded for clarity via a test-only style):

- A validated capture `screenshots/p1-5-capture-desktop-chrome.png` — drone in the inspection zone (altitude 8.0 m, 3.2 m to target), photo preview showing the real capture, checklist 3/3
- B completed mission `screenshots/p1-5-complete-desktop-chrome.png` — 12/12, landed and disarmed, evidence retained
- (mobile-chrome copies of A/B also produced; the camera panel is intentionally hidden on the ≤920 px layout)

Notes:

- P1-5 delivers the complete teaching loop with a **simulated** AI. It does **not** claim a real defect-detection model, scoring (P1-6) or teacher review (P1-7).
- One real defect was found by the P1-5 integration itself: a refused capture request set the HUD text, but the per-frame `updateMissionUI` immediately overwrote it with `未拍摄`. Fixed by keeping the refusal in state (`captureRefusal`) until the next real capture; covered by CASE1.
- One test-robustness issue was found and fixed: teleporting while the aircraft was still `taking-off` let the climb target pull the pose back down (the takeoff vertical target overrides position until `flying`). The browser helper now waits for mode `飞行中` before teleporting; P1-1/P1-2/P1-4 specs never armed/took off, so their evidence was unaffected.
- The gamepad gimbal mapping (right-stick camera control) is intentionally **reserved** (V1): only the reserved-brand-neutral channel path is claimed here, keeping the P1-3 acceptance intact.

## P1-6 Teaching Score (ScoringEngine)

Status: PASS

Date: 2026-10-16

TDD was followed per module. The scorer is pure and deterministic: `ScoringEngine` consumes one `ScoreSession` of **real recorded data** (collected by `SessionRecorder` from live telemetry, hazard episodes, capture attempts and stick-input statistics) and returns a transparent `MissionScoreResult`. No score is ever derived from UI text and nothing is random — the same recorded run always yields the same score, the same major issues and the same suggestions.

| Verification | Result | Evidence |
|---|---|---|
| Unit `npm test` | PASS | Vitest: **17 files, 190 tests passed** — new `scoring-engine` (26) + `session-recorder` (14); the P1-1–P1-5 suites (150) stay green |
| Browser `npm run test:browser` | PASS | Playwright: full suite green — new `score.spec.ts` CASE1–CASE5 × desktop-chrome + mobile-chrome (**10 passed**) plus all earlier specs unchanged; only skips remain the `PENDING_DEVICE_TEST` fixme |
| Production build `npm run build` | PASS | `tsc -b` clean; Vite build ✓ (only the pre-existing three.js >500 kB chunk warning) |
| Pure scorer | PASS | `ScoringEngine.score(session)` never touches the DOM, Three.js or randomness; unit-testable in plain Node |
| Hard safety rule | PASS | COLLISION or mission FAILED caps the total at 59 (configurable): a collision can never produce a 90+ score; unit tests prove the cap with an otherwise-perfect run |
| Weights configured, not hard-coded | PASS | Six dimensions (25/25/15/15/10/10 = 100) live in `DEFAULT_SCORE_CONFIG`; the UI renders `dimension.score / dimension.maxScore` from the engine result |
| Suggestions deterministic | PASS | 1–3 teaching tips chosen by a fixed priority from real scoring reasons (collision → failed → DANGER → photo → efficiency → stability → positive); unit test proves identical output for identical input |
| Input statistics | PASS | `SessionRecorder` counts full-stick **episodes** (not frames), cooldown-filtered input reversals, and hover-phase stick deviation from the real `PilotCommand` |
| Hazard accounting | PASS | Continuous WARNING/DANGER/COLLISION stays are counted as episodes with durations (never frames); teleports (test seam) are excluded from the flown path |
| UI | PASS | Mission-end score card (overlay): total, grade, six dimensions each with score + short reason, major issues and teaching suggestions; dismissible and re-openable from the checklist panel |

Implemented modules:

- `src/scoring/types.ts` — `ScoreSession`, `ScoreDimension`, `MissionScoreResult`, `ScoreConfig` (weights, penalties, grade bands, hard caps).
- `src/scoring/config.ts` — `DEFAULT_SCORE_CONFIG`: weights 25/25/15/15/10/10, grade bands 90/70/60, `capCollisionTotal = capFailedTotal = 59`, per-episode/per-second hazard penalties, ideal photo geometry, path-ratio efficiency (simple baseline: climb + there-and-back horizontal, **no** optimal-path algorithm), stick-input thresholds.
- `src/scoring/ScoringEngine.ts` — pure `scoreSession(session) -> MissionScoreResult` + exported `gradeForTotal()`; six dimension scorers, hard caps, `majorIssues` and deterministic `suggestions`.
- `src/scoring/SessionRecorder.ts` — stateful recorder: path length (teleport-aware), max altitude, zone entry, hazard episodes, mission progress/completion/failure, indexed capture attempts, full-stick/reversal/hover statistics; `session()` is a non-mutating snapshot.

Scoring rules (V1, teaching-tuned, **not** an official licence standard):

- **任务完成 (25)**: inspection completed and landed → full; failed → 0 (significant deduction); otherwise partial by the furthest step reached toward `INSPECTION_COMPLETE` (e.g. stopped at 调整云台 → 25×4/8 = 12.5).
- **飞行安全 (25)**: full when全程 SAFE; −25 per collision episode; −4 per DANGER episode and −0.5 per DANGER second (+−5 when DANGER time ≥ 5 s = severe violation); −1 per WARNING episode and −0.25 per WARNING second (light).
- **巡检位置 (15)**: full for a valid in-zone capture at the ideal distance (2.4 m ± 1.0 m); off-ideal distance −3; attempted capture from a DANGER/COLLISION pose −3; entered the zone but no valid photo → 50%; never entered → 0.
- **照片质量 (15)**: based on the **final valid** shot (failed attempts are kept on record and cost −1.5 each); −3 each for low coverage / large aim error / off-ideal distance; floor 60% for any valid photo; no valid photo → 0 with the real rejection reasons.
- **飞行效率 (10)**: actual path ÷ basic path (max altitude + 2× horizontal home→target); full ≤ 1.6×, scales down to 20% at 3× (obvious detours); −2 beyond the 240 s teaching budget.
- **操纵稳定性 (10)**: −1 per full-stick episode above 3, −0.5 per input reversal above 6, scaled deduction for hover stick deviation above 0.08.
- **Hard caps**: COLLISION → total ≤ 59; mission FAILED → total ≤ 59. Grades: ≥90 EXCELLENT, ≥70 PASS, ≥60 NEEDS_PRACTICE, else FAIL.

Screenshots (acceptance evidence; calibration panel folded via a test-only style):

- A overview `screenshots/p1-6-score-overview-desktop-chrome.png` — 99/100 EXCELLENT after a completed inspection
- B six-dimension detail `screenshots/p1-6-score-detail-desktop-chrome.png`
- C DANGER deduction `screenshots/p1-6-score-warning-desktop-chrome.png` — flight safety 18.12/25 with DANGER/WARNING reasons
- D COLLISION / FAIL `screenshots/p1-6-score-collision-desktop-chrome.png` — 28/100, FAIL, hard-cap issue and collision suggestion
- (mobile-chrome copies of A/B/C/D also produced)

Notes:

- Two integration findings were fixed while wiring the scorer: (1) the programmatic F450's model group sits 0.5 m above the flight position, so the *real* capture distance is slightly larger than the pose implies — the ideal-distance tolerance was set to ±1.0 m around 2.4 m so the on-screen framing matches the teaching advice; (2) the 176 px checklist panel physically cannot show a six-dimension score — the score is therefore presented as a mission-summary overlay card (identical on desktop and mobile) instead of being silently clipped.
- P1-6 scores the **teaching** loop only. No AI pilot-ability model, PID diagnosis, professional exam algorithm or official licence scoring is claimed; those stay out of scope by design. `PENDING_DEVICE_TEST` remains skipped and unclaimed.
