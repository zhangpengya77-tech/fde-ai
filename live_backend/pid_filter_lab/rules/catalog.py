"""各飛控生態「獨立」的參數目錄。

原則：
1. 三套飛控的參數名稱、範圍與匯出格式完全分開，互不套用。
2. 只建議「日誌參數快照（或匯入的參數檔）中實際存在」的參數——這是版本驗證的第一道關卡。
3. 目錄中的版本範圍與數值範圍是第二道關卡；不在範圍內的韌體一律不產生可匯出數值。
範圍取自各專案官方參數文件的常見上下限，保守設定；未列入目錄的參數不會被建議。
"""

from __future__ import annotations

from dataclasses import dataclass

AXIS_CODES = {
    "betaflight": {"roll": "roll", "pitch": "pitch", "yaw": "yaw"},
    "ardupilot": {"roll": "RLL", "pitch": "PIT", "yaw": "YAW"},
    "ardupilot_legacy": {"roll": "RLL", "pitch": "PIT", "yaw": "YAW"},
    "px4": {"roll": "ROLL", "pitch": "PITCH", "yaw": "YAW"},
}


@dataclass(frozen=True)
class ParamSpec:
    name: str
    minimum: float
    maximum: float
    decimals: int
    min_version: tuple = (0, 0, 0)
    max_version: tuple = (99, 0, 0)
    ptype: str = "float"
    aliases: tuple = ()  # 參數快照中可能出現的其他鍵（例如 Blackbox 標頭鍵）

    def supports(self, version: tuple | None) -> bool:
        if version is None:
            return False
        return tuple(self.min_version) <= tuple(version) < tuple(self.max_version)

    def clamp(self, value: float) -> float:
        v = min(self.maximum, max(self.minimum, value))
        return round(v, self.decimals) if self.decimals else float(int(round(v)))


def _bf() -> dict[str, list[ParamSpec]]:
    specs: dict[str, list[ParamSpec]] = {}
    for axis in ("roll", "pitch", "yaw"):
        specs[f"p.{axis}"] = [ParamSpec(f"p_{axis}", 0, 250, 0, (3, 0, 0), ptype="int")]
        specs[f"i.{axis}"] = [ParamSpec(f"i_{axis}", 0, 250, 0, (3, 0, 0), ptype="int")]
        specs[f"d.{axis}"] = [ParamSpec(f"d_{axis}", 0, 250, 0, (3, 0, 0), ptype="int")]
        specs[f"ff.{axis}"] = [ParamSpec(f"f_{axis}", 0, 1000, 0, (4, 0, 0), ptype="int")]
    specs["gyro_lpf"] = [
        ParamSpec("gyro_lpf1_static_hz", 0, 1000, 0, (4, 3, 0), ptype="int"),
        ParamSpec("gyro_lowpass_hz", 0, 1000, 0, (3, 2, 0), (4, 3, 0), ptype="int"),
    ]
    specs["dterm_lpf"] = [
        ParamSpec("dterm_lpf1_static_hz", 0, 1000, 0, (4, 3, 0), ptype="int"),
        ParamSpec("dterm_lowpass_hz", 0, 1000, 0, (3, 2, 0), (4, 3, 0), ptype="int", aliases=("dterm_lpf_hz",)),
    ]
    return specs


def _ap() -> dict[str, list[ParamSpec]]:
    specs: dict[str, list[ParamSpec]] = {}
    ranges = {
        "RLL": {"P": (0.01, 0.5, 4), "I": (0.01, 2.0, 4), "D": (0.0, 0.05, 5), "FF": (0.0, 0.5, 4)},
        "PIT": {"P": (0.01, 0.5, 4), "I": (0.01, 2.0, 4), "D": (0.0, 0.05, 5), "FF": (0.0, 0.5, 4)},
        "YAW": {"P": (0.1, 2.5, 4), "I": (0.01, 1.0, 4), "D": (0.0, 0.02, 5), "FF": (0.0, 0.5, 4)},
    }
    for axis, code in AXIS_CODES["ardupilot"].items():
        for term, key in (("p", "P"), ("i", "I"), ("d", "D"), ("ff", "FF")):
            lo, hi, dec = ranges[code][key]
            specs[f"{term}.{axis}"] = [ParamSpec(f"ATC_RAT_{code}_{key}", lo, hi, dec, (3, 4, 0))]
        specs[f"dterm_lpf.{axis}"] = [ParamSpec(f"ATC_RAT_{code}_FLTD", 0, 100, 1, (3, 6, 0))]
    specs["gyro_lpf"] = [ParamSpec("INS_GYRO_FILTER", 0, 256, 0, (3, 4, 0), ptype="int")]
    specs["notch_enable"] = [ParamSpec("INS_HNTCH_ENABLE", 0, 1, 0, (4, 0, 0), ptype="int")]
    return specs


