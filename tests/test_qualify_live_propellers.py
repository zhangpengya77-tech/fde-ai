import unittest

from tools.qualify_live_propellers import evaluate_records


class QualificationMetricsTests(unittest.TestCase):
    def test_calculates_class_metrics_confusion_and_error_categories(self):
        records = [
            {"image_id": "cw-ok", "ground_truth": "cw_propeller", "detections": [{"class": "cw_propeller", "confidence": 0.9, "box": [1, 2, 3, 4]}]},
            {"image_id": "cw-wrong", "ground_truth": "cw_propeller", "detections": [{"class": "ccw_propeller", "confidence": 0.8, "box": [1, 2, 3, 4]}]},
            {"image_id": "ccw-ok", "ground_truth": "ccw_propeller", "detections": [{"class": "ccw_propeller", "confidence": 0.95, "box": [1, 2, 3, 4]}]},
            {"image_id": "ccw-none", "ground_truth": "ccw_propeller", "detections": []},
        ]
        result = evaluate_records(records, 0.5)
        self.assertEqual(result["confusion_matrix"]["cw_propeller"], {"cw_propeller": 1, "ccw_propeller": 1, "other": 0, "not_detected": 0})
        self.assertEqual(result["confusion_matrix"]["ccw_propeller"], {"cw_propeller": 0, "ccw_propeller": 1, "other": 0, "not_detected": 1})
        self.assertEqual(result["cw"]["recall"], 0.5)
        self.assertEqual(result["ccw"]["precision"], 0.5)
        self.assertEqual(result["overall_accuracy"], 0.5)
        self.assertEqual(result["records"][1]["error_category"], "CW_TO_CCW")
        self.assertEqual(result["records"][3]["error_category"], "NO_DETECTION")

    def test_requires_thirty_independent_images_per_class_and_all_thresholds(self):
        records = []
        for index in range(30):
            records.append({"image_id": f"cw-{index}", "ground_truth": "cw_propeller", "detections": [{"class": "cw_propeller", "confidence": 0.9, "box": [0, 0, 1, 1]}]})
            records.append({"image_id": f"ccw-{index}", "ground_truth": "ccw_propeller", "detections": [{"class": "ccw_propeller", "confidence": 0.9, "box": [0, 0, 1, 1]}]})
        results = {str(t): evaluate_records(records, t) for t in (0.5, 0.6, 0.7, 0.8)}
        self.assertTrue(all(item["qualification"] == "MODEL_QUALIFIED" for item in results.values()))
        self.assertEqual(set(results), {"0.5", "0.6", "0.7", "0.8"})

        insufficient = evaluate_records(records[:-1], 0.5)
        self.assertEqual(insufficient["qualification"], "MODEL_NOT_QUALIFIED")


if __name__ == "__main__":
    unittest.main()

