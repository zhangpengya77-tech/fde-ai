"""POWER_INSPECTION_V1 的隔離模型與 MP4 巡檢核心。

此模組只接受已雜湊核驗的模型描述；它不在 Web 程序載入 PyTorch
checkpoint。實際推論必須由後續的隔離 worker 執行，並把每幀結果交回
``build_anomaly_timeline``。這可避免未受信任權重直接進入 Live 服務。
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4


POWER_INSPECTION_V1 = "POWER_INSPECTION_V1"
TEACHING_TRIAL = "TEACHING_TRIAL"
MODEL_ARTIFACT_SUFFIXES = {".pt", ".onnx"}
DATA_YAML_SUFFIXES = {".yaml", ".yml"}


class PowerInspectionValidationError(ValueError):
    """電力巡檢資產不符合安全契約。"""


def _utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def verify_model_manifest(manifest: dict, allowed_root: Path) -> dict:
    """核驗模型的來源、類別契約與 SHA-256，尚不載入權重。"""
    if str(manifest.get("task_type")) != POWER_INSPECTION_V1:
        raise PowerInspectionValidationError("model_task_type_invalid")
    artifact = Path(str(manifest.get("artifact_path") or ""))
    if not artifact.is_file():
        raise PowerInspectionValidationError("model_artifact_missing")
    if artifact.suffix.lower() not in MODEL_ARTIFACT_SUFFIXES:
        raise PowerInspectionValidationError("model_artifact_extension_invalid")
    if not _inside(Path(allowed_root), artifact):
        raise PowerInspectionValidationError("model_artifact_outside_allowed_root")
    expected_hash = str(manifest.get("sha256") or "").lower()
    actual_hash = _sha256_file(artifact)
    if len(expected_hash) != 64 or expected_hash != actual_hash:
        raise PowerInspectionValidationError("model_sha256_mismatch")
    classes = manifest.get("class_names")
    if not isinstance(classes, list) or not classes or any(not isinstance(item, str) or not item.strip() for item in classes):
        raise PowerInspectionValidationError("model_classes_invalid")
    name = str(manifest.get("model_name") or "").strip()
    version = str(manifest.get("version") or "").strip()
    if not name or not version:
        raise PowerInspectionValidationError("model_identity_invalid")
    return {
        "task_type": POWER_INSPECTION_V1,
        "model_name": name,
        "version": version,
        "artifact_path": str(artifact.resolve()),
        "sha256": actual_hash,
        "class_names": [item.strip() for item in classes],
        "source": str(manifest.get("source") or "unknown"),
        "verified_at": _utc_now(),
    }


def assess_model_delivery(manifest: dict, allowed_root: Path) -> dict:
    """檢查外部專案交付是否足以進入真實模型核驗。

    此函式只驗證 artifact、data.yaml 與 metadata；絕不反序列化 .pt。
    遺漏交付資料時回傳 PENDING，而明確提供但不可信的路徑或雜湊一律拒絕。
    """
    verified = verify_model_manifest(manifest, allowed_root)
    missing: list[str] = []

    data_yaml_path = str(manifest.get("data_yaml_path") or "").strip()
    data_yaml_hash = str(manifest.get("data_yaml_sha256") or "").lower()
    if not data_yaml_path or not data_yaml_hash:
        missing.append("data_yaml")
    else:
        data_yaml = Path(data_yaml_path)
        if not data_yaml.is_file():
            raise PowerInspectionValidationError("data_yaml_missing")
        if data_yaml.suffix.lower() not in DATA_YAML_SUFFIXES:
            raise PowerInspectionValidationError("data_yaml_extension_invalid")
        if not _inside(Path(allowed_root), data_yaml):
            raise PowerInspectionValidationError("data_yaml_outside_allowed_root")
        actual_data_hash = _sha256_file(data_yaml)
        if len(data_yaml_hash) != 64 or data_yaml_hash != actual_data_hash:
            raise PowerInspectionValidationError("data_yaml_sha256_mismatch")
        verified["data_yaml_path"] = str(data_yaml.resolve())
        verified["data_yaml_sha256"] = actual_data_hash

    training = manifest.get("training")
    if not isinstance(training, dict) or not str(training.get("version") or "").strip() or not str(training.get("date") or "").strip():
        missing.append("training")
    else:
        verified["training"] = {"version": str(training["version"]).strip(), "date": str(training["date"]).strip()}

    metrics = manifest.get("metrics")
    metric_names = ("precision", "recall", "map50")
    if not isinstance(metrics, dict) or any(name not in metrics for name in metric_names):
        missing.append("metrics")
    else:
        try:
            normalized_metrics = {name: float(metrics[name]) for name in metric_names}
        except (TypeError, ValueError) as exc:
            raise PowerInspectionValidationError("model_metrics_invalid") from exc
        if any(value < 0 or value > 1 for value in normalized_metrics.values()):
            raise PowerInspectionValidationError("model_metrics_invalid")
        verified["metrics"] = normalized_metrics

    independent_test = manifest.get("independent_test")
    if not isinstance(independent_test, dict) or not str(independent_test.get("report_id") or "").strip() or independent_test.get("passed") is not True:
        missing.append("independent_test")
    else:
        verified["independent_test"] = {"report_id": str(independent_test["report_id"]).strip(), "passed": True}

    inference = manifest.get("inference")
    if not isinstance(inference, dict) or "confidence" not in inference or "frame_stride" not in inference:
        missing.append("inference")
    else:
        try:
            confidence = float(inference["confidence"])
            frame_stride = int(inference["frame_stride"])
        except (TypeError, ValueError) as exc:
            raise PowerInspectionValidationError("inference_settings_invalid") from exc
        if not 0 < confidence <= 1 or frame_stride < 1:
            raise PowerInspectionValidationError("inference_settings_invalid")
        verified["inference"] = {"confidence": confidence, "frame_stride": frame_stride}

    source_license = manifest.get("source_license")
    if not isinstance(source_license, dict) or not str(source_license.get("source") or "").strip() or not str(source_license.get("license") or "").strip():
        missing.append("source_license")
    else:
        verified["source_license"] = {
            "source": str(source_license["source"]).strip(),
            "license": str(source_license["license"]).strip(),
        }

    if missing:
        return {"status": "PENDING_REAL_MODEL_VALIDATION", "missing": missing, "verified": verified}
    return {"status": "VALIDATED", "missing": [], "verified": verified}


def validate_mp4_upload(filename: str, content: bytes, *, max_bytes: int = 512 * 1024 * 1024) -> dict:
    """在寫檔前驗證 MP4 基本容器簽章；不把任意檔案當成影片。"""
    if Path(str(filename)).suffix.lower() != ".mp4":
        raise PowerInspectionValidationError("video_extension_invalid")
    if not content or len(content) > max_bytes:
        raise PowerInspectionValidationError("video_size_invalid")
    # ISO BMFF/MP4 的 major-brand box 位於 bytes 4..7；這不是完整解碼，
    # 真正可解碼性仍由隔離 worker 在資源限制下確認。
    if len(content) < 12 or content[4:8] != b"ftyp":
        raise PowerInspectionValidationError("video_container_invalid")
    return {"filename": Path(filename).name, "size_bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}


def build_anomaly_timeline(frame_results: list[dict], *, max_gap_ms: int = 1500) -> list[dict]:
    """將隔離 worker 的幀偵測結果整理成可供教師覆核的異常時間軸。"""
    events: list[dict] = []
    for frame in sorted(frame_results or [], key=lambda item: int(item.get("timestamp_ms", -1))):
        timestamp = frame.get("timestamp_ms")
        if not isinstance(timestamp, int) or timestamp < 0:
            continue
        for detection in frame.get("detections") or []:
            label = str(detection.get("class") or "").strip()
            confidence = detection.get("confidence")
            if not label or not isinstance(confidence, (int, float)) or not 0 <= float(confidence) <= 1:
                continue
            events.append({"timestamp_ms": timestamp, "class": label, "confidence": round(float(confidence), 6)})
    segments: list[dict] = []
    for event in events:
        if segments and segments[-1]["class"] == event["class"] and event["timestamp_ms"] - segments[-1]["end_ms"] <= max_gap_ms:
            current = segments[-1]
            current["end_ms"] = event["timestamp_ms"]
            current["frame_count"] += 1
            current["max_confidence"] = max(current["max_confidence"], event["confidence"])
        else:
            segments.append({
                "timeline_id": f"power-event-{uuid4().hex[:12]}",
                "class": event["class"],
                "start_ms": event["timestamp_ms"],
                "end_ms": event["timestamp_ms"],
                "frame_count": 1,
                "max_confidence": event["confidence"],
                "teacher_review": "PENDING",
            })
    return segments


class PowerInspectionRegistry:
    """隔離的 POWER_INSPECTION_V1 Registry；不讀寫既有 Vision Registry。"""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "power-inspection-registry.json"
        if not self.path.exists():
            self._write({"models": [], "audit": []})

    def _read(self) -> dict:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise PowerInspectionValidationError("power_registry_unavailable")
        if not isinstance(data, dict) or not isinstance(data.get("models"), list) or not isinstance(data.get("audit"), list):
            raise PowerInspectionValidationError("power_registry_invalid")
        return data

    def _write(self, data: dict) -> None:
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
        os.replace(temporary, self.path)

    def register_verified_model(self, verified: dict, *, teacher_subject: str) -> dict:
        if not str(teacher_subject).startswith("teacher:"):
            raise PowerInspectionValidationError("teacher_identity_required")
        data = self._read()
        duplicate = next((item for item in data["models"] if item["sha256"] == verified["sha256"]), None)
        if duplicate:
            return duplicate
        item = {
            **verified,
            "model_id": f"POWER_{uuid4().hex[:16]}",
            "status": "VALIDATED",
            "trial_cohort_ids": [],
            "created_by": teacher_subject,
            "created_at": _utc_now(),
        }
        data["models"].append(item)
        data["audit"].append({"action": "MODEL_REGISTERED", "model_id": item["model_id"], "actor": teacher_subject, "at": _utc_now()})
        self._write(data)
        return item

    def enable_teaching_trial(self, model_id: str, *, cohort_id: str, teacher_subject: str) -> dict:
        if not str(teacher_subject).startswith("teacher:") or not str(cohort_id).strip():
            raise PowerInspectionValidationError("trial_authorization_invalid")
        data = self._read()
        model = next((item for item in data["models"] if item["model_id"] == model_id), None)
        if model is None or model.get("status") not in {"VALIDATED", TEACHING_TRIAL}:
            raise PowerInspectionValidationError("model_not_eligible_for_trial")
        model["status"] = TEACHING_TRIAL
        model["trial_cohort_ids"] = sorted(set([*model.get("trial_cohort_ids", []), str(cohort_id)]))
        data["audit"].append({"action": "TEACHING_TRIAL_ENABLED", "model_id": model_id, "cohort_id": cohort_id, "actor": teacher_subject, "at": _utc_now()})
        self._write(data)
        return model

    def model_for_student(self, cohort_id: str) -> dict | None:
        data = self._read()
        for model in reversed(data["models"]):
            if model.get("status") == TEACHING_TRIAL and str(cohort_id) in model.get("trial_cohort_ids", []):
                return model
        return None

    def active_model(self, task_type: str) -> dict | None:
        # POWER_INSPECTION_V1 本階段沒有正式 ACTIVE 回退，避免跨班誤用。
        return None
