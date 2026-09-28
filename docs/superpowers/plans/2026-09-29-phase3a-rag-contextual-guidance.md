# Phase 3A RAG Contextual Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-blocking, backend-controlled contextual RAG explanations to Live Coach while preserving SOP authority and Phase 2 Vision backpressure.

**Architecture:** An async RAG adapter and backend context builder feed a contextual guidance coordinator after SOP and Session update. Snapshot responses return immediately with deterministic guidance and pending/cached explanation state; background tasks update Session explanation state and events only when context freshness checks pass.

**Tech Stack:** Python 3.14, Starlette, httpx, dataclasses, asyncio, unittest/TestClient, browser JavaScript, Node test runner, HTML/CSS.

**Spec:** `docs/superpowers/specs/2026-09-29-phase3a-rag-contextual-guidance-design.md`

## Global Constraints

- Work only in `D:\FDE-AI-UAS-v2.0` on `fde-ai-v2.0-dev`.
- Do not modify v1.5C, best.pt, thresholds, RAG Corpus, Production Worker/Tunnel/ORIGIN_URL, production DB, or stable tags.
- Live Backend is the only port 8770 caller; Frontend never receives the RAG origin.
- RAG never mutates SOP decisions, current step, counters, completion, or TEACHER_CHECK.
- Snapshot/Simulation authoritative response never awaits RAG.
- Default RAG timeout is 8 seconds and independently configurable.

## Review Focus

- A slow or cancelled RAG task must not delay or fail a snapshot response.
- A completed task, deleted session, new step, or superseding request must reject stale RAG text.
- Repeated 1 FPS identical SOP events must not cause repeated RAG requests.
- Malicious control language in RAG text must remain display-only.
- Fallback and safety UI must stay explicit without inventing source metadata.

---

### Task 1: Async RAG adapter contract

**Files:**
- Create: `live_backend/app/rag.py`
- Create: `live_backend/tests/test_rag.py`
- Modify: `live_backend/app/config.py`

**Interfaces:**
- Produces: `RAGAdapter.health() -> awaitable[bool]`
- Produces: `RAGAdapter.query(question: str, request_id: str, context_version: int) -> awaitable[RAGResult]`
- Produces: immutable `RAGResult.as_dict()`

- [ ] Write failing tests for health success/offline, query success, timeout, HTTP error, invalid JSON/schema, empty response, no hit, real metadata preservation, and latency.
- [ ] Run `python -m unittest tests.test_rag -v`; verify RED because `app.rag` is missing.
- [ ] Implement the minimal adapter using injected `httpx.AsyncClient`, `/api/rag/health`, `/api/rag/ask`, error normalization, and 8-second configured timeout.
- [ ] Run focused and full Live Backend tests; verify GREEN.
- [ ] Commit: `feat: add async rag adapter`.

### Task 2: Backend-only RAG context contract

**Files:**
- Create: `live_backend/app/rag_context.py`
- Create: `live_backend/tests/test_rag_context.py`
- Modify: `live_backend/app/sessions.py`

**Interfaces:**
- Consumes: `LiveSession`, current `SopStep`, `DetectionFact`, backend events.
- Produces: immutable `RAGContext`, `RAGContextBuilder.build(...)`, and `build_question(context)`.
- Produces: Session fields `context_version`, `rag_explanation`, and bounded recent error extraction.

- [ ] Write failing tests proving all fields come from backend objects, history is newest five errors, frontend-like input cannot override context, and step advance increments context version.
- [ ] Run focused tests; verify RED because builder/session fields are missing.
- [ ] Implement the minimal builder and Session fields without accepting client context.
- [ ] Run focused and full Live Backend tests; verify GREEN.
- [ ] Commit: `feat: add backend rag context builder`.

### Task 3: Non-blocking contextual guidance coordinator

**Files:**
- Modify: `live_backend/app/guidance.py`
- Create: `live_backend/app/rag_guidance.py`
- Create: `live_backend/tests/test_rag_guidance.py`
- Modify: `live_backend/app/orchestrator.py`
- Modify: `live_backend/app/main.py`

**Interfaces:**
- Consumes: `RAGAdapter`, `RAGContextBuilder`, authoritative Session/SOP output.
- Produces: `ContextualGuidanceCoordinator.schedule(...) -> bool`, `RAGGuidanceProvider.explain(context)`, and separate `rag_explanation` response state.

- [ ] Write failing tests for NG, NO_DETECTION, UNCERTAIN, PASS_CANDIDATE, RAG failure continuity, immediate response/non-blocking scheduling, and no Session/SOP mutation.
- [ ] Run focused tests; verify RED.
- [ ] Implement scheduling after authoritative processing; deterministic guidance remains synchronous and response returns pending/cached state immediately.
- [ ] Run focused and full Live Backend tests; verify GREEN.
- [ ] Commit: `feat: add contextual rag guidance`.

### Task 4: Deduplication, stale protection, events, and safety

**Files:**
- Modify: `live_backend/app/rag_guidance.py`
- Modify: `live_backend/app/sessions.py`
- Create: `live_backend/tests/test_rag_safety.py`
- Modify: `live_backend/tests/test_phase2_workflow.py`

**Interfaces:**
- Consumes: Session `context_version`, request ID, event sequence, latest request per session.
- Produces: trigger dedup key and RAG events/metrics.

- [ ] Write failing tests for duplicate suppression, new error trigger, new-step trigger, deleted/completed/superseded stale drop, event monotonicity, TEACHER_CHECK protection, and fake PASS/NG/authorization text.
- [ ] Run focused tests; verify RED.
- [ ] Implement dedup/cache, freshness checks, RAG metrics, events, fixed safety guidance, and display-only explanation storage.
- [ ] Run focused and full Live Backend tests; verify GREEN.
- [ ] Commit: `feat: protect rag guidance state`.

### Task 5: Live Coach explanation UI

**Files:**
- Modify: `live/index.html`
- Modify: `live/live.css`
- Modify: `live/live.js`
- Modify: `live/task-ui.test.cjs`

**Interfaces:**
- Consumes: backend `rag_explanation` only.
- Produces: separate AI Explanation, Knowledge Source, RAG Status, and RAG Latency rendering plus session polling while pending.

- [ ] Write failing Node tests for separate fields, pending/fallback/online rendering, no port 8770/browser RAG call, and TEACHER_CHECK fixed copy.
- [ ] Run focused Node tests; verify RED.
- [ ] Implement minimal markup, rendering, and bounded backend polling without changing Auto Scheduler.
- [ ] Run focused and full JavaScript suites; verify GREEN.
- [ ] Commit: `feat: add rag explanation ui`.

### Task 6: Integration verification and handoff

**Files:**
- Modify: `PROJECT_CONTEXT.md`
- Modify: `V2_ARCHITECTURE.md`
- Modify: `DEV_HANDOFF.md`
- Create: `docs/verification/phase3a-rag-integration-report.md`

**Interfaces:**
- Consumes: verified Phase 3A behavior and test evidence.
- Produces: durable handoff and final metrics/known-issues record.

- [ ] Add integration tests covering all ten approved scenarios and confirm Vision scheduler max in-flight 1 / queue 0.
- [ ] Measure current local RAG health/query latency without modifying Corpus.
- [ ] Run Live Backend, all JavaScript/Worker/Phase tests, Django regression, Python compile, git diff check, and v1.5C final verification.
- [ ] Update handoff/report with only observed evidence.
- [ ] Commit: `test: cover phase3a rag boundaries` and `docs: update phase3a handoff`.
