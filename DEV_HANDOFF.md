# FDE-AI-UAS v2.0 Phase 1A — Development Handoff

## Current state

- Branch: `fde-ai-v2.0-dev`
- Base: `12cabfb`
- Phase 1A implementation commits through `a4b9376` before this documentation commit.
- Local services: Live Backend `127.0.0.1:8030`; snapshot vision `127.0.0.1:8765`.
- Start: `powershell -File ops/v2/start-phase1a.ps1`
- Status: `powershell -File ops/v2/status-phase1a.ps1`
- Stop: `powershell -File ops/v2/stop-phase1a.ps1`

The supervisor owns and stops only processes it started. It starts no tunnel and updates no production Worker.

## Verification evidence

- Live Backend unit tests: 14 passed.
- JavaScript tests: 38 browser/existing/ops tests plus 3 Worker tests passed.
- Python compile check: passed.
- Real snapshot integration: source `DJI_20260913094111_0002_D.JPG`, 966,656 bytes; four detections; client round trip 730.96 ms; vision upstream 710.4 ms; forbidden response fields absent.
- Static analysis: `git diff --check` passed before the vision isolation commit.

`vision_upstream_ms` measures the Live Backend-to-vision round trip; it is not pure model inference time.

## Known limitations and manual checks

- Android Chrome, iPhone Safari, and a physical Windows webcam were not physically exercised in this development session. Camera constraints and lifecycle are covered by automated tests; device permission/orientation behavior still needs hands-on validation through a temporary HTTPS development route.
- The Cloudflare file is an undeployed development example. No production deployment was performed.
- Django regression commands require the project dependencies. The available Python runtimes in this session did not contain Django, so the final report records that limitation unless an existing compatible environment is supplied.
- Sessions are in-memory and intentionally non-authenticated demo sessions.

## Next gate

Before Phase 1B approval, run the manual matrix on Windows Chrome with webcam, Android Chrome, and iPhone Safari over an approved temporary HTTPS development route. Confirm overlay alignment in portrait and landscape, permission denial recovery, offline behavior, and several representative F450 images. Do not begin Phase 1B merely from this handoff.

