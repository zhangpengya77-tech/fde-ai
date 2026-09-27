import asyncio
import unittest

from starlette.testclient import TestClient

from app.main import create_app


class FakeVisionAdapter:
    def __init__(self, online: bool, delay_seconds: float = 0):
        self.online = online
        self.delay_seconds = delay_seconds

    async def health(self) -> bool:
        if self.delay_seconds:
            await asyncio.sleep(self.delay_seconds)
        return self.online


class LiveHealthTests(unittest.TestCase):
    def test_reports_online_when_live_backend_and_vision_are_available(self):
        client = TestClient(create_app(vision_adapter=FakeVisionAdapter(True)))

        response = client.get("/api/live/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "status": "online",
                "components": {
                    "live_backend": "online",
                    "vision": "online",
                },
            },
        )
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_reports_degraded_when_vision_is_offline(self):
        client = TestClient(create_app(vision_adapter=FakeVisionAdapter(False)))

        response = client.get("/api/live/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "degraded")
        self.assertEqual(response.json()["components"]["vision"], "offline")

    def test_times_out_slow_vision_health_without_exposing_internal_details(self):
        client = TestClient(
            create_app(
                vision_adapter=FakeVisionAdapter(True, delay_seconds=0.05),
                vision_health_timeout_seconds=0.01,
            )
        )

        response = client.get("/api/live/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "degraded")
        self.assertNotIn("path", response.text.lower())
        self.assertNotIn("127.0.0.1", response.text)


if __name__ == "__main__":
    unittest.main()
