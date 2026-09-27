# FDE-AI-UAS v2.0 Architecture — Phase 1A

## Runtime flow

`Browser /live/` → `HTTP /api/live/*` → `Live Backend :8030` → `Snapshot Vision :8765` → existing `yolo_server.Detector` → clean detections → browser overlay.

The Phase 1A vision wrapper imports the existing detector but does not construct HoverScorer or Voice services. This preserves the existing model pipeline while removing an unrelated hover-model startup dependency from the live snapshot path.

## Modules

- `live/`: mobile-friendly camera/file UI, capture, upload timing, and canvas overlay.
- `live_backend/app/`: session API, snapshot validation, health, and YOLO adapter.
- `live_backend/dev/vision_snapshot_server.py`: development-only detector wrapper with `/api/health` and `/api/detect`.
- `ops/v2/`: start, stop, and status scripts for ports 8030 and 8765.
- `cloudflare/dev-phase1a/`: isolated route example for `/live*` and `/api/live/*`, using only `LIVE_ORIGIN_URL`.

## API contract

- `GET /api/live/health`: aggregate component health; degradation is explicit.
- `POST /api/live/sessions`: creates an in-memory demo session.
- `POST /api/live/sessions/{id}/snapshot`: accepts a bounded image data URL and returns frame/session IDs, detection facts, and timing.
- `DELETE /api/live/sessions/{id}`: removes the in-memory session.

No annotated image, model path, AI narrative, PASS/NG, or other business decision is returned.

## Failure behavior

Camera permission failure leaves file upload available. Vision failure produces stable `vision_offline`/503 behavior without internal addresses. The development Worker health route reports offline safely, and non-live paths never fall through to a production origin.

## Deferred architecture

Streaming/WebSocket transport, authenticated student sessions, voice, RAG, SOP decisions, teacher workflows, persistent storage, observability, and production routing belong to later approved phases.

