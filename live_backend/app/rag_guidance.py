from __future__ import annotations

import asyncio
from uuid import uuid4

from .rag import RAGAdapter, RAGResult
from .rag_context import RAGContext, RAGContextBuilder, build_question
from .sessions import InMemorySessionStore
from .sop import DetectionFact, SopDecision, SopStep


class RAGGuidanceProvider:
    def __init__(self, adapter: RAGAdapter):
        self.adapter = adapter

    async def explain(self, context: RAGContext, request_id: str) -> RAGResult:
        return await self.adapter.query(build_question(context), request_id, context.context_version)


class ContextualGuidanceCoordinator:
    def __init__(
        self,
        sessions: InMemorySessionStore,
        context_builder: RAGContextBuilder,
        provider: RAGGuidanceProvider,
    ):
        self.sessions = sessions
        self.context_builder = context_builder
        self.provider = provider
        self._tasks: set[asyncio.Task] = set()

    def schedule(
        self,
        session_id: str,
        step: SopStep,
        fact: DetectionFact | None,
        decision: SopDecision,
    ) -> bool:
        session = self.sessions.get(session_id)
        if session is None or session.state == "TASK_COMPLETED":
            return False
        context = self.context_builder.build(
            session, step, fact, decision, self.sessions.events(session_id)
        )
        dedup_key = "|".join([
            session_id,
            context.step_id,
            context.sop_result,
            context.error_code or "",
            context.detected_class or "",
        ])
        request_id = str(uuid4())
        if not self.sessions.begin_rag_request(session_id, dedup_key, request_id, context):
            return False
        task = asyncio.create_task(self._run(context, request_id))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return True

    async def _run(self, context: RAGContext, request_id: str) -> None:
        try:
            result = await self.provider.explain(context, request_id)
        except Exception:
            result = RAGResult(
                "error", None, None, None, 0, False, "rag_error",
                request_id, context.context_version
            )
        self.sessions.complete_rag_request(
            context.session_id,
            context.step_id,
            context.context_version,
            request_id,
            context.sop_result,
            result.as_dict(),
        )

    async def wait_all(self) -> None:
        while self._tasks:
            await asyncio.gather(*tuple(self._tasks), return_exceptions=True)
