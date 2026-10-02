from __future__ import annotations

import asyncio
from uuid import uuid4

from .vision import VisionResponseError, VisionUnavailable

UNCERTAIN_MESSAGE = "目前资料不足，AI 无法可靠判断，请与线下教师确认。"
SAFETY_MESSAGE = "AI 可以提供教学说明，但不能取代教师的安全确认。当前操作必须由线下教师确认后才能继续。"

class LiveCoachAskService:
    def __init__(self, sessions, vision_adapter, rag_adapter, *, max_visual_jobs: int = 2):
        self.sessions = sessions
        self.vision_adapter = vision_adapter
        self.rag_adapter = rag_adapter
        self._visual_jobs = asyncio.Semaphore(max_visual_jobs)

    @staticmethod
    def classify(question: str) -> str:
        normalized = question.lower()
        safety_terms = ("上电", "通电", "解锁", "起飞", "马达测试", "电机测试", "failsafe", "prearm", "飞前", "放行", "真实飞行", "安全")
        visual_terms = ("帮我看", "看一下", "画面", "镜头", "这个是什么", "对不对", "方向", "接对", "桨叶", "螺旋桨")
        step_terms = ("下一步", "现在做什么", "接下来", "怎么继续")
        if any(term in normalized for term in safety_terms): return "safety"
        if any(term in normalized for term in visual_terms): return "visual"
        if any(term in normalized for term in step_terms): return "step"
        return "knowledge"

    @staticmethod
    def _context_prompt(question: str, training: dict, detections: list[dict]) -> str:
        task = training.get("task") or {}
        step = training.get("current_step") or {}
        facts = ", ".join(f"{item.get('class')} ({item.get('confidence', 0):.2f})" for item in detections) or "未使用视觉 / 无可靠视觉事实"
        return (
            "你是 F450 实训知识解释层，不负责 PASS、完成或安全放行。\n"
            f"当前任务：Task {int(task.get('order') or 0):02d} {task.get('title') or ''}\n"
            f"当前步骤：{step.get('step_id') or '未开始'} {step.get('title') or ''}\n"
            f"学生操作：{step.get('student_instruction') or step.get('instruction') or ''}\n"
            f"硬件配置：{training.get('hardware_profile') or ''}\n"
            f"安全状态：{training.get('safety_state') or ''}；教师关卡：{training.get('teacher_review_state') or ''}\n"
            f"视觉事实：{facts}\n学生问题：{question}\n"
            "请依据当前 SOP 与知识库，用简短中文解释；资料不足时明确要求教师确认。"
        )

    async def answer(self, session_id: str, question: str, image_data: str | None = None) -> dict:
        training = self.sessions.training_state(session_id)
        classification = self.classify(question)
        detections: list[dict] = []
        vision_used = False
        if classification == "visual":
            if not image_data: raise ValueError("visual_frame_required")
            async with self._visual_jobs:
                try:
                    result = await self.vision_adapter.detect(image_data, "coach-question.jpg", 0.25)
                except (VisionUnavailable, VisionResponseError):
                    return self._payload(classification, UNCERTAIN_MESSAGE, "error", True, True, False)
            detections = result.detections
            vision_used = True
        rag = await self.rag_adapter.query(self._context_prompt(question, training, detections), str(uuid4()), 1)
        low_confidence = classification == "visual" and (not detections or max(float(item.get("confidence", 0)) for item in detections) < 0.5)
        if classification == "safety": return self._payload(classification, SAFETY_MESSAGE, rag.status, False, False, True)
        task = training.get("task") or {}
        step = training.get("current_step") or {}
        if classification == "step":
            lead = f"你现在在 Task {int(task.get('order') or 0):02d}「{task.get('title') or ''}」，当前步骤是「{step.get('title') or '尚未开始'}」。"
            explanation = f" {rag.explanation}" if rag.hit and rag.explanation else ""
            answer = f"{lead}{step.get('student_instruction') or step.get('instruction') or ''}{explanation}".strip()
            return self._payload(classification, answer, rag.status, False, False, False)
        if low_confidence or not rag.hit or not rag.explanation: return self._payload(classification, UNCERTAIN_MESSAGE, rag.status, vision_used, True, False)
        answer = rag.explanation
        return self._payload(classification, answer, rag.status, vision_used, False, False)

    @staticmethod
    def _payload(classification, answer, rag_status, vision_used, uncertainty, teacher_required):
        return {"classification": classification, "answer": answer, "rag_status": rag_status, "vision_used": vision_used, "teacher_required": teacher_required, "uncertainty": uncertainty}
