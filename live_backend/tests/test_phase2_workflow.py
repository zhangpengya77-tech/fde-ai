import unittest
from starlette.testclient import TestClient
from app.main import create_app
from app.sessions import InMemorySessionStore

class OfflineVision:
    async def health(self): return False

class Phase2WorkflowTests(unittest.TestCase):
    def test_mock_task_and_lifecycle_events(self):
        client = TestClient(create_app(vision_adapter=OfflineVision(), session_store=InMemorySessionStore(), dev_mode=True))
        created = client.post("/api/live/sessions", json={"vision_source":"MOCK_VISION"}).json()
        sid = created["session_id"]
        self.assertEqual(client.post(f"/api/live/sessions/{sid}/camera/start", json={}).status_code, 200)
        self.assertEqual(client.post(f"/api/live/sessions/{sid}/auto/start", json={}).status_code, 200)

        wrong = client.post(f"/api/live/sessions/{sid}/simulate", json={"scenario":"frame_arm","frame_id":"wrong"})
        self.assertEqual(wrong.json()["sop"]["status"], "NG")
        expected_steps = [
            ("motor", "prepare_frame_arm"),
            ("frame_arm", "prepare_flight_controller"),
            ("flight_controller", None),
        ]
        for index, (scenario, next_step) in enumerate(expected_steps):
            detected = client.post(f"/api/live/sessions/{sid}/simulate", json={"scenario":scenario,"frame_id":f"ok-{index}"})
            self.assertEqual(detected.json()["sop"]["status"], "PASS_CANDIDATE")
            confirmed = client.post(f"/api/live/sessions/{sid}/confirm", json={})
            self.assertEqual(confirmed.status_code, 200)
            if next_step:
                self.assertEqual(confirmed.json()["session"]["current_step_id"], next_step)
        self.assertEqual(confirmed.json()["session"]["state"], "TASK_COMPLETED")
        self.assertEqual(client.post(f"/api/live/sessions/{sid}/auto/stop", json={}).status_code, 200)

        events = client.get(f"/api/live/sessions/{sid}/events").json()["events"]
        types = [event["type"] for event in events]
        for event_type in ("SESSION_STARTED","STEP_STARTED","CAMERA_STARTED","AUTO_OBSERVATION_STARTED","NG","PASS_CANDIDATE","STEP_CONFIRMED","STEP_COMPLETED","TASK_COMPLETED","AUTO_OBSERVATION_STOPPED"):
            self.assertIn(event_type, types)
        self.assertEqual([event["sequence"] for event in events], list(range(1, len(events) + 1)))

if __name__ == "__main__":
    unittest.main()
