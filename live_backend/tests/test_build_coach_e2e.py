import unittest
from starlette.testclient import TestClient
from app.main import create_app
from app.sessions import InMemorySessionStore


class OfflineVision:
    async def health(self): return False


class BuildCoachE2ETests(unittest.TestCase):
    def setUp(self):
        self.store = InMemorySessionStore()
        self.client = TestClient(create_app(vision_adapter=OfflineVision(), session_store=self.store, dev_mode=True))
        self.sid = self.client.post("/api/live/sessions", json={"mode": "demo", "training_track": "F450_TWELVE_TASK"}).json()["session_id"]
        self.teacher_headers = {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "MOCK_TEACHER"}

    def state(self):
        return self.client.get(f"/api/live/sessions/{self.sid}").json()["training"]

    def finish_task(self, task_id):
        self.assertEqual(self.client.post(f"/api/live/sessions/{self.sid}/training/tasks/{task_id}/start", json={}).status_code, 200)
        while self.state()["current_step"]:
            state = self.state()
            step = state["current_step"]
            step_id = step["step_id"]
            if step["safety_reminders"]:
                self.assertEqual(self.client.post(f"/api/live/sessions/{self.sid}/training/steps/{step_id}/safety-ack", json={}).status_code, 200)
            if step["teacher_gate"]:
                response = self.client.post(
                    f"/api/live/sessions/{self.sid}/training/teacher-review",
                    headers=self.teacher_headers,
                    json={"task_id": task_id, "step_id": step_id, "decision": "APPROVE", "note": "SOFTWARE_WORKFLOW_PASS; REAL_HARDWARE_NOT_TESTED"},
                )
            elif step["evidence_required"]:
                response = self.client.post(f"/api/live/sessions/{self.sid}/training/evidence", json={
                    "task_id": task_id, "step_id": step_id, "evidence_type": step["evidence_required"][0],
                    "source": "DEV_STORAGE", "file_reference": f"dev://{task_id}/{step_id}",
                })
            elif step_id.endswith("REFLECTION") or step_id.endswith("RECORD"):
                response = self.client.post(f"/api/live/sessions/{self.sid}/training/reflection", json={
                    "task_id": task_id, "step_id": step_id,
                    "original_text": "软件流程测试输入；不代表真实硬件已经完成。", "source_type": "TEXT",
                })
            else:
                response = self.client.post(f"/api/live/sessions/{self.sid}/training/steps/{step_id}/facts", json={"fact": "SOFTWARE_WORKFLOW_FACT"})
            self.assertIn(response.status_code, (200, 201), response.text)
        self.assertEqual(self.client.post(f"/api/live/sessions/{self.sid}/training/reflection", json={
            "task_id": task_id, "original_text": "软件流程测试输入；不代表真实硬件已经完成。", "source_type": "TEXT",
        }).status_code, 201)
        complete = self.client.post(f"/api/live/sessions/{self.sid}/training/tasks/{task_id}/complete", json={})
        self.assertEqual(complete.status_code, 200, complete.text)
        if complete.json()["training"]["task_state"] == "PENDING_TEACHER_REVIEW":
            reviewed = self.client.post(
                f"/api/live/sessions/{self.sid}/training/teacher-review", headers=self.teacher_headers,
                json={"task_id": task_id, "decision": "APPROVE", "note": "SOFTWARE_WORKFLOW_PASS; REAL_HARDWARE_NOT_TESTED"},
            )
            self.assertEqual(reviewed.status_code, 200, reviewed.text)

    def test_task01_through_task06_reach_six_of_twelve_and_unlock_task07(self):
        initial_view = self.client.get(f"/api/live/sessions/{self.sid}/training/tasks/TASK_07").json()["training_task_view"]
        self.assertTrue(initial_view["actionable"])
        self.assertTrue(initial_view["unsafe_action_allowed"])
        for number in range(1, 7):
            self.finish_task(f"TASK_{number:02d}")
        state = self.state()
        self.assertEqual(state["overall_progress"], "6 / 12")
        view = self.client.get(f"/api/live/sessions/{self.sid}/training/tasks/TASK_07").json()["training_task_view"]
        self.assertTrue(view["actionable"])
        self.assertEqual(view["missing_prerequisites"], [])


if __name__ == "__main__":
    unittest.main()
