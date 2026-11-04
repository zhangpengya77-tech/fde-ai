"""通用相容格式（OpenAI Chat Completions）大模型供應者（2026-11-04）。

給「免費或便宜」的雲端模型用：Google Gemini（免費額度）、阿里雲通義千問（Model Studio）、OpenRouter 等，
它們都提供與 OpenAI 相同的 /chat/completions 介面。換服務只要改設定（網址、模型、金鑰），不用改程式。

- 文字：system＋user 訊息
- 畫面：user 內容加一張 base64 JPEG（image_url 的 data URL）；可用 allow_images=False 關閉（例如顧慮學員照片外傳）
"""
from __future__ import annotations

import asyncio
import base64
import time

import httpx

from .prompts import COACH_SYSTEM_PROMPT
from .provider_base import GeneralAIProvider, GeneralAIResult
from .provider_openai import OpenAITextProvider

# 各服務預設值；網址與模型都可用環境變數覆寫
PRESETS = {
    # Google Gemini：免費額度（不需信用卡）、支援看圖；免費版內容可能被 Google 用來改善產品
    "gemini": {"base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "gemini-3.8-flash", "key_env": "GEMINI_API_KEY"},
    # 阿里雲通義千問（新加坡國際站）：網址需含工作空間 ID，請在 FDE_GENERAL_BASE_URL 設定
    "qwen": {"base_url": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "model": "qwen3.8-max", "key_env": "DASHSCOPE_API_KEY"},
    # OpenRouter：免費模型每日次數很少，需自行指定模型
    "openrouter": {"base_url": "https://openrouter.ai/api/v1", "model": "", "key_env": "OPENROUTER_API_KEY"},
}


class OpenAICompatibleProvider(GeneralAIProvider):
    def __init__(self, api_key: str, *, base_url: str, model: str, provider_name: str = "openai_compatible",
                 vision_model: str | None = None, allow_images: bool = True, timeout_seconds: float = 25.0,
                 client: httpx.AsyncClient | None = None):
        if not api_key.strip():
            raise ValueError("general_api_key_required")
        if not model.strip() or not base_url.strip():
            raise ValueError("general_model_and_base_url_required")
        self._api_key = api_key
        self.endpoint = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.vision_model = vision_model or model
        self.provider_name = provider_name
        self.allow_images = allow_images
        self.timeout_seconds = timeout_seconds
        self.client = client or httpx.AsyncClient()

    @staticmethod
    def _extract(payload: dict) -> str:
        """取出回答文字；部分服務的 content 會是陣列。"""
        try:
            content = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            return ""
        if isinstance(content, list):
            content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
        return str(content or "").strip()

    async def _call(self, model: str, user_content, *, source: str) -> GeneralAIResult:
        started = time.perf_counter()
        try:
            response = await asyncio.wait_for(
                self.client.post(
                    self.endpoint,
                    headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
                    json={
                        "model": model,
                        "messages": [{"role": "system", "content": COACH_SYSTEM_PROMPT}, {"role": "user", "content": user_content}],
                        "max_tokens": 600,
                    },
                ),
                timeout=self.timeout_seconds,
            )
        except TimeoutError:
            return self._result(started, model, source=source, error="provider_timeout", provider_status="ERROR")
        except (httpx.HTTPError, OSError):
            return self._result(started, model, source=source, error="provider_network_error", provider_status="ERROR")
        if response.status_code >= 400:
            # 429＝免費額度或每分鐘次數用完；401／403＝金鑰錯誤
            error_type = {401: "invalid_api_key", 403: "invalid_api_key", 429: "rate_limited"}.get(response.status_code, f"provider_http_{response.status_code}")
            return self._result(started, model, source=source, error=f"provider_http_{response.status_code}", http_status=response.status_code, error_type=error_type, provider_status="ERROR")
        try:
            payload = response.json()
        except ValueError:
            return self._result(started, model, source=source, error="provider_invalid_response")
        answer = self._extract(payload) if isinstance(payload, dict) else ""
        if not answer:
            return self._result(started, model, source=source, error="provider_empty_answer")
        usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
        tokens = {"input_tokens": int(usage.get("prompt_tokens") or 0), "output_tokens": int(usage.get("completion_tokens") or 0),
                  "total_tokens": int(usage.get("total_tokens") or 0)}
        return self._result(started, model, answer=answer, tokens=tokens, source=source, http_status=response.status_code)

    async def generate(self, *, question: str, session: dict, task: dict, step: dict, language: str = "zh-TW") -> GeneralAIResult:
        return await self._call(self.model, OpenAITextProvider._input(question, session, task, step), source="AI_REFERENCE")

    async def generate_visual(self, *, question: str, session: dict, task: dict, step: dict, image_bytes: bytes, language: str = "zh-TW", safety_level: str | None = None) -> GeneralAIResult:
        prompt = OpenAITextProvider._input(question, session, task, step)
        if not self.allow_images:
            # 設定為不傳照片：只用文字（含 V7 判讀結果與教材）回答
            return await self._call(self.model, prompt + "\n（未附鏡頭畫面，請依文字資訊回答）", source="AI_REFERENCE")
        started = time.perf_counter()
        try:
            compressed = OpenAITextProvider.compress_image(image_bytes)
        except (OSError, ValueError):
            return self._result(started, self.vision_model, source="AI_VISUAL_REFERENCE", error="invalid_image")
        content = [
            {"type": "text", "text": prompt + "\n請根據這張學員鏡頭畫面回答。"},
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(compressed).decode("ascii")}},
        ]
        return await self._call(self.vision_model, content, source="AI_VISUAL_REFERENCE")

    def _result(self, started: float, model: str, *, answer: str | None = None, tokens: dict | None = None, source: str = "AI_REFERENCE",
                error: str | None = None, http_status: int | None = None, error_type: str | None = None, provider_status: str = "READY") -> GeneralAIResult:
        return GeneralAIResult(
            answer=answer, provider=self.provider_name, model=model,
            latency_ms=round((time.perf_counter() - started) * 1000, 1), tokens=tokens or {}, source=source,
            error=error, http_status=http_status, error_type=error_type or error, provider_status=provider_status,
        )
