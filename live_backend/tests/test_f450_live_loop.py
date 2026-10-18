import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.sessions import InMemorySessionStore


class OfflineVision:
    async def health(self): return False
    async def detect(self, *_args): raise AssertionError("vision must be explicitly triggered")


class F450LiveLoopTests(unittest.TestCase):
    def setUp(self):
        self.store = InMemorySessionStore()
        self.client = TestClient(create_app(vision_adapter=OfflineVision(), session_store=self.store, dev_mode=True))
        response = self.client.post("/api/live/sessions", json={"mode": "demo", "training_track": "F450_TWELVE_TASK"})
        self.assertEqual(response.status_code, 201)
        self.sid = response.json()["session_id"]

    def state(self):
        response = self.client.get(f"/api/live/sessions/{self.sid}")
        self.assertEqual(response.status_code, 200)
        return response.json()["training"]

    def test_session_exposes_backend_owned_training_context(self):
        state = self.state()
        self.assertEqual(state["training_track"], "F450_TWELVE_TASK")
        self.assertEqual(state["hardware_profile"], "F450_PIXHAWK248")
        self.assertEqual(state["current_task_id"], "TASK_01")
        self.assertEqual(state["progress"], "0 / 12")
        self.assertEqual(len(state["tasks"]), 12)
        self.assertTrue(state["tasks"][6]["viewable"])
        self.assertTrue(state["tasks"][6]["actionable"])
        self.assertIn("expected_action", state["context"])
        self.assertIn("safety_reminders", state["context"])

    def test_task01_to_teacher_approved_task02_unlocks_task03(self):
        start = self.client.post(f"/api/live/sessions/{self.sid}/training/tasks/TASK_01/start", json={})
        self.assertEqual(start.status_code, 200)
        evidence = self.client.post(f"/api/live/sessions/{self.sid}/training/evidence", json={
            "task_id": "TASK_01", "step_id": "COMPONENT_CHECK", "evidence_type": "PHOTO",
            "source": "DEV_UPLOAD", "file_reference": "dev://evidence/task01.jpg",
        })
        self.assertEqual(evidence.status_code, 201)
        reflection = self.client.post(f"/api/live/sessions/{self.sid}/training/reflection", json={
            "task_id": "TASK_01", "original_text": "我检查了所有主要零件，并发现需要重新确认接收机型号。",
            "ai_assisted_text": "学生完成主要零件检查，并记录待确认的接收机型号。", "source_type": "TEXT",
        })
        self.assertEqual(reflection.status_code, 201)
        self.store.training_progress(self.sid).task("TASK_01").current_training_step_id = None
        complete1 = self.client.post(f"/api/live/sessions/{self.sid}/training/tasks/TASK_01/complete", json={})
        self.assertEqual(complete1.status_code, 200)
        self.assertEqual(complete1.json()["training"]["progress"], "1 / 12")

        self.assertEqual(self.client.post(f"/api/live/sessions/{self.sid}/training/tasks/TASK_02/start", json={}).status_code, 200)
        self.store.training_progress(self.sid).task("TASK_02").current_training_step_id = None
        self.client.post(f"/api/live/sessions/{self.sid}/training/evidence", json={"task_id": "TASK_02", "evidence_type": "CHECKLIST", "source": "DEV_STORAGE", "file_reference": "dev://task02"})
        self.client.post(f"/api/live/sessions/{self.sid}/training/reflection", json={"task_id": "TASK_02", "original_text": "软件流程测试。", "source_type": "TEXT"})
        pending = self.client.post(f"/api/live/sessions/{self.sid}/training/tasks/TASK_02/complete", json={})
        self.assertEqual(pending.json()["training"]["task_state"], "PENDING_TEACHER_REVIEW")
        out_of_order = self.client.post(f"/api/live/sessions/{self.sid}/training/tasks/TASK_03/start", json={})
        self.assertEqual(out_of_order.status_code, 200)
        self.assertEqual(out_of_order.json()["training"]["task_state"], "IN_PROGRESS")

        denied = self.client.post(f"/api/live/sessions/{self.sid}/training/teacher-review", json={"task_id": "TASK_02", "decision": "APPROVE", "note": "self approve"})
        self.assertEqual(denied.status_code, 403)
        approved = self.client.post(
            f"/api/live/sessions/{self.sid}/training/teacher-review",
            headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "MOCK_TEACHER"},
            json={"task_id": "TASK_02", "decision": "APPROVE", "note": "Dev bench-test review"},
        )
        self.assertEqual(approved.status_code, 200)
        self.assertTrue(approved.json()["review"]["development_identity"])
        self.assertEqual(approved.json()["training"]["progress"], "2 / 12")
        self.assertEqual(self.client.post(f"/api/live/sessions/{self.sid}/training/tasks/TASK_03/start", json={}).status_code, 200)

    def test_teacher_reject_returns_need_rework(self):
        progress = self.store.training_progress(self.sid)
        progress.start_task("TASK_01")
        progress.request_completion("TASK_01", actor="student")
        progress.start_task("TASK_02")
        progress.request_completion("TASK_02", actor="student")
        response = self.client.post(
            f"/api/live/sessions/{self.sid}/training/teacher-review",
            headers={"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "MOCK_TEACHER"},
            json={"task_id": "TASK_02", "decision": "REJECT_REWORK", "note": "Repeat M2 test"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["training"]["task_state"], "NEED_REWORK")

    def test_reflection_requires_student_original_input(self):
        response = self.client.post(f"/api/live/sessions/{self.sid}/training/reflection", json={
            "task_id": "TASK_01", "original_text": "", "ai_assisted_text": "我完成了任务。", "source_type": "TEXT",
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "student_original_summary_required")

    def test_growth_record_05_is_exposed_as_pending_sync(self):
        growth = self.client.get(f"/api/live/sessions/{self.sid}/training/growth-record").json()
        self.assertEqual(growth["growth_record_id"], "05")
        self.assertEqual(growth["progress_label"], "0 / 12")
        self.assertEqual(growth["sync_status"], "PENDING_SYNC")

    def test_opening_not_started_task_auto_starts_and_initializes_step_context(self):
        response = self.client.get(f"/api/live/sessions/{self.sid}/training/tasks/TASK_03")
        self.assertEqual(response.status_code, 200)
        view = response.json()["training_task_view"]
        self.assertEqual(view["task_state"], "IN_PROGRESS")
        self.assertEqual(view["current_task_id"], "TASK_03")
        self.assertIsNotNone(view["current_training_step_id"])
        self.assertIsNotNone(view["current_step"])
        state = self.store.training_state(self.sid)
        self.assertEqual(state["task_state"], "IN_PROGRESS")
        self.assertEqual(state["current_task_id"], "TASK_03")
        self.assertEqual(state["context"]["main_task_id"], "TASK_03")
        self.assertEqual(state["context"]["task_title"], state["task"]["title"])
        self.assertEqual(state["context"]["current_training_step_id"], state["current_training_step_id"])
        self.assertEqual(state["context"]["current_step_title"], state["current_step"]["title"])
        self.assertEqual(state["context"]["current_step_instruction"], state["current_step"]["student_instruction"])
        self.assertIsNotNone(state["context"]["next_step"])
        self.assertEqual(state["context"]["hardware_profile"], state["hardware_profile"])
        self.assertEqual(state["context"]["safety_state"], state["safety_state"])
        self.assertTrue(state["current_step"]["student_instruction"])
    def test_future_task_open_is_viewable_actionable_and_becomes_current(self):
        response = self.client.get(f"/api/live/sessions/{self.sid}/training/tasks/TASK_07")
        self.assertEqual(response.status_code, 200)
        view = response.json()["training_task_view"]
        self.assertEqual(view["task"]["id"], "TASK_07")
        self.assertTrue(view["viewable"])
        self.assertTrue(view["actionable"])
        self.assertEqual(self.state()["current_task_id"], "TASK_07")
        self.assertEqual(self.state()["task_state"], "IN_PROGRESS")

    def test_classroom_validation_is_opt_in_and_builds_learning_report(self):
        disabled = self.client.get(f"/api/live/sessions/{self.sid}/classroom-validation")
        self.assertEqual(disabled.status_code, 200)
        self.assertFalse(disabled.json()["enabled"])

        enabled = self.client.post(
            f"/api/live/sessions/{self.sid}/classroom-validation",
            json={"enabled": True},
        )
        self.assertEqual(enabled.status_code, 200)
        self.assertTrue(enabled.json()["enabled"])

        for payload in (
            {"event_type": "TASK_ENTER", "task_id": "TASK_01", "step_id": "T01_WORKSPACE"},
            {"event_type": "AI_ASK", "task_id": "TASK_01", "step_id": "T01_WORKSPACE", "channel": "VOICE", "question": "下一步呢？", "duration_ms": 1200},
            {"event_type": "AI_ASK", "task_id": "TASK_01", "step_id": "T01_WORKSPACE", "channel": "VISION", "question": "這是什麼？", "duration_ms": 2100},
            {"event_type": "TEACHER_REVIEW", "task_id": "TASK_01", "step_id": "T01_WORKSPACE", "duration_ms": 500},
            {"event_type": "STUCK", "task_id": "TASK_01", "step_id": "T01_WORKSPACE", "duration_ms": 3000},
            {"event_type": "STEP_EXIT", "task_id": "TASK_01", "step_id": "T01_WORKSPACE", "duration_ms": 8000},
            {"event_type": "TEACHER_CORRECTION", "task_id": "TASK_01", "step_id": "T01_WORKSPACE", "question": "這是什麼？", "ai_answer": "疑似馬達。", "teacher_answer": "這是 ESC。"},
        ):
            response = self.client.post(f"/api/live/sessions/{self.sid}/classroom-validation/events", json=payload)
            self.assertEqual(response.status_code, 201)

        report = self.client.get(f"/api/live/sessions/{self.sid}/classroom-validation/report")
        self.assertEqual(report.status_code, 200)
        body = report.json()
        self.assertEqual(body["learning_report"]["ai_ask_count"], 2)
        self.assertEqual(body["learning_report"]["voice_count"], 1)
        self.assertEqual(body["learning_report"]["vision_count"], 1)
        self.assertEqual(body["learning_report"]["teacher_review_count"], 1)
        self.assertEqual(body["learning_report"]["stuck_time_ms"], 3000)
        self.assertEqual(body["learning_report"]["completion_rate"], 0)
        self.assertEqual(body["analytics"]["top_questions"][0]["question"], "下一步呢？")
        self.assertEqual(body["analytics"]["longest_steps"][0]["duration_ms"], 8000)
        self.assertEqual(body["analytics"]["teacher_help"][0]["step_id"], "T01_WORKSPACE")
        self.assertEqual(body["learning_report"]["growth_record_id"], "05")
        candidate = self.store.knowledge_candidates(self.sid)[0]
        self.assertEqual(candidate["llm_answer"], "疑似馬達。")
        self.assertEqual(candidate["teacher_correction"], "這是 ESC。")
        self.assertEqual(candidate["review_status"], "APPROVED")


if __name__ == "__main__":
    unittest.main()
