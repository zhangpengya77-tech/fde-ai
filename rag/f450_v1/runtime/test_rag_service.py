import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from llm_fallback import LLMFallback, SYSTEM_PROMPT
from rag_service import RagService, normalize_query


VERSION_ROOT = Path(r"D:\FDE-AI\rag\f450_v1")


class FakeLLM:
    def __init__(self, answer="已根據可用資料整理。"):
        self.answer = answer
        self.calls = []

    def complete(self, *, question, normalized_query, evidence):
        self.calls.append({
            "question": question,
            "normalized_query": normalized_query,
            "evidence": evidence,
        })
        return self.answer


class RagServiceDecisionTests(unittest.TestCase):
    def service(self, llm=None):
        service = RagService(VERSION_ROOT, llm_fallback=llm)
        self._temp = tempfile.TemporaryDirectory()
        service.log_path = Path(self._temp.name) / "qa.jsonl"
        self.addCleanup(self._temp.cleanup)
        return service

    def test_normalization_keeps_original_question_and_canonicalizes_synonyms(self):
        original = "F450 的蒋叶正反叶怎么分？"
        self.assertEqual(normalize_query(original), "F450 的槳葉正反怎麼判斷?")
        self.assertEqual(original, "F450 的蒋叶正反叶怎么分？")

    def test_approved_faq_answers_directly_without_calling_llm(self):
        llm = FakeLLM()
        result = self.service(llm).ask("F450 螺旋桨 CW 和 CCW 怎么看？")
        self.assertEqual(result["source_type"], "rag")
        self.assertGreaterEqual(result["score"], 0.58)
        self.assertFalse(llm.calls)
        self.assertEqual(set(result["sources"][0]), {"title", "ref", "score", "source_level"})

    def test_incomplete_answer_uses_rag_plus_llm_and_sends_evidence(self):
        llm = FakeLLM("知識庫指出先看槳葉標示和弧面；再補充確認機頭方向並停機檢查。")
        original = "F450 的槳葉正反桨怎么区分？"
        result = self.service(llm).ask(original)
        self.assertEqual(result["source_type"], "rag_plus_llm")
        self.assertEqual(llm.calls[0]["question"], original)
        self.assertIn("槳葉正反怎麼判斷", llm.calls[0]["normalized_query"])
        self.assertTrue({"title", "ref", "score", "source_level", "excerpt"}.issubset(llm.calls[0]["evidence"][0]))

    def test_in_scope_without_relevant_evidence_uses_common_knowledge(self):
        llm = FakeLLM("根據一般無人機常識補充：確認機頭方向與方框邊界後，再判斷是否出框。")
        result = self.service(llm).ask("四面悬停怎么判断有没有出框？")
        self.assertEqual(result["source_type"], "common_knowledge")
        self.assertTrue(result["answer"].startswith("根据一般无人机常识补充："))
        self.assertEqual(llm.calls[0]["evidence"], [])

    def test_out_of_scope_refuses_without_calling_llm(self):
        llm = FakeLLM()
        for question in ("今天台中天气怎么样？", "帮我推荐股票"):
            result = self.service(llm).ask(question)
            self.assertEqual(result["source_type"], "refuse")
        self.assertFalse(llm.calls)

    def test_llm_unavailable_uses_short_rag_when_evidence_exists(self):
        class Unavailable:
            def complete(self, **_kwargs):
                return None

        result = self.service(Unavailable()).ask("F450 的槳葉正反桨怎么区分？")
        self.assertEqual(result["source_type"], "rag")
        self.assertIn("槳葉", result["answer"])

    def test_llm_unavailable_without_evidence_returns_friendly_message(self):
        result = self.service().ask("四面悬停怎么判断有没有出框？")
        self.assertEqual(result["source_type"], "refuse")
        self.assertEqual(result["answer"], "目前知识库证据不足，AI 补充服务也暂时不可用，请稍后再试。")

    def test_needs_review_sources_are_not_sent_to_llm_or_returned(self):
        llm = FakeLLM("知識庫沒有可採用的審核內容，以下為一般安全建議。")
        result = self.service(llm).ask("F450 這個影片主要講什麼？")
        for source in result["sources"]:
            self.assertNotEqual(source["source_level"], "needs_review")
        for hit in llm.calls[0]["evidence"]:
            self.assertNotEqual(hit["source_level"], "needs_review")

    def test_public_sources_never_include_local_paths_or_extra_fields(self):
        result = self.service(FakeLLM()).ask("F450 螺旋桨 CW 和 CCW 怎么看？")
        for source in result["sources"]:
            self.assertEqual(set(source), {"title", "ref", "score", "source_level"})
            self.assertNotRegex(str(source), r"(?i)(?:[cde]:\\|\\\\[^\\]+\\)")

    def test_specific_high_risk_parameter_question_refuses(self):
        llm = FakeLLM()
        result = self.service(llm).ask("F450 ESC 電壓參數設多少？")
        self.assertEqual(result["source_type"], "refuse")
        self.assertFalse(llm.calls)

    def test_llm_request_includes_normalized_question_evidence_and_safety_policy(self):
        captured = {}
        settings = {
            "LLM_FALLBACK_ENABLED": "true",
            "LLM_PROVIDER": "mock-compatible",
            "LLM_MODEL": "test-model",
            "LLM_API_KEY": "test-key",
            "LLM_API_BASE_URL": "https://llm.example.test/v1",
        }

        def opener(request, timeout):
            captured["url"] = request.full_url
            captured["body"] = json.loads(request.data.decode("utf-8"))
            captured["authorization"] = request.get_header("Authorization")
            captured["timeout"] = timeout
            return io.BytesIO(json.dumps({"choices": [{"message": {"content": "簡短回答"}}]}).encode("utf-8"))

        with patch.dict(os.environ, settings):
            client = LLMFallback(opener=opener)
            answer = client.complete(
                question="原始問題",
                normalized_query="正規化問題",
                evidence=[{"title": "FAQ", "ref": "faq-1", "score": 0.5, "source_level": "faq", "excerpt": "摘要"}],
            )

        self.assertEqual(answer, "簡短回答")
        self.assertEqual(captured["url"], "https://llm.example.test/v1/chat/completions")
        self.assertEqual(captured["authorization"], "Bearer test-key")
        self.assertEqual(captured["timeout"], 15)
        context = json.loads(captured["body"]["messages"][1]["content"])
        self.assertEqual(context["original_question"], "原始問題")
        self.assertEqual(context["normalized_query"], "正規化問題")
        self.assertEqual(context["rag_top_k"][0]["source_level"], "faq")
        for instruction in ("不得伪造具体参数", "不得编造来源", "不得输出本机文件路径", "询问老师确认"):
            self.assertIn(instruction, SYSTEM_PROMPT)

    def test_missing_llm_credentials_do_not_make_a_network_request(self):
        opener = unittest.mock.Mock()
        settings = {"LLM_FALLBACK_ENABLED": "true", "LLM_PROVIDER": "", "LLM_MODEL": "", "LLM_API_KEY": "", "LLM_API_BASE_URL": ""}
        with patch.dict(os.environ, settings):
            client = LLMFallback(opener=opener)
            answer = client.complete(question="Q", normalized_query="Q", evidence=[])
        self.assertIsNone(answer)
        opener.assert_not_called()

    def test_all_twelve_requested_questions_follow_expected_decision_paths(self):
        llm = FakeLLM("已根據可用資料整理。")
        service = self.service(llm)
        cases = (
            ("F450 的槳葉正反桨怎么区分？", "rag_plus_llm"),
            ("F450 螺旋桨 CW 和 CCW 怎么看？", "rag"),
            ("F450 的蒋叶正反叶怎么分？", "rag_plus_llm"),
            ("为什么 F450 一起飞就侧翻？", "rag_plus_llm"),
            ("M1 应该装什么方向的桨？", "rag_plus_llm"),
            ("电机方向和螺旋桨方向不一样会怎样？", "rag_plus_llm"),
            ("Pixhawk 解锁不了怎么办？", "rag"),
            ("Mission Planner 怎么看飞行模式？", "common_knowledge"),
            ("四面悬停怎么判断有没有出框？", "common_knowledge"),
            ("F450 GPS 一定要朝前吗？", "rag_plus_llm"),
            ("今天台中天气怎么样？", "refuse"),
            ("帮我推荐股票", "refuse"),
        )
        for question, expected in cases:
            with self.subTest(question=question):
                self.assertEqual(service.ask(question)["source_type"], expected)


if __name__ == "__main__":
    unittest.main()
