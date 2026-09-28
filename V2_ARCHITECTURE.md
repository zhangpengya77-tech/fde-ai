# FDE-AI-UAS v2.0 Architecture — Phase 2

## Actual vision architecture

`Browser /live/` → HTTP → `Live Backend 127.0.0.1:8030` → HTTP → `Snapshot Vision 127.0.0.1:8765` → imports existing `yolo_server.Detector` and loads existing `best.pt` → Ultralytics prediction → clean JSON → browser overlay.

Live Backend and YOLO are separate processes. The Vision wrapper imports Detector code; Live Backend does not import Detector and does not perform inference in-process.

## Timing boundaries

- Browser: `capture_ms`, `encode_ms`; request code currently records a combined fetch round trip.
- Vision: `server_decode_ms`, inference-lock `queue_wait_ms`, `model_preprocess_ms`, Ultralytics `model_inference_ms`, and `postprocess_ms`.
- Live Backend: `vision_upstream_ms` and `backend_ms`.
- External test client: `total_round_trip_ms` and response bytes.

`vision_upstream_ms` is never described as model inference. Pure inference comes from Ultralytics `result.speed.inference`.

## Image policy

New browser captures are bounded within 640×480 and default to JPEG quality 0.75. WebP quality 0.75 is supported for controlled comparison; JPEG remains the compatibility default. File-upload images remain accepted within the server size limit.

## Trust and deployment boundary

Demo sessions are in-memory and do not write Django data. The browser cannot assert identity, permissions, or PASS/NG. Phase 1A.1 does not deploy Cloudflare changes or modify production origins.

## Phase 2 Backend Modular Authority

```text
Vision Facts -> Coach Orchestrator -> SOP Engine -> Session/Event State
                                  -> Guidance Provider
                                  -> Authoritative API -> Live Coach UI
```

- `app/sop.py`: configurable course/task/step schema and the only teaching-decision engine.
- `app/sessions.py`: authoritative in-memory state machine, counters, confirmation, and monotonic events.
- `app/guidance.py`: deterministic guidance plus non-network RAG/Voice interfaces.
- `app/orchestrator.py`: coordination only; it cannot bypass SOP or confirm steps.
- `app/mock_vision.py`: Dev/Test-only deterministic Detection Facts.
- `app/main.py`: compatible Snapshot API plus session, confirm, events, simulate, and lifecycle routes.
- `live/auto-observation.js`: 1 FPS scheduler with at most one in-flight request and no queue.

REAL_VISION can produce `PASS_CANDIDATE` only and requires backend confirmation. Safety-gated definitions produce `TEACHER_CHECK` and ordinary student confirmation is rejected. Production configuration returns `dev_only` for Mock Vision calls.
# Phase 3A: Contextual RAG Guidance

```text
Camera → Vision Fact → SOP Engine → Session → Deterministic Guidance → immediate response
                                      └→ async RAG Context → RAG :8770 → Session explanation/event
```

Live Backend is the only RAG caller. RAG explanation is display-only, deduplicated by session/step/result/error/detected class, protected by request/context versions, and discarded when stale. `TEACHER_CHECK` cannot be overridden.
