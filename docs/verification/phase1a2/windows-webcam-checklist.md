# Windows USB Webcam Verification

Status: **PARTIAL PASS — real camera chain verified; normal-browser permission and F450 target box require user confirmation**

Automated diagnostic date: 2026-09-28

- Device: Logi C310 HD WebCam (USB VID 046D / PID 081B)
- Windows PnP: Started
- OpenCV: index 0, 640×480, 15/15 frames read; indices 1–4 unavailable
- Browser: isolated Chrome diagnostic profile, Dev HTTPS Quick Tunnel
- Camera device selector: Logi C310 HD WebCam (046d:081b)
- Preview: PASS, 640×480 at reported 30 FPS
- Continuous preview: PASS, 60.03 seconds
- JPEG snapshot: PASS, 20,715 bytes at quality 0.75
- Encode: 17.7 ms
- Model inference: 183.8 ms
- Total round trip: 1,289.6 ms
- Backend / Vision: ONLINE / ONLINE on fresh health request
- Stop: PASS; srcObject cleared and controls reset
- Restart: PASS; track returned to live at 640×480
- Snapshot API / detection JSON: PASS; current scene returned zero detections
- F450 part detection and visible bounding box: NOT TESTED (no physical part was placed in view)
- Normal user-profile camera permission: NOT TESTED (isolated diagnostic Chrome auto-granted camera access)

Manual completion:

1. Open the Dev-only HTTPS URL in the normal browser profile.
2. Click **Start Camera**, then click **Allow** when Chrome asks for camera access.
3. Confirm the selector shows **Logi C310 HD WebCam** and preview is live.
4. Place one supported F450 part (motor, frame_arm, flight_controller, gps_compass, receiver, or battery) in view.
5. Click **Capture / Detect** and confirm a detection row and aligned bounding box.
6. Click **Stop Camera**, confirm the camera indicator turns off, then start it again.

Final manual result: NOT TESTED / PASS / FAIL: __________