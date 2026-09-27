# Phase 1A.1 Verification and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Phase 1A in the canonical D-drive worktree, add trustworthy snapshot timing and 640×480 encoding, and produce reproducible model/device verification evidence without entering Phase 1B.

**Architecture:** Keep Live Backend on 8030 and the snapshot-only Vision HTTP service on 8765. Instrument the Vision wrapper around decode, inference lock wait, Ultralytics prediction, and detection post-processing; propagate those facts through the Live Backend. Keep one-shot HTTP capture and add bounded JPEG/WebP browser encoding plus an offline benchmark tool.

**Tech Stack:** Python 3.14, Starlette, httpx, Ultralytics YOLO, Pillow, browser Canvas API, Node test runner, PowerShell supervisor.

**Spec:** User instruction “FDE-AI-UAS v2.0｜Codex D 槽工作區修正＋Phase 1A.1 指令” dated 2026-09-28.

## Global Constraints

- Canonical working directory is `D:\FDE-AI-UAS-v2.0` on `fde-ai-v2.0-dev`.
- Never modify `D:\FDE-AI-UAS\v1.5C`, `best.pt`, production Worker, production Tunnel, or production deployment.
- HTTP Snapshot only; no WebSocket, automatic FPS loop, Voice AI, RAG, SOP, or Phase 1B.
- Physical-device results must never be fabricated.

## Review Focus

- Timing fields must describe their actual measurement boundary and never label upstream time as inference.
- Invalid/missing upstream timing must fail safely rather than propagate non-finite values.
- Browser encoding must preserve aspect ratio inside 640×480 and release camera tracks.
- WebP unsupported behavior must be detectable and documented.
- Benchmark ground truth must come from dataset labels and disclose that training/validation data is not an independent field set.

---

### Task 1: Preserve migration evidence and Phase 0 documents

**Files:**
- Create: `docs/archive/phase0/*.md`
- Create: `docs/verification/d-drive-migration.md`

- [ ] Copy the three backed-up Phase 0 documents into the archive without changing content.
- [ ] Record hashes, worktree topology, stable-base state, and legacy-workspace lock.
- [ ] Verify hashes and commit.

### Task 2: Add truthful server-side timing

**Files:**
- Modify: `live_backend/dev/vision_snapshot_server.py`
- Modify: `live_backend/app/vision.py`
- Modify: `live_backend/app/main.py`
- Test: `live_backend/tests/test_vision_snapshot_server.py`, `test_vision.py`, `test_snapshot.py`

- [ ] Write failing tests for `server_decode_ms`, `queue_wait_ms`, `model_inference_ms`, `postprocess_ms`, and propagation.
- [ ] Run RED, implement minimal instrumentation, run GREEN.
- [ ] Commit `perf: add vision timing metrics`.

### Task 3: Bound browser encoding and expose client timing

**Files:**
- Modify: `live/live.js`, `live/index.html`
- Test: `live/live.test.cjs`

- [ ] Write failing tests for contain-resize to 640×480, JPEG/WebP quality 0.75, separate capture/encode and round-trip/response timing.
- [ ] Run RED, implement minimal behavior, run GREEN.
- [ ] Commit `perf: optimize snapshot encoding`.

### Task 4: Reproducible model and format benchmark

**Files:**
- Create: `tools/phase1a1_benchmark.py`
- Create: `docs/verification/phase1a1-benchmark.json`
- Create: `docs/verification/phase1a1-device-matrix.md`
- Test: `tests/test_phase1a1_benchmark.py`

- [ ] Write failing tests for model-name extraction, YOLO-label ground truth, matching, and format output schema.
- [ ] Run RED, implement the tool, run GREEN.
- [ ] Execute against at least 10 labeled CW and 10 labeled CCW objects plus original/JPEG/WebP variants.
- [ ] Record Windows webcam availability honestly; leave Android/iPhone pending without a connected device.
- [ ] Commit verification artifacts.

### Task 5: Regression, supervisor, and handoff

**Files:**
- Modify: `PROJECT_CONTEXT.md`, `V2_ARCHITECTURE.md`, `DEV_HANDOFF.md`

- [ ] Install/use an isolated Django environment if dependencies are available, then run Django checks/tests.
- [ ] Run supervisor start/status/snapshot/stop and full Python/Node regression.
- [ ] Re-check stable v1.5C and canonical/legacy worktrees.
- [ ] Update handoff with exact evidence and commit `docs: update phase1a1 handoff`.

