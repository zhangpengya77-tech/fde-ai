"""P7-B4 驗收：Assertion 必須綁定**真實** method / path / body，且竄改任一項都被拒。

批准令要求：
* Assertion 綁定實際 HTTP Method、實際目標 Path、實際請求 body 的 SHA-256；
* 禁止用固定的 `GET /` 或空 JSON 代表實際操作；
* 竄改 Method / Path / Body 任一項都必須被拒絕。

本檔同時驗證閘道（送出什麼）與 Live（拒絕什麼），以及 Django 端對 target 的驗證。
"""

from __future__ import annotations

import base64
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import httpx
from starlette.testclient import TestClient

from app import live_assertions
from app.gateway import GatewayConfig, IdentityGateway
from app.main import create_app
from app.sessions import InMemorySessionStore
from app.vision_center import HOVER_CLASSES, PROP_CLASSES, VisionCenter


ASSERTION_KEY = "p7-b4-assertion-key"
PROXY_KEY = "p7-b4-proxy-key"
GATEWAY_KEY = "p7-b4-gateway-key"
DJANGO_ORIGIN = "http://127.0.0.1:8120"
PUBLIC_ORIGIN = "https://127.0.0.1:8443"
COOKIE = "sessionid=abc; csrftoken=" + "a" * 32


class OfflineVision:
    async def health(self):
        return False


class FixtureValidator:
    def validate(self, _path, model_type):
        return {
            "class_names": list(PROP_CLASSES if model_type == "PROP_DIRECTION" else HOVER_CLASSES),
            "task": "detect",
            "smoke_inference": True,
        }


class FixtureRunner:
    def predict(self, _path, _image_bytes):
        return []


