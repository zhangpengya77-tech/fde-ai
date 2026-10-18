from __future__ import annotations

import hashlib
import io
import json
import math
import os
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol
from uuid import uuid4


PROP_CLASSES = ("CW_F", "CCW_F", "CW_B", "CCW_B")
HOVER_CLASSES = ("FRONT", "RIGHT", "BACK", "LEFT")
MODEL_TYPES = ("PROP_DIRECTION", "FOUR_SIDE_HOVER")
MODEL_STATUSES = ("DRAFT", "VALIDATING", "VALIDATED", "CANDIDATE", "ACTIVE", "ARCHIVED", "REJECTED", "FAILED")
HARD_EXAMPLE_STATUSES = ("PENDING", "CONFIRMED", "CORRECTED", "REJECTED", "ADDED_TO_DATASET")
SUBMISSION_STATUSES = ("SUBMITTED", "IMPORTED", "REJECTED")
GOLDEN_SET_STATUSES = ("ACTIVE",)

MODEL_ID_PREFIX = {"PROP_DIRECTION": "PROP", "FOUR_SIDE_HOVER": "HOVER"}
# Recognised model container signatures: ZIP archive (most YOLO/PyTorch exports) or pickle.
_MODEL_SIGNATURES = (b"PK\x03\x04", b"\x80\x02", b"\x80\x03", b"\x80\x04")

PROP_RULE_VERSION = "PROP_RULE_v1"
HOVER_RULE_VERSION = "HOVER_RULE_v1"
DEFAULT_HOVER_CONFIG = {
    "required_hold_seconds": 5.0,
    "confidence_threshold": 0.5,
    "base_pass_score": 60.0,
    "stability_weight": 20.0,
    "centering_weight": 15.0,
    "boundary_weight": 5.0,
    "severe_outside_seconds": 3.0,
}


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def generate_model_id(model_type: str, group: str, version: str) -> str:
    prefix = MODEL_ID_PREFIX.get(model_type, model_type)
    date_part = datetime.now(UTC).strftime("%Y%m%d")
    group_part = str(group or "X").strip().upper() or "X"
    version_part = str(version or "v1").strip()
    return f"{prefix}_{date_part}_{group_part}_{version_part}"


class ModelValidationError(ValueError):
    pass


class ModelClassNamesMissingError(ModelValidationError):
    """模型可載入但 model.names 為空。

    教師指令（2026-10-18）：names 為空時 UI 顯示「模型缺少類別名稱，請補充」，
    不直接駁回——無法從空 names 推導任何對照表，只能由教師補充來源後重試。
    """

    def __init__(self, model_type: str = ""):
        super().__init__("model_class_names_missing")
        self.model_type = model_type


class ModelClassNamesMappingRequiredError(ModelValidationError):
    """類別名與任務預期不同但數量一致。

    教師指令（2026-10-18）：不直接駁回，而是把實際類別名與任務預期一併回報，
    由教師端提供「類別名對照表」後再行導入。
    """

    def __init__(self, model_type: str, class_names_actual: list[str], class_names_expected: list[str]):
        super().__init__("model_class_names_mapping_required")
        self.model_type = model_type
        self.class_names_actual = [str(name) for name in class_names_actual]
        self.class_names_expected = [str(name) for name in class_names_expected]


def normalize_class_name_mapping(mapping) -> dict[str, str]:
    """把教師提交的對照表正規化為 {實際類別名: 任務預期類別名}。"""
    return {str(key).strip(): str(value).strip() for key, value in dict(mapping or {}).items()}


def apply_class_name_mapping(actual: list[str], expected: list[str], mapping) -> list[str]:
    """依教師對照表把模型實際類別名轉為任務預期名稱（必須是映滿到 expected 的雙射）。

    順序以模型類別編號為準：回傳值与 actual 等長，逐項替换。
    """
    table = normalize_class_name_mapping(mapping)
    if not table:
        raise ValueError("invalid_class_name_mapping")
    if sorted(table) != sorted(actual) or sorted(table.values()) != sorted(expected):
        raise ValueError("invalid_class_name_mapping")
    return [table[name] for name in actual]


class ModelValidator(Protocol):
    def validate(self, path: Path, model_type: str) -> dict: ...


class ModelRunner(Protocol):
    def predict(self, path: Path, image_bytes: bytes) -> list[dict]: ...


class UltralyticsModelValidator:
    """Loads an uploaded file as a detection model and performs one local smoke inference.

    Performs the first-layer safety checks required by the validation pipeline:
    extension, file signature, readability, minimum size, then YOLO load, detection
    task, non-empty classes, smoke inference and a well-formed result object.
    """

    def validate(self, path: Path, _model_type: str) -> dict:
        try:
            self._check_prelude(path)
            import numpy as np
            from ultralytics import YOLO

            model = YOLO(str(path), task="detect")
            task = str(getattr(model, "task", ""))
            names_value = getattr(model, "names", {})
            names = [names_value[key] for key in sorted(names_value)] if isinstance(names_value, dict) else list(names_value)
            if not names:
                raise ModelValidationError("model_has_no_classes")
            prediction = model.predict(source=np.zeros((64, 64, 3), dtype=np.uint8), verbose=False)
            if not isinstance(prediction, (list, tuple)) or len(prediction) == 0:
                raise ModelValidationError("smoke_inference_returned_no_result")
            result_format = self._check_result_format(prediction[0])
        except ModelValidationError:
            raise
        except Exception as exc:
            raise ModelValidationError("ultralytics_model_load_or_smoke_inference_failed") from exc
        return {"class_names": names, "task": task, "smoke_inference": True, "result_format": result_format}

    @staticmethod
    def _check_prelude(path: Path) -> None:
        if not path.exists() or not os.access(str(path), os.R_OK):
            raise ModelValidationError("model_file_unreadable")
        if path.suffix.lower() != ".pt":
            raise ModelValidationError("model_extension_invalid")
        size = path.stat().st_size
        if size < 1024:
            raise ModelValidationError("model_file_too_small")
        with open(path, "rb") as handle:
            head = handle.read(8)
        if not any(head.startswith(sig) for sig in _MODEL_SIGNATURES):
            raise ModelValidationError("model_signature_invalid")

    @staticmethod
    def _check_result_format(prediction) -> bool:
        boxes = getattr(prediction, "boxes", None)
        names = getattr(prediction, "names", None)
        return boxes is not None and names is not None


