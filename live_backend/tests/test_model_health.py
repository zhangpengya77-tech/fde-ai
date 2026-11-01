"""D1（2026-10-20）模型健康度模組單元測試。

只測試純邏輯（_classify / summarize / is_blocking / blocking_error_code /
map50_threshold / describe_for_teacher），不載入任何 .pt、不需要 torch。
"""

import os
import unittest

from app.model_health import (
    DEFAULT_MAP50_THRESHOLD,
    HEALTH_LOW_QUALITY,
    HEALTH_NC_MISMATCH,
    HEALTH_OK,
    HEALTH_UNTRAINED,
    HEALTH_UNKNOWN,
    _classify,
    blocking_error_code,
    describe_for_teacher,
    is_blocking,
    map50_threshold,
    summarize,
)


def facts(**overrides):
    base = {
        "health": HEALTH_UNKNOWN,
        "reasons": [],
        "path": "x.pt",
        "nc": None,
        "class_names": [],
        "names_count": 0,
        "has_train_args": False,
        "has_epoch": False,
        "has_metrics": False,
        "map50": None,
        "train_imgsz": None,
        "train_epochs": None,
    }
    base.update(overrides)
    return base


class ClassifyTests(unittest.TestCase):
    def test_untrained_when_no_training_metadata(self):
        health, reasons = _classify(facts(has_train_args=False, has_epoch=False, has_metrics=False), 0.5)
        self.assertEqual(health, HEALTH_UNTRAINED)
        self.assertIn("no_training_metadata", reasons)

    def test_nc_mismatch_takes_priority_over_low_quality(self):
        # 同時有 nc 不符與 mAP50 過低：優先回 NC_MISMATCH（類別契約不可信最嚴重）。
        health, reasons = _classify(
            facts(has_train_args=True, has_epoch=True, has_metrics=True, nc=80, names_count=4, map50=0.1),
            0.5,
        )
        self.assertEqual(health, HEALTH_NC_MISMATCH)
        self.assertIn("nc_mismatch", reasons)

    def test_low_quality_when_map50_below_threshold(self):
        health, reasons = _classify(
            facts(has_train_args=True, has_epoch=True, has_metrics=True, nc=4, names_count=4, map50=0.12),
            0.5,
        )
        self.assertEqual(health, HEALTH_LOW_QUALITY)
        self.assertIn("map50_below_threshold", reasons)

    def test_low_quality_when_map50_unknown(self):
        health, reasons = _classify(
            facts(has_train_args=True, has_epoch=True, has_metrics=True, nc=4, names_count=4, map50=None),
            0.5,
        )
        self.assertEqual(health, HEALTH_LOW_QUALITY)
        self.assertIn("map50_unknown", reasons)

    def test_ok_when_map50_meets_threshold(self):
        health, reasons = _classify(
            facts(has_train_args=True, has_epoch=True, has_metrics=True, nc=4, names_count=4, map50=0.85),
            0.5,
        )
        self.assertEqual(health, HEALTH_OK)
        self.assertEqual(reasons, [])

    def test_map50_threshold_is_configurable(self):
        # 把門檻拉高到 0.9：原本 0.85 的模型變成 LOW_QUALITY。
        health, _ = _classify(
            facts(has_train_args=True, has_epoch=True, has_metrics=True, nc=4, names_count=4, map50=0.85),
            0.9,
        )
        self.assertEqual(health, HEALTH_LOW_QUALITY)


class BlockingTests(unittest.TestCase):
    def test_blocking_states(self):
        self.assertTrue(is_blocking({"health": HEALTH_UNTRAINED}))
        self.assertTrue(is_blocking({"health": HEALTH_NC_MISMATCH}))
        self.assertFalse(is_blocking({"health": HEALTH_LOW_QUALITY}))
        self.assertFalse(is_blocking({"health": HEALTH_OK}))
        self.assertFalse(is_blocking({"health": HEALTH_UNKNOWN}))

    def test_blocking_error_codes(self):
        self.assertEqual(blocking_error_code({"health": HEALTH_UNTRAINED}), "model_untrained")
        self.assertEqual(blocking_error_code({"health": HEALTH_NC_MISMATCH}), "model_nc_mismatch")
        self.assertEqual(blocking_error_code({"health": HEALTH_OK}), "")


