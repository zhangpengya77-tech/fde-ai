import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.sessions import InMemorySessionStore


class OfflineVisionAdapter:
    async def health(self) -> bool:
        return False


class LiveSessionTests(unittest.TestCase):
    def setUp(self):
        self.store = InMemorySessionStore()
        self.client = TestClient(
            create_app(vision_adapter=OfflineVisionAdapter(), session_store=self.store)
        )

    def test_creates_an_in_memory_demo_session_without_student_identity(self):
        response = self.client.post("/api/live/sessions", json={"mode": "demo"})

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertEqual(payload["mode"], "demo")
        self.assertEqual(len(payload["session_id"]), 36)
        self.assertIn("created_at", payload)
        self.assertNotIn("student_id", payload)
        self.assertIsNotNone(self.store.get(payload["session_id"]))

    def test_rejects_identity_and_permission_fields_from_the_browser(self):
        for forbidden_field in ("student_id", "teacher", "course_permission", "pass"):
            with self.subTest(forbidden_field=forbidden_field):
                response = self.client.post(
                    "/api/live/sessions",
                    json={"mode": "demo", forbidden_field: "forged"},
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"]["code"], "untrusted_field")

    def test_deletes_an_existing_session_and_then_reports_not_found(self):
        created = self.client.post("/api/live/sessions", json={}).json()

        deleted = self.client.delete(
            f"/api/live/sessions/{created['session_id']}"
        )
        repeated = self.client.delete(
            f"/api/live/sessions/{created['session_id']}"
        )

        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json(), {"deleted": True})
        self.assertEqual(repeated.status_code, 404)
        self.assertEqual(repeated.json()["error"]["code"], "session_not_found")


if __name__ == "__main__":
    unittest.main()
