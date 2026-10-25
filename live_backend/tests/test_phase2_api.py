import unittest
from starlette.testclient import TestClient
from app.live_assertions import issue_live_assertion
from app.main import create_app
from app.sessions import InMemorySessionStore

ASSERTION_KEY = "phase2-test-assertion-key"
PROXY_KEY = "phase2-test-proxy-key"

class OfflineVision:
    async def health(self): return False
    async def detect(self, *_args): raise AssertionError("wrong vision route")

class Phase2ApiTests(unittest.TestCase):
    def make_client(self, dev_mode=True):
        # P3-E（2026-10-25）：dev_mode=False 等同正式模式，P3-D 之後一律 Fail Closed，
        # 因此必須提供金鑰；需要走受保護路徑的測試另附簽章標頭（見 _signed_headers）。
        return TestClient(create_app(
            vision_adapter=OfflineVision(),
            session_store=InMemorySessionStore(),
            dev_mode=dev_mode,
            live_assertion_key=ASSERTION_KEY,
            trusted_proxy_key=PROXY_KEY,
        ))

    def _signed_headers(self, subject="student:9001", enrollment_id=9001):
        claims = {
            "sub": subject,
            "role": "student",
            "cohort_ids": ["cohort-phase2"],
            "enrollment_id": enrollment_id,
        }
        return {
            "X-FDE-Proxy-Auth": PROXY_KEY,
            "X-FDE-Live-Assertion": issue_live_assertion(claims, ASSERTION_KEY),
        }

    def test_mock_full_workflow_and_authoritative_routes(self):
        client = self.make_client()
        created = client.post("/api/live/sessions", json={"mode":"demo","vision_source":"MOCK_VISION"}).json()
        sid = created["session_id"]
        wrong = client.post(f"/api/live/sessions/{sid}/simulate", json={"scenario":"frame_arm","frame_id":"f1"})
        self.assertEqual(wrong.json()["sop"]["status"], "NG")
        for scenario in ("motor","frame_arm","flight_controller"):
            result = client.post(f"/api/live/sessions/{sid}/simulate", json={"scenario":scenario,"frame_id":f"f-{scenario}"})
            self.assertEqual(result.json()["sop"]["status"], "PASS_CANDIDATE")
            confirmed = client.post(f"/api/live/sessions/{sid}/confirm", json={})
        self.assertEqual(confirmed.json()["session"]["state"], "TASK_COMPLETED")
        state = client.get(f"/api/live/sessions/{sid}")
        events = client.get(f"/api/live/sessions/{sid}/events")
        self.assertEqual(state.status_code, 200)
        self.assertEqual([e["sequence"] for e in events.json()["events"]], list(range(1, len(events.json()["events"])+1)))

    def test_mock_is_rejected_when_dev_mode_is_off(self):
        client = self.make_client(False)
        headers = self._signed_headers()
        created = client.post("/api/live/sessions", json={}, headers=headers).json()
        response = client.post(f"/api/live/sessions/{created['session_id']}/simulate", json={"scenario":"motor"}, headers=headers)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "dev_only")

    def test_confirmation_requires_pass_candidate_and_cannot_replay(self):
        client = self.make_client()
        created = client.post("/api/live/sessions", json={"vision_source":"MOCK_VISION"}).json()
        sid = created["session_id"]
        self.assertEqual(client.post(f"/api/live/sessions/{sid}/confirm", json={}).status_code, 409)
        client.post(f"/api/live/sessions/{sid}/simulate", json={"scenario":"motor","frame_id":"f1"})
        self.assertEqual(client.post(f"/api/live/sessions/{sid}/confirm", json={}).status_code, 200)
        self.assertEqual(client.post(f"/api/live/sessions/{sid}/confirm", json={}).status_code, 409)

    def test_vision_routes_enforce_session_source(self):
        client = self.make_client()
        real = client.post("/api/live/sessions", json={"vision_source":"REAL_VISION"}).json()["session_id"]
        mock = client.post("/api/live/sessions", json={"vision_source":"MOCK_VISION"}).json()["session_id"]
        simulated = client.post(f"/api/live/sessions/{real}/simulate", json={"scenario":"motor"})
        self.assertEqual(simulated.status_code, 409)
        self.assertEqual(simulated.json()["error"]["code"], "vision_source_mismatch")
        snapshot = client.post(f"/api/live/sessions/{mock}/snapshot", json={"image_data":"data:image/jpeg;base64,YQ=="})
        self.assertEqual(snapshot.status_code, 409)
        self.assertEqual(snapshot.json()["error"]["code"], "vision_source_mismatch")
