import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.sessions import InMemorySessionStore
from app.task_catalog import CompletionMode, TaskStatus, load_f450_course
from app.task_state import TaskTransitionError, TrainingProgress


class StubVisionCenter:
    def active_model(self, model_type):
        return None


TASK11_STEPS = [
    "SITE_SAFETY", "FINAL_CHECK", "TEACHER_CONTROLLED_FLIGHT", "POST_FLIGHT_CHECK",
]


def _complete_preflight(progress):
    # TASK_11 prerequisites: TASK_07 / TASK_08 / TASK_09 / TASK_10 must be COMPLETED.
    for tid in ("TASK_07", "TASK_08", "TASK_09", "TASK_10"):
        progress.task(tid).status = TaskStatus.COMPLETED


class Task11OutdoorFlightSliceTests(unittest.TestCase):
    def setUp(self):
        self.progress = TrainingProgress("t11-session", "student", load_f450_course())
        _complete_preflight(self.progress)
        self.progress.start_task("TASK_11")

    def test_task11_catalog_contract(self):
        task = self.progress.task("TASK_11")
        self.assertEqual(task.status, TaskStatus.IN_PROGRESS)
        definition = next(t for t in self.progress.course.tasks if t.id == "TASK_11")
        self.assertEqual([s.step_id for s in definition.steps], TASK11_STEPS)
        self.assertEqual(task.current_training_step_id, "SITE_SAFETY")
        # Teacher / Safety gate preserved: requires teacher on-site release before controlled flight.
        self.assertTrue(definition.teacher_review_required)
        self.assertTrue(definition.safety_gate)
        self.assertEqual(definition.completion_mode, CompletionMode.TEACHER_CONFIRM)
        self.assertEqual(definition.safety_reminders, ("REM_FLIGHT_TEACHER_REQUIRED",))
        self.assertEqual(
            definition.evidence_requirements,
            ("VIDEO", "FLIGHT_LOG_REFERENCE", "TEACHER_REVIEW"),
        )
        self.assertEqual(definition.prerequisites, ("TASK_10",))
        self.assertEqual(definition.next_task, "TASK_12")

    def test_safety_gate_blocks_controlled_flight_without_task10_release(self):
        # Controlled flight step is locked behind TASK_10 completion (UNSAFE_STEP_PREREQUISITES).
        self.progress.task("TASK_10").status = TaskStatus.NOT_STARTED  # release NOT granted
        self.progress.start_task("TASK_11")
        self.progress.record_step_fact("TASK_11", "SITE_SAFETY", "PASS")
        self.progress.record_step_fact("TASK_11", "FINAL_CHECK", "PASS")
        with self.assertRaisesRegex(TaskTransitionError, "unsafe_step_prerequisites:TASK_10"):
            self.progress.record_step_fact("TASK_11", "TEACHER_CONTROLLED_FLIGHT", "PASS")
        # Once TASK_10 is COMPLETED, the gate releases and the step can advance.
        self.progress.task("TASK_10").status = TaskStatus.COMPLETED
        self.progress.record_step_fact("TASK_11", "TEACHER_CONTROLLED_FLIGHT", "PASS")
        self.assertEqual(
            self.progress.task("TASK_11").current_training_step_id, "POST_FLIGHT_CHECK"
        )

    def test_walk_four_steps_then_teacher_review_completes(self):
        for step_id in TASK11_STEPS:
            self.progress.record_step_fact("TASK_11", step_id, "PASS")
        task = self.progress.task("TASK_11")
        self.assertIsNone(task.current_training_step_id)
        # TEACHER_CONFIRM task -> request_completion parks in PENDING_TEACHER_REVIEW.
        self.progress.request_completion("TASK_11", actor="student")
        self.assertEqual(task.status, TaskStatus.PENDING_TEACHER_REVIEW)
        # MOCK_TEACHER used ONLY for automated gate check; NOT a real flight/teacher pass.
        self.progress.record_teacher_review("TASK_11", "APPROVE", "MOCK_TEACHER", "教師現場監控飛行完成。")
        self.assertEqual(task.status, TaskStatus.COMPLETED)
        self.assertEqual(self.progress.missing_prerequisites("TASK_12"), ())

    def test_http_vertical_slice_task11_to_task12_ready(self):
        store = InMemorySessionStore()
        app = create_app(session_store=store, vision_center=StubVisionCenter(), dev_mode=True)
        client = TestClient(app)
        r = client.post("/api/live/sessions", json={"mode": "demo", "training_track": "F450_TWELVE_TASK"})
        self.assertEqual(r.status_code, 201, r.text)
        sid = r.json()["session_id"]
        prog = store.training_progress(sid)
        _complete_preflight(prog)

        # enter TASK_11
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_11/start")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["current_task_id"], "TASK_11")
        # safety gate surfaced as TEACHER_GATE for the task
        self.assertEqual(r.json()["training"]["safety_state"], "TEACHER_GATE")

        # view shows 4 steps + current step + teacher gate + flight safety reminder
        r = client.get(f"/api/live/sessions/{sid}/training/tasks/TASK_11")
        self.assertEqual(r.status_code, 200, r.text)
        view = r.json()["training_task_view"]
        self.assertEqual([s["step_id"] for s in view["task"]["steps"]], TASK11_STEPS)
        self.assertEqual(view["current_training_step_id"], "SITE_SAFETY")
        self.assertEqual(view["task"]["teacher_review_required"], True)
        self.assertEqual(
            [item["id"] for item in view["task"]["safety_reminders"]],
            ["REM_FLIGHT_TEACHER_REQUIRED"],
        )

        # walk through the 4 steps (no per-step gate for TASK_11)
        for step_id in TASK11_STEPS:
            r = client.post(f"/api/live/sessions/{sid}/training/steps/{step_id}/facts", json={"fact": "PASS"})
            self.assertEqual(r.status_code, 200, (step_id, r.text))
        st = client.get(f"/api/live/sessions/{sid}/training/tasks/TASK_11").json()["training_task_view"]
        self.assertIsNone(st["current_training_step_id"])

        # completion blocked until evidence + reflection are recorded
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_11/complete", json={})
        self.assertEqual(r.status_code, 409, r.text)
        self.assertIn("evidence_required", r.text)

        r = client.post(f"/api/live/sessions/{sid}/training/evidence",
                        json={"task_id": "TASK_11", "evidence_type": "VIDEO", "file_reference": "dev://flight.mp4"})
        self.assertEqual(r.status_code, 201, r.text)

        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_11/complete", json={})
        self.assertEqual(r.status_code, 409, r.text)
        self.assertIn("reflection_required", r.text)

        r = client.post(f"/api/live/sessions/{sid}/training/reflection",
                        json={"task_id": "TASK_11", "original_text": "學生在教師監控下完成戶外基礎真機測試。", "ai_assisted_text": None, "source_type": "TEXT"})
        self.assertEqual(r.status_code, 201, r.text)

        # completion now parks in PENDING_TEACHER_REVIEW (NOT auto-COMPLETED)
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_11/complete", json={})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["task_state"], "PENDING_TEACHER_REVIEW")

        # MOCK_TEACHER releases the safety/teacher gate -> COMPLETED (automated test only)
        r = client.post(f"/api/live/sessions/{sid}/training/teacher-review",
                        json={"task_id": "TASK_11", "decision": "APPROVE", "note": "教師現場監控飛行完成。"},
                        headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "MOCK_TEACHER"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["task_state"], "COMPLETED")

        # TASK_12 becomes ready (prerequisites satisfied) and is not auto-started
        r = client.get(f"/api/live/sessions/{sid}/training/tasks/TASK_12")
        self.assertEqual(r.status_code, 200, r.text)
        view12 = r.json()["training_task_view"]
        self.assertEqual(view12["missing_prerequisites"], [])

        # growth record reflects TASK_11 completion + teacher safety check counted
        r = client.get(f"/api/live/sessions/{sid}/training/growth-record")
        self.assertEqual(r.status_code, 200, r.text)
        gr = r.json()
        self.assertTrue(
            any(d["task_id"] == "TASK_11" and d["status"] == "COMPLETED" for d in gr["task_detail"]),
            gr["task_detail"],
        )
        self.assertTrue(gr["teacher_safety_checks"].startswith("1 /"), gr["teacher_safety_checks"])

    def test_http_safety_gate_blocks_controlled_flight_without_task10(self):
        # Negative safety-chain test at the API boundary: the controlled-flight step
        # must NOT advance unless TASK_10 release exists. Mock teacher is never used here.
        store = InMemorySessionStore()
        app = create_app(session_store=store, vision_center=StubVisionCenter(), dev_mode=True)
        client = TestClient(app)
        r = client.post("/api/live/sessions", json={"mode": "demo", "training_track": "F450_TWELVE_TASK"})
        sid = r.json()["session_id"]
        prog = store.training_progress(sid)
        # TASK_07/08/09 completed but TASK_10 intentionally NOT released
        for tid in ("TASK_07", "TASK_08", "TASK_09"):
            prog.task(tid).status = TaskStatus.COMPLETED

        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_11/start")
        self.assertEqual(r.status_code, 200, r.text)
        for step_id in ("SITE_SAFETY", "FINAL_CHECK"):
            r = client.post(f"/api/live/sessions/{sid}/training/steps/{step_id}/facts", json={"fact": "PASS"})
            self.assertEqual(r.status_code, 200, (step_id, r.text))
        # Controlled flight is blocked until TASK_10 release exists.
        r = client.post(f"/api/live/sessions/{sid}/training/steps/TEACHER_CONTROLLED_FLIGHT/facts", json={"fact": "PASS"})
        self.assertEqual(r.status_code, 409, r.text)
        self.assertIn("unsafe_step_prerequisites", r.text)
        # Grant TASK_10 release, then the step advances.
        prog.task("TASK_10").status = TaskStatus.COMPLETED
        r = client.post(f"/api/live/sessions/{sid}/training/steps/TEACHER_CONTROLLED_FLIGHT/facts", json={"fact": "PASS"})
        self.assertEqual(r.status_code, 200, r.text)


if __name__ == "__main__":
    unittest.main()
