"""CW／CCW 檢測結果的 AI 助教回答（2026-11-04 教師指令）。

學員按下「AI 助教」後產生三段文字，並由瀏覽器語音朗讀：
1. 判定說明：由規則引擎結果固定組成（例如「3 號槳應為 CW，目前檢測為 CCW，所以未通過」），不經 LLM，確保正確。
2. 知識庫說明：F450 RAG 的回答與出處。
3. AI 補充解說：LLM 依檢測結果與知識庫證據說明「正確會怎樣、錯誤會怎樣、怎麼修」；未設定金鑰或失敗時省略。
送給 LLM 的只有結構化檢測結果與知識庫文字，不含照片與個人資料。結果存入紀錄，重按不重複呼叫。
"""

import json
import logging
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from . import rotation_guidance


logger = logging.getLogger(__name__)
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
LLM_TIMEOUT_SECONDS = 25
OFFICIAL_NOTE = "以上為 AI 檢測候選結果，正式結果以老師覆核為準。"
LLM_INSTRUCTIONS = (
    "你是 F450 無人機課程的 AI 助教。請只依據提供的檢測結果與知識庫證據，用繁體中文、口語、最多四句話，"
    "向學員說明：正確的安裝應該是什麼樣子、這次錯在哪裡、裝錯會造成什麼影響、要怎麼修正。"
    "檢測通過時，說明為什麼正確以及飛行前還要注意什麼。不得編造數值參數或來源，不得改變檢測結論；"
    "提醒正式結果以老師覆核為準。"
)


def _motor_name(item):
    return "{} 號槳（{} {}）".format(item["motor"][1:], item["position"], item["motor"])


def verdict_text(evaluation, review_status=""):
    """依規則引擎結果組成判定說明。"""
    candidate = evaluation.get("candidate")
    wrong = evaluation.get("wrong_props") or []
    if candidate == "PASS":
        text = "此次檢測通過：四支槳旋向都符合標準，左前 M3、右後 M4 為 CW，右前 M1、左後 M2 為 CCW。"
    elif candidate == "ERROR" and wrong:
        parts = "；".join(
            "{}應該是 {}，但目前檢測是 {}".format(_motor_name(item), item["expected"], item["detected"]) for item in wrong
        )
        text = "此次檢測未通過：{}，不符合標準，所以未通過檢驗。".format(parts)
        if evaluation.get("reason_code") == "ROTATION_REVERSED":
            text += "四支全部相反時，請先確認照片是否從正上方俯視、機頭朝上。"
    elif candidate == "ERROR":
        text = "此次檢測未通過：{}".format(evaluation.get("reason") or "槳葉旋向不符合標準。")
    else:
        text = "此次無法自動判定：{}請從正上方俯視、機頭朝上重新拍攝。".format(evaluation.get("reason") or "")
    if review_status in {"PASS", "NG", "RESUBMIT"}:
        text += " 老師已覆核：{}。".format({"PASS": "通過", "NG": "不通過", "RESUBMIT": "要求重傳"}[review_status])
    else:
        text += " " + OFFICIAL_NOTE
    return text


def _extract_output_text(payload):
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    for item in payload.get("output") or []:
        for content in (item.get("content") or []) if isinstance(item, dict) else []:
            if isinstance(content, dict) and content.get("type") == "output_text" and str(content.get("text") or "").strip():
                return content["text"].strip()
    return ""


