import json
import tempfile
import unittest
from pathlib import Path

from app.sessions import InMemorySessionStore


class SessionPersistenceTests(unittest.TestCase):
    """P1：VISION_MODEL_NOT_READY 等每步训练状态重载/重启后仍保留。"""

    def _record_vision_not_ready(self, store, session_id):
        store.start_training_task(session_id, "TASK_08")
        store.training_progress(session_id).task("TASK_08").current_training_step_id = "T08_PROP_VISION"
        store.record_training_step_fact(
            session_id, "T08_PROP_VISION", "VISION_MODEL_NOT_READY", student_note="no active model"
        )

    def test_vision_model_not_ready_survives_persist_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sessions.json"
            store = InMemorySessionStore(persistence_path=path)
            session = store.create(vision_source="REAL_VISION", training_track="F450_TWELVE_TASK")
            session_id = session.session_id
            self._record_vision_not_ready(store, session_id)

            # On-disk snapshot already carries the unavailable status.
            self.assertTrue(path.exists())
            data = json.loads(path.read_text(encoding="utf-8"))
            on_disk = data["training"][session_id]["tasks"]["TASK_08"]["training_step_progress"]["T08_PROP_VISION"]
            self.assertEqual(on_disk["check_status"], "VISION_MODEL_NOT_READY")

            # Simulate a backend restart: a fresh store loads from the same file.
            reloaded = InMemorySessionStore(persistence_path=path)
            self.assertIn(session_id, reloaded._sessions)
            step_state = reloaded.training_progress(session_id).task("TASK_08").training_step_progress["T08_PROP_VISION"]
            self.assertEqual(step_state["check_status"], "VISION_MODEL_NOT_READY")
            self.assertEqual(step_state["student_note"], "no active model")
            # Requirement: unavailable must never be silently turned into a pass.
            self.assertNotEqual(step_state["check_status"], "PASS")

    def test_persistence_disabled_by_default(self):
        store = InMemorySessionStore()
        self.assertIsNone(store._persistence_path)
        session = store.create(vision_source="REAL_VISION", training_track="F450_TWELVE_TASK")
        self.assertIsNotNone(session.session_id)

    def test_delete_removes_session_from_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sessions.json"
            store = InMemorySessionStore(persistence_path=path)
            session = store.create(vision_source="REAL_VISION", training_track="F450_TWELVE_TASK")
            self.assertTrue(store.delete(session.session_id))
            reloaded = InMemorySessionStore(persistence_path=path)
            self.assertNotIn(session.session_id, reloaded._sessions)

    def test_corrupt_file_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sessions.json"
            path.write_text("{ not valid json", encoding="utf-8")
            # A corrupt snapshot must not crash startup; store simply starts empty.
            reloaded = InMemorySessionStore(persistence_path=path)
            self.assertEqual(reloaded._sessions, {})


if __name__ == "__main__":
    unittest.main()
