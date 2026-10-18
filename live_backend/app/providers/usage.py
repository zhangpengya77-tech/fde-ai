from __future__ import annotations

from datetime import UTC, datetime

from .provider_base import GeneralAIResult


class ModelCostRegistry:
    def __init__(self, prices: dict | None = None):
        self._prices = dict(prices or {})

    def estimate(self, model: str, input_tokens: int, output_tokens: int, *, image_count: int = 0):
        price = self._prices.get(model)
        if not price:
            return None
        return (
            input_tokens * price["input_token_price"]
            + output_tokens * price["output_token_price"]
            + image_count * price.get("image_cost", 0)
        )


class ProviderUsageTelemetry:
    def __init__(self, cost_registry: ModelCostRegistry | None = None):
        self.records: list[dict] = []
        self.cost_registry = cost_registry or ModelCostRegistry()

    def record(self, result: GeneralAIResult, *, request_id: str, task_id: str | None, step_id: str | None, vision_used: bool) -> dict:
        tokens = dict(result.tokens or {})
        record = {
            "request_id": request_id,
            "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "provider": result.provider,
            "model": result.model,
            "task_id": task_id,
            "step_id": step_id,
            "input_tokens": int(tokens.get("input_tokens") or 0),
            "output_tokens": int(tokens.get("output_tokens") or 0),
            "total_tokens": int(tokens.get("total_tokens") or 0),
            "latency_ms": result.latency_ms,
            "http_status": result.http_status,
            "error_type": result.error_type,
            "answer_source": result.source,
            "vision_used": bool(vision_used),
            "success": bool(result.answer and not result.error),
        }
        record["cost_estimate"] = self.cost_registry.estimate(
            result.model, record["input_tokens"], record["output_tokens"], image_count=1 if vision_used else 0
        )
        self.records.append(record)
        return dict(record)

    def summary(self) -> dict:
        count = len(self.records)
        successful = sum(1 for item in self.records if item["success"])
        latencies = [float(item["latency_ms"]) for item in self.records]
        return {
            "general_ai_requests": count,
            "successful_requests": successful,
            "count_429": sum(1 for item in self.records if item["http_status"] == 429),
            "timeout_count": sum(1 for item in self.records if item["error_type"] == "provider_timeout"),
            "input_tokens": sum(item["input_tokens"] for item in self.records),
            "output_tokens": sum(item["output_tokens"] for item in self.records),
            "average_latency_ms": round(sum(latencies) / count, 1) if count else 0.0,
            "ai_reference_count": sum(1 for item in self.records if item["answer_source"] == "AI_REFERENCE"),
            "ai_visual_reference_count": sum(1 for item in self.records if item["answer_source"] == "AI_VISUAL_REFERENCE"),
        }
