"""CW／CCW 兩類對應規則 + 語義驗證（P7-C，2026-10-29）。

本測試「在隔離測試中明確建立」四類槳葉模型輸出 → 兩類（CW／CCW）的對應規則，
並鎖定 §四 要求的語義結論：

    CW／CCW 是「螺旋槳旋向（規格方向）」，不是「觀察視角方向」。

三組驗證案例（正面／反面／相機視角）與四類契約保護一起寫在這裡。
它只驗證規則與語義，**不**做任何模型推論、不載入 .pt、不依賴真實圖片。

重要前提（如實記錄，非阻擋本測試）：現有 PROP_DIRECTION 模型為四類
（CW_F/CCW_F/CW_B/CCW_B），本輪端到端 CW/CCW 驗收仍待教師提供
「真實槳葉照片」與「已訓練模型」後方可執行；本測試僅證明對應規則與語義正確。
"""

import unittest

from app.vision_center import (
    PROP_DIRECTION_TO_CW_CCW,
    PROP_CLASSES,
    evaluate_prop,
    map_prop_to_direction,
)


class PropDirectionCwCcwMappingTests(unittest.TestCase):
    """對應規則本身。"""

    def test_four_classes_collapse_to_two(self):
        self.assertEqual(map_prop_to_direction("CW_F"), "CW")
        self.assertEqual(map_prop_to_direction("CW_B"), "CW")
        self.assertEqual(map_prop_to_direction("CCW_F"), "CCW")
        self.assertEqual(map_prop_to_direction("CCW_B"), "CCW")

    def test_case_insensitive_and_whitespace(self):
        self.assertEqual(map_prop_to_direction(" cw_f "), "CW")
        self.assertEqual(map_prop_to_direction("CcW_b"), "CCW")

    def test_unknown_class_returns_none(self):
        self.assertIsNone(map_prop_to_direction("FRONT"))
        self.assertIsNone(map_prop_to_direction("CW_X"))
        self.assertIsNone(map_prop_to_direction("NONSENSE"))

    def test_empty_and_none_return_none(self):
        self.assertIsNone(map_prop_to_direction(None))
        self.assertIsNone(map_prop_to_direction(""))
        self.assertIsNone(map_prop_to_direction("   "))

    def test_mapping_covers_every_model_class(self):
        # 規則必須涵蓋模型真實輸出的每一個類別，否則會有類別被悄悄丟棄。
        for cls in PROP_CLASSES:
            self.assertIn(cls, PROP_DIRECTION_TO_CW_CCW, f"類別 {cls} 缺少 CW/CCW 對應")
            self.assertIn(PROP_DIRECTION_TO_CW_CCW[cls], ("CW", "CCW"))

    def test_no_extra_or_missing_keys(self):
        # 對應表不應包含模型不輸出的類別（避免假裝兩類模型）。
        self.assertEqual(set(PROP_DIRECTION_TO_CW_CCW.keys()), set(PROP_CLASSES))


class PropDirectionSemanticsTests(unittest.TestCase):
    """§四 語義驗證：旋向（規格方向）vs 視角（觀察方向）。

    若 CW/CCW 是「觀察視角方向」，則從槳葉背面看同一支槳，順時針會變成逆時針，
    因此 CW_B 應該對應 CCW。本專案確認它是「機體座標系下的旋向」，
    所以槳面（_F／_B）不改變旋向，CW_F 與 CW_B 同為 CW。
    """

    def test_front_face_cases(self):
        # 正面（_F）：面向相機的一面。
        self.assertEqual(map_prop_to_direction("CW_F"), "CW")
        self.assertEqual(map_prop_to_direction("CCW_F"), "CCW")

    def test_back_face_cases(self):
        # 反面（_B）：槳面翻面後仍是同一旋向，不得因視角翻轉而改變。
        self.assertEqual(map_prop_to_direction("CW_B"), "CW")
        self.assertEqual(map_prop_to_direction("CCW_B"), "CCW")

    def test_face_does_not_flip_rotation(self):
        # 核心斷言：剝離槳面後旋向不變。
        for rotation in ("CW", "CCW"):
            self.assertEqual(
                map_prop_to_direction(f"{rotation}_F"),
                map_prop_to_direction(f"{rotation}_B"),
                f"{rotation} 的正面與反面必須對應同一旋向（旋向屬機體座標系，非視角）",
            )

    def test_viewing_perspective_does_not_change_spec_direction(self):
        # 相機視角：同一支槳從正面拍與從背面拍，規格旋向相同。
        # 若未來有人把語義改成「觀察視角方向」，本斷言會立刻失敗，強制重新裁決。
        pairs = (("CW_F", "CW_B", "CW"), ("CCW_F", "CCW_B", "CCW"))
        for front, back, expected in pairs:
            self.assertEqual(map_prop_to_direction(front), expected)
            self.assertEqual(map_prop_to_direction(back), expected)
        # 反向確認：不得出現「背面翻轉」的實作（CW_B → CCW）。
        self.assertNotEqual(map_prop_to_direction("CW_B"), "CCW")
        self.assertNotEqual(map_prop_to_direction("CCW_B"), "CW")


