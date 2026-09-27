# FDE-AI-UAS v2.0 Phase 1A Live Vision Design

## Goal

Prove the smallest live-vision path without modifying the v1.5C stable base: a browser captures one camera frame, sends it through the development Live Backend, the Vision Adapter calls the existing YOLO service at `127.0.0.1:8765`, and clean detection facts return to the browser for client-side box rendering.

## Approved Scope

- Branch: `fde-ai-v2.0-dev`, based on commit `12cabfb`.
- Independent Starlette/Uvicorn Live Backend on development port `8030`.
- In-memory DEMO/DEV sessions only.
- `GET /api/live/health`.
- `POST /api/live/sessions`.
- `POST /api/live/sessions/{id}/snapshot`.
- `DELETE /api/live/sessions/{id}`.
- A standalone `Live Coach MVP` browser page using `getUserMedia` with `facingMode: environment`.
- Manual single-frame capture and client-side detection overlay.
- A development-only supervisor that starts and stops the Live Backend and the existing YOLO server.
- A development Worker routing example/configuration that never updates the production `ORIGIN_URL` or deploys anything.

## Explicit Exclusions

No WebSocket, automatic FPS loop, voice, RAG, SOP, PASS/NG decision, teacher dashboard, formal learning records, model retraining, annotated-image response, production deployment, named-tunnel migration, or changes to the v1.5C worktree.

## Components

### Live Backend

The backend owns request validation, health reporting, in-memory session lifecycle, timing metadata, and stable JSON errors. It accepts image data as a `data:image/...;base64,...` string for the single-snapshot Phase 1A path. Request size is bounded before forwarding.

### Vision Adapter

The adapter calls the existing YOLO `POST /api/detect` endpoint. It strips all YOLO conclusions and presentation fields. The public response contains only `class`, `confidence`, and `box` for each detection, plus frame/session identifiers and timing/response-size diagnostics.

The adapter never forwards `status`, `score`, `summary`, `teacherStatus`, `checklist`, `motorChecks`, `annotatedImage`, or local model paths.

### In-memory Session Store

Sessions are random UUIDs with `mode=demo`, creation time, and last activity time. They are process-local and disappear when the backend stops. They never write Django SQLite or accept a student identity from the browser.

### Browser Test Page

The page is isolated under `live/` and does not alter existing home-page behavior. It checks backend health, creates a demo session, requests the rear camera, captures one canvas frame, submits it manually, renders detection boxes over the preview, lists class/confidence values, records timing metrics, and stops all media tracks on explicit stop or page exit.

### Development Routing

The committed Worker example routes only `/api/live/*` and `/live/*` to a separate development `LIVE_ORIGIN_URL`. It does not contain production credentials, does not change the existing Worker project, and is not deployed in Phase 1A.

## API Contracts

### `GET /api/live/health`

Returns HTTP 200 with `status=online` when both Live Backend and YOLO health are available, otherwise `status=degraded` and `vision=offline`. It never exposes local filesystem paths.

### `POST /api/live/sessions`

Accepts `{ "mode": "demo" }` or an empty object. Returns a generated session ID. Any submitted student identity or formal-course authority fields are rejected.

### `POST /api/live/sessions/{id}/snapshot`

Accepts `frame_id`, `image_data`, optional `file_name`, and optional confidence threshold. Returns clean detections and timing fields. Missing sessions return 404. Invalid images return 400/413. YOLO unavailability returns 503 with a stable error code.

### `DELETE /api/live/sessions/{id}`

Deletes only the in-memory demo session. Repeating the request returns 404.

## Failure Handling

- YOLO offline: health is degraded; snapshot returns a stable 503 JSON error.
- Live Backend offline: the static page remains loadable and displays Offline after a bounded health timeout.
- Camera denied: static content and file input remain usable; no page crash.
- Invalid YOLO response: snapshot returns 502; internal details are not exposed.
- Session missing/expired: snapshot returns 404 and the UI can create a new demo session.

## Security and Data Handling

- Development CORS is allow-listed through `FDE_LIVE_ALLOWED_ORIGINS`; it is never `*` by default.
- Only data-image URLs are accepted and decoded with strict size bounds.
- No frames, credentials, student records, or API keys are persisted.
- The browser cannot submit PASS, teacher authority, or trusted student identity.
- The backend binds to `127.0.0.1` by default; external access is through the development Cloudflare path only.

## Verification

Automated tests cover health/degraded behavior, session lifecycle, forbidden identity fields, Vision Adapter sanitization, snapshot errors, frontend camera lifecycle, manual capture, overlay geometry, offline UI, and development routing isolation. Manual Android Chrome and iPhone Safari tests require physical devices and are recorded as pending unless actually executed.
