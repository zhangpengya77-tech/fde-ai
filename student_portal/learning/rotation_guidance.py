"""CW／CCW 判定為 ERROR 時，向 F450 RAG 知識庫查詢說明（2026-11-04 教師指令）。

錯槳位置與修正步驟由規則引擎固定產生；RAG 只補充知識庫說明與出處。
RAG 無回應、拒答或逾時都不影響紀錄保存，頁面仍會顯示固定修正步驟。
"""

import json
import logging
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings


logger = logging.getLogger(__name__)
RAG_TIMEOUT_SECONDS = 20


def rotation_question(evaluation):
    """把錯槳清單轉成給知識庫的問題。"""
    wrong = evaluation.get("wrong_props") or []
    if evaluation.get("reason_code") == "ROTATION_REVERSED":
        return "F450 四支螺旋槳 CW 與 CCW 全部裝反了，要怎麼更換？正確的 CW／CCW 位置是什麼？"
    parts = "、".join(
        "{}（{}）裝成 {}，應為 {}".format(item["motor"], item["position"], item["detected"], item["expected"])
        for item in wrong
    )
    return "F450 螺旋槳旋向裝錯：{}。CW 正槳和 CCW 反槳要怎麼更換？更換步驟是什麼？".format(parts)


def ask_rotation_guidance(evaluation, *, timeout=RAG_TIMEOUT_SECONDS):
    """回傳 {available, question, answer, sources, source_type}；失敗時 available=False。"""
    question = rotation_question(evaluation)
    base = str(getattr(settings, "PUBLIC_RAG_UPSTREAM_URL", "") or "").strip().rstrip("/")
    guidance = {"available": False, "question": question, "answer": "", "sources": [], "source_type": ""}
    if not base:
        return guidance
    body = json.dumps({"question": question, "locale": "zh-TW"}).encode("utf-8")
    request = Request(base + "/api/rag/ask", data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
        logger.warning("rotation RAG guidance unavailable: %s", type(exc).__name__)
        return guidance
    source_type = str(payload.get("source_type") or "")
    answer = str(payload.get("answer") or "").strip()
    if not answer or source_type == "refuse":
        return {**guidance, "source_type": source_type}
    sources = [
        {"title": str(item.get("title") or "")[:120], "ref": str(item.get("ref") or "")[:40]}
        for item in (payload.get("sources") or [])[:3] if isinstance(item, dict)
    ]
    return {**guidance, "available": True, "answer": answer[:1500], "sources": sources, "source_type": source_type}
