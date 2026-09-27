import tempfile
import unittest
from pathlib import Path

from tools.phase1a1_benchmark import iou, parse_yolo_labels


class BenchmarkHelpersTests(unittest.TestCase):
    def test_parses_yolo_ground_truth_into_pixel_boxes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.txt"
            path.write_text("0 0.5 0.5 0.5 0.25\n", encoding="utf-8")
            labels = parse_yolo_labels(path, 640, 480, {0: "cw_propeller"})
        self.assertEqual(labels, [{"class": "cw_propeller", "box": [160.0, 180.0, 480.0, 300.0]}])

    def test_iou_is_one_for_identical_boxes_and_zero_for_disjoint_boxes(self):
        self.assertEqual(iou([0, 0, 10, 10], [0, 0, 10, 10]), 1.0)
        self.assertEqual(iou([0, 0, 10, 10], [20, 20, 30, 30]), 0.0)


if __name__ == "__main__":
    unittest.main()

