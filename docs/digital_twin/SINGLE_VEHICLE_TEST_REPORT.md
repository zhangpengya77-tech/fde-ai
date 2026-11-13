# Single Vehicle Test Report

Date: 2026-11-10

| Test | Result | Evidence |
| --- | --- | --- |
| Existing SitlEngine contract | PASS | `npm test -- tests/unit/rea-sitl-client.test.ts`: 8/8 |
| Gateway loopback/config/command gate | PASS (mock contract) | `python tests/python/test_gateway_contract.py`: 3/3 |
| Existing FDE-DT ArduPilot SITL | PASS (real) | Existing local FDE-DT service, `ArduCopter Copter-4.7.2 (fb77356789)`; 2026-11-10 E2E record `D:\FDE-DT\logs\codex-e2e-20261110.json` |
| MAVLink HEARTBEAT | PASS (real) | Same E2E record: System ID 251, autopilot 3, vehicle type 2 |
| Physics Pro browser → SITL | PASS (real) | `npx.cmd playwright test tests/browser/rea-physics-pro.spec.ts --project=desktop-chrome`: 1/1 in 56.6s; engine switch, READY, arm, keyboard climb, altitude >1m, reset/session release |
| Gazebo scene | NOT RUN | No Gazebo installation or approved capacity allocation |
| USB RadioMaster Physics Pro | PENDING_MANUAL | Existing browser adapter remains preserved; no device claim |

The real test ran only against `127.0.0.1` through the existing FDE-DT WSL service. It did not connect to a physical flight controller, LAN endpoint, or public address. After test completion, the specifically started gateway and its SITL child were stopped; ports 8200/8201/8210/8211/8220/8221/8230 had no listener.

No mock result in this document is evidence of a real flight stack pass.
