import unittest

from app.task_catalog import load_f450_course
from app.training_records import ExternalCapabilityLink


class PlatformIntegrationContractTests(unittest.TestCase):
    """Platform Integration Phase 1：MP-12 合約 + Flight Health 合約未被破壞。"""

    def test_mp12_contract_is_external_placeholder(self):
        link = ExternalCapabilityLink.existing_mp12()
        # MP-12 為外部既有能力，Main v2.0 只宣告 Contract / Placeholder。
        self.assertEqual(link.capability_id, "EXISTING_MP12")
        self.assertEqual(link.invocation_mode, "EXTERNAL_ADAPTER_PENDING")
        self.assertEqual(link.module_path, "mp12/")
        # 尚未提供對外路由：不得偽造已整合的入口。
        self.assertEqual(link.integration_entry, "")

    def test_mp12_contract_does_not_claim_route_or_reimplementation(self):
        link = ExternalCapabilityLink.existing_mp12("dev://mp12-reference")
        self.assertEqual(link.result_reference, "dev://mp12-reference")
        self.assertNotEqual(link.invocation_mode, "EXTERNAL_ROUTE")
        self.assertNotIn("copy", link.module_path)
        self.assertNotIn("merge", link.module_path)

    def test_flight_health_contract_is_preserved(self):
        link = ExternalCapabilityLink.existing_flight_health()
        self.assertEqual(link.capability_id, "EXISTING_FLIGHT_HEALTH")
        self.assertEqual(link.integration_entry, "/flight-health/")
        self.assertEqual(link.invocation_mode, "EXTERNAL_ROUTE")

    def test_task12_still_references_existing_flight_health(self):
        course = load_f450_course()
        task12 = next(task for task in course.tasks if task.id == "TASK_12")
        self.assertEqual(task12.integration_entry, "EXISTING_FLIGHT_HEALTH")
        self.assertIn("FLIGHT_HEALTH_REFERENCE", task12.evidence_requirements)

    def test_main12_catalog_is_untouched(self):
        # Main-12 FROZEN：12 任務、順序與最後任務無 next_task 皆未變動。
        course = load_f450_course()
        self.assertEqual(len(course.tasks), 12)
        self.assertEqual(tuple(t.id for t in course.tasks), tuple(f"TASK_{n:02d}" for n in range(1, 13)))
        self.assertIsNone(next(t for t in course.tasks if t.id == "TASK_12").next_task)


if __name__ == "__main__":
    unittest.main()
