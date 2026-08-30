from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from yolo_server import VoiceAssistant  # noqa: E402


class VoiceRagSearchTest(unittest.TestCase):
    def test_matches_ten_classroom_questions_against_e_drive_lessons(self):
        questions = [
            "F450 裝機前要先檢查什麼？",
            "CW 和 CCW 是什麼？",
            "槳葉裝反會怎樣？",
            "Pixhawk 怎麼接線？",
            "電池充電要注意什麼？",
            "Mission Planner 要先做哪些校正？",
            "飛機起飛會翻通常是什麼原因？",
            "通電前檢查清單有哪些？",
            "為什麼不能先裝槳測試？",
            "AI 檢測結果怎麼判斷？",
        ]
        assistant = VoiceAssistant(r"E:\FDE_AI_Voice_RAG\knowledge_base")

        answers = {question: assistant.ask(question) for question in questions}

        self.assertEqual(
            {question: answer["sourceStatus"] for question, answer in answers.items()},
            {question: "local-rag" for question in questions},
        )
        self.assertTrue(
            any(
                "CW_CCW" in source["title"] or "常見問題" in source["title"]
                for source in answers["槳葉裝反會怎樣？"]["sources"]
            )
        )
        self.assertTrue(
            any("電池" in source["title"] for source in answers["電池充電要注意什麼？"]["sources"])
        )
        self.assertTrue(
            any(
                "AI" in source["title"] or "CW_CCW" in source["title"]
                for source in answers["AI 檢測結果怎麼判斷？"]["sources"]
            )
        )


if __name__ == "__main__":
    unittest.main()
