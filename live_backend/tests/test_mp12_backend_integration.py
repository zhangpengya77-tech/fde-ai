"""MP-12 REAL INTEGRATION Phase 1（Backend）驗收測試。

範圍：只驗證「既有 MP-12 後端能力」已以 file-level adoption 接入 Main v2.0，
且 Main-12 契約（parent_task_id = TASK_07、MP 完成不自動完成 TASK_07、
12/12 口徑不變、TASK_08～12 與 Flight Health 不受影響）全部成立。

本輪不做前端整合；REAL Mission Planner / REAL Pixhawk = REAL DEVICE PENDING。
教師身分（MOCK_TEACHER）只用於自動化 Gate 檢查，不代表 REAL TEACHER PASS。
"""

import unittest

from starlette.testclient import TestClient

from app.main import create_app
from app.mp12_catalog import LEGACY_TASK07_STEP_MAP, load_mp12_catalog
from app.sessions import InMemorySessionStore
from app.task_catalog import TaskStatus, load_f450_course
from app.task_state import TaskTransitionError, TrainingProgress, UNSAFE_STEP_PREREQUISITES
from app.training_records import EvidenceRecord, ExternalCapabilityLink

MP12_IDS = [f"MP{index:02d}" for index in range(1, 13)]
# MP-12 Catalog 中 teacher_required=True 的子任務
TEACHER_MP = ("MP06", "MP08", "MP11", "MP12")


class StubVisionCenter:
    def active_model(self, model_type):
        return None


def _complete_all_mp(progress):
    """推進 MP01～MP12：教師子任務需經教師 APPROVE（自動化 Gate 檢查，非真實驗收）。"""
    for subtask_id in MP12_IDS:
        progress.select_mp_subtask(subtask_id)
        progress.complete_mp_subtask(subtask_id, actor="student")
        if subtask_id in TEACHER_MP:
            progress.review_mp_subtask(subtask_id, "APPROVE", "MOCK_TEACHER", note="automated gate check")


