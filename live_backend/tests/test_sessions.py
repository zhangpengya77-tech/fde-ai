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
        # P3-E（2026-10-25）：P3-D 之後「正式模式永遠 Fail Closed」，未提供身分金鑰的
        # app 會在任何受保護路徑先回 503。本組測試驗的是「session 內容與欄位拒絕」，
        # 與身分鏈無關，因此明確以隔離開發模式建立 app；身分鏈本身由
        # test_p3e_gateway_security / test_p3d_live_identity_boundary 覆蓋。
        self.client = TestClient(
            create_app(
                vision_adapter=OfflineVisionAdapter(),
                session_store=self.store,
                dev_mode=True,
                require_live_auth=False,
            )
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
