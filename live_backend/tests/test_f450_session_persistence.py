import json
import tempfile
import unittest
from pathlib import Path

from app.sessions import InMemorySessionStore
from app.task_catalog import load_f450_course
from app.task_state import TrainingProgress


class TrainingProgressPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.progress = TrainingProgress("session-p", "student-p", load_f450_course())
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    @staticmethod
    def _record_not_ready(progress):
        progress.start_task("TASK_08")
        progress.task("TASK_08").current_training_step_id = "T08_PROP_VISION"
        progress.record_step_fact("TASK_08", "T08_PROP_VISION", "VISION_MODEL_NOT_READY", student_note="active model not ready")

    def test_training_progress_round_trips_vision_not_ready(self):
        self._record_not_ready(self.progress)
        data = self.progress.to_dict()
        self.assertIsInstance(data, dict)
        restored = TrainingProgress.from_dict(json.loads(json.dumps(data)))
        step = restored.task("TASK_08").training_step_progress["T08_PROP_VISION"]
        self.assertEqual(step["check_status"], "VISION_MODEL_NOT_READY")

    def _seed_prop_vision_not_ready(self, store, session_id):
        progress = store.training_progress(session_id)
        progress.start_task("TASK_08")
        progress.task("TASK_08").current_training_step_id = "T08_PROP_VISION"
        store._sessions[session_id].current_task_id = "TASK_08"
        store._sessions[session_id].current_training_step_id = "T08_PROP_VISION"
        store.record_training_step_fact(session_id, "T08_PROP_VISION", "VISION_MODEL_NOT_READY", student_note="x")

    def test_store_persists_training_state_across_restart(self):
        # 模拟「重载保留 unavailable」：写入磁盘后，新建 store（等同后端重启）应读回同一会话与状态。
        path = Path(self.tmp.name) / "sessions.json"
        store1 = InMemorySessionStore(persistence_path=path)
        session = store1.create(training_track="F450_TWELVE_TASK")
        self._seed_prop_vision_not_ready(store1, session.session_id)

        store2 = InMemorySessionStore(persistence_path=path)
        self.assertIn(session.session_id, store2._sessions)
        restored_step = (
            store2.training_progress(session.session_id)
            .task("TASK_08")
            .training_step_progress["T08_PROP_VISION"]
        )
        self.assertEqual(restored_step["check_status"], "VISION_MODEL_NOT_READY")

    def test_store_without_persistence_path_is_noop(self):
        # 默认关闭持久化，不应写入任何文件，且行为不变。
        store = InMemorySessionStore()
        session = store.create(training_track="F450_TWELVE_TASK")
        self._seed_prop_vision_not_ready(store, session.session_id)
        self.assertIsNone(store._persistence_path)


if __name__ == "__main__":
    unittest.main()
