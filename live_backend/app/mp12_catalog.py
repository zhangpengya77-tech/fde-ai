from __future__ import annotations

from .mp12_models import MissionPlannerSubtaskDefinition


def _subtask(
    order: int,
    title: str,
    objective: str,
    procedure: tuple[str, ...],
    completion_checks: tuple[str, ...],
    *,
    troubleshooting: tuple[str, ...] = (),
    safety_rules: tuple[str, ...] = (),
    scope_notes: tuple[str, ...] = (),
    teacher_required: bool = False,
    evidence_types: tuple[str, ...] = (),
    vision_task: str | None = None,
    legacy_step_ids: tuple[str, ...] = (),
) -> MissionPlannerSubtaskDefinition:
    return MissionPlannerSubtaskDefinition(
        subtask_id=f"MP{order:02d}",
        order=order,
        title=title,
        objective=objective,
        procedure=procedure,
        completion_checks=completion_checks,
        troubleshooting=troubleshooting,
        safety_rules=safety_rules,
        scope_notes=scope_notes,
        teacher_required=teacher_required,
        evidence_types=evidence_types,
        vision_task=vision_task,
        legacy_step_ids=legacy_step_ids,
    )


_MP12_CATALOG = (
    _subtask(
        1,
        "USB / COM 连接与 MP 识别",
        "让 Mission Planner 通过 USB 数据线稳定识别并连接 Pixhawk。",
        (
            "确认桨叶未安装，使用 USB 数据线连接 Pixhawk 与电脑。",
            "打开 Mission Planner，选择出现的 COM Port 和课程指定 Baud Rate。",
            "点击 Connect，确认 Mission Planner 已读取飞控型号与基本状态。",
            "若需要电池上电才能继续，先停止并请教师现场确认。",
        ),
        ("Mission Planner 显示 CONNECTED。", "飞控型号与基础状态可以读取。"),
        troubleshooting=(
            "没有 COM 时打开 Windows 设备管理器，再查看端口（COM 和 LPT）。",
            "确认当前 USB 数据线不是只有充电功能的数据线。",
            "更换 USB 接口，并检查驱动与 Pixhawk USB connector。",
        ),
        evidence_types=("SCREENSHOT",),
        legacy_step_ids=("T07_PREPOWER_REVIEW", "T07_FIRST_POWER_TEACHER", "T07_MP_CONNECT"),
    ),
    _subtask(
        2,
        "固件、载具类型、机架与飞控方向",
        "分清硬件、固件、载具类型和机架，并核对 F450 配置。",
        (
            "确认 Pixhawk 2.4.8 是飞控 Hardware（硬件）。",
            "查看当前 Firmware（固件）是 ArduPilot 或 PX4，本任务不重新刷固件。",
            "确认 Vehicle Type（载具类型）为课程要求的 Copter，而不是 Plane、Rover 或 Helicopter。",
            "确认 Frame Type（机架类型）为 Quad X。",
            "确认飞控箭头方向与真实机头一致。",
        ),
        ("能说明硬件、固件、载具类型与机架的区别。", "Copter、Quad X 与飞控方向均已核对。"),
        evidence_types=("SCREENSHOT",),
        legacy_step_ids=("T07_FC_FIRMWARE_AIRFRAME",),
    ),
    _subtask(
        3,
        "加速度计与水平校准",
        "完成 Accelerometer Calibration（加速度计校准）、水平校准与人工地平线检查。",
        (
            "确认机体无桨并放在稳定桌面。",
            "依 Mission Planner 提示完成六面校准：正放、左侧、右侧、机头朝下、机头朝上、倒置。",
            "完成 Level Calibration（水平校准）。",
            "轻微改变机体姿态，确认 Artificial Horizon（人工地平线）与真实姿态基本一致。",
        ),
        ("Mission Planner 明确显示校准成功。", "人工地平线响应方向正确且基本一致。"),
        troubleshooting=("姿态提示不清楚时不要猜，回到当前提示并请 AI 或教师解释下一面。",),
        evidence_types=("MP_RESULT",),
        legacy_step_ids=("T07_ACCEL_PREP", "T07_ACCEL_CALIBRATION"),
    ),
    _subtask(
        4,
        "罗盘 + GPS 识别与校准",
        "校准罗盘并确认 GPS 设备在室内能够被飞控识别。",
        (
            "确认外置 / 内置 Compass（罗盘）状态、安装方向与周围磁性干扰。",
            "按 Mission Planner 提示完成罗盘校准并检查方向。",
            "确认 GPS 设备已识别，并查看基础状态与异常提示。",
        ),
        ("罗盘校准完成且没有明显方向错误。", "GPS 设备显示已识别。"),
        troubleshooting=("多罗盘混乱、方向错误或 GPS 异常时停止并请教师检查。",),
        scope_notes=("室内阶段只确认 GPS 设备识别，不把 3D Fix、Home 或 RTL 记为真实验证。",),
        evidence_types=("MP_RESULT", "SCREENSHOT"),
        legacy_step_ids=("T07_COMPASS_PREP", "T07_COMPASS_CALIBRATION", "T07_GPS_STATUS"),
    ),
    _subtask(
        5,
        "接收机 + 遥控器 + 通道校准",
        "确认遥控器、接收机、飞控和 Mission Planner 的通道链路正确。",
        (
            "确认接收机在线，Mission Planner 通道条会随遥控器动作。",
            "执行 Radio Calibration（遥控器校准）。",
            "依次检查 Roll、Pitch、Throttle、Yaw 与 AUX 的最小值、最大值、中位和方向。",
            "确认模式开关与其他 AUX 通道均有响应。",
        ),
        ("五类通道均有稳定响应。", "范围、中位、方向及 AUX 变化合理。"),
        troubleshooting=(
            "接收机有灯但 MP 无通道时，检查信号协议、接线端口和飞控串口配置。",
            "摇杆方向错误或 AUX 无反应时先记录现象，不盲目批量改参数。",
        ),
        evidence_types=("MP_RESULT",),
        legacy_step_ids=("T07_RADIO_PREP", "T07_RADIO_CALIBRATION", "T07_RECEIVER_STATUS"),
    ),
    _subtask(
        6,
        "ESC 电调校准",
        "先识别 ESC 类型，再决定是否执行传统 PWM 油门行程校准。",
        (
            "确认所有桨叶已经拆除。",
            "由资料或教师确认 ESC 是传统 PWM、DShot、CAN 或其他类型。",
            "只有确实需要油门行程校准的传统 PWM ESC，才按对应 SOP 执行校准。",
            "DShot、CAN 或本身不需要行程校准的 ESC，不执行传统最高油门校准。",
            "完成后在无桨条件下检查四颗电机启动响应是否基本一致。",
        ),
        ("ESC 类型已有可靠依据。", "对应校准或无需校准的结论已记录。", "教师完成现场复核。"),
        safety_rules=("拆桨后才能进入 ESC 操作。", "首次带电关键操作必须由教师现场确认。"),
        scope_notes=("AI 不得默认所有 ESC 都使用同一种校准方法。",),
        teacher_required=True,
        evidence_types=("MP_RESULT", "TEACHER_REVIEW"),
    ),
    _subtask(
        7,
        "飞行模式 + AUX 功能设置",
        "让遥控器开关位置与 Mission Planner 显示的飞行模式和 AUX 功能一致。",
        (
            "依课程设置 Stabilize、AltHold、Loiter、AUTO、RTL 与其他需要的模式。",
            "设置课程需要的 AUX Mapping（辅助通道映射）。",
            "逐一拨动遥控器开关，确认 Mission Planner 实际显示与预期模式一致。",
        ),
        ("所有课程要求的模式都能由对应开关正确显示。", "AUX 功能映射与实物开关一致。"),
        evidence_types=("SCREENSHOT",),
        legacy_step_ids=("T07_FLIGHT_MODES",),
    ),
    _subtask(
        8,
        "Failsafe + 安全保护 + 舵机任务",
        "配置并复核失控保护、PreArm 与课程需要的舵机 / 抛投功能。",
        (
            "核对 RC Failsafe、Battery Failsafe 与课程使用时的 GCS Failsafe。",
            "查看 PreArm 检查结果，不为了解锁而关闭 Safety Checks（安全检查）。",
            "如课程使用 Servo（舵机）或抛投装置，核对输出通道、AUX 开关、响应和任务触发逻辑。",
            "只做安全配置与无危险输出条件下的功能确认。",
        ),
        ("Failsafe 与课程安全方案一致。", "PreArm 问题被正确处理而非绕过。", "教师完成现场复核。"),
        safety_rules=("不得为了成功 Arm（解锁）而关闭安全检查。", "不自动切换 AUTO 或启动任务。"),
        scope_notes=("T07_RTL 旧步骤映射到本安全组；真实 Home / RTL 留给户外飞前检查。",),
        teacher_required=True,
        evidence_types=("SCREENSHOT", "TEACHER_REVIEW"),
        legacy_step_ids=("T07_FAILSAFE", "T07_RTL"),
    ),
    _subtask(
        9,
        "电池、电压与电源监测",
        "让 Battery Monitor（电池监测）数据显示与实际电池状态基本可信。",
        (
            "检查 Battery Monitor、Battery Type、容量与低电量设置。",
            "查看电压、电流（如有）和剩余电量。",
            "将 Mission Planner 显示值与实际电池状态进行合理核对。",
        ),
        ("电池类型与容量记录正确。", "电压和电流数据显示合理。"),
        scope_notes=("Voltage visible（有电压显示）不代表 Voltage calibration（电压校准）已经正确。",),
        evidence_types=("SCREENSHOT",),
        legacy_step_ids=("T07_BASE_PARAMETERS",),
    ),
    _subtask(
        10,
        "数传电台 + MAVLink + OSD / 摄像头外设",
        "确认飞控遥测能通过数传与 MAVLink 到达地面站，并理解视频设备边界。",
        (
            "检查 Telemetry（数传）、MAVLink、Serial（串口）与 Baud（波特率）。",
            "确认飞控数据能够进入 Mission Planner / QGC。",
            "检查模拟 OSD、外接 OSD、摄像头与图传所需的串口或 MAVLink 数据侧。",
        ),
        ("遥测数据链可读取。", "相关串口和 OSD 数据输出用途已确认。"),
        scope_notes=("Camera（摄像头）本身不一定在 Mission Planner 里调参；MP 主要负责飞控、串口、MAVLink 与 OSD 数据侧。",),
        evidence_types=("SCREENSHOT",),
    ),
    _subtask(
        11,
        "Motor Test + M1～M4 + 电机旋向",
        "在无桨条件下逐颗核对软件电机编号、真实位置、旋向与启动响应。",
        (
            "确认不上桨，并由教师控制 Mission Planner Motor Test。",
            "依次测试 M1、M2、M3、M4，核对软件编号与真实电机位置。",
            "核对每颗电机 Rotation Direction（旋转方向）与启动响应。",
            "发现异响、不同步或位置错误时立即停止。",
        ),
        ("M1～M4 与真实位置一致。", "四颗旋向和启动响应已核对。", "教师完成现场复核。"),
        safety_rules=("不上桨执行 Motor Test。", "禁止带桨测试和室内飞行。"),
        teacher_required=True,
        evidence_types=("MP_RESULT", "TEACHER_REVIEW"),
        legacy_step_ids=("T07_MOTOR_OUTPUT_MAPPING",),
    ),
    _subtask(
        12,
        "整机参数总检 + 桨叶 YOLO 静态确认",
        "汇总 MP01～MP11，并在电机绝不会运行的状态下检查桨叶安装方向。",
        (
            "汇总连接、固件、载具、Quad X、飞控方向、校准、GPS、Radio、ESC、模式、Failsafe、电池、舵机、数传、MAVLink、OSD 与电机结果。",
            "确认飞行器断电，或通过物理条件确定电机不会运行。",
            "按需调用现有 Vision / YOLO 单帧检查 CW、CCW、M1～M4、位置与方向。",
            "提交整机参数、实物与关键安全项目给教师最终确认。",
        ),
        ("MP01～MP11 均已完成。", "静态桨叶方向检查已有结果。", "教师完成最终现场复核。"),
        safety_rules=("桨叶检查只能静态进行，电机不得运行。", "禁止带桨动力测试和室内飞行。"),
        scope_notes=("本项只做静态方向确认，不替代 Main Task 08 的调参后功能验证。",),
        teacher_required=True,
        evidence_types=("CHECKLIST", "VISION_RESULT", "TEACHER_REVIEW"),
        vision_task="propeller_orientation_assist",
        legacy_step_ids=("T07_FINAL_CONFIG_REVIEW", "T07_EVIDENCE", "T07_REFLECTION"),
    ),
)


LEGACY_TASK07_STEP_MAP = {
    step_id: item.subtask_id
    for item in _MP12_CATALOG
    for step_id in item.legacy_step_ids
}


def load_mp12_catalog() -> tuple[MissionPlannerSubtaskDefinition, ...]:
    return _MP12_CATALOG

