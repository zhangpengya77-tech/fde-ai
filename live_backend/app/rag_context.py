from __future__ import annotations

from dataclasses import asdict, dataclass

from .sessions import LiveSession
from .sop import DetectionFact, SopDecision, SopStep


@dataclass(frozen=True)
class RAGContext:
    session_id: str
    course_id: str
    task_id: str
    step_id: str
    step_title: str
    instruction: str
    expected_class: str
    detected_class: str | None
    confidence: float | None
    sop_result: str
    error_code: str | None
    recent_error_history: tuple[dict, ...]
    event_sequence: int
    context_version: int

    def as_dict(self) -> dict:
        value = asdict(self)
        value["recent_error_history"] = list(self.recent_error_history)
        return value


class RAGContextBuilder:
    ERROR_EVENTS = {"NG", "UNCERTAIN", "NO_DETECTION", "TEACHER_CHECK"}

    def build(
        self,
        session: LiveSession,
        step: SopStep,
        fact: DetectionFact | None,
        decision: SopDecision,
        events: list[dict],
    ) -> RAGContext:
        history = []
        for event in events:
            if event.get("type") not in self.ERROR_EVENTS:
                continue
            data = event.get("data") if isinstance(event.get("data"), dict) else {}
            history.append({
                "step_id": event.get("step_id"),
                "sop_result": event.get("type"),
                "error_code": data.get("error_code"),
                "detected_class": data.get("detected_class"),
            })
        return RAGContext(
            session_id=session.session_id,
            course_id=session.course_id,
            task_id=session.task_id,
            step_id=session.current_step_id,
            step_title=step.title,
            instruction=step.instruction,
            expected_class=step.expected_classes[0],
            detected_class=fact.class_name if fact else decision.detected_class,
            confidence=fact.confidence if fact else decision.confidence,
            sop_result=decision.status,
            error_code=decision.error_code,
            recent_error_history=tuple(history[-5:]),
            event_sequence=session.sequence,
            context_version=session.context_version,
        )


def build_question(context: RAGContext) -> str:
    return (
        f"当前课程：{context.course_id}\n"
        f"当前任务：{context.task_id}\n"
        f"当前步骤：{context.step_title}（{context.step_id}）\n"
        f"步骤说明：{context.instruction}\n"
        f"期望零件：{context.expected_class}\n"
        f"视觉辨识：{context.detected_class or '无'}\n"
        f"置信度：{context.confidence if context.confidence is not None else '无'}\n"
        f"SOP 结果：{context.sop_result}\n"
        f"错误代码：{context.error_code or '无'}\n"
        "请根据 F450 教学知识说明原因、零件差异或辨识问题，以及学员可采取的安全修正方式。"
        "不要判断 PASS 或 NG，不要推进步骤，也不要授权通电、解锁或起飞。"
    )
