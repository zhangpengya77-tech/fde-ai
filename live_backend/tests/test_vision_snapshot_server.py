import unittest

from dev.vision_snapshot_server import sanitize_detector_result


class SnapshotVisionServerTests(unittest.TestCase):
    def test_strips_annotated_image_and_decisions_from_existing_detector_result(self):
        sanitized = sanitize_detector_result(
            {
                "status": "PASS",
                "score": 100,
                "summary": "not a detection fact",
                "annotatedImage": "data:image/jpeg;base64,large",
                "modelPath": "E:/private/best.pt",
                "detections": [
                    {
                        "className": "cw_propeller",
                        "confidence": 0.91,
                        "box": [1, 2, 3, 4],
                        "center": [2, 3],
                    }
                ],
            }
        )

        self.assertEqual(
            sanitized,
            {
                "detections": [
                    {
                        "className": "cw_propeller",
                        "confidence": 0.91,
                        "box": [1, 2, 3, 4],
                        "center": [2, 3],
                    }
                ]
            },
        )


if __name__ == "__main__":
    unittest.main()
