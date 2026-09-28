# FDE-AI-UAS v2.0 Phase 3A RAG Integration Report

Date: 2026-09-29

## Architecture

Phase 3A preserves Backend Modular Authority. Vision emits facts, SOP alone emits teaching decisions, Session owns state/events, Deterministic Guidance returns immediately, and RAG asynchronously adds untrusted educational explanation.

RAG is outside the Camera → Vision → SOP critical path. Manual and Auto Snapshot responses return without awaiting port 8770.

## Endpoint mapping

- Health: `GET http://127.0.0.1:8770/api/rag/health`
- Query: `POST http://127.0.0.1:8770/api/rag/ask`
- Backend only; Live Coach frontend contains no port 8770 or RAG endpoint.

## Context contract

Backend constructs course/task/step identifiers, step title/instruction, expected and detected class, confidence, SOP result, error code, and newest five error events. Frontend payload cannot override context.

## Dedup and stale protection

The dedup key is session, step, SOP result, error code, and detected class. Repeated identical 1 FPS frames do not generate repeated RAG requests. Each request carries request ID, step, context version, and event sequence. Newer requests, step changes, completed/deleted sessions, and version mismatch prevent stale application.

## Safety and fallback

RAG text cannot update state, pass count, current step, completion, or TEACHER_CHECK. Safety guidance always retains the teacher-confirmation notice. Offline, timeout, HTTP error, invalid response, empty response, and no hit retain deterministic guidance and show a non-blocking fallback explanation.

## Events and metrics

Events: RAG_REQUESTED, RAG_COMPLETED, RAG_NO_HIT, RAG_TIMEOUT, RAG_FALLBACK, RAG_ERROR, and RAG_STALE_DROPPED.

Metrics: request, success, fallback, timeout, no-hit, stale drop, last latency, and average latency.

## UI

SOP Result, AI Guidance, AI Explanation, Knowledge Source, RAG Status, and RAG Latency render independently. Pending explanations are refreshed through the Live Backend Session API.

## Verification

- Live Backend: 53 passed
- JavaScript/Worker/Phase 1/1A.2/2/3A: 68 passed
- Django: 238 passed, 22 skipped
- Django system check: no issues
- Python compile: passed
- Phase 2 scheduler remains max Vision in-flight 1 and queue length 0

## Local RAG measurement

- Health: HTTP 200, 4.7 ms
- Health metadata: version f450_v1, document_count 1105, index_loaded true
- Sample query: HTTP 200, 259.5 ms
- Sample result: source_type refuse; treated as no hit
- Development timeout: 8 seconds, independently configurable

## Protected assets and known issues

The RAG Corpus, best.pt, thresholds, Production configuration, and v1.5C were not modified. `MODEL_ACCURACY_PENDING` remains. Explanation availability depends on the local RAG service and its corpus coverage.
