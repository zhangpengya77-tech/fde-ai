# FDE-AI-UAS v2.0 Phase 1A.1 — Development Handoff

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
- Windows Webcam: not completed because the Windows UI automation helper failed twice before browser control. Android Chrome and iPhone Safari: no connected physical devices; pending.

Full object-level and per-format records: `docs/verification/phase1a1-benchmark.json`.

## Known issues / next gate

- Existing best.pt performed poorly on labeled CW/CCW objects (CW 60%, CCW 30% in this limited test); do not retrain until separately approved.
- A browser cannot reliably isolate pure upload time from server processing using ordinary fetch timing; client fetch total and server-side stages must be interpreted together.
- WebP was smaller but substantially slower to encode in the local Pillow benchmark; browser/device results may differ.
- Windows Webcam, Android Chrome, and iPhone Safari still require hands-on HTTPS tests.

Do not enter Phase 1B until physical device tests and an acceptable CW/CCW acceptance threshold are approved.

