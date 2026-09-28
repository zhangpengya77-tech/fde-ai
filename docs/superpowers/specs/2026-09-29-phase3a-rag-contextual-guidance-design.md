# FDE-AI-UAS v2.0 Phase 3A RAG Contextual Guidance Design

Date: 2026-09-29  
Status: Approved for implementation  
Branch: `fde-ai-v2.0-dev`  
Baseline: `36f3931fc766cc01cfae517ff4fb99ec19c1a84f`

## Purpose

Phase 3A adds contextual knowledge explanations to Live Coach without moving teaching authority away from the backend SOP Engine. Vision produces facts, SOP produces decisions, Session owns state, Deterministic Guidance returns immediate actions, and RAG only supplies untrusted explanatory text.

## Non-goals

No Realtime Voice, microphone streaming, OpenAI/LLM API, API keys, production deployment, Learning Record write, Teacher Dashboard, model retraining, threshold change, RAG Corpus change, or v1.5C change.

## Authority boundaries

- Vision outputs detection facts only.
- SOP Engine remains the only producer of `PASS_CANDIDATE`, `NG`, `UNCERTAIN`, `NO_DETECTION`, and `TEACHER_CHECK`.
- Session Service alone owns current step, state, counters, events, step completion, and task completion.
- Deterministic Guidance is immediate and always available.
- RAG Explanation is untrusted educational content and cannot mutate SOP or Session state.
- Frontend renders backend output and cannot submit authoritative context.

## Critical-path isolation

The snapshot/simulation request completes after Vision, SOP, Session update, and deterministic guidance. It does not await RAG.

After the authoritative response is available, the backend schedules an asynchronous explanation request. The frontend polls the existing backend session endpoint for explanation state. RAG latency, timeout, offline state, malformed responses, no-hit results, and connection resets never block Camera, Vision, SOP, Manual Detect, or Auto Observation.

## Existing RAG endpoint mapping

The existing local service is used without modification:

- Health: `GET http://127.0.0.1:8770/api/rag/health`
- Query: `POST http://127.0.0.1:8770/api/rag/ask`
- Request body: JSON object containing a single `question` field; the service currently accepts the existing text/plain JSON transport.
- Response fields currently supported: `answer`, `source_type`, and optional `version`. Optional source/confidence fields are retained only when actually supplied.

Only Live Backend may call port 8770. No Live Coach browser code contains or calls the RAG origin.

## Components

### RAGAdapter

`live_backend/app/rag.py` contains an async adapter with dependency-injected HTTP transport. It provides:

- `health()`
- `query(question, request_id, context_version)`
- independent timeout
- HTTP and connection error normalization
- JSON/schema validation
- empty/no-hit detection
- measured `latency_ms`
- standardized `RAGResult`

Default development timeout is 8 seconds. It is configurable through `FDE_LIVE_RAG_TIMEOUT_SECONDS`. The timeout affects explanation availability only.

### RAGContextBuilder

`live_backend/app/rag_context.py` constructs an immutable `RAGContext` exclusively from:

- Backend Session
- current SOP definition
- current Detection Fact
- Backend Event history

Contract:

- `course_id`
- `task_id`
- `step_id`
- `step_title`
- `instruction`
- `expected_class`
- `detected_class`
- `confidence`
- `sop_result`
- `error_code`
- `recent_error_history` (maximum five)
- `session_id`
- `event_sequence`
- `context_version`

The frontend cannot provide or override these values.

### RAGGuidanceProvider

The provider converts the controlled context into a bounded F450 teaching question. It requests:

1. why the observation does or does not match the current step;
2. the relevant component distinction or recognition issue;
3. what the learner can safely do next.

It explicitly states that RAG must not judge PASS/NG or authorize a safety action. The returned answer is still treated as untrusted text.

### ContextualGuidanceCoordinator

The coordinator owns trigger deduplication, asynchronous task scheduling, result application, stale-result checks, metrics, and RAG events. It does not evaluate SOP.

## Trigger and dedup rules

RAG is triggered by a teaching event, never by every 1 FPS frame. Eligible results are:

- SOP result transition;
- changed `error_code`;
- changed detected class for NG;
- new step/context version;
- `PASS_CANDIDATE`;
- `TEACHER_CHECK`.

Dedup key:

`session_id | step_id | sop_result | error_code | detected_class`

Only the newest request for a session may update explanation state. Repeated identical frames reuse the current pending/completed explanation and do not query RAG again.

## Context version and stale protection

Each request records:

- `session_id`
- `step_id`
- `context_version`
- `request_id`
- `event_sequence`

Before applying a result, the coordinator verifies:

- session still exists;
- task is not completed;
- current step matches;
- session context version matches;
- request is still the newest explanation request.

Failure produces `RAG_STALE_DROPPED`; stale text never overwrites the current explanation.

The Session increments `context_version` when it advances to another step. A newer explanation request supersedes an older request within the same step.

## Response contract

The backend exposes a separate `rag_explanation` object:

- `status`: `pending | online | fallback | no_hit | timeout | offline | error | stale`
- `explanation`
- `reference_summary`
- `sources`
- `latency_ms`
- `hit`
- `error_code`
- `request_id`
- `context_version`

Unsupported metadata stays null or empty; no document title, page, source, or confidence is invented.

## Safety guard

For `TEACHER_CHECK`, deterministic guidance and the UI always retain:

“此步骤涉及安全操作，必须由教师确认后才能继续。”

RAG may explain risks, principles, and checks. Its text cannot call confirm, update state, or bypass the gate. Strings such as PASS, NG, “允许继续”, “可以起飞”, or “可以通电” remain explanatory text only.

## Events and metrics

Session events:

- `RAG_REQUESTED`
- `RAG_COMPLETED`
- `RAG_NO_HIT`
- `RAG_TIMEOUT`
- `RAG_FALLBACK`
- `RAG_ERROR`
- `RAG_STALE_DROPPED`

Metrics:

- request count
- success count
- fallback count
- timeout count
- no-hit count
- stale-drop count
- last/average RAG latency

All events use the existing backend monotonic sequence.

## UI

The task panel keeps separate fields for:

- SOP Result
- AI Guidance
- AI Explanation
- Knowledge Source
- RAG Status
- RAG Latency

Pending text is “正在查询教学知识…”. Fallback text is “目前知识库说明暂时不可用。” SOP Result and deterministic Guidance render immediately.

## Testing

TDD covers adapter health/query/error paths, backend-only context integrity, the required NG/NO_DETECTION/UNCERTAIN/PASS_CANDIDATE/TEACHER_CHECK scenarios, fake control language, deduplication, stale results, non-blocking response timing, fallback continuity, UI separation, and the unchanged one-in-flight Vision scheduler.

## Protected assets

`D:\FDE-AI-UAS\v1.5C`, `best.pt`, thresholds, RAG Corpus, Production Worker/Tunnel/ORIGIN_URL, production database, and stable tags are not modified.
