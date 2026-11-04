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
        """2026-11-04：通用大模型可選 Claude（Anthropic）或 GPT（OpenAI）。

        FDE_GENERAL_PROVIDER=anthropic／openai 可明確指定；未指定時有 ANTHROPIC_API_KEY 就用 Claude，
        否則用 OPENAI_API_KEY。都沒有則停用（前台仍有知識庫回答）。FDE_GENERAL_MODEL 可覆寫模型。
        """
        choice = os.environ.get("FDE_GENERAL_PROVIDER", "").strip().lower()
        anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        openai_key = os.environ.get("OPENAI_API_KEY", "").strip()
        model_override = os.environ.get("FDE_GENERAL_MODEL", "").strip()
        if anthropic_key and choice in ("", "anthropic", "claude"):
            from .provider_anthropic import DEFAULT_MODEL, AnthropicTextProvider  # 延後載入：未用 Claude 時不需安裝 SDK
            # 沿用舊的 GPT 模型名稱設定時不能傳給 Claude
            model = model_override if model_override.startswith("claude-") else DEFAULT_MODEL
            return cls(AnthropicTextProvider(anthropic_key, model=model))
        if openai_key and choice in ("", "openai", "gpt"):
            model = model_override if model_override and not model_override.startswith("claude-") else "gpt-5.6-luna"
            return cls(OpenAITextProvider(openai_key, model=model))
        return cls()

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
            # 依實際使用的供應者回報（anthropic 或 openai）
            # 未設定時維持舊行為回報 openai（既有健康檢查契約）
            "provider": "anthropic" if type(provider).__name__ == "AnthropicTextProvider" else "openai",
            "model": getattr(provider, "model", "gpt-5.6-luna"),
            "text_enabled": self.enabled,
            "vision_enabled": self.enabled,
            "last_status": self.last_status,
            "last_error_type": self.last_error_type,
            "usage_summary": self.telemetry.summary(),
        }
