from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import os
import shutil
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from .model_health import (
    ALL_HEALTH_STATES,
    HEALTH_LOW_QUALITY,
    HEALTH_NC_MISMATCH,
    HEALTH_OK,
    HEALTH_UNKNOWN,
    HEALTH_UNTRAINED,
    ModelHealthInspectionError,
    blocking_error_code,
    describe_for_teacher,
    inspect_model_health,
    is_blocking,
    map50_threshold,
    summarize,
)


PROP_CLASSES = ("CW_F", "CCW_F", "CW_B", "CCW_B")
HOVER_CLASSES = ("FRONT", "RIGHT", "BACK", "LEFT")
MODEL_TYPES = ("PROP_DIRECTION", "FOUR_SIDE_HOVER")
MODEL_STATUSES = ("DRAFT", "VALIDATING", "VALIDATED", "CANDIDATE", "REVIEW_REQUIRED", "ACTIVE", "ARCHIVED", "REJECTED", "FAILED")
HARD_EXAMPLE_STATUSES = ("PENDING", "CONFIRMED", "CORRECTED", "REJECTED", "ADDED_TO_DATASET")
SUBMISSION_STATUSES = ("SUBMITTED", "IMPORTED", "REJECTED")
GOLDEN_SET_STATUSES = ("ACTIVE",)

MODEL_ID_PREFIX = {"PROP_DIRECTION": "PROP", "FOUR_SIDE_HOVER": "HOVER"}
# Recognised model container signatures: ZIP archive (most YOLO/PyTorch exports) or pickle.
_MODEL_SIGNATURES = (b"PK\x03\x04", b"\x80\x02", b"\x80\x03", b"\x80\x04")

# 受控放寬（2026-10-19）：只有設定檔中已登記「筆誤映射」的提交，才允許 many-to-one
# 的 6→4 類別對照。映射表集中在設定檔，不寫死在程式各處；未登記者仍走原本硬拒邏輯。
VISION_CLASS_MAPPINGS_FILE = "vision_class_mappings.json"
DEFAULT_DEDUP_IOU_THRESHOLD = 0.5

# 候選框最低信心（2026-10-20 R07 最小修復）：ultralytics 的 model.predict 預設
# conf=0.25，會連同低信心候選框一起靜默過濾，導致即使模型實際有輸出，平台仍回報
# NO_DETECTION（「模型未檢測到任何目標」）。此常數只決定「哪些候選框進入後續
# 判定」，與教師最終驗收門檻 confidence_threshold（預設 0.5）完全獨立：
# 有候選框但低於教師門檻時，仍依既有契約如實回報 LOW_CONFIDENCE，不會被標為通過。
CANDIDATE_BOX_MIN_CONF = 0.001

# 啟用與種子入庫的最低驗證信心（2026-10-23 教師指令）：
# 「驗證通過才可啟用」——除健康度 OK、類別名恰為四類、非 DEMO_IMPORTED 外，
# 還必須有真實圖片驗證通過紀錄（decision=MATCH）且最高信心 ≥ 此門檻。
# 與驗證時的 confidence_threshold（教師可調 0.05–0.95）完全獨立：教師把驗證
# 門檻調低不影響此常量。可用環境變數 FDE_ACTIVATION_MIN_CONFIDENCE 覆寫。
DEFAULT_ACTIVATION_MIN_CONFIDENCE = 0.6
_ACTIVATION_MIN_CONFIDENCE_ENV = "FDE_ACTIVATION_MIN_CONFIDENCE"


def activation_min_confidence(explicit: float | None = None) -> float:
    """啟用／種子入庫的最低驗證信心：呼叫端指定 > 環境變數 > 預設 0.6。"""
    if explicit is not None:
        return float(explicit)
    raw = os.environ.get(_ACTIVATION_MIN_CONFIDENCE_ENV, "").strip()
    if raw:
        try:
            return float(raw)
        except ValueError:
            pass
    return DEFAULT_ACTIVATION_MIN_CONFIDENCE

# 臨時類別名稱修正（2026-10-20）：部分舊模型訓練時標籤錯字（CCE-F→CCW-F、CCF-b→CCW-B）。
# 此映射在推論與取類別清單時自動套用，不影響模型權重本身。
_CLASS_NAME_CORRECTIONS = {
    "CCE-F": "CCW-F",
    "CCF-b": "CCW-B",
}

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


def apply_class_name_mapping(actual: list[str], expected: list[str], mapping, *, allow_many_to_one: bool = False) -> list[str]:
    """依教師對照表把模型實際類別名轉為任務預期名稱。

    預設要求「映滿到 expected 的雙射」（原有行為，不變）。
    `allow_many_to_one=True` 僅供受控放寬使用：允許多個實際類別名對應到同一個
    預期類別（筆誤通道合併），但仍要求每個預期類別都被覆蓋、且不得映射到
    expected 以外的名稱，避免把模型「降級」成少一類而靜默通過。

    順序以模型類別編號為準：回傳值与 actual 等長，逐項替换。
    """
    table = normalize_class_name_mapping(mapping)
    if not table:
        raise ValueError("invalid_class_name_mapping")
    if sorted(table) != sorted(actual):
        raise ValueError("invalid_class_name_mapping")
    if allow_many_to_one:
        if set(table.values()) != set(expected):
            raise ValueError("invalid_class_name_mapping")
    elif sorted(table.values()) != sorted(expected):
        raise ValueError("invalid_class_name_mapping")
    return [table[name] for name in actual]


def _demo_normalize_class(name: str) -> str:
    """DEMO 專用：把單一類別名正規化為任務預期風格，並合併筆誤通道。

    - 分隔符統一為底線（- / _ 視為相同）。
    - CCE / CCF 視為 CCW 的筆誤（與 CCW-F / CCW-B 合併為同一預期類別）。
    不改動原模型檔，純前端／匯入層別名。
    """
    s = str(name).strip().upper().replace("-", "_")
    if s.startswith("CCE") or s.startswith("CCF"):
        s = "CCW" + s[3:]
    return s


def demo_class_alias_for(actual: list[str], expected: list[str]) -> dict | None:
    """DEMO 專用：把模型實際類別名對應到任務預期類別的別名映射。

    僅當「每個實際類別都能對應」且「對應後涵蓋全部預期類別」時回傳映射；
    否則回傳 None（不強行放寬）。例如 6 類模型
    [CCE-F, CCF-b, CCW-F, CCW-B, CW-F, CW-B] 會對應成 4 類
    [CCW_F, CCW_B, CCW_F, CCW_B, CW_F, CW_B]，去重後恰為預期 4 類。
    """
    expected_set = set(expected)
    mapping: dict[str, str] = {}
    for name in actual:
        norm = _demo_normalize_class(name)
        if norm not in expected_set:
            return None
        mapping[name] = norm
    if set(mapping.values()) != expected_set:
        return None
    return mapping


def vision_class_mappings_path() -> Path:
    """設定檔位置；可用環境變數覆寫（測試或不同環境用）。"""
    override = os.environ.get("FDE_VISION_CLASS_MAPPINGS")
    if override:
        return Path(override)
    return Path(__file__).with_name(VISION_CLASS_MAPPINGS_FILE)


def load_registered_class_mappings() -> dict:
    """讀取「受控放寬」登記表；檔案缺失或格式錯誤時回傳空表（等同全部硬拒）。"""
    path = vision_class_mappings_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    submissions = data.get("submissions") if isinstance(data, dict) else None
    if not isinstance(submissions, dict):
        return {}
    return {
        str(key): dict(value)
        for key, value in submissions.items()
        if isinstance(value, dict)
    }


def registered_class_mapping(submission_id: str | None) -> dict | None:
    """取得某提交已登記的筆誤映射；未登記或設定不完整時回傳 None。"""
    if not submission_id:
        return None
    entry = load_registered_class_mappings().get(str(submission_id))
    if not entry:
        return None
    table = normalize_class_name_mapping(entry.get("name_mapping") or {})
    if not table:
        return None
    return {"mapping": table, "entry": entry}


def _box_iou(first, second) -> float:
    try:
        ax1, ay1, ax2, ay2 = [float(value) for value in first]
        bx1, by1, bx2, by2 = [float(value) for value in second]
    except (TypeError, ValueError):
        return 0.0
    inter_x1, inter_y1 = max(ax1, bx1), max(ay1, by1)
    inter_x2, inter_y2 = min(ax2, bx2), min(ay2, by2)
    intersection = max(0.0, inter_x2 - inter_x1) * max(0.0, inter_y2 - inter_y1)
    if intersection <= 0:
        return 0.0
    area_first = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_second = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_first + area_second - intersection
    return intersection / union if union > 0 else 0.0


def map_detection_classes(detections, mapping) -> list[dict]:
    """把原始偵測結果的類別名換成映射後名稱，並保留原始名稱於 class_raw。"""
    table = normalize_class_name_mapping(mapping)
    mapped = []
    for detection in detections or []:
        item = dict(detection)
        raw = str(item.get("class"))
        item["class_raw"] = raw
        item["class"] = table.get(raw, raw)
        mapped.append(item)
    return mapped


def dedupe_mapped_detections(detections, iou_threshold: float = DEFAULT_DEDUP_IOU_THRESHOLD) -> list[dict]:
    """同一映射後類別、同一個框（IoU ≥ 門檻）只留信心值最高的一筆，不重複計數。"""
    kept: list[dict] = []
    ordered = sorted(
        detections or [],
        key=lambda item: float(item.get("confidence") or 0),
        reverse=True,
    )
    for item in ordered:
        cls = str(item.get("class"))
        box = item.get("bbox") or item.get("box") or [0, 0, 0, 0]
        duplicated = any(
            str(other.get("class")) == cls
            and _box_iou(box, other.get("bbox") or other.get("box") or [0, 0, 0, 0]) >= iou_threshold
            for other in kept
        )
        if not duplicated:
            kept.append(item)
    return kept


def apply_mapping_to_detections(detections, mapping, *, iou_threshold: float = DEFAULT_DEDUP_IOU_THRESHOLD) -> tuple[list[dict], int]:
    """映射類別名並去重；回傳 (去重後偵測結果, 被合併的筆數)。"""
    mapped = map_detection_classes(detections, mapping)
    deduped = dedupe_mapped_detections(mapped, iou_threshold)
    return deduped, len(mapped) - len(deduped)


class ModelValidator(Protocol):
    def validate(self, path: Path, model_type: str) -> dict: ...


class ModelRunner(Protocol):
    def predict(self, path: Path, image_bytes: bytes) -> list[dict]: ...
    def get_names(self, path: Path) -> list[str]: ...


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
            prediction = model.predict(source=image, conf=CANDIDATE_BOX_MIN_CONF, verbose=False)[0]
            names = prediction.names
            if isinstance(names, dict):
                names = {k: _CLASS_NAME_CORRECTIONS.get(v, v) for k, v in names.items()}
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

    def get_names(self, path: Path) -> list[str]:
        """Return the model's full class-name list from model.names (cached per path).

        Used by submission-level validation so the teacher sees the model's ACTUAL
        classes (read dynamically) rather than the hardcoded PROP_CLASSES/HOVER_CLASSES.
        """
        try:
            from ultralytics import YOLO

            key = str(path)
            model = self._models.get(key)
            if model is None:
                model = YOLO(key, task="detect")
                self._models[key] = model
            names = getattr(model, "names", None)
            if isinstance(names, dict):
                names = {k: _CLASS_NAME_CORRECTIONS.get(v, v) for k, v in names.items()}
                seen = []
                for k in sorted(names):
                    if names[k] not in seen:
                        seen.append(names[k])
                return seen
            if names is not None:
                seen = []
                for v in names:
                    nv = _CLASS_NAME_CORRECTIONS.get(v, v)
                    if nv not in seen:
                        seen.append(nv)
                return seen
            return []
        except Exception:
            return []


class JsonStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "vision_center.json"
        self.data = self._load()

    @staticmethod
    def empty() -> dict:
        return {"schema_version": 1, "models": [], "datasets": [], "evaluations": [], "hard_examples": [], "camera_profiles": [], "submissions": [], "golden_sets": [], "demo_active_submissions": {}, "validations": [], "recommended_seeds": {}}

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
    def __init__(self, root: Path | str, *, model_validator: ModelValidator | None = None, model_runner: ModelRunner | None = None, max_model_bytes: int = 100 * 1024 * 1024, demo_simulation_enabled: bool = False, model_health_inspector=None, quality_gate: dict | None = None):
        self.root = Path(root)
        self.store = JsonStore(self.root)
        self.model_validator = model_validator or UltralyticsModelValidator()
        self.model_runner = model_runner or UltralyticsModelRunner()
        self.max_model_bytes = max_model_bytes
        self.demo_simulation_enabled = bool(demo_simulation_enabled)
        # 健康度檢查器（D1/D2/D3/D5/D6）：預設為真實 checkpoint 檢查；測試可注入假檢查器。
        self.model_health_inspector = model_health_inspector or inspect_model_health
        # 質量證據閘口（2026-10-21）：VALIDATED/ACTIVE 需具備評估證據（golden eval
        # map50≥門檻，或 sandbox benchmark PASS）。門檻取自設定檔，預設 0.5；
        # DEMO 環境可單獨覆寫（demo_quality_gate 區段）。quality_gate 傳入時直接覆寫
        # （供測試與部署注入），否則讀設定檔。
        self.quality_gate = self._normalize_quality_gate(quality_gate) if quality_gate is not None else self._load_quality_gate_config()
        self.model_dir = self.root / "model_registry"
        self.dataset_dir = self.root / "datasets"
        self.submission_dir = self.root / "submissions"
        self.model_dir.mkdir(parents=True, exist_ok=True)
        self.dataset_dir.mkdir(parents=True, exist_ok=True)
        self.submission_dir.mkdir(parents=True, exist_ok=True)

    # ---- 質量證據閘口（2026-10-21） ----
    def _load_quality_gate_config(self) -> dict:
        """從設定檔讀取質量閘口：預設 require_evaluation=True、map50_threshold=0.5。
        DEMO 環境（demo_simulation_enabled）改用 demo_quality_gate 區段，可單獨覆寫門檻。"""
        cfg_path = os.environ.get("FDE_VISION_CONFIG_PATH") or str(Path(__file__).resolve().parent / "vision_center_config.json")
        data: dict = {}
        try:
            data = json.loads(Path(cfg_path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        base = data.get("quality_gate") or {}
        section = data.get("demo_quality_gate") if self.demo_simulation_enabled else data.get("quality_gate")
        if not isinstance(section, dict):
            section = base
        merged = {**base, **(section or {})}
        return {
            "require_evaluation": bool(merged.get("require_evaluation", True)),
            "map50_threshold": float(merged.get("map50_threshold", map50_threshold())),
        }

    @staticmethod
    def _normalize_quality_gate(cfg: dict) -> dict:
        """把外部注入的 quality_gate 正規化（缺安全預設：require_evaluation=True、門檻取模型健康度預設）。"""
        cfg = cfg or {}
        return {
            "require_evaluation": bool(cfg.get("require_evaluation", True)),
            "map50_threshold": float(cfg.get("map50_threshold", map50_threshold())),
        }

    def _quality_gate_passes(self, model: dict) -> tuple[bool, str | None]:
        """判斷模型是否具備 VALIDATED/ACTIVE 所需的質量證據。

        通過條件（擇一）：
          (a) sandbox benchmark 狀態為 PASS；或
          (b) golden eval 已完成（evaluation_status==EVALUATED）且 map50 ≥ 門檻。
        返回 (是否通過, 未通過原因)。未通過原因供清單/降級記錄顯示。
        """
        cfg = self.quality_gate
        if not cfg["require_evaluation"]:
            return True, None
        # (a) Benchmark PASS
        if model.get("benchmark_status") == "PASS":
            return True, None
        # (b) Golden eval 具備 mAP50 證據
        if model.get("evaluation_status") == "EVALUATED":
            metrics = model.get("metrics") or {}
            map50 = float(metrics.get("map50", 0) or 0)
            if map50 >= cfg["map50_threshold"]:
                return True, None
            return False, f"mAP50={map50} 低於門檻 {cfg['map50_threshold']}"
        # 未評估：需明確提示要先有 golden set 評估（或 sandbox benchmark PASS），不是無聲失敗。
        return False, "無評估證據，僅類別名稱吻合（需 golden set 評估或 sandbox benchmark PASS）"

    def _apply_quality_gate(self, record: dict) -> None:
        """依質量證據閘口決定 record 的 validation_status/status/review_reason。

        類別契約已通過（呼叫前已確認 actual 與 expected 對應）才會進入此函式；
        此處只決定「是否足以標記為 VALIDATED」——不足者標 REVIEW_REQUIRED，
        不得 VALIDATED、不得 ACTIVE。
        """
        passed, reason = self._quality_gate_passes(record)
        if passed:
            record.update(validation_status="VALIDATED", status="VALIDATED", review_reason="")
        else:
            record.update(
                validation_status="REVIEW_REQUIRED", status="REVIEW_REQUIRED",
                review_reason=reason or "無評估證據，僅類別名稱吻合（需 golden set 評估或 sandbox benchmark PASS）",
            )

    def infer_active(self, model_type: str, image_bytes: bytes) -> tuple[dict, list[dict]]:
        model = self.active_model(model_type)
        if model is None:
            raise ModelValidationError("active_model_required")
        if not image_bytes:
            raise ModelValidationError("image_required")
        detections = self.model_runner.predict(Path(model["file_path"]), image_bytes)
        detections, _mapping_info = self._apply_recorded_mapping(model, detections)
        return model, detections

    @staticmethod
    def _apply_recorded_mapping(model: dict, detections: list[dict]) -> tuple[list[dict], dict]:
        """把模型紀錄中已存的類別對照套用到偵測結果，並依映射後類別去重。

        未記錄對照表（正常 4 類模型）時原樣回傳，行為與修改前完全一致。
        """
        mapping = normalize_class_name_mapping(model.get("class_name_mapping") or {})
        if not mapping:
            return [dict(item) for item in detections or []], {"mapping_applied": False}
        deduped, removed = apply_mapping_to_detections(detections or [], mapping)
        return deduped, {
            "mapping_applied": True,
            "mapping_source": model.get("class_name_mapping_source") or "recorded",
            "temporary_mapping": bool(model.get("temporary_mapping")),
            "temporary_mapping_label": model.get("temporary_mapping_label") or "",
            "class_name_mapping": mapping,
            "deduped_count": removed,
        }

    # ---- Teacher single-image validation against one specific model ----
    def validate_image_with_model(
        self, model_id: str, image_bytes: bytes,
        *, expected_class: str | None = None, confidence_threshold: float = 0.5,
        rule_version: str | None = None, image_width: float | None = None,
        image_height: float | None = None, validated_by: str = "",
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
        # 動態讀取模型實際類別：優先用模型紀錄已存的 class_names，
        # 否則直接從 .pt 頭讀取。不再寫死 PROP_CLASSES / HOVER_CLASSES（見第 4 步）。
        classes = list(model.get("class_names") or [])
        if not classes:
            classes = self.model_runner.get_names(path)
        detections = self.model_runner.predict(path, image_bytes)
        # 映射版模型：套用紀錄中的類別對照並去重，否則畫面會顯示原始筆誤名稱。
        detections, mapping_info = self._apply_recorded_mapping(model, detections)
        best = max(detections, key=lambda item: item.get("confidence", 0), default=None)
        max_confidence = max((float(d.get("confidence", 0)) for d in detections), default=None)
        verdict = {
            "rule_version": rule_version or (PROP_RULE_VERSION if model_type == "PROP_DIRECTION" else HOVER_RULE_VERSION),
            "predicted_class": best.get("class") if best else None,
            "predicted_confidence": round(float(best.get("confidence", 0)), 6) if best else None,
            "max_confidence": round(max_confidence, 6) if max_confidence is not None else None,
            "expected_class": expected_class,
            "confidence_threshold": float(confidence_threshold),
            "decision": "INSUFFICIENT_DATA",
            "reason": "模型未偵測到任何目標（無框）。",
            "reason_code": "NO_DETECTION",
        }
        if best is None:
            pass
        elif float(best.get("confidence", 0)) < float(confidence_threshold):
            mc = round(float(best.get("confidence", 0)), 6)
            verdict.update(
                decision="INSUFFICIENT_DATA",
                reason=f"信心過低：最高信心 {mc} < 門檻 {confidence_threshold}，不足以判定。",
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
        result = {
            "model": {
                "model_id": model["model_id"], "model_type": model_type,
                "model_name": model.get("model_name", ""), "version": model.get("version", ""),
                "status": model.get("status"), "validation_status": model.get("validation_status"),
                "file_hash": model.get("file_hash"), "class_names": classes,
                "temporary_mapping": bool(model.get("temporary_mapping")),
                "temporary_mapping_label": model.get("temporary_mapping_label") or "",
            },
            "detections": detections,
            "detection_count": len(detections),
            "max_confidence": round(max_confidence, 6) if max_confidence is not None else None,
            "mapping": mapping_info,
            "verdict": verdict,
            "image_width": image_width,
            "image_height": image_height,
            "validated_at": utc_now(),
        }
        # 2026-10-23 教師指令：真實圖片驗證紀錄持久化到 store（啟用與種子入庫的
        # 依據）。只有 decision=MATCH 且最高信心達標才算「驗證通過」；此寫入
        # 不改變模型狀態、不切換 ACTIVE，純粹是證據留存（append-only，上限 200 筆）。
        self._remember_validation(
            model_id=model["model_id"], model_type=model_type,
            decision=verdict.get("decision") or "",
            max_confidence=result["max_confidence"],
            expected_class=expected_class,
            confidence_threshold=float(confidence_threshold),
            validated_by=str(validated_by or ""),
            reason_code=verdict.get("reason_code") or "",
        )
        return result

    # ---- Teacher single-image validation against one SUBMITTED submission (pre-import) ----
    def validate_image_with_submission(
        self, submission_id: str, image_bytes: bytes,
        *, expected_class: str | None = None, confidence_threshold: float = 0.5,
        rule_version: str | None = None, image_width: float | None = None,
        image_height: float | None = None,
    ) -> dict:
        """Run REAL inference with a SUBMITTED (not-yet-imported) submission's .pt.

        This is the missing piece that lets a teacher verify a student submission
        BEFORE it is imported/enabled: it loads the raw .pt from
        submissions/<type>/<submission_id>/submission.pt directly, runs inference,
        and returns detections with the model's ACTUAL class names (read dynamically
        from model.names — never from the hardcoded PROP_CLASSES/HOVER_CLASSES).

        Read-only: does not mutate submission status and does NOT require the model
        to be imported/enabled. A SUBMITTED submission is sufficient, which is exactly
        the state ``sub-5d87f027`` (and any freshly uploaded student model) is in.
        """
        submission = self._find("submissions", "submission_id", submission_id)
        if not image_bytes:
            raise ModelValidationError("image_required")
        path = Path(submission["file_path"])
        if not path.exists() or not os.access(str(path), os.R_OK):
            raise ModelValidationError("model_file_unreadable")
        model_type = submission["task_id"]
        # Dynamic class names straight from the model head — no hardcoded constants.
        classes = self.model_runner.get_names(path)
        # 第 4 步：把模型實際類別名／數量記錄到提交紀錄（僅 metadata，
        # 不改變 SUBMITTED 狀態、不動匯入閘門）。
        if classes:
            submission.update(class_names=classes, class_count=len(classes))
            self.store.save()
        detections = self.model_runner.predict(path, image_bytes)
        # 受控放寬：僅對設定檔中已登記「筆誤映射」的提交套用 6→4 對照並去重。
        # 未登記者原樣回報模型實際類別名——不猜、不自動映射、不改任何狀態。
        registered = registered_class_mapping(submission_id)
        if registered:
            detections, deduped = apply_mapping_to_detections(detections, registered["mapping"])
            mapping_info = {
                "mapping_applied": True,
                "mapping_source": "registered_typo_mapping",
                "temporary_mapping": True,
                "temporary_mapping_label": "映射版·臨時",
                "class_name_mapping": registered["mapping"],
                "class_name_mapping_note": str(registered["entry"].get("reason") or ""),
                "deduped_count": deduped,
            }
        else:
            mapping_info = {"mapping_applied": False}
        best = max(detections, key=lambda item: item.get("confidence", 0), default=None)
        max_confidence = max((float(d.get("confidence", 0)) for d in detections), default=None)
        verdict = {
            "rule_version": rule_version or (PROP_RULE_VERSION if model_type == "PROP_DIRECTION" else HOVER_RULE_VERSION),
            "predicted_class": best.get("class") if best else None,
            "predicted_confidence": round(float(best.get("confidence", 0)), 6) if best else None,
            "max_confidence": round(max_confidence, 6) if max_confidence is not None else None,
            "expected_class": expected_class,
            "confidence_threshold": float(confidence_threshold),
            "decision": "INSUFFICIENT_DATA",
            "reason": "模型未偵測到任何目標（無框）。",
            "reason_code": "NO_DETECTION",
        }
        if best is None:
            pass
        elif float(best.get("confidence", 0)) < float(confidence_threshold):
            mc = round(float(best.get("confidence", 0)), 6)
            verdict.update(
                decision="INSUFFICIENT_DATA",
                reason=f"信心過低：最高信心 {mc} < 門檻 {confidence_threshold}，不足以判定。",
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
            "submission_id": submission_id,
            "model": {
                "model_id": None,
                "submission_id": submission_id,
                "model_type": model_type,
                "model_name": submission.get("original_filename", ""),
                "version": "",
                "status": submission.get("status"),
                "validation_status": None,
                "file_hash": submission.get("file_hash"),
                "class_names": classes,
                "temporary_mapping": bool(mapping_info.get("temporary_mapping")),
                "temporary_mapping_label": mapping_info.get("temporary_mapping_label") or "",
            },
            "detections": detections,
            "detection_count": len(detections),
            "max_confidence": round(max_confidence, 6) if max_confidence is not None else None,
            "mapping": mapping_info,
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
        items = [
            self._attach_health(dict(item))
            for item in self.store.data["models"]
            if item["model_type"] == model_type
        ]
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
            # 模型管理（M1，2026-10-21）：教師手動歸檔的模型不得成為回滾目標，
            # 避免「不理想模型」被一鍵回滾意外復活。系統自動歸檔（啟用新版本時
            # 被頂替的舊 ACTIVE）沒有 archived_via 標記，仍可作為回滾目標。
            and item.get("archived_via") != "teacher"
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
        # 隔離（quarantine）記錄不進列表，但記錄與檔案都保留、可用 get_model 直接取回，
        # 並可用 demo/tools/restore_quarantine.py 還原（2026-10-19 孤兒清理）。
        # D3/D5（2026-10-20）：每筆回傳附帶健康度徽章與 mAP50、pass_eligible，
        # 讓教師清單與驗證下拉直接顯示「未訓練／低品質／正常」與 PASS 條件。
        return [
            self._attach_health(item)
            for item in self.store.data["models"]
            if (model_type is None or item["model_type"] == model_type)
            and not item.get("quarantined")
        ]

    def get_model(self, model_id: str) -> dict:
        return self._attach_health(self._find("models", "model_id", model_id))

    # ---- 模型健康度（D1/D3/D5/D6，2026-10-20） ----
    def _inspect_health(self, path) -> dict:
        """呼叫健康度檢查器；檔案不可讀時視為 UNKNOWN（不阻擋，僅標示無法判定）。"""
        try:
            return dict(self.model_health_inspector(path))
        except ModelHealthInspectionError:
            return {"health": HEALTH_UNKNOWN, "reasons": ["model_file_unreadable"]}

    def _attach_health(self, record: dict) -> dict:
        """給一份模型紀錄附帶健康度摘要（優先用匯入時已存的事實，否則當場計算）。"""
        record = dict(record)
        if record.get("health") in ALL_HEALTH_STATES:
            facts = {
                "health": record.get("health"),
                "reasons": list(record.get("health_reasons") or []),
                "map50": record.get("health_map50"),
                "nc": record.get("health_nc"),
                "names_count": record.get("health_names_count"),
                "map50_threshold": record.get("health_threshold") or map50_threshold(),
                # 訓練痕跡事實（S3 顯示「有無訓練痕跡」用）：取匯入時已存檔的標記。
                "has_train_args": bool(record.get("health_has_train_args")),
                "has_epoch": bool(record.get("health_has_epoch")),
                "has_metrics": bool(record.get("health_has_metrics")),
                # 關鍵：class_names 是匯入時正規化的業務欄位，絕不可被健康度摘要覆寫為 []。
                "class_names": list(record.get("class_names") or []),
            }
        else:
            facts = self._inspect_health(record.get("file_path"))
        record.update(summarize(facts))
        record["pass_eligible"] = self._pass_eligible(record)
        # 2026-10-23 教師指令：啟用資格（health OK＋驗證通過且最高信心≥0.6＋
        # 類別名恰為四類＋非 DEMO_IMPORTED）由 Live 端統一判定，UI 只讀結果，
        # 保證「按鈕不出來」與「後端拒絕」永遠同一套標準。
        try:
            eligible, block_reason, block_detail = self._activation_eligibility(record)
        except (OSError, ValueError):
            eligible, block_reason, block_detail = False, "model_file_unreadable", "模型檔案不存在或不可讀。"
        record["activation_eligible"] = eligible
        record["activation_block_reason"] = block_reason
        record["activation_block_detail"] = block_detail
        record["activation_min_confidence"] = activation_min_confidence()
        record["validation_pass_confidence"] = self.validation_pass_confidence(
            record.get("model_id") or ""
        )
        # S3（2026-10-21）：模型清單健康度顯示「有無訓練痕跡」派生欄位，
        # 讓教師清單直接標示該模型是否帶有 train_args／epoch／metrics 訓練痕跡。
        record["has_training_trace"] = bool(
            record.get("has_train_args") or record.get("has_epoch") or record.get("has_metrics")
        )
        record["training_trace_label"] = "有訓練痕跡" if record["has_training_trace"] else "無訓練痕跡"
        return record

    def _pass_eligible(self, record: dict) -> bool:
        """D5（2026-10-20）：PASS 判定補強——清單層面以 health==OK 為「可通過」必要條件。
        低品質（如 80fd81）與未訓練模型清單顯示「PASS 條件不符，需覆核」。
        實際驗證信心≥門檻的判定在驗證結果頁與啟用閘門強制。"""
        return record.get("health") == HEALTH_OK

    def active_model(self, model_type: str) -> dict | None:
        found = next((item for item in self.store.data["models"] if item["model_type"] == model_type and item["status"] == "ACTIVE"), None)
        return dict(found) if found else None

    def upload_model(self, *, model_type: str, model_name: str, version: str, content: bytes, dataset_id: str, dataset_version: str, rule_version: str, uploaded_by: str, notes: str = "", source_group: str | None = None, source_submission_id: str | None = None, source_student_id: str | None = None, class_name_mapping=None, demo_relaxed: bool = False) -> dict:
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
            "file_path": str(path), "file_hash": file_hash, "file_size": file_size, "class_names": [], "class_count": 0,
            "source_group": None if source_group is None else str(source_group).strip(),
            "source_submission_id": source_submission_id, "source_student_id": source_student_id, "dataset_id": dataset_id,
            "dataset_version": dataset_version, "rule_version": str(rule_version).strip(), "uploaded_by": uploaded_by,
            "uploaded_at": utc_now(), "validation_status": "VALIDATING", "evaluation_status": "NOT_EVALUATED",
            "metrics": {}, "status": "VALIDATING", "notes": notes,
        }
        self.store.data["models"].append(record)
        self._write_manifest(model_dir_for_model, record)
        self.store.save()
        # D1/D2（2026-10-20）：模型健康度檢查並作為匯入閘門。讀 checkpoint 內部事實判定四態；
        # 未訓練（UNTRAINED）或類別數不符（NC_MISMATCH）在正式環境直接拒絕，
        # DEMO 環境放行但標記 DEMO_IMPORTED，不得進入 ACTIVE。
        facts = self._inspect_health(path)
        record.update(
            health=facts["health"], health_reasons=facts.get("reasons") or [],
            health_map50=facts.get("map50"), health_nc=facts.get("nc"),
            health_names_count=facts.get("names_count"),
            health_threshold=facts.get("map50_threshold"),
            # 訓練痕跡事實（S3 顯示「有無訓練痕跡」用）：匯入時即存檔，避免被健康度摘要覆寫。
            health_has_train_args=bool(facts.get("has_train_args")),
            health_has_epoch=bool(facts.get("has_epoch")),
            health_has_metrics=bool(facts.get("has_metrics")),
        )
        if is_blocking(facts):
            code = blocking_error_code(facts)
            if demo_relaxed:
                record.update(
                    validation_status="DEMO_IMPORTED", status="DEMO_IMPORTED",
                    demo_class_relaxed=True, demo_health_blocked=True,
                    notes=(notes + "\n[DEMO 健康度放行] 模型健康度為 " + facts["health"] + "，僅供 DEMO 展示，不得啟用。").strip(),
                )
                self._write_manifest(model_dir_for_model, record)
                self.store.save()
                return self._attach_health(record)
            # 正式環境：明確拒絕並將紀錄標為 REJECTED（與類別數不符路徑一致），
            # 避免留下 VALIDATING 殘檔。
            record.update(
                validation_status="REJECTED", status="REJECTED",
                notes=(notes + f"\n[健康度拒絕] {code}：{describe_for_teacher(facts)}").strip(),
            )
            self._write_manifest(model_dir_for_model, record)
            self.store.save()
            raise ModelValidationError(code)
        try:
            details = self.model_validator.validate(path, model_type)
            expected = list(PROP_CLASSES if model_type == "PROP_DIRECTION" else HOVER_CLASSES)
            if details.get("task") != "detect":
                raise ModelValidationError("model_must_be_detection_model")
            actual = [str(name) for name in (details.get("class_names") or [])]
            # 第 4 步：記錄模型實際類別數（不依賴類別含義，不影響匯入閘門）。
            record["class_count"] = len(actual)
            if not actual:
                # 教師指令③：names 為空不直接駁回——拋出可識別的缺少類別名錯誤。
                raise ModelClassNamesMissingError(model_type)
            # S2（2026-10-21）：匯入時顯式拒絕分類頭 nc 與 class_names 長度不符的模型。
            # 即便健康度檢查器未將其歸類為 NC_MISMATCH（例如 inspector 回傳 OK，
            # 但 nc 與實際類別名數量不一致），VisionCenter 仍須在此攔截，
            # 避免類別契約不可信的模型被納入倉庫。DEMO 環境則放行為 DEMO_IMPORTED，
            # 與未訓練模型的處理一致（不標記 VALIDATED、不得啟用）。
            health_nc = facts.get("nc")
            if health_nc is not None and health_nc != len(actual):
                base_note = notes + f"\n[分類頭不符] 模型偵測頭 nc={health_nc} 與類別名數量 {len(actual)} 不一致，類別契約不可信。"
                if demo_relaxed:
                    record.update(
                        validation_status="DEMO_IMPORTED", status="DEMO_IMPORTED",
                        health=HEALTH_NC_MISMATCH, health_reasons=["nc_mismatch"],
                        demo_class_relaxed=True, demo_health_blocked=True,
                        notes=base_note.strip() + " 僅供 DEMO 展示，不得啟用。",
                    )
                    self._write_manifest(model_dir_for_model, record)
                    self.store.save()
                    return self._attach_health(record)
                record.update(
                    validation_status="REJECTED", status="REJECTED",
                    health=HEALTH_NC_MISMATCH, health_reasons=["nc_mismatch"],
                    notes=base_note.strip(),
                )
                self._write_manifest(model_dir_for_model, record)
                self.store.save()
                raise ModelValidationError("model_nc_mismatch")
            if actual == expected:
                record.update(class_names=expected, class_count=len(expected))
                # 質量證據閘口（2026-10-21）：類別名吻合只是必要條件，VALIDATED 還須
                # 具備評估證據（golden eval map50≥門檻 或 sandbox benchmark PASS）；
                # 否則標 REVIEW_REQUIRED，不得 VALIDATED、不得 ACTIVE。
                self._apply_quality_gate(record)
            elif demo_relaxed and class_name_mapping:
                # DEMO 放寬匯入：套用筆誤別名對應，但「不」標記 VALIDATED、
                # 「不」納入 ACTIVE 閘門——DEMO 結果不得被視為已驗證或已啟用。
                try:
                    normalized = apply_class_name_mapping(actual, expected, class_name_mapping, allow_many_to_one=True)
                except ValueError as exc:
                    raise ModelValidationError("model_class_names_mismatch") from exc
                effective = [name for name in expected if name in set(normalized)]
                record.update(
                    class_names=effective, class_count=len(effective), class_count_raw=len(actual),
                    validation_status="DEMO_IMPORTED", status="DEMO_IMPORTED",
                    class_name_mapping=normalize_class_name_mapping(class_name_mapping),
                    class_name_mapping_source="demo_class_alias",
                    class_name_mapping_note="DEMO 類別放寬：CCE/CCF 筆誤別名對應到 CCW（僅 DEMO，不影響正式模型）",
                    temporary_mapping=True,
                    temporary_mapping_label="DEMO·類別放寬",
                    demo_class_relaxed=True,
                )
            elif registered_class_mapping(source_submission_id):
                # 受控放寬（2026-10-19）：僅限設定檔已登記「筆誤映射」的提交。
                # 允許 many-to-one，但映射表必須來自設定檔，不接受呼叫端臨時拼湊。
                registered = registered_class_mapping(source_submission_id)
                try:
                    normalized = apply_class_name_mapping(actual, expected, registered["mapping"], allow_many_to_one=True)
                except ValueError as exc:
                    raise ModelValidationError("registered_class_mapping_stale") from exc
                entry = registered["entry"]
                # 映射後的有效類別集是「去重後的 4 類」，不是原始 6 個通道；
                # 原始通道數另存 class_count_raw 以便追溯。
                effective = [name for name in expected if name in set(normalized)]
                record.update(
                    class_names=effective, class_count=len(effective),
                    class_count_raw=len(actual),
                    class_name_mapping=registered["mapping"],
                    class_name_mapping_source="registered_typo_mapping",
                    class_name_mapping_note=str(entry.get("reason") or ""),
                    temporary_mapping=True,
                    temporary_mapping_label="映射版·臨時",
                    temporary_mapping_registered_at=entry.get("registered_at"),
                )
                # 質量證據閘口（2026-10-21）：受控映射也須通過評估證據才 VALIDATED。
                self._apply_quality_gate(record)
            elif len(actual) != len(expected):
                raise ModelValidationError("model_class_names_mismatch")
            elif not class_name_mapping:
                # 教師指令③：數量一致、名稱不同 → 要求對照表，而不是直接駁回。
                raise ModelClassNamesMappingRequiredError(model_type, actual, expected)
            else:
                normalized = apply_class_name_mapping(actual, expected, class_name_mapping)
                record.update(class_names=normalized, class_count=len(normalized),
                              class_name_mapping=normalize_class_name_mapping(class_name_mapping))
                # 質量證據閘口（2026-10-21）：教師對照表正規化後同樣須通過評估證據才 VALIDATED。
                self._apply_quality_gate(record)
            if details.get("smoke_inference") is not True:
                raise ModelValidationError("smoke_inference_failed")
            self._write_manifest(model_dir_for_model, record)
            self.store.save()
            return self._attach_health(record)
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
        model.update(evaluation_status="EVALUATED", metrics=dict(metrics))
        # 質量證據閘口（2026-10-21）：golden eval 完成後重新判定——map50≥門檻→VALIDATED
        # （可啟用），低於門檻→REVIEW_REQUIRED（附帶具體差距，不得啟用）。
        self._apply_quality_gate(model)
        model_dir = Path(model["file_path"]).parent
        (model_dir / "evaluation.json").write_text(json.dumps(evaluation, ensure_ascii=False, indent=2), encoding="utf-8")
        (model_dir / "metrics.json").write_text(json.dumps(dict(metrics), ensure_ascii=False, indent=2), encoding="utf-8")
        self._write_manifest(model_dir, model)
        self.store.save()
        return dict(evaluation)

    def list_evaluations(self, model_id: str | None = None) -> list[dict]:
        return [dict(item) for item in self.store.data["evaluations"] if model_id is None or item["model_id"] == model_id]

    # ---- 真實圖片驗證紀錄與啟用資格（2026-10-23 教師指令） ----
    def _remember_validation(self, *, model_id: str, model_type: str, decision: str,
                             max_confidence, expected_class, confidence_threshold: float,
                             validated_by: str, reason_code: str = "") -> None:
        """把一次真實圖片驗證結果追加到 store（append-only，上限 200 筆）。

        只記錄事實（模型、判定、最高信心、門檻、操作者、時間），不改變模型狀態。
        """
        record = {
            "validation_id": f"val-{uuid4().hex[:12]}",
            "model_id": model_id,
            "model_type": model_type,
            "decision": decision,
            "reason_code": reason_code,
            "max_confidence": max_confidence,
            "expected_class": expected_class,
            "confidence_threshold": confidence_threshold,
            "validated_by": str(validated_by or ""),
            "validated_at": utc_now(),
            "evidence_source": "REAL_INFERENCE",
        }
        records = self.store.data.setdefault("validations", [])
        records.insert(0, record)
        del records[200:]
        self.store.save()

    def validation_records_for(self, model_id: str) -> list[dict]:
        """該模型的真實圖片驗證紀錄（最新在前）。"""
        return [
            dict(item) for item in self.store.data.get("validations", [])
            if item.get("model_id") == model_id
            and item.get("evidence_source", "REAL_INFERENCE") == "REAL_INFERENCE"
        ]

    def best_passing_validation(self, model_id: str) -> dict | None:
        """最高信心的「驗證通過」（decision=MATCH）紀錄；沒有則回傳 None。"""
        passing = [
            item for item in self.validation_records_for(model_id)
            if item.get("decision") == "MATCH"
        ]
        if not passing:
            return None
        return max(
            passing,
            key=lambda item: float(item.get("max_confidence") or 0),
        )

    def validation_pass_confidence(self, model_id: str) -> float | None:
        """驗證通過紀錄的最高信心；沒有通過紀錄回傳 None。"""
        best = self.best_passing_validation(model_id)
        if best is None or best.get("max_confidence") is None:
            return None
        return float(best["max_confidence"])

    @staticmethod
    def _expected_class_names(model_type: str) -> list[str]:
        """任務的規範類別名（恰好四個，順序固定）。"""
        return list(PROP_CLASSES if model_type == "PROP_DIRECTION" else HOVER_CLASSES)

    def _activation_eligibility(self, model: dict) -> tuple[bool, str, str]:
        """啟用資格（2026-10-23 教師指令）：全部滿足才可啟用，任一不滿足給原因碼。

        a. health = OK（nc 與類別名一致、有訓練痕跡、mAP50 ≥ 門檻，門檻不降）
        b. 有真實圖片驗證通過紀錄，且最高信心 ≥ activation_min_confidence()（0.6）
        c. 類別名恰好為 CW_F / CCW_F / CW_B / CCW_B（FOUR_SIDE_HOVER 為其規範四類）
        d. 非 DEMO_IMPORTED、非 quarantined、.pt 可讀；REJECTED 一律不得啟用；
           質量證據閘口（2026-10-21）的 REVIEW_REQUIRED 亦不得啟用

        回傳 (是否合格, 原因碼, 人類可讀細節)。原因碼供 API 與 UI 一致呈現。
        """
        # d-① 隔離（硬攔）
        if model.get("quarantined"):
            return False, "model_quarantined", "模型已被隔離，不得啟用。"
        # d-② .pt 必須存在且可讀（硬攔）
        path = Path(model.get("file_path") or "")
        if not path.exists() or not os.access(str(path), os.R_OK):
            return False, "model_file_unreadable", "模型檔案不存在或不可讀。"
        # d-③ 被駁回的紀錄一律不得啟用
        if model.get("status") == "REJECTED" or model.get("validation_status") == "REJECTED":
            return False, "model_rejected", "模型已被駁回，不得啟用。"
        # d-④ DEMO 放寬匯入不得啟用（與正式匯入不同路）
        if model.get("validation_status") == "DEMO_IMPORTED" or model.get("status") == "DEMO_IMPORTED":
            return False, "model_demo_imported_not_allowed", "DEMO 放寬匯入的模型不得啟用，請用正確四類資料重新訓練後匯入。"
        # d-⑤ 質量證據閘口（2026-10-21 教師指令）：無評估證據／map50 低於門檻的
        # REVIEW_REQUIRED 一律不得啟用（_apply_quality_gate 亦註明「不得 ACTIVE」）。
        # A 硬規則（2026-10-23）在其之上疊加圖片驗證要求，兩者皆為硬門檻。
        if model.get("validation_status") == "REVIEW_REQUIRED" or model.get("status") == "REVIEW_REQUIRED":
            return False, "model_review_required", "模型尚無足夠質量證據（REVIEW_REQUIRED：需 golden set 評估達標或 sandbox benchmark PASS），不得啟用。"
        # a. health = OK（優先用匯入時已存事實，缺失時當場檢查）
        health = model.get("health")
        if health not in ALL_HEALTH_STATES:
            facts = self._inspect_health(model.get("file_path"))
            health = facts.get("health")
            model = dict(model)
            model.update(summarize(facts))
        if health != HEALTH_OK:
            return False, "model_health_not_ok", "模型健康度不是 OK（%s），不滿足啟用條件。" % (health or "無法判定")
        # c. 類別名恰好為規範四類
        expected = self._expected_class_names(model.get("model_type") or "")
        actual = [str(name) for name in (model.get("class_names") or [])]
        if sorted(actual) != sorted(expected):
            return False, "model_class_names_invalid", "模型類別名必須恰好為 %s，實際為 %s。" % ("/".join(expected), "/".join(actual) or "（無）")
        # b. 真實圖片驗證通過且最高信心 ≥ 門檻
        threshold = activation_min_confidence()
        confidence = self.validation_pass_confidence(model.get("model_id") or "")
        if confidence is None:
            return False, "model_validation_required", "尚未通過圖片驗證（需有預測相符的真實推論紀錄）。"
        if confidence < threshold:
            return False, "model_validation_confidence_too_low", "驗證通過紀錄的最高信心 %.4f 低於啟用門檻 %.2f。" % (confidence, threshold)
        return True, "", ""

    def activate_model(self, model_id: str, activated_by: str, override: bool = False) -> dict:
        """Promote a validated model to ACTIVE for its task.

        The returned object stays the model record itself (existing API contract), with
        switch facts attached under `activation`. Order of operations is deliberate: the
        new model is proven present on disk BEFORE the previous ACTIVE is archived, so a
        failed switch leaves the task on its original model rather than with no model.

        啟用資格（2026-10-23 教師指令，「驗證通過才可啟用」硬規則）——全部滿足：
          a. health = OK（nc 與類別名一致、有訓練痕跡、mAP50 ≥ 門檻，門檻不降）
          b. 有真實圖片驗證通過紀錄，且最高信心 ≥ 0.6（ACTIVATION_MIN_CONFIDENCE）
          c. 類別名恰好為 CW_F / CCW_F / CW_B / CCW_B（HOVER 任務為其規範四類）
          d. 非 DEMO_IMPORTED、非 quarantined、.pt 可讀；REJECTED 不得啟用
        任一不滿足 → 拋出可追溯錯誤碼（model_health_not_ok /
        model_validation_required / model_validation_confidence_too_low /
        model_class_names_invalid / model_demo_imported_not_allowed /
        model_quarantined / model_file_unreadable / model_rejected）。

        教師覆寫路徑已撤銷（2026-10-23）：`override=True` 一律拒絕
        （teacher_override_disabled）——「不符合要求」不再能靠覆寫放行。
        """
        if override:
            # 覆寫路徑已撤銷：即使呼叫端明確帶 override=true 也一律拒絕，
            # 不留靜音放行的後門。
            raise ValueError("teacher_override_disabled")
        model = self._find("models", "model_id", model_id)
        path = Path(model.get("file_path") or "")
        # ---- 硬攔①：隔離模型一律不得啟用 ----
        if model.get("quarantined"):
            raise ValueError("model_quarantined")
        # ---- 硬攔②：.pt 必須存在且可讀 ----
        if not path.exists() or not os.access(str(path), os.R_OK):
            raise ValueError("model_file_unreadable")

        if model["status"] == "ACTIVE":
            # 冪等：已啟用就直接回報（資格檢查仍適用於「新的」啟用動作）。
            model["activation"] = {
                "previous_active_model_id": None,
                "already_active": True,
                "inference_source": self.verify_active_model_inference(model["model_type"]),
                "overridden_gates": [],
            }
            return self._attach_health(model)

        eligible, reason_code, detail = self._activation_eligibility(model)
        if not eligible:
            raise ValueError(reason_code)
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
            "overridden_gates": [],
            "validation_confidence": self.validation_pass_confidence(model["model_id"]),
            "activation_min_confidence": activation_min_confidence(),
        }
        return self._attach_health(result)

    # ---- 模型管理（歸檔／還原／永久刪除，教師指令 2026-10-21） ----
    def _guard_model_manageable(self, model: dict) -> None:
        """M4 後端硬攔：不理想模型才可歸檔／刪除，以下兩種一律拒絕。

        - ACTIVE：正在服務推論的模型，保護推論鏈不中斷（003fe6 等不得操作）；
        - VALIDATING（status 或 validation_status）：驗證仍在進行中，
          此時歸檔／刪除會讓驗證結果失去落點。

        錯誤碼可追溯，不依賴前端隱藏按鈕。
        """
        if model.get("status") == "ACTIVE":
            raise ModelValidationError("model_active_cannot_manage")
        if model.get("status") == "VALIDATING" or model.get("validation_status") == "VALIDATING":
            raise ModelValidationError("model_validation_in_progress")

    def _backup_store(self, op: str, model_id: str) -> dict:
        """M7：操作前自動備份 store（JSON），回傳備份路徑與 SHA256。"""
        stamp = utc_now().replace(":", "").replace(".", "-")
        backup_dir = self.root / "backups" / f"{stamp}-{op}-{model_id}"
        backup_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(self.store.path, backup_dir / "vision_center.json")
        digest = hashlib.sha256((backup_dir / "vision_center.json").read_bytes()).hexdigest()
        return {"backup_path": str(backup_dir), "store_sha256": digest}

    def _audit(self, event: str, *, model_id: str, operator: str, reason: str = "", extra: dict | None = None) -> None:
        """M6：審計日誌（append-only JSONL，store 之外）。

        <root>/audit/model_management_audit.jsonl，每行一筆事件：
        event/at/model_id/operator/reason/backup/store_sha256。寫入失敗不阻擋
        主流程（管理功能可用性優先），僅在回傳值附帶 audit_written=False。
        """
        record = {
            "event": event,
            "at": utc_now(),
            "model_id": model_id,
            "operator": str(operator),
            "reason": str(reason or ""),
        }
        if extra:
            record.update(extra)
        try:
            audit_dir = self.root / "audit"
            audit_dir.mkdir(parents=True, exist_ok=True)
            with (audit_dir / "model_management_audit.jsonl").open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError:
            pass

    def _supersede_source_submission(self, model: dict, *, operator: str, reason: str, op: str) -> str | None:
        """M5：歸檔／刪除模型後，把來源提交標記「已被取代」。

        被取代的提交不再佔用該小組／任務的上傳名額（學員可再傳新模型），
        但記錄本身保留（成長紀錄與審計鏈完整）。回傳被標記的 submission_id；
        無來源提交或已被標記時回傳 None。
        """
        submission_id = model.get("source_submission_id")
        if not submission_id:
            return None
        try:
            submission = self._find("submissions", "submission_id", submission_id)
        except KeyError:
            return None
        if submission.get("superseded"):
            return None
        submission.update(
            superseded=True,
            superseded_at=utc_now(),
            superseded_by=str(operator),
            superseded_reason=str(reason or ""),
            superseded_op=str(op),
            superseded_model_id=model["model_id"],
        )
        return submission_id

    def _unset_source_submission_superseded(self, model_id: str) -> str | None:
        """M2：還原時反向解除「已被取代」標記（僅解除由本模型造成的那一筆）。"""
        for submission in self.store.data["submissions"]:
            if submission.get("superseded") and submission.get("superseded_model_id") == model_id:
                submission.update(
                    superseded=False,
                    superseded_at=None,
                    superseded_by=None,
                    superseded_reason=None,
                    superseded_op=None,
                    superseded_model_id=None,
                )
                return submission["submission_id"]
        return None

    def archive_model(self, model_id: str, archived_by: str, reason: str = "") -> dict:
        """M1：歸檔一個「不理想」的非 ACTIVE 模型（教師）。

        - M4 守衛：ACTIVE／驗證中模型一律拒絕（model_active_cannot_manage /
          model_validation_in_progress）；
        - 重複歸檔冪等：已歸檔直接回傳（already_archived=True），不重複觸發
          來源提交的 superseded 標記；
        - .pt 檔案不動，只改狀態；歸檔後從列表與驗證下拉隱藏（既有行為）；
        - M7 先備份 store；M6 寫審計日誌；
        - M5 來源提交標記 superseded（學員可重傳）。
        """
        model = self._find("models", "model_id", model_id)
        self._guard_model_manageable(model)
        reason = str(reason or "")
        if model.get("status") == "ARCHIVED" and model.get("archived_via") == "teacher":
            result = dict(model)
            result["already_archived"] = True
            return result
        backup = self._backup_store("archive", model_id)
        superseded_submission_id = self._supersede_source_submission(
            model, operator=archived_by, reason=reason, op="archive"
        )
        model.update(
            status="ARCHIVED", archived_by=str(archived_by), archived_at=utc_now(),
            archived_via="teacher", archived_reason=reason,
            status_before_archive=model.get("status"),
        )
        self._write_manifest(Path(model["file_path"]).parent, model)
        self.store.save()
        self._audit(
            "model_archived", model_id=model_id, operator=str(archived_by), reason=reason,
            extra={"status_before_archive": model.get("status_before_archive"), **backup,
                   "superseded_submission_id": superseded_submission_id},
        )
        result = dict(model)
        result["already_archived"] = False
        result["backup_path"] = backup["backup_path"]
        result["store_sha256"] = backup["store_sha256"]
        result["superseded_submission_id"] = superseded_submission_id
        return result

    def restore_model(self, model_id: str, restored_by: str, reason: str = "") -> dict:
        """M2：一鍵還原「已歸檔」（僅教師手動歸檔件，archived_via=teacher）。

        還原到歸檔前狀態（status_before_archive），.pt 從未動過因此無需恢復；
        同時反向解除來源提交的 superseded 標記（若該提交尚未被再次取代）。
        """
        model = self._find("models", "model_id", model_id)
        if model.get("status") != "ARCHIVED" or model.get("archived_via") != "teacher":
            raise ModelValidationError("restore_not_teacher_archived")
        reason = str(reason or "")
        backup = self._backup_store("restore", model_id)
        restored_status = model.get("status_before_archive") or "CANDIDATE"
        # 還原即撤銷「教師歸檔」這個狀態本身：清掉 archived_via／archived_by／
        # archived_at，否則已還原的模型仍會被判定為「教師歸檔件」（Django 的
        # 「已歸檔」折疊區會誤列、回滾排除邏輯也會誤判）。歸檔時間保留在
        # last_archived_at，歸檔原因保留，完整歷史另有審計日誌。
        model.update(
            status=restored_status,
            restored_by=str(restored_by), restored_at=utc_now(),
            restored_reason=reason,
            last_archived_at=model.get("archived_at"),
            archived_via=None,
            archived_by=None,
            archived_at=None,
        )
        unsuperseded_submission_id = self._unset_source_submission_superseded(model_id)
        self._write_manifest(Path(model["file_path"]).parent, model)
        self.store.save()
        self._audit(
            "model_restored", model_id=model_id, operator=str(restored_by), reason=reason,
            extra={"restored_status": restored_status, **backup,
                   "unsuperseded_submission_id": unsuperseded_submission_id},
        )
        result = dict(model)
        result["backup_path"] = backup["backup_path"]
        result["store_sha256"] = backup["store_sha256"]
        result["unsuperseded_submission_id"] = unsuperseded_submission_id
        return result

    def delete_model(self, model_id: str, deleted_by: str, reason: str = "") -> dict:
        """M3：進階管理——永久刪除一個「不理想」的非 ACTIVE 模型（教師，二次確認）。

        安全規則：
        - M4 守衛：ACTIVE／驗證中拒絕（同上）；
        - M7 先備份 store＋模型目錄；M6 寫審計日誌；
        - 僅當該 .pt（依 sha256）沒有被其他記錄引用時才物理刪除模型檔案；
          有其他模型或提交共用同一檔案時只刪本記錄，檔案保留並在回傳值
          列出共用方（shared_with），提示教師原因；
        - 刪除該模型的驗證評估紀錄（evaluations），並保留提交記錄
          （提交的 imported_model_id 變懸空，UI 顯示 —，審計可溯）；
        - M5 來源提交標記 superseded（學員可重傳）。
        """
        model = self._find("models", "model_id", model_id)
        self._guard_model_manageable(model)
        # 2026-10-23 教師指令：種子模型的 .pt 不得被永久刪除——要刪必須先取消
        # 種子標記（unseed），並在錯誤碼中帶出受影響的下一代（版本鏈影響）。
        if model.get("is_seed"):
            children = sorted(
                str(item.get("model_id")) for item in self.store.data["models"]
                if item.get("seed_parent_model_id") == model_id
            )
            code = "model_is_seed_cannot_delete"
            if children:
                code += ":children=" + ",".join(children)
            raise ModelValidationError(code)
        reason = str(reason or "")
        file_hash = model.get("file_hash") or ""
        model_folder = Path(model["file_path"]).parent
        # 共用方：其他模型（未刪）或任何提交紀錄引用同一 sha256。
        # 教師指令（2026-10-21）：「僅當該 .pt 沒有被其他記錄引用時才物理刪除
        # 檔案；有引用則只刪該記錄並提示原因」——來源提交保留（審計鏈），
        # 其持有同一份位元組，因此同樣視為引用，模型 .pt 保留、只刪記錄。
        shared_with = sorted(
            {str(item.get("model_id")) for item in self.store.data["models"]
             if item.get("model_id") != model_id and file_hash and item.get("file_hash") == file_hash}
            | {str(item.get("submission_id")) for item in self.store.data["submissions"]
               if file_hash and item.get("file_hash") == file_hash}
        )
        backup = self._backup_store("delete", model_id)
        backup_dir = Path(backup["backup_path"])
        file_backed_up = False
        if model_folder.exists():
            shutil.copytree(model_folder, backup_dir / "model_file", dirs_exist_ok=True)
            file_backed_up = True
        superseded_submission_id = self._supersede_source_submission(
            model, operator=deleted_by, reason=reason, op="delete"
        )
        removed_evaluations = [
            item["evaluation_id"] for item in self.store.data["evaluations"]
            if item.get("model_id") == model_id
        ]
        self.store.data["evaluations"] = [
            item for item in self.store.data["evaluations"] if item.get("model_id") != model_id
        ]
        self.store.data["models"] = [
            item for item in self.store.data["models"] if item.get("model_id") != model_id
        ]
        self.store.save()
        file_removed = False
        if not shared_with and model_folder.exists():
            shutil.rmtree(model_folder)
            file_removed = True
        self._audit(
            "model_deleted", model_id=model_id, operator=str(deleted_by), reason=reason,
            extra={"file_hash": file_hash, "file_removed": file_removed, "shared_with": shared_with,
                   "removed_evaluations": removed_evaluations,
                   "superseded_submission_id": superseded_submission_id, **backup},
        )
        return {
            "model_id": model_id,
            "task_id": model.get("task_id"),
            "deleted_by": str(deleted_by),
            "deleted_at": utc_now(),
            "record_removed": True,
            "file_removed": file_removed,
            "file_backed_up": file_backed_up,
            "shared_with": shared_with,
            "removed_evaluations": removed_evaluations,
            "superseded_submission_id": superseded_submission_id,
            "backup_path": str(backup_dir),
            "store_sha256": backup["store_sha256"],
        }

    # ---- 種子模型（數據飛輪，2026-10-23 教師指令） ----
    # 教師認可的優質模型保留為「種子模型」：下一期學員可下載該 .pt 作為訓練起點，
    # 在其基礎上補充新圖片標註、繼續訓練，模型逐期變準。一個任務可以有多個歷史
    # 種子，但只有一個「當前推薦基礎模型」（store.recommended_seeds[model_type]）。
    def _next_seed_generation(self, model_type: str) -> int:
        generations = [
            int(item.get("seed_generation") or 0)
            for item in self.store.data["models"]
            if item.get("model_type") == model_type and item.get("is_seed")
        ]
        return (max(generations) + 1) if generations else 1

    def recommended_seed_model_id(self, model_type: str) -> str | None:
        pointer = (self.store.data.get("recommended_seeds") or {}).get(model_type)
        if not pointer:
            return None
        # 指標失效（種子已被取消）時視為沒有，避免學員下載到不存在的模型。
        if not any(
            item.get("model_id") == pointer and item.get("is_seed")
            for item in self.store.data["models"]
        ):
            return None
        return str(pointer)

    def recommended_seed(self, model_type: str) -> dict | None:
        model_id = self.recommended_seed_model_id(model_type)
        if not model_id:
            return None
        try:
            return self._attach_health(self._find("models", "model_id", model_id))
        except KeyError:
            return None

    def seed_models(self, model_type: str | None = None) -> list[dict]:
        """該任務的所有種子（按期數排序；不含已取消標記的歷史）。"""
        items = [
            self._attach_health(dict(item))
            for item in self.store.data["models"]
            if item.get("is_seed") and (model_type is None or item.get("model_type") == model_type)
        ]
        items.sort(key=lambda item: int(item.get("seed_generation") or 0))
        return items

    def seed_version_chain(self, model_type: str) -> list[dict]:
        """版本鏈（供教師頁顯示「是否越來越準」）：期數、mAP50、驗證信心變化。"""
        chain = []
        for item in self.seed_models(model_type):
            chain.append({
                "model_id": item.get("model_id"),
                "model_name": item.get("model_name") or item.get("model_id"),
                "version": item.get("version") or "",
                "generation": int(item.get("seed_generation") or 0),
                "parent_model_id": item.get("seed_parent_model_id"),
                "map50": item.get("seed_map50") if item.get("seed_map50") is not None else item.get("health_map50"),
                "validation_confidence": item.get("seed_validation_confidence"),
                "seeded_at": item.get("seeded_at") or "",
                "seeded_by": item.get("seeded_by") or "",
                "seed_note": item.get("seed_note") or "",
                "status": item.get("status"),
                "is_recommended": self.recommended_seed_model_id(model_type) == item.get("model_id"),
                "file_hash": item.get("file_hash") or "",
            })
        return chain

    def _seed_comparison(self, model: dict, parent_model_id, *, new_map50, new_confidence) -> dict:
        """與上一期種子比較（mAP50／驗證信心）；低於上一期時給對比提示，但由教師決定。"""
        parent = None
        if parent_model_id:
            try:
                parent = self._find("models", "model_id", parent_model_id)
            except KeyError:
                parent = None
        if parent is None:
            candidates = [
                item for item in self.store.data["models"]
                if item.get("model_type") == model["model_type"]
                and item.get("is_seed") and item.get("model_id") != model["model_id"]
            ]
            parent = max(candidates, key=lambda item: int(item.get("seed_generation") or 0), default=None)
        if parent is None:
            return {"has_previous": False, "warning": ""}
        prev_map50 = parent.get("seed_map50") if parent.get("seed_map50") is not None else parent.get("health_map50")
        prev_conf = parent.get("seed_validation_confidence")
        map50_delta = (round(float(new_map50) - float(prev_map50), 6)
                       if new_map50 is not None and prev_map50 is not None else None)
        conf_delta = (round(float(new_confidence) - float(prev_conf), 6)
                      if new_confidence is not None and prev_conf is not None else None)
        warning = ""
        if (map50_delta is not None and map50_delta < 0) or (conf_delta is not None and conf_delta < 0):
            warning = (
                "對比提示：新一期指標低於上一期（mAP50 %s→%s、驗證信心 %s→%s）。"
                "系統只提示，是否仍入庫由教師決定。"
                % (
                    prev_map50 if prev_map50 is not None else "—",
                    new_map50 if new_map50 is not None else "—",
                    prev_conf if prev_conf is not None else "—",
                    new_confidence if new_confidence is not None else "—",
                )
            )
        return {
            "has_previous": True,
            "previous_model_id": parent.get("model_id"),
            "previous_generation": int(parent.get("seed_generation") or 0),
            "previous_map50": prev_map50,
            "previous_validation_confidence": prev_conf,
            "map50_delta": map50_delta,
            "confidence_delta": conf_delta,
            "warning": warning,
        }

    def seed_model(self, model_id: str, seeded_by: str, *, generation=None,
                   parent_model_id=None, note: str = "", recommended: bool = True) -> dict:
        """入庫為種子模型（教師）。條件：health=OK 且有驗證通過紀錄（最高信心 ≥ 0.6）。

        - 冪等：已是種子時更新備註／推薦位後回傳（already_seeded=True），不重複計期；
        - 期數：明確指定 > 沿用原值 > 自動（該任務最大期數 + 1）；
        - parent_model_id：明確指定 > 沿用 > 當前推薦種子（自動形成版本鏈）；
        - recommended=True 時本模型成為該任務「當前推薦基礎模型」（唯一）；
        - 指標低於上一期時回傳 seed_comparison.warning（只提示，不阻擋）；
        - 操作前自動備份 store；審計 JSONL 記錄完整欄位。
        """
        model = self._find("models", "model_id", model_id)
        if model.get("quarantined"):
            raise ModelValidationError("seed_model_quarantined")
        path = Path(model.get("file_path") or "")
        if not path.exists() or not os.access(str(path), os.R_OK):
            raise ModelValidationError("seed_model_file_unreadable")
        # 健康度與 mAP50：優用匯入時已存事實，缺失時當場檢查（不猜）。
        health = model.get("health")
        map50 = model.get("health_map50")
        if health not in ALL_HEALTH_STATES or map50 is None:
            facts = self._inspect_health(path)
            if health not in ALL_HEALTH_STATES:
                health = facts.get("health")
            if map50 is None:
                map50 = facts.get("map50")
        if health != HEALTH_OK:
            raise ModelValidationError("seed_health_not_ok")
        threshold = activation_min_confidence()
        confidence = self.validation_pass_confidence(model_id)
        if confidence is None:
            raise ModelValidationError("seed_validation_required")
        if confidence < threshold:
            raise ModelValidationError("seed_validation_confidence_too_low")

        already_seed = bool(model.get("is_seed"))
        backup = self._backup_store("seed", model_id)
        if generation is None:
            generation = model.get("seed_generation") or self._next_seed_generation(model["model_type"])
        generation = int(generation)
        if parent_model_id is None:
            parent_model_id = model.get("seed_parent_model_id") or self.recommended_seed_model_id(model["model_type"])
        parent_model_id = str(parent_model_id) if parent_model_id else None
        if parent_model_id == model_id:
            parent_model_id = None
        comparison = self._seed_comparison(
            model, parent_model_id, new_map50=map50, new_confidence=confidence
        )
        model.update(
            is_seed=True,
            seed_generation=generation,
            seed_parent_model_id=parent_model_id,
            seeded_at=utc_now(),
            seeded_by=str(seeded_by),
            seed_note=str(note or ""),
            seed_validation_confidence=confidence,
            seed_map50=map50,
            seed_file_hash=model.get("file_hash") or "",
        )
        if recommended:
            self.store.data.setdefault("recommended_seeds", {})[model["model_type"]] = model_id
        self._write_manifest(path.parent, model)
        self.store.save()
        self._audit(
            "model_seeded", model_id=model_id, operator=str(seeded_by), reason=str(note or ""),
            extra={
                "seed_generation": generation,
                "seed_parent_model_id": parent_model_id,
                "seed_validation_confidence": confidence,
                "seed_map50": map50,
                "seed_file_hash": model.get("seed_file_hash"),
                "recommended": bool(recommended),
                "already_seed": already_seed,
                **backup,
            },
        )
        result = self._attach_health(dict(model))
        result["already_seeded"] = already_seed
        result["seed_comparison"] = comparison
        result["backup_path"] = backup["backup_path"]
        result["store_sha256"] = backup["store_sha256"]
        return result

    def unseed_model(self, model_id: str, unseeded_by: str, reason: str = "") -> dict:
        """取消種子標記（教師）。取消後該模型才可被永久刪除。

        - 若取消的是「當前推薦基礎模型」，推薦位自動改為期數最高的其餘種子
          （沒有則清空），學員端永遠有明確（或空）的推薦；
        - 回傳 version_chain_impact：以本模型為 parent 的下一代種子（版本鏈影響）；
        - 操作前自動備份 store；審計 JSONL 記錄。
        """
        model = self._find("models", "model_id", model_id)
        if not model.get("is_seed"):
            raise ModelValidationError("model_not_seed")
        backup = self._backup_store("unseed", model_id)
        children = sorted(
            str(item.get("model_id")) for item in self.store.data["models"]
            if item.get("seed_parent_model_id") == model_id
        )
        was_recommended = self.recommended_seed_model_id(model["model_type"]) == model_id
        model.update(
            is_seed=False,
            unseeded_at=utc_now(),
            unseeded_by=str(unseeded_by),
            unseeded_reason=str(reason or ""),
        )
        promoted_model_id = None
        if was_recommended:
            remaining = [
                item for item in self.store.data["models"]
                if item.get("model_type") == model["model_type"] and item.get("is_seed")
            ]
            if remaining:
                promoted = max(remaining, key=lambda item: int(item.get("seed_generation") or 0))
                promoted_model_id = promoted["model_id"]
                self.store.data.setdefault("recommended_seeds", {})[model["model_type"]] = promoted_model_id
            else:
                (self.store.data.get("recommended_seeds") or {}).pop(model["model_type"], None)
        self._write_manifest(Path(model["file_path"]).parent, model)
        self.store.save()
        self._audit(
            "model_unseeded", model_id=model_id, operator=str(unseeded_by), reason=str(reason or ""),
            extra={
                "was_recommended": was_recommended,
                "promoted_recommended_model_id": promoted_model_id,
                "version_chain_impact": children,
                **backup,
            },
        )
        result = dict(model)
        result["was_recommended"] = was_recommended
        result["promoted_recommended_model_id"] = promoted_model_id
        result["version_chain_impact"] = children
        result["backup_path"] = backup["backup_path"]
        result["store_sha256"] = backup["store_sha256"]
        return result

    def download_seed_model(self, *, model_id: str | None = None, model_type: str | None = None,
                            downloaded_by: str = "") -> dict:
        """學員下載種子 .pt 作為訓練起點（數據飛輪 B-5）。

        - 指定 model_id 則下載該種子；否則下載 model_type 的「當前推薦基礎模型」；
        - 只允許 is_seed 的模型（避免非種子被當作訓練起點下載）；
        - 回傳 .pt 的 base64（前端直接觸發下載），並寫審計（誰／何時／哪一顆）；
        - 不修改 store、不刪除 .pt、不改閾值。
        """
        if model_id:
            model = self._find("models", "model_id", model_id)
        else:
            if not model_type:
                raise ValueError("model_type_required")
            model_id = self.recommended_seed_model_id(model_type)
            if not model_id:
                raise ValueError("no_recommended_seed")
            model = self._find("models", "model_id", model_id)
        if not model.get("is_seed"):
            raise ModelValidationError("model_not_seed")
        path = Path(model.get("file_path") or "")
        if not path.exists() or not os.access(str(path), os.R_OK):
            raise ModelValidationError("seed_file_unreadable")
        content = path.read_bytes()
        self._audit(
            "seed_downloaded", model_id=model.get("model_id"), operator=str(downloaded_by),
            reason="student_download_seed_as_training_start",
            extra={
                "model_type": model.get("model_type"),
                "seed_generation": model.get("seed_generation"),
                "file_size": len(content),
                "file_hash": model.get("file_hash") or "",
            },
        )
        return {
            "model_id": model.get("model_id"),
            "model_name": model.get("model_name") or model.get("model_id"),
            "model_type": model.get("model_type"),
            "seed_generation": model.get("seed_generation"),
            "file_name": f"{model.get('model_name') or model.get('model_id')}.pt",
            "file_base64": base64.b64encode(content).decode("ascii"),
            "file_size": len(content),
            "file_hash": model.get("file_hash") or "",
        }

    # ---- Student model submission (inert attachment, never executed) ----
    def create_submission(
        self, *, task_id: str, student_id: str, group_id: str,
        original_filename: str, content: bytes, notes: str = "",
        growth_record_id: str = "", growth_record_slot: str = "",
        evidence_reference: str = "", evidence_type: str = "",
        enrollment_id: int = 0, cohort_ids: list[str] | None = None,
        parent_model_id: str = "",
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
        file_hash = sha256_bytes(content)
        # M5（2026-10-21）：重複檔案改為「資訊提示」而非拒絕。學員重傳同一 .pt
        # （例如教師歸檔不理想模型後，學員重新上傳同一份）不應被擋；若該檔與
        # 「已歸檔」模型相同，回傳提示讓上層顯示「此文件與已歸檔模型相同」。
        # 提示只影響文案，任何健康度檢查（D2 匯入閘門）都不放寬。
        matching_archived = sorted(
            str(item.get("model_id")) for item in self.store.data["models"]
            if item.get("file_hash") == file_hash and item.get("status") == "ARCHIVED"
        )
        matching_pending = sorted(
            str(item.get("submission_id")) for item in self.store.data["submissions"]
            if item.get("file_hash") == file_hash and not item.get("superseded")
        )
        duplicate_hint = ""
        if matching_archived:
            duplicate_hint = "same_as_archived_model"
        elif matching_pending:
            duplicate_hint = "same_as_pending_submission"
        record = {
            "submission_id": submission_id, "task_id": task_id, "student_id": str(student_id).strip(),
            "group_id": str(group_id).strip(), "original_filename": str(original_filename),
            "file_path": str(path), "file_hash": file_hash, "file_size": len(content),
            "uploaded_at": utc_now(), "status": "SUBMITTED", "imported_model_id": None, "imported_at": None,
            "import_attempted_at": None, "import_last_error": None,
            "notes": notes, "growth_record_id": str(growth_record_id),
            "growth_record_slot": str(growth_record_slot),
            "evidence_reference": str(evidence_reference), "evidence_type": str(evidence_type),
            # P7-B6（2026-10-29）：身分只來自已驗證的 Assertion，一併落盤供事後稽核與
            # 跨 Cohort 檢查；不從請求本文取值。
            "enrollment_id": int(enrollment_id or 0),
            "cohort_ids": [str(item) for item in (cohort_ids or [])],
            "duplicate_hint": duplicate_hint,
            "matching_archived_model_ids": matching_archived,
            # 2026-10-23 數據飛輪：學員可選「基於的種子模型」（預設當前推薦），
            # 匯入時複製到模型紀錄，形成第 N 期 → 第 N+1 期的版本鏈。
            "parent_model_id": str(parent_model_id or ""),
        }
        self.store.data["submissions"].append(record)
        self.store.save()
        return dict(record)

    def get_submission(self, submission_id: str) -> dict:
        return dict(self._find("submissions", "submission_id", submission_id))

    def list_submissions(self, task_id: str | None = None, status: str | None = None) -> list[dict]:
        return [dict(item) for item in self.store.data["submissions"] if (task_id is None or item["task_id"] == task_id) and (status is None or item["status"] == status)]

    def delete_submission(self, submission_id: str, *, deleted_by: str) -> dict:
        """Delete one student submission record and its uploaded .pt file (teacher-only).

        Teacher directive 2026-10-20 ("教師後台增加刪除功能"). Safety rails:
        - refuses with a traceable error when any model references this submission
          (source_submission_id), so a deletion can never orphan model lineage,
          teacher review records or the ACTIVE pointer;
        - writes a timestamped backup (store JSON + the submission folder) under
          <root>/backups/<stamp>-delete-<submission_id>/ BEFORE mutating anything;
        - removes only this submission's own record and folder; no other record,
          model, dataset or Evidence is touched.
        """
        submission = self._find("submissions", "submission_id", submission_id)
        dependents = sorted({
            str(item.get("model_id")) for item in self.store.data["models"]
            if item.get("source_submission_id") == submission_id
        })
        if dependents:
            raise ModelValidationError("submission_has_models:" + ",".join(dependents))
        folder = Path(submission["file_path"]).parent
        stamp = utc_now().replace(":", "").replace(".", "-")
        backup_dir = self.root / "backups" / f"{stamp}-delete-{submission_id}"
        backup_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(self.store.path, backup_dir / "vision_center.json")
        if folder.exists():
            shutil.copytree(folder, backup_dir / "submission_file", dirs_exist_ok=True)
        self.store.data["submissions"] = [
            item for item in self.store.data["submissions"]
            if item.get("submission_id") != submission_id
        ]
        self.store.save()
        file_removed = False
        if folder.exists():
            shutil.rmtree(folder)
            file_removed = True
        return {
            "submission_id": submission_id,
            "task_id": submission.get("task_id"),
            "student_id": submission.get("student_id"),
            "deleted_by": deleted_by,
            "deleted_at": utc_now(),
            "record_removed": True,
            "file_removed": file_removed,
            "backup_path": str(backup_dir),
        }

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
        # D2（2026-10-19）：狀態檢查、檔案檢查、冪等防護與預檢都必須留下失敗原因。
        # 先前只有 upload_model 的例外會寫入 import_last_error，導致預檢失敗時
        # 教師頁的「上次導入嘗試失敗」永遠空白。
        try:
            if submission["status"] != "SUBMITTED":
                raise ValueError("submission_not_importable")
            if not Path(submission["file_path"]).exists():
                raise ValueError("submission_file_missing")
            # 冪等防護（2026-10-19）：同一個提交不得匯入出第二個模型。
            # 正常情況 status 檢查已擋住重複匯入；此處額外防護「狀態被人工改回 SUBMITTED」
            # 或併發重送的情形，避免產生重複模型與孤兒 dataset。
            # REJECTED 的紀錄不算（那是失敗嘗試留下的，允許修正後重試）。
            already = next(
                (
                    item for item in self.store.data["models"]
                    if item.get("source_submission_id") == submission_id
                    and item.get("status") != "REJECTED"
                ),
                None,
            )
            if already is not None:
                raise ValueError("submission_already_imported")
            # 先做唯讀預檢（載入 .pt 取得實際類別名）。預檢失敗時不建立任何模型或資料集
            # 紀錄，提交保持 SUBMITTED——教師指令③④（2026-10-18）：不直接駁回、
            # 顯示失敗原因，由教師決定（補充類別名／提供對照表／手動駁回）。
            preflight = self._inspect_submission_for_import(submission, class_name_mapping=class_name_mapping)
        except Exception as exc:
            if self._record_import_failure(submission, f"import_failed:{exc}", code=str(exc)):
                self.store.save()
            raise
        content = Path(submission["file_path"]).read_bytes()
        # DEMO 放寬：若預檢自動產生了別名映射（類別不一致但可對應），轉發給
        # upload_model 並標記 demo_relaxed——「不」標記 VALIDATED、「不」啟用。
        # 此分支僅在本 Live 實例啟用 FDE_DEMO_SIMULATED_INFERENCE 時生效。
        demo_relaxed = bool(isinstance(preflight, dict) and preflight.get("demo_class_relaxed"))
        demo_mapping = preflight.get("class_name_mapping") if demo_relaxed else class_name_mapping
        try:
            model = self.upload_model(
                model_type=submission["task_id"], model_name=model_name, version=version,
                content=content, dataset_id=dataset_id, dataset_version=dataset_version,
                rule_version=rule_version, uploaded_by=uploaded_by, notes=notes,
                source_group=submission["group_id"], source_submission_id=submission_id,
                source_student_id=submission["student_id"], class_name_mapping=demo_mapping,
                demo_relaxed=demo_relaxed,
            )
        except Exception as exc:
            # 教師指令④：匯入失敗不自動把 submission 改成 REJECTED；保持 SUBMITTED，
            # 記錄失敗原因與嘗試時間，讓教師頁可以顯示並由教師決定下一步。
            submission.update(
                status="SUBMITTED",
                import_attempted_at=utc_now(),
                import_last_error=f"import_failed:{exc}",
                import_last_error_code=str(exc),
            )
            self.store.save()
            raise
        submission.update(status="IMPORTED", imported_model_id=model["model_id"], imported_at=utc_now(),
                          import_attempted_at=utc_now(), import_last_error=None,
                          import_last_error_code=None)
        # 2026-10-23 數據飛輪：把提交時選擇的「基於的種子模型」複製到模型紀錄，
        # 形成版本鏈（第 N 期種子 → 第 N+1 期模型）。新模型仍須走完整導入閘門
        # 與 0.6 驗證才可啟用，飛輪不放寬任何標準。
        parent_model_id = submission.get("parent_model_id") or ""
        if parent_model_id:
            stored = self._find("models", "model_id", model["model_id"])
            stored["parent_model_id"] = str(parent_model_id)
            self._write_manifest(Path(stored["file_path"]).parent, stored)
        self.store.save()
        return dict(model)

    def _record_import_failure(self, submission: dict, message: str, *, code: str = "", recorded_by: str = "") -> bool:
        """寫入導入失敗原因（D2，2026-10-19）。

        已成功導入（IMPORTED）的提交不得被標記為失敗：重複點擊導入只是無效操作，
        不應讓一筆成功紀錄看起來像失敗。回傳是否實際寫入。
        """
        if submission.get("status") == "IMPORTED":
            return False
        submission.update(
            import_attempted_at=utc_now(),
            import_last_error=str(message or code or "import_failed"),
            import_last_error_code=str(code or ""),
        )
        if recorded_by:
            submission["import_last_error_by"] = str(recorded_by)
        return True

    def record_import_failure(self, submission_id: str, *, message: str, code: str = "", recorded_by: str = "") -> dict:
        """Django 端回報的失敗（預檢失敗、逾時、連線失敗等）寫回 import_last_error。

        Live 內部的失敗由 import_submission 自行記錄；此入口只補齊「失敗發生在
        Django 端」的情況，讓教師頁有持久、可理解的失敗原因。
        """
        submission = self._find("submissions", "submission_id", submission_id)
        recorded = self._record_import_failure(submission, message, code=code, recorded_by=recorded_by)
        if recorded:
            self.store.save()
        return {
            "submission_id": submission_id,
            "recorded": recorded,
            "status": submission.get("status"),
            "import_last_error": submission.get("import_last_error") or "",
        }

    def _inspect_submission_for_import(self, submission: dict, *, class_name_mapping=None) -> dict:
        """唯讀預檢：載入提交的 .pt，回報實際類別名與任務預期的關係。

        不做任何狀態或磁盤寫入。names 為空／數量一致但名稱不同／數量不符分別拋出
        可識別的例外，供匯入端與教師 UI 區分處理（教師指令③）。

        DEMO 放寬（僅當本 Live 實例啟用 FDE_DEMO_SIMULATED_INFERENCE）：當模型類別
        數量與任務預期不一致、但能透過「筆誤別名」（CCE/CCF→CCW）對應到全部預期
        類別時，自動產生對照表並回報 demo_class_relaxed=True，交由 import_submission
        以「不標記 VALIDATED／不啟用」的方式匯入。不影響正式（非 DEMO）匯入邏輯。
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

        auto_alias_used = False
        # DEMO 放寬：未提供對照表且類別數量不一致時，嘗試用筆誤別名對應。
        if (self.demo_simulation_enabled and not class_name_mapping
                and len(actual) != len(expected)):
            alias = demo_class_alias_for(actual, expected)
            if alias is not None:
                class_name_mapping = alias
                auto_alias_used = True

        if actual != expected:
            registered = registered_class_mapping(submission["submission_id"])
            if registered:
                # 受控放寬：已登記筆誤映射 → 允許 many-to-one，但映射必須有效。
                try:
                    apply_class_name_mapping(actual, expected, registered["mapping"], allow_many_to_one=True)
                except ValueError as exc:
                    raise ModelValidationError("registered_class_mapping_stale") from exc
            elif class_name_mapping and auto_alias_used:
                # DEMO 自動別名：允許 many-to-one（筆誤通道合併）。
                try:
                    apply_class_name_mapping(actual, expected, class_name_mapping, allow_many_to_one=True)
                except ValueError as exc:
                    raise ModelValidationError("model_class_names_mismatch") from exc
            elif len(actual) != len(expected):
                raise ModelValidationError("model_class_names_mismatch")
            elif class_name_mapping is None:
                raise ModelClassNamesMappingRequiredError(model_type, actual, expected)
            else:
                apply_class_name_mapping(actual, expected, class_name_mapping)
        if details.get("smoke_inference") is not True:
            raise ModelValidationError("smoke_inference_failed")
        demo_relaxed = bool(self.demo_simulation_enabled and auto_alias_used)
        return {
            "task_id": model_type, "class_names_actual": actual, "class_names_expected": expected,
            "demo_class_relaxed": demo_relaxed, "class_name_mapping": class_name_mapping,
        }

    def preflight_import(self, submission_id: str) -> dict:
        """教師頁導入前的唯讀檢查：回報結局而不改動任何狀態。

        outcome: ready（類別名與預期一致）｜registered_mapping_ready（數量不符，但在
        設定檔已登記筆誤映射，可受控放行）｜mapping_required（數量一致、名稱不同，
        應提供對照表）｜class_names_missing（模型缺少類別名稱，請補充）｜
        mismatch（數量不符且未登記）｜detection_model_required（非 detect 任務）。
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
                "registered_mapping": None, "temporary_mapping": False,
            }
        actual = [str(name) for name in (details.get("class_names") or [])]
        registered = registered_class_mapping(submission_id)
        mapping_info = None
        if details.get("task") != "detect":
            outcome = "detection_model_required"
        elif not actual:
            outcome = "class_names_missing"
        elif len(actual) != len(expected):
            outcome = "mismatch"
            if self.demo_simulation_enabled:
                alias = demo_class_alias_for(actual, expected)
                if alias is not None:
                    outcome = "demo_class_relaxed"
                    mapping_info = {
                        "class_name_mapping": alias,
                        "class_name_mapping_note": "DEMO 類別放寬：CCE/CCF 筆誤別名對應到 CCW（僅 DEMO，不影響正式模型）",
                        "temporary_mapping": True,
                        "demo_class_relaxed": True,
                    }
            if outcome == "mismatch" and registered:
                try:
                    apply_class_name_mapping(actual, expected, registered["mapping"], allow_many_to_one=True)
                    outcome = "registered_mapping_ready"
                    mapping_info = {
                        "class_name_mapping": registered["mapping"],
                        "class_name_mapping_note": str(registered["entry"].get("reason") or ""),
                        "temporary_mapping": True,
                    }
                except ValueError:
                    outcome = "mismatch"
        elif actual != expected:
            outcome = "mapping_required"
        else:
            outcome = "ready"
        return {
            "submission_id": submission_id, "task_id": model_type,
            "outcome": outcome, "class_names_actual": actual, "class_names_expected": expected,
            "registered_mapping": mapping_info,
            "temporary_mapping": bool(mapping_info),
            "demo_class_relaxed": bool(mapping_info and isinstance(mapping_info, dict) and mapping_info.get("demo_class_relaxed")),
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

    def quarantine_dataset(self, dataset_id: str, *, reason: str = "", source_submission_id: str = "", quarantined_by: str = "") -> dict:
        """D1（2026-10-19）：把資料集標記為隔離，不刪除任何記錄或檔案。

        用途：教師匯入流程先建立 dataset 再呼叫 Live 匯入；若匯入失敗，該 dataset
        會成為沒有模型引用的可見孤兒。Django 端在失敗後呼叫此入口做補償式隔離，
        讓它不出現在正常清單，但記錄、來源提交與失敗原因全部保留，可事後追查或還原。
        """
        dataset = self._find("datasets", "dataset_id", dataset_id)
        if dataset.get("quarantined"):
            return dict(dataset)
        referenced = [
            item["model_id"] for item in self.store.data["models"]
            if item.get("dataset_id") == dataset_id
        ]
        if referenced:
            # 已被模型引用的資料集不是孤兒；隔離它會讓既有模型失去可追溯的來源。
            raise ValueError("dataset_in_use")
        dataset.update(
            quarantined=True,
            quarantined_at=utc_now(),
            quarantine_reason=str(reason or "import_failed"),
            quarantined_by=str(quarantined_by or ""),
            quarantine_origin="import_failure_compensation",
        )
        if source_submission_id:
            dataset["source_submission_id"] = str(source_submission_id)
        self._write_dataset_metadata(dataset)
        self.store.save()
        return dict(dataset)

    def list_datasets(self, model_type: str | None = None) -> list[dict]:
        # 同上：隔離的 dataset 不進列表，但仍可用 _find / 直接 ID 取回。
        return [
            dict(item) for item in self.store.data["datasets"]
            if (model_type is None or item["model_type"] == model_type)
            and not item.get("quarantined")
        ]

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


# 2026-10-29（接棒驗收）：CW／CCW 兩類對應規則。
# 現有 PROP_DIRECTION 模型為四類（CW_F/CCW_F/CW_B/CCW_B = 旋向 × 槳面），
# 但本輪只驗收「順時針 CW／逆時針 CCW」兩類。此對應規則將四類收斂為兩類，
# 供教師圖片驗證時誠實顯示「原始模型類別 → 轉換後 CW/CCW」，絕不偽裝模型本身是兩類模型。
#
# 【語義基礎，P7-C 確認】CW／CCW 是「螺旋槳旋向（規格方向）」，不是「觀察視角方向」：
#   1. 四類 = 旋向 × 槳面 兩個正交屬性；_F／_B 表示槳面（面向相機的那一面），
#      CW／CCW 表示該槳葉在機體座標系中的旋轉方向。因此剝離槳面後保留旋向是合法的。
#   2. 規則引擎 evaluate_prop 要求 M1 右前／M2 左後 = CCW_F、M3 左前／M4 右後 = CW_F；
#      對角馬達同旋向是機體力矩平衡的機械事實，與相機位置無關。
#   3. 設計文件明定「畫面解讀以 F450 機頭方向定義為準」，並把「畫面方向無法可靠取得」
#      列為 REVIEW 條件 → 系統明確分離「旋向屬性」與「視角」，視角不明時拒絕猜測。
# 因此本對應表【只可用於顯示與統計】，不得用於 PASS／NG 判定；
# 判定仍必須走 evaluate_prop 的四類規則，否則等於把四類規則靜默降級為兩類。
PROP_DIRECTION_TO_CW_CCW = {
    "CW_F": "CW", "CW_B": "CW",
    "CCW_F": "CCW", "CCW_B": "CCW",
}


def map_prop_to_direction(class_name: str | None) -> str | None:
    """將四類槳葉類別收斂為 CW／CCW 兩類；無法對應（含空值/未知類別）回 None。"""
    if not class_name:
        return None
    return PROP_DIRECTION_TO_CW_CCW.get(str(class_name).strip().upper())


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
