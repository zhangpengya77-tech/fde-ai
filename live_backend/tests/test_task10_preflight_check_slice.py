import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.sessions import InMemorySessionStore
from app.task_catalog import CompletionMode, TaskStatus, load_f450_course
from app.task_state import TrainingProgress


class StubVisionCenter:
    def active_model(self, model_type):
        return None


TASK10_STEPS = [
    "MECHANICAL_PREFLIGHT", "ELECTRICAL_PREFLIGHT", "CONFIG_PREFLIGHT",
    "OUTDOOR_GPS_HOME_RTL", "TEACHER_FLIGHT_RELEASE",
]


class Task10PreflightCheckSliceTests(unittest.TestCase):
    def setUp(self):
        self.progress = TrainingProgress("t10-session", "student", load_f450_course())
        # TASK_10 prerequisites: TASK_07 / TASK_08 / TASK_09 must be COMPLETED.
        self.progress.task("TASK_07").status = TaskStatus.COMPLETED
        self.progress.task("TASK_08").status = TaskStatus.COMPLETED
        self.progress.task("TASK_09").status = TaskStatus.COMPLETED
        self.progress.start_task("TASK_10")

    def test_task10_catalog_contract(self):
        task = self.progress.task("TASK_10")
        self.assertEqual(task.status, TaskStatus.IN_PROGRESS)
        definition = next(t for t in self.progress.course.tasks if t.id == "TASK_10")
        # Five pre-flight steps defined via generic _steps() helper.
        self.assertEqual([s.step_id for s in definition.steps], TASK10_STEPS)
        self.assertEqual(task.current_training_step_id, "MECHANICAL_PREFLIGHT")
        # Teacher / Safety gate preserved: requires teacher physical review before release.
        self.assertTrue(definition.teacher_review_required)
        self.assertTrue(definition.safety_gate)
        self.assertEqual(definition.completion_mode, CompletionMode.TEACHER_CONFIRM)
        self.assertEqual(
            definition.safety_reminders,
            ("REM_FIRST_POWER_TEACHER_REQUIRED", "REM_FLIGHT_TEACHER_REQUIRED"),
        )
        self.assertEqual(definition.evidence_requirements, ("CHECKLIST", "TEACHER_REVIEW"))
        self.assertEqual(definition.prerequisites, ("TASK_07", "TASK_08", "TASK_09"))
        self.assertEqual(definition.next_task, "TASK_11")

    def test_walk_five_steps_then_teacher_review_completes(self):
        for step_id in TASK10_STEPS:
            self.progress.record_step_fact("TASK_10", step_id, "PASS")
        task = self.progress.task("TASK_10")
        self.assertIsNone(task.current_training_step_id)
        # TEACHER_CONFIRM task -> request_completion parks in PENDING_TEACHER_REVIEW.
        self.progress.request_completion("TASK_10", actor="student")
        self.assertEqual(task.status, TaskStatus.PENDING_TEACHER_REVIEW)
        # Teacher reviews (no step-level gate for TASK_10) -> COMPLETED.
        self.progress.record_teacher_review("TASK_10", "APPROVE", "MOCK_TEACHER", "放行前总检完成。")
        self.assertEqual(task.status, TaskStatus.COMPLETED)
        # TASK_11 now unlocked (real safe-launch gate preserved at TASK_11 level).
        self.assertEqual(self.progress.missing_prerequisites("TASK_11"), ())

    def test_http_vertical_slice_task10_to_task11_ready(self):
        store = InMemorySessionStore()
        app = create_app(session_store=store, vision_center=StubVisionCenter(), dev_mode=True)
        client = TestClient(app)
        r = client.post("/api/live/sessions", json={"mode": "demo", "training_track": "F450_TWELVE_TASK"})
        self.assertEqual(r.status_code, 201, r.text)
        sid = r.json()["session_id"]
        prog = store.training_progress(sid)
        prog.task("TASK_07").status = TaskStatus.COMPLETED
        prog.task("TASK_08").status = TaskStatus.COMPLETED
        prog.task("TASK_09").status = TaskStatus.COMPLETED

        # enter TASK_10
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_10/start")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["current_task_id"], "TASK_10")
        # safety gate is surfaced as TEACHER_GATE for the task
        self.assertEqual(r.json()["training"]["safety_state"], "TEACHER_GATE")

        # view shows 5 pre-flight steps + current step
        r = client.get(f"/api/live/sessions/{sid}/training/tasks/TASK_10")
        self.assertEqual(r.status_code, 200, r.text)
        view = r.json()["training_task_view"]
        self.assertEqual([s["step_id"] for s in view["task"]["steps"]], TASK10_STEPS)
        self.assertEqual(view["current_training_step_id"], "MECHANICAL_PREFLIGHT")
        self.assertEqual(view["task"]["teacher_review_required"], True)
        self.assertEqual(
            [item["id"] for item in view["task"]["safety_reminders"]],
            ["REM_FIRST_POWER_TEACHER_REQUIRED", "REM_FLIGHT_TEACHER_REQUIRED"],
        )

        # walk through the 5 pre-flight steps (no per-step gate for TASK_10)
        for step_id in TASK10_STEPS:
            r = client.post(f"/api/live/sessions/{sid}/training/steps/{step_id}/facts", json={"fact": "PASS"})
            self.assertEqual(r.status_code, 200, (step_id, r.text))
        st = client.get(f"/api/live/sessions/{sid}/training/tasks/TASK_10").json()["training_task_view"]
        self.assertIsNone(st["current_training_step_id"])

        # completion blocked until evidence + reflection are recorded
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_10/complete", json={})
        self.assertEqual(r.status_code, 409, r.text)
        self.assertIn("evidence_required", r.text)

        r = client.post(f"/api/live/sessions/{sid}/training/evidence",
                        json={"task_id": "TASK_10", "evidence_type": "CHECKLIST", "file_reference": "dev://preflight-checklist.json"})
        self.assertEqual(r.status_code, 201, r.text)

        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_10/complete", json={})
        self.assertEqual(r.status_code, 409, r.text)
        self.assertIn("reflection_required", r.text)

        r = client.post(f"/api/live/sessions/{sid}/training/reflection",
                        json={"task_id": "TASK_10", "original_text": "學生完成飛行前最終上電檢查總檢。", "ai_assisted_text": None, "source_type": "TEXT"})
        self.assertEqual(r.status_code, 201, r.text)

        # completion now parks in PENDING_TEACHER_REVIEW (NOT auto-COMPLETED)
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_10/complete", json={})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["task_state"], "PENDING_TEACHER_REVIEW")

        # teacher review (dev mock) releases the safety/teacher gate -> COMPLETED
        r = client.post(f"/api/live/sessions/{sid}/training/teacher-review",
                        json={"task_id": "TASK_10", "decision": "APPROVE", "note": "教師現場放行前總檢完成。"},
                        headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "MOCK_TEACHER"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["task_state"], "COMPLETED")

        # TASK_11 becomes ready (prerequisites satisfied) and is not auto-started
        r = client.get(f"/api/live/sessions/{sid}/training/tasks/TASK_11")
        self.assertEqual(r.status_code, 200, r.text)
        view11 = r.json()["training_task_view"]
        self.assertEqual(view11["missing_prerequisites"], [])

        # growth record reflects TASK_10 completion + teacher safety check counted
        r = client.get(f"/api/live/sessions/{sid}/training/growth-record")
        self.assertEqual(r.status_code, 200, r.text)
        gr = r.json()
        self.assertTrue(
            any(d["task_id"] == "TASK_10" and d["status"] == "COMPLETED" for d in gr["task_detail"]),
            gr["task_detail"],
        )
        self.assertTrue(gr["teacher_safety_checks"].startswith("1 /"), gr["teacher_safety_checks"])


if __name__ == "__main__":
    unittest.main()
