from __future__ import annotations

import asyncio
import base64
from io import BytesIO
import time

import httpx
from PIL import Image, ImageOps

from .provider_base import GeneralAIProvider, GeneralAIResult


class OpenAITextProvider(GeneralAIProvider):
    endpoint = "https://api.openai.com/v1/responses"

    def __init__(self, api_key: str, *, model: str = "gpt-5.6-luna", timeout_seconds: float = 20.0, client: httpx.AsyncClient | None = None):
        if not api_key.strip():
            raise ValueError("openai_api_key_required")
        self._api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.client = client or httpx.AsyncClient()

    @staticmethod
    def _instructions(language: str) -> str:
        return (
            "你是 FDE-AI-UAS 無人載具教學助教。"
            f"請使用{language}繁體中文，以 2 至 4 句回答。"
            "先直接回答，再告訴學生下一步，必要時補充安全提醒。"
            "不得編造硬體狀態、步驟完成、教師確認或安全放行。"
            "涉及上電、解鎖、Motor Test、Failsafe、飛行、螺旋槳或電池時，"
            "只能解釋與提醒，不能批准操作。"
        )

    @staticmethod
    def _input(question: str, session: dict, task: dict, step: dict) -> str:
        return (
            "Course: F450 AI 實訓\n"
            f"Session: {session.get('session_id') or ''}\n"
            f"Current Task: {task.get('id') or task.get('task_id') or ''} {task.get('title') or ''}\n"
            f"Current Step: {step.get('step_id') or ''} {step.get('title') or ''}\n"
            f"Step Instruction: {step.get('student_instruction') or step.get('instruction') or ''}\n"
            f"Safety State: {session.get('safety_state') or ''}\n"
            f"Student Question: {question}"
        )

    @staticmethod
    def _extract_answer(payload: dict) -> str | None:
        direct = payload.get("output_text")
        if isinstance(direct, str) and direct.strip():
            return direct.strip()
        for item in payload.get("output") or []:
            if not isinstance(item, dict):
                continue
            for content in item.get("content") or []:
                if isinstance(content, dict) and content.get("type") == "output_text" and isinstance(content.get("text"), str):
                    value = content["text"].strip()
                    if value:
                        return value
        return None

    async def generate(self, *, question: str, session: dict, task: dict, step: dict, language: str = "zh-TW") -> GeneralAIResult:
        started = time.perf_counter()
        try:
            response = await asyncio.wait_for(
                self.client.post(
                    self.endpoint,
                    headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
                    json={
                        "model": self.model,
                        "instructions": self._instructions(language),
                        "input": self._input(question, session, task, step),
                        "max_output_tokens": 256,
                    },
                ),
                timeout=self.timeout_seconds,
            )
        except TimeoutError:
            return self._result(started, error="provider_timeout", error_type="provider_timeout", provider_status="ERROR")
        except (httpx.HTTPError, OSError):
            return self._result(started, error="provider_network_error", error_type="provider_network_error", provider_status="ERROR")
        if response.status_code >= 400:
            return self._http_error(started, response)
        try:
            payload = response.json()
        except ValueError:
            return self._result(started, error="provider_invalid_response")
        answer = self._extract_answer(payload) if isinstance(payload, dict) else None
        if not answer:
            return self._result(started, error="provider_empty_answer")
        usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
        tokens = {key: int(usage.get(key) or 0) for key in ("input_tokens", "output_tokens", "total_tokens")}
        return self._result(started, answer=answer, tokens=tokens, http_status=response.status_code)

    @staticmethod
    def compress_image(image_bytes: bytes, *, max_dimension: int = 1024, quality: int = 80) -> bytes:
        with Image.open(BytesIO(image_bytes)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
            output = BytesIO()
            image.save(output, format="JPEG", quality=quality, optimize=True)
            return output.getvalue()

    async def generate_visual(self, *, question: str, session: dict, task: dict, step: dict, image_bytes: bytes, language: str = "zh-TW", safety_level: str | None = None) -> GeneralAIResult:
        started = time.perf_counter()
        try:
            compressed = self.compress_image(image_bytes)
        except (OSError, ValueError):
            return self._result(started, source="AI_VISUAL_REFERENCE", error="invalid_image")
        image_url = "data:image/jpeg;base64," + base64.b64encode(compressed).decode("ascii")
        try:
            response = await asyncio.wait_for(
                self.client.post(
                    self.endpoint,
                    headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
                    json={
                        "model": self.model,
                        "instructions": self._instructions(language),
                        "input": [{"role": "user", "content": [
                            {"type": "input_text", "text": self._input(question, session, task, step)},
                            {"type": "input_image", "image_url": image_url},
                        ]}],
                        "max_output_tokens": 256,
                    },
                ),
                timeout=self.timeout_seconds,
            )
        except TimeoutError:
            return self._result(started, source="AI_VISUAL_REFERENCE", error="provider_timeout", error_type="provider_timeout")
        except (httpx.HTTPError, OSError):
            return self._result(started, source="AI_VISUAL_REFERENCE", error="provider_network_error", error_type="provider_network_error")
        if response.status_code >= 400:
            return self._http_error(started, response, source="AI_VISUAL_REFERENCE")
        try:
            payload = response.json()
        except ValueError:
            return self._result(started, source="AI_VISUAL_REFERENCE", error="provider_invalid_response")
        answer = self._extract_answer(payload) if isinstance(payload, dict) else None
        if not answer:
            return self._result(started, source="AI_VISUAL_REFERENCE", error="provider_empty_answer")
        usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
        tokens = {key: int(usage.get(key) or 0) for key in ("input_tokens", "output_tokens", "total_tokens")}
        return self._result(started, answer=answer, tokens=tokens, source="AI_VISUAL_REFERENCE", http_status=response.status_code)

    def _http_error(self, started: float, response, *, source: str = "AI_REFERENCE") -> GeneralAIResult:
        error_type = f"provider_http_{response.status_code}"
        try:
            code = response.json().get("error", {}).get("code")
            if isinstance(code, str) and code:
                error_type = code
        except (ValueError, AttributeError):
            pass
        status = "CREDIT_EXHAUSTED" if error_type == "credit_balance_exhausted" else "ERROR"
        return self._result(started, source=source, error=f"provider_http_{response.status_code}", http_status=response.status_code, error_type=error_type, provider_status=status)

    def _result(self, started: float, *, answer: str | None = None, tokens: dict[str, int] | None = None, source: str = "AI_REFERENCE", error: str | None = None, http_status: int | None = None, error_type: str | None = None, provider_status: str = "READY") -> GeneralAIResult:
        return GeneralAIResult(
            answer=answer,
            provider="openai",
            model=self.model,
            latency_ms=round((time.perf_counter() - started) * 1000, 1),
            tokens=tokens or {},
            source=source,
            error=error,
            http_status=http_status,
            error_type=error_type or error,
            provider_status=provider_status,
        )
