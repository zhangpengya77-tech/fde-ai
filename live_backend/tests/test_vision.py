import asyncio
import unittest

import httpx

from app.vision import VisionAdapter, VisionResponseError, VisionUnavailable


class VisionAdapterTests(unittest.TestCase):
    def test_normalizes_yolo_response_to_detection_facts_only(self):
        def upstream(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.path, "/api/detect")
            payload = __import__("json").loads(request.content)
            self.assertEqual(payload["fileName"], "frame.jpg")
            self.assertEqual(payload["conf"], 0.25)
            return httpx.Response(
                200,
                json={
                    "ok": True,
                    "result": {
                        "engine": "YOLOv8 local",
                        "modelPath": "E:/private/best.pt",
                        "status": "PASS",
                        "score": 100,
                        "summary": "do not expose",
                        "teacherStatus": "do not expose",
                        "detections": [
                            {
                                "className": "cw_propeller",
                                "label": "CW 正槳",
                                "confidence": 0.9137,
                                "box": [10.2, 20.7, 110.9, 220.1],
                                "center": [60, 120],
                            }
                        ],
                        "checklist": [{"result": "PASS"}],
                        "motorChecks": [{"result": "PASS"}],
                        "annotatedImage": "data:image/jpeg;base64,secret",
                    },
                },
            )

        adapter = VisionAdapter(
            "http://127.0.0.1:8765",
            transport=httpx.MockTransport(upstream),
        )

        result = asyncio.run(
            adapter.detect("data:image/jpeg;base64,aGVsbG8=", "frame.jpg", 0.25)
        )

        self.assertEqual(
            result.detections,
            [
                {
                    "class": "cw_propeller",
                    "confidence": 0.914,
                    "box": [10, 21, 111, 220],
                }
            ],
        )
        serialized = str(result.detections)
        for forbidden in ("PASS", "annotatedImage", "best.pt", "teacherStatus"):
            self.assertNotIn(forbidden, serialized)
        self.assertGreaterEqual(result.upstream_ms, 0)

    def test_health_returns_false_for_an_unavailable_yolo_service(self):
        def upstream(_request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("offline")

        adapter = VisionAdapter(
            "http://127.0.0.1:8765",
            transport=httpx.MockTransport(upstream),
        )

        self.assertFalse(asyncio.run(adapter.health()))

    def test_detect_maps_network_failure_and_malformed_payload_to_stable_exceptions(self):
        def offline(_request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("E:/private/model/path")

        def malformed(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"ok": True, "result": {"detections": "bad"}})

        offline_adapter = VisionAdapter(
            "http://127.0.0.1:8765", transport=httpx.MockTransport(offline)
        )
        malformed_adapter = VisionAdapter(
            "http://127.0.0.1:8765", transport=httpx.MockTransport(malformed)
        )

        with self.assertRaises(VisionUnavailable):
            asyncio.run(offline_adapter.detect("data:image/jpeg;base64,eA==", "x.jpg", 0.25))
        with self.assertRaises(VisionResponseError):
            asyncio.run(malformed_adapter.detect("data:image/jpeg;base64,eA==", "x.jpg", 0.25))


if __name__ == "__main__":
    unittest.main()
