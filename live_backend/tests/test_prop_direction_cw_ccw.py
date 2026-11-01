"""CW／CCW 兩類對應規則（接棒驗收 2026-10-29）。

本測試「在隔離測試中明確建立」四類槳葉模型輸出 → 兩類（CW／CCW）的對應規則。
它只驗證規則本身的正確性，**不**做任何模型推論、不載入 .pt、不依賴真實圖片。

重要前提（如實記錄，非阻擋本測試）：現有 PROP_DIRECTION 模型為四類
（CW_F/CCW_F/CW_B/CCW_B），本輪端到端 CW/CCW 驗收仍待教師提供
「真實槳葉照片」與「已訓練模型」後方可執行；本測試僅證明對應規則邏輯正確。
"""

import unittest

from app.vision_center import (
    PROP_DIRECTION_TO_CW_CCW,
    PROP_CLASSES,
    map_prop_to_direction,
)


class PropDirectionCwCcwMappingTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
