import unittest
from starlette.testclient import TestClient
from app.main import create_app
from app.sessions import InMemorySessionStore


class OfflineVision:
    async def health(self): return False


class BuildCoachLiveApiTests(unittest.TestCase):
    def setUp(self):
        self.store = InMemorySessionStore()
        self.client = TestClient(create_app(vision_adapter=OfflineVision(), session_store=self.store, dev_mode=True))
        self.sid = self.client.post("/api/live/sessions", json={"mode": "demo", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        self.client.post(f"/api/live/sessions/{self.sid}/training/tasks/TASK_01/start", json={})

    def state(self):
        return self.client.get(f"/api/live/sessions/{self.sid}").json()["training"]

    def test_state_exposes_backend_owned_current_training_step(self):
        state = self.state()
        self.assertEqual(state["current_training_step_id"], "T01_WORKSPACE")
        self.assertEqual(state["current_step"]["step_id"], "T01_WORKSPACE")
        self.assertIn("training_step_progress", state)
        self.assertEqual(state["overall_progress"], "0 / 12")

    def test_step_fact_advances_and_frontend_cannot_choose_completion(self):
        response = self.client.post(
            f"/api/live/sessions/{self.sid}/training/steps/T01_WORKSPACE/facts",
            json={"fact": "LEARNER_CONFIRMED", "status": "COMPLETED"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["training"]["current_training_step_id"], "T01_FRAME")

    def test_safety_ack_is_recorded_without_bypassing_teacher_gate(self):
        progress = self.store.training_progress(self.sid)
        task = progress.task("TASK_02")
        task.status = task.status.IN_PROGRESS
        task.current_training_step_id = "T02_PREPOWER_TEACHER"
        self.store.get(self.sid).current_task_id = "TASK_02"
        ack = self.client.post(f"/api/live/sessions/{self.sid}/training/steps/T02_PREPOWER_TEACHER/safety-ack", json={})
        self.assertEqual(ack.status_code, 200)
        fact = self.client.post(f"/api/live/sessions/{self.sid}/training/steps/T02_PREPOWER_TEACHER/facts", json={"fact": "LEARNER_CONFIRMED"})
        self.assertEqual(fact.status_code, 409)
        self.assertEqual(task.current_training_step_id, "T02_PREPOWER_TEACHER")

    def test_step_teacher_review_requires_teacher_role(self):
        url = f"/api/live/sessions/{self.sid}/training/teacher-review"
        payload = {"task_id": "TASK_02", "step_id": "T02_PREPOWER_TEACHER", "decision": "APPROVE", "note": "software flow"}
        self.assertEqual(self.client.post(url, json=payload).status_code, 403)


if __name__ == "__main__":
    unittest.main()
