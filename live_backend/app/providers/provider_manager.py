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
        # 免費／便宜的通用相容格式服務（Gemini、通義千問、OpenRouter）；排在 OpenAI 前面，
        # 避免系統裡殘留的舊 OpenAI 金鑰（已失效）搶先被選用
        compat = cls._compatible_from_environment(choice, model_override)
        if compat is not None:
            return cls(compat)
        if openai_key and choice in ("", "openai", "gpt"):
            model = model_override if model_override and not model_override.startswith("claude-") else "gpt-5.6-luna"
            return cls(OpenAITextProvider(openai_key, model=model))
        return cls()

    @staticmethod
    def _compatible_from_environment(choice: str, model_override: str):
        """依 FDE_GENERAL_PROVIDER（gemini／qwen／openrouter／compat）或已設定的金鑰建立通用相容格式供應者。

        可用環境變數：FDE_GENERAL_API_KEY（或各服務自己的 GEMINI_API_KEY／DASHSCOPE_API_KEY／OPENROUTER_API_KEY）、
        FDE_GENERAL_BASE_URL、FDE_GENERAL_MODEL、FDE_GENERAL_VISION_MODEL、FDE_GENERAL_SEND_IMAGES（0＝不傳鏡頭畫面）。
        """
        from .provider_openai_compat import PRESETS, OpenAICompatibleProvider

        if choice in PRESETS:
            names = [choice]
        elif choice == "compat":
            names = ["compat"]
        elif choice == "":
            names = [name for name, preset in PRESETS.items() if os.environ.get(preset["key_env"], "").strip()]
        else:
            return None
        for name in names:
            preset = PRESETS.get(name, {"base_url": "", "model": "", "key_env": ""})
            key = os.environ.get("FDE_GENERAL_API_KEY", "").strip() or os.environ.get(preset["key_env"], "").strip() if preset["key_env"] else os.environ.get("FDE_GENERAL_API_KEY", "").strip()
            base_url = os.environ.get("FDE_GENERAL_BASE_URL", "").strip() or preset["base_url"]
            # 舊設定裡的 GPT／Claude 模型名稱不能傳給其他服務
            model = model_override if model_override and not model_override.startswith(("gpt-", "claude-")) else preset["model"]
            if not (key and base_url and model):
                continue
            send_images = os.environ.get("FDE_GENERAL_SEND_IMAGES", "1").strip().lower() not in ("0", "false", "no", "off")
            vision_model = os.environ.get("FDE_GENERAL_VISION_MODEL", "").strip() or None
            # 備援模型：FDE_GENERAL_FALLBACK_MODELS（逗號分隔）可覆寫；未設定用該服務預設
            fallbacks = [item.strip() for item in os.environ.get("FDE_GENERAL_FALLBACK_MODELS", "").split(",") if item.strip()] or list(preset.get("fallback_models", ()))
            return OpenAICompatibleProvider(key, base_url=base_url, model=model, provider_name=name,
                                            vision_model=vision_model, allow_images=send_images, fallback_models=fallbacks)
        return None

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
            "provider": getattr(provider, "provider_name", None) or ("anthropic" if type(provider).__name__ == "AnthropicTextProvider" else "openai"),
            "model": getattr(provider, "model", "gpt-5.6-luna"),
            "text_enabled": self.enabled,
            "vision_enabled": self.enabled,
            "last_status": self.last_status,
            "last_error_type": self.last_error_type,
            "usage_summary": self.telemetry.summary(),
        }
