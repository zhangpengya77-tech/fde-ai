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
    id: str
    title: str
    instruction: str
    rationale: str
    verification_mode: VerificationMode = VerificationMode.SOP_ONLY
    safety_reminders: tuple[str, ...] = ()
    vision_task: str | None = None


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


@dataclass(frozen=True)
class F450CourseDefinition:
    course_id: str
    title: str
    hardware_profile: str
    tasks: tuple[TaskDefinition, ...]


def _steps(*ids: str, mode: VerificationMode = VerificationMode.SOP_ONLY) -> tuple[TaskStep, ...]:
    return tuple(TaskStep(item, item.replace("_", " ").title(), f"完成 {item}。", "依照当前任务 SOP 完成并保留必要证据。", mode) for item in ids)


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
    tasks = (
        _task(1, "认", "零件识别与检查", "识别并检查 F450 主要零部件。", build, (), CompletionMode.HYBRID, (VerificationMode.VISION_ASSISTED, VerificationMode.HYBRID), _steps("COMPONENT_OVERVIEW", "COMPONENT_CHECK", mode=VerificationMode.VISION_ASSISTED), components=tuple(COMPONENT_IDS), vision=("component_present", "component_class"), evidence=("PHOTO",)),
        _task(2, "测", "Motor + ESC 台架测试", "逐组完成无桨 Motor + ESC 台架测试。", build, ("TASK_01",), CompletionMode.TEACHER_CONFIRM, (VerificationMode.TEACHER_CONFIRM,), _steps("M1_BENCH_TEST", "M2_BENCH_TEST", "M3_BENCH_TEST", "M4_BENCH_TEST", mode=VerificationMode.TEACHER_CONFIRM), teacher=True, reminders=("REM_MOTOR_TEST_NO_PROP", "REM_ESC_POWER_POLARITY"), components=("MOTOR_2212", "ESC_30A"), evidence=("CHECKLIST", "TEACHER_REVIEW")),
        _task(3, "装", "F450 机架 + 马达安装", "组装 F450 机架并安装四颗马达。", build, ("TASK_02",), CompletionMode.HYBRID, (VerificationMode.LEARNER_CONFIRM, VerificationMode.EVIDENCE_UPLOAD, VerificationMode.VISION_ASSISTED), _steps("FRAME_ASSEMBLY", "MOTOR_INSTALL", mode=VerificationMode.HYBRID), reminders=("REM_MOTOR_SCREW_TOO_LONG",), components=("F450_FRAME", "MOTOR_2212"), vision=("component_present",), evidence=("PHOTO",)),
        _task(4, "焊", "ESC / 电源焊接 + 万用表", "完成电源焊接、绝缘与教师通断检查。", build, ("TASK_03",), CompletionMode.TEACHER_CONFIRM, (VerificationMode.EVIDENCE_UPLOAD, VerificationMode.TEACHER_CONFIRM), _steps("HEATSHRINK_PREP", "POWER_POLARITY_CHECK", "SOLDERING", "CONTINUITY_CHECK", mode=VerificationMode.TEACHER_CONFIRM), teacher=True, reminders=("REM_CHECK_POWER_POLARITY", "REM_VERIFY_CONNECTOR_POLARITY", "REM_HEATSHRINK_BEFORE_SOLDER", "REM_SOLDER_TEACHER_CHECK", "REM_CONTINUITY_TEST_REQUIRED"), evidence=("PHOTO", "CHECKLIST", "TEACHER_REVIEW")),
        _task(5, "接", "飞控与外设安装", "安装 Pixhawk、GPS、接收机、数传与电源模块。", build, ("TASK_04",), CompletionMode.HYBRID, (VerificationMode.HYBRID, VerificationMode.VISION_ASSISTED), _steps("PIXHAWK_INSTALL", "GPS_INSTALL", "RECEIVER_CONNECT", "TELEMETRY_CONNECT", "MOTOR_SIGNAL_CONNECT", mode=VerificationMode.HYBRID), reminders=("REM_RECEIVER_PINOUT", "REM_FC_FORWARD", "REM_GPS_FORWARD"), components=("PIXHAWK_248", "GPS_COMPASS", "RC_RECEIVER", "TELEMETRY_RADIO", "POWER_MODULE"), connectors=tuple(CONNECTOR_IDS), vision=("pixhawk_orientation_assist", "gps_orientation_assist"), evidence=("PHOTO",)),
        _task(6, "查", "全机无电安全检查", "在不连接电池的状态下完成全机安全复核。", build, ("TASK_03", "TASK_04", "TASK_05"), CompletionMode.TEACHER_CONFIRM, (VerificationMode.CHECKLIST if hasattr(VerificationMode, "CHECKLIST") else VerificationMode.HYBRID, VerificationMode.TEACHER_CONFIRM), _steps("UNPOWERED_ASSEMBLY_CHECK", "UNPOWERED_ELECTRICAL_CHECK", "TEACHER_SAFETY_RELEASE", mode=VerificationMode.TEACHER_CONFIRM), teacher=True, reminders=("REM_MOTOR_SCREW_TOO_LONG", "REM_CHECK_POWER_POLARITY", "REM_VERIFY_CONNECTOR_POLARITY", "REM_CONTINUITY_TEST_REQUIRED", "REM_RECEIVER_PINOUT", "REM_FC_FORWARD", "REM_GPS_FORWARD"), evidence=("CHECKLIST", "TEACHER_REVIEW")),
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
