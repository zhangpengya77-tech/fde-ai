import unittest
from app.guidance import DeterministicGuidanceProvider
from app.orchestrator import CoachOrchestrator
from app.sessions import InMemorySessionStore
from app.sop import SopEngine

class OrchestratorTests(unittest.TestCase):
    def setUp(self):
        self.store = InMemorySessionStore()
        self.session = self.store.create()
        self.orchestrator = CoachOrchestrator(self.store, SopEngine(), DeterministicGuidanceProvider())

    def test_wrong_and_correct_detection_are_decided_by_sop(self):
        wrong = self.orchestrator.process(self.session.session_id, [{"class":"frame_arm","confidence":0.9,"box":[0,0,10,10]}], "f1", "REAL_VISION", {})
        self.assertEqual(wrong["sop"]["status"], "NG")
        correct = self.orchestrator.process(self.session.session_id, [{"class":"motor","confidence":0.9,"box":[0,0,10,10]}], "f2", "REAL_VISION", {})
        self.assertEqual(correct["sop"]["status"], "PASS_CANDIDATE")
        self.assertEqual(correct["session"]["state"], "PASS_CANDIDATE")

    def test_highest_confidence_detection_is_selected(self):
        result = self.orchestrator.process(self.session.session_id, [{"class":"motor","confidence":0.4,"box":[0,0,1,1]},{"class":"frame_arm","confidence":0.8,"box":[0,0,1,1]}], "f1", "REAL_VISION", {})
        self.assertEqual(result["detection"]["class"], "frame_arm")
