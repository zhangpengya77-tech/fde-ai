# FDE-AI-UAS Project Context

## Canonical workspaces

- v2.0 canonical directory: `D:\FDE-AI-UAS-v2.0`
- v2.0 branch: `fde-ai-v2.0-dev`
- Stable baseline: `D:\FDE-AI-UAS\v1.5C`, branch `fde-ai-v1.5c`, commit `12cabfb`, tag `v1.5C-r08-final-stable-20260923`
- C-drive Phase 1A checkout: detached at `4e77c3e`, locked as `LEGACY_WORKSPACE`; do not develop there or delete it without human approval.

The v1.5C checkout, best.pt, Photo Check, production Worker, production Tunnel, and production deployment remain frozen.

## Current scope

Phase 1A proves browser camera/file → one HTTP snapshot → Live Backend → local YOLO → clean detection facts → browser overlay. Phase 1A.1 adds truthful timing, bounded 640×480 JPEG/WebP encoding, model-class inspection, repeatable CW/CCW tests, and device/regression evidence.

Phase 1A.2 camera transport is verified. Phase 2 now adds SOP task authority and a bounded 1 FPS automatic observation foundation; model qualification remains separate.

The original Phase 0 documents are preserved byte-for-byte in `docs/archive/phase0/`; migration evidence is in `docs/verification/d-drive-migration.md`.

## Phase 2 current state

Phase 2A and the Phase 2B Automatic Observation foundation are implemented under Backend Modular Authority. Vision emits Detection Facts only; `SopEngine` produces teaching decisions; `InMemorySessionStore` owns task state and ordered events; `CoachOrchestrator` connects detection, SOP, guidance, and session updates.

The first configurable task is `F450_BASIC_ASSEMBLY / PARTS_PREPARATION` with `prepare_motor`, `prepare_frame_arm`, and `prepare_flight_controller`. REAL_VISION requires manual confirmation. Dev/Test-only MOCK_VISION supports complete deterministic workflow testing and is rejected by the backend when Dev Mode is disabled.

The frontend retains Manual AI Detect and adds a 1 FPS Automatic Observation scheduler with one-in-flight, latest-frame capture, stale completion suppression, and zero request queue.

Still excluded: Production deployment, real RAG/LLM, Realtime Voice AI, production Learning Record, Teacher Dashboard, WebSocket, model retraining, and model replacement. Model status is `MODEL_ACCURACY_PENDING`.
