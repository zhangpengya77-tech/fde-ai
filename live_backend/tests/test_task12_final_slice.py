import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.sessions import InMemorySessionStore
from app.task_catalog import CompletionMode, TaskStatus, load_f450_course
from app.task_state import TaskTransitionError, TrainingProgress
from app.training_records import ExternalCapabilityLink


class StubVisionCenter:
    def active_model(self, model_type):
        return None


TASK12_STEPS = [
    "FINAL_ACCEPTANCE", "OPEN_EXISTING_FLIGHT_HEALTH", "STUDENT_REFLECTION",
    "TEACHER_FINAL_REVIEW", "GROWTH_RECORD_PENDING_SYNC",
]
TASK11_STEPS = ["SITE_SAFETY", "FINAL_CHECK", "TEACHER_CONTROLLED_FLIGHT", "POST_FLIGHT_CHECK"]


def _complete_preflight(progress):
    # TASK_12 prerequisite chain: TASK_01..TASK_10 must be COMPLETED.
    # (TASK_01-10 are frozen/individually verified by their own Takeover Checks;
    #  here they are pre-set COMPLETED so the final Main-12 aggregation is real.)
    for order in range(1, 11):
        progress.task(f"TASK_{order:02d}").status = TaskStatus.COMPLETED


class Task12FinalSliceTests(unittest.TestCase):
    def setUp(self):
        self.progress = TrainingProgress("t12-session", "student", load_f450_course())
        _complete_preflight(self.progress)
        self.progress.start_task("TASK_11")

    def test_task12_catalog_contract(self):
        definition = next(t for t in self.progress.course.tasks if t.id == "TASK_12")
        self.assertEqual([s.step_id for s in definition.steps], TASK12_STEPS)
        self.assertEqual(definition.prerequisites, ("TASK_11",))
        # Teacher / Safety gate preserved; completion via existing external module.
        self.assertTrue(definition.teacher_review_required)
        self.assertTrue(definition.safety_gate)
        self.assertEqual(definition.completion_mode, CompletionMode.EXISTING_MODULE_INTEGRATION)
        self.assertEqual(definition.integration_entry, "EXISTING_FLIGHT_HEALTH")
        self.assertEqual(
            definition.evidence_requirements,
            ("FLIGHT_HEALTH_REFERENCE", "STUDENT_REFLECTION", "TEACHER_REVIEW"),
        )
        # Last task of Main-12: no TASK_13 must exist.
        self.assertIsNone(definition.next_task)
        self.assertEqual(len(self.progress.course.tasks), 12)

    def test_flight_health_integration_is_external_reference_only(self):
        # Flight Health is referenced, NOT re-implemented / re-parsed / re-reported.
        link = ExternalCapabilityLink.existing_flight_health()
        self.assertEqual(link.capability_id, "EXISTING_FLIGHT_HEALTH")
        self.assertEqual(link.integration_entry, "/flight-health/")
        self.assertEqual(link.invocation_mode, "EXTERNAL_ROUTE")

    def test_flight_log_contract_requires_task11_flight_log_before_task12(self):
        # The Flight Log Contract: TASK_12 cannot complete unless TASK_11 carries a
        # FLIGHT_LOG_REFERENCE. A dev reference string is accepted (NOT a real BIN/TLOG parse).
        for sid in TASK11_STEPS:
            self.progress.record_step_fact("TASK_11", sid, "PASS")
        self.progress.request_completion("TASK_11", actor="student")
        self.assertEqual(self.progress.task("TASK_11").status, TaskStatus.PENDING_TEACHER_REVIEW)
        self.progress.record_teacher_review("TASK_11", "APPROVE", "MOCK_TEACHER", "flight supervised")
        self.progress.start_task("TASK_12")
        for sid in TASK12_STEPS:
            self.progress.record_step_fact("TASK_12", sid, "PASS")
        # Gate holds: TASK_11 has no FLIGHT_LOG_REFERENCE yet.
        with self.assertRaisesRegex(TaskTransitionError, "flight_evidence_required"):
            self.progress.request_completion("TASK_12", actor="student")
        # Flight log reference recorded on TASK_11 -> gate releases.
        self.progress.record_evidence("TASK_11", "FLIGHT_LOG_REFERENCE", "dev://flight.tlog")
        self.progress.request_completion("TASK_12", actor="student")
        self.assertEqual(self.progress.task("TASK_12").status, TaskStatus.PENDING_TEACHER_REVIEW)
        # MOCK_TEACHER used only for automated gate check; not a real flight/teacher pass.
        self.progress.record_teacher_review("TASK_12", "APPROVE", "MOCK_TEACHER", "final acceptance")
        self.assertEqual(self.progress.task("TASK_12").status, TaskStatus.COMPLETED)
        self.assertEqual(self.progress.completed_count, 12)
        self.assertEqual(self.progress.summary, "12 / 12")

    def test_http_flight_log_contract_blocks_task12_without_flight_log(self):
        # API-boundary negative test of the Flight Log Contract.
        store = InMemorySessionStore()
        app = create_app(session_store=store, vision_center=StubVisionCenter(), dev_mode=True)
        client = TestClient(app)
        r = client.post("/api/live/sessions", json={"mode": "demo", "training_track": "F450_TWELVE_TASK"})
        sid = r.json()["session_id"]
        prog = store.training_progress(sid)
        _complete_preflight(prog)
        # TASK_11 completed WITHOUT a flight log reference.
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_11/start")
        self.assertEqual(r.status_code, 200)
        for sid_step in TASK11_STEPS:
            r = client.post(f"/api/live/sessions/{sid}/training/steps/{sid_step}/facts", json={"fact": "PASS"})
            self.assertEqual(r.status_code, 200, (sid_step, r.text))
        r = client.post(f"/api/live/sessions/{sid}/training/evidence",
                        json={"task_id": "TASK_11", "evidence_type": "VIDEO", "file_reference": "dev://flight.mp4"})
        self.assertEqual(r.status_code, 201)
        r = client.post(f"/api/live/sessions/{sid}/training/reflection",
                        json={"task_id": "TASK_11", "original_text": "學生在教師監控下完成戶外基礎真機測試。", "ai_assisted_text": None, "source_type": "TEXT"})
        self.assertEqual(r.status_code, 201)
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_11/complete", json={})
        self.assertEqual(r.status_code, 200)
        r = client.post(f"/api/live/sessions/{sid}/training/teacher-review",
                        json={"task_id": "TASK_11", "decision": "APPROVE", "note": "教師現場監控飛行完成。"},
                        headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "MOCK_TEACHER"})
        self.assertEqual(r.status_code, 200)
        # TASK_12: walk all 5 steps, then attempt completion without flight log -> blocked.
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_12/start")
        self.assertEqual(r.status_code, 200)
        for sid_step in TASK12_STEPS:
            r = client.post(f"/api/live/sessions/{sid}/training/steps/{sid_step}/facts", json={"fact": "PASS"})
            self.assertEqual(r.status_code, 200, (sid_step, r.text))
        r = client.post(f"/api/live/sessions/{sid}/training/evidence",
                        json={"task_id": "TASK_12", "evidence_type": "FLIGHT_HEALTH_REFERENCE", "file_reference": "dev://flight-health.json"})
        self.assertEqual(r.status_code, 201)
        r = client.post(f"/api/live/sessions/{sid}/training/reflection",
                        json={"task_id": "TASK_12", "original_text": "學生完成最終驗收與 Flight Health 引用。", "ai_assisted_text": None, "source_type": "TEXT"})
        self.assertEqual(r.status_code, 201)
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_12/complete", json={})
        self.assertEqual(r.status_code, 409, r.text)
        self.assertIn("flight_evidence_required", r.text)

    def test_http_vertical_slice_main12_complete(self):
        store = InMemorySessionStore()
        app = create_app(session_store=store, vision_center=StubVisionCenter(), dev_mode=True)
        client = TestClient(app)
        r = client.post("/api/live/sessions", json={"mode": "demo", "training_track": "F450_TWELVE_TASK"})
        self.assertEqual(r.status_code, 201, r.text)
        sid = r.json()["session_id"]
        prog = store.training_progress(sid)
        _complete_preflight(prog)

        # ---- TASK_11 full flow (immediate prerequisite) ----
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_11/start")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["safety_state"], "TEACHER_GATE")
        for sid_step in TASK11_STEPS:
            r = client.post(f"/api/live/sessions/{sid}/training/steps/{sid_step}/facts", json={"fact": "PASS"})
            self.assertEqual(r.status_code, 200, (sid_step, r.text))
        r = client.post(f"/api/live/sessions/{sid}/training/evidence",
                        json={"task_id": "TASK_11", "evidence_type": "VIDEO", "file_reference": "dev://flight.mp4"})
        self.assertEqual(r.status_code, 201, r.text)
        r = client.post(f"/api/live/sessions/{sid}/training/reflection",
                        json={"task_id": "TASK_11", "original_text": "學生在教師監控下完成戶外基礎真機測試。", "ai_assisted_text": None, "source_type": "TEXT"})
        self.assertEqual(r.status_code, 201, r.text)
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_11/complete", json={})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["task_state"], "PENDING_TEACHER_REVIEW")
        r = client.post(f"/api/live/sessions/{sid}/training/teacher-review",
                        json={"task_id": "TASK_11", "decision": "APPROVE", "note": "教師現場監控飛行完成。"},
                        headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "MOCK_TEACHER"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["task_state"], "COMPLETED")

        # Flight Log Contract: record FLIGHT_LOG_REFERENCE on TASK_11 (dev reference only).
        r = client.post(f"/api/live/sessions/{sid}/training/evidence",
                        json={"task_id": "TASK_11", "evidence_type": "FLIGHT_LOG_REFERENCE", "file_reference": "dev://flight.tlog"})
        self.assertEqual(r.status_code, 201, r.text)

        # ---- TASK_12 ready ----
        r = client.get(f"/api/live/sessions/{sid}/training/tasks/TASK_12")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training_task_view"]["missing_prerequisites"], [])

        # ---- TASK_12 full flow ----
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_12/start")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["safety_state"], "TEACHER_GATE")
        r = client.get(f"/api/live/sessions/{sid}/training/tasks/TASK_12")
        view = r.json()["training_task_view"]
        self.assertEqual([s["step_id"] for s in view["task"]["steps"]], TASK12_STEPS)
        self.assertEqual(view["task"]["teacher_review_required"], True)
        for sid_step in TASK12_STEPS:
            r = client.post(f"/api/live/sessions/{sid}/training/steps/{sid_step}/facts", json={"fact": "PASS"})
            self.assertEqual(r.status_code, 200, (sid_step, r.text))
        # completion blocked: evidence then reflection
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_12/complete", json={})
        self.assertEqual(r.status_code, 409, r.text)
        self.assertIn("evidence_required", r.text)
        r = client.post(f"/api/live/sessions/{sid}/training/evidence",
                        json={"task_id": "TASK_12", "evidence_type": "FLIGHT_HEALTH_REFERENCE", "file_reference": "dev://flight-health.json"})
        self.assertEqual(r.status_code, 201, r.text)
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_12/complete", json={})
        self.assertEqual(r.status_code, 409, r.text)
        self.assertIn("reflection_required", r.text)
        r = client.post(f"/api/live/sessions/{sid}/training/reflection",
                        json={"task_id": "TASK_12", "original_text": "學生完成最終驗收與 Flight Health 引用。", "ai_assisted_text": None, "source_type": "TEXT"})
        self.assertEqual(r.status_code, 201, r.text)
        r = client.post(f"/api/live/sessions/{sid}/training/tasks/TASK_12/complete", json={})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["task_state"], "PENDING_TEACHER_REVIEW")
        # MOCK_TEACHER releases the gate (automated test only; NOT a real teacher/flight pass).
        r = client.post(f"/api/live/sessions/{sid}/training/teacher-review",
                        json={"task_id": "TASK_12", "decision": "APPROVE", "note": "教師終審通過。"},
                        headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "MOCK_TEACHER"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["task_state"], "COMPLETED")

        # ---- Main-12 complete: growth record 12/12, no current task, no TASK_13 ----
        r = client.get(f"/api/live/sessions/{sid}/training/growth-record")
        self.assertEqual(r.status_code, 200, r.text)
        gr = r.json()
        self.assertEqual(gr["progress_label"], "12 / 12")
        self.assertEqual(gr["final_status"], "COMPLETED")
        self.assertIsNone(gr["current_task"])
        self.assertTrue(all(d["status"] == "COMPLETED" for d in gr["task_detail"]), gr["task_detail"])


if __name__ == "__main__":
    unittest.main()
