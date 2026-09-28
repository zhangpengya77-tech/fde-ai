# Windows USB Webcam Verification

Status: **CAMERA PIPELINE PASS — model accuracy remains unqualified**

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
- Normal Chrome camera preview: PASS (user-confirmed physical test)
- Detect interaction / Snapshot request / Detection result: PASS (user-confirmed physical test)
- Camera → HTTPS → Live Backend → Vision → best.pt → Detection result: PASS
- Model accuracy: NOT PASSED; the first real motor sample was misclassified as `frame_arm`

## Real F450 physical model validation

This table records physical-object model behavior separately from the camera pipeline. A successful request proves the transport and inference chain, but does not prove classification accuracy.

| Trial | Expected | Detected | Confidence | Detection chain | Classification | Bounding box aligned |
|---|---|---|---:|---|---|---|
| 1 | `motor` | `frame_arm` | 38.9% | PASS | MODEL MISCLASSIFICATION | Not reported |
| 2 | `frame_arm` | Pending | Pending | Pending | Pending | Pending |
| 3 | `flight_controller` | Pending | Pending | Pending | Pending | Pending |

Current conclusions:

- `PHASE_1A2_CAMERA_PIPELINE = PASS`
- `MODEL_ACCURACY = NOT PASSED / EVALUATION INCOMPLETE`
- Do not modify `best.pt` or lower the confidence threshold. Track accuracy as `MODEL_ACCURACY_PENDING`; Phase 2 architecture may proceed independently using DEV-only Mock Vision.

Manual completion:

1. Open the Dev-only HTTPS URL in the normal browser profile.
2. Click **Start Camera**, then click **Allow** when Chrome asks for camera access.
3. Confirm the selector shows **Logi C310 HD WebCam** and preview is live.
4. Test the remaining objects one at a time in this order: `motor`, `frame_arm`, `flight_controller`.
5. Click **立即 AI 检测** for each object and record detected class, confidence, and whether the bounding box is aligned.
6. Click **Stop Camera**, confirm the camera indicator turns off, then start it again.

Final camera pipeline result: PASS

Final model accuracy result: PENDING THREE-OBJECT REVIEW
