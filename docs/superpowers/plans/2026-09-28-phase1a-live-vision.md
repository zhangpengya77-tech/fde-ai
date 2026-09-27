# FDE-AI-UAS v2.0 Phase 1A Live Vision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the development-only single-snapshot Browser → Live Backend → existing YOLO → detection facts path without modifying or deploying v1.5C production components.

**Architecture:** A Starlette/Uvicorn service on `127.0.0.1:8030` owns in-memory demo sessions and delegates image inference to a narrow HTTP Vision Adapter for `127.0.0.1:8765`. A standalone static browser test page captures one frame and renders returned boxes; development-only scripts and Worker examples remain isolated from production.

**Tech Stack:** Python 3.14, Starlette 1.0, Uvicorn 0.46, HTTPX 0.28, Node.js built-in test runner, browser MediaDevices/Canvas APIs, PowerShell.

**Spec:** `docs/superpowers/specs/2026-09-28-phase1a-live-vision-design.md`

## Global Constraints

- Base must remain commit `12cabfb`; all work is on `fde-ai-v2.0-dev`.
- Do not modify the v1.5C worktree, existing Django public APIs, Photo Check, RAG corpus, `best.pt`, production Pages, Worker, Tunnel, or `ORIGIN_URL`.
- Phase 1A is manual HTTP snapshot only; no WebSocket, voice, RAG, SOP, PASS/NG, formal learning records, or production deployment.
- Demo sessions are in memory and never write Django SQLite.
- Vision output is detection facts only and never includes annotated images or conclusions.

## Review Focus

- YOLO offline must degrade health and return a bounded snapshot error without crashing the static page.
- Malformed or oversized image data must be rejected before reaching YOLO.
- YOLO response fields that contain decisions, local paths, or annotated images must never escape the adapter.
- Camera permission denial and page exit must leave the rest of the test page usable and release all tracks.
- Development Worker/supervisor files must not reference or overwrite production `ORIGIN_URL`.

---

### Task 1: Live Backend scaffold and health

**Files:**
- Create: `live_backend/requirements.txt`
- Create: `live_backend/app/__init__.py`
- Create: `live_backend/app/config.py`
- Create: `live_backend/app/errors.py`
- Create: `live_backend/app/main.py`
- Create: `live_backend/tests/test_health.py`

**Interfaces:**
- Produces: `create_app(vision_adapter=None, session_store=None) -> Starlette`
- Produces: `GET /api/live/health`

- [ ] Write health tests for online, degraded, timeout-safe, and no-path-disclosure responses.
- [ ] Run them and verify RED because the app does not exist.
- [ ] Implement the minimal app/config/error response and health route.
- [ ] Run the health tests and the current complete suite.
- [ ] Commit `feat: scaffold live backend and health endpoint`.

### Task 2: In-memory demo session API

**Files:**
- Create: `live_backend/app/sessions.py`
- Create: `live_backend/tests/test_sessions.py`
- Modify: `live_backend/app/main.py`

**Interfaces:**
- Produces: `InMemorySessionStore.create()`, `get(session_id)`, `delete(session_id)`
- Produces: `POST /api/live/sessions`, `DELETE /api/live/sessions/{id}`

- [ ] Write tests for create/delete/not-found and rejection of trusted identity/permission fields.
- [ ] Run them and verify RED.
- [ ] Implement the minimal process-local store and routes.
- [ ] Run session tests and full backend tests.
- [ ] Commit `feat: add live demo session api`.

### Task 3: Snapshot Vision Adapter

**Files:**
- Create: `live_backend/app/vision.py`
- Create: `live_backend/tests/test_vision.py`
- Create: `live_backend/tests/test_snapshot.py`
- Modify: `live_backend/app/main.py`

**Interfaces:**
- Produces: `VisionAdapter.health() -> bool`
- Produces: `VisionAdapter.detect(image_data, file_name, confidence) -> list[DetectionFact]`
- Produces: `POST /api/live/sessions/{id}/snapshot`

- [ ] Write adapter tests proving only class/confidence/box survive upstream normalization.
- [ ] Verify RED.
- [ ] Implement YOLO health/detect client with timeouts and stable exceptions.
- [ ] Write and verify RED snapshot tests for success, missing session, invalid/oversized data, and YOLO offline.
- [ ] Implement snapshot validation, IDs, timing, and response size measurement.
- [ ] Run all backend tests.
- [ ] Commit `feat: add snapshot vision adapter`.

### Task 4: Browser camera preview and overlay

**Files:**
- Create: `live/index.html`
- Create: `live/live.css`
- Create: `live/live.js`
- Create: `live/live.test.cjs`

**Interfaces:**
- Consumes: Phase 1A REST API.
- Produces: manual camera/file snapshot workflow and client-side SVG/canvas overlay.

- [ ] Write Node contract tests for health/offline copy, rear camera constraints, manual capture, track cleanup, timing display, and overlay rendering hooks.
- [ ] Verify RED.
- [ ] Implement the minimal accessible page and browser controller.
- [ ] Run frontend tests and all existing JavaScript tests.
- [ ] Commit `feat: add browser camera preview and detection overlay`.

### Task 5: Development supervisor and Cloudflare routing example

**Files:**
- Create: `ops/v2/start-phase1a.ps1`
- Create: `ops/v2/stop-phase1a.ps1`
- Create: `ops/v2/status-phase1a.ps1`
- Create: `ops/v2/phase1a.env.example`
- Create: `cloudflare/dev-phase1a/worker.js`
- Create: `cloudflare/dev-phase1a/wrangler.example.jsonc`
- Create: `tests/phase1a_ops.test.cjs`

**Interfaces:**
- Produces: development-only Start/Stop/Health for Live Backend and existing YOLO.
- Produces: undeployed route example using `LIVE_ORIGIN_URL` only.

- [ ] Write contract tests proving scripts target ports 8030/8765 and never update production `ORIGIN_URL`.
- [ ] Verify RED.
- [ ] Implement process ownership/state files, health polling, and safe stop behavior.
- [ ] Implement an undeployed Worker example for `/api/live/*` and `/live/*`.
- [ ] Run ops contract tests and all JavaScript tests.
- [ ] Commit `feat: add phase1a development supervisor and route example`.

### Task 6: Documentation and final verification

**Files:**
- Create: `PROJECT_CONTEXT.md`
- Create: `V2_ARCHITECTURE.md`
- Create: `DEV_HANDOFF.md`
- Create: `docs/verification/phase1a-manual-test-matrix.md`

**Interfaces:**
- Documents exact branch, commits, services, ports, APIs, tests, known issues, physical-device status, and Phase 1B recommendation.

- [ ] Add automated verification instructions and a physical-device matrix with untested items explicitly marked pending.
- [ ] Run backend tests, all JavaScript tests, Django check/migration/full regression, syntax checks, and offline behavior tests.
- [ ] Confirm stable worktree remains at `12cabfb` with no changes.
- [ ] Perform local browser/image/webcam verification where available; record actual timings only.
- [ ] Update handoff documents with exact evidence and known limitations.
- [ ] Commit `docs: add phase1a verification and handoff`.
