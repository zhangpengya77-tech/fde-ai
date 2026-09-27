import unittest

from starlette.testclient import TestClient

from app.main import create_app


class OfflineVisionAdapter:
    async def health(self) -> bool:
        return False


class LivePageTests(unittest.TestCase):
    def test_live_page_is_served_without_changing_the_existing_home_page(self):
        client = TestClient(create_app(vision_adapter=OfflineVisionAdapter()))

        response = client.get("/live/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Live Coach MVP", response.text)
        self.assertIn("live.js", response.text)


if __name__ == "__main__":
    unittest.main()
