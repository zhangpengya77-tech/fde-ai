from __future__ import annotations

import asyncio
import json
import time
from dataclasses import asdict, dataclass
from typing import Any

import httpx


@dataclass(frozen=True)
class RAGResult:
    status: str
    explanation: str | None
    reference_summary: str | None
    sources: list[dict] | None
    latency_ms: float
    hit: bool
    error_code: str | None
    request_id: str
    context_version: int
    source_type: str | None = None
    version: str | None = None

    def as_dict(self) -> dict:
        return asdict(self)


class RAGAdapter:
    def __init__(
        self,
        base_url: str,
        *,
        timeout_seconds: float = 8.0,
        client: httpx.AsyncClient | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.client = client or httpx.AsyncClient()

    async def health(self) -> bool:
        try:
            response = await asyncio.wait_for(
                self.client.get(f"{self.base_url}/api/rag/health"),
                timeout=self.timeout_seconds,
            )
            return response.status_code == 200
        except (TimeoutError, httpx.HTTPError, OSError):
            return False

    def _result(self, status: str, started: float, request_id: str, context_version: int, **values: Any) -> RAGResult:
        return RAGResult(
            status=status,
            explanation=values.get("explanation"),
            reference_summary=values.get("reference_summary"),
            sources=values.get("sources"),
            latency_ms=round((time.perf_counter() - started) * 1000, 1),
            hit=bool(values.get("hit", False)),
            error_code=values.get("error_code"),
            request_id=request_id,
            context_version=context_version,
            source_type=values.get("source_type"),
            version=values.get("version"),
        )

    async def query(self, question: str, request_id: str, context_version: int) -> RAGResult:
        started = time.perf_counter()
        try:
            response = await asyncio.wait_for(
                self.client.post(
                    f"{self.base_url}/api/rag/ask",
                    content=json.dumps({"question": question}, ensure_ascii=False).encode("utf-8"),
                    headers={"Content-Type": "text/plain;charset=UTF-8"},
                ),
                timeout=self.timeout_seconds,
            )
        except TimeoutError:
            return self._result("timeout", started, request_id, context_version, error_code="rag_timeout")
        except (httpx.HTTPError, OSError):
            return self._result("offline", started, request_id, context_version, error_code="rag_offline")
        if response.status_code >= 400:
            return self._result("error", started, request_id, context_version, error_code="rag_http_error")
        try:
            payload = response.json()
        except ValueError:
            return self._result("error", started, request_id, context_version, error_code="rag_invalid_response")
        if not isinstance(payload, dict):
            return self._result("error", started, request_id, context_version, error_code="rag_invalid_schema")
        answer = payload.get("answer")
        if not isinstance(answer, str) or not answer.strip():
            return self._result("no_hit", started, request_id, context_version, error_code="rag_no_hit")
        answer = answer.strip()
        if payload.get("source_type") == "refuse" or "没有找到相关" in answer:
            return self._result("no_hit", started, request_id, context_version, error_code="rag_no_hit")
        sources = payload.get("sources") if isinstance(payload.get("sources"), list) else None
        return self._result(
            "online",
            started,
            request_id,
            context_version,
            explanation=answer,
            reference_summary=payload.get("version") if isinstance(payload.get("version"), str) else None,
            sources=sources,
            hit=True,
            source_type=payload.get("source_type") if isinstance(payload.get("source_type"), str) else None,
            version=payload.get("version") if isinstance(payload.get("version"), str) else None,
        )
