from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .hardware_profiles import get_hardware_profile
from .identifiers import COMPONENT_IDS, CONNECTOR_IDS
from .safety import SAFETY_REMINDERS


class Phase(str, Enum):
    BUILD_COACH = "BUILD_COACH"
    SETUP_VERIFICATION_COACH = "SETUP_VERIFICATION_COACH"
    FLIGHT_HEALTH_COACH = "FLIGHT_HEALTH_COACH"


class TaskStatus(str, Enum):
    NOT_STARTED = "NOT_STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    PENDING_TEACHER_REVIEW = "PENDING_TEACHER_REVIEW"
    NEED_REWORK = "NEED_REWORK"
    COMPLETED = "COMPLETED"
    BLOCKED = "BLOCKED"


class CompletionMode(str, Enum):
    SOP_ONLY = "SOP_ONLY"
    LEARNER_CONFIRM = "LEARNER_CONFIRM"
    EVIDENCE_UPLOAD = "EVIDENCE_UPLOAD"
    VISION_ASSISTED = "VISION_ASSISTED"
    TEACHER_CONFIRM = "TEACHER_CONFIRM"
    HYBRID = "HYBRID"
    EXISTING_MODULE_INTEGRATION = "EXISTING_MODULE_INTEGRATION"


class VerificationMode(str, Enum):
    SOP_ONLY = "SOP_ONLY"
    LEARNER_CONFIRM = "LEARNER_CONFIRM"
    EVIDENCE_UPLOAD = "EVIDENCE_UPLOAD"
    VISION_ASSISTED = "VISION_ASSISTED"
    TEACHER_CONFIRM = "TEACHER_CONFIRM"
    HYBRID = "HYBRID"


@dataclass(frozen=True)
class TaskStep:
    step_id: str
    order: int
    title: str
    student_instruction: str
    why_it_matters: str
    expected_action: str
    completion_type: str
    components: tuple[str, ...] = ()
    connectors: tuple[str, ...] = ()
    safety_reminders: tuple[str, ...] = ()
    vision_task: str | None = None
    evidence_required: tuple[str, ...] = ()
    teacher_gate: bool = False
    common_errors: tuple[str, ...] = ()
    ai_guidance: str = ""
    fallback_guidance: str = "资料不足时停止操作并请教师确认。"
    next_step: str | None = None
    schema_version: str = "1.0"
    content_version: str = "2026.10.01"

    @property
    def id(self): return self.step_id

    @property
    def instruction(self): return self.student_instruction

    @property
    def rationale(self): return self.why_it_matters

    @property
    def verification_mode(self):
        try: return VerificationMode(self.completion_type)
        except ValueError: return VerificationMode.HYBRID


@dataclass(frozen=True)
class TaskDefinition:
    id: str
    order: int
    short_name: str
    title: str
    description: str
    objective: str
    phase: Phase
    hardware_profile: str
    prerequisites: tuple[str, ...]
    completion_mode: CompletionMode
    verification_modes: tuple[VerificationMode, ...]
    safety_gate: bool
    teacher_review_required: bool
    safety_reminders: tuple[str, ...]
    component_ids: tuple[str, ...]
    connector_ids: tuple[str, ...]
    vision_tasks: tuple[str, ...]
    evidence_requirements: tuple[str, ...]
    reflection_required: bool
    steps: tuple[TaskStep, ...]
    completion_rule: str
    next_task: str | None
    status: TaskStatus = TaskStatus.NOT_STARTED
    integration_entry: str | None = None
    schema_version: str = "1.0"
    content_version: str = "2026.10.01"


@dataclass(frozen=True)
class F450CourseDefinition:
    course_id: str
    title: str
    hardware_profile: str
    tasks: tuple[TaskDefinition, ...]
    schema_version: str = "1.0"
    content_version: str = "2026.10.01"


def _steps(*ids: str, mode: VerificationMode = VerificationMode.SOP_ONLY) -> tuple[TaskStep, ...]:
    values = []
    for index, item in enumerate(ids, 1):
        values.append(TaskStep(item, index, item.replace("_", " ").title(), f"完成 {item}。", "依照当前任务 SOP 完成并保留必要证据。", item, mode.value, ai_guidance=f"请完成 {item}。", next_step=ids[index] if index < len(ids) else None))
    return tuple(values)


