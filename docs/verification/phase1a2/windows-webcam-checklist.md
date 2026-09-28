# Windows Webcam Manual Verification

Status: **NOT TESTED**

Tester/date/device/browser: ____________________

1. Start `ops/v2/start-phase1a.ps1`, then open the Phase 1A.2 HTTPS URL.
2. Confirm Backend and Vision show Online.
3. Select **Start Camera** and allow camera access.
4. Confirm live Webcam preview and expected camera.
5. Select **Detect** once; confirm JPEG capture, detection JSON, and aligned boxes.
6. Record capture resolution, encoded bytes, capture/encode/round-trip metrics and errors.
7. Select **Stop Camera**; confirm the camera indicator turns off.
8. Leave and reopen the page; confirm camera can be acquired again.
9. Stop Live Backend; confirm the page displays Offline without a white screen.

Result: NOT TESTED / PASS / FAIL: __________