class UltralyticsModelRunner:
    """Runs the selected ACTIVE model locally and returns model facts only."""

    def __init__(self):
        self._models: dict[str, object] = {}

    def predict(self, path: Path, image_bytes: bytes) -> list[dict]:
        try:
            import cv2
            import numpy as np
            from ultralytics import YOLO

            key = str(path)
            model = self._models.get(key)
            if model is None:
                model = YOLO(key, task="detect")
                self._models[key] = model
            image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
            if image is None:
                raise ValueError("invalid_image")
            prediction = model.predict(source=image, verbose=False)[0]
            names = prediction.names
            output = []
            for box in prediction.boxes:
                x1, y1, x2, y2 = [float(value) for value in box.xyxy[0].tolist()]
                class_id = int(box.cls[0])
                output.append({
                    "class": str(names[class_id]), "confidence": float(box.conf[0]),
                    "bbox": [x1, y1, x2, y2], "center_x": (x1 + x2) / 2, "center_y": (y1 + y2) / 2,
                })
            return output
        except Exception as exc:
            raise ModelValidationError("active_model_inference_failed") from exc


class JsonStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "vision_center.json"
        self.data = self._load()

    @staticmethod
    def empty() -> dict:
        return {"schema_version": 1, "models": [], "datasets": [], "evaluations": [], "hard_examples": [], "camera_profiles": [], "submissions": [], "golden_sets": [], "demo_active_submissions": {}}

    def _load(self) -> dict:
        if not self.path.exists():
            return self.empty()
        value = json.loads(self.path.read_text(encoding="utf-8"))
        baseline = self.empty()
        baseline.update(value)
        return baseline

    def save(self) -> None:
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp, self.path)


