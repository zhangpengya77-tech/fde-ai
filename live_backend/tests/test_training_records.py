import unittest

from app.task_catalog import load_f450_course
from app.task_state import TrainingProgress
from app.training_records import (
    EvidenceRecord,
    EvidenceType,
    ExternalCapabilityLink,
    PendingSyncGrowthRecordAdapter,
    ReflectionSource,
    StudentReflection,
)


class TrainingRecordContractTests(unittest.TestCase):
    def test_evidence_contract_supports_all_required_types_and_fields(self):
        required = {"PHOTO", "VIDEO", "SCREENSHOT", "CHECKLIST", "VISION_RESULT", "TEACHER_REVIEW", "MP_RESULT", "QGC_RESULT", "FLIGHT_LOG_REFERENCE", "FLIGHT_HEALTH_REFERENCE", "STUDENT_REFLECTION", "YOLO_MODEL"}
        self.assertEqual({item.value for item in EvidenceType}, required)
        evidence = EvidenceRecord.create(
            student_id="student-1", session_id="session-1", course_id="F450_AI_TRAINING",
            task_id="TASK_01", step_id="COMPONENT_CHECK", evidence_type=EvidenceType.PHOTO,
            source="LIVE_COACH", file_reference="dev://photo/1", vision_result={"class": "motor"},
            check_result="PENDING_TEACHER_REVIEW", teacher_review=None,
            error_codes=("ERR_COMPONENT_MISSING",), safety_reminders_acknowledged=(), metadata={"dev": True},
        )
        self.assertTrue(evidence.evidence_id)
        self.assertTrue(evidence.created_at.endswith("Z"))
        self.assertEqual(evidence.task_id, "TASK_01")

    def test_reflection_preserves_original_and_ai_assisted_text(self):
        reflection = StudentReflection.create(
            student_id="student-1", task_id="TASK_03",
            original_text="我安装了机臂，发现一颗螺丝太长，换成正确长度后完成。",
            ai_assisted_text="学生完成机臂安装，并识别及修正过长螺丝风险。",
            source_type=ReflectionSource.TEXT,
        )
        self.assertNotEqual(reflection.original_text, reflection.ai_assisted_text)
        self.assertEqual(reflection.source_type, ReflectionSource.TEXT)

    def test_reflection_rejects_ai_only_fabricated_record(self):
        with self.assertRaisesRegex(ValueError, "student_original_summary_required"):
            StudentReflection.create("student-1", "TASK_03", "", "AI wrote this", ReflectionSource.VOICE_TRANSCRIPT)

    def test_growth_adapter_maps_twelve_tasks_to_single_growth_record_05(self):
        progress = TrainingProgress("session-1", "student-1", load_f450_course())
        payload = PendingSyncGrowthRecordAdapter().build(progress, evidence=(), reflections=())
        self.assertEqual(payload.growth_record_id, "05")
        self.assertEqual(payload.title, "F450 组装")
        self.assertEqual(len(payload.task_detail), 12)
        self.assertEqual(payload.progress_label, "0 / 12")
        self.assertEqual(payload.sync_status, "PENDING_SYNC")
        self.assertNotIn("growth_records", payload.__dict__)

    def test_growth_adapter_reports_evidence_teacher_checks_and_reflection(self):
        progress = TrainingProgress("session-1", "student-1", load_f450_course())
        progress.start_task("TASK_01")
        progress.request_completion("TASK_01", actor="student")
        evidence = (EvidenceRecord.create("student-1", "session-1", "F450_AI_TRAINING", "TASK_01", "COMPONENT_CHECK", EvidenceType.PHOTO, "LIVE_COACH", "dev://photo/1"),)
        reflection = (StudentReflection.create("student-1", "TASK_01", "我完成零件检查。", None, ReflectionSource.TEXT),)
        payload = PendingSyncGrowthRecordAdapter().build(progress, evidence, reflection)
        self.assertEqual(payload.progress_label, "1 / 12")
        self.assertEqual(payload.evidence_count, 1)
        self.assertEqual(payload.student_reflection, "available")
        self.assertEqual(payload.final_status, "IN_PROGRESS")

    def test_task12_flight_health_is_external_reference_only(self):
        link = ExternalCapabilityLink.existing_flight_health()
        self.assertEqual(link.capability_id, "EXISTING_FLIGHT_HEALTH")
        self.assertEqual(link.integration_entry, "/flight-health/")
        self.assertEqual(link.invocation_mode, "EXTERNAL_ROUTE")
        self.assertIsNone(link.result_reference)


if __name__ == "__main__":
    unittest.main()