class Mp12BackendIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.progress = TrainingProgress("mp12-session", "student", load_f450_course())

    # 1. Main v2.0 可以 load MP-12 catalog
    def test_main_v2_can_load_mp12_catalog(self):
        catalog = load_mp12_catalog()
        self.assertEqual(len(catalog), 12)
        self.assertEqual([item.subtask_id for item in catalog], MP12_IDS)
        self.assertEqual([item.order for item in catalog], list(range(1, 13)))
        # Catalog 內容為既有 MP-12 教材，非本輪重寫
        self.assertEqual(catalog[0].title, "USB / COM 连接与 MP 识别")
        self.assertEqual(catalog[11].title, "整机参数总检 + 桨叶 YOLO 静态确认")
        self.assertEqual(catalog[11].vision_task, "propeller_orientation_assist")
        self.assertTrue(LEGACY_TASK07_STEP_MAP)

    # 2 + 3 + 4. TASK_07 session 可取得 mp12_state()；數量正確；parent_task_id == TASK_07
    def test_session_mp12_state_parent_and_count(self):
        state = self.progress.mp12_state()
        self.assertEqual(state["parent_task_id"], "TASK_07")
        self.assertEqual(state["total"], 12)
        self.assertEqual(state["completed_count"], 0)
        self.assertEqual(state["progress"], "0 / 12")
        self.assertFalse(state["completed"])
        self.assertEqual([item["subtask_id"] for item in state["items"]], MP12_IDS)

    def test_training_task_view_exposes_mission_planner_for_task07(self):
        store = InMemorySessionStore()
        app = create_app(session_store=store, vision_center=StubVisionCenter(), dev_mode=True)
        client = TestClient(app)
        r = client.post("/api/live/sessions", json={"mode": "demo", "training_track": "F450_TWELVE_TASK"})
        self.assertEqual(r.status_code, 201, r.text)
        sid = r.json()["session_id"]
        r = client.get(f"/api/live/sessions/{sid}/training/tasks/TASK_07")
        self.assertEqual(r.status_code, 200, r.text)
        view = r.json()["training_task_view"]
        self.assertIn("mission_planner", view)
        self.assertEqual(view["mission_planner"]["parent_task_id"], "TASK_07")
        self.assertEqual(view["mission_planner"]["total"], 12)

    # 5. MP subtask state 可推進
    def test_mp_subtask_state_progression(self):
        state = self.progress.select_mp_subtask("MP01")
        self.assertEqual(state["status"], "IN_PROGRESS")
        state = self.progress.complete_mp_subtask("MP01", actor="student")
        self.assertEqual(state["status"], "COMPLETED")  # MP01 teacher_required=False
        self.assertEqual(self.progress.mp12_state()["completed_count"], 1)
        self.assertEqual(self.progress.mp12_state()["progress"], "1 / 12")

    # 6. teacher gate 保留
    def test_teacher_gate_preserved(self):
        self.progress.complete_mp_subtask("MP06", actor="student")
        state = self.progress.mp12_state()["subtasks"]["MP06"]
        self.assertEqual(state["status"], "PENDING_TEACHER_REVIEW")
        # 非教師身分不得放行
        with self.assertRaisesRegex(TaskTransitionError, "teacher_authority_required"):
            self.progress.review_mp_subtask("MP06", "APPROVE", "someone", actor_role="student")
        # 教師 APPROVE 才完成
        self.progress.review_mp_subtask("MP06", "APPROVE", "MOCK_TEACHER", note="automated gate check")
        self.assertEqual(self.progress.mp12_state()["subtasks"]["MP06"]["status"], "COMPLETED")
        # MP12 前置閘：MP01～MP11 未完成不得完成 MP12
        with self.assertRaisesRegex(TaskTransitionError, "mp12_prerequisites_incomplete"):
            self.progress.complete_mp_subtask("MP12", actor="student")

    # 7. safety rules 保留（且 MP-12 未放寬 Main-12 的 unsafe step 安全鏈）
    def test_safety_gate_preserved(self):
        self.assertEqual(
            UNSAFE_STEP_PREREQUISITES[("TASK_07", "T07_FIRST_POWER_TEACHER")], ("TASK_06",)
        )
        self.assertEqual(
            UNSAFE_STEP_PREREQUISITES[("TASK_11", "TEACHER_CONTROLLED_FLIGHT")], ("TASK_10",)
        )
        # TASK_06 未完成 → T07_FIRST_POWER_TEACHER 仍被擋（MP-12 接入不得繞過）
        self.assertEqual(
            self.progress.unsafe_step_missing("TASK_07", "T07_FIRST_POWER_TEACHER"), ("TASK_06",)
        )
        # MP-12 Catalog 的安全規則未被本輪改動
        catalog = {item.subtask_id: item for item in load_mp12_catalog()}
        self.assertTrue(catalog["MP06"].safety_rules)
        self.assertTrue(catalog["MP11"].safety_rules)
        self.assertTrue(catalog["MP12"].safety_rules)

    # 8. mirror 可回寫 TASK_07
    def test_mirror_writes_back_to_task07_steps(self):
        legacy_steps = self.progress._legacy_steps_for_mp_subtask("MP01")
        self.assertTrue(legacy_steps)
        self.progress.complete_mp_subtask("MP01", actor="student")
        task07 = self.progress.task("TASK_07")
        for step_id in legacy_steps:
            self.assertEqual(task07.training_step_progress[step_id]["status"], "COMPLETED")
        # 教師決策同樣 mirror
        self.progress.complete_mp_subtask("MP06", actor="student")
        self.progress.review_mp_subtask("MP06", "APPROVE", "MOCK_TEACHER", note="automated gate check")
        for step_id in self.progress._legacy_steps_for_mp_subtask("MP06"):
            self.assertEqual(
                task07.training_step_progress[step_id]["teacher_decision"], "APPROVE"
            )

    # 9. MP evidence 進入 shared evidence
    def test_mp_evidence_enters_shared_evidence(self):
        store = InMemorySessionStore()
        app = create_app(session_store=store, vision_center=StubVisionCenter(), dev_mode=True)
        client = TestClient(app)
        r = client.post("/api/live/sessions", json={"mode": "demo", "training_track": "F450_TWELVE_TASK"})
        sid = r.json()["session_id"]
        before = store.training_state(sid)["evidence_count"]
        r = client.post(
            f"/api/live/sessions/{sid}/training/evidence",
            json={"task_id": "TASK_07", "step_id": "MP01", "evidence_type": "SCREENSHOT",
                  "file_reference": "dev://mp01-connect.png"},
        )
        self.assertEqual(r.status_code, 201, r.text)
        after = store.training_state(sid)["evidence_count"]
        self.assertEqual(after, before + 1)
        # MP 子任務自身也持有該證據
        mp_state = store.training_progress(sid).mp12_state()
        self.assertEqual(mp_state["subtasks"]["MP01"]["evidence"][0]["evidence_type"], "SCREENSHOT")
        self.assertEqual(mp_state["subtasks"]["MP01"]["evidence"][0]["reference"], "dev://mp01-connect.png")

    def test_wrong_mp_evidence_type_rejected(self):
        # MP03 只接受 MP_RESULT；SCREENSHOT 應被拒（複用既有 MP-12 驗證）
        with self.assertRaisesRegex(TaskTransitionError, "wrong_mp_evidence_type"):
            self.progress.record_mp_evidence("MP03", "SCREENSHOT", "dev://x.png")

    # 10. Growth Record 不改變 12/12 口徑 + MP 完成不自動完成 TASK_07
    def test_mp_completion_does_not_autocomplete_task07_and_keeps_12_of_12(self):
        _complete_all_mp(self.progress)
        mp_state = self.progress.mp12_state()
        self.assertTrue(mp_state["completed"])
        self.assertEqual(mp_state["progress"], "12 / 12")
        # Main-12 Contract：MP-12 完成「不得」自動完成 TASK_07
        self.assertNotEqual(self.progress.task("TASK_07").status, TaskStatus.COMPLETED)
        self.assertEqual(self.progress.task("TASK_07").status, TaskStatus.IN_PROGRESS)
        # Growth Record 分母仍是 12 個主任務，MP 進度不計入主任務數
        self.assertEqual(len(self.progress.course.tasks), 12)
        self.assertEqual(self.progress.completed_count, 0)
        self.assertEqual(self.progress.summary, "0 / 12")

    # 11. TASK_08～TASK_12 不受影響
    def test_task08_to_task12_unaffected(self):
        _complete_all_mp(self.progress)
        tasks = {item.id: item for item in self.progress.course.tasks}
        self.assertEqual(len(tasks), 12)
        self.assertEqual(tasks["TASK_12"].next_task, None)  # 無 TASK_13
        self.assertEqual(tasks["TASK_12"].integration_entry, "EXISTING_FLIGHT_HEALTH")
        self.assertTrue(tasks["TASK_08"].teacher_review_required)
        self.assertTrue(tasks["TASK_11"].teacher_review_required)
        # Flight Log Contract 仍然成立
        for order in range(1, 11):
            self.progress.task(f"TASK_{order:02d}").status = TaskStatus.COMPLETED
        self.progress.start_task("TASK_11")
        self.progress.request_completion("TASK_11", actor="student")
        self.progress.record_teacher_review("TASK_11", "APPROVE", "MOCK_TEACHER", "automated gate check")
        self.progress.start_task("TASK_12")
        with self.assertRaisesRegex(TaskTransitionError, "flight_evidence_required"):
            self.progress.request_completion("TASK_12", actor="student")

    # 12. Flight Health 不受影響
    def test_flight_health_contract_untouched(self):
        link = ExternalCapabilityLink.existing_flight_health()
        self.assertEqual(link.capability_id, "EXISTING_FLIGHT_HEALTH")
        self.assertEqual(link.integration_entry, "/flight-health/")
        self.assertEqual(link.invocation_mode, "EXTERNAL_ROUTE")
        # Phase 1 凍結的 MP-12 Contract 欄位值未被本輪改動
        mp12 = ExternalCapabilityLink.existing_mp12()
        self.assertEqual(mp12.capability_id, "EXISTING_MP12")
        self.assertEqual(mp12.invocation_mode, "EXTERNAL_ADAPTER_PENDING")


