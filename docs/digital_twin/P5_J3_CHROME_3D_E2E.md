# P5-J3 Chrome Three.js mission E2E

Status: **IN PROGRESS — first same-session acceptance PASS; five-run batch pending.**

## 2026-11-11 same-session G5 evidence

- Run: `p5j2-g5-a985ce6a54ba` (isolated WSL artifact; no ticket value recorded here).
- Gateway accepted a short-lived, identity-bound read subscription: `read_subscribers=1`.
- Chrome Playwright: **1 passed**. The browser neither POSTed nor DELETEd `/sessions`.
- The controlled Runner, not Chrome, completed the existing SITL ARM/AUTO/RTL/Disarm path; final MAVLink progress reported `last_reached_seq=5`.
- Browser observer and Runner shared the newly created session / simulation instance / SYSID 251 / COMPID 1 by ticket claims and client-side `telemetry_v2` identity validation.
- Cleanup: Gateway controlled SIGTERM `-15`, Gazebo exit `0`, ports `8200/8201/8210/9002/5760` released.
- Screenshot: `.playwright-output/p5j3-mission-attach-P5-J3--9df1d-on-telemetry-驅動-Three-js-高度-desktop-chrome/p5j3-mission-attach.png`.

The initial attach failure was an aiohttp subprotocol negotiation mismatch, followed by a Playwright Node-context `document` reference. Both had minimal test-covered fixes. No raw read-ticket is retained in this report; the earlier leaked historical Gateway log remains restricted and must not be distributed.

Existing evidence remains limited to the earlier real Chrome Physics Pro takeoff acceptance: Gazebo/SITL/Gateway telemetry drove the Three.js model and HUD with height error below 0.05 m. It did not observe this P5-J3 mission session.

The current `/?mode=gcs` entry deliberately renders an offline teaching plan and keeps Upload/AUTO/RTL disabled without a controlled session. Therefore it cannot truthfully demonstrate the new Gateway MissionVerification, AUTO progress, or RTL trajectory in Chrome.

Required next implementation: a session-bound, token/Origin-protected browser adapter that consumes existing `telemetry_v2` and `mission_progress`, without replacing Web Lite or creating a second MAVLink receiver. It must be tested during the same G5 mission lifecycle and save screenshots/trace/telemetry error measurements.

## 2026-11-12 final isolated evidence

Status: **PASS — READY FOR MANUAL ACCEPTANCE (not Production Ready).**

The original paragraph above is retained as historical context. It has now been
completed by a current-session, read-only adapter and six real isolated runs:

- Baseline: `p5j2-g5-8f030097332d`.
- Five independent cold starts: `p5j2-g5-cb4cf82c47a4`, `p5j2-g5-4c4162377582`, `p5j2-g5-59070765ae0b`, `p5j2-g5-b1e4857988c7`, and `p5j2-g5-fe46ff7d374e`.
- Artifacts: `/home/fde/fde_p5j3_flight_runs/<run_id>/result.json`.

Every artifact records no error, both Chrome observers with exit `0`, Mission
verification, ARM → AUTO → ordered flight completion → RTL → Disarm,
`MISSION_ITEM_REACHED=5`, real Chrome STALE before Runner-owned Session
DELETE, then real DISCONNECTED after DELETE. The flight observer verifies the
same session/instance/SYSID/COMPID, read-only behavior, source/render sample
alignment, ENU-to-Three.js position, HUD height (<0.05 m), quaternion
attitude, AUTO MISSION_CURRENT history, RTL, and final `armed=false`.

The ticket remains short-lived and read-only. A fresh, separately issued ticket
is used only for the post-flight stale/disconnect observer; it is not an
extension, is not stored in reports, URLs, screenshots, or browser controls.
