"""P1-2 PROP Benchmark Sandbox。

學生上傳的 best.pt 在 P1-1 階段僅為附件，禁止執行；
唯有教師審核為 APPROVED_FOR_BENCHMARK 並主動點擊「驗證模型」時，
才於本 Sandbox 內載入模型、檢查類別契約、執行標準驗證集。

Benchmark 結果只供教師審核，不會自動部署 / 啟用 / 覆寫 Production。
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from dataclasses import asdict, dataclass, replace
from enum import Enum
from pathlib import Path
from typing import Any, Callable

from .sessions import utc_now_iso

# PROP 類別契約：槳葉方向與正反面；順序即模型索引，必須嚴格一致。
PROP_CLASS_CONTRACT: tuple[str, ...] = ("CW_F", "CCW_F", "CW_B", "CCW_B")
CLASS_CONTRACT_VERSION = "PROP_V1"

# HOVER 僅保留介面：本輪禁止載入 / 驗證 / 處理影片。
HOVER_CLASS_CONTRACT: tuple[str, ...] = ("FRONT", "RIGHT", "BACK", "LEFT")

# PROP 標準驗證集預設根目錄（最小介面，不製作大量 Dataset）。
DEFAULT_VALIDATION_ROOT = Path(
    os.environ.get("FDE_PROP_VALIDATION_ROOT")
    or Path(__file__).resolve().parents[2] / "validation_sets" / "prop"
)
# 模型附件目錄：P1-1 上傳 .pt 的存放處。
DEFAULT_MODEL_ARTIFACT_ROOT = Path(
    os.environ.get("FDE_MODEL_ARTIFACT_ROOT")
    or Path(os.environ.get("LOCALAPPDATA", Path.home())) / "FDE-AI-UAS" / "model-artifacts"
)


class BenchmarkStatus(str, Enum):
    """Benchmark 狀態集合；不含 PRODUCTION / ACTIVE / DEPLOYED。"""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    PASS = "PASS"
    FAIL = "FAIL"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    INCOMPATIBLE_CLASSES = "INCOMPATIBLE_CLASSES"
    MODEL_LOAD_FAILED = "MODEL_LOAD_FAILED"
    WAITING_FOR_GOLDEN_SET = "WAITING_FOR_GOLDEN_SET"
    ERROR = "ERROR"


@dataclass(frozen=True)
class BenchmarkPolicy:
    """PROP Benchmark 門檻；未設定時不得自動判定 PASS。"""

    min_precision: float | None = None
    min_recall: float | None = None
    min_map50: float | None = None

    @property
    def configured(self) -> bool:
        """門檻是否完整設定；未設定即 NOT_CONFIGURED。"""
        return None not in (self.min_precision, self.min_recall, self.min_map50)

    def decide(self, metrics: dict[str, Any]) -> str:
        """依門檻判定 PASS / FAIL；門檻未設定則 REVIEW_REQUIRED。"""
        if not self.configured:
            return BenchmarkStatus.REVIEW_REQUIRED.value
        passed = (
            float(metrics.get("precision", 0.0)) >= float(self.min_precision)
            and float(metrics.get("recall", 0.0)) >= float(self.min_recall)
            and float(metrics.get("map50", 0.0)) >= float(self.min_map50)
        )
        return BenchmarkStatus.PASS.value if passed else BenchmarkStatus.FAIL.value


@dataclass(frozen=True)
class BenchmarkRecord:
    """Benchmark 歷史最小欄位；不複製 best.pt，不做 Model Version Manager。"""

    benchmark_id: str
    submission_id: str
    model_reference: str
    validation_set_version: str
    class_contract_version: str
    model_classes: tuple[str, ...]
    metrics: dict[str, Any]
    status: str
    created_at: str
    teacher_id: str
    # 真實可重複性欄位：模型檔案雜湊 + 執行環境版本
    model_file_hash: str = "NOT_AVAILABLE"
    runtime_version: str = "NOT_PROBED"


class PropValidationSet:
    """PROP 標準驗證集介面（最小版）：manifest + images + labels。

    Golden Set 一旦啟用即凍結：不得進入訓練集，不得由 Hard Example 回流寫入。
    """

    def __init__(self, root: Path | str = DEFAULT_VALIDATION_ROOT, version: str = "PROP_GOLDEN_V1") -> None:
        self.root = Path(root)
        self.version = version

    @property
    def manifest_path(self) -> Path:
        return self.root / "manifest.json"

    @property
    def images_dir(self) -> Path:
        return self.root / "images"

    @property
    def labels_dir(self) -> Path:
        return self.root / "labels"

    def manifest(self) -> dict[str, Any]:
        """讀取驗證集 manifest；缺失或損壞時回傳空 dict。"""
        try:
            payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return payload if isinstance(payload, dict) else {}

    @property
    def validation_set_id(self) -> str:
        return str(self.manifest().get("validation_set_id") or "PROP_GOLDEN")

    @property
    def frozen(self) -> bool:
        """Golden Set 是否已凍結（凍結後不得修改，升級走 PROP_GOLDEN_V2）。"""
        return bool(self.manifest().get("frozen", False))

    @property
    def review_status(self) -> str:
        return str(self.manifest().get("review_status") or "NOT_REVIEWED")

    def contract_ok(self) -> bool:
        """manifest 宣告的類別契約必須嚴格等於 PROP 四類。"""
        return tuple(self.manifest().get("class_contract") or ()) == PROP_CLASS_CONTRACT

    def image_count(self) -> int:
        """真實圖片數量（忽略隱藏檔）。"""
        if not self.images_dir.is_dir():
            return 0
        return sum(1 for path in self.images_dir.iterdir() if not path.name.startswith("."))

    def per_class_count(self) -> dict[str, int]:
        """由 labels/ 統計各類別標註數；無標註時全為 0。"""
        counts = {name: 0 for name in PROP_CLASS_CONTRACT}
        if not self.labels_dir.is_dir():
            return counts
        for label_file in self.labels_dir.iterdir():
            if label_file.name.startswith("."):
                continue
            try:
                lines = [line.strip() for line in label_file.read_text(encoding="utf-8").splitlines() if line.strip()]
            except OSError:
                continue
            for line in lines:
                parts = line.split()
                if not parts:
                    continue
                try:
                    index = int(float(parts[0]))
                except ValueError:
                    continue
                if 0 <= index < len(PROP_CLASS_CONTRACT):
                    counts[PROP_CLASS_CONTRACT[index]] += 1
        return counts

    def available(self) -> bool:
        """驗證集是否可用：需 manifest 契約正確、已凍結、教師確認，且 images 內含真實樣本。"""
        if not self.manifest_path.is_file():
            return False
        if not self.contract_ok():
            return False
        if not self.frozen:
            return False
        if self.review_status != "TEACHER_CONFIRMED":
            return False
        return self.image_count() > 0


def runtime_status() -> dict[str, Any]:
    """探測真實模型執行環境；只偵測不安裝，未就绪即不得執行模型。"""
    import importlib.util

    probe: dict[str, Any] = {}
    for name in ("ultralytics", "torch"):
        spec = importlib.util.find_spec(name)
        probe[name] = "MISSING" if spec is None else "AVAILABLE"
    probe["ready"] = all(value == "AVAILABLE" for value in (probe["ultralytics"], probe["torch"]))
    return probe


def _resolve_model_path(model_reference: str) -> Path | None:
    """解析 submission 的 file_reference 為實體 .pt 路徑。"""
    reference = str(model_reference or "").strip()
    if not reference:
        return None
    if reference.startswith("file://"):
        return Path(reference[len("file://"):])
    candidate = Path(reference)
    if candidate.is_absolute():
        return candidate
    # dev-upload://best.pt → 於模型附件目錄尋找同名檔案。
    filename = reference.split("://")[-1]
    return DEFAULT_MODEL_ARTIFACT_ROOT / filename


def _sha256_file(path: Path) -> str:
    """計算模型檔案 SHA256，供同一模型 + 同一 Golden Set 重複比對。"""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _default_model_loader(model_reference: str) -> Any:
    """預設模型載入：解析路徑後以 Ultralytics 載入，失敗即 MODEL_LOAD_FAILED。"""
    path = _resolve_model_path(model_reference)
    if path is None or not path.is_file():
        raise FileNotFoundError("model_file_not_found")
    from ultralytics import YOLO  # 延遲匯入：無 torch 環境不影響其他模組

    return YOLO(str(path))


def _model_classes(model: Any) -> list[str]:
    """讀取模型類別名稱；dict 依索引排序。"""
    names = getattr(model, "names", None)
    if isinstance(names, dict):
        return [str(names[key]) for key in sorted(names.keys())]
    if isinstance(names, (list, tuple)):
        return [str(item) for item in names]
    return []


def _extract_metrics(results: Any) -> dict[str, Any]:
    """自 Ultralytics 驗證結果取出必要指標。"""
    container = getattr(results, "box", None)
    if container is None:
        container = getattr(results, "results_dict", None) or {}

    def pick(*keys: str) -> float:
        for key in keys:
            value = container.get(key) if isinstance(container, dict) else getattr(container, key, None)
            if value is not None:
                return float(value)
        return 0.0

    return {
        "precision": round(pick("mp", "p", "precision"), 4),
        "recall": round(pick("mr", "r", "recall"), 4),
        "map50": round(pick("map50"), 4),
        "map50_95": round(pick("map", "map50_95"), 4),
        "per_class": {},
    }


def _default_evaluator(model: Any, validation_set: PropValidationSet) -> dict[str, Any]:
    """預設評估：使用 Ultralytics 內建驗證產生指標並量測推論時間。"""
    started = time.perf_counter()
    results = model.val(data=str(validation_set.manifest_path))
    metrics = _extract_metrics(results)
    metrics["inference_time_ms"] = round((time.perf_counter() - started) * 1000, 2)
    return metrics


class PropBenchmarkSandbox:
    """PROP 模型 Sandbox 驗證：類別契約檢查 + 標準驗證集 Benchmark。

    完全隔離：不觸碰 Production / A06 / Hover，不自動啟用或部署。
    """

    def __init__(self, model_loader=None, validation_set=None, policy=None, evaluator=None, runtime_probe=None) -> None:
        self._load_model: Callable[[str], Any] = model_loader or _default_model_loader
        self._validation_set = validation_set if validation_set is not None else PropValidationSet()
        self._policy = policy or BenchmarkPolicy()
        self._evaluate = evaluator or _default_evaluator
        self._runtime_probe: Callable[[], dict[str, Any]] = runtime_probe or runtime_status
        self._records: dict[str, list[dict[str, Any]]] = {}

    def validation_set_status(self) -> dict[str, Any]:
        """回報標準驗證集可用性，供教師介面顯示。"""
        available = bool(self._validation_set is not None and self._validation_set.available())
        return {
            "validation_set": self._validation_set.version if self._validation_set else "NONE",
            "available": available,
        }

    def history(self, submission_id: str) -> list[dict[str, Any]]:
        """同一 submission 可重複 Benchmark，保留最小歷史。"""
        return list(self._records.get(str(submission_id), []))

    def run(self, submission: dict[str, Any], teacher_id: str) -> dict[str, Any]:
        """執行一次 Sandbox Benchmark：載入 → 類別契約 → 驗證集 → 指標。"""
        submission_id = str(submission.get("evidence_id") or "")
        model_reference = str(submission.get("file_reference") or "")
        record = BenchmarkRecord(
            benchmark_id=f"bm-{uuid.uuid4().hex[:12]}",
            submission_id=submission_id,
            model_reference=model_reference,
            validation_set_version=self._validation_set.version if self._validation_set else "NONE",
            class_contract_version=CLASS_CONTRACT_VERSION,
            model_classes=(),
            metrics={},
            status=BenchmarkStatus.RUNNING.value,
            created_at=utc_now_iso(),
            teacher_id=str(teacher_id or "MOCK_TEACHER"),
        )
        # 先探測真實執行環境；runtime 未就绪時不得執行模型，直接判定載入失敗。
        runtime = self._runtime_probe()
        runtime_version = f"ultralytics={runtime['ultralytics']};torch={runtime['torch']}"
        record = replace(record, runtime_version=runtime_version)
        if not runtime["ready"]:
            return self._store(replace(record, status=BenchmarkStatus.MODEL_LOAD_FAILED.value))

        # 記錄真實模型檔案雜湊（沒有真實檔案時為 NOT_AVAILABLE，不偽造）
        model_path = _resolve_model_path(model_reference)
        model_hash = _sha256_file(model_path) if model_path is not None and model_path.is_file() else "NOT_AVAILABLE"
        record = replace(record, model_file_hash=model_hash)

        # 安全載入模型（僅此處允許執行，隔離於 Production / A06）
        try:
            model = self._load_model(model_reference)
        except Exception:
            return self._store(replace(record, status=BenchmarkStatus.MODEL_LOAD_FAILED.value))

        # 嚴格比對 PROP 類別契約（含順序）；舊模型類別一律不通過。
        classes = tuple(_model_classes(model))
        if classes != PROP_CLASS_CONTRACT:
            return self._store(
                replace(record, model_classes=classes, status=BenchmarkStatus.INCOMPATIBLE_CLASSES.value)
            )

        # 標準驗證集不可用：不偽造 PASS，改為等待 Golden Set。
        if self._validation_set is None or not self._validation_set.available():
            return self._store(
                replace(record, model_classes=classes, status=BenchmarkStatus.WAITING_FOR_GOLDEN_SET.value)
            )

        # 使用標準驗證集執行 Sandbox Benchmark
        try:
            metrics = dict(self._evaluate(model, self._validation_set))
        except Exception:
            return self._store(replace(record, model_classes=classes, status=BenchmarkStatus.ERROR.value))

        status = self._policy.decide(metrics)
        return self._store(replace(record, model_classes=classes, metrics=metrics, status=status))

    def _store(self, record: BenchmarkRecord) -> dict[str, Any]:
        """保存 Benchmark 結果（記憶體內；不改 Production）。"""
        payload = asdict(record)
        self._records.setdefault(record.submission_id, []).append(payload)
        return payload
