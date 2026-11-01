from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

_CONFIG_PATH = Path(__file__).with_name("rag_config.py")
_CONFIG_SPEC = importlib.util.spec_from_file_location("fde_f450_v1_rag_config", _CONFIG_PATH)
config = importlib.util.module_from_spec(_CONFIG_SPEC)
assert _CONFIG_SPEC.loader
_CONFIG_SPEC.loader.exec_module(config)


def normalize_text(value: str) -> str:
    text = str(value or "").lower()
    for old, new in (("為何", "為什麼"), ("螺旋槳", "槳葉"), ("翻機", "側翻"), ("如何", "怎麼")):
        text = text.replace(old, new)
    return re.sub(r"[^0-9a-z\u3400-\u9fff]+", "", text)


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
    if document.get("source_type") == "teacher_note":
        return "teacher_note"
    if document.get("source_type") == "faq":
        return "faq_source" if document.get("needs_review") else "auto_eligible"
    return "transcript_evidence"


LEVEL_WEIGHT = {"teacher_approved": 1.18, "teacher_note": 1.10, "faq_source": 1.05, "auto_eligible": 1.0, "transcript_evidence": 0.82}
OUT_OF_SCOPE = ("天氣", "天气", "股票", "基金", "投資", "投资", "感冒", "藥", "药", "醫療", "医疗", "笑話", "笑话", "寫詩", "写诗", "聊天", "dji mini", "空拍機推薦", "空拍机推荐")
DOMAIN_TERMS = ("f450", "pixhawk", "missionplanner", "mission planner", "cw", "ccw", "m1", "m2", "m3", "m4", "飛控", "飞控", "槳", "桨", "馬達", "马达", "電機", "电机", "esc", "電調", "电调", "gps", "接收機", "接收机", "遙控", "遥控", "解鎖", "解锁", "起飛", "起飞", "懸停", "悬停", "四面", "羅盤", "罗盘", "校準", "校准", "機架", "机架", "電池", "电池", "無人機", "无人机", "檢測", "检测")


class RagService:
    def __init__(self, version_root: Path | None = None, *, min_score: float = config.RAG_MIN_SCORE, top_k: int = config.RAG_TOP_K):
        self.version_root = Path(version_root) if version_root else config.resolve_active_version()
        self.min_score = min_score
        self.top_k = top_k
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
        return not any(term.replace(" ", "") in normalized for term in OUT_OF_SCOPE) and any(term.replace(" ", "") in normalized for term in DOMAIN_TERMS)

    def search(self, question: str) -> list[dict]:
        query = hashed_ngram_embedding(question)
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
        hits = self.search(question)
        candidates = [hit for hit in hits if not hit.get("needs_review") and hit.get("answer_short") and hit["score"] >= self.min_score]
        if candidates:
            top = candidates[0]
            return self._finish(question, str(top["answer_short"]), "rag", top["score"], candidates[:self.top_k])
        common = self._common_knowledge(question)
        if common:
            return self._finish(question, common, "common_knowledge", hits[0]["score"] if hits else 0.0, hits)
        return self._finish(question, config.REFUSAL_ANSWER, "refuse", hits[0]["score"] if hits else 0.0, hits)

    @staticmethod
    def _common_knowledge(question: str) -> str | None:
        normalized = normalize_text(question)
        blocked = ("接線", "接线", "參數", "参数", "韌體", "固件", "法規", "法规", "考試", "考试", "校準值", "校准值", "解鎖失敗", "解锁失败")
        if any(term in normalized for term in blocked):
            return None
        rules = (
            (("槳葉", "桨叶", "螺旋槳", "螺旋桨"), "旋轉中的槳葉可能造成傷害，檢查或維修前應先斷電並等待槳葉停止。"),
            (("電池", "电池"), "電池若鼓包、破損或異常發熱，應立即停止使用並交由老師依安全流程處理。"),
            (("強風", "强风", "大風", "大风"), "強風會增加姿態控制難度，應停止飛行並重新評估環境安全。"),
        )
        for terms, answer in rules:
            if any(term in normalized for term in terms):
                return config.COMMON_KNOWLEDGE_PREFIX + answer
        return None

    @staticmethod
    def _public_source(hit: dict) -> dict:
        return {"title": Path(str(hit.get("source_name") or "未命名來源")).name, "ref": str(hit.get("source_ref") or hit.get("id") or ""), "score": round(float(hit.get("score", 0.0)), 6), "source_level": hit.get("source_level", "transcript_evidence")}

    def _finish(self, question: str, answer: str, source_type: str, score: float, hits: list[dict]) -> dict:
        result = {"answer": answer, "source_type": source_type, "score": round(float(score), 6), "sources": [self._public_source(hit) for hit in hits], "version": config.VERSION}
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        event = {"timestamp": datetime.now(timezone.utc).isoformat(), "question": question, **result}
        with self.log_path.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(event, ensure_ascii=False) + "\n")
        return result
