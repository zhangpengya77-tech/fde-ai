import asyncio
import unittest

import httpx

from app.vision import VisionAdapter
from dev.vision_snapshot_server import sanitize_detector_result


TIMINGS = {
    "server_decode_ms": 3.2,
    "queue_wait_ms": 0.1,
    "model_preprocess_ms": 0.4,
    "model_inference_ms": 12.4,
    "postprocess_ms": 1.7,
}


class Phase1A1TimingTests(unittest.TestCase):
    def test_snapshot_sanitizer_preserves_only_detection_facts_and_timings(self):
        result = sanitize_detector_result(
            {
                "status": "PASS",
                "modelPath": "E:/private/best.pt",
                "annotatedImage": "large",
                "detections": [],
                "timings": TIMINGS,
            }
        )
        self.assertEqual(result, {"detections": [], "timings": TIMINGS})

    def test_adapter_propagates_real_vision_timing_fields(self):
        def upstream(_request):
            return httpx.Response(200, json={"ok": True, "result": {"detections": [], "timings": TIMINGS}})

        adapter = VisionAdapter("http://127.0.0.1:8765", transport=httpx.MockTransport(upstream))
        result = asyncio.run(adapter.detect("data:image/jpeg;base64,eA==", "frame.jpg", 0.25))
        self.assertEqual(result.timings, TIMINGS)


if __name__ == "__main__":
    unittest.main()

