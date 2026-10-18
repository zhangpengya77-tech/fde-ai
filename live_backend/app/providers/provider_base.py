from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass(frozen=True)
class GeneralAIResult:
    answer: str | None
    provider: str
    model: str
    latency_ms: float
    tokens: dict[str, int] = field(default_factory=dict)
    confidence: float | None = None
    source: str = "AI_REFERENCE"
    error: str | None = None
    needs_teacher: bool = False
    http_status: int | None = None
    error_type: str | None = None
    provider_status: str = "READY"


class GeneralAIProvider(ABC):
    enabled = True

    @abstractmethod
    async def generate(
        self,
        *,
        question: str,
        session: dict,
        task: dict,
        step: dict,
        language: str = "zh-TW",
    ) -> GeneralAIResult:
        raise NotImplementedError

    @abstractmethod
    async def generate_visual(
        self,
        *,
        question: str,
        session: dict,
        task: dict,
        step: dict,
        image_bytes: bytes,
        language: str = "zh-TW",
        safety_level: str | None = None,
    ) -> GeneralAIResult:
        raise NotImplementedError
