"""即時鏡頭檢測：提供「教師已啟用（ACTIVE）」槳葉模型的 ONNX 給瀏覽器端推論（2026-11-08）。

只讀不寫：不建立難例、不改模型狀態、不放寬任何啟用門檻。
瀏覽器只能拿到同時符合下列條件的 ONNX，任何一項不符就拒絕：
  1. PROP_DIRECTION 有 ACTIVE 模型（教師依既有驗證閘門啟用的那一個）
  2. 該模型類別恰好是規範類別（CW、CCW）——沿用既有的類別名稱閘門
  3. 與 best.pt 同目錄有 best.onnx 與 best.onnx.json（由 tools/export_prop_live_onnx.py 產生）
  4. best.onnx.json 記錄的來源 SHA-256 等於 ACTIVE 模型的 file_hash（ONNX 確實由這個 .pt 轉出）
  5. best.onnx 的實際 SHA-256 等於 best.onnx.json 記錄值（檔案未被替換）
  6. best.onnx.json 的類別與 ACTIVE 模型類別一致
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ONNX_NAME = "best.onnx"
SIDECAR_NAME = "best.onnx.json"
MODEL_TYPE = "PROP_DIRECTION"


class PropLiveModelError(Exception):
    """即時模型不可用的原因（code 給前端顯示對應的中文提示）。"""

    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code = code
        self.status = status


_sha_cache: dict[tuple[str, int, int], str] = {}


def file_sha256(path: Path) -> str:
    """計算檔案 SHA-256；以 (路徑, 大小, 修改時間) 快取，檔案一變動就重算。"""
    stat = path.stat()
    key = (str(path), stat.st_size, stat.st_mtime_ns)
    if key not in _sha_cache:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
        _sha_cache.clear()
        _sha_cache[key] = digest.hexdigest()
    return _sha_cache[key]


def resolve_live_model(center, expected_class_names: list[str]) -> dict:
    """回傳可供瀏覽器使用的 ACTIVE 模型資訊（含 ONNX 路徑）；不符合條件時丟出 PropLiveModelError。"""
    model = center.active_model(MODEL_TYPE)
    if model is None or model.get("status") != "ACTIVE":
        raise PropLiveModelError("no_active_model", 404)
    class_names = [str(name) for name in model.get("class_names") or []]
    if class_names != list(expected_class_names):
        raise PropLiveModelError("model_class_names_mismatch", 409)
    folder = Path(model["file_path"]).parent
    onnx_path, sidecar_path = folder / ONNX_NAME, folder / SIDECAR_NAME
    if not onnx_path.is_file() or not sidecar_path.is_file():
        raise PropLiveModelError("live_model_not_prepared", 404)
    try:
        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise PropLiveModelError("live_model_not_prepared", 404) from None
    if str(sidecar.get("source_sha256", "")).lower() != str(model.get("file_hash", "")).lower():
        raise PropLiveModelError("live_model_source_mismatch", 409)
    if [str(name) for name in sidecar.get("class_names") or []] != class_names:
        raise PropLiveModelError("model_class_names_mismatch", 409)
    onnx_sha = file_sha256(onnx_path)
    if onnx_sha != str(sidecar.get("onnx_sha256", "")).lower():
        raise PropLiveModelError("live_model_hash_mismatch", 409)
    return {
        "model_id": model["model_id"],
        "model_version": model.get("version"),
        "class_names": class_names,
        "onnx_sha256": onnx_sha,
        "onnx_bytes": onnx_path.stat().st_size,
        "dynamic_input": bool(sidecar.get("dynamic", False)),
        "default_imgsz": int(sidecar.get("imgsz") or 640),
        "onnx_url": "/api/v1/vision/prop-live/model.onnx",
        "_onnx_path": str(onnx_path),
    }


def public_info(info: dict) -> dict:
    """去掉伺服器內部路徑後回給前端。"""
    return {key: value for key, value in info.items() if not key.startswith("_")}
