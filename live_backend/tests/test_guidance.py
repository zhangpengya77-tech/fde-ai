import unittest

from app.guidance import CoachMessage, DeterministicGuidanceProvider, GuidanceProvider, RAGGuidanceProvider
from app.sop import SopDecision


class GuidanceTests(unittest.TestCase):
    def setUp(self):
        self.provider = DeterministicGuidanceProvider()
        self.session = {"expected_class": "motor"}

    def decision(self, status, detected=None):
        return SopDecision(status, status.lower(), ("motor",), detected, 0.8 if detected else None, 1, 3, None)

    def test_deterministic_messages(self):
        cases = {
            "NO_DETECTION": "目前没有识别到目标零件，请把零件完整放入画面。",
            "UNCERTAIN": "目前辨识信心不足，请将零件靠近镜头并保持稳定。",
            "NG": "目前步骤需要 motor，但辨识到 frame_arm，请更换正确零件。",
            "PASS_CANDIDATE": "已识别到当前步骤需要的零件，请确认后继续。",
            "STEP_COMPLETED": "步骤完成，进入下一步。",
            "TASK_COMPLETED": "零件辨识与准备任务已完成。",
            "TEACHER_CHECK": "此步骤属于安全节点，需要教师确认。",
        }
        for status, expected in cases.items():
            with self.subTest(status=status):
                message = self.provider.get_guidance(self.session, self.decision(status, "frame_arm" if status == "NG" else "motor"), None)
                self.assertIsInstance(message, CoachMessage)
                self.assertEqual(message.text, expected)

    def test_rag_is_interface_only(self):
        self.assertTrue(issubclass(RAGGuidanceProvider, GuidanceProvider))
        with self.assertRaises(NotImplementedError):
            RAGGuidanceProvider().get_guidance(self.session, self.decision("NG", "frame_arm"), None)


if __name__ == "__main__":
    unittest.main()
