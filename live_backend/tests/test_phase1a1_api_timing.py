import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.sessions import InMemorySessionStore
from app.vision import VisionResult


class TimedVision:
    async def health(self):
        return True

    async def detect(self, _image_data, _file_name, _confidence):
        return VisionResult(
            detections=[],
            upstream_ms=20.0,
            timings={
                "server_decode_ms": 3.0,
                "queue_wait_ms": 0.2,
                "model_preprocess_ms": 1.0,
                "model_inference_ms": 12.0,
                "postprocess_ms": 2.0,
            },
        )


class Phase1A1ApiTimingTests(unittest.TestCase):
    def test_snapshot_response_exposes_split_vision_timings(self):
        client = TestClient(create_app(vision_adapter=TimedVision(), session_store=InMemorySessionStore()))
        session_id = client.post("/api/live/sessions", json={}).json()["session_id"]
        response = client.post(
            f"/api/live/sessions/{session_id}/snapshot",
            json={"image_data": "data:image/jpeg;base64,eA=="},
        )
        self.assertEqual(response.status_code, 200)
        metrics = response.json()["metrics"]
        self.assertEqual(metrics["server_decode_ms"], 3.0)
        self.assertEqual(metrics["queue_wait_ms"], 0.2)
        self.assertEqual(metrics["model_inference_ms"], 12.0)
        self.assertEqual(metrics["postprocess_ms"], 2.0)


if __name__ == "__main__":
    unittest.main()

