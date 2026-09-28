# FDE-AI-UAS v2.0 Phase 2 — Development Handoff

## Workspace and services

- Canonical directory: `D:\FDE-AI-UAS-v2.0`
- Branch: `fde-ai-v2.0-dev`
- Base: `12cabfb`; Phase 1A preservation point: `4e77c3e`
- Live Backend: `127.0.0.1:8030`
- Snapshot Vision: `127.0.0.1:8765`
- Commands: `ops/v2/start-phase1a.ps1`, `status-phase1a.ps1`, `stop-phase1a.ps1`

## Phase 1A.1 evidence

- Actual model names: `cw_propeller`, `ccw_propeller`, `flight_controller`, `motor`, `esc`, `gps_compass`, `receiver`, `battery`, `frame_arm`, `power_module`.
- Labeled-object test (IoU ≥ 0.5 and correct class): CW 6/10; CCW 3/10. Source is the training/validation dataset, not an independent field set.
- Representative format comparison: original 266,605 bytes / inference 40.7 ms; JPEG 640×480 q0.75 40,551 bytes / encode 51.7 ms / inference 38.6 ms; WebP 640×480 q0.75 24,112 bytes / encode 202.3 ms / inference 40.0 ms.
- Full HTTP original-image run: 266,605 bytes; 412.9 ms total; 1,392-byte response; decode 22.7 ms; queue 0.0 ms; preprocess 39.8 ms; inference 61.8 ms; postprocess 4.0 ms; vision upstream/backend 401.3 ms.
- Django 5.2.17 isolated environment: system check clean, migration check reports no changes, test command completed without test failure.
- Windows Webcam camera pipeline: PASS in a real normal-Chrome test. Camera Preview, Detect interaction, Snapshot request, and Detection result all passed through Dev-only HTTPS, Live Backend, Vision, and `best.pt`.
- First physical-object result: expected `motor`, detected `frame_arm`, confidence 38.9% — `MODEL MISCLASSIFICATION`. This does not invalidate the camera pipeline, but model accuracy is not passed. The `motor`, `frame_arm`, and `flight_controller` three-object review remains in progress.
- Android Chrome and iPhone Safari: no connected physical devices; pending.

Full object-level and per-format records: `docs/verification/phase1a1-benchmark.json`.

## Known issues / next gate

- Existing best.pt performed poorly on labeled CW/CCW objects (CW 60%, CCW 30% in this limited test); do not retrain until separately approved.
- A browser cannot reliably isolate pure upload time from server processing using ordinary fetch timing; client fetch total and server-side stages must be interpreted together.
- WebP was smaller but substantially slower to encode in the local Pillow benchmark; browser/device results may differ.
- Windows Webcam transport/inference chain is physically verified. Model accuracy still requires the three-object sequence documented in `docs/verification/phase1a2/windows-webcam-checklist.md`; Android Chrome and iPhone Safari remain pending.
- Keep `best.pt` and the configured threshold unchanged. Track model quality as `MODEL_ACCURACY_PENDING`; Phase 2 architecture may proceed with DEV-only Mock Vision while qualification remains separate.

Do not enter Phase 1B until physical device tests and an acceptable CW/CCW acceptance threshold are approved.

## Phase 2 implementation

Phase 2A and the Phase 2B Automatic Observation foundation are complete on `fde-ai-v2.0-dev`.

- Demo course/task: `F450_BASIC_ASSEMBLY / PARTS_PREPARATION`.
- Steps: `prepare_motor` -> `prepare_frame_arm` -> `prepare_flight_controller` -> `TASK_COMPLETED`.
- SOP decisions: `NO_DETECTION`, `UNCERTAIN`, `NG`, `PASS_CANDIDATE`, and `TEACHER_CHECK`.
- REAL_VISION never automatically completes a step; backend `POST /confirm` is required.
- MOCK_VISION is rejected unless explicit Dev/Test mode is enabled.
- Session state, counters, confirmation, completion, and event sequence are backend authoritative.
- Manual AI Detect remains available.
- Auto Observation defaults to 1 FPS with one-in-flight, current-frame capture, busy-tick dropping, late-response suppression, max in-flight 1, and queue length 0.
- RAG and Voice boundaries are interfaces only; there is no network integration or API key.

Verification evidence:

- Live Backend: 37 tests passed.
- All JavaScript/Worker/Phase suites: 61 tests passed.
- Django: 238 tests passed, 22 skipped; system check clean.
- Python compileall: passed.
- Scheduler test evidence: max in-flight 1; queue length 0; a busy tick increments skipped frames without a second request.
- Physical Phase 1A.2 camera pipeline remains PASS.
- Model status remains `MODEL_ACCURACY_PENDING`; `best.pt` and thresholds were not modified.

Do not proceed to real RAG, Realtime Voice AI, production Learning Record, Teacher Dashboard, or Production deployment without a new authorization.
