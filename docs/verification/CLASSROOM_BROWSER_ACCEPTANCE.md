# F450 Build Coach Classroom Browser Acceptance

Date: 2026-10-01
Scope: v2.0 Dev-only Build Coach Tasks 01–06

Automated tests prove software workflow only. Motor, ESC, soldering, continuity, battery, first power, outdoor GPS, arm, prop operation, and real flight remain **NOT_TESTED** or **PENDING_TEACHER_REVIEW**.

## Test matrix

| Check | Desktop Chrome | iPhone Safari | Android Chrome |
|---|---|---|---|
| 12 Task list and current task | PASS | NOT_TESTED | NOT_TESTED |
| Current-step navigation | PENDING_MANUAL_ACCEPTANCE | NOT_TESTED | NOT_TESTED |
| Future task read-only / blocked message | PENDING_MANUAL_ACCEPTANCE | NOT_TESTED | NOT_TESTED |
| Camera permission/start/stop/WAITING | FAIL | NOT_TESTED | NOT_TESTED |
| Manual AI Check | BLOCKED_BY_CAMERA | NOT_TESTED | NOT_TESTED |
| Evidence file selection/save | PENDING_MANUAL_ACCEPTANCE | NOT_TESTED | NOT_TESTED |
| Student reflection | PENDING_MANUAL_ACCEPTANCE | NOT_TESTED | NOT_TESTED |
| Teacher pending/approve/reject | PENDING_MANUAL_ACCEPTANCE | NOT_TESTED | NOT_TESTED |
| Progress x / 12 | PENDING_MANUAL_ACCEPTANCE | NOT_TESTED | NOT_TESTED |
| Task 06 release → Task 07 actionable | PENDING_MANUAL_ACCEPTANCE | NOT_TESTED | NOT_TESTED |
| Touch targets and narrow layout | PENDING_MANUAL_ACCEPTANCE | NOT_TESTED | NOT_TESTED |

Desktop Chrome acceptance was deferred on 2026-10-01 because the user was away from the test computer. No automated result is counted as a real-browser PASS.

## Desktop Chrome result — 2026-10-01

- Device: Dell Windows laptop
- Browser: Desktop Chrome
- 12 Tasks / 0 / 12 / Task 01 / Backend ONLINE / Vision ONLINE: **PASS**
- Camera start: **FAIL**
- Camera ACTIVE / WAITING: **FAIL**
- Manual AI Check: **BLOCKED_BY_CAMERA**
- Stop / restart: **NOT_TESTED**
- Browser error: NotFoundError: Requested device not found
- Device selector: No camera found
- Windows diagnostic: Logi C310 and Osmo Camera-class entries reported Unknown; OpenCV DirectShow, Media Foundation, and default probes returned no readable device/frame.
- Classification: environment/device availability failure; no Camera or Live Session code change was made.

## Manual procedure

1. Open the Dev-only HTTPS /live/ page; verify Production routes are unchanged.
2. Create the training session and confirm 0 / 12, Task 01, Step 01-01.
3. Confirm ordinary steps advance only after the backend response.
4. Verify Safety acknowledgment changes only the acknowledgment condition.
5. Start/stop Camera and confirm WAITING sends no continuous inference.
6. Trigger Manual AI Check only at an explicit Vision step.
7. Save Evidence and verify session/task/training-step linkage.
8. Enter original Reflection text; verify empty original text is rejected.
9. At Teacher Gate, verify the student cannot continue or approve.
10. In Dev mode, test explicit MOCK_TEACHER APPROVE and REJECT_REWORK with a note.
11. Confirm future tasks remain viewable but non-actionable.
12. Complete Task 06 software flow and confirm 6 / 12; Task 07 becomes actionable.

Record device model, OS/browser version, result, failure details, and screenshots. Never convert hardware items to PASS without the real student/teacher operation.
