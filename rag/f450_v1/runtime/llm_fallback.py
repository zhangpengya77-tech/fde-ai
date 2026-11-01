from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SYSTEM_PROMPT = """你是 F450 四面悬停课程的简洁教学助理。优先依据提供的知识库证据回答；证据不完整时，先说明证据支持的内容，再清楚标记一般无人机常识补充。没有证据时，答案必须以「根据一般无人机常识补充：」开头。
不得伪造具体参数、不得编造来源、不得把常识说成知识库内容、不得输出本机文件路径。涉及不确定的高风险参数时，不给数值或操作指令，建议先询问老师确认。回答简短，最多三句；证据不足时直接说明不确定。"""


class LLMFallback:
    """Optional OpenAI-compatible chat completion client configured only by environment."""

    def __init__(self, *, opener=None):
        self.enabled = os.getenv("LLM_FALLBACK_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
        self.provider = os.getenv("LLM_PROVIDER", "openai_compatible").strip()
        self.model = os.getenv("LLM_MODEL", "").strip()
        self.api_key = os.getenv("LLM_API_KEY", "").strip()
        self.base_url = os.getenv("LLM_API_BASE_URL", "").strip().rstrip("/")
        try:
            self.timeout = min(60.0, max(1.0, float(os.getenv("LLM_FALLBACK_TIMEOUT_SECONDS", "15"))))
        except ValueError:
            self.timeout = 15.0
        self.opener = opener or urlopen

    def complete(self, *, question: str, normalized_query: str, evidence: list[dict]) -> str | None:
        if not (self.enabled and self.provider and self.model and self.api_key and self.base_url):
            return None

        endpoint = self.base_url if self.base_url.endswith("/chat/completions") else f"{self.base_url}/chat/completions"
        context = {
            "original_question": question,
            "normalized_query": normalized_query,
            "rag_top_k": evidence,
        }
        body = json.dumps({
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
            ],
            "temperature": 0.2,
            "max_tokens": 350,
        }, ensure_ascii=False).encode("utf-8")
        request = Request(endpoint, data=body, headers={
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }, method="POST")

        try:
            with self.opener(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
            answer = payload["choices"][0]["message"]["content"]
            return answer.strip() if isinstance(answer, str) and answer.strip() else None
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, TypeError, KeyError, IndexError, json.JSONDecodeError):
            return None