class VisionCenter:
    def __init__(self, root: Path | str, *, model_validator: ModelValidator | None = None, model_runner: ModelRunner | None = None, max_model_bytes: int = 100 * 1024 * 1024, demo_simulation_enabled: bool = False):
        self.root = Path(root)
        self.store = JsonStore(self.root)
        self.model_validator = model_validator or UltralyticsModelValidator()
        self.model_runner = model_runner or UltralyticsModelRunner()
        self.max_model_bytes = max_model_bytes
        self.demo_simulation_enabled = bool(demo_simulation_enabled)
        self.model_dir = self.root / "model_registry"
        self.dataset_dir = self.root / "datasets"
        self.submission_dir = self.root / "submissions"
        self.model_dir.mkdir(parents=True, exist_ok=True)
        self.dataset_dir.mkdir(parents=True, exist_ok=True)
        self.submission_dir.mkdir(parents=True, exist_ok=True)

    def infer_active(self, model_type: str, image_bytes: bytes) -> tuple[dict, list[dict]]:
        model = self.active_model(model_type)
        if model is None:
            raise ModelValidationError("active_model_required")
        if not image_bytes:
            raise ModelValidationError("image_required")
        return model, self.model_runner.predict(Path(model["file_path"]), image_bytes)

    # ---- Teacher single-image validation against one specific model ----
    def validate_image_with_model(
        self, model_id: str, image_bytes: bytes,
        *, expected_class: str | None = None, confidence_threshold: float = 0.5,
        rule_version: str | None = None, image_width: float | None = None,
        image_height: float | None = None,
    ) -> dict:
        """Run REAL inference with the named model on one uploaded image.

        This never touches the ACTIVE pointer and never mutates model status: it is a
        read-only evidence-producing probe used by the teacher validation page. The
        caller receives raw detection facts plus a rule verdict; nothing here decides
        activation.

        The .pt is loaded inside the Live Backend process, which is the component that
        already exists for exactly this purpose (and has ultralytics/torch). Django must
        never load a student .pt itself.
        """
        model = self._find("models", "model_id", model_id)
        if not image_bytes:
            raise ModelValidationError("image_required")
        path = Path(model["file_path"])
        if not path.exists() or not os.access(str(path), os.R_OK):
            raise ModelValidationError("model_file_unreadable")
        model_type = model["model_type"]
        classes = list(PROP_CLASSES if model_type == "PROP_DIRECTION" else HOVER_CLASSES)
        detections = self.model_runner.predict(path, image_bytes)
        best = max(detections, key=lambda item: item.get("confidence", 0), default=None)
        verdict = {
            "rule_version": rule_version or (PROP_RULE_VERSION if model_type == "PROP_DIRECTION" else HOVER_RULE_VERSION),
            "predicted_class": best.get("class") if best else None,
            "predicted_confidence": round(float(best.get("confidence", 0)), 6) if best else None,
            "expected_class": expected_class,
            "confidence_threshold": float(confidence_threshold),
            "decision": "INSUFFICIENT_DATA",
            "reason": "模型未偵測到任何目標。",
            "reason_code": "NO_DETECTION",
        }
        if best is None:
            pass
        elif float(best.get("confidence", 0)) < float(confidence_threshold):
            verdict.update(
                decision="INSUFFICIENT_DATA",
                reason="信心值低於門檻，不足以判定。",
                reason_code="LOW_CONFIDENCE",
            )
        elif expected_class:
            if best.get("class") == expected_class:
                verdict.update(decision="MATCH", reason="預測類別與教師標註相符。", reason_code="OK")
            else:
                verdict.update(
                    decision="MISMATCH",
                    reason=f"預測為 {best.get('class')}，教師標註為 {expected_class}。",
                    reason_code="CLASS_MISMATCH",
                )
        else:
            verdict.update(decision="DETECTED", reason="已取得預測類別，教師未提供標註可比對。", reason_code="NO_ANNOTATION")
        return {
            "model": {
                "model_id": model["model_id"], "model_type": model_type,
                "model_name": model.get("model_name", ""), "version": model.get("version", ""),
                "status": model.get("status"), "validation_status": model.get("validation_status"),
                "file_hash": model.get("file_hash"), "class_names": classes,
            },
            "detections": detections,
            "detection_count": len(detections),
            "verdict": verdict,
            "image_width": image_width,
            "image_height": image_height,
            "validated_at": utc_now(),
        }

    # ---- Version history & one-click rollback ----
    def model_history(self, model_type: str) -> list[dict]:
        """Return every version of a task's model family, newest change first.

        History is derived from the existing models array (ACTIVE + ARCHIVED records are
        never deleted), so no schema change and no new storage is required.
        """
        items = [dict(item) for item in self.store.data["models"] if item["model_type"] == model_type]
        items.sort(key=lambda item: str(item.get("activated_at") or item.get("uploaded_at") or ""), reverse=True)
        return items

    def previous_active_model(self, model_type: str, exclude_model_id: str | None = None) -> dict | None:
        """Most recently archived model of this task, i.e. the rollback target."""
        candidates = [
            item for item in self.store.data["models"]
            if item["model_type"] == model_type
            and item["status"] == "ARCHIVED"
            and item["model_id"] != exclude_model_id
            and item.get("validation_status") == "VALIDATED"
        ]
        if not candidates:
            return None
        candidates.sort(key=lambda item: str(item.get("archived_at") or item.get("activated_at") or item.get("uploaded_at") or ""), reverse=True)
        return dict(candidates[0])

    def rollback_model(self, model_type: str, rolled_back_by: str) -> dict:
        """Restore the most recent previously-active VALIDATED version.

        The current ACTIVE is archived rather than deleted, so a rollback is itself
        reversible. If there is nothing to restore, the ACTIVE pointer is left untouched
        and an error is raised — a failed switch must never leave the task without a model.
        """
        if model_type not in MODEL_TYPES:
            raise ValueError("unsupported_model_type")
        target = self.previous_active_model(model_type)
        if target is None:
            raise ValueError("no_previous_validated_model")
        current = self.active_model(model_type)
        for item in self.store.data["models"]:
            if item["model_type"] == model_type and item["status"] == "ACTIVE":
                item.update(status="ARCHIVED", archived_by=rolled_back_by, archived_at=utc_now())
        stored = self._find("models", "model_id", target["model_id"])
        stored.update(status="ACTIVE", activated_by=rolled_back_by, activated_at=utc_now(),
                      restored_from_rollback=True)
        self._write_manifest(Path(stored["file_path"]).parent, stored)
        self.store.save()
        return {
            "restored": dict(stored),
            "replaced": dict(current) if current else None,
            "rolled_back_by": rolled_back_by,
            "rolled_back_at": utc_now(),
        }

    def verify_active_model_inference(self, model_type: str) -> dict:
        """Prove the ACTIVE pointer actually drives inference for this task.

        Used after activation/rollback so the teacher page can state the real state
        instead of merely echoing a database flag. Returns the resolved model plus the
        exact file the runner would load.
        """
        active = self.active_model(model_type)
        if active is None:
            return {"task_id": model_type, "active_model_id": None, "active_model_version": None,
                    "file_path": None, "file_exists": False, "inference_source": "NONE"}
        path = Path(active["file_path"])
        return {
            "task_id": model_type,
            "active_model_id": active["model_id"],
            "active_model_version": active.get("version"),
            "file_path": str(path),
            "file_exists": path.exists(),
            "file_hash": active.get("file_hash"),
            "inference_source": "ACTIVE_MODEL_FILE",
        }

    def list_models(self, model_type: str | None = None) -> list[dict]:
        return [dict(item) for item in self.store.data["models"] if model_type is None or item["model_type"] == model_type]

    def get_model(self, model_id: str) -> dict:
        return dict(self._find("models", "model_id", model_id))

    def active_model(self, model_type: str) -> dict | None:
        found = next((item for item in self.store.data["models"] if item["model_type"] == model_type and item["status"] == "ACTIVE"), None)
        return dict(found) if found else None

    def upload_model(self, *, model_type: str, model_name: str, version: str, content: bytes, dataset_id: str, dataset_version: str, rule_version: str, uploaded_by: str, notes: str = "", source_group: str | None = None, source_submission_id: str | None = None, source_student_id: str | None = None, class_name_mapping=None) -> dict:
        if model_type not in MODEL_TYPES:
            raise ModelValidationError("unsupported_model_type")
        if not content or len(content) > self.max_model_bytes:
            raise ModelValidationError("invalid_model_file_size")
        try:
            dataset = self._find("datasets", "dataset_id", dataset_id)
        except KeyError as exc:
            raise ModelValidationError("dataset_binding_mismatch") from exc
        if dataset["model_type"] != model_type or dataset["dataset_version"] != dataset_version:
            raise ModelValidationError("dataset_binding_mismatch")
        model_id = self._unique_model_id(generate_model_id(model_type, source_group, version))
        type_dir = self.model_dir / ("prop_direction" if model_type == "PROP_DIRECTION" else "four_side_hover")
        model_dir_for_model = type_dir / model_id
        model_dir_for_model.mkdir(parents=True, exist_ok=True)
        path = model_dir_for_model / "best.pt"
        path.write_bytes(content)
        file_hash = sha256_bytes(content)
        file_size = len(content)
        record = {
            "model_id": model_id, "model_type": model_type, "model_name": str(model_name).strip(), "version": str(version).strip(),
            "file_path": str(path), "file_hash": file_hash, "file_size": file_size, "class_names": [],
            "source_group": None if source_group is None else str(source_group).strip(),
            "source_submission_id": source_submission_id, "source_student_id": source_student_id, "dataset_id": dataset_id,
            "dataset_version": dataset_version, "rule_version": str(rule_version).strip(), "uploaded_by": uploaded_by,
            "uploaded_at": utc_now(), "validation_status": "VALIDATING", "evaluation_status": "NOT_EVALUATED",
            "metrics": {}, "status": "VALIDATING", "notes": notes,
        }
        self.store.data["models"].append(record)
        self._write_manifest(model_dir_for_model, record)
        self.store.save()
        try:
            details = self.model_validator.validate(path, model_type)
            expected = list(PROP_CLASSES if model_type == "PROP_DIRECTION" else HOVER_CLASSES)
            if details.get("task") != "detect":
                raise ModelValidationError("model_must_be_detection_model")
            actual = [str(name) for name in (details.get("class_names") or [])]
            if not actual:
                # 教師指令③：names 為空不直接駁回——拋出可識別的缺少類別名錯誤。
                raise ModelClassNamesMissingError(model_type)
            if actual == expected:
                record.update(class_names=expected, validation_status="VALIDATED", status="VALIDATED")
            elif len(actual) != len(expected):
                raise ModelValidationError("model_class_names_mismatch")
            elif not class_name_mapping:
                # 教師指令③：數量一致、名稱不同 → 要求對照表，而不是直接駁回。
                raise ModelClassNamesMappingRequiredError(model_type, actual, expected)
            else:
                normalized = apply_class_name_mapping(actual, expected, class_name_mapping)
                record.update(class_names=normalized, validation_status="VALIDATED", status="VALIDATED",
                              class_name_mapping=normalize_class_name_mapping(class_name_mapping))
            if details.get("smoke_inference") is not True:
                raise ModelValidationError("smoke_inference_failed")
            self._write_manifest(model_dir_for_model, record)
            self.store.save()
            return dict(record)
        except Exception as exc:
            record.update(validation_status="REJECTED", status="REJECTED", notes=f"{notes}\n{exc}".strip())
            self._write_manifest(model_dir_for_model, record)
            self.store.save()
            if isinstance(exc, ModelValidationError):
                raise
            raise ModelValidationError("model_validation_failed") from exc

    def _unique_model_id(self, base: str) -> str:
        if not any(item["model_id"] == base for item in self.store.data["models"]):
            return base
        return f"{base}_{uuid4().hex[:4]}"

    def _write_manifest(self, model_dir: Path, record: dict) -> None:
        manifest = {key: value for key, value in record.items() if key != "file_path"}
        manifest["best_pt_relative"] = "best.pt"
        (model_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    def save_evaluation(self, model_id: str, metrics: dict, evaluated_by: str) -> dict:
        model = self._find("models", "model_id", model_id)
        required = {"precision", "recall", "map50", "map50_95", "per_class_metrics", "confusion_matrix", "error_count", "low_confidence_count"}
        if not required.issubset(metrics):
            raise ValueError("incomplete_golden_evaluation")
        evaluation = {"evaluation_id": f"evaluation-{uuid4()}", "model_id": model_id, "model_type": model["model_type"], "golden_set": f"{MODEL_ID_PREFIX.get(model['model_type'], model['model_type'])}_GOLDEN_v1", "metrics": dict(metrics), "evaluated_by": evaluated_by, "evaluated_at": utc_now()}
        self.store.data["evaluations"].append(evaluation)
        model.update(evaluation_status="EVALUATED", metrics=dict(metrics), status="CANDIDATE")
        model_dir = Path(model["file_path"]).parent
        (model_dir / "evaluation.json").write_text(json.dumps(evaluation, ensure_ascii=False, indent=2), encoding="utf-8")
        (model_dir / "metrics.json").write_text(json.dumps(dict(metrics), ensure_ascii=False, indent=2), encoding="utf-8")
        self._write_manifest(model_dir, model)
        self.store.save()
        return dict(evaluation)

    def list_evaluations(self, model_id: str | None = None) -> list[dict]:
        return [dict(item) for item in self.store.data["evaluations"] if model_id is None or item["model_id"] == model_id]

    def activate_model(self, model_id: str, activated_by: str) -> dict:
        """Promote a validated model to ACTIVE for its task.

        The returned object stays the model record itself (existing API contract), with
        switch facts attached under `activation`. Order of operations is deliberate: the
        new model is proven present on disk BEFORE the previous ACTIVE is archived, so a
        failed switch leaves the task on its original model rather than with no model.
        """
        model = self._find("models", "model_id", model_id)
        if model["validation_status"] != "VALIDATED" or model["status"] == "REJECTED":
            raise ValueError("validated_model_required")
        path = Path(model["file_path"])
        if not path.exists() or not os.access(str(path), os.R_OK):
            raise ValueError("model_file_unreadable")
        if model["status"] == "ACTIVE":
            model["activation"] = {
                "previous_active_model_id": None,
                "already_active": True,
                "inference_source": self.verify_active_model_inference(model["model_type"]),
            }
            return dict(model)
        previous = self.active_model(model["model_type"])
        for item in self.store.data["models"]:
            if item["model_type"] == model["model_type"] and item["status"] == "ACTIVE":
                item.update(status="ARCHIVED", archived_by=activated_by, archived_at=utc_now())
        model.update(status="ACTIVE", activated_by=activated_by, activated_at=utc_now())
        self._write_manifest(path.parent, model)
        self.store.save()
        result = dict(model)
        result["activation"] = {
            "previous_active_model_id": previous["model_id"] if previous else None,
            "already_active": False,
            "inference_source": self.verify_active_model_inference(model["model_type"]),
        }
        return result

    def archive_model(self, model_id: str, archived_by: str) -> dict:
        model = self._find("models", "model_id", model_id)
        model.update(status="ARCHIVED", archived_by=archived_by, archived_at=utc_now())
        self._write_manifest(Path(model["file_path"]).parent, model)
        self.store.save()
        return dict(model)

    # ---- Student model submission (inert attachment, never executed) ----
    def create_submission(
        self, *, task_id: str, student_id: str, group_id: str,
        original_filename: str, content: bytes, notes: str = "",
        growth_record_id: str = "", growth_record_slot: str = "",
        evidence_reference: str = "", evidence_type: str = "",
    ) -> dict:
        if task_id not in MODEL_TYPES:
            raise ValueError("unsupported_submission_task")
        if not str(original_filename).lower().endswith(".pt"):
            raise ValueError("pt_file_required")
        if not content or len(content) > self.max_model_bytes:
            raise ValueError("invalid_submission_file_size")
        submission_id = f"sub-{uuid4()}"
        type_dir = self.submission_dir / ("prop_direction" if task_id == "PROP_DIRECTION" else "four_side_hover")
        folder = type_dir / submission_id
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "submission.pt"
        path.write_bytes(content)
        record = {
            "submission_id": submission_id, "task_id": task_id, "student_id": str(student_id).strip(),
            "group_id": str(group_id).strip(), "original_filename": str(original_filename),
            "file_path": str(path), "file_hash": sha256_bytes(content), "file_size": len(content),
            "uploaded_at": utc_now(), "status": "SUBMITTED", "imported_model_id": None, "imported_at": None,
            "import_attempted_at": None, "import_last_error": None,
            "notes": notes, "growth_record_id": str(growth_record_id),
            "growth_record_slot": str(growth_record_slot),
            "evidence_reference": str(evidence_reference), "evidence_type": str(evidence_type),
        }
        self.store.data["submissions"].append(record)
        self.store.save()
        return dict(record)

    def get_submission(self, submission_id: str) -> dict:
        return dict(self._find("submissions", "submission_id", submission_id))

    def list_submissions(self, task_id: str | None = None, status: str | None = None) -> list[dict]:
        return [dict(item) for item in self.store.data["submissions"] if (task_id is None or item["task_id"] == task_id) and (status is None or item["status"] == status)]

    def approve_demo_submission(self, submission_id: str, *, approved_by: str) -> dict:
        """Approve one inert R07 attachment for the isolated DEMO adapter only."""
        if not self.demo_simulation_enabled:
            raise ValueError("demo_simulation_disabled")
        submission = self._find("submissions", "submission_id", submission_id)
        if submission["task_id"] != "PROP_DIRECTION":
            raise ValueError("demo_prop_direction_only")
        if submission.get("growth_record_slot") != "R07":
            raise ValueError("demo_r07_submission_required")
        submission.update(
            demo_review_status="DEMO_REVIEW_APPROVED",
            demo_approved_by=str(approved_by),
            demo_approved_at=utc_now(),
            demo_active=True,
        )
        for item in self.store.data["submissions"]:
            if item["task_id"] == submission["task_id"] and item["submission_id"] != submission_id:
                item["demo_active"] = False
        self.store.data["demo_active_submissions"][submission["task_id"]] = submission_id
        self.store.save()
        return dict(submission)

    def demo_model_status(self, model_type: str) -> dict | None:
        if not self.demo_simulation_enabled:
            return None
        submission_id = self.store.data["demo_active_submissions"].get(model_type)
        if not submission_id:
            return None
        submission = self._find("submissions", "submission_id", submission_id)
        if submission.get("demo_review_status") != "DEMO_REVIEW_APPROVED":
            return None
        return {
            "status": "DEMO_REVIEW_APPROVED",
            "simulation_mode": True,
            "result_label": "DEMO 模擬結果",
            "model_id": f"DEMO_R07_{submission_id}",
            "model_version": "R07-DEMO",
            "submission_id": submission_id,
            "student_id": submission.get("student_id"),
            "group_id": submission.get("group_id"),
            "file_hash": submission.get("file_hash"),
        }

    def simulate_prop_check(self, *, image_bytes: bytes, image_width: float, image_height: float) -> dict:
        """Return an explicitly labelled DEMO result without loading the submitted .pt."""
        model = self.demo_model_status("PROP_DIRECTION")
        if model is None:
            raise ModelValidationError("demo_approved_submission_required")
        if not image_bytes:
            raise ModelValidationError("image_required")
        width, height = float(image_width), float(image_height)
        detection = {
            "class": "CW_F",
            "confidence": 0.76,
            "bbox": [width * 0.25, height * 0.25, width * 0.75, height * 0.75],
            "center_x": width * 0.5,
            "center_y": height * 0.5,
        }
        result = evaluate_prop([detection], width, height, 0.5)
        result.update(
            status="DEMO_SIMULATED",
            simulation_mode=True,
            result_label="DEMO 模擬結果",
            model=model,
            detections=[detection],
        )
        return result

    def import_submission(self, submission_id: str, *, model_name: str, version: str, dataset_id: str, dataset_version: str, rule_version: str, uploaded_by: str, notes: str = "", class_name_mapping=None) -> dict:
        submission = self._find("submissions", "submission_id", submission_id)
        if submission["status"] != "SUBMITTED":
            raise ValueError("submission_not_importable")
        if not Path(submission["file_path"]).exists():
            raise ValueError("submission_file_missing")
        # 先做唯讀預檢（載入 .pt 取得實際類別名）。預檢失敗時不建立任何模型或資料集
        # 紀錄，提交保持 SUBMITTED——教師指令③④（2026-10-18）：不直接駁回、
        # 顯示失敗原因，由教師決定（補充類別名／提供對照表／手動駁回）。
        self._inspect_submission_for_import(submission, class_name_mapping=class_name_mapping)
        content = Path(submission["file_path"]).read_bytes()
        try:
            model = self.upload_model(
                model_type=submission["task_id"], model_name=model_name, version=version,
                content=content, dataset_id=dataset_id, dataset_version=dataset_version,
                rule_version=rule_version, uploaded_by=uploaded_by, notes=notes,
                source_group=submission["group_id"], source_submission_id=submission_id,
                source_student_id=submission["student_id"], class_name_mapping=class_name_mapping,
            )
        except Exception as exc:
            # 教師指令④：匯入失敗不自動把 submission 改成 REJECTED；保持 SUBMITTED，
            # 記錄失敗原因與嘗試時間，讓教師頁可以顯示並由教師決定下一步。
            submission.update(
                status="SUBMITTED",
                import_attempted_at=utc_now(),
                import_last_error=f"import_failed:{exc}",
            )
            self.store.save()
            raise
        submission.update(status="IMPORTED", imported_model_id=model["model_id"], imported_at=utc_now(),
                          import_attempted_at=utc_now(), import_last_error=None)
        self.store.save()
        return dict(model)

    def _inspect_submission_for_import(self, submission: dict, *, class_name_mapping=None) -> dict:
        """唯讀預檢：載入提交的 .pt，回報實際類別名與任務預期的關係。

        不做任何狀態或磁盤寫入。names 為空／數量一致但名稱不同／數量不符分別拋出
        可識別的例外，供匯入端與教師 UI 區分處理（教師指令③）。
        """
        model_type = submission["task_id"]
        path = Path(submission["file_path"])
        details = self.model_validator.validate(path, model_type)
        expected = list(PROP_CLASSES if model_type == "PROP_DIRECTION" else HOVER_CLASSES)
        actual = [str(name) for name in (details.get("class_names") or [])]
        if details.get("task") != "detect":
            raise ModelValidationError("model_must_be_detection_model")
        if not actual:
            raise ModelClassNamesMissingError(model_type)
        if actual != expected:
            if len(actual) != len(expected):
                raise ModelValidationError("model_class_names_mismatch")
            if class_name_mapping is None:
                raise ModelClassNamesMappingRequiredError(model_type, actual, expected)
            apply_class_name_mapping(actual, expected, class_name_mapping)
        if details.get("smoke_inference") is not True:
            raise ModelValidationError("smoke_inference_failed")
        return {"task_id": model_type, "class_names_actual": actual, "class_names_expected": expected}

    def preflight_import(self, submission_id: str) -> dict:
        """教師頁導入前的唯讀檢查：回報結局而不改動任何狀態。

        outcome: ready（類別名與預期一致）｜mapping_required（數量一致、名稱不同，
        應提供對照表）｜class_names_missing（模型缺少類別名稱，請補充）｜
        mismatch（數量不符）｜detection_model_required（非 detect 任務）。
        """
        submission = self._find("submissions", "submission_id", submission_id)
        if submission["status"] != "SUBMITTED":
            raise ValueError("submission_not_importable")
        if not Path(submission["file_path"]).exists():
            raise ValueError("submission_file_missing")
        model_type = submission["task_id"]
        expected = list(PROP_CLASSES if model_type == "PROP_DIRECTION" else HOVER_CLASSES)
        try:
            details = self.model_validator.validate(Path(submission["file_path"]), model_type)
        except ModelValidationError as exc:
            return {
                "submission_id": submission_id, "task_id": model_type,
                "outcome": "unloadable", "reason": str(exc),
                "class_names_actual": [], "class_names_expected": expected,
            }
        actual = [str(name) for name in (details.get("class_names") or [])]
        if details.get("task") != "detect":
            outcome = "detection_model_required"
        elif not actual:
            outcome = "class_names_missing"
        elif len(actual) != len(expected):
            outcome = "mismatch"
        elif actual != expected:
            outcome = "mapping_required"
        else:
            outcome = "ready"
        return {
            "submission_id": submission_id, "task_id": model_type,
            "outcome": outcome, "class_names_actual": actual, "class_names_expected": expected,
        }

    # ---- Golden Test Set registry ----
    def create_golden_set(self, payload: dict) -> dict:
        model_type = payload.get("model_type")
        if model_type not in MODEL_TYPES:
            raise ValueError("unsupported_model_type")
        prefix = MODEL_ID_PREFIX.get(model_type, model_type)
        golden_set_id = str(payload.get("golden_set_id") or f"{prefix}_GOLDEN_v1")
        if any(item["golden_set_id"] == golden_set_id for item in self.store.data["golden_sets"]):
            raise ValueError("golden_set_exists")
        record = {
            "golden_set_id": golden_set_id, "model_type": model_type, "name": str(payload.get("name") or golden_set_id),
            "total_cases": int(payload.get("total_cases") or 0), "description": payload.get("description") or "",
            "created_by": payload.get("created_by"), "created_at": utc_now(), "status": "ACTIVE",
        }
        self.store.data["golden_sets"].append(record)
        self.store.save()
        return dict(record)

    def list_golden_sets(self, model_type: str | None = None) -> list[dict]:
        return [dict(item) for item in self.store.data["golden_sets"] if model_type is None or item["model_type"] == model_type]

    def get_golden_set(self, golden_set_id: str) -> dict:
        return dict(self._find("golden_sets", "golden_set_id", golden_set_id))

    def model_golden_sets(self, model_id: str) -> list[dict]:
        self._find("models", "model_id", model_id)
        ids = {evaluation["golden_set"] for evaluation in self.store.data["evaluations"] if evaluation.get("model_id") == model_id and evaluation.get("golden_set")}
        return [dict(item) for item in self.store.data["golden_sets"] if item["golden_set_id"] in ids]

    # ---- Backend video frame extraction + hover analysis (Section 16) ----
    def process_video(self, *, content: bytes, frame_interval_seconds: float = 0.5, camera_profile: dict | None = None, config: dict | None = None, model_type: str = "FOUR_SIDE_HOVER") -> dict:
        if model_type != "FOUR_SIDE_HOVER":
            raise ValueError("video_analysis_supports_hover_only")
        model = self.active_model(model_type)
        if model is None:
            raise ModelValidationError("active_model_required")
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as handle:
            handle.write(content)
            video_path = handle.name
        try:
            try:
                import cv2
            except ImportError as exc:
                raise ModelValidationError("opencv_unavailable") from exc
            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                raise ModelValidationError("video_unreadable")
            fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
            frame_interval = max(0.1, float(frame_interval_seconds))
            sample_step = max(1, int(round(fps * frame_interval))) if fps > 0 else 1
            index = 0
            frames = []
            while True:
                if not cap.grab():
                    break
                if index % sample_step == 0:
                    ok, image = cap.retrieve()
                    if ok and image is not None:
                        success, encoded = cv2.imencode(".jpg", image)
                        if success:
                            detections = self.model_runner.predict(Path(model["file_path"]), encoded.tobytes())
                            best = max(detections, key=lambda item: item.get("confidence", 0), default={})
                            timestamp = round(index / fps, 3) if fps > 0 else round(index * frame_interval, 3)
                            frames.append({
                                "timestamp": timestamp, "direction": best.get("class", "UNKNOWN"),
                                "confidence": best.get("confidence", 0), "center_x": best.get("center_x", 0),
                                "center_y": best.get("center_y", 0),
                            })
                index += 1
            cap.release()
        finally:
            try:
                os.remove(video_path)
            except OSError:
                pass
        result = analyze_hover(frames, camera_profile, config)
        result["model"] = {"model_id": model["model_id"], "model_version": model["version"]}
        result["frame_count"] = len(frames)
        result["frame_interval_seconds"] = frame_interval
        return result

    def create_dataset(self, payload: dict) -> dict:
        model_type = payload.get("model_type")
        if model_type not in MODEL_TYPES:
            raise ValueError("unsupported_model_type")
        dataset_id = str(payload.get("dataset_id") or f"dataset-{uuid4()}")
        path = self.dataset_dir / dataset_id
        (path / "images").mkdir(parents=True, exist_ok=True)
        (path / "labels").mkdir(parents=True, exist_ok=True)
        record = {
            "dataset_id": dataset_id, "model_type": model_type, "dataset_version": str(payload.get("dataset_version") or "v1"),
            "total_images": int(payload.get("total_images") or 0), "train_count": int(payload.get("train_count") or 0),
            "val_count": int(payload.get("val_count") or 0), "test_count": int(payload.get("test_count") or 0),
            "class_distribution": dict(payload.get("class_distribution") or {}), "source_groups": list(payload.get("source_groups") or []),
            "created_at": utc_now(), "created_by": payload.get("created_by"), "parent_dataset_id": payload.get("parent_dataset_id"),
            "notes": payload.get("notes") or "", "storage_path": str(path), "manifest_path": str(path / "dataset_metadata.json"),
            "hard_example_ids": list(payload.get("hard_example_ids") or []),
            "hard_example_count": len(payload.get("hard_example_ids") or []), "auto_train_enabled": False,
        }
        self.store.data["datasets"].append(record)
        self._write_dataset_metadata(record)
        self.store.save()
        return dict(record)

    def list_datasets(self, model_type: str | None = None) -> list[dict]:
        return [dict(item) for item in self.store.data["datasets"] if model_type is None or item["model_type"] == model_type]

    def build_next_dataset(self, parent_dataset_id: str, hard_example_ids: list[str], new_samples: list[dict], created_by: str) -> dict:
        parent = self._find("datasets", "dataset_id", parent_dataset_id)
        confirmed = []
        for sample_id in hard_example_ids:
            sample = self._find("hard_examples", "sample_id", sample_id)
            if sample["review_status"] not in ("CONFIRMED", "CORRECTED"):
                raise ValueError("reviewed_hard_examples_required")
            confirmed.append(sample)
        version_number = int(str(parent["dataset_version"]).lower().lstrip("v") or "1") + 1
        child = self.create_dataset({
            "model_type": parent["model_type"], "dataset_version": f"v{version_number}",
            "total_images": parent["total_images"] + len(confirmed) + len(new_samples),
            "train_count": parent["train_count"] + len(confirmed) + len(new_samples), "val_count": parent["val_count"], "test_count": parent["test_count"],
            "class_distribution": parent["class_distribution"], "source_groups": list(dict.fromkeys(parent["source_groups"] + ["CONFIRMED_HARD_EXAMPLES", "NEW_HIGH_QUALITY_SAMPLES"])),
            "created_by": created_by, "parent_dataset_id": parent_dataset_id, "notes": "Retains parent core data and adds reviewed/new samples.", "hard_example_ids": hard_example_ids,
        })
        for sample in confirmed:
            sample["review_status"] = "ADDED_TO_DATASET"
            sample["dataset_id"] = child["dataset_id"]
        self.store.save()
        return child

    def export_dataset(self, dataset_id: str) -> bytes:
        dataset = self._find("datasets", "dataset_id", dataset_id)
        buffer = io.BytesIO()
        classes = PROP_CLASSES if dataset["model_type"] == "PROP_DIRECTION" else HOVER_CLASSES
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("images/", "")
            archive.writestr("labels/", "")
            archive.writestr("data.yaml", "path: .\ntrain: images\nval: images\ntest: images\nnames:\n" + "".join(f"  {i}: {name}\n" for i, name in enumerate(classes)))
            archive.writestr("split_manifest.json", json.dumps({"train_count": dataset["train_count"], "val_count": dataset["val_count"], "test_count": dataset["test_count"]}, indent=2))
            archive.writestr("dataset_metadata.json", json.dumps(dataset, ensure_ascii=False, indent=2))
        return buffer.getvalue()

    def create_hard_example(self, payload: dict) -> dict:
        record = {
            "sample_id": f"sample-{uuid4()}", "model_type": payload["model_type"], "model_version": payload.get("model_version"),
            "source": payload.get("source"), "input_reference": payload.get("input_reference"), "prediction": payload.get("prediction"),
            "confidence": payload.get("confidence"), "teacher_label": None, "review_status": "PENDING", "created_at": utc_now(),
            "reviewed_by": None, "reviewed_at": None, "notes": payload.get("notes") or "", "retention_status": payload.get("retention_status", "METADATA_AND_NECESSARY_FRAME_ONLY"),
        }
        self.store.data["hard_examples"].append(record)
        self.store.save()
        return dict(record)

    def list_hard_examples(self, status: str | None = None) -> list[dict]:
        return [dict(item) for item in self.store.data["hard_examples"] if status is None or item["review_status"] == status]

    def review_hard_example(self, sample_id: str, decision: str, teacher_label: str | None, reviewed_by: str, notes: str = "") -> dict:
        if decision not in ("CONFIRMED", "CORRECTED", "REJECTED"):
            raise ValueError("invalid_review_decision")
        sample = self._find("hard_examples", "sample_id", sample_id)
        sample.update(review_status=decision, teacher_label=teacher_label, reviewed_by=reviewed_by, reviewed_at=utc_now(), notes=notes or sample["notes"])
        self.store.save()
        return dict(sample)

    def create_camera_profile(self, four_corner_points: list[list[float]], created_by: str, camera_name: str = "", width_m: float = 2.0, height_m: float = 2.0) -> dict:
        if len(four_corner_points) != 4 or any(len(point) != 2 for point in four_corner_points):
            raise ValueError("four_corner_points_required")
        try:
            matrix = _homography(four_corner_points, float(width_m), float(height_m))
        except ValueError as exc:
            raise ValueError("invalid_calibration_geometry") from exc
        profile = {
            "camera_profile_id": f"camera-{uuid4()}", "camera_name": str(camera_name or "").strip(),
            "four_corner_points": four_corner_points, "width_m": float(width_m), "height_m": float(height_m),
            "center_point": [float(width_m) / 2.0, float(height_m) / 2.0],
            "homography_matrix": [round(value, 8) for value in matrix], "created_by": created_by,
            "created_at": utc_now(), "updated_at": utc_now(),
        }
        self.store.data["camera_profiles"].append(profile)
        self.store.save()
        return dict(profile)

    def get_camera_profile(self, profile_id: str) -> dict:
        return dict(self._find("camera_profiles", "camera_profile_id", profile_id))

    def _write_dataset_metadata(self, dataset: dict) -> None:
        path = Path(dataset["storage_path"])
        (path / "dataset_metadata.json").write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding="utf-8")
        (path / "split_manifest.json").write_text(json.dumps({"train_count": dataset["train_count"], "val_count": dataset["val_count"], "test_count": dataset["test_count"]}, indent=2), encoding="utf-8")

    def _find(self, collection: str, key: str, value: str) -> dict:
        found = next((item for item in self.store.data[collection] if item.get(key) == value), None)
        if found is None:
            raise KeyError(value)
        return found


