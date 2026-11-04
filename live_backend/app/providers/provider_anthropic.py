"""Claude（Anthropic）通用大模型供應者（2026-11-04）。

F450 實作 AI 陪做：學員用語音提問時，由 Claude 依當前任務與步驟回答；
問題需要看畫面時，附上一張壓縮後的鏡頭畫面（JPEG）讓 Claude 判讀。
回答要短、口語、繁體中文，因為會直接用語音朗讀給學員聽。
與 OpenAI 供應者介面相同（generate／generate_visual），由 GeneralAIProviderManager 依環境變數選用。
"""
from __future__ import annotations

import asyncio
import base64
import time

import anthropic

from .provider_base import GeneralAIProvider, GeneralAIResult
from .provider_openai import OpenAITextProvider

DEFAULT_MODEL = "claude-opus-5-5"

# 教材依據：F450 以 DJI 官方組裝教學、飛控以 Pixhawk 2.4.8 文件為準（使用者之後提供文件後再補進知識庫）
SYSTEM_PROMPT = (
    "你是 FDE-AI-UAS 無人載具教學的 AI 實作助教，正在陪學員組裝 DJI F450 四軸機（飛控 Pixhawk 2.4.8）。"
    "組裝與接線以 DJI F450 官方組裝教學與 Pixhawk 2.4.8 文件為依據；不確定或文件沒寫的，直接說不確定並請學員問老師，不要編造。"
    "請用繁體中文、口語、2 到 4 句回答，因為回答會用語音唸給學員聽：先直接回答，再說下一步要做什麼。"
    "看畫面時只描述畫面中真的看得到的東西；看不清楚就請學員把目標移到鏡頭中央、靠近一點再問。"
    "不得聲稱步驟已完成、老師已確認或安全已放行。"
    "涉及上電、解鎖、馬達測試、Failsafe、飛行、裝螺旋槳或電池時，只能解釋與提醒安全，不能批准操作。"
    "F450 X 型旋向：左前 M3、右後 M4 為 CW；右前 M1、左後 M2 為 CCW。"
)


class AnthropicTextProvider(GeneralAIProvider):
    """以 Anthropic 官方 SDK 呼叫 Claude Messages API。"""

    def __init__(self, api_key: str, *, model: str = DEFAULT_MODEL, timeout_seconds: float = 25.0, client: anthropic.AsyncAnthropic | None = None):
        if not api_key.strip():
            raise ValueError("anthropic_api_key_required")
        self.model = model
        self.timeout_seconds = timeout_seconds
        # 逾時由 asyncio.wait_for 控制；SDK 自身重試 1 次即可，避免語音等太久
        self.client = client or anthropic.AsyncAnthropic(api_key=api_key, max_retries=1, timeout=timeout_seconds)

    async def _call(self, content, *, source: str) -> GeneralAIResult:
        started = time.perf_counter()
        try:
            response = await asyncio.wait_for(
                self.client.beta.messages.create(
                    model=self.model,
                    max_tokens=1024,  # 回答很短；保留空間給模型思考
                    system=SYSTEM_PROMPT,
                    # 即時語音陪做重視反應速度：低 effort（Opus 5.5 預設為 medium）
                    output_config={"effort": "low"},
                    # 安全分類器拒答時，由伺服器自動改用合適的備援模型（預設模式）
                    betas=["server-side-fallback-2026-07-01"],
                    fallbacks="default",
                    messages=[{"role": "user", "content": content}],
                ),
                timeout=self.timeout_seconds,
            )
        except TimeoutError:
            return self._result(started, source=source, error="provider_timeout", error_type="provider_timeout", provider_status="ERROR")
        except anthropic.AuthenticationError:
            return self._result(started, source=source, error="provider_http_401", http_status=401, error_type="invalid_api_key", provider_status="ERROR")
        except anthropic.RateLimitError:
            return self._result(started, source=source, error="provider_http_429", http_status=429, error_type="rate_limited", provider_status="ERROR")
        except anthropic.APIStatusError as error:
            return self._result(started, source=source, error=f"provider_http_{error.status_code}", http_status=error.status_code, error_type=f"provider_http_{error.status_code}", provider_status="ERROR")
        except anthropic.APIConnectionError:
            return self._result(started, source=source, error="provider_network_error", error_type="provider_network_error", provider_status="ERROR")
        # 整條備援鏈都拒答：不顯示內容，交給老師
        if response.stop_reason == "refusal":
            return self._result(started, source=source, error="provider_refusal", error_type="provider_refusal")
        answer = "".join(block.text for block in response.content if block.type == "text").strip()
        if not answer:
            return self._result(started, source=source, error="provider_empty_answer")
        usage = response.usage
        tokens = {
            "input_tokens": int(usage.input_tokens or 0),
            "output_tokens": int(usage.output_tokens or 0),
            "total_tokens": int((usage.input_tokens or 0) + (usage.output_tokens or 0)),
        }
        return self._result(started, answer=answer, tokens=tokens, source=source, http_status=200)

    async def generate(self, *, question: str, session: dict, task: dict, step: dict, language: str = "zh-TW") -> GeneralAIResult:
        prompt = OpenAITextProvider._input(question, session, task, step)  # 沿用同一份任務／步驟背景格式
        return await self._call([{"type": "text", "text": prompt}], source="AI_REFERENCE")

    async def generate_visual(self, *, question: str, session: dict, task: dict, step: dict, image_bytes: bytes, language: str = "zh-TW", safety_level: str | None = None) -> GeneralAIResult:
        started = time.perf_counter()
        try:
            # 壓到 1024px JPEG，減少上傳量與延遲
            compressed = OpenAITextProvider.compress_image(image_bytes)
        except (OSError, ValueError):
            return self._result(started, source="AI_VISUAL_REFERENCE", error="invalid_image")
        prompt = OpenAITextProvider._input(question, session, task, step)
        content = [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.standard_b64encode(compressed).decode("ascii")}},
            {"type": "text", "text": prompt + "\n請根據上面這張學員鏡頭畫面回答。"},
        ]
        return await self._call(content, source="AI_VISUAL_REFERENCE")

    def _result(self, started: float, *, answer: str | None = None, tokens: dict[str, int] | None = None, source: str = "AI_REFERENCE", error: str | None = None, http_status: int | None = None, error_type: str | None = None, provider_status: str = "READY") -> GeneralAIResult:
        return GeneralAIResult(
            answer=answer,
            provider="anthropic",
            model=self.model,
            latency_ms=round((time.perf_counter() - started) * 1000, 1),
            tokens=tokens or {},
            source=source,
            error=error,
            http_status=http_status,
            error_type=error_type or error,
            provider_status=provider_status,
        )
