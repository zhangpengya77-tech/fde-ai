# Acceptance Report

## Phase 1 MVP

Overall status: IN PROGRESS

| Stage | Status | Scope |
|---|---|---|
| P1-1 | PASS | Independent Vite/TypeScript/Three.js shell, responsive training UI, unit/browser test harness, license records |
| P1-2 | PASS | Programmatic F450 entity and keyboard flight with verified build, unit and browser evidence |
| P1-3 | PASS | Generic USB/Gamepad input, brand-neutral pipeline, calibration wizard and IndexedDB profile storage |
| P1-4 | NOT STARTED | First transmission inspection scene |
| P1-5 | NOT STARTED | Inspection task loop and simulated AI |
| P1-6 | NOT STARTED | Teaching score and telemetry |
| P1-7 | NOT STARTED | Course records and teacher review |

P1-1 proves the independent offline-capable project shell only. It does not claim that the Phase 1 teaching loop is complete.

P1-2 passes with sequential verification: Vitest 6/6, Playwright 4/4 (desktop-chrome and mobile-chrome), production build 12 modules, and desktop/mobile screenshots showing the framed programmatic F450 with correct pre-takeoff, post-landing telemetry. P1-2 proves F450 rendering plus keyboard-controlled arm/takeoff/hover/translate/yaw/altitude/land only.

P1-3 passes with sequential verification: Vitest **78/78** across 8 files (including `input-normalizer`, `channel-mapper`, `gamepad-input-adapter`, `pilot-input-pipeline`, `profile-store`, `controller-calibration`), Playwright **8/8** across desktop-chrome and mobile-chrome (`gamepad.spec.ts` connect-and-fly + lost-link-hover, plus the P1-1/P1-2 specs which remain green), and a clean production build (20 modules). P1-3 proves a brand-neutral input pipeline (`PilotInputAdapter` → `InputNormalizer` → `ChannelMapper` → `PilotInputPipeline` → `SimpleFlightController`), a Mode 2 default profile, an on-first-use calibration wizard (live CH1–CH8 monitor, per-axis Min/Center/Max capture, reverse/deadzone/expo, IndexedDB persistence and JSON import/export), and the 250 ms lost-link → hover safety contract with throttle held. The flight core never learns a controller brand.

PENDING_DEVICE_TEST: real RadioMaster EdgeTX / RadioLink AT9S / DJI FPV RC3 / CRSF-ELRS hardware acceptance is recorded as a skipped `test.fixme` and is **not** claimed as PASS; the simulated Gamepad API only validates the wiring, wizard and lost-link fallback.

Not claimed yet: the transmission-tower scene (P1-4), the photo/inspection loop and simulated AI (P1-5), scoring (P1-6), IndexedDB persistence and teacher review (P1-7 — note P1-3 already introduces the IndexedDB store used later). The Phase 1 MVP is therefore still IN PROGRESS.
