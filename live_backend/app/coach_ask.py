from __future__ import annotations

import asyncio
import base64
import binascii
from uuid import uuid4

from .vision import VisionResponseError, VisionUnavailable
from .teacher_style import TeacherStyleLayer
from . import coach_prop_check

UNCERTAIN_MESSAGE = "目前無法可靠讀取當前畫面。請確認攝像頭畫面清楚，並把目標零件放到畫面中央後再試一次。"
SAFETY_MESSAGE = "AI 可以提供教學說明，但不能取代教師的安全確認。"
TEACHER_SAFETY_NOTICE = "這一步涉及安全，需要教師現場確認。"
UNRELIABLE_MESSAGE = "目前還無法可靠判斷，請補充畫面或資訊後再試一次。"
GENERAL_AI_UNAVAILABLE = "AI 暫時無法補充回答，請稍後再試。"

class LiveCoachAskService:
    def __init__(self, sessions, vision_adapter, rag_adapter, general_ai_provider=None, *, max_visual_jobs: int = 2, teacher_style=None, prop_checker=None):
        self.sessions = sessions
        self.vision_adapter = vision_adapter
        self.rag_adapter = rag_adapter
        self.general_ai_provider = general_ai_provider
        self.teacher_style = teacher_style or TeacherStyleLayer()
        self._visual_jobs = asyncio.Semaphore(max_visual_jobs)
        # 2026-11-04：槳葉旋向判讀（視覺中心啟用中的 V7）；未提供時維持原行為
        self.prop_checker = prop_checker

    @staticmethod
    def _safety_terms() -> tuple[str, ...]:
        return ("上电", "上電", "通电", "通電", "解锁", "解鎖", "起飞", "起飛", "马达测试", "馬達測試", "电机测试", "電機測試", "motor test", "esc calibration", "esc 校准", "esc 校準", "failsafe", "prearm", "arm", "电机方向", "電機方向", "motor direction", "桨叶", "槳葉", "螺旋桨", "螺旋槳", "飞前", "飛前", "放行", "真实飞行", "真實飛行", "首次飞行", "首次飛行", "安全")

    @classmethod
    def is_safety_critical(cls, question: str) -> bool:
        normalized = question.lower()
        return any(term in normalized for term in cls._safety_terms())

    @classmethod
    def classify(cls, question: str) -> str:
        normalized = question.lower()
        visual_terms = ("帮我看", "幫我看", "看一下", "画面", "畫面", "镜头", "鏡頭", "这个是什么", "這個是什麼", "对不对", "對不對", "方向", "接对", "接對", "桨叶", "槳葉", "螺旋桨", "螺旋槳")
        step_terms = ("下一步", "现在做什么", "接下来", "怎么继续")
        if cls.is_safety_critical(question): return "safety"
        if any(term in normalized for term in visual_terms): return "visual"
        if any(term in normalized for term in step_terms): return "step"
        return "knowledge"

    @staticmethod
    def _compact_rag_query(question: str, training: dict, detections: list[dict]) -> str:
        """給知識庫的精簡查詢：學員問題在最前面，後面附步驟編號與畫面偵測結果，總長控制在 400 字內。"""
        step = training.get("current_step") or {}
        facts = "、".join(str(item.get("class")) for item in detections[:4] if item.get("class"))
        hints = "；".join(part for part in (
            f"步驟 {step.get('step_id')} {step.get('title') or ''}".strip() if step.get("step_id") else "",
            f"畫面：{facts}" if facts else "",
        ) if part)
        query = f"{question.strip()}（{hints}）" if hints else question.strip()
        return query[:400]

    @staticmethod
    def _context_prompt(question: str, training: dict, detections: list[dict]) -> str:
        task = training.get("task") or {}
        step = training.get("current_step") or {}
        facts = ", ".join(f"{item.get('class')} ({item.get('confidence', 0):.2f})" for item in detections) or "未使用視覺 / 無可靠視覺事實"
        return (
            "你是 F450 實訓知識解釋層，不負責 PASS、完成或安全放行。\n"
            f"當前任務：Task {int(task.get('order') or 0):02d} {task.get('title') or ''}\n"
            f"當前步驟：{step.get('step_id') or '未開始'} {step.get('title') or ''}\n"
            f"學生操作：{step.get('student_instruction') or step.get('instruction') or ''}\n"
            f"硬體配置：{training.get('hardware_profile') or ''}\n"
            f"安全狀態：{training.get('safety_state') or ''}；教師關卡：{training.get('teacher_review_state') or ''}\n"
            f"視覺事實：{facts}\n學生問題：{question}\n"
            "請依據當前 SOP 與知識庫，用簡短繁體中文解釋。"
        )

    async def answer(self, session_id: str, question: str, image_data: str | None = None, *, request_id: str | None = None, interaction_id: str | None = None) -> dict:
        training = self.sessions.training_state(session_id)
        task = training.get("task") or {}
        step = training.get("current_step") or {}
        teacher_answer = self.sessions.approved_teacher_answer(session_id, question, task.get("id"), step.get("step_id"))
        if teacher_answer:
            result = self._payload(self.classify(question), teacher_answer, "teacher_verified", False, False, self.is_safety_critical(question), request_id, interaction_id, "TEACHER_VERSION")
        else:
            result = await self._answer_unstyled(session_id, question, image_data, request_id=request_id, interaction_id=interaction_id)
        next_action = step.get("student_instruction") or step.get("instruction")
        result["answer"] = self.teacher_style.apply(result["answer"], next_action=next_action, needs_teacher=result["needs_teacher"])
        result["student_answer"] = result["answer"]
        self.sessions.record_coach_turn(session_id, question, result["answer"], result["answer_source"])
        return result

    async def _answer_unstyled(self, session_id: str, question: str, image_data: str | None = None, *, request_id: str | None = None, interaction_id: str | None = None) -> dict:
        training = self.sessions.training_state(session_id)
        safety_critical = self.is_safety_critical(question)
        classification = "visual" if image_data else self.classify(question)
        task = training.get("task") or {}
        step = training.get("current_step") or {}
        detections: list[dict] = []
        vision_used = False
        vision_status = "not_requested"

        if image_data:
            vision_used = True
            async with self._visual_jobs:
                try:
                    result = await self.vision_adapter.detect(image_data, "coach-question.jpg", 0.25)
                    detections = result.detections
                    vision_status = "online"
                except (VisionUnavailable, VisionResponseError):
                    vision_status = "unavailable"

        # 2026-11-04：問槳葉且有鏡頭畫面時，先用 V7 判讀旋向。
        # 槳葉屬安全項目，回答仍會附「需要教師現場確認」；上電、解鎖、飛行類問題不判讀。
        prop_result = None
        if image_data and coach_prop_check.is_prop_question(question):
            prop_result = await coach_prop_check.run_prop_check(self.prop_checker, self._image_bytes(image_data))

        # Beta Classroom P0: General AI is the normal conversational source.
        # SOP/RAG and YOLO facts remain context and fallback aids; none may prevent an answer.
        general = None
        if self._general_enabled():
            # 2026-11-04：先查知識庫（含 DJI Naza-M V2、Pixhawk 2.4.8 手冊），把教材內容一起交給大模型，
            # 讓回答以教材為準；查不到或逾時就照常回答，不阻擋學員。
            model_question = await self._question_with_course_reference(question)
            if prop_result:
                # V7 判讀結果當成可靠事實，讓大模型看畫面時有依據
                model_question += f"\n\n【槳葉模型判讀結果，回答時以此為準】{coach_prop_check.prop_verdict(prop_result)}"
            if image_data and hasattr(self.general_ai_provider, "generate_visual"):
                general = await self._general_visual_answer(session_id, model_question, training, task, step, image_data, request_id)
            elif not image_data:
                general = await self._general_answer(session_id, model_question, training, task, step, request_id)

        if general and general.answer:
            answer = self._teacher_notice(general.answer, safety_critical)
            self._record_candidate(session_id, question, training, general.answer, general, vision_used=vision_used)
            source = "AI_VISUAL_REFERENCE" if image_data else "AI_REFERENCE"
            return self._payload(classification, answer, "enhancement_pending", vision_used, False, safety_critical, request_id, interaction_id, source)

        # 2026-11-04：大模型不可用時，有 V7 槳葉判讀就直接用它回答（比通用範本可靠）
        if prop_result:
            answer = self._teacher_notice(coach_prop_check.prop_verdict(prop_result), safety_critical)
            return self._payload(classification, answer, "vision_model", True, False, safety_critical, request_id, interaction_id, "VISION_MODEL")

        # Provider failure is never a student-facing error. Use local task context first,
        # then use RAG only as a non-blocking enhancement fallback.
        # 2026-11-04：原本送整段指令文字（常超過知識庫 500 字上限、也對不上手冊）。
        # 改成「問題＋簡短步驟與畫面線索」；查不到時再只用學員原問題查一次。
        rag = await self.rag_adapter.query(self._compact_rag_query(question, training, detections), str(uuid4()), 1)
        if not (rag.hit and rag.explanation):
            plain = await self.rag_adapter.query(question.strip()[:400], str(uuid4()), 1)
            if plain.hit and plain.explanation:
                rag = plain
        if classification == "safety":
            explanation = rag.explanation.strip() if rag.hit and rag.explanation else SAFETY_MESSAGE
            answer = f"{explanation.rstrip('。')}。{TEACHER_SAFETY_NOTICE}"
            return self._payload(classification, answer, rag.status, vision_used, False, True, request_id, interaction_id, self._knowledge_source(rag))

        if classification == "step":
            step_title = step.get("title") or "目前步驟"
            step_action = step.get("student_instruction") or step.get("instruction") or "依照畫面上的操作說明繼續。"
            answer = f"你現在在 Task {int(task.get('order') or 0):02d}「{task.get('title') or ''}」，目前是「{step_title}」。下一步：{step_action}"
            return self._payload(classification, answer, rag.status, False, False, False, request_id, interaction_id, "SESSION_SOP")

        if image_data and detections:
            labels = {"motor": "馬達", "esc": "電子調速器", "pixhawk": "飛控模組", "flight_controller": "飛控模組", "gps": "GPS／羅盤模組", "gps_compass": "GPS／羅盤模組", "receiver": "接收機", "frame_arm": "機臂"}
            observed = "、".join(labels.get(str(item.get("class", "")).lower(), str(item.get("class") or "零件")) for item in detections[:4])
            answer = f"目前畫面中看到{observed}。請把想確認的物件靠近鏡頭，我會再結合目前步驟說明。"
            return self._payload(classification, answer, rag.status, True, False, safety_critical, request_id, interaction_id, "VISION_SOP")

        if rag.hit and rag.explanation:
            return self._payload(classification, rag.explanation, rag.status, vision_used, False, False, request_id, interaction_id, self._knowledge_source(rag))

        if image_data:
            answer = "我還沒有看到可明確辨識的目標。請把物件移到畫面中央並靠近鏡頭，我再幫你看一次。"
        else:
            answer = "我先陪你釐清這個問題。請告訴我你看到的名稱、標示或目前卡住的地方，我會依照當前步驟一步一步說明。"
        return self._payload(classification, answer, vision_status, vision_used, False, False, request_id, interaction_id, "SESSION_SOP")

    @staticmethod
    def _knowledge_source(rag) -> str:
        if rag.hit and rag.source_type == "common_knowledge":
            return "AI_REFERENCE"
        if rag.hit:
            return "VERIFIED_KNOWLEDGE"
        return "SESSION_SOP"

    def _general_enabled(self) -> bool:
        return self.general_ai_provider is not None and bool(getattr(self.general_ai_provider, "enabled", True))

    @staticmethod
    def _image_bytes(image_data: str) -> bytes:
        """把前端送來的 data URL（或純 base64）轉成圖片 bytes；格式錯誤回傳空 bytes。"""
        try:
            encoded = image_data.split(",", 1)[1] if "," in image_data else image_data
            return base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            return b""

    COURSE_REFERENCE_TIMEOUT_SECONDS = 6.0

    async def _question_with_course_reference(self, question: str) -> str:
        """查知識庫取得教材段落，附在問題後面給大模型；失敗時回傳原問題（不影響回答）。"""
        if self.rag_adapter is None:
            return question
        try:
            rag = await asyncio.wait_for(self.rag_adapter.query(question, str(uuid4()), 1), timeout=self.COURSE_REFERENCE_TIMEOUT_SECONDS)
        except (TimeoutError, asyncio.TimeoutError, Exception):  # noqa: BLE001 - 教材查詢只是加分，任何錯誤都不能讓學員拿不到回答
            return question
        if not (getattr(rag, "hit", False) and getattr(rag, "explanation", None)):
            return question
        titles = "、".join(
            str(item.get("title") or "").strip() for item in (getattr(rag, "sources", None) or [])[:3] if isinstance(item, dict) and item.get("title")
        )
        reference = str(rag.explanation).strip()[:1200]
        return (
            f"{question}\n\n【教材參考（{titles or '課程知識庫'}），回答時以此為準；"
            f"與問題無關就忽略，不要照念】\n{reference}"
        )

    async def _general_answer(self, session_id: str, question: str, training: dict, task: dict, step: dict, request_id: str | None):
        session = self.sessions.get(session_id)
        session_context = session.as_dict() if session is not None else {"session_id": session_id, "safety_state": training.get("safety_state")}
        session_context["request_id"] = request_id or str(uuid4())
        session_context["student_id"] = getattr(self.sessions.training_progress(session_id), "student_id", None)
        session_context["evidence_count"] = training.get("evidence_count", 0)
        session_context["teacher_review_state"] = training.get("teacher_review_state")
        session_context["conversation_history"] = self.sessions.coach_history(session_id)
        return await self.general_ai_provider.generate(question=question, session=session_context, task=task, step=step, language="zh-TW")

    async def _general_visual_answer(self, session_id: str, question: str, training: dict, task: dict, step: dict, image_data: str, request_id: str | None):
        session = self.sessions.get(session_id)
        session_context = session.as_dict() if session is not None else {"session_id": session_id, "safety_state": training.get("safety_state")}
        session_context["request_id"] = request_id or str(uuid4())
        session_context["student_id"] = getattr(self.sessions.training_progress(session_id), "student_id", None)
        session_context["evidence_count"] = training.get("evidence_count", 0)
        session_context["teacher_review_state"] = training.get("teacher_review_state")
        session_context["conversation_history"] = self.sessions.coach_history(session_id)
        try:
            encoded = image_data.split(",", 1)[1]
            image_bytes = base64.b64decode(encoded, validate=True)
        except (IndexError, ValueError, binascii.Error):
            image_bytes = b""
        return await self.general_ai_provider.generate_visual(
            question=question, session=session_context, task=task, step=step,
            image_bytes=image_bytes, language="zh-TW", safety_level=training.get("safety_state"),
        )

    def _record_candidate(self, session_id: str, question: str, training: dict, answer: str, general=None, *, vision_used: bool = False) -> None:
        task = training.get("task") or {}
        step = training.get("current_step") or {}
        self.sessions.record_knowledge_candidate(
            session_id,
            question=question,
            task_id=task.get("id"),
            step_id=step.get("step_id"),
            llm_answer=answer,
            provider=getattr(general, "provider", None),
            model=getattr(general, "model", None),
            language="zh-TW",
            answer_source=getattr(general, "source", "AI_REFERENCE"),
            tokens=getattr(general, "tokens", None),
            latency_ms=getattr(general, "latency_ms", None),
            vision_used=vision_used,
        )

    @staticmethod
    def _teacher_notice(answer: str, required: bool) -> str:
        if not required or TEACHER_SAFETY_NOTICE in answer:
            return answer
        return f"{answer.rstrip('。')}。{TEACHER_SAFETY_NOTICE}"

    @staticmethod
    def _payload(classification, answer, rag_status, vision_used, uncertainty, teacher_required, request_id=None, interaction_id=None, answer_source="SESSION_SOP"):
        return {"classification": classification, "answer": answer, "student_answer": answer, "answer_source": answer_source, "rag_status": rag_status, "vision_used": vision_used, "teacher_required": teacher_required, "needs_teacher": teacher_required, "uncertainty": uncertainty, "request_id": request_id, "interaction_id": interaction_id}
