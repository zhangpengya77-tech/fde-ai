# 06 Acceptance Tests

## Test matrix

| Layer | Required evidence | Current status |
| --- | --- | --- |
| WEB LITE | existing unit/browser/build regression | Pending full regression for this increment |
| Engine client | SitlEngine coordinate/session/error unit test | PASS, 8 tests |
| Gateway core | localhost / token / state / RC rate test | PASS, mock contract only |
| Gateway transport | HTTP health/session + WS ack | PASS, mock contract only |
| ArduPilot SITL | process, heartbeat, telemetry, log, fail-safe | NOT RUN |
| Gazebo | minimal world, sensor state, disconnect | NOT RUN |
| USB controller | real device calibration and disconnect | PENDING_MANUAL |

## Pass rule

SITL and Gazebo can be marked PASS only with a recorded version, command, endpoint, test output and clean shutdown evidence. A mock adapter is never a substitute.
