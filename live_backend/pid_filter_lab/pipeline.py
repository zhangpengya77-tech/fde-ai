"""完整分析流程：解析 → 控制分析 → 八大健康 → 調參建議。"""

from __future__ import annotations

from . import adapters
from .analysis import control, health
from .model import ALGORITHM_VERSION
from .rules import advisor

PIPELINE_VERSION = "pidlab-pipeline/1.0"


def run(data: bytes, expected_ecosystem: str | None = None, extra_params: dict | None = None) -> dict:
    fd = adapters.adapt(data, expected_ecosystem)
    if extra_params:
        # 學員匯入的參數檔優先於日誌快照（但保留日誌值以便比對）
        fd.params = {**fd.params, **extra_params}
        fd.param_source = f"{fd.param_source} + 匯入參數檔"
    ctl = control.analyze(fd)
    hl = health.evaluate(fd, ctl)
    adv = advisor.advise(fd, ctl, hl)
    return {
        "pipeline_version": PIPELINE_VERSION,
        "algorithm_version": ALGORITHM_VERSION,
        "flight": fd.summary(),
        "control": ctl,
        "health": hl,
        "advice": adv,
        "param_snapshot": {k: fd.params[k] for k in sorted(fd.params)[:3000]},
    }
