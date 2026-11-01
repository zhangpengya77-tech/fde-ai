from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

_CONFIG_PATH = Path(__file__).with_name("rag_config.py")
_CONFIG_SPEC = importlib.util.spec_from_file_location("fde_f450_v1_rag_config", _CONFIG_PATH)
config = importlib.util.module_from_spec(_CONFIG_SPEC)
assert _CONFIG_SPEC.loader
_CONFIG_SPEC.loader.exec_module(config)

_LLM_PATH = Path(__file__).with_name("llm_fallback.py")
_LLM_SPEC = importlib.util.spec_from_file_location("fde_f450_v1_llm_fallback", _LLM_PATH)
llm_module = importlib.util.module_from_spec(_LLM_SPEC)
assert _LLM_SPEC.loader
_LLM_SPEC.loader.exec_module(llm_module)

_NORMALIZATION_REPLACEMENTS = (
    (r"px[\s._-]*2[\s._-]*4[\s._-]*8", "Pixhawk"),
    (r"mission\s*planner|missionplanner", "Mission Planner"),
    (r"\bmp\b", "Mission Planner"),
    (r"\bflight\s*mode(s)?\b", "飛行模式"),
    (r"\breceiver\b|\brx\b", "接收機"),
    (r"\bmotor(s)?\b", "馬達"),
    (r"\besc\b|電調|电调", "ESC"),
    (r"螺旋槳|螺旋桨|桨叶", "槳葉"),
    (r"正反桨|正反槳|正反叶|正反葉", "槳葉正反"),
    (r"蒋叶|蔣葉|講業|讲业|獎葉|角葉", "槳葉"),
    (r"正反面", "正反"),
    (r"順時針|顺时针", "CW"),
    (r"逆時針|逆时针", "CCW"),
    (r"馬達|马达|電機|电机", "馬達"),
    (r"飛控|飞控", "飛控"),
    (r"解锁", "解鎖"),
    (r"侧翻", "側翻"),
    (r"翻機|翻机|翻覆", "側翻"),
    (r"悬停", "懸停"),
    (r"起飞", "起飛"),
    (r"飞行模式", "飛行模式"),
    (r"桨", "槳"),
    (r"怎么区分|怎麼區分|如何区分|如何區分|怎么分|怎麼分", "怎麼判斷"),
    (r"如何", "怎麼"),
    (r"怎么", "怎麼"),
    (r"為何|为什么", "為什麼"),
)


def normalize_query(value: str) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip()
    for pattern, replacement in _NORMALIZATION_REPLACEMENTS:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return text.replace("槳葉槳葉", "槳葉")


def normalize_text(value: str) -> str:
    return re.sub(r"[^0-9a-z\u3400-\u9fff]+", "", normalize_query(value).lower())


def hashed_ngram_embedding(value: str, dimensions: int = config.EMBEDDING_DIMENSIONS) -> np.ndarray:
    text = normalize_text(value)
    vector = np.zeros(dimensions, dtype=np.float32)
    if not text:
        return vector
    padded = f"^{text}$"
    for size in (1, 2, 3):
        for index in range(max(0, len(padded) - size + 1)):
            feature = padded[index:index + size]
            slot = int.from_bytes(hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest(), "little") % dimensions
            vector[slot] += 1.0 / math.sqrt(len(feature))
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm else vector


def document_embedding_text(document: dict) -> str:
    aliases = " ".join(document.get("aliases") or [])
    question = str(document.get("question", ""))
    return " ".join(str(value) for value in (question, question, question, aliases, aliases, document.get("topic", ""), document.get("answer_short", ""), document.get("content", "")) if value)


def _source_level(document: dict) -> str:
    if document.get("review_status") == "approved":
        return "teacher_approved"
    if document.get("source_type") == "faq":
        return "faq"
    if document.get("source_type") == "teacher_note":
        return "teacher_note"
    if document.get("source_type") == "auto_eligible":
        return "auto_eligible"
    return "transcript_evidence"


