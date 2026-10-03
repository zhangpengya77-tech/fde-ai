from __future__ import annotations

import asyncio
from uuid import uuid4

from .vision import VisionResponseError, VisionUnavailable

UNCERTAIN_MESSAGE = "目前无法可靠读取当前画面。请确认摄像头画面清楚，并把目标零件放到画面中央后再试一次；如果仍无法确认，请教师现场检查。"
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
        safety_terms = ("上电", "上電", "通电", "通電", "解锁", "解鎖", "起飞", "起飛", "马达测试", "馬達測試", "电机测试", "電機測試", "motor test", "failsafe", "prearm", "飞前", "飛前", "放行", "真实飞行", "真實飛行", "安全")
        visual_terms = ("帮我看", "幫我看", "看一下", "画面", "畫面", "镜头", "鏡頭", "这个是什么", "這個是什麼", "对不对", "對不對", "方向", "接对", "接對", "桨叶", "槳葉", "螺旋桨", "螺旋槳")
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

    async def answer(self, session_id: str, question: str, image_data: str | None = None, *, request_id: str | None = None, interaction_id: str | None = None) -> dict:
        training = self.sessions.training_state(session_id)
        classification = "visual" if image_data else self.classify(question)
        detections: list[dict] = []
        vision_used = False
        if classification == "visual":
            if not image_data: raise ValueError("visual_frame_required")
            async with self._visual_jobs:
                try:
                    result = await self.vision_adapter.detect(image_data, "coach-question.jpg", 0.25)
                except (VisionUnavailable, VisionResponseError):
                    return self._payload(classification, UNCERTAIN_MESSAGE, "error", True, True, False, request_id, interaction_id)
            detections = result.detections
            vision_used = True
        rag = await self.rag_adapter.query(self._context_prompt(question, training, detections), str(uuid4()), 1)
        low_confidence = classification == "visual" and (not detections or max(float(item.get("confidence", 0)) for item in detections) < 0.5)
        if classification == "safety": return self._payload(classification, SAFETY_MESSAGE, rag.status, False, False, True, request_id, interaction_id)
        task = training.get("task") or {}
        step = training.get("current_step") or {}
        step_title = step.get("title") or "当前步骤"
        step_action = step.get("student_instruction") or step.get("instruction") or ""
        if classification == "step":
            lead = f"你现在在 Task {int(task.get('order') or 0):02d}「{task.get('title') or ''}」，当前步骤是「{step_title}」。"
            explanation = f" {rag.explanation}" if rag.hit and rag.explanation else ""
            answer = f"{lead}{step_action}{explanation}".strip()
            return self._payload(classification, answer, rag.status, False, False, False, request_id, interaction_id)
        if low_confidence:
            answer = "目前画面中的目标太小、被遮挡或角度不足，AI 无法可靠确认。请把要确认的零件单独放到画面中央，再让我看一次；如果仍无法确认，请教师现场检查。"
            return self._payload(classification, answer, rag.status, vision_used, True, False, request_id, interaction_id)
        if classification == "visual" and detections:
            labels = {"motor": "马达", "esc": "电子调速器", "pixhawk": "飞控模块", "flight_controller": "飞控模块", "gps": "GPS / 罗盘模块", "gps_compass": "GPS / 罗盘模块", "receiver": "接收机", "frame_arm": "机臂"}
            observed = "、".join(labels.get(str(item.get("class", "")).lower(), str(item.get("class") or "零件")) for item in detections[:4])
            confidence = max(float(item.get("confidence", 0)) for item in detections)
            certainty = "看到" if confidence >= 0.75 else "看到疑似"
            answer = f"目前画面中 AI {certainty}{observed}。当前步骤是「{step_title}」。"
            if step_action:
                answer += f"下一步：{step_action}"
            if rag.hit and rag.explanation:
                answer += f" {rag.explanation}"
            return self._payload(classification, answer, rag.status, True, False, False, request_id, interaction_id)
        if not rag.hit or not rag.explanation:
            if step_action:
                answer = f"当前步骤是「{step_title}」。现在先做：{step_action} 如果你要确认具体零件或接口，请把目标放到画面中央再问我。"
                return self._payload(classification, answer, rag.status, vision_used, False, False, request_id, interaction_id)
            answer = "目前缺少可核对的步骤或画面信息。请先打开具体任务，或把要确认的零件放到画面中央；如果涉及安全操作，请教师现场检查。"
            return self._payload(classification, answer, rag.status, vision_used, True, False, request_id, interaction_id)
        answer = rag.explanation
        return self._payload(classification, answer, rag.status, vision_used, False, False, request_id, interaction_id)

    @staticmethod
    def _payload(classification, answer, rag_status, vision_used, uncertainty, teacher_required, request_id=None, interaction_id=None):
        return {"classification": classification, "answer": answer, "student_answer": answer, "rag_status": rag_status, "vision_used": vision_used, "teacher_required": teacher_required, "uncertainty": uncertainty, "request_id": request_id, "interaction_id": interaction_id}