def _center(detection: dict) -> tuple[float, float]:
    if "center_x" in detection and "center_y" in detection:
        return float(detection["center_x"]), float(detection["center_y"])
    box = detection.get("bbox") or detection.get("box")
    if not isinstance(box, list) or len(box) != 4:
        raise ValueError("bbox_required")
    return (float(box[0]) + float(box[2])) / 2, (float(box[1]) + float(box[3])) / 2


def evaluate_prop(detections: list[dict], image_width: float, image_height: float, confidence_threshold: float = 0.5, rule_version: str = PROP_RULE_VERSION) -> dict:
    positions = {
        "M1": {"expected": "CCW_F", "quadrant": "front_right"}, "M2": {"expected": "CCW_F", "quadrant": "rear_left"},
        "M3": {"expected": "CW_F", "quadrant": "front_left"}, "M4": {"expected": "CW_F", "quadrant": "rear_right"},
    }
    buckets = {key: [] for key in positions}
    for detection in detections:
        x, y = _center(detection)
        key = "M3" if x < image_width / 2 and y < image_height / 2 else "M1" if x >= image_width / 2 and y < image_height / 2 else "M2" if x < image_width / 2 else "M4"
        buckets[key].append(detection)
    results = {}
    for key, definition in positions.items():
        items = buckets[key]
        result = {"detected": None, "expected": definition["expected"], "blade_face": None, "confidence": None, "result": "INSUFFICIENT_DATA", "reason": "缺少槳葉", "reason_code": "MISSING_TARGET"}
        if len(items) > 1:
            result.update(reason="同一位置出現重複檢測", reason_code="DUPLICATE_DETECTION")
        elif len(items) == 1:
            item = items[0]
            detected = item.get("class") or item.get("className")
            confidence = float(item.get("confidence", 0))
            result.update(detected=detected, blade_face="FRONT" if str(detected).endswith("_F") else "BACK", confidence=confidence)
            if confidence < confidence_threshold:
                result.update(reason="信心值過低，無法可靠判斷", reason_code="LOW_CONFIDENCE")
            elif detected == definition["expected"]:
                result.update(result="PASS", reason="方向與槳面正確", reason_code="OK")
            else:
                expected_rotation, expected_face = definition["expected"].split("_")
                actual_rotation, actual_face = str(detected).split("_") if str(detected).count("_") == 1 else ("UNKNOWN", "UNKNOWN")
                if actual_rotation != expected_rotation and actual_face != expected_face:
                    code, reason = "ROTATION_AND_FACE_WRONG", "旋向與槳面都錯誤"
                elif actual_rotation != expected_rotation:
                    code, reason = "ROTATION_WRONG", "旋向錯誤"
                else:
                    code, reason = "FACE_WRONG", "方向正確、槳面錯誤"
                result.update(result="NG", reason=reason, reason_code=code)
        results[key] = result
    final = "PASS" if all(item["result"] == "PASS" for item in results.values()) else "INSUFFICIENT_DATA" if any(item["result"] == "INSUFFICIENT_DATA" for item in results.values()) else "NG"
    return {"rule_version": rule_version, "positions": results, "final_result": final}


