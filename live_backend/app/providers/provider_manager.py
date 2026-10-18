from __future__ import annotations

import os

from .provider_base import GeneralAIResult
from .provider_openai import OpenAITextProvider
from .usage import ProviderUsageTelemetry


class GeneralAIProviderManager:
    def __init__(self, provider=None, *, telemetry=None):
        self.provider = provider
        self.telemetry = telemetry or ProviderUsageTelemetry()
        self.last_status = "DISABLED" if provider is None else "READY"
        self.last_error_type = None

    @property
    def enabled(self) -> bool:
        return self.provider is not None and bool(getattr(self.provider, "enabled", True))

    @classmethod
    def from_environment(cls):
        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            return cls()
        model = os.environ.get("FDE_GENERAL_MODEL", "gpt-5.6-luna").strip() or "gpt-5.6-luna"
        return cls(OpenAITextProvider(api_key, model=model))

    async def generate(self, **values) -> GeneralAIResult:
        if not self.enabled:
            return GeneralAIResult(None, "disabled", "", 0.0, error="provider_not_configured")
        metadata = self._metadata(values, False)
        result = await self.provider.generate(**values)
        self._record(result, metadata)
        return result

    async def generate_visual(self, **values) -> GeneralAIResult:
        if not self.enabled:
            return GeneralAIResult(None, "disabled", "", 0.0, source="AI_VISUAL_REFERENCE", error="provider_not_configured")
        metadata = self._metadata(values, True)
        result = await self.provider.generate_visual(**values)
        self._record(result, metadata)
        return result

    @staticmethod
    def _metadata(values: dict, vision_used: bool) -> dict:
        task, step = values.get("task") or {}, values.get("step") or {}
        session = values.get("session") or {}
        return {"request_id": session.get("request_id") or "provider-request", "task_id": task.get("id") or task.get("task_id"), "step_id": step.get("step_id"), "vision_used": vision_used}

    def _record(self, result, metadata):
        self.telemetry.record(result, **metadata)
        self.last_status = result.provider_status if result.error else "READY"
        self.last_error_type = result.error_type

    def health_status(self) -> dict:
        provider = self.provider
        return {
            "configured": self.enabled,
            "provider": "openai",
            "model": getattr(provider, "model", "gpt-5.6-luna"),
            "text_enabled": self.enabled,
            "vision_enabled": self.enabled,
            "last_status": self.last_status,
            "last_error_type": self.last_error_type,
            "usage_summary": self.telemetry.summary(),
        }
