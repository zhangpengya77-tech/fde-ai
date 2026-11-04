"""三套飛控適配器共同輸出的統一中間資料結構。

所有時間序列一律：時間單位秒（float64，自日誌起點起算）、角速度 deg/s、角度 deg、
馬達輸出正規化 0..1、電壓 V、電流 A。每個訊號都標示來源欄位與是否為推導值。
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

ALGORITHM_VERSION = "pidlab-analysis/1.0"
AXES = ("roll", "pitch", "yaw")

ECOSYSTEMS = {
    "betaflight": "Betaflight",
    "ardupilot": "ArduPilot",
    "px4": "PX4",
    "other": "其他飛控",
}


@dataclass
class Signal:
    t: np.ndarray
    v: np.ndarray
    unit: str
    source: str
    derived: bool = False
    note: str = ""

    def __post_init__(self) -> None:
        t = np.asarray(self.t, dtype=np.float64)
        v = np.asarray(self.v, dtype=np.float64)
        n = min(len(t), len(v))
        t, v = t[:n], v[:n]
        mask = np.isfinite(t) & np.isfinite(v)
        t, v = t[mask], v[mask]
        if len(t) > 1 and np.any(np.diff(t) < 0):
            order = np.argsort(t, kind="stable")
            t, v = t[order], v[order]
        self.t, self.v = t, v

    @property
    def rate_hz(self) -> float:
        if len(self.t) < 3:
            return 0.0
        dt = np.median(np.diff(self.t))
        return float(1.0 / dt) if dt > 0 else 0.0

    @property
    def duration(self) -> float:
        return float(self.t[-1] - self.t[0]) if len(self.t) > 1 else 0.0

    def describe(self) -> dict:
        return {
            "unit": self.unit,
            "source": self.source,
            "derived": self.derived,
            "note": self.note,
            "samples": int(len(self.t)),
            "rate_hz": round(self.rate_hz, 1),
            "duration_s": round(self.duration, 2),
        }


@dataclass
class FlightData:
    ecosystem: str
    vehicle_type: str  # multirotor / plane / rover / unknown
    firmware: dict
    hardware: dict
    params: dict[str, float]
    param_source: str
    signals: dict[str, Signal] = field(default_factory=dict)
    events: list[dict] = field(default_factory=list)
    modes: list[dict] = field(default_factory=list)
    flags: dict = field(default_factory=dict)  # 例如 gps_configured / autotune_present
    log_metadata: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def sig(self, name: str) -> Signal | None:
        s = self.signals.get(name)
        return s if s is not None and len(s.t) > 1 else None

    def add(self, name: str, t, v, unit: str, source: str, derived: bool = False, note: str = "") -> None:
        s = Signal(t, v, unit, source, derived, note)
        if len(s.t) > 1:
            self.signals[name] = s

    def available_signals(self) -> dict:
        return {k: s.describe() for k, s in sorted(self.signals.items())}

    def summary(self) -> dict:
        return {
            "flight_controller_type": self.ecosystem,
            "vehicle_type": self.vehicle_type,
            "firmware_version": self.firmware,
            "hardware": self.hardware,
            "parameter_snapshot": {"source": self.param_source, "count": len(self.params)},
            "log_metadata": self.log_metadata,
            "available_signals": self.available_signals(),
            "events": self.events[:200],
            "modes": self.modes[:200],
            "flags": self.flags,
            "warnings": self.warnings,
        }


def parse_version(text: str) -> tuple[int, int, int] | None:
    import re

    m = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", text or "")
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
