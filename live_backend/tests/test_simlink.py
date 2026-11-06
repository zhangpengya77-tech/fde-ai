"""手機遙控器配對（WebRTC 信令）服務測試"""
import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.simlink import ROOM_TTL_SECONDS, SimLinkStore, simlink_routes
from starlette.applications import Starlette


class OfflineVisionAdapter:
    async def health(self) -> bool:
        return False


OFFER = {"offer": {"type": "offer", "sdp": "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n"}}
ANSWER = {"answer": {"type": "answer", "sdp": "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\n"}}


class SimLinkFlowTests(unittest.TestCase):
    def setUp(self):
        # 用正式 create_app，確認路由真的掛上、且不需要登入身分
        self.client = TestClient(create_app(vision_adapter=OfflineVisionAdapter()))

    def test_full_pairing_flow(self):
        created = self.client.post("/api/simlink/rooms", json=OFFER)
        self.assertEqual(created.status_code, 201)
        code = created.json()["code"]
        self.assertEqual(len(code), 6)
        # 手機還沒回應：204
        self.assertEqual(self.client.get(f"/api/simlink/rooms/{code}/answer").status_code, 204)
        # 手機拿 offer（小寫配對碼也可以）
        offer = self.client.get(f"/api/simlink/rooms/{code.lower()}/offer")
        self.assertEqual(offer.json()["offer"], OFFER["offer"])
        self.assertEqual(self.client.post(f"/api/simlink/rooms/{code}/answer", json=ANSWER).status_code, 200)
        # 筆電拿到 answer
        self.assertEqual(self.client.get(f"/api/simlink/rooms/{code}/answer").json()["answer"], ANSWER["answer"])

    def test_second_phone_cannot_take_over(self):
        code = self.client.post("/api/simlink/rooms", json=OFFER).json()["code"]
        self.client.post(f"/api/simlink/rooms/{code}/answer", json=ANSWER)
        self.assertEqual(self.client.post(f"/api/simlink/rooms/{code}/answer", json=ANSWER).status_code, 409)
        self.assertEqual(self.client.get(f"/api/simlink/rooms/{code}/offer").status_code, 409)

    def test_unknown_code_and_bad_payloads(self):
        self.assertEqual(self.client.get("/api/simlink/rooms/ZZZZZZ/offer").status_code, 404)
        self.assertEqual(self.client.post("/api/simlink/rooms", json={"offer": "x"}).status_code, 400)
        self.assertEqual(self.client.post("/api/simlink/rooms", content=b"not json").status_code, 400)
        big = {"offer": {"type": "offer", "sdp": "a" * 20000}}
        self.assertEqual(self.client.post("/api/simlink/rooms", json=big).status_code, 400)

    def test_response_contains_no_cookie(self):
        r = self.client.post("/api/simlink/rooms", json=OFFER)
        self.assertNotIn("set-cookie", {k.lower() for k in r.headers})


class SimLinkExpiryTests(unittest.TestCase):
    def test_room_expires_after_ttl(self):
        now = [1000.0]
        store = SimLinkStore(clock=lambda: now[0])
        client = TestClient(Starlette(routes=simlink_routes(store)))
        code = client.post("/api/simlink/rooms", json=OFFER).json()["code"]
        now[0] += ROOM_TTL_SECONDS + 1
        self.assertEqual(client.get(f"/api/simlink/rooms/{code}/offer").status_code, 404)

    def test_room_cap(self):
        store = SimLinkStore()
        for _ in range(200):
            self.assertIsNotNone(store.create("{}"))
        self.assertIsNone(store.create("{}"))


if __name__ == "__main__":
    unittest.main()