class FourClassContractPreservedTests(unittest.TestCase):
    """四類契約保護：對應表不得污染規則引擎。"""

    def test_contract_order_is_exact(self):
        # 0 = CW_F / 1 = CCW_F / 2 = CW_B / 3 = CCW_B，順序即模型索引，不得變動。
        self.assertEqual(PROP_CLASSES, ("CW_F", "CCW_F", "CW_B", "CCW_B"))

    def test_contract_index_positions(self):
        self.assertEqual(PROP_CLASSES[0], "CW_F")
        self.assertEqual(PROP_CLASSES[1], "CCW_F")
        self.assertEqual(PROP_CLASSES[2], "CW_B")
        self.assertEqual(PROP_CLASSES[3], "CCW_B")

    def test_evaluate_prop_still_uses_four_classes(self):
        # 規則引擎的期望值仍是四類字串，證明映射沒有把規則降級為兩類。
        result = evaluate_prop([], 640, 480)
        expected_values = {item["expected"] for item in result["positions"].values()}
        self.assertTrue(expected_values.issubset(set(PROP_CLASSES)))
        for value in expected_values:
            self.assertIn("_", value, "evaluate_prop 的 expected 必須保留槳面後綴")

    def test_evaluate_prop_distinguishes_face(self):
        # 槳面錯誤仍必須被判為 FACE_WRONG，不能被兩類映射吞掉。
        detections = [
            {"class": "CCW_B", "confidence": 0.9, "center_x": 500, "center_y": 100},  # M1 期望 CCW_F
        ]
        result = evaluate_prop(detections, 640, 480, confidence_threshold=0.5)
        self.assertEqual(result["positions"]["M1"]["reason_code"], "FACE_WRONG")
        self.assertEqual(result["positions"]["M1"]["blade_face"], "BACK")

    def test_mapping_is_display_only(self):
        # 對應表只能是純查表，不得在 evaluate_prop 內部被呼叫而改變判定。
        detections = [
            {"class": "CW_F", "confidence": 0.9, "center_x": 100, "center_y": 100},   # M3 期望 CW_F → PASS
            {"class": "CCW_F", "confidence": 0.9, "center_x": 500, "center_y": 100},  # M1 期望 CCW_F → PASS
            {"class": "CW_F", "confidence": 0.9, "center_x": 100, "center_y": 400},   # M2 期望 CCW_F → ROTATION_WRONG
            {"class": "CW_F", "confidence": 0.9, "center_x": 500, "center_y": 400},   # M4 期望 CW_F → PASS
        ]
        result = evaluate_prop(detections, 640, 480, confidence_threshold=0.5)
        self.assertEqual(result["positions"]["M3"]["result"], "PASS")
        self.assertEqual(result["positions"]["M1"]["result"], "PASS")
        self.assertEqual(result["positions"]["M2"]["reason_code"], "ROTATION_WRONG")
        self.assertEqual(result["positions"]["M4"]["result"], "PASS")
        # 四類語義下整體為 NG（M2 旋向錯）；若被降級成兩類，M2 會被誤判為 PASS。
        self.assertEqual(result["final_result"], "NG")


if __name__ == "__main__":
    unittest.main()
