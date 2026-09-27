# FDE-AI-UAS Project Context

## Canonical workspaces

- v2.0 canonical directory: `D:\FDE-AI-UAS-v2.0`
- v2.0 branch: `fde-ai-v2.0-dev`
- Stable baseline: `D:\FDE-AI-UAS\v1.5C`, branch `fde-ai-v1.5c`, commit `12cabfb`, tag `v1.5C-r08-final-stable-20260923`
- C-drive Phase 1A checkout: detached at `4e77c3e`, locked as `LEGACY_WORKSPACE`; do not develop there or delete it without human approval.

The v1.5C checkout, best.pt, Photo Check, production Worker, production Tunnel, and production deployment remain frozen.

## Current scope

Phase 1A proves browser camera/file → one HTTP snapshot → Live Backend → local YOLO → clean detection facts → browser overlay. Phase 1A.1 adds truthful timing, bounded 640×480 JPEG/WebP encoding, model-class inspection, repeatable CW/CCW tests, and device/regression evidence.

Still excluded: WebSocket, automatic FPS loops, Voice AI, RAG, SOP decisions, teacher dashboard, retraining, and Phase 1B.

The original Phase 0 documents are preserved byte-for-byte in `docs/archive/phase0/`; migration evidence is in `docs/verification/d-drive-migration.md`.

