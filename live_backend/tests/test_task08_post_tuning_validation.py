import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.sessions import InMemorySessionStore
from app.task_catalog import TaskStatus, load_f450_course
from app.task_state import TaskTransitionError, TrainingProgress


class OfflineVision:
    async def health(self):
        return False

    async def detect(self, *_args):
        raise AssertionError("vision must be explicitly triggered")


class NoActivePropCenter:
    def active_model(self, model_type):
        self.last_model_type = model_type
        return None


class Task08PostTuningValidationTests(unittest.TestCase):
    def setUp(self):
        self.progress = TrainingProgress("task08-session", "student", load_f450_course())
        self.progress.task("TASK_07").status = TaskStatus.COMPLETED
        self.progress.start_task("TASK_08")

    def _advance(self, step_id, status="PASS"):
        self.progress.record_step_fact("TASK_08", step_id, status)

    def _reach_final_review(self):
        for step_id in (
            "T08_FLIGHT_MODE_CHECK",
            "T08_RC_INPUT_CHECK",
            "T08_GPS_COMPASS_STATUS",
            "T08_FAILSAFE_CONFIG",
            "T08_RTL_CONFIG",
            "T08_PAYLOAD_MAPPING",
            "T08_PROP_VISION",
        ):
            state = self.progress.task("TASK_08").training_step_progress[step_id]
            state["status"] = "COMPLETED"
            state["check_status"] = "PASS"
        task = self.progress.task("TASK_08")
        task.current_training_step_id = "T08_TEACHER_FINAL_REVIEW"
        task.evidence.append({"evidence_type": "SCREENSHOT", "reference": "dev://task08.png"})
        self.progress.record_step_fact("TASK_08", "T08_TEACHER_FINAL_REVIEW", "NEEDS_CONFIRMATION")

    def test_task07_incomplete_prevents_task08_completion(self):
        self.progress.task("TASK_07").status = TaskStatus.IN_PROGRESS
        self._reach_final_review()
        with self.assertRaisesRegex(TaskTransitionError, "task08_prerequisite_incomplete:TASK_07"):
            self.progress.review_step("TASK_08", "T08_TEACHER_FINAL_REVIEW", "APPROVE", "teacher")

    def test_task07_complete_allows_task08_to_enter(self):
        self.assertEqual(self.progress.task("TASK_08").status, TaskStatus.IN_PROGRESS)
        self.assertEqual(self.progress.task("TASK_08").current_training_step_id, "T08_FLIGHT_MODE_CHECK")

    def test_check_status_is_recorded_and_retry_does_not_advance(self):
        self._advance("T08_FLIGHT_MODE_CHECK", "RETRY")
        task = self.progress.task("TASK_08")
        state = task.training_step_progress["T08_FLIGHT_MODE_CHECK"]
        self.assertEqual(state["check_status"], "RETRY")
        self.assertEqual(task.current_training_step_id, "T08_FLIGHT_MODE_CHECK")
        self.assertTrue(state["facts"][0]["timestamp"].endswith("Z"))

    def test_invalid_check_status_does_not_mutate_step(self):
        state = self.progress.task("TASK_08").training_step_progress["T08_FLIGHT_MODE_CHECK"]
        with self.assertRaisesRegex(TaskTransitionError, "invalid_task08_check_status"):
            self.progress.record_step_fact("TASK_08", "T08_FLIGHT_MODE_CHECK", "AUTO_PASS")
        self.assertEqual(state["facts"], [])
        self.assertIsNone(state["check_status"])

    def test_evidence_reference_is_saved_for_check(self):
        self.progress.record_step_evidence("TASK_08", "T08_FLIGHT_MODE_CHECK", "SCREENSHOT", "dev://flight-mode.png")
        state = self.progress.task("TASK_08").training_step_progress["T08_FLIGHT_MODE_CHECK"]
        self.assertEqual(state["evidence_references"], ["dev://flight-mode.png"])

    def test_indoor_gps_not_available_does_not_block(self):
        task = self.progress.task("TASK_08")
        task.current_training_step_id = "T08_GPS_COMPASS_STATUS"
        self._advance("T08_GPS_COMPASS_STATUS", "NOT_AVAILABLE_INDOOR")
        self.assertEqual(task.training_step_progress["T08_GPS_COMPASS_STATUS"]["check_status"], "NOT_AVAILABLE_INDOOR")
        self.assertEqual(task.current_training_step_id, "T08_FAILSAFE_CONFIG")

    def test_missing_active_prop_model_is_pending_not_error(self):
        store = InMemorySessionStore()
        center = NoActivePropCenter()
        client = TestClient(create_app(vision_adapter=OfflineVision(), session_store=store, vision_center=center, dev_mode=True))
        sid = client.post("/api/live/sessions", json={"mode": "demo", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        response = client.get(f"/api/live/sessions/{sid}/training/tasks/TASK_08")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["training_task_view"]["prop_vision_status"], "PENDING")
        self.assertEqual(center.last_model_type, "PROP_DIRECTION")

    def test_student_cannot_auto_approve_final_review(self):
        self._reach_final_review()
        with self.assertRaisesRegex(TaskTransitionError, "teacher_authority_required"):
            self.progress.review_step("TASK_08", "T08_TEACHER_FINAL_REVIEW", "APPROVE", "student", actor_role="student")

    def test_teacher_pass_completes_task08(self):
        self._reach_final_review()
        self.progress.review_step("TASK_08", "T08_TEACHER_FINAL_REVIEW", "APPROVE", "teacher")
        self.assertEqual(self.progress.task("TASK_08").status, TaskStatus.COMPLETED)
        self.assertIsNone(self.progress.task("TASK_08").current_training_step_id)

    def test_task09_becomes_ready_without_auto_start(self):
        self._reach_final_review()
        self.progress.review_step("TASK_08", "T08_TEACHER_FINAL_REVIEW", "APPROVE", "teacher")
        self.assertEqual(self.progress.missing_prerequisites("TASK_09"), ())
        self.assertEqual(self.progress.task("TASK_09").status, TaskStatus.NOT_STARTED)


if __name__ == "__main__":
    unittest.main()