def _ap_legacy() -> dict[str, list[ParamSpec]]:
    """ArduCopter 3.4 以前（含 APM 2.x 常見的 3.2.x）：RATE_xxx 參數族。"""
    specs: dict[str, list[ParamSpec]] = {}
    ranges = {"RLL": {"P": (0.08, 0.35, 4), "I": (0.01, 0.6, 4), "D": (0.001, 0.02, 5)},
              "PIT": {"P": (0.08, 0.35, 4), "I": (0.01, 0.6, 4), "D": (0.001, 0.02, 5)},
              "YAW": {"P": (0.15, 0.5, 4), "I": (0.01, 0.05, 4), "D": (0.0, 0.02, 5)}}
    for axis, code in AXIS_CODES["ardupilot_legacy"].items():
        for term, key in (("p", "P"), ("i", "I"), ("d", "D")):
            lo, hi, dec = ranges[code][key]
            specs[f"{term}.{axis}"] = [ParamSpec(f"RATE_{code}_{key}", lo, hi, dec, (2, 0, 0), (3, 4, 0))]
    return specs


def _px4() -> dict[str, list[ParamSpec]]:
    specs: dict[str, list[ParamSpec]] = {}
    ranges = {"ROLL": {"P": (0.01, 0.5, 4), "I": (0.0, 1.5, 4), "D": (0.0, 0.01, 5), "FF": (0.0, 0.5, 4)},
              "PITCH": {"P": (0.01, 0.6, 4), "I": (0.0, 1.5, 4), "D": (0.0, 0.01, 5), "FF": (0.0, 0.5, 4)},
              "YAW": {"P": (0.0, 0.6, 4), "I": (0.0, 1.5, 4), "D": (0.0, 0.01, 5), "FF": (0.0, 0.5, 4)}}
    for axis, code in AXIS_CODES["px4"].items():
        for term, key in (("p", "P"), ("i", "I"), ("d", "D"), ("ff", "FF")):
            lo, hi, dec = ranges[code][key]
            specs[f"{term}.{axis}"] = [ParamSpec(f"MC_{code}RATE_{key}", lo, hi, dec, (1, 8, 0))]
    specs["gyro_lpf"] = [ParamSpec("IMU_GYRO_CUTOFF", 0, 1000, 1, (1, 10, 0))]
    specs["dterm_lpf"] = [ParamSpec("IMU_DGYRO_CUTOFF", 0, 1000, 1, (1, 10, 0))]
    specs["notch_enable"] = [ParamSpec("IMU_GYRO_DNF_EN", 0, 3, 0, (1, 13, 0), ptype="int")]
    return specs


CATALOGS = {"betaflight": _bf(), "ardupilot": _ap(), "ardupilot_legacy": _ap_legacy(), "px4": _px4()}


def catalog_key(ecosystem: str, firmware: dict) -> str:
    if ecosystem == "ardupilot" and firmware.get("legacy"):
        return "ardupilot_legacy"
    return ecosystem


def resolve(ecosystem: str, firmware: dict, params: dict, role: str) -> dict:
    """回傳 {spec, current, status, reason}。status：OK / NOT_IN_SNAPSHOT / VERSION_UNVERIFIED / UNKNOWN_ROLE。"""
    key = catalog_key(ecosystem, firmware)
    specs = CATALOGS.get(key, {}).get(role)
    if not specs:
        return {"status": "UNKNOWN_ROLE", "reason": f"{key} 參數目錄沒有定義「{role}」，不產生建議值"}
    version = tuple(firmware.get("version_tuple") or ()) or None
    for spec in specs:
        if not spec.supports(version):
            continue
        for name in (spec.name,) + spec.aliases:
            if name in params:
                return {"status": "OK", "spec": spec, "current": float(params[name]), "snapshot_key": name}
        return {"status": "NOT_IN_SNAPSHOT", "spec": spec, "reason": f"韌體 {firmware.get('version')} 應使用 {spec.name}，但參數快照中找不到；請匯入 CLI diff / 參數檔"}
    return {"status": "VERSION_UNVERIFIED", "reason": f"韌體版本 {firmware.get('version')} 不在已驗證的參數版本範圍內"}
