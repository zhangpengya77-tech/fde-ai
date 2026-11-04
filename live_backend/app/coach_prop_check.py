"""AI 陪做：學員用鏡頭問槳葉時，用視覺中心目前啟用的槳葉模型（V7）判讀（2026-11-04）。

沒有大模型時，直接用 V7 結果回答「哪一支錯、正確應該是什麼」；
有大模型時，把 V7 結果當成事實附給大模型，讓它看畫面時有可靠依據。
判讀只讀不寫：不建立難例、不改任何模型狀態。
"""
from __future__ import annotations

import asyncio
from io import BytesIO

POSITION_NAMES = {"M1": "右前", "M2": "左後", "M3": "左前", "M4": "右後"}
PROP_TERMS = ("槳", "桨", "螺旋", "旋向", "正反", "cw", "ccw", "順時針", "逆時針", "顺时针", "逆时针")


# 上電、解鎖、起飛等動作類問題一律交給教師，不用模型判讀當依據
POWER_TERMS = ("上电", "上電", "通电", "通電", "解锁", "解鎖", "起飞", "起飛", "马达测试", "馬達測試", "电机测试", "電機測試",
               "motor test", "failsafe", "prearm", "放行", "试飞", "試飛", "飞行", "飛行")


def is_prop_question(question: str) -> bool:
    """問題是否在問槳葉旋向（才值得跑 V7）；涉及上電、解鎖、飛行等動作的問題不判讀。"""
    value = str(question or "").lower()
    if any(term in value for term in POWER_TERMS):
        return False
    return any(term in value for term in PROP_TERMS)


def _image_size(image_bytes: bytes) -> tuple[int, int]:
    from PIL import Image
    with Image.open(BytesIO(image_bytes)) as image:
        return image.size


def build_prop_checker(center, evaluate_prop):
    """回傳一個同步函式：圖片 bytes → evaluate_prop 結果（含模型名稱）；沒有啟用模型時回傳 None。"""
    def check(image_bytes: bytes) -> dict | None:
        if center.active_model("PROP_DIRECTION") is None:
            return None
        width, height = _image_size(image_bytes)
        active, detections = center.infer_active("PROP_DIRECTION", image_bytes)
        result = evaluate_prop(detections or [], float(width), float(height), 0.5)
        result["model_version"] = (active or {}).get("version")
        return result
    return check


async def run_prop_check(checker, image_bytes: bytes, *, timeout_seconds: float = 15.0) -> dict | None:
    """在背景執行緒跑 V7（推論是阻塞的子程序），失敗或逾時回傳 None，不影響回答。"""
    if checker is None or not image_bytes:
        return None
    try:
        return await asyncio.wait_for(asyncio.to_thread(checker, image_bytes), timeout=timeout_seconds)
    except Exception:  # noqa: BLE001 - 判讀只是加分，任何錯誤都改走原本流程
        return None


def prop_verdict(result: dict) -> str:
    """把 V7 判定轉成口語說明，例如「3 號槳（左前 M3）應該是 CW，但目前看到的是 CCW」。"""
    positions = result.get("positions") or {}
    wrong, unknown = [], []
    for motor in ("M1", "M2", "M3", "M4"):
        item = positions.get(motor) or {}
        name = f"{motor[1:]} 號槳（{POSITION_NAMES[motor]} {motor}）"
        if item.get("result") == "NG" and item.get("detected"):
            wrong.append(f"{name}應該是 {item.get('expected')}，但目前看到的是 {item.get('detected')}")
        elif item.get("result") != "PASS":
            unknown.append(name)
    if result.get("final_result") == "PASS" and not wrong:
        return "V7 模型看這張畫面：四支槳旋向都正確，左前 M3、右後 M4 是 CW，右前 M1、左後 M2 是 CCW。"
    parts = []
    if wrong:
        parts.append("V7 模型看這張畫面：" + "；".join(wrong) + "。請斷電拔電池後再更換")
    if unknown:
        parts.append("、".join(unknown) + "看不清楚，請從正上方俯視、機頭朝上，讓四支槳都入鏡再問一次")
    return "。".join(parts) + "。這是 AI 判讀，正式結果以老師覆核為準。"
