"""以獨立子程序呼叫 Live 的 POWER_INSPECTION_V1 worker；Django 不載入模型。"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

from django.conf import settings


class PowerWorkerError(RuntimeError):
    """隔離 worker 失敗；訊息只含安全代碼。"""


def _allowed_root() -> Path:
    return Path(settings.MEDIA_ROOT) / "power_inspection"


def _manifest(model) -> dict:
    manifest = dict(model.delivery_manifest or {})
    manifest.update({
        "task_type": model.task_type,
        "model_name": model.model_name,
        "version": model.version,
        "artifact_path": model.artifact.path,
        "sha256": model.sha256 or manifest.get("artifact_sha256", ""),
        "class_names": list(model.class_contract or []),
    })
    if model.data_yaml:
        manifest["data_yaml_path"] = model.data_yaml.path
    return manifest


def _run_worker(model, *, video_path: Path | None = None, confidence: float | None = None) -> dict:
    python = settings.POWER_INSPECTION_WORKER_PYTHON
    if not python or not Path(python).is_file():
        raise PowerWorkerError("power_worker_python_missing")
    root = _allowed_root()
    root.mkdir(parents=True, exist_ok=True)
    # 工作檔必須在 allowed root 內，worker 才會接受；結束後自動清除。
    with tempfile.TemporaryDirectory(prefix="worker-", dir=root) as work_dir:
        manifest_path = Path(work_dir) / "manifest.json"
        output_path = Path(work_dir) / "output.json"
        manifest_path.write_text(json.dumps(_manifest(model), ensure_ascii=False), encoding="utf-8")
        command = [
            python, "-m", "app.power_inspection_worker",
            "--manifest", str(manifest_path), "--allowed-root", str(root), "--output", str(output_path),
        ]
        if video_path is not None:
            command += ["--video", str(video_path)]
        if confidence is not None:
            command += ["--confidence", str(confidence)]
        completed = subprocess.run(
            command, cwd=settings.POWER_INSPECTION_LIVE_DIR, env={**os.environ, "YOLO_OFFLINE": "true"},
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=settings.POWER_INSPECTION_WORKER_TIMEOUT, check=False,
        )
        if completed.returncode != 0 or not output_path.is_file():
            code = next(
                (line.rsplit(":", 1)[-1].strip() for line in completed.stdout.splitlines() if line.startswith("power_inspection_worker_failed:")),
                "power_worker_failed",
            )
            raise PowerWorkerError(code[:120])
        return json.loads(output_path.read_text(encoding="utf-8"))


def verify_model(model) -> dict:
    """由隔離 worker 實際載入並核對類別；Web 程序只保存結果。"""
    return _run_worker(model)


def run_job(job) -> dict:
    """process_next_job 使用的 real_runner；只分析工作建立時綁定的模型。"""
    config = job.rule_config if isinstance(job.rule_config, dict) else {}
    return _run_worker(job.model, video_path=Path(job.video.path), confidence=config.get("confidence_threshold"))
