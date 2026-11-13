# P4 Regression Report

| Verification | Result | Evidence |
| --- | --- | --- |
| Existing FDE-DT Python tests | PASS | 29 passed (prior Phase 3 evidence) |
| Real ArduCopter SITL gateway E2E | PASS | `D:\FDE-DT\logs\codex-e2e-20261110.json` |
| Targeted Physics Pro browser + real SITL | PASS | 1 passed, 56.6s |
| WEB LITE Vitest | PASS | Re-run after P4-B: 65 files / 855 tests |
| TypeScript + Vite build | PASS | Re-run after P4-B: `npm run build`; existing Three.js chunk-size warning only |
| Full Web Lite Playwright | PARTIAL | 156 passed / 12 skipped / 2 known RC timing failures |
| Failed RC test isolated rerun | PASS | 1 passed, 9.6s |
| Gazebo Harmonic + official plugin build | PASS | `gz sim 8.15.0`; four official plugin libraries built |
| Gazebo single vehicle HEARTBEAT + telemetry | PASS | `gazebo-sitl-mavlink-stream-20261110.json` |
| Gazebo arm/takeoff/hover/land | PASS | `gazebo-sitl-guided-flight-rerun-20261110.json` |
| Browser rendering from registered Gazebo gateway | BLOCKED | No approved external-Gazebo registration path in existing dirty FDE-DT gateway tree |
| QGC single vehicle | NOT RUN | Interface design only; no cross-project runtime started |
| RadioMaster Physics Pro hardware | PENDING_MANUAL | No physical-device claim |

## Cleanup

The owned P4-B Gazebo and ArduCopter processes were stopped after validation. Local simulation ports 9002 and 5760 were released. No production service was started or changed.
