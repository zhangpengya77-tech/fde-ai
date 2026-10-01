from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SafetyReminder:
    reminder_id: str
    message: str


def _reminder(reminder_id: str, message: str) -> SafetyReminder:
    return SafetyReminder(reminder_id, message)


SAFETY_REMINDERS = {
    "REM_MOTOR_TEST_NO_PROP": _reminder("REM_MOTOR_TEST_NO_PROP", "马达台架测试时禁止安装桨叶。"),
    "REM_MOTOR_SCREW_TOO_LONG": _reminder("REM_MOTOR_SCREW_TOO_LONG", "过长的马达固定螺丝可能损伤马达内部结构。"),
    "REM_CHECK_POWER_POLARITY": _reminder("REM_CHECK_POWER_POLARITY", "连接电源前必须核对实际正负极定义。"),
    "REM_VERIFY_CONNECTOR_POLARITY": _reminder("REM_VERIFY_CONNECTOR_POLARITY", "不得只依赖线材颜色判断连接器极性。"),
    "REM_HEATSHRINK_BEFORE_SOLDER": _reminder("REM_HEATSHRINK_BEFORE_SOLDER", "焊接前先套入热缩管。"),
    "REM_SOLDER_TEACHER_CHECK": _reminder("REM_SOLDER_TEACHER_CHECK", "焊点必须由教师复核。"),
    "REM_CONTINUITY_TEST_REQUIRED": _reminder("REM_CONTINUITY_TEST_REQUIRED", "首次上电前必须由教师完成通断与短路检查。"),
    "REM_RECEIVER_PINOUT": _reminder("REM_RECEIVER_PINOUT", "接收机必须按实际 Signal、V+、GND 定义接线。"),
    "REM_ESC_POWER_POLARITY": _reminder("REM_ESC_POWER_POLARITY", "ESC 电源输入正负极接反会造成严重损坏。"),
    "REM_FC_FORWARD": _reminder("REM_FC_FORWARD", "Pixhawk 箭头必须对应机体前方。"),
    "REM_GPS_FORWARD": _reminder("REM_GPS_FORWARD", "GPS/罗盘方向必须符合硬件配置文件。"),
    "REM_FIRST_POWER_TEACHER_REQUIRED": _reminder("REM_FIRST_POWER_TEACHER_REQUIRED", "首次通电必须由教师现场确认。"),
    "REM_FLIGHT_TEACHER_REQUIRED": _reminder("REM_FLIGHT_TEACHER_REQUIRED", "真机飞行必须由教师完成现场安全放行。"),
}
