import unittest
from app.mock_vision import MockVision

class MockVisionTests(unittest.TestCase):
    def test_supported_scenarios(self):
        mock = MockVision()
        self.assertEqual(mock.scenario("motor", "f1")[0]["class"], "motor")
        self.assertEqual(mock.scenario("frame_arm", "f2")[0]["class"], "frame_arm")
        self.assertEqual(mock.scenario("flight_controller", "f3")[0]["class"], "flight_controller")
        self.assertEqual(mock.scenario("no_detection", "f4"), [])
        self.assertLess(mock.scenario("low_confidence", "f5")[0]["confidence"], 0.6)
        self.assertNotEqual(mock.scenario("wrong_class", "f6")[0]["class"], "motor")