def _step(step_id, order, title, instruction, why, expected, completion="LEARNER_CONFIRM", *, components=(), connectors=(), reminders=(), vision=None, evidence=(), teacher=False, errors=(), guidance=None, fallback="资料不足时停止操作并请教师确认。"):
    return TaskStep(step_id, order, title, instruction, why, expected, completion, tuple(components), tuple(connectors), tuple(reminders), vision, tuple(evidence), teacher, tuple(errors), guidance or instruction, fallback)


def _link_steps(steps):
    return tuple(TaskStep(**{**step.__dict__, "next_step": steps[index + 1].step_id if index + 1 < len(steps) else None}) for index, step in enumerate(steps))


def _build_task_steps(task_no, rows):
    steps = []
    for order, row in enumerate(rows, 1):
        code, title, instruction, why, options = row
        options = dict(options)
        steps.append(_step(
            f"T{task_no:02d}_{code}", order, title, instruction, why,
            options.pop("expected", code), options.pop("completion", "LEARNER_CONFIRM"),
            **options,
        ))
    return _link_steps(steps)


def _build_coach_steps():
    why = "完成本步骤可安全、可追溯地推进当前组装任务。"
    def row(code, title, instruction, options=None, reason=why):
        return (code, title, instruction, reason, options or {})
    return {
        1: _build_task_steps(1, [
            row("WORKSPACE", "准备工作区域", "清空桌面并集中摆放零件，暂时不要组装。"),
            row("FRAME", "识别 F450 机架", "找出上下板、四支机臂与螺丝。", {"components": ("F450_FRAME",), "vision": "component_present"}),
            row("MOTORS", "识别四个马达", "找出四个 2212 马达，先不要安装。", {"components": ("MOTOR_2212",), "vision": "component_present"}),
            row("ESC", "识别 ESC", "找出四个电子调速器并理解其连接飞控与马达。", {"components": ("ESC_30A",), "vision": "component_present"}),
            row("PIXHAWK", "识别 Pixhawk", "找出 Pixhawk 2.4.8 并观察机头箭头。", {"components": ("PIXHAWK_248",), "vision": "component_present"}),
            row("GPS", "识别 GPS / Compass", "找出 GPS / Compass；本步骤不做校准。", {"components": ("GPS_COMPASS",), "vision": "component_present"}),
            row("ACCESSORIES", "识别接收机、数传与电源模块", "依实物标签或教师资料确认型号，不确定时不要猜。", {"components": ("RC_RECEIVER", "TELEMETRY_RADIO", "POWER_MODULE")}),
            row("CHECKLIST", "零件清点", "逐项核对主要零件是否齐全。", {"completion": "HYBRID", "vision": "component_present"}),
            row("EVIDENCE", "保存零件全景", "上传一张桌面零件全景照片。", {"completion": "EVIDENCE_UPLOAD", "evidence": ("PHOTO",)}),
            row("REFLECTION", "学习总结", "写下认出的零件与最容易混淆的零件。"),
        ]),
        2: _build_task_steps(2, [
            row("PURPOSE", "认识测试目的", "阅读为什么 Motor / ESC 要先测试再安装。"),
            row("NO_PROP", "确认禁止安装桨叶", "确认所有桨叶均未安装并阅读安全提醒。", {"reminders": ("REM_MOTOR_TEST_NO_PROP",)}),
            row("TESTER", "认识 Motor Tester", "依实物标签或教师资料认识测试器，不猜测针脚。"),
            row("CONNECT_SET1", "连接第一组 Motor + ESC", "连接马达相线，并确认 ESC 电源输入正负极。", {"connectors": ("ESC_POWER_POS", "ESC_POWER_NEG"), "reminders": ("REM_ESC_POWER_POLARITY",)}),
            row("PREPOWER_TEACHER", "教师检查测试连接", "请教师检查连接；批准前不得通电。", {"completion": "TEACHER_CONFIRM", "teacher": True}),
            row("M1", "Motor 1 Test", "由教师监督记录正常、异响、卡顿或不转。", {"completion": "TEACHER_CONFIRM", "teacher": True}),
            row("M2", "Motor 2 Test", "由教师监督记录第二组测试结果。", {"completion": "TEACHER_CONFIRM", "teacher": True}),
            row("M3", "Motor 3 Test", "由教师监督记录第三组测试结果。", {"completion": "TEACHER_CONFIRM", "teacher": True}),
            row("M4", "Motor 4 Test", "由教师监督记录第四组测试结果。", {"completion": "TEACHER_CONFIRM", "teacher": True}),
            row("CROSS_TEST", "必要时交叉测试", "发现异常时，在教师指导下交叉替换 Motor / ESC。"),
            row("FINAL_TEACHER", "教师最终复核", "提交四组结果给教师批准或退回重做。", {"completion": "TEACHER_CONFIRM", "teacher": True}),
            row("RECORD", "证据与总结", "保存测试记录、教师复核与学生总结。", {"completion": "EVIDENCE_UPLOAD", "evidence": ("CHECKLIST", "TEACHER_REVIEW")}),
        ]),
        3: _build_task_steps(3, [
            row("LAYOUT", "摆放结构件", "摆放上下板与四支机臂。"),
            row("FORWARD", "确认机头方向", "依机架标记确认机头方向。"),
            row("ARMS", "初步组装机臂", "先定位四支机臂，不要一开始全部锁死。"),
            row("FRAME_CHECK", "机架结构检查", "检查上下板与四支机臂是否齐全。", {"completion": "VISION_ASSISTED", "vision": "frame_arm_presence"}),
            row("TESTED_MOTORS", "准备已测试马达", "确认四颗马达来自已完成的 Task 02。"),
            row("POSITIONS", "确认 M1～M4 位置", "依当前硬件资料确认四个马达位置。"),
            row("SCREW", "马达螺丝安全确认", "由硬件资料或教师确认螺丝长度。", {"reminders": ("REM_MOTOR_SCREW_TOO_LONG",), "teacher": True}),
            row("INSTALL", "安装四个马达", "依位置安装四颗已测试马达。"),
            row("MECHANICAL", "机械复核", "检查马达固定、机架、螺丝与明显漏装。", {"completion": "HYBRID", "vision": "motor_frame_presence"}),
            row("EVIDENCE", "保存组装全景", "上传机架与四颗马达全景照片。", {"completion": "EVIDENCE_UPLOAD", "evidence": ("PHOTO",)}),
            row("REFLECTION", "学习总结", "记录组装问题、解决方式与学到的内容。"),
        ]),
        4: _build_task_steps(4, [
            row("ESC_SIGNAL", "认识 ESC 电源与信号", "区分 Power+、Power- 与 Signal，不只按线色判断。"),
            row("ROUTING", "规划 ESC 位置与走线", "先规划线长、走线与焊接位置。"),
            row("HEATSHRINK", "先套热缩管", "焊接前先把热缩管套在线材上。", {"reminders": ("REM_HEATSHRINK_BEFORE_SOLDER",)}),
            row("PDB_POLARITY", "确认 PDB 电源极性", "核对 PCB 与连接器的 + / - 标示。", {"reminders": ("REM_CHECK_POWER_POLARITY", "REM_VERIFY_CONNECTOR_POLARITY")}),
            row("XT60", "确认 XT60 极性", "以实际 + / - 标示和测量确认，不只凭外形。", {"connectors": ("XT60_POS", "XT60_NEG")}),
            row("PRESOLDER_TEACHER", "焊接前教师检查", "请教师检查极性、走线与热缩管。", {"completion": "TEACHER_CONFIRM", "teacher": True, "reminders": ("REM_SOLDER_TEACHER_CHECK",)}),
            row("SOLDER", "焊接", "在教师监督下完成真实焊接；软件不得代替实际操作。", {"completion": "TEACHER_CONFIRM", "teacher": True}),
            row("VISUAL", "焊后外观检查", "上传焊点近照；AI 不得宣告电气安全。", {"completion": "EVIDENCE_UPLOAD", "evidence": ("PHOTO",)}),
            row("CONTINUITY", "通断 / 蜂鸣检查", "保持电池未连接，由教师使用万用表检查。", {"completion": "TEACHER_CONFIRM", "teacher": True, "reminders": ("REM_CONTINUITY_TEST_REQUIRED",)}),
            row("ELECTRICAL_APPROVAL", "教师电气批准", "等待教师批准；学生与 AI 不能自行放行上电。", {"completion": "TEACHER_CONFIRM", "teacher": True}),
            row("EVIDENCE", "保存电气证据", "保存焊点照片、教师复核与通断结果引用。", {"completion": "EVIDENCE_UPLOAD", "evidence": ("PHOTO", "CHECKLIST", "TEACHER_REVIEW")}),
            row("REFLECTION", "学习总结", "说明为什么焊完不能直接接电池。"),
        ]),
        5: _build_task_steps(5, [
            row("PIXHAWK", "安装 Pixhawk", "将 Pixhawk 2.4.8 安装在规划位置。"),
            row("ARROW", "确认 Pixhawk 箭头", "确认飞控箭头朝向机头。", {"completion": "VISION_ASSISTED", "vision": "pixhawk_orientation_assist", "reminders": ("REM_FC_FORWARD",)}),
            row("MAIN_OUT", "连接 M1～M4 Signal", "依接口资料连接 MAIN OUT 1～4，并理解 Signal / V+ / GND。", {"connectors": ("FC_MAIN_OUT_1", "FC_MAIN_OUT_2", "FC_MAIN_OUT_3", "FC_MAIN_OUT_4")}),
            row("GPS_INSTALL", "安装 GPS", "将 GPS / Compass 安装在规划位置。"),
            row("GPS_DIRECTION", "确认 GPS 方向", "依硬件资料确认方向，本步不做校准。", {"completion": "VISION_ASSISTED", "vision": "gps_orientation_assist", "reminders": ("REM_GPS_FORWARD",)}),
            row("GPS_CONNECT", "连接 GPS", "依可靠硬件资料连接；不确定时请教师确认。", {"connectors": ("FC_GPS", "FC_I2C")}),
            row("RECEIVER", "连接接收机", "确认 Signal / V+ / GND 后连接；本步不做校准。", {"connectors": ("FC_RCIN",), "reminders": ("REM_RECEIVER_PINOUT",)}),
            row("TELEMETRY", "连接数传", "依可靠接口资料连接 Telemetry。", {"connectors": ("FC_TELEM1", "FC_TELEM2")}),
            row("POWER_MODULE", "连接电源模块", "完成物理安装与连接，但不要首次上电。"),
            row("EVIDENCE", "保存全机接线照片", "上传清楚的全机接线照片。", {"completion": "EVIDENCE_UPLOAD", "evidence": ("PHOTO",)}),
            row("REVIEW", "接线复核与总结", "逐项复核关键接线并完成学习总结。"),
        ]),
        6: _build_task_steps(6, [
            row("MECHANICAL", "机械检查", "在电池未连接状态检查机架、机臂与马达固定。"),
            row("MOTOR_SCREW", "马达螺丝检查", "由资料或教师确认马达螺丝安全。", {"reminders": ("REM_MOTOR_SCREW_TOO_LONG",)}),
            row("ESC_WIRING", "ESC 与走线检查", "检查 ESC、走线、热缩管与松动线材。"),
            row("POLARITY", "电源极性检查", "检查 PDB、XT60 与电源正负极；不要接电池。", {"reminders": ("REM_CHECK_POWER_POLARITY", "REM_VERIFY_CONNECTOR_POLARITY", "REM_CONTINUITY_TEST_REQUIRED")}),
            row("FC", "飞控检查", "检查 Pixhawk 固定、方向与 MAIN OUT 1～4。", {"reminders": ("REM_FC_FORWARD",)}),
            row("GPS", "GPS 检查", "检查 GPS 安装、方向与连接。", {"reminders": ("REM_GPS_FORWARD",)}),
            row("RADIO", "接收机与数传检查", "检查接收机、Signal / V+ / GND、数传与电源模块。", {"reminders": ("REM_RECEIVER_PINOUT",)}),
            row("EVIDENCE", "保存整机无电照片", "上传最终无电整机照片。", {"completion": "EVIDENCE_UPLOAD", "evidence": ("PHOTO",)}),
            row("SELF_CHECK", "学生自检清单", "完成整机无电检查清单并确认电池未连接。", {"completion": "HYBRID", "evidence": ("CHECKLIST",)}),
            row("TEACHER_RELEASE", "教师无电安全放行", "等待教师最终检查；未放行不得进入 Task 07。", {"completion": "TEACHER_CONFIRM", "teacher": True, "reminders": ("REM_FIRST_POWER_TEACHER_REQUIRED",)}),
            row("REFLECTION", "学习总结", "写下首次上电前最需要再次确认的三件事。"),
        ]),
    }