def _concepts(value: str) -> set[str]:
    text = normalize_query(value)
    return {name for name, patterns in CONCEPT_PATTERNS.items() if any(re.search(pattern, text, re.IGNORECASE) for pattern in patterns)}


def _document_text(document: dict) -> str:
    values = (document.get(key) for key in ("question", "aliases", "topic", "answer_short", "content"))
    flattened = []
    for value in values:
        if isinstance(value, list):
            flattened.extend(str(item) for item in value)
        elif value:
            flattened.append(str(value))
    return " ".join(flattened)


def _looks_corrupt(value: str) -> bool:
    markers = ("锟斤拷", "鏂囦欢", "鐨勬", "涓€", "鎴戜", "閿欒", "瑙嗛", "绗")
    return sum(value.count(marker) for marker in markers) >= 2


def _remove_local_paths(value: str) -> str:
    return LOCAL_PATH_PATTERN.sub("（本機路徑已隱去）", str(value or ""))


def _safe_reference(value: str, fallback: str = "knowledge-entry") -> str:
    reference = str(value or "").strip()
    if not reference or LOCAL_PATH_PATTERN.search(reference):
        return fallback
    return reference


def _safe_title(value: str) -> str:
    title = str(value or "未命名來源").strip()
    if LOCAL_PATH_PATTERN.search(title):
        title = Path(title.replace("\\", "/")).name
    return title or "未命名來源"


def _is_incomplete(answer: str) -> bool:
    text = str(answer or "").strip()
    return not text or text.endswith(INCOMPLETE_ENDINGS)


def _answer_needs_explanation(question: str, answer: str) -> bool:
    if not re.search(r"為什麼|會怎樣|会怎样|有什麼影響|有什么影响|原因|後果|后果", normalize_query(question)):
        return False
    return not re.search(r"因為|導致|造成|可能|因此|無法|會翻|會失", normalize_query(answer))


def _is_risky_parameter_question(question: str) -> bool:
    text = normalize_query(question)
    return any(re.search(pattern, text, re.IGNORECASE) for pattern in RISKY_PARAMETER_PATTERNS)


def _is_relevant_hit(question: str, hit: dict) -> bool:
    query_concepts = _concepts(question)
    specific_concepts = query_concepts - GENERIC_CONCEPTS
    hit_concepts = _concepts(_document_text(hit))
    if specific_concepts:
        return bool(specific_concepts & hit_concepts)
    return bool(query_concepts & hit_concepts) and float(hit.get("score", 0.0)) >= 0.42


LEVEL_WEIGHT = {"teacher_approved": 1.18, "faq": 1.10, "teacher_note": 1.05, "auto_eligible": 1.0, "transcript_evidence": 0.82}
OUT_OF_SCOPE = ("天氣", "天气", "股票", "基金", "投資", "投资", "感冒", "藥", "药", "醫療", "医疗", "笑話", "笑话", "寫詩", "写诗", "聊天", "dji mini", "空拍機推薦", "空拍机推荐")
DOMAIN_TERMS = ("f450", "pixhawk", "missionplanner", "cw", "ccw", "飛控", "槳葉", "馬達", "esc", "gps", "接收機", "遙控", "解鎖", "起飛", "側翻", "懸停", "四面", "羅盤", "校準", "機架", "電池", "無人機", "檢測", "mission planner")
GENERIC_CONCEPTS = {"mission_planner", "flight_controller"}
CONCEPT_PATTERNS = {
    "blade_side": (r"正反", r"反面", r"弧面", r"上下反裝", r"bladeface"),
    "blade_direction": (r"\bcw\b", r"\bccw\b", r"順時針", r"逆時針", r"馬達轉向"),
    "takeoff_flip": (r"側翻", r"翻覆", r"自旋", r"姿態不穩", r"起飛會翻"),
    "motor_position": (r"\bm[1-4]\b", r"電機序號", r"馬達序號", r"電機位置"),
    "motor_prop_relation": (r"槳葉.{0,8}(?:馬達|方向|cw|ccw)", r"(?:馬達|電機).{0,12}(?:槳葉|cw|ccw)"),
    "unlock": (r"解鎖", r"安全開關", r"arming"),
    "flight_mode": (r"飛行模式", r"飛航模式", r"flightmode", r"fltm_mode"),
    "hover_boundary": (r"(?:四面)?懸停.{0,20}(?:出框|方框|邊界|範圍)", r"(?:出框|方框|邊界|範圍).{0,20}懸停"),
    "gps_orientation": (r"gps.{0,20}(?:箭頭|朝前|機頭|方向|朝向)", r"(?:箭頭|朝前|機頭|方向).{0,20}gps"),
    "mission_planner": (r"missionplanner",),
    "flight_controller": (r"pixhawk", r"飛控"),
}
LOCAL_PATH_PATTERN = re.compile(r"(?i)(?:[a-z]:[\\/][^\s\"'<>]+|\\\\[^\\\s]+\\[^\s\"'<>]+)")
INCOMPLETE_ENDINGS = ("；", ";", "：", ":", "、", "以及", "並且", "和", "或")
RISKY_PARAMETER_PATTERNS = (
    r"(?:參數|参数).{0,12}(?:多少|數值|数值|設定|设置)",
    r"(?:電壓|电压|電流|电流|pwm|pid|trim|offset).{0,12}(?:多少|設成|设置|设为|校準值|校准值)",
    r"(?:設定|设置|校準|校准).{0,12}(?:值|數值|数值).{0,12}\d",
    r"\d+(?:\.\d+)?\s*(?:v|伏|a|安培|hz|khz|rpm)\b",
)


