# FDE-AI-UAS Project Context

## Baseline and branch policy

- Stable baseline: `D:\FDE-AI-UAS\v1.5C`
- Stable commit: `12cabfb`
- Stable tag: `v1.5C-r08-final-stable-20260923`
- Phase 1A development branch: `fde-ai-v2.0-dev`
- Development worktree: `C:\Users\admin\Documents\Codex\2026-09-28\FDE-AI-v2.0-dev`

The stable v1.5C checkout, production Worker, production startup scripts, and production Tunnel are not modified by Phase 1A.

## Phase 1A objective

Prove one bounded flow: mobile or desktop browser camera/file input sends one HTTP snapshot through an isolated Live Backend to the existing YOLO detector, then renders clean detection facts as a browser overlay.

Included: camera/file preview, one-shot snapshot, demo session, detection adapter, health/offline behavior, development-only route example, and local supervisor.

Excluded: WebSocket, voice, RAG, SOP/PASS-NG decisions, teacher dashboard, model retraining, production deployment, and Named Tunnel migration.

## Trust boundary

The browser is untrusted. It may submit image data, frame ID, filename, confidence, and demo mode. It may not assert student identity, teacher state, permissions, or inspection outcome. The Live Backend returns detection facts only: class, confidence, and bounding box.

