# Phase 1B Backpressure Design Note — Not Implemented

If Phase 1B is later approved, use one inference request in flight at a time. While it runs, retain only the newest captured frame (`latest-frame-wins`) and discard superseded frames (`drop-stale-frame`). Include a monotonically increasing frame ID and ignore responses older than the newest rendered frame.

This note is design-only. Phase 1A.2 remains manual HTTP Snapshot and starts no automatic 1–2 FPS loop or WebSocket.

