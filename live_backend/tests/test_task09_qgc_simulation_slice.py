import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.sessions import InMemorySessionStore
from app.task_catalog import TaskStatus, load_f450_course
from app.task_state import TaskTransitionError, TrainingProgress


class StubVisionCenter:
    def active_model(self, model_type):
        return None


QGC_STEPS = [
    "QGC_BATTERY", "QGC_GPS_HOME_POSITION", "QGC_ATTITUDE_MODE_TELEMETRY",
    "QGC_ARM_DISARM_CONCEPT", "QGC_WAYPOINT_MISSION", "QGC_MISSION_SEQUENCE",
    "QGC_RTL_CONCEPT", "SITL_MISSION_REHEARSAL",
]


class Task09QgcSimulationSliceTests(unittest.TestCase):
    def setUp(self):
        self.progress = TrainingProgress("t09-session", "student", load_f450_course())
        self.progress.task("TASK_07").status = TaskStatus.COMPLETED
        self.progress.task("TASK_08").status = TaskStatus.COMPLETED
        self.progress.start_task("TASK_09")

    def test_task09_is_qgc_simulation_with_eight_steps(self):
        task = self.progress.task("TASK_09")
        self.assertEqual(task.status, TaskStatus.IN_PROGRESS)
        task_def = next(t for t in self.progress.course.tasks if t.id == "TASK_09")
        self.assertEqual([s.step_id for s in task_def.steps], QGC_STEPS)
        self.assertEqual(task.current_training_step_id, "QGC_BATTERY")
        # TASK_09 has no teacher gate by design (AI_ASSISTED_COMPLETE / REQUIREMENTS_COMPLETE)
        self.assertFalse(task_def.teacher_review_required)
        self.assertEqual(task_def.prerequisites, ("TASK_07", "TASK_08"))

    def test_walk_eight_steps_then_request_completion_completes(self):
        for step_id in QGC_STEPS:
            self.progress.record_step_fact("TASK_09", step_id, "PASS")
        task = self.progress.task("TASK_09")
        self.assertIsNone(task.current_training_step_id)
        self.progress.request_completion("TASK_09", actor="student")
        self.assertEqual(task.status, TaskStatus.COMPLETED)
        self.assertEqual(self.progress.missing_prerequisites("TASK_10"), ())

    def test_http_vertical_slice_task09_to_task10_ready(self):
        store = InMemorySessionStore()
        app = create_app(session_store=store, vision_center=StubVisionCenter(), dev_mode=True)
        client = TestClient(app)
        r = client.post("/api/live/sessions", json={"mode": "demo", "training_track": "F450_TWELVE_TASK"})
        self.assertEqual(r.status_code, 201, r.text)
        sid = r.json()["session_id"]
        prog = store.training_progress(sid)
        prog.task("TASK_07").status = TaskStatus.COMPLETED
        prog.task("TASK_08").status = TaskStatus.COMPLETED

        # enter TASK_09
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_09/start")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["current_task_id"], "TASK_09")

        # view shows 8 QGC steps + current step
        r = client.get(f"/api/live/sessions/{sid}/training/tasks/TASK_09")
        self.assertEqual(r.status_code, 200, r.text)
        view = r.json()["training_task_view"]
        self.assertEqual([s["step_id"] for s in view["task"]["steps"]], QGC_STEPS)
        self.assertEqual(view["current_training_step_id"], "QGC_BATTERY")

        # walk through the 8 QGC / SITL steps
        for step_id in QGC_STEPS:
            r = client.post(f"/api/live/sessions/{sid}/training/steps/{step_id}/facts", json={"fact": "PASS"})
            self.assertEqual(r.status_code, 200, (step_id, r.text))
        st = client.get(f"/api/live/sessions/{sid}/training/tasks/TASK_09").json()["training_task_view"]
        self.assertIsNone(st["current_training_step_id"])

        # completion is blocked until evidence + reflection are recorded
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_09/complete", json={})
        self.assertEqual(r.status_code, 409, r.text)
        self.assertIn("evidence_required", r.text)

        r = client.post(f"/api/live/sessions/{sid}/training/evidence",
                        json={"task_id": "TASK_09", "evidence_type": "SCREENSHOT", "file_reference": "dev://qgc.png"})
        self.assertEqual(r.status_code, 201, r.text)

        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_09/complete", json={})
        self.assertEqual(r.status_code, 409, r.text)
        self.assertIn("reflection_required", r.text)

        r = client.post(f"/api/live/sessions/{sid}/training/reflection",
                        json={"task_id": "TASK_09", "original_text": "學生完成 QGC 模擬演練。", "ai_assisted_text": None, "source_type": "TEXT"})
        self.assertEqual(r.status_code, 201, r.text)

        # now completion succeeds
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_09/complete", json={})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["task_state"], "COMPLETED")

        # TASK_10 becomes ready (prerequisites satisfied) and is not auto-started
        r = client.get(f"/api/live/sessions/{sid}/training/tasks/TASK_10")
        self.assertEqual(r.status_code, 200, r.text)
        view10 = r.json()["training_task_view"]
        self.assertEqual(view10["missing_prerequisites"], [])

        # growth record reflects TASK_09 completion
        r = client.get(f"/api/live/sessions/{sid}/training/growth-record")
        self.assertEqual(r.status_code, 200, r.text)
        gr = r.json()
        self.assertTrue(any(d["task_id"] == "TASK_09" and d["status"] == "COMPLETED" for d in gr["task_detail"]), gr["task_detail"])


if __name__ == "__main__":
    unittest.main()
