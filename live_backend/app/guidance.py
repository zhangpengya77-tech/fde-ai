from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass
from typing import Protocol

from .sop import SopDecision


@dataclass(frozen=True)
class CoachMessage:
    text: str
    code: str
    channel: str = "text"

    def as_dict(self) -> dict:
        return asdict(self)


class VoiceInput(Protocol):
    async def listen(self) -> str: ...


class VoiceOutput(Protocol):
    async def speak(self, message: CoachMessage) -> None: ...


class GuidanceProvider(ABC):
    @abstractmethod
    def get_guidance(self, session: dict, decision: SopDecision, error_code: str | None) -> CoachMessage:
        raise NotImplementedError


class RAGGuidanceProvider(GuidanceProvider):
    def get_guidance(self, session: dict, decision: SopDecision, error_code: str | None) -> CoachMessage:
        raise NotImplementedError("RAG integration is outside Phase 2")


class DeterministicGuidanceProvider(GuidanceProvider):
    def get_guidance(self, session: dict, decision: SopDecision, error_code: str | None) -> CoachMessage:
        status = decision.status
        expected = (decision.expected_classes or (session.get("expected_class"),))[0]
        detected = decision.detected_class or "未知"
        messages = {
            "NO_DETECTION": "目前没有识别到目标零件，请把零件完整放入画面。",
            "UNCERTAIN": "目前辨识信心不足，请将零件靠近镜头并保持稳定。",
            "NG": f"目前步骤需要 {expected}，但辨识到 {detected}，请更换正确零件。",
            "PASS_CANDIDATE": "已识别到当前步骤需要的零件，请确认后继续。",
            "STEP_COMPLETED": "步骤完成，进入下一步。",
            "TASK_COMPLETED": "零件辨识与准备任务已完成。",
            "TEACHER_CHECK": "此步骤属于安全节点，需要教师确认。",
            "OFFLINE": "视觉服务暂时无法使用，请稍后重试。",
        }
        return CoachMessage(messages.get(status, "请依照当前步骤继续操作。"), status)