# 2026-11-04：免費／便宜的通用相容格式服務（與 Live 後端同一套設定）
COMPAT_PRESETS = {
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-3.8-flash", "GEMINI_API_KEY"),
    "qwen": ("https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "qwen3.8-max", "DASHSCOPE_API_KEY"),
    "openrouter": ("https://openrouter.ai/api/v1", "", "OPENROUTER_API_KEY"),
}


def _compat_config():
    """回傳 (網址, 模型, 金鑰)；沒設定通用相容服務時回傳 None。規則同 Live 後端 provider_manager。"""
    choice = os.environ.get("FDE_GENERAL_PROVIDER", "").strip().lower()
    names = [choice] if choice in COMPAT_PRESETS else ([n for n, p in COMPAT_PRESETS.items() if os.environ.get(p[2], "").strip()] if choice == "" else [])
    override = os.environ.get("FDE_GENERAL_MODEL", "").strip()
    for name in names:
        base, model, key_env = COMPAT_PRESETS[name]
        key = os.environ.get("FDE_GENERAL_API_KEY", "").strip() or os.environ.get(key_env, "").strip()
        base = os.environ.get("FDE_GENERAL_BASE_URL", "").strip() or base
        model = override if override and not override.startswith(("gpt-", "claude-")) else model
        if key and base and model:
            return base.rstrip("/"), model, key
    return None


def _call_compat(config, instructions, evidence, opener):
    """通用相容格式（/chat/completions）呼叫；失敗回傳空字串。"""
    base, model, key = config
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": instructions}, {"role": "user", "content": json.dumps(evidence, ensure_ascii=False)}],
        "max_tokens": 600,
    }, ensure_ascii=False).encode("utf-8")
    request = Request(base + "/chat/completions", data=body, method="POST", headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json",
    })
    try:
        with opener(request, timeout=LLM_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
        content = payload["choices"][0]["message"]["content"]
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError, IndexError, TypeError) as exc:
        logger.warning("AI tutor compatible LLM unavailable: %s", type(exc).__name__)
        return ""
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    return str(content or "").strip()[:1200]


def call_llm(instructions, evidence, *, opener=urlopen):
    """呼叫大模型；未設定金鑰或失敗時回傳空字串（電力巡檢 AI 助教共用）。
    有 Gemini／通義千問等通用相容服務設定時優先使用（免費方案），否則用 OpenAI Responses API。"""
    compat = _compat_config()
    if compat:
        return _call_compat(compat, instructions, evidence, opener)
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return ""
    body = json.dumps({
        "model": os.environ.get("FDE_GENERAL_MODEL", "gpt-5.6-luna").strip() or "gpt-5.6-luna",
        "instructions": instructions,
        "input": json.dumps(evidence, ensure_ascii=False),
        "max_output_tokens": 400,
    }, ensure_ascii=False).encode("utf-8")
    request = Request(OPENAI_RESPONSES_URL, data=body, method="POST", headers={
        "Authorization": "Bearer " + api_key, "Content-Type": "application/json",
    })
    try:
        with opener(request, timeout=LLM_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
        logger.warning("AI tutor LLM unavailable: %s", type(exc).__name__)
        return ""
    return _extract_output_text(payload)[:1200] if isinstance(payload, dict) else ""


def llm_explanation(evaluation, verdict, rag, *, opener=urlopen):
    """CW／CCW 檢測的 LLM 解說。"""
    evidence = {
        "verdict": verdict,
        "candidate": evaluation.get("candidate"),
        "motors": {
            motor: {key: item.get(key) for key in ("position", "expected", "detected", "confidence")}
            for motor, item in (evaluation.get("motors") or {}).items()
        },
        "wrong_props": evaluation.get("wrong_props") or [],
        "fix_steps": evaluation.get("fix_steps") or [],
        "knowledge_base": (rag or {}).get("answer", ""),
        "rule": "F450 X 型：左前 M3、右後 M4 為 CW；右前 M1、左後 M2 為 CCW；對角線同旋向。",
    }
    return call_llm(LLM_INSTRUCTIONS, evidence, opener=opener)


def tutor_answer(evaluation, review_status=""):
    """組成 AI 助教回答與朗讀文字。"""
    verdict = verdict_text(evaluation, review_status)
    rag = evaluation.get("rag_guidance")
    if not rag and evaluation.get("candidate") == "ERROR":
        rag = rotation_guidance.ask_rotation_guidance(evaluation)
    llm = llm_explanation(evaluation, verdict, rag)
    rag_text = rag.get("answer", "") if rag and rag.get("available") else ""
    speech = " ".join(part for part in (verdict, rag_text, llm) if part)
    return {
        "verdict": verdict,
        "rag": rag or {},
        "llm": llm,
        "llm_available": bool(llm),
        "speech_text": speech[:2000],
    }
