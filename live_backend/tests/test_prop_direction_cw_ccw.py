"""PROP_DIRECTION 兩類契約（2026-11-02 教師指令）：只判定 CW／CCW 旋向，不判定槳面。"""

import unittest

from app.vision_center import PROP_CLASSES, PROP_DIRECTION_TO_CW_CCW, evaluate_prop, map_prop_to_direction


def _detection(class_name, x, y):
    return {"class": class_name, "confidence": 0.9, "bbox": [x - 10, y - 10, x + 10, y + 10]}


class PropTwoClassContractTests(unittest.TestCase):
    def test_contract_order_is_exact(self):
        self.assertEqual(PROP_CLASSES, ("CW", "CCW"))

    def test_correct_rotation_passes_all_positions(self):
        detections = [_detection("CCW", 750, 250), _detection("CCW", 250, 750), _detection("CW", 250, 250), _detection("CW", 750, 750)]
        result = evaluate_prop(detections, 1000, 1000)
        self.assertEqual(result["final_result"], "PASS")
        self.assertTrue(all(item["blade_face"] is None for item in result["positions"].values()))

    def test_wrong_rotation_is_ng(self):
        detections = [_detection("CW", 750, 250), _detection("CCW", 250, 750), _detection("CW", 250, 250), _detection("CW", 750, 750)]
        result = evaluate_prop(detections, 1000, 1000)
        self.assertEqual(result["final_result"], "NG")
        self.assertEqual(result["positions"]["M1"]["reason_code"], "ROTATION_WRONG")

    def test_low_confidence_candidates_do_not_count_as_duplicates(self):
        noise = [{**_detection("CW", 760, 240), "confidence": 0.1} for _ in range(5)]
        detections = noise + [_detection("CCW", 750, 250), _detection("CCW", 250, 750), _detection("CW", 250, 250), _detection("CW", 750, 750)]
        self.assertEqual(evaluate_prop(detections, 1000, 1000)["final_result"], "PASS")

    def test_two_confident_boxes_in_one_position_stay_duplicate(self):
        detections = [_detection("CCW", 750, 250), _detection("CCW", 700, 200)]
        self.assertEqual(evaluate_prop(detections, 1000, 1000)["positions"]["M1"]["reason_code"], "DUPLICATE_DETECTION")

    def test_legacy_four_class_output_is_not_accepted_as_pass(self):
        result = evaluate_prop([_detection("CW_F", 250, 250)], 1000, 1000)
        self.assertEqual(result["positions"]["M3"]["result"], "NG")


class PropDirectionDisplayMappingTests(unittest.TestCase):
    def test_every_contract_class_maps_to_itself(self):
        for name in PROP_CLASSES:
            self.assertEqual(map_prop_to_direction(name), name)

    def test_legacy_names_collapse_for_history_display(self):
        self.assertEqual(map_prop_to_direction("cw_b"), "CW")
        self.assertEqual(map_prop_to_direction(" CCW_F "), "CCW")

    def test_unknown_and_empty_return_none(self):
        self.assertIsNone(map_prop_to_direction("cw_propeller"))
        self.assertIsNone(map_prop_to_direction(""))
        self.assertIsNone(map_prop_to_direction(None))

    def test_mapping_only_targets_contract_classes(self):
        self.assertEqual(set(PROP_DIRECTION_TO_CW_CCW.values()), set(PROP_CLASSES))
