# Student Live Coach Real Interaction Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the real iPhone Student Mode entry flow and connect explicit, context-aware text/voice questions to the existing Session, Vision, and RAG providers without continuous inference.

**Architecture:** Keep Live Session, TrainingProgress, VisionAdapter, and RAGAdapter authoritative. Fix frontend initialization so the Backend task list renders before any detail view, then add one session-aware Ask endpoint that optionally runs exactly one current-frame Vision request before querying the existing RAG service. Camera preview remains local and silent until an explicit AI Check or visual question.

**Tech Stack:** Starlette, Python unittest, browser JavaScript, Node test runner, HTML/CSS, existing VisionAdapter and RAGAdapter.

**Spec:** User-approved “12 Task Map + Camera Preview + Voice AI 实机修复指令”.

## Global Constraints

- Do not modify v1.5C, Flight Health, Task 08 content, Production, or existing authority architecture.
- Do not add API keys or a second Session, Vision, RAG, or AI system.
- Voice remains explicit push-to-talk; report provider status honestly.
- Camera preview must never imply continuous Vision inference.

## Review Focus

- Removed legacy DOM controls must not abort Safari initialization.
- Backend/session errors must replace Loading with a retryable student message.
- No Task detail may appear until a card is selected.
- Knowledge and next-step questions must not capture or upload a frame.
- Safety and low-confidence/no-hit answers must preserve teacher authority.

---

### Task 1: Student Mode initialization and Task Map

**Files:**
- Modify: `live/live.js`
- Modify: `live/live.css`
- Modify: `live/index.html`
- Test: `live/student-live-real-interaction.test.cjs`

- [ ] Write failing tests for 12 Backend cards replacing Loading, null selected Task, hidden detail, retryable error, and card navigation.
- [ ] Run the focused Node test and confirm RED.
- [ ] Remove the stale control crash, render `state.training` during initialization, keep Task detail hidden, and expose a retry action on failure.
- [ ] Run the focused Node test and confirm GREEN.

### Task 2: Camera preview without background inference

**Files:**
- Modify: `live/live.js`
- Test: `live/student-live-real-interaction.test.cjs`

- [ ] Write failing tests proving camera start/switch does not call snapshot and 30-second idle preview produces zero inference requests.
- [ ] Run the focused test and confirm RED.
- [ ] Preserve explicit capture only and make Camera status/preview visible inside the fixed AI tools drawer.
- [ ] Run the focused test and confirm GREEN.

### Task 3: Context-aware on-demand Ask AI

**Files:**
- Create: `live_backend/app/coach_ask.py`
- Modify: `live_backend/app/main.py`
- Modify: `live/live.js`
- Test: `live_backend/tests/test_coach_ask.py`
- Test: `live/student-live-real-interaction.test.cjs`

**Interfaces:**
- Produces: `POST /api/live/sessions/{session_id}/ask` with `{question, image_data?}`.
- Returns: `{classification, answer, rag_status, vision_used, teacher_required, uncertainty}`.

- [ ] Write failing Backend tests for next-step context, one-frame visual query, low-confidence/no-hit fallback, and safety escalation.
- [ ] Run tests and confirm RED.
- [ ] Implement controlled context construction, question classification, at-most-two concurrent visual jobs, existing VisionAdapter use, and existing RAGAdapter use.
- [ ] Write failing frontend tests proving non-visual questions send no image and visual questions capture one frame.
- [ ] Connect text and speech transcript submission to the existing endpoint with explicit provider fallback.
- [ ] Run focused suites and confirm GREEN.

### Task 4: Regression, tunnel, and verification

- [ ] Run Live Backend, JavaScript/Frontend/Worker, Python compile, and Django regressions.
- [ ] Verify zero protected files are staged.
- [ ] Commit small scoped changes.
- [ ] Restart existing dev services and Quick Tunnel; verify `/live/`, assets, Backend, and Vision.
- [ ] Report Voice Provider as CONNECTED or NOT_CONFIGURED from actual implementation and leave iPhone acceptance PENDING.
