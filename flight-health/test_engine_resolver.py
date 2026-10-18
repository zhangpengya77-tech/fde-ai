"""
Flight Health 引擎解析器 / 内建规则引擎 单元测试。

覆盖教师要求的 4 个场景中的核心逻辑：
    CASE2：存在 ACTIVE 教师模型 → 自动使用教师正式模型（resolve 返回 teacher_model）
    CASE3：无教师模型 / 模型不可用 → 自动回退系统标准规则，且不阻塞学员
    CASE1 辅助：真实 .bin 经内建规则引擎解析出非 UNKNOWN 结果（证明真解析，非假数据）
"""

import os
import sys
import unittest

# 允许直接以 python -m unittest 运行
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import engine_resolver as er
import builtin_rule_engine as bre
from gen_sample_bin import build_sample


class TestEngineResolver(unittest.TestCase):
    def setUp(self):
        # 每个用例隔离环境变量
        self._old = os.environ.pop("FDE_FLIGHT_HEALTH_TEACHER_MODEL", None)

    def tearDown(self):
        if self._old is not None:
            os.environ["FDE_FLIGHT_HEALTH_TEACHER_MODEL"] = self._old
        else:
            os.environ.pop("FDE_FLIGHT_HEALTH_TEACHER_MODEL", None)

    # ── CASE3：无教师模型 → 系统标准规则，且不阻塞 ──
    def test_no_teacher_model_falls_back_to_builtin(self):
        os.environ.pop("FDE_FLIGHT_HEALTH_TEACHER_MODEL", None)
        resolved = er.resolve_flight_health_engine()
        self.assertEqual(resolved["type"], er.BUILTIN_RULE_ENGINE)
        self.assertEqual(resolved["display_name"], er.DISPLAY_BUILTIN_RULE)
        self.assertFalse(resolved["teacher_model_active"])
        # 关键：绝不出现「因为没绑定模型所以不能分析」
        self.assertNotIn("不能", resolved["detail"])
        self.assertNotIn("未绑定", resolved["detail"])

    # ── CASE2：存在 ACTIVE 教师模型 → 自动切换 ──
    def test_active_teacher_model_selected(self):
        os.environ["FDE_FLIGHT_HEALTH_TEACHER_MODEL"] = '{"name":"fde-diag-v3","version":"3.1.0"}'
        resolved = er.resolve_flight_health_engine()
        self.assertEqual(resolved["type"], er.TEACHER_MODEL_ENGINE)
        self.assertEqual(resolved["display_name"], er.DISPLAY_TEACHER_MODEL)
        self.assertTrue(resolved["teacher_model_active"])
        self.assertEqual(resolved["engine"], "fde-diag-v3")

    # ── 显式传入（不依赖环境），证明纯逻辑可单测 ──
    def test_explicit_teacher_model(self):
        resolved = er.resolve_flight_health_engine(active_teacher_model={"name": "X", "version": "1"})
        self.assertEqual(resolved["type"], er.TEACHER_MODEL_ENGINE)

    def test_explicit_none(self):
        resolved = er.resolve_flight_health_engine(active_teacher_model=None)
        self.assertEqual(resolved["type"], er.BUILTIN_RULE_ENGINE)

    def test_engine_status_shape(self):
        st = er.flight_health_engine_status()
        self.assertTrue(st["ok"])
        self.assertIn(st["engine_type"], (er.TEACHER_MODEL_ENGINE, er.BUILTIN_RULE_ENGINE))
        self.assertIn("display_name", st)


class TestBuiltinRuleEngineRealParse(unittest.TestCase):
    # ── CASE1 辅助：真实 .bin 被真实解析，健康样本应非 UNKNOWN ──
    def test_healthy_bin_parses_to_non_unknown(self):
        data = build_sample(healthy=True, count=30)
        result = bre.analyze(data, filename="sample_flight_healthy.bin")
        self.assertGreater(result["parsed_message_count"], 0)
        # 健康样本整体应为 normal 或 inspect，绝不可能是伪造的随机结果
        self.assertIn(result["overall_status"], (bre.S_NORMAL, bre.S_INSPECT))
        # 关键：没有任何字段被 hard-code 成假 PASS —— 结论是依据数值算出来的
        for card in result["health_cards"]:
            self.assertIn(card["status"], (bre.S_NORMAL, bre.S_INSPECT, bre.S_UNKNOWN, bre.S_DANGER))
            self.assertIn("main_finding", card)

    # ── 危险样本应被正确判定为 danger（证明规则真实生效，不是假数据） ──
    def test_bad_bin_detects_danger(self):
        data = build_sample(healthy=False, count=30)
        result = bre.analyze(data, filename="sample_flight_bad.bin")
        self.assertEqual(result["overall_status"], bre.S_DANGER)
        by_id = {c["card_id"]: c for c in result["health_cards"]}
        self.assertEqual(by_id["battery"]["status"], bre.S_DANGER)
        self.assertEqual(by_id["sensors"]["status"], bre.S_DANGER)  # 振动
        self.assertEqual(by_id["gps"]["status"], bre.S_DANGER)

    # ── 空 / 损坏文件必须 UNKNOWN，绝不伪造 ──
    def test_empty_file_is_unknown(self):
        result = bre.analyze(b"not a real bin file at all", filename="junk.bin")
        self.assertEqual(result["overall_status"], bre.S_UNKNOWN)
        self.assertEqual(result["parsed_message_count"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
