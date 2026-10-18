"""
FDE Flight Health — 统一诊断引擎解析器 (Engine Resolver)

职责（唯一真相来源）：
    决定「当前架次的健康分析」由哪一个引擎负责。

正式优先级（教师确认的产品逻辑）：
    ① ACTIVE Teacher Diagnostic Model  （教师已启用并校验通过的诊断主模型）
        ↓  没有 / 不可用
    ② Built-in Rule Engine            （系统内建飞行健康规则引擎，真实日志解析）

设计铁律：
    * 本模块「只负责选择引擎」，绝不伪造任何健康判定结果。
    * 学员端不需要、也不应该知道「教师是否绑定模型」这种概念。
    * 任何情况下都不得返回「因为没绑定模型所以不能分析」。

生产环境接入方式：
    get_active_teacher_diagnostic_model() 在正式环境应查询教师模型仓库
    （Django 教师诊断模型 store）中 VALIDATED 且 ACTIVE 的主模型描述。
    参考实现以环境变量 FDE_FLIGHT_HEALTH_TEACHER_MODEL 注入，便于测试与演示，
    且绝不影响健康判定的真实性。
"""

from __future__ import annotations

TEACHER_MODEL_ENGINE = "teacher_model"
BUILTIN_RULE_ENGINE = "builtin_rule_engine"

# 引擎显示名（学员端可见，不含「绑定 / 未绑定」等技术字眼）
DISPLAY_TEACHER_MODEL = "教师正式模型"
DISPLAY_BUILTIN_RULE = "系统标准规则"
DISPLAY_AUTO = "自动选择"

# 诊断结果四色语义（与前端 student_view.status 对齐）
STATUS_NORMAL = "normal"      # 🟢 通过
STATUS_INSPECT = "inspect"    # 🟠 需要检查
STATUS_DANGER = "danger"      # 🔴 危险
STATUS_UNKNOWN = "unknown"    # ⚪ 无法判断


def get_active_teacher_diagnostic_model():
    """返回当前 ACTIVE 的教师诊断主模型描述；无则返回 None。

    正式环境：查询教师诊断模型仓库中 VALIDATED 且 ACTIVE 的模型。
    参考实现：读取环境变量 FDE_FLIGHT_HEALTH_TEACHER_MODEL
              （JSON 字符串，含 name/version，任意非空即视为已启用）。
    此处不做任何健康判定，只回答「有没有教师主模型」。
    """
    import os
    import json

    raw = os.environ.get("FDE_FLIGHT_HEALTH_TEACHER_MODEL", "").strip()
    if not raw:
        return None
    try:
        data = json.loads(raw) if raw.startswith("{") else {"name": raw}
    except json.JSONDecodeError:
        data = {"name": raw}
    if not data.get("name"):
        return None
    return {
        "name": data.get("name"),
        "version": data.get("version", "unknown"),
        "source": "teacher_diagnostic_store",
    }


def resolve_flight_health_engine(active_teacher_model=None):
    """统一解析当前应使用的诊断引擎。

    返回 dict：
        {
          "type": "teacher_model" | "builtin_rule_engine",
          "engine": <引擎标识>,
          "display_name": "教师正式模型" | "系统标准规则",
          "detail": <对学员非阻塞的状态说明>,
          "teacher_model_active": bool,
        }
    """
    if active_teacher_model is None:
        active_teacher_model = get_active_teacher_diagnostic_model()

    if active_teacher_model:
        return {
            "type": TEACHER_MODEL_ENGINE,
            "engine": active_teacher_model.get("name"),
            "version": active_teacher_model.get("version"),
            "display_name": DISPLAY_TEACHER_MODEL,
            "detail": "已启用教师训练的诊断主模型，覆盖系统标准规则。",
            "teacher_model_active": True,
        }

    return {
        "type": BUILTIN_RULE_ENGINE,
        "engine": BUILTIN_RULE_ENGINE,
        "version": "builtin-v1",
        "display_name": DISPLAY_BUILTIN_RULE,
        "detail": "使用系统内建飞行健康规则引擎（真实日志解析），无需教师模型即可分析。",
        "teacher_model_active": False,
    }


def flight_health_engine_status():
    """供 GET /api/flight-health/engine-status 使用的状态负载。"""
    resolved = resolve_flight_health_engine()
    return {
        "ok": True,
        "engine_type": resolved["type"],
        "engine_name": resolved["engine"],
        "version": resolved.get("version"),
        "display_name": resolved["display_name"],
        "detail": resolved["detail"],
        "teacher_model_active": resolved["teacher_model_active"],
    }


if __name__ == "__main__":
    import json
    print(json.dumps(flight_health_engine_status(), ensure_ascii=False, indent=2))