class RagService:
    def __init__(self, version_root: Path | None = None, *, min_score: float = config.RAG_MIN_SCORE, context_min_score: float = config.RAG_CONTEXT_MIN_SCORE, top_k: int = config.RAG_TOP_K, llm_fallback=None):
        self.version_root = Path(version_root) if version_root else config.resolve_active_version()
        self.min_score = min_score
        self.context_min_score = context_min_score
        self.top_k = top_k
        self.llm_fallback = llm_fallback if llm_fallback is not None else llm_module.LLMFallback()
        self.log_path = self.version_root / "logs" / "qa_events.jsonl"
        metadata_path = self.version_root / "index" / "documents.jsonl"
        vectors_path = self.version_root / "index" / "vectors.npz"
        with metadata_path.open("r", encoding="utf-8") as stream:
            self.documents = [json.loads(line) for line in stream if line.strip()]
        with np.load(vectors_path) as archive:
            self.vectors = archive["vectors"]
        if len(self.documents) != len(self.vectors) or self.vectors.shape[1] != config.EMBEDDING_DIMENSIONS:
            raise ValueError("RAG 索引損壞或維度不符")

    def health(self) -> dict:
        return {"status": "ok", "version": config.VERSION, "document_count": len(self.documents), "index_loaded": bool(self.documents)}

    @staticmethod
    def in_domain(question: str) -> bool:
        normalized = normalize_text(question)
        if any(term.replace(" ", "") in normalized for term in OUT_OF_SCOPE):
            return False
        return bool(re.search(r"\bm[1-4]\b", normalize_query(question), re.IGNORECASE)) or any(term.replace(" ", "") in normalized for term in DOMAIN_TERMS)

    def search(self, question: str) -> list[dict]:
        query = hashed_ngram_embedding(normalize_query(question))
        similarities = self.vectors @ query
        ranked = []
        for index, similarity in enumerate(similarities.tolist()):
            document = self.documents[index]
            level = _source_level(document)
            score = float(similarity) * LEVEL_WEIGHT[level]
            ranked.append({**document, "similarity_score": float(similarity), "score": score, "source_level": level})
        return sorted(ranked, key=lambda item: item["score"], reverse=True)[:self.top_k]

    def ask(self, question: str) -> dict:
        if not isinstance(question, str) or not question.strip():
            raise ValueError("問題不可為空")
        question = question.strip()
        if len(question) > config.MAX_QUESTION_LENGTH:
            raise ValueError("問題長度超過限制")
        if not self.in_domain(question):
            return self._finish(question, config.REFUSAL_ANSWER, "refuse", 0.0, [])
        normalized = normalize_query(question)
        if _is_risky_parameter_question(question):
            return self._finish(question, config.REFUSAL_ANSWER, "refuse", 0.0, [])

        hits = self.search(normalized)
        eligible = [
            hit for hit in hits
            if not hit.get("needs_review")
            and hit.get("source_level") != "needs_review"
            and not _looks_corrupt(_document_text(hit))
            and float(hit.get("score", 0.0)) >= self.context_min_score
            and _is_relevant_hit(normalized, hit)
        ][:self.top_k]
        direct = [
            hit for hit in eligible
            if hit.get("answer_short")
            and float(hit.get("score", 0.0)) >= self.min_score
            and not _is_incomplete(str(hit["answer_short"]))
            and not _answer_needs_explanation(question, str(hit["answer_short"]))
        ]
        if direct:
            top = direct[0]
            return self._finish(question, _remove_local_paths(str(top["answer_short"])), "rag", top["score"], direct[:self.top_k])

        evidence = [self._llm_evidence(hit) for hit in eligible]
        answer = self._complete_with_llm(question, normalized, evidence)
        if answer:
            answer = _remove_local_paths(answer)
            score = max((item["score"] for item in eligible), default=0.0)
            source_type = "rag_plus_llm" if evidence else "common_knowledge"
            if source_type == "common_knowledge" and not answer.startswith(config.COMMON_KNOWLEDGE_PREFIX):
                answer = config.COMMON_KNOWLEDGE_PREFIX + answer
            return self._finish(question, answer, source_type, score, eligible)

        if eligible:
            fallback_hit = next((hit for hit in eligible if hit.get("answer_short")), None)
            if fallback_hit:
                answer = _remove_local_paths(str(fallback_hit["answer_short"])).rstrip("；;，, ")
                return self._finish(question, answer, "rag", fallback_hit["score"], eligible)
        return self._finish(question, config.LLM_UNAVAILABLE_ANSWER, "refuse", 0.0, [])

    @staticmethod
    def _llm_evidence(hit: dict) -> dict:
        excerpt = hit.get("answer_short") or hit.get("content") or hit.get("question") or hit.get("topic") or ""
        excerpt = _remove_local_paths(str(excerpt))[:1200]
        identifier = str(hit.get("id") or "knowledge-entry")
        return {
            "title": _safe_title(hit.get("topic") or hit.get("question") or hit.get("source_name")),
            "ref": _safe_reference(hit.get("source_ref"), identifier),
            "score": round(float(hit.get("score", 0.0)), 6),
            "source_level": hit.get("source_level", "transcript_evidence"),
            "excerpt": excerpt,
        }

    def _complete_with_llm(self, question: str, normalized_query: str, evidence: list[dict]) -> str | None:
        try:
            if not config.LLM_FALLBACK_ENABLED:
                return None
            answer = self.llm_fallback.complete(question=question, normalized_query=normalized_query, evidence=evidence)
            return answer.strip() if isinstance(answer, str) and answer.strip() else None
        except Exception:
            return None

    @staticmethod
    def _public_source(hit: dict) -> dict:
        identifier = str(hit.get("id") or "knowledge-entry")
        return {
            "title": _safe_title(hit.get("topic") or hit.get("question") or hit.get("source_name")),
            "ref": _safe_reference(hit.get("source_ref"), identifier),
            "score": round(float(hit.get("score", 0.0)), 6),
            "source_level": hit.get("source_level", "transcript_evidence"),
        }

    def _finish(self, question: str, answer: str, source_type: str, score: float, hits: list[dict]) -> dict:
        result = {"answer": _remove_local_paths(answer), "source_type": source_type, "score": round(float(score), 6), "sources": [self._public_source(hit) for hit in hits], "version": config.VERSION}
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        event = {"timestamp": datetime.now(timezone.utc).isoformat(), "question": question, **result}
        with self.log_path.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(event, ensure_ascii=False) + "\n")
        return result