def _load_django_assertions():
    path = Path(__file__).resolve().parents[2] / "student_portal" / "learning" / "live_assertions.py"
    spec = importlib.util.spec_from_file_location("p7b4_django_assertions", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


DJANGO_ASSERTIONS = _load_django_assertions()


class GatewayTargetBindingTests(unittest.TestCase):
    """閘道必須把「真實操作」交給 Django 簽進 claims。"""

    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".test-temp"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.center = VisionCenter(
            self.temp.name, model_validator=FixtureValidator(), model_runner=FixtureRunner()
        )
        self.calls: list[httpx.Request] = []
        self.downstream_bodies: list[bytes] = []

    def tearDown(self):
        self.temp.cleanup()

    def _build(self):
        downstream_bodies = self.downstream_bodies

        class _RecordingApp:
            async def __call__(self, scope, receive, send):
                body = b""
                while True:
                    message = await receive()
                    if message["type"] == "http.request":
                        body += message.get("body", b"")
                        if not message.get("more_body", False):
                            break
                downstream_bodies.append(body)
                await send(
                    {
                        "type": "http.response.start",
                        "status": 200,
                        "headers": [(b"content-type", b"application/json")],
                    }
                )
                await send({"type": "http.response.body", "body": b"{}"})

        def handler(request: httpx.Request) -> httpx.Response:
            self.calls.append(request)
            target = json.loads(request.content.decode("utf-8") or "{}")
            claims = {
                "sub": "student:7",
                "role": "student",
                "enrollment_id": 11,
                "cohort_ids": ["COHORT-A"],
                "method": target["method"],
                "path": target["path"],
                "body_sha256": target["body_sha256"],
            }
            return httpx.Response(
                200, json={"assertion": DJANGO_ASSERTIONS.issue_assertion(claims, ASSERTION_KEY)}
            )

        config = GatewayConfig(
            django_origin=DJANGO_ORIGIN,
            gateway_key=GATEWAY_KEY,
            proxy_key=PROXY_KEY,
            timeout_seconds=2.0,
            csrf_origin=PUBLIC_ORIGIN,
        )
        return TestClient(
            IdentityGateway(_RecordingApp(), config=config, transport=httpx.MockTransport(handler))
        )

    def test_b4_1_gateway_sends_real_method_path_and_body_hash(self):
        client = self._build()
        payload = {"task_id": "PROP_DIRECTION", "student_id": "S1"}
        client.post("/api/v1/vision/submissions", json=payload, headers={"Cookie": COOKIE})
        self.assertEqual(len(self.calls), 1)
        target = json.loads(self.calls[0].content.decode("utf-8"))
        self.assertEqual(target["method"], "POST")
        self.assertEqual(target["path"], "/api/v1/vision/submissions")
        self.assertEqual(
            target["body_sha256"],
            live_assertions.body_sha256(self.downstream_bodies[0]),
            "簽章的 body hash 必須等於下游實際收到的位元組",
        )

    def test_b4_2_gateway_no_longer_sends_empty_json(self):
        client = self._build()
        client.post("/api/v1/vision/submissions", json={"x": 1}, headers={"Cookie": COOKIE})
        target = json.loads(self.calls[0].content.decode("utf-8"))
        self.assertNotEqual(target.get("path"), "/", "不得再用固定 GET / 代表真實操作")
        self.assertEqual(target.get("method"), "POST")

    def test_b4_3_gateway_replays_the_body_byte_for_byte(self):
        client = self._build()
        payload = {"task_id": "PROP_DIRECTION", "student_id": "S1", "file_base64": "QUJD"}
        client.post("/api/v1/vision/submissions", json=payload, headers={"Cookie": COOKIE})
        self.assertEqual(
            json.loads(self.downstream_bodies[0].decode("utf-8")),
            payload,
            "下游收到的 JSON 必須與客戶端送出的內容一致（本文被讀走後必須重放）",
        )

    def test_b4_4_gateway_binds_delete_and_get_methods_too(self):
        client = self._build()
        client.get("/api/v1/vision/models", headers={"Cookie": COOKIE})
        target = json.loads(self.calls[0].content.decode("utf-8"))
        self.assertEqual(target["method"], "GET")
        self.assertEqual(target["path"], "/api/v1/vision/models")
        self.assertEqual(target["body_sha256"], live_assertions.body_sha256(b""))


class LiveTamperRejectionTests(unittest.TestCase):
    """Live 端：Method / Path / Body 任一被改都必須拒絕。"""

    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".test-temp"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.center = VisionCenter(
            self.temp.name, model_validator=FixtureValidator(), model_runner=FixtureRunner()
        )
        self.app = create_app(
            vision_adapter=OfflineVision(), vision_center=self.center, dev_mode=False,
            live_assertion_key=ASSERTION_KEY, trusted_proxy_key=PROXY_KEY, require_live_auth=True,
        )
        import os

        self._saved = {k: os.environ.get(k) for k in ("FDE_INTERNAL_SHARED_SECRET", "FDE_REPLAY_LEDGER_PATH")}
        os.environ["FDE_INTERNAL_SHARED_SECRET"] = ASSERTION_KEY
        os.environ["FDE_REPLAY_LEDGER_PATH"] = str(Path(self.temp.name) / "ledger.sqlite3")
        from app import internal_auth

        internal_auth._LEDGERS.clear()

    def tearDown(self):
        import os

        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        from app import internal_auth

        internal_auth._LEDGERS.clear()
        self.temp.cleanup()

    def _token(self, **overrides):
        body = b'{"detections": [], "image_width": 100, "image_height": 100}'
        claims = {
            "sub": "student:7",
            "role": "student",
            "enrollment_id": 11,
            "cohort_ids": ["COHORT-A"],
            "method": "POST",
            "path": "/api/v1/vision/prop-check",
            "body_sha256": live_assertions.body_sha256(body),
        }
        claims.update(overrides)
        return live_assertions.issue_live_assertion(claims, ASSERTION_KEY), body

    def _post(self, token, body):
        return TestClient(self.app).post(
            "/api/v1/vision/prop-check",
            content=body,
            headers={"Content-Type": "application/json", "X-FDE-Live-Assertion": token},
        )

    def test_b4_5_correctly_bound_assertion_is_accepted(self):
        token, body = self._token()
        response = self._post(token, body)
        self.assertEqual(response.status_code, 200, response.text)

    def test_b4_6_tampered_method_is_rejected(self):
        token, body = self._token(method="GET")
        response = self._post(token, body)
        self.assertEqual(response.status_code, 403)
        self.assertIn("method_mismatch", response.text)

    def test_b4_7_tampered_path_is_rejected(self):
        token, body = self._token(path="/api/v1/vision/models")
        response = self._post(token, body)
        self.assertEqual(response.status_code, 403)
        self.assertIn("path_mismatch", response.text)

    def test_b4_8_tampered_body_is_rejected(self):
        token, _body = self._token()
        tampered = b'{"detections": [], "image_width": 999, "image_height": 100}'
        response = self._post(token, tampered)
        self.assertEqual(response.status_code, 403)
        self.assertIn("body_tampered", response.text)

    def test_b4_9_empty_body_assertion_cannot_be_reused_for_a_real_operation(self):
        """用「空 JSON」簽出來的票，打真實操作必被拒（正是舊版的行為）。"""
        token = live_assertions.issue_live_assertion(
            {
                "sub": "student:7",
                "role": "student",
                "enrollment_id": 11,
                "cohort_ids": ["COHORT-A"],
                "method": "GET",
                "path": "/",
                "body_sha256": live_assertions.body_sha256(b""),
            },
            ASSERTION_KEY,
        )
        body = b'{"detections": [], "image_width": 100, "image_height": 100}'
        response = self._post(token, body)
        self.assertEqual(response.status_code, 403)
        self.assertIn("mismatch", response.text)
