# Phase 1A Manual Test Matrix

| Target | Camera preview | Capture/upload | Overlay | Rotate/resize | Deny permission | Offline | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| Windows Chrome + webcam | pending | pending | pending | pending | pending | pending | Physical test required |
| Android Chrome | pending | pending | pending | pending | pending | pending | HTTPS device test required |
| iPhone Safari | pending | pending | pending | pending | pending | pending | HTTPS device test required |
| Windows file upload | n/a | pass | API detections pass | automated mapping pass | n/a | automated pass | Partial pass |

Automated coverage verifies rear-camera constraints without microphone, one-frame capture, track shutdown, letterbox coordinate mapping, upload timing, and offline health behavior. It does not replace physical permission, camera, and viewport testing.

