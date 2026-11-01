"""PROP_ROTATION_V5 隔離教學試用契約測試。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sys
import subprocess
import os

from app.prop_rotation_v5 import (
    PROP_ROTATION_V5,
    PropRotationTrialError,
    PropRotationTrialRegistry,
)
from app.rotation_sandbox import RotationSandboxError, RotationSandboxRunner


MODEL_SHA256 = "911228ff2c1019701e3409c51b767e359871418f501941f00746434cfcd7352c"


class PropRotationV5TrialTests(unittest.TestCase):
    """雙類旋向模型不得影響既有四類 PROP_DIRECTION。"""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.registry = PropRotationTrialRegistry(Path(self.temp.name))

    def tearDown(self):
        self.temp.cleanup()

    def test_contract_is_separate_from_four_class_prop_direction(self):
        record = self.registry.register_verified_v5(
            model_path="C:/isolated/best.pt",
            model_sha256=MODEL_SHA256,
            class_names=["CW", "CCW"],
            source="F450_CW_CCW_V5_training",
        )

        self.assertEqual(record["task_id"], PROP_ROTATION_V5)
        self.assertEqual(record["class_names"], ["CW", "CCW"])
        self.assertEqual(record["status"], "PENDING_TEACHER_VALIDATION")
        self.assertNotEqual(record["task_id"], "PROP_DIRECTION")

    def test_teacher_confirmation_can_create_trial_but_not_active_without_golden_test(self):
        record = self.registry.register_verified_v5(
            model_path="C:/isolated/best.pt",
            model_sha256=MODEL_SHA256,
            class_names=["CW", "CCW"],
            source="F450_CW_CCW_V5_training",
        )
        self.registry.record_validation(
            model_id=record["model_id"], image_sha256="a" * 64,
            detections=[{"class": "CW", "confidence": 0.91, "bbox": [1, 2, 3, 4]}],
            teacher_id="teacher:7", expected_class="CW", teacher_decision="CORRECT",
        )

        trial = self.registry.enable_teaching_trial(record["model_id"], "teacher:7")

        self.assertEqual(trial["status"], "TEACHING_TRIAL")
        with self.assertRaisesRegex(PropRotationTrialError, "independent_golden_test_required"):
            self.registry.activate_isolated(record["model_id"], "teacher:7")

    def test_stale_process_registration_does_not_overwrite_teacher_trial(self):
        """Gateway 的舊快照不得覆寫另一程序剛完成的教師試用狀態。"""
        stale = PropRotationTrialRegistry(Path(self.temp.name))
        record = self.registry.register_verified_v5(
            model_path="C:/isolated/best.pt", model_sha256=MODEL_SHA256,
            class_names=["CW", "CCW"], source="F450_CW_CCW_V5_training",
        )
        self.registry.record_validation(
            model_id=record["model_id"], image_sha256="a" * 64,
            detections=[], teacher_id="teacher:7", expected_class="CW", teacher_decision="CORRECT",
        )
        self.registry.enable_teaching_trial(record["model_id"], "teacher:7", ["cohort-a"])

        # stale 在教師確認前已啟動，首次使用時必須刷新目前 Registry 檔案。
        stale.register_verified_v5(
            model_path="C:/isolated/best.pt", model_sha256=MODEL_SHA256,
            class_names=["CW", "CCW"], source="F450_CW_CCW_V5_training",
        )

        persisted = PropRotationTrialRegistry(Path(self.temp.name)).model()
        self.assertEqual(persisted["status"], "TEACHING_TRIAL")
        self.assertEqual(persisted["trial_cohort_ids"], ["cohort-a"])

    def test_rejects_non_v5_hash_and_wrong_two_class_order(self):
        with self.assertRaisesRegex(PropRotationTrialError, "model_sha256_mismatch"):
            self.registry.register_verified_v5(
                model_path="C:/isolated/best.pt", model_sha256="0" * 64,
                class_names=["CW", "CCW"], source="test",
            )

    def test_runner_rejects_wrong_weight_hash_before_child_process(self):
        image = Path(self.temp.name) / "prop.jpg"
        image.write_bytes(b"not-a-real-image")
        runner = RotationSandboxRunner(
            python_executable=sys.executable,
            worker_path=Path(self.temp.name) / "does-not-exist.py",
            expected_model_sha256=MODEL_SHA256,
        )

        with self.assertRaisesRegex(RotationSandboxError, "model_sha256_mismatch"):
            runner.infer(
                model_path=Path(self.temp.name) / "wrong.pt",
                image_bytes=image.read_bytes(),
                actual_model_sha256="0" * 64,
            )

    def test_sandbox_environment_preserves_non_secret_windows_username(self):
        """Torch 的快取目錄需要使用者名稱；不可因清洗環境而破壞隔離推論。"""
        if not os.environ.get("USERNAME"):
            self.skipTest("Windows username is not available in this test host")

        environment = RotationSandboxRunner._safe_environment()

        self.assertEqual(environment.get("USERNAME"), os.environ["USERNAME"])
        self.assertEqual(environment.get("HTTPS_PROXY"), "")

    def test_worker_loads_runtime_before_network_lock(self):
        """network lock 不得在 Python SSL／torch 依賴尚未載入時破壞 worker。"""
        image = Path(self.temp.name) / "invalid.bin"
        output = Path(self.temp.name) / "output.json"
        image.write_bytes(b"not-an-image")
        worker = Path(__file__).parents[1] / "app" / "rotation_sandbox_worker.py"
        result = subprocess.run(
            [sys.executable, "-I", str(worker), "--model", "missing.pt", "--image", str(image), "--output", str(output)],
            capture_output=True, text=True, timeout=30,
        )

        self.assertEqual(result.returncode, 2)
        self.assertNotIn("function() argument 'code'", result.stderr)
        with self.assertRaisesRegex(PropRotationTrialError, "class_contract_mismatch"):
            self.registry.register_verified_v5(
                model_path="C:/isolated/best.pt", model_sha256=MODEL_SHA256,
                class_names=["CCW", "CW"], source="test",
            )

