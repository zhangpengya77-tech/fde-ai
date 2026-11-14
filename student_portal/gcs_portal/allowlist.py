"""真機參數寫入白名單（版本化）。

白名單檔案放在 param_allowlist/，由教師確認。下面的 FORBIDDEN_PREFIXES 寫死在程式裡，
即使有人把這些參數加進白名單檔案，載入時也會直接失敗，教師在介面上也無法解除。
"""
import json
import math
from functools import lru_cache
from pathlib import Path

ALLOWLIST_FILE = Path(__file__).resolve().parent / "param_allowlist" / "arducopter-4.json"

# 安全相關參數：解鎖檢查、失效保護、EKF、安全開關、馬達、伺服、感測器、遙控器、電源、韌體與重啟相關。
FORBIDDEN_PREFIXES = (
    "ARMING_", "FS_", "EK2_", "EK3_", "AHRS_", "BRD_", "MOT_", "SERVO", "INS_", "COMPASS_",
    "RC", "BATT", "FENCE_", "RTL_", "LAND_", "FRAME_", "SYSID_", "SCHED_", "LOG_", "GPS_", "SERIAL",
)


class AllowlistError(ValueError):
    pass


def is_forbidden(name):
    return any(name.startswith(prefix) for prefix in FORBIDDEN_PREFIXES)


@lru_cache(maxsize=1)
def load_allowlist():
    data = json.loads(ALLOWLIST_FILE.read_text(encoding="utf-8"))
    for name, rule in data["params"].items():
        if is_forbidden(name):
            raise AllowlistError(f"白名單不得包含安全相關參數：{name}")
        if not (rule["min"] <= rule["default"] <= rule["max"]):
            raise AllowlistError(f"白名單範圍錯誤：{name}")
    return data


def validate_change(name, old_value, new_value):
    """回傳錯誤訊息清單；空清單代表這次修改符合白名單。"""
    data = load_allowlist()
    rule = data["params"].get(name)
    if is_forbidden(name) or rule is None:
        return [f"{name} 不在可修改的白名單內。"]
    errors = []
    for label, value in (("原值", old_value), ("新值", new_value)):
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            errors.append(f"{label}不是有效數字。")
    if errors:
        return errors
    if not (rule["min"] <= new_value <= rule["max"]):
        errors.append(f"新值必須在 {rule['min']}～{rule['max']} 之間。")
    if new_value == old_value:
        errors.append("新值和原值相同，不需要寫入。")
    reference = max(abs(old_value), rule["max"] * 0.1)
    if abs(new_value - old_value) > reference * data["max_step_ratio"] + 1e-12:
        errors.append(f"單次修改幅度不得超過 {int(data['max_step_ratio'] * 100)}%。")
    return errors


def readback_matches(expected, actual):
    """飛控以 float32 儲存，比對時容許 float32 的捨入誤差。"""
    if not isinstance(actual, (int, float)) or not math.isfinite(actual):
        return False
    return abs(actual - expected) <= max(1e-6, abs(expected) * 1e-5)
