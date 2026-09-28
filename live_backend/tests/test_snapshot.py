import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.sessions import InMemorySessionStore
from app.vision import VisionResult, VisionUnavailable


class FakeVisionAdapter:
    def __init__(self, *, failure=None):
        self.failure = failure

    async def health(self) -> bool:
        return self.failure is None

    async def detect(self, image_data: str, file_name: str, confidence: float):
        if self.failure:
            raise self.failure
        return VisionResult(
            detections=[
                {
                    "class": "ccw_propeller",
                    "confidence": 0.94,
                    "box": [12, 24, 120, 240],
                }
            ],
            upstream_ms=18.5,
        )


class SnapshotApiTests(unittest.TestCase):
    def make_client(self, adapter=None, max_image_bytes=1024):
        store = InMemorySessionStore()
        client = TestClient(
            create_app(
                vision_adapter=adapter or FakeVisionAdapter(),
                session_store=store,
                max_image_bytes=max_image_bytes,
            )
        )
        session_id = client.post("/api/live/sessions", json={}).json()["session_id"]
        return client, session_id

    def test_returns_detection_facts_with_session_and_frame_identifiers(self):
        client, session_id = self.make_client()

        response = client.post(
            f"/api/live/sessions/{session_id}/snapshot",
            json={
                "frame_id": "frame-001",
                "file_name": "camera.jpg",
                "image_data": "data:image/jpeg;base64,aGVsbG8=",
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["session_id"], session_id)
        self.assertEqual(payload["frame_id"], "frame-001")
        self.assertEqual(payload["detections"][0]["class"], "ccw_propeller")
        self.assertEqual(payload["metrics"]["vision_upstream_ms"], 18.5)
        self.assertGreaterEqual(payload["metrics"]["backend_ms"], 0)
        self.assertEqual(payload["sop"]["status"], "NG")
        for forbidden in ("annotatedImage", "ai_response", "student_id", "teacher"):
            self.assertNotIn(forbidden, response.text)

    def test_rejects_missing_session_invalid_image_and_oversized_image(self):
        client, session_id = self.make_client(max_image_bytes=3)

        missing = client.post(
            "/api/live/sessions/not-a-session/snapshot",
            json={"image_data": "data:image/jpeg;base64,eA=="},
        )
        invalid = client.post(
            f"/api/live/sessions/{session_id}/snapshot",
            json={"image_data": "https://example.test/image.jpg"},
        )
        oversized = client.post(
            f"/api/live/sessions/{session_id}/snapshot",
            json={"image_data": "data:image/jpeg;base64,aGVsbG8="},
        )

        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json()["error"]["code"], "session_not_found")
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "invalid_image")
        self.assertEqual(oversized.status_code, 413)
        self.assertEqual(oversized.json()["error"]["code"], "image_too_large")

    def test_returns_stable_service_unavailable_error_when_yolo_is_offline(self):
        client, session_id = self.make_client(
            adapter=FakeVisionAdapter(failure=VisionUnavailable())
        )

        response = client.post(
            f"/api/live/sessions/{session_id}/snapshot",
            json={"image_data": "data:image/jpeg;base64,eA=="},
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "vision_offline")
        self.assertNotIn("127.0.0.1", response.text)


if __name__ == "__main__":
    unittest.main()
