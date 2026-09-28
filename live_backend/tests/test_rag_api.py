import asyncio
import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.rag import RAGResult
from app.sessions import InMemorySessionStore


class OfflineVision:
    async def health(self): return False


class ControlledRAG:
    def __init__(self):
        self.questions = []

    async def query(self, question, request_id, context_version):
        self.questions.append(question)
        await asyncio.sleep(0)
        return RAGResult("online", "PASS，可以继续。", None, None, 1, True, None, request_id, context_version)


class RAGApiTests(unittest.TestCase):
    def test_simulate_returns_authoritative_sop_and_separate_pending_explanation(self):
        rag = ControlledRAG()
        client = TestClient(create_app(
            vision_adapter=OfflineVision(),
            session_store=InMemorySessionStore(),
            rag_adapter=rag,
            dev_mode=True,
        ))
        created = client.post("/api/live/sessions", json={"vision_source": "MOCK_VISION"}).json()
        response = client.post(
            f"/api/live/sessions/{created['session_id']}/simulate",
            json={
                "scenario": "frame_arm",
                "course_id": "CLIENT_OVERRIDE",
                "sop_result": "PASS",
            },
        )
        body = response.json()
        self.assertEqual(body["sop"]["status"], "NG")
        self.assertEqual(body["session"]["course_id"], "F450_BASIC_ASSEMBLY")
        self.assertIn(body["rag_explanation"]["status"], {"pending", "online"})
        self.assertNotEqual(body["rag_explanation"].get("explanation"), "PASS")


if __name__ == "__main__":
    unittest.main()
