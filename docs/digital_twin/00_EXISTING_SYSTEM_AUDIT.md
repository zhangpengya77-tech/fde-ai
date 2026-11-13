# 00 Existing System Audit

This document is the canonical Phase 0 audit entrypoint. The detailed protected baseline is in [PHASE0_BASELINE.md](PHASE0_BASELINE.md).

## Confirmed existing assets

- WEB LITE `FlightSession` is the browser-only authority for existing training sessions.
- `FlightEngine` allows an additive `SitlEngine` without replacing runner, scoring, scene, replay or input adapters.
- Physics Pro UI/client draft already exists as uncommitted work and must be preserved.
- The gateway initially has no real flight-stack adapter and its labels explicitly state `not_connected`.

## Non-goals for this phase

- No production deployment, database or learner-data change.
- No change to current examination rules or marks.
- No real aircraft discovery, serial access, LAN MAVLink, parameter write or mission upload.