class ThresholdTests(unittest.TestCase):
    def test_default_threshold(self):
        self.assertEqual(map50_threshold(), DEFAULT_MAP50_THRESHOLD)
        self.assertEqual(DEFAULT_MAP50_THRESHOLD, 0.5)

    def test_explicit_overrides_env(self):
        self.assertEqual(map50_threshold(0.9), 0.9)

    def test_env_overrides_default(self):
        old = os.environ.get("FDE_MODEL_HEALTH_MAP50_THRESHOLD")
        os.environ["FDE_MODEL_HEALTH_MAP50_THRESHOLD"] = "0.7"
        try:
            self.assertEqual(map50_threshold(), 0.7)
        finally:
            if old is None:
                os.environ.pop("FDE_MODEL_HEALTH_MAP50_THRESHOLD", None)
            else:
                os.environ["FDE_MODEL_HEALTH_MAP50_THRESHOLD"] = old


class SummarizeTests(unittest.TestCase):
    def test_summarize_carries_health_and_labels(self):
        s = summarize(facts(health=HEALTH_OK, has_train_args=True, has_epoch=True, has_metrics=True, nc=4, names_count=4, map50=0.85))
        self.assertEqual(s["health"], HEALTH_OK)
        self.assertEqual(s["health_label"], "正常")
        self.assertEqual(s["health_css"], "active")
        self.assertIn("map50", s)

    def test_summarize_unknown_falls_back(self):
        s = summarize(facts(health=HEALTH_UNKNOWN))
        self.assertEqual(s["health_label"], "無法判定")


class DescribeTests(unittest.TestCase):
    def test_describe_untrained(self):
        text = describe_for_teacher(facts(health=HEALTH_UNTRAINED))
        self.assertIn("訓練痕跡", text)
        self.assertIn("空殼", text)

    def test_describe_nc_mismatch_includes_numbers(self):
        text = describe_for_teacher(facts(health=HEALTH_NC_MISMATCH, nc=80, names_count=4))
        self.assertIn("80", text)
        self.assertIn("4", text)

    def test_describe_low_quality_includes_map50(self):
        text = describe_for_teacher(facts(health=HEALTH_LOW_QUALITY, map50=0.12, map50_threshold=0.5))
        self.assertIn("0.12", text)

    def test_classify_keeps_unknown_for_failed_inspection(self):
        """迴歸（2026-10-21）：檢查失敗的 checkpoint 重新分類後必須仍為 UNKNOWN。

        快取命中时 _classify 會被再次呼叫；早期缺少守門時，第一次檢查得到
        UNKNOWN（inspection_failed），第二次卻因 has_train_args=False 被誤判
        為 UNTRAINED，導致同一檔案判定不一致、 activate 閘門行為不穩定。
        """
        failed = facts(
            health=HEALTH_UNKNOWN,
            reasons=["inspection_failed"],
            inspection_error="UnpicklingError: invalid load key",
        )
        health, reasons = _classify(failed, 0.5)
        self.assertEqual(health, HEALTH_UNKNOWN)
        self.assertEqual(reasons, ["inspection_failed"])

    def test_classify_keeps_unknown_without_explicit_error_key(self):
        """即使沒有 inspection_error 鍵，只要 reasons 帶 inspection_failed 就維持 UNKNOWN。"""
        failed = facts(health=HEALTH_UNKNOWN, reasons=["inspection_failed"])
        health, reasons = _classify(failed, 0.5)
        self.assertEqual(health, HEALTH_UNKNOWN)
        self.assertEqual(reasons, ["inspection_failed"])


if __name__ == "__main__":
    unittest.main()