def _task(order, short, title, objective, phase, prerequisites, completion_mode, verification_modes, steps, *, teacher=False, reminders=(), components=(), connectors=(), vision=(), evidence=(), integration=None):
    task_id = f"TASK_{order:02d}"
    return TaskDefinition(
        id=task_id, order=order, short_name=short, title=title,
        description=objective, objective=objective, phase=phase,
        hardware_profile="F450_PIXHAWK248", prerequisites=prerequisites,
        completion_mode=completion_mode, verification_modes=verification_modes,
        safety_gate=teacher, teacher_review_required=teacher,
        safety_reminders=reminders, component_ids=components,
        connector_ids=connectors, vision_tasks=vision,
        evidence_requirements=evidence, reflection_required=True,
        steps=steps, completion_rule=("TEACHER_APPROVE" if teacher else "REQUIREMENTS_COMPLETE"),
        next_task=(f"TASK_{order + 1:02d}" if order < 12 else None),
        integration_entry=integration,
    )


def load_f450_course() -> F450CourseDefinition:
    build = Phase.BUILD_COACH
    setup = Phase.SETUP_VERIFICATION_COACH
    flight = Phase.FLIGHT_HEALTH_COACH
    build_steps = _build_coach_steps()
    tasks = (
        _task(1, "认", "零件识别与检查", "识别并检查 F450 主要零部件。", build, (), CompletionMode.HYBRID, (VerificationMode.VISION_ASSISTED, VerificationMode.HYBRID), build_steps[1], components=tuple(COMPONENT_IDS), vision=("component_present", "component_class"), evidence=("PHOTO",)),
        _task(2, "测", "Motor + ESC 台架测试", "逐组完成无桨 Motor + ESC 台架测试。", build, ("TASK_01",), CompletionMode.TEACHER_CONFIRM, (VerificationMode.TEACHER_CONFIRM,), build_steps[2], teacher=True, reminders=("REM_MOTOR_TEST_NO_PROP", "REM_ESC_POWER_POLARITY"), components=("MOTOR_2212", "ESC_30A"), evidence=("CHECKLIST", "TEACHER_REVIEW")),
        _task(3, "装", "F450 机架 + 马达安装", "组装 F450 机架并安装四颗马达。", build, ("TASK_02",), CompletionMode.HYBRID, (VerificationMode.LEARNER_CONFIRM, VerificationMode.EVIDENCE_UPLOAD, VerificationMode.VISION_ASSISTED), build_steps[3], reminders=("REM_MOTOR_SCREW_TOO_LONG",), components=("F450_FRAME", "MOTOR_2212"), vision=("component_present",), evidence=("PHOTO",)),
        _task(4, "焊", "ESC / 电源焊接 + 万用表", "完成电源焊接、绝缘与教师通断检查。", build, ("TASK_03",), CompletionMode.TEACHER_CONFIRM, (VerificationMode.EVIDENCE_UPLOAD, VerificationMode.TEACHER_CONFIRM), build_steps[4], teacher=True, reminders=("REM_CHECK_POWER_POLARITY", "REM_VERIFY_CONNECTOR_POLARITY", "REM_HEATSHRINK_BEFORE_SOLDER", "REM_SOLDER_TEACHER_CHECK", "REM_CONTINUITY_TEST_REQUIRED"), evidence=("PHOTO", "CHECKLIST", "TEACHER_REVIEW")),
        _task(5, "接", "飞控与外设安装", "安装 Pixhawk、GPS、接收机、数传与电源模块。", build, ("TASK_04",), CompletionMode.HYBRID, (VerificationMode.HYBRID, VerificationMode.VISION_ASSISTED), build_steps[5], reminders=("REM_RECEIVER_PINOUT", "REM_FC_FORWARD", "REM_GPS_FORWARD"), components=("PIXHAWK_248", "GPS_COMPASS", "RC_RECEIVER", "TELEMETRY_RADIO", "POWER_MODULE"), connectors=tuple(CONNECTOR_IDS), vision=("pixhawk_orientation_assist", "gps_orientation_assist"), evidence=("PHOTO",)),
        _task(6, "查", "全机无电安全检查", "在不连接电池的状态下完成全机安全复核。", build, ("TASK_03", "TASK_04", "TASK_05"), CompletionMode.TEACHER_CONFIRM, (VerificationMode.CHECKLIST if hasattr(VerificationMode, "CHECKLIST") else VerificationMode.HYBRID, VerificationMode.TEACHER_CONFIRM), build_steps[6], teacher=True, reminders=("REM_MOTOR_SCREW_TOO_LONG", "REM_CHECK_POWER_POLARITY", "REM_VERIFY_CONNECTOR_POLARITY", "REM_CONTINUITY_TEST_REQUIRED", "REM_RECEIVER_PINOUT", "REM_FC_FORWARD", "REM_GPS_FORWARD"), evidence=("CHECKLIST", "TEACHER_REVIEW")),
        _task(7, "调", "Mission Planner 完整调参", "完成 F450 基本飞控配置，不允许 AI 自动修改参数。", setup, ("TASK_06",), CompletionMode.HYBRID, (VerificationMode.HYBRID, VerificationMode.TEACHER_CONFIRM), _steps("MP_CONNECT", "AIRFRAME_SETUP", "ACCEL_CALIBRATION", "COMPASS_CALIBRATION", "RADIO_CALIBRATION", "MOTOR_OUTPUT_SETUP", "FLIGHT_MODE_SETUP", "FAILSAFE_SETUP", "GPS_CHECK", "RTL_SETUP", "FINAL_CONFIG_REVIEW", mode=VerificationMode.HYBRID), reminders=("REM_FIRST_POWER_TEACHER_REQUIRED",), evidence=("SCREENSHOT", "MP_RESULT")),
        _task(8, "验", "调参后功能验证", "验证 Task 07 的 Radio、Motor、Mode、GPS、Failsafe 与 RTL 配置。", setup, ("TASK_07",), CompletionMode.HYBRID, (VerificationMode.HYBRID, VerificationMode.VISION_ASSISTED, VerificationMode.TEACHER_CONFIRM), _steps("RADIO_INPUT_VERIFY", "FLIGHT_MODE_VERIFY", "MOTOR_MAPPING_VERIFY", "MOTOR_DIRECTION_VERIFY", "PROP_ORIENTATION_VERIFY", "ATTITUDE_RESPONSE_VERIFY", "GPS_DETECTION_VERIFY", "RECEIVER_STATE_VERIFY", "FAILSAFE_VERIFY", "RTL_CONFIG_VERIFY", mode=VerificationMode.HYBRID), teacher=True, reminders=("REM_MOTOR_TEST_NO_PROP", "REM_FLIGHT_TEACHER_REQUIRED"), vision=("propeller_orientation_assist",), evidence=("CHECKLIST", "VISION_RESULT", "TEACHER_REVIEW")),
        _task(9, "演", "QGC 综合联调与模拟任务演练", "在 Simulation/SITL 中演练地面站与航线任务，不授权真实解锁。", setup, ("TASK_07", "TASK_08"), CompletionMode.HYBRID, (VerificationMode.HYBRID, VerificationMode.EVIDENCE_UPLOAD), _steps("QGC_BATTERY", "QGC_GPS_HOME_POSITION", "QGC_ATTITUDE_MODE_TELEMETRY", "QGC_ARM_DISARM_CONCEPT", "QGC_WAYPOINT_MISSION", "QGC_MISSION_SEQUENCE", "QGC_RTL_CONCEPT", "SITL_MISSION_REHEARSAL", mode=VerificationMode.HYBRID), evidence=("SCREENSHOT", "QGC_RESULT")),
        _task(10, "查", "飞行前最终上电检查", "完成 01～09 总检与户外 GPS/Home/RTL 条件确认。", setup, ("TASK_07", "TASK_08", "TASK_09"), CompletionMode.TEACHER_CONFIRM, (VerificationMode.HYBRID, VerificationMode.TEACHER_CONFIRM), _steps("MECHANICAL_PREFLIGHT", "ELECTRICAL_PREFLIGHT", "CONFIG_PREFLIGHT", "OUTDOOR_GPS_HOME_RTL", "TEACHER_FLIGHT_RELEASE", mode=VerificationMode.TEACHER_CONFIRM), teacher=True, reminders=("REM_FIRST_POWER_TEACHER_REQUIRED", "REM_FLIGHT_TEACHER_REQUIRED"), evidence=("CHECKLIST", "TEACHER_REVIEW")),
        _task(11, "飞", "户外真机测试", "由教师负责现场安全，完成基础真机测试与飞行证据。", flight, ("TASK_10",), CompletionMode.TEACHER_CONFIRM, (VerificationMode.EVIDENCE_UPLOAD, VerificationMode.TEACHER_CONFIRM), _steps("SITE_SAFETY", "FINAL_CHECK", "TEACHER_CONTROLLED_FLIGHT", "POST_FLIGHT_CHECK", mode=VerificationMode.TEACHER_CONFIRM), teacher=True, reminders=("REM_FLIGHT_TEACHER_REQUIRED",), evidence=("VIDEO", "FLIGHT_LOG_REFERENCE", "TEACHER_REVIEW")),
        _task(12, "析", "最终验收 + Existing Flight Health Integration", "引用现有 Flight Health 结果，完成总结、教师终审与 Growth Record 映射。", flight, ("TASK_11",), CompletionMode.EXISTING_MODULE_INTEGRATION, (VerificationMode.EVIDENCE_UPLOAD, VerificationMode.TEACHER_CONFIRM), _steps("FINAL_ACCEPTANCE", "OPEN_EXISTING_FLIGHT_HEALTH", "STUDENT_REFLECTION", "TEACHER_FINAL_REVIEW", "GROWTH_RECORD_PENDING_SYNC", mode=VerificationMode.TEACHER_CONFIRM), teacher=True, evidence=("FLIGHT_HEALTH_REFERENCE", "STUDENT_REFLECTION", "TEACHER_REVIEW"), integration="EXISTING_FLIGHT_HEALTH"),
    )
    course = F450CourseDefinition("F450_AI_TRAINING", "F450 AI 实训助教", "F450_PIXHAWK248", tasks)
    validate_course(course)
    return course


def validate_course(course: F450CourseDefinition) -> None:
    if len(course.tasks) != 12:
        raise ValueError("course_requires_12_tasks")
    get_hardware_profile(course.hardware_profile)
    expected_ids = tuple(f"TASK_{number:02d}" for number in range(1, 13))
    if tuple(task.id for task in course.tasks) != expected_ids:
        raise ValueError("invalid_task_order")
    known_tasks = set(expected_ids)
    for task in course.tasks:
        if any(item not in known_tasks for item in task.prerequisites):
            raise ValueError(f"unknown_prerequisite:{task.id}")
        if any(item not in SAFETY_REMINDERS for item in task.safety_reminders):
            raise ValueError(f"unknown_safety_reminder:{task.id}")
        if any(item not in COMPONENT_IDS for item in task.component_ids):
            raise ValueError(f"unknown_component:{task.id}")
        if any(item not in CONNECTOR_IDS for item in task.connector_ids):
            raise ValueError(f"unknown_connector:{task.id}")