class Mp12HttpVerticalSliceTests(unittest.TestCase):
    """最小 HTTP 垂直切片：Main-12 → MP-12 子任務 → 教師 Gate → 回寫 TASK_07。"""

    def setUp(self):
        self.store = InMemorySessionStore()
        self.app = create_app(session_store=self.store, vision_center=StubVisionCenter(), dev_mode=True)
        self.client = TestClient(self.app)
        r = self.client.post("/api/live/sessions", json={"mode": "demo", "training_track": "F450_TWELVE_TASK"})
        self.assertEqual(r.status_code, 201, r.text)
        self.sid = r.json()["session_id"]
        self.teacher = {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "MOCK_TEACHER"}
        # TASK_07 前置（TASK_06 完成）以符合 Main-12 安全鏈
        prog = self.store.training_progress(self.sid)
        for order in range(1, 7):
            prog.task(f"TASK_{order:02d}").status = TaskStatus.COMPLETED

    def test_http_mp12_vertical_slice(self):
        base = f"/api/live/sessions/{self.sid}/training/mp12"

        # select MP01
        r = self.client.post(f"{base}/MP01/select")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["current_task_id"], "TASK_07")
        self.assertEqual(r.json()["training"]["task_state"], "IN_PROGRESS")
        self.assertEqual(r.json()["training"]["mission_planner"]["current_subtask_id"], "MP01")

        # complete MP01（不需教師）
        r = self.client.post(f"{base}/MP01/complete")
        self.assertEqual(r.status_code, 200, r.text)
        mp = r.json()["training"]["mission_planner"]
        self.assertEqual(mp["subtasks"]["MP01"]["status"], "COMPLETED")
        self.assertEqual(mp["progress"], "1 / 12")
        self.assertEqual(mp["parent_task_id"], "TASK_07")
        # mirror 回寫 TASK_07 步驟
        self.assertEqual(
            r.json()["training"]["training_step_progress"]["T07_PREPOWER_REVIEW"]["status"], "COMPLETED"
        )

        # MP06 需教師：先 complete → PENDING_TEACHER_REVIEW
        r = self.client.post(f"{base}/MP06/complete")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["mission_planner"]["subtasks"]["MP06"]["status"], "PENDING_TEACHER_REVIEW")

        # 無教師身分 → 403（Teacher Gate 保留）
        r = self.client.post(f"{base}/MP06/teacher-review", json={"decision": "APPROVE"})
        self.assertEqual(r.status_code, 403, r.text)
        self.assertIn("teacher_authority_required", r.text)

        # 教師放行 → COMPLETED
        r = self.client.post(f"{base}/MP06/teacher-review", json={"decision": "APPROVE", "note": "automated gate check"}, headers=self.teacher)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["training"]["mission_planner"]["subtasks"]["MP06"]["status"], "COMPLETED")
        self.assertEqual(r.json()["review"]["parent_task_id"], "TASK_07")

        # MP12 前置閘：MP01～MP11 未完成 → 409
        r = self.client.post(f"{base}/MP12/complete")
        self.assertEqual(r.status_code, 409, r.text)
        self.assertIn("mp12_prerequisites_incomplete", r.text)

        # 未知子任務 → 409
        r = self.client.post(f"{base}/MP99/select")
        self.assertEqual(r.status_code, 409, r.text)
        self.assertIn("unknown_mp_subtask", r.text)

    def test_http_mp_completion_does_not_complete_task07(self):
        base = f"/api/live/sessions/{self.sid}/training/mp12"
        prog = self.store.training_progress(self.sid)
        for subtask_id in MP12_IDS:
            self.client.post(f"{base}/{subtask_id}/select")
            r = self.client.post(f"{base}/{subtask_id}/complete")
            self.assertEqual(r.status_code, 200, (subtask_id, r.text))
            if subtask_id in TEACHER_MP:
                r = self.client.post(
                    f"{base}/{subtask_id}/teacher-review",
                    json={"decision": "APPROVE", "note": "automated gate check"},
                    headers=self.teacher,
                )
                self.assertEqual(r.status_code, 200, (subtask_id, r.text))
        mp = prog.mp12_state()
        self.assertTrue(mp["completed"])
        self.assertEqual(mp["progress"], "12 / 12")
        # Main-12 Contract：TASK_07 仍未被自動完成
        self.assertNotEqual(prog.task("TASK_07").status, TaskStatus.COMPLETED)
        # Growth Record 口徑仍是 12 個主任務
        r = self.client.get(f"/api/live/sessions/{self.sid}/training/growth-record")
        self.assertEqual(r.status_code, 200, r.text)
        gr = r.json()
        self.assertEqual(len(gr["task_detail"]), 12)
        self.assertNotEqual(gr["final_status"], "COMPLETED")


if __name__ == "__main__":
    unittest.main()
