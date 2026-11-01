"""PROP_ROTATION_V5 的短時子程序推論邊界。

Live Web 程序不直接反序列化 V5 checkpoint。此 adapter 每次建立獨立暫存目錄，
將圖片交給 worker、限制等待時間、清除 proxy／秘密環境變數，並只接受 JSON
結果。真正的 OS 層網路封鎖仍需由預發布 Windows Sandbox 或容器提供。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


class RotationSandboxError(RuntimeError):
    """隔離 V5 推論無法安全完成。"""


class RotationSandboxRunner:
    """以受控子程序執行單張 PROP_ROTATION_V5 推論。"""

    def __init__(
        self, *, python_executable: str | None = None, worker_path: Path | None = None,
        expected_model_sha256: str, timeout_seconds: int = 45,
    ):
        self.python_executable = python_executable or sys.executable
        self.worker_path = worker_path or Path(__file__).with_name("rotation_sandbox_worker.py")
        self.expected_model_sha256 = str(expected_model_sha256).lower()
        self.timeout_seconds = int(timeout_seconds)

    @staticmethod
    def _safe_environment() -> dict[str, str]:
        """只保留執行所需環境，禁止 child 繼承 proxy 或 FDE 秘密。"""
        # PyTorch 會使用 USERNAME 推導編譯快取資料夾；它不是認證秘密，缺少時
        # 會讓 worker 在載入模型前失敗。仍不繼承任何 FDE_* 或 proxy 設定。
        keep = ("SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "USERNAME")
        env = {key: value for key in keep if (value := os.environ.get(key))}
        env.update({
            "PYTHONNOUSERSITE": "1",
            "NO_PROXY": "*",
            "no_proxy": "*",
            "HTTP_PROXY": "",
            "HTTPS_PROXY": "",
            "ALL_PROXY": "",
        })
        return env

    def infer(self, *, model_path: Path, image_bytes: bytes, actual_model_sha256: str) -> dict:
        """輸入已驗證模型雜湊與一張照片，回傳已正規化的偵測結果。"""
        if str(actual_model_sha256).lower() != self.expected_model_sha256:
            raise RotationSandboxError("model_sha256_mismatch")
        path = Path(model_path)
        if not path.is_file():
            raise RotationSandboxError("model_file_unreadable")
        if not image_bytes:
            raise RotationSandboxError("image_required")
        if not Path(self.worker_path).is_file():
            raise RotationSandboxError("sandbox_worker_missing")

        with tempfile.TemporaryDirectory(prefix="fde-rotation-v5-") as temp:
            root = Path(temp)
            image_path = root / "input-image.bin"
            output_path = root / "result.json"
            image_path.write_bytes(image_bytes)
            command = [
                self.python_executable, "-I", str(self.worker_path),
                "--model", str(path), "--image", str(image_path), "--output", str(output_path),
            ]
            try:
                completed = subprocess.run(
                    command, cwd=str(root), env=self._safe_environment(), stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=self.timeout_seconds,
                    check=False, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            except subprocess.TimeoutExpired as exc:
                raise RotationSandboxError("sandbox_timeout") from exc
            if completed.returncode != 0 or not output_path.is_file():
                raise RotationSandboxError("sandbox_inference_failed")
            try:
                payload = json.loads(output_path.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise RotationSandboxError("sandbox_result_invalid") from exc
        if not isinstance(payload, dict) or payload.get("class_names") != ["CW", "CCW"]:
            raise RotationSandboxError("sandbox_result_contract_invalid")
        detections = payload.get("detections")
        if not isinstance(detections, list):
            raise RotationSandboxError("sandbox_result_contract_invalid")
        return {
            "class_names": ["CW", "CCW"], "detections": detections,
            "image_width": int(payload.get("image_width") or 0),
            "image_height": int(payload.get("image_height") or 0),
        }
