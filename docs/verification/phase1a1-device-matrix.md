# Phase 1A.1 Device Matrix

| Target | Status | Evidence / blocker |
|---|---|---|
| Windows file upload / HTTP | Pass | Real labeled image reached YOLO; 17 detections; split server metrics returned. |
| Windows Webcam | Blocked | Windows UI automation helper exited twice before browser/camera interaction. Automated camera lifecycle tests pass but are not a physical test. |
| Android Chrome | Pending | No connected Android device and no dev-only HTTPS origin was deployed. |
| iPhone Safari | Pending | No connected iPhone and no dev-only HTTPS origin was deployed. |

No production Worker, `ORIGIN_URL`, Tunnel, or public deployment was changed.

