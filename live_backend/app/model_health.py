"""模型健康度檢查（D1，2026-10-20）。

目的：把「這個 .pt 到底能不能用來辨識」變成可判定、可顯示、可阻擋的事實，
而不是只看 `names` 有幾個字串就當成合格模型。

判定來源全部是 **checkpoint 內部事實**，不猜、不靠檔名、不靠 class_names 欄位：

- `nc`：偵測頭（Detect）實際輸出通道數。`nc=80` 代表這是 COCO 頭。
- `class_names`：checkpoint 內 `model.names`。
- `has_train_args` / `has_epoch` / `has_metrics`：有無訓練痕跡。
  未經訓練的空殼（例如把 yolov8n/yolo11n 的 names 改寫成 4 個槳葉名）
  這三項全為 False。
- `map50`：`train_metrics["metrics/mAP50(B)"]`。
- `train_imgsz`：`train_args["imgsz"]`。

四種判定（優先序由高到低）：

1. `UNTRAINED`   沒有任何訓練痕跡 → 權重是隨機初始化的空殼，任何圖片都不會有框。
2. `NC_MISMATCH` 偵測頭 `nc` 與 `names` 數量不符 → 類別契約不可信。
3. `LOW_QUALITY` mAP50 低於門檻，或訓練過但沒有可用的 mAP50 可證明品質。
4. `OK`         訓練痕跡完整且 mAP50 ≥ 門檻。

另有 `UNKNOWN`（無法讀取 checkpoint，例如測試用假檔、檔案損壞）。`UNKNOWN`
**不阻擋任何流程**，只讓畫面顯示「無法判定」——因為無法證明有問題時不應誤擋。
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from pathlib import Path

HEALTH_UNTRAINED = "UNTRAINED"
HEALTH_NC_MISMATCH = "NC_MISMATCH"
HEALTH_LOW_QUALITY = "LOW_QUALITY"
HEALTH_OK = "OK"
HEALTH_UNKNOWN = "UNKNOWN"

ALL_HEALTH_STATES = (
    HEALTH_UNTRAINED,
    HEALTH_NC_MISMATCH,
    HEALTH_LOW_QUALITY,
    HEALTH_OK,
    HEALTH_UNKNOWN,
)

# 阻擋匯入／啟用的健康度（UNKNOWN 不在此列：無法判定不等於有問題）
BLOCKING_HEALTH_STATES = (HEALTH_UNTRAINED, HEALTH_NC_MISMATCH)

DEFAULT_MAP50_THRESHOLD = 0.5
_MAP50_ENV = "FDE_MODEL_HEALTH_MAP50_THRESHOLD"

HEALTH_LABELS = {
    HEALTH_UNTRAINED: "未訓練",
    HEALTH_NC_MISMATCH: "類別數不符",
    HEALTH_LOW_QUALITY: "低品質",
    HEALTH_OK: "正常",
    HEALTH_UNKNOWN: "無法判定",
}

# 徽章配色沿用教師頁既有 .vc-badge 的語意（rejected / candidate / active / archived）
HEALTH_CSS = {
    HEALTH_UNTRAINED: "rejected",
    HEALTH_NC_MISMATCH: "rejected",
    HEALTH_LOW_QUALITY: "candidate",
    HEALTH_OK: "active",
    HEALTH_UNKNOWN: "archived",
}

HEALTH_NOTES = {
    HEALTH_UNTRAINED: "這個模型沒有任何訓練痕跡（無 train_args／epoch／metrics），權重是隨機初始化的空殼，無法用於辨識。",
    HEALTH_NC_MISMATCH: "模型偵測頭的類別數（nc）與類別名稱數量不一致，類別契約不可信，無法用於辨識。",
    HEALTH_LOW_QUALITY: "模型訓練品質低於門檻（mAP50 不足或無可證明的 mAP50），不建議作為正式模型。",
    HEALTH_OK: "模型訓練痕跡完整且 mAP50 達門檻。",
    HEALTH_UNKNOWN: "無法讀取此模型的 checkpoint 資訊，健康度無法判定。",
}


class ModelHealthInspectionError(RuntimeError):
    """checkpoint 無法解析（不是合法 torch checkpoint 等）。"""


def map50_threshold(explicit: float | None = None) -> float:
    """mAP50 門檻：呼叫端指定 > 環境變數 > 預設 0.5。"""
    if explicit is not None:
        return float(explicit)
    raw = os.environ.get(_MAP50_ENV, "").strip()
    if raw:
        try:
            return float(raw)
        except ValueError:
            pass
    return DEFAULT_MAP50_THRESHOLD


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _names_from_model(model) -> list[str]:
    names = getattr(model, "names", None)
    if isinstance(names, dict):
        return [str(names[key]) for key in sorted(names)]
    if names:
        return [str(item) for item in names]
    return []


def _head_nc(model) -> int | None:
    """偵測頭實際的類別通道數；取不到回 None（不可推論成 0）。"""
    try:
        head = model.model[-1]
    except (AttributeError, IndexError, TypeError):
        return None
    for attr in ("nc",):
        value = getattr(head, attr, None)
        if isinstance(value, int) and value > 0:
            return value
    # 退化情況：從分類分支的最後一層 out_channels 推回
    cv2 = getattr(head, "cv2", None)
    if cv2 is not None:
        try:
            return int(cv2[-1][-1].out_channels)
        except (AttributeError, IndexError, TypeError):
            return None
    return None


def _metrics_map50(ckpt: dict) -> float | None:
    metrics = ckpt.get("train_metrics")
    if isinstance(metrics, dict):
        value = _as_float(metrics.get("metrics/mAP50(B)"))
        if value is not None:
            return value
    results = ckpt.get("train_results")
    if isinstance(results, dict):
        value = _as_float(results.get("metrics/mAP50(B)"))
        if value is not None:
            return value
    return None


def _classify(facts: dict, threshold: float) -> tuple[str, list[str]]:
    """依優先序回傳 (health, reasons)。"""
    reasons: list[str] = []
    # 無法解析的 checkpoint（inspection_failed）一律維持 UNKNOWN：
    # 快取命中時會重新分類，若無此守門，第一次 UNKNOWN、第二次會被誤判為
    # UNTRAINED（has_train_args=False 等），造成同一檔案判定不一致。
    if facts.get("inspection_error") or "inspection_failed" in (facts.get("reasons") or []):
        return HEALTH_UNKNOWN, list(facts.get("reasons") or ["inspection_failed"])
    if not (facts["has_train_args"] or facts["has_epoch"] or facts["has_metrics"]):
        reasons.append("no_training_metadata")
    nc = facts.get("nc")
    names_count = facts.get("names_count") or 0
    if isinstance(nc, int) and nc != names_count:
        reasons.append("nc_mismatch")
    map50 = facts.get("map50")
    if map50 is None:
        reasons.append("map50_unknown")
    elif map50 < threshold:
        reasons.append("map50_below_threshold")

    if "no_training_metadata" in reasons:
        return HEALTH_UNTRAINED, reasons
    if "nc_mismatch" in reasons:
        return HEALTH_NC_MISMATCH, reasons
    if "map50_unknown" in reasons or "map50_below_threshold" in reasons:
        return HEALTH_LOW_QUALITY, reasons
    return HEALTH_OK, reasons


_CACHE: dict[tuple[str, int, int], dict] = {}
_CACHE_LIMIT = 256


def clear_cache() -> None:
    _CACHE.clear()


def _cache_key(path: Path) -> tuple[str, int, int]:
    stat = path.stat()
    return (str(path), int(stat.st_mtime_ns), int(stat.st_size))


def inspect_model_health(
    path: Path | str,
    *,
    map50_threshold_value: float | None = None,
    use_cache: bool = True,
) -> dict:
    """讀取 checkpoint 事實並判定健康度。

    回傳 dict 一律包含 `health`、`reasons`、`map50_threshold` 與各項事實；
    無法解析時回傳 `health="UNKNOWN"`（不拋例外），讓呼叫端可以照常運作。
    """
    path = Path(path)
    threshold = map50_threshold(map50_threshold_value)
    try:
        key = _cache_key(path)
    except OSError as exc:
        raise ModelHealthInspectionError(f"model_file_unreadable:{exc}") from exc

    if use_cache and key in _CACHE:
        cached = dict(_CACHE[key])
        cached["map50_threshold"] = threshold
        # 門檻可能被呼叫端覆寫，需依新門檻重新判定
        cached["health"], cached["reasons"] = _classify(cached, threshold)
        return cached

    facts: dict = {
        "health": HEALTH_UNKNOWN,
        "reasons": [],
        "path": str(path),
        "file_size": key[2],
        "nc": None,
        "class_names": [],
        "names_count": 0,
        "has_train_args": False,
        "has_epoch": False,
        "has_metrics": False,
        "map50": None,
        "precision": None,
        "recall": None,
        "train_imgsz": None,
        "train_epochs": None,
        "arch": "",
        "map50_threshold": threshold,
        "inspected_at": _iso_now(),
    }
    try:
        import torch

        ckpt = torch.load(str(path), map_location="cpu", weights_only=False)
    except Exception as exc:  # noqa: BLE001 - 任何載入失敗都只代表「無法判定」
        facts["inspection_error"] = f"{type(exc).__name__}: {exc}"[:300]
        if use_cache:
            _remember(key, facts)
        return facts

    try:
        model = ckpt.get("model") if isinstance(ckpt, dict) else ckpt
        train_args = ckpt.get("train_args") if isinstance(ckpt, dict) else None
        metrics = ckpt.get("train_metrics") if isinstance(ckpt, dict) else None
        class_names = _names_from_model(model) if model is not None else []
        facts.update(
            class_names=class_names,
            names_count=len(class_names),
            nc=_head_nc(model) if model is not None else None,
            has_train_args=isinstance(train_args, dict) and bool(train_args),
            has_epoch=isinstance(ckpt, dict) and "epoch" in ckpt,
            has_metrics=isinstance(metrics, dict) and bool(metrics),
            map50=_metrics_map50(ckpt) if isinstance(ckpt, dict) else None,
            train_imgsz=int(train_args["imgsz"]) if isinstance(train_args, dict) and train_args.get("imgsz") else None,
            train_epochs=int(train_args["epochs"]) if isinstance(train_args, dict) and train_args.get("epochs") else None,
            arch=str(getattr(model, "yaml", {}).get("yaml_file") or "") if model is not None else "",
        )
        if isinstance(metrics, dict):
            facts["precision"] = _as_float(metrics.get("metrics/precision(B)"))
            facts["recall"] = _as_float(metrics.get("metrics/recall(B)"))
        facts["health"], facts["reasons"] = _classify(facts, threshold)
    except Exception as exc:  # noqa: BLE001 - 解析失敗 → 無法判定，不阻擋
        facts["health"] = HEALTH_UNKNOWN
        facts["reasons"] = ["inspection_failed"]
        facts["inspection_error"] = f"{type(exc).__name__}: {exc}"[:300]

    if use_cache:
        _remember(key, facts)
    return facts


def _remember(key: tuple[str, int, int], facts: dict) -> None:
    if len(_CACHE) >= _CACHE_LIMIT:
        _CACHE.clear()
    _CACHE[key] = dict(facts)


def summarize(facts: dict) -> dict:
    """給紀錄／API 用的精簡版（不含 path 等內部欄位）。"""
    facts = facts or {}
    health = facts.get("health") or HEALTH_UNKNOWN
    return {
        "health": health,
        "health_label": HEALTH_LABELS.get(health, health),
        "health_css": HEALTH_CSS.get(health, "archived"),
        "health_note": HEALTH_NOTES.get(health, ""),
        "health_reasons": list(facts.get("reasons") or []),
        "nc": facts.get("nc"),
        "names_count": facts.get("names_count"),
        "map50": facts.get("map50"),
        "map50_threshold": facts.get("map50_threshold", map50_threshold()),
        "has_train_args": bool(facts.get("has_train_args")),
        "has_epoch": bool(facts.get("has_epoch")),
        "has_metrics": bool(facts.get("has_metrics")),
        "train_imgsz": facts.get("train_imgsz"),
        "train_epochs": facts.get("train_epochs"),
        "arch": facts.get("arch") or "",
        "inspected_at": facts.get("inspected_at") or "",
    }


def is_blocking(facts: dict) -> bool:
    return (facts or {}).get("health") in BLOCKING_HEALTH_STATES


def blocking_error_code(facts: dict) -> str:
    health = (facts or {}).get("health")
    if health == HEALTH_UNTRAINED:
        return "model_untrained"
    if health == HEALTH_NC_MISMATCH:
        return "model_nc_mismatch"
    return ""


def describe_for_teacher(facts: dict) -> str:
    """一句給教師看的中文原因（含具體數字）。"""
    facts = facts or {}
    health = facts.get("health") or HEALTH_UNKNOWN
    if health == HEALTH_UNTRAINED:
        return (
            "模型沒有任何訓練痕跡（無 train_args／epoch／metrics），"
            "權重是隨機初始化的空殼，無法用於辨識。"
        )
    if health == HEALTH_NC_MISMATCH:
        return (
            f"模型偵測頭的類別數 nc={facts.get('nc')} 與類別名稱數量 "
            f"{facts.get('names_count')} 不一致，類別契約不可信。"
        )
    if health == HEALTH_LOW_QUALITY:
        map50 = facts.get("map50")
        threshold = facts.get("map50_threshold", map50_threshold())
        if map50 is None:
            return f"模型沒有可證明的 mAP50（需 ≥ {threshold}），無法證明辨識品質。"
        return f"模型 mAP50={round(float(map50), 4)} 低於門檻 {threshold}，辨識品質不足。"
    if health == HEALTH_OK:
        return f"模型健康度正常（mAP50={round(float(facts.get('map50') or 0), 4)}）。"
    return "無法讀取模型資訊，健康度無法判定。"


def timed(fn, *args, **kwargs):
    """測試輔助：回傳 (結果, 耗時秒數)。"""
    started = time.perf_counter()
    result = fn(*args, **kwargs)
    return result, time.perf_counter() - started