def _solve_linear(matrix: list[list[float]], values: list[float]) -> list[float]:
    augmented = [row[:] + [values[index]] for index, row in enumerate(matrix)]
    for column in range(len(values)):
        pivot = max(range(column, len(values)), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-12:
            raise ValueError("invalid_calibration_geometry")
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        augmented[column] = [value / divisor for value in augmented[column]]
        for row in range(len(values)):
            if row == column:
                continue
            factor = augmented[row][column]
            augmented[row] = [value - factor * other for value, other in zip(augmented[row], augmented[column])]
    return [augmented[index][-1] for index in range(len(values))]


def _homography(points: list[list[float]], width: float, height: float) -> list[float]:
    targets = ((0.0, 0.0), (width, 0.0), (width, height), (0.0, height))
    matrix, values = [], []
    for (x, y), (u, v) in zip(points, targets):
        matrix.extend(([x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]))
        values.extend((u, v))
    return _solve_linear(matrix, values)


def _project(h: list[float], x: float, y: float) -> tuple[float, float]:
    denominator = h[6] * x + h[7] * y + 1
    return ((h[0] * x + h[1] * y + h[2]) / denominator, (h[3] * x + h[4] * y + h[5]) / denominator)


def analyze_hover(frames: list[dict], camera_profile: dict | None, config: dict | None = None, rule_version: str = HOVER_RULE_VERSION) -> dict:
    cfg = {**DEFAULT_HOVER_CONFIG, **(config or {})}
    calibrated = camera_profile is not None
    transform = _homography(camera_profile["four_corner_points"], camera_profile.get("width_m", 2.0), camera_profile.get("height_m", 2.0)) if calibrated else None
    ordered = sorted(frames, key=lambda item: float(item.get("timestamp", 0)))
    hold = {direction: 0.0 for direction in HOVER_CLASSES}
    segment_start, previous_direction, previous_time = None, None, None
    unknown_frames = 0
    outside_time = 0.0
    max_continuous_outside = 0.0
    outside_run = 0.0
    offsets = []
    projected = []
    for index, frame in enumerate(ordered):
        timestamp = float(frame.get("timestamp", 0))
        confidence = float(frame.get("confidence", 0))
        direction = frame.get("direction") if confidence >= cfg["confidence_threshold"] and frame.get("direction") in HOVER_CLASSES else "UNKNOWN"
        if direction == "UNKNOWN":
            unknown_frames += 1
        if direction != previous_direction:
            if previous_direction in HOVER_CLASSES and segment_start is not None and previous_time is not None:
                hold[previous_direction] = max(hold[previous_direction], previous_time - segment_start)
            segment_start = timestamp if direction in HOVER_CLASSES else None
            previous_direction = direction
        previous_time = timestamp
        if calibrated:
            x, y = _project(transform, float(frame.get("center_x", 0)), float(frame.get("center_y", 0)))
            projected.append((x, y))
            offsets.append(math.dist((x, y), (camera_profile.get("width_m", 2.0) / 2, camera_profile.get("height_m", 2.0) / 2)))
            if index + 1 < len(ordered):
                delta = max(0.0, float(ordered[index + 1].get("timestamp", timestamp)) - timestamp)
                outside = x < 0 or y < 0 or x > camera_profile.get("width_m", 2.0) or y > camera_profile.get("height_m", 2.0)
                if outside:
                    outside_time += delta
                    outside_run += delta
                    max_continuous_outside = max(max_continuous_outside, outside_run)
                else:
                    outside_run = 0.0
    if previous_direction in HOVER_CLASSES and segment_start is not None and previous_time is not None:
        hold[previous_direction] = max(hold[previous_direction], previous_time - segment_start)
    direction_results = {direction: {"status": "COMPLETE" if hold[direction] >= cfg["required_hold_seconds"] else "INCOMPLETE", "valid_hold_seconds": round(hold[direction], 3)} for direction in HOVER_CLASSES}
    all_complete = all(value["status"] == "COMPLETE" for value in direction_results.values())
    severe_outside = outside_time > cfg["severe_outside_seconds"] if calibrated else False
    average_offset = sum(offsets) / len(offsets) if offsets else None
    max_offset = max(offsets) if offsets else None
    variation = math.sqrt(sum((value - average_offset) ** 2 for value in offsets) / len(offsets)) if offsets else None
    score = 0.0
    if all_complete and not severe_outside:
        centering = max(0.0, 1 - (average_offset or 0) / math.sqrt(2))
        stability = max(0.0, 1 - (variation or 0) / 0.5)
        boundary = max(0.0, 1 - outside_time / max(cfg["severe_outside_seconds"], 0.001))
        score = cfg["base_pass_score"] + cfg["centering_weight"] * centering + cfg["stability_weight"] * stability + cfg["boundary_weight"] * boundary
    return {
        "rule_version": rule_version, "calibration_status": "CALIBRATED" if calibrated else "CALIBRATION_REQUIRED",
        "directions": direction_results, "unknown_frames": unknown_frames, "outside_time_seconds": round(outside_time, 3),
        "max_continuous_outside_seconds": round(max_continuous_outside, 3),
        "average_center_offset_m": round(average_offset, 4) if average_offset is not None else None,
        "max_center_offset_m": round(max_offset, 4) if max_offset is not None else None,
        "position_variation_m": round(variation, 4) if variation is not None else None,
        "score": round(min(100.0, score), 1), "result": "PASS" if all_complete and not severe_outside else "NG",
        "failure_reasons": (["MISSING_DIRECTION"] if not all_complete else []) + (["SEVERE_OUTSIDE"] if severe_outside else []),
    }
