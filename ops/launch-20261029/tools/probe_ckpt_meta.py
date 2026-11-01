"""唯讀探測：讀取 demo PROP_DIRECTION 模型 checkpoint 的訓練痕跡。

目的：核實四類模型的來源/訓練紀錄/權重 SHA-256/獨立測試指標，
不依賴 train_args 單一欄位判斷是否訓練過。

注意：此腳本只讀本專案 demo 目錄下的自有模型（非使用者上傳），
離線執行，不屬於 Web Request 內的不可信輸入處理路徑。
"""
from __future__ import annotations

import hashlib
import json
import os

import torch

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
MODELS = [
    "PROP_20261023_DEMO-A_v1",
    "PROP_20261024_DEMO-A_v1",
    "PROP_20261023_X_v1",
    "PROP_20261024_X_v1",
]


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def summarize(path: str) -> dict:
    out: dict = {"path": path, "exists": os.path.exists(path)}
    if not out["exists"]:
        return out
    out["sha256"] = sha256(path)
    out["bytes"] = os.path.getsize(path)
    try:
        ckpt = torch.load(path, map_location="cpu", weights_only=False)
    except Exception as exc:  # noqa: BLE001
        out["load_error"] = f"{type(exc).__name__}: {exc}"
        return out
    if not isinstance(ckpt, dict):
        out["ckpt_type"] = type(ckpt).__name__
        return out
    out["ckpt_keys"] = sorted(ckpt.keys())
    model = ckpt.get("model")
    names = getattr(model, "names", None)
    if isinstance(names, dict):
        out["model_names"] = {str(k): v for k, v in names.items()}
    elif isinstance(names, (list, tuple)):
        out["model_names"] = {str(i): n for i, n in enumerate(names)}
    yaml = getattr(model, "yaml", None)
    if isinstance(yaml, dict):
        out["yaml_nc"] = yaml.get("nc")
        out["yaml_names"] = yaml.get("names")
    tm = ckpt.get("train_metrics")
    out["train_metrics"] = tm if isinstance(tm, (dict, list)) else (str(type(tm)) if tm is not None else None)
    results = ckpt.get("results")
    if results is not None:
        try:
            out["results_summary"] = {
                "epochs": getattr(results, "epoch", None),
                "keys": sorted(results.keys())[:40] if isinstance(results, dict) else str(type(results)),
            }
        except Exception:  # noqa: BLE001
            out["results_summary"] = str(type(results))
    ta = ckpt.get("train_args")
    out["train_args"] = ta if ta is None else (ta if isinstance(ta, dict) else str(type(ta)))
    out["epoch"] = ckpt.get("epoch")
    out["date"] = ckpt.get("date")
    out["version"] = ckpt.get("version")
    out["optimizer"] = str(type(ckpt.get("optimizer"))).split(".")[-1].strip("'>") if ckpt.get("optimizer") is not None else None
    return out


def main() -> None:
    rows = []
    for name in MODELS:
        p = os.path.join(ROOT, "demo", "runtime", "vision-center", "model_registry", "prop_direction", name, "best.pt")
        rows.append({"model_id": name, **summarize(p)})
    print(json.dumps(rows, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
