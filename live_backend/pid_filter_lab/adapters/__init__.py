"""依檔案「內容」判斷飛控生態並分派到對應適配器（不依副檔名）。"""

from __future__ import annotations

from ..model import FlightData
from ..parsers import blackbox, dataflash, ulog
from . import ardupilot, betaflight, px4


class UnsupportedLog(ValueError):
    pass


def detect(data: bytes) -> str | None:
    if blackbox.sniff(data):
        return "betaflight"
    if dataflash.sniff(data):
        return "ardupilot"
    if ulog.sniff(data):
        return "px4"
    return None


def adapt(data: bytes, expected: str | None = None) -> FlightData:
    detected = detect(data)
    if detected is None:
        raise UnsupportedLog("無法辨識的日誌格式：不是 Betaflight Blackbox、ArduPilot DataFlash 或 PX4 ULog。")
    if expected and expected not in ("other", detected):
        raise UnsupportedLog(f"檔案內容判定為 {detected}，與所選飛控 {expected} 不一致，請確認後重新上傳。")
    if detected == "betaflight":
        return betaflight.adapt(data)
    if detected == "ardupilot":
        return ardupilot.adapt(data)
    return px4.adapt(data)
