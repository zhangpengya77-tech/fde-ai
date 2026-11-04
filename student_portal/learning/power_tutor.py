"""電力巡檢檢測結果的 AI 助教回答（2026-11-04 教師指令）。

學員按下「AI 助教解說」後產生三段文字，並由瀏覽器語音朗讀：
1. 判定說明：由巡檢時間軸固定組成（第幾秒發現什麼、信心多少），不經 LLM。
2. 處理建議：依異常類別的固定安全建議（F450 RAG 知識庫目前沒有電力巡檢內容，所以不查 RAG）。
3. AI 補充解說：LLM 依檢測結果說明異常代表什麼、正常情況應該怎樣、下一步怎麼做；未設定金鑰或失敗時省略。
送給 LLM 的只有結構化結果，不含影片、截圖與個人資料。
"""

from .rotation_tutor import call_llm


OFFICIAL_NOTE = "以上為實驗模型的 AI 檢測結果，可能有誤報或漏報，正式結果以老師覆核為準。"
CLASS_ADVICE = {
    "鳥巢": "鳥巢的樹枝和鐵絲可能造成短路或跳電，請回報維護單位安排停電清除，不可自行攀爬或靠近帶電線路。",
    "異物": "掛在線路或電塔上的異物，例如風箏線、塑膠布，可能造成相間短路，請回報維護單位處理，不可自行拉扯。",
    "鳥巢或異物": "鳥巢或異物都可能造成短路或跳電，請回報維護單位安排清除，不可自行攀爬或拉扯。",
    "絕緣子損傷": "絕緣子破損、裂紋或閃絡會降低絕緣能力，請用更近距離或更高解析度重拍確認，並回報維護單位。",
    "導線斷開": "導線斷股或引線脫落可能造成斷電或掉線危險，請保持安全距離並立即回報維護單位。",
}
NORMAL_ADVICE = "正常情況下，電塔、絕緣子與導線上不應有鳥巢或異物，絕緣子應完整無裂痕，導線應連續無斷股。"
LLM_INSTRUCTIONS = (
    "你是無人機電力巡檢課程的 AI 助教。請只依據提供的巡檢結果，用繁體中文、口語、最多四句話，向學員說明："
    "發現的異常代表什麼、正常的情況應該是什麼樣子、可能的風險，以及下一步要怎麼處理（以回報維護單位、保持安全距離為原則）。"
    "未發現異常時，提醒可能有漏報，並說明巡檢時還要注意什麼。不得編造數值或改變檢測結論，提醒正式結果以老師覆核為準。"
)


def verdict_text(rows, *, inference_mode="REAL", analyzed_frames=None, reviews=()):
    """依時間軸組成判定說明。"""
    if inference_mode == "MOCK":
        text = "這次是模擬流程，不是真實 AI 推論，結果不能當作巡檢結論。"
    elif not rows:
        frames = "，共分析 {} 幀".format(analyzed_frames) if analyzed_frames else ""
        text = "此次巡檢未發現疑似異常{}。".format(frames)
    else:
        parts = "；".join(
            "{} 發現疑似{}{}".format(
                row["time_label"], row["label"],
                "（信心 {}%）".format(row["confidence_percent"]) if row.get("confidence_percent") is not None else "",
            )
            for row in rows[:8]
        )
        more = "，另有 {} 段未逐一列出".format(len(rows) - 8) if len(rows) > 8 else ""
        text = "此次巡檢發現 {} 段疑似異常：{}{}，需要複查。".format(len(rows), parts, more)
    if reviews:
        decision, score = reviews[-1]
        text += " 老師已覆核：{}{}。".format(decision, "，{} 分".format(score) if score is not None else "")
    else:
        text += " " + OFFICIAL_NOTE
    return text


def advice_text(rows):
    """每種異常類別各給一次固定處理建議。"""
    labels = []
    for row in rows:
        if row["label"] not in labels:
            labels.append(row["label"])
    advice = [CLASS_ADVICE[label] for label in labels if label in CLASS_ADVICE]
    return " ".join(advice) if advice else NORMAL_ADVICE


def tutor_answer(job, rows, *, reviews=(), analyzed_frames=None):
    """組成電力巡檢 AI 助教回答與朗讀文字。"""
    verdict = verdict_text(rows, inference_mode=job.inference_mode, analyzed_frames=analyzed_frames, reviews=reviews)
    advice = advice_text(rows)
    evidence = {
        "verdict": verdict,
        "anomalies": [
            {key: row.get(key) for key in ("label", "time_label", "confidence_percent", "description")} for row in rows[:20]
        ],
        "analyzed_frames": analyzed_frames,
        "model_version": job.model.version if job.model else "",
        "advice": advice,
    }
    llm = "" if job.inference_mode == "MOCK" else call_llm(LLM_INSTRUCTIONS, evidence)
    speech = " ".join(part for part in (verdict, advice, llm) if part)
    return {
        "verdict": verdict,
        "advice": advice,
        "llm": llm,
        "llm_available": bool(llm),
        "speech_text": speech[:2000],
    }
