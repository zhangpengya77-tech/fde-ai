"""PROP_ROTATION_V5 的教師驗證與隔離教學試用服務。

本服務不碰既有 PROP_DIRECTION 四類模型，也不允許在缺少獨立 Golden Test 時
將 V5 設為 ACTIVE。實際 checkpoint 僅由 rotation_sandbox 子程序載入。
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

from .prop_rotation_v5 import (
    V5_CLASS_NAMES,
    PropRotationTrialError,
    PropRotationTrialRegistry,
)


class PropRotationServiceError(ValueError):
    """教學試用請求不符合安全或班級範圍時的錯誤。"""


class PropRotationTrialService:
    """將已驗證 V5 metadata、短時推論與教師確認串成最小教學試用流程。"""

    def __init__(self, *, registry: PropRotationTrialRegistry, runner, model_path: Path, model_sha256: str, source: str):
        self.registry = registry
        self.runner = runner
        self.model_path = Path(model_path)
        self.model_sha256 = str(model_sha256).lower()
        self.source = str(source)

    def _model(self) -> dict:
        return self.registry.register_verified_v5(
            model_path=str(self.model_path), model_sha256=self.model_sha256,
            class_names=list(V5_CLASS_NAMES), source=self.source,
        )

    @staticmethod
    def _image_sha256(image_bytes: bytes) -> str:
        if not image_bytes:
            raise PropRotationServiceError("image_required")
        return hashlib.sha256(image_bytes).hexdigest()

    @staticmethod
    def _filtered(result: dict, threshold: float = 0.5) -> list[dict]:
        if result.get("class_names") != list(V5_CLASS_NAMES):
            raise PropRotationServiceError("class_contract_mismatch")
        return sorted(
            [dict(item) for item in result.get("detections", []) if float(item.get("confidence", 0)) >= threshold],
            key=lambda item: float(item["confidence"]), reverse=True,
        )

    def status(self) -> dict:
        model = self._model()
        public = {key: value for key, value in model.items() if key != "file_path"}
        return {"task_id": model["task_id"], "model": public, "validations": self.registry.validations(model["model_id"])}

    def run_teacher_validation(self, *, image_bytes: bytes, teacher_id: str, expected_class: str | None = None) -> dict:
        model = self._model()
        if expected_class and expected_class not in V5_CLASS_NAMES:
            raise PropRotationServiceError("expected_class_invalid")
        result = self.runner.infer(model_path=self.model_path, image_bytes=image_bytes, actual_model_sha256=self.model_sha256)
        detections = self._filtered(result)
        validation = self.registry.record_validation(
            model_id=model["model_id"], image_sha256=self._image_sha256(image_bytes),
            detections=detections, teacher_id=str(teacher_id), expected_class=expected_class,
            teacher_decision="RETEST",
        )
        return {
            "validation_id": validation["validation_id"], "status": "AWAITING_TEACHER_CONFIRMATION",
            "class_names": list(V5_CLASS_NAMES), "detections": detections,
            "best_detection": detections[0] if detections else None,
            "image_width": int(result.get("image_width") or 0), "image_height": int(result.get("image_height") or 0),
        }

    def confirm_teacher_validation(self, *, validation_id: str, teacher_id: str, decision: str) -> dict:
        try:
            return self.registry.confirm_validation(validation_id=validation_id, teacher_id=str(teacher_id), decision=str(decision))
        except PropRotationTrialError as exc:
            raise PropRotationServiceError(str(exc)) from exc

    def enable_teaching_trial(self, *, teacher_id: str, cohort_id: str, authorized_cohort_ids: list[str]) -> dict:
        if not cohort_id or str(cohort_id) not in {str(item) for item in authorized_cohort_ids}:
            raise PropRotationServiceError("cohort_not_authorized")
        model = self._model()
        try:
            return self.registry.enable_teaching_trial(model["model_id"], str(teacher_id), [str(cohort_id)])
        except PropRotationTrialError as exc:
            raise PropRotationServiceError(str(exc)) from exc

    def withdraw_teaching_trial(self, *, teacher_id: str) -> dict:
        model = self._model()
        return self.registry.withdraw_teaching_trial(model["model_id"], str(teacher_id))

    def activate_isolated(self, *, teacher_id: str) -> dict:
        model = self._model()
        try:
            return self.registry.activate_isolated(model["model_id"], str(teacher_id))
        except PropRotationTrialError as exc:
            raise PropRotationServiceError(str(exc)) from exc

    def student_infer(self, *, image_bytes: bytes, student_id: str, cohort_ids: list[str]) -> dict:
        model = self._model()
        trial_cohorts = {str(item) for item in model.get("trial_cohort_ids", [])}
        caller_cohorts = {str(item) for item in cohort_ids}
        if model.get("status") not in {"TEACHING_TRIAL", "ACTIVE_ISOLATED"}:
            raise PropRotationServiceError("rotation_model_not_available")
        if not trial_cohorts or not trial_cohorts.intersection(caller_cohorts):
            raise PropRotationServiceError("cohort_not_authorized")
        result = self.runner.infer(model_path=self.model_path, image_bytes=image_bytes, actual_model_sha256=self.model_sha256)
        detections = self._filtered(result)
        event = self.registry.record_student_event(
            model_id=model["model_id"], student_id=str(student_id), cohort_ids=sorted(caller_cohorts),
            image_sha256=self._image_sha256(image_bytes), detections=detections,
        )
        return {
            "task_id": model["task_id"], "model_id": model["model_id"], "model_version": model["version"],
            "model_status": model["status"], "model_sha256": model["file_hash"],
            "class_names": list(V5_CLASS_NAMES), "detections": detections, "best_detection": detections[0] if detections else None,
            "learning_event_id": event["event_id"],
            "image_width": int(result.get("image_width") or 0), "image_height": int(result.get("image_height") or 0),
        }


def build_rotation_trial_service_from_environment() -> PropRotationTrialService | None:
    """只在明確隔離開關啟用時建立 V5 教學試用服務。

    無 registry root、模型路徑或雜湊時一律不啟用，避免意外連到正式 Registry。
    """
    if os.environ.get("FDE_PROP_ROTATION_V5_ENABLED") != "1":
        return None
    root = os.environ.get("FDE_PROP_ROTATION_V5_REGISTRY_ROOT", "").strip()
    model_path = os.environ.get("FDE_PROP_ROTATION_V5_MODEL_PATH", "").strip()
    model_sha256 = os.environ.get("FDE_PROP_ROTATION_V5_MODEL_SHA256", "").strip()
    if not root or not model_path or not model_sha256:
        raise PropRotationServiceError("rotation_trial_configuration_required")
    if model_sha256.lower() != "911228ff2c1019701e3409c51b767e359871418f501941f00746434cfcd7352c":
        raise PropRotationServiceError("model_sha256_mismatch")
    from .rotation_sandbox import RotationSandboxRunner

    return PropRotationTrialService(
        registry=PropRotationTrialRegistry(Path(root)),
        runner=RotationSandboxRunner(
            python_executable=os.environ.get("FDE_PROP_ROTATION_V5_PYTHON") or None,
            expected_model_sha256=model_sha256,
            timeout_seconds=int(os.environ.get("FDE_PROP_ROTATION_V5_TIMEOUT_SECONDS", "60")),
        ),
        model_path=Path(model_path), model_sha256=model_sha256,
        source="F450_CW_CCW_V5_training",
    )
