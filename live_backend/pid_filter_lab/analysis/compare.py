"""BASELINE 與 AFTER_TUNING 兩次飛行的前後比較。

判定：IMPROVED / UNCHANGED / WORSE / INSUFFICIENT。
- 只有「至少 2 項關鍵指標改善且沒有任何指標惡化」才判為 IMPROVED；不會因單一指標改善就判定調參成功。
- 任一關鍵指標惡化 → WORSE。
- 可比較的指標少於 2 項 → INSUFFICIENT。
- 測試條件（機體、飛控、韌體、操控量、記錄頻率）不一致時，附上限制說明。
"""

from __future__ import annotations

# (指標, 越小越好, 視為顯著變化的相對比例)
METRICS = (
    ("overshoot_pct", True, 0.15, "過衝"),
    ("rise_time_ms", True, 0.15, "上升時間"),
    ("tracking_norm", True, 0.10, "正規化追蹤誤差"),
    ("delay_ms", True, 0.20, "響應延遲"),
)


# 小於此絕對差值一律視為未變化（避免基準值接近 0 時百分比失真）
ABS_FLOOR = {"overshoot_pct": 2.0, "rise_time_ms": 2.0, "tracking_norm": 0.02, "delay_ms": 2.0}


def _axis_metrics(analysis: dict, axis: str) -> dict:
    r = analysis["control"]["rate_loop"].get(axis, {})
    if r.get("status") != "OK":
        return {}
    step = r.get("step") or {}
    out = {"tracking_norm": r.get("tracking_norm"), "delay_ms": r.get("delay_ms"), "stick": r.get("stick_activity_ratio"), "rate": r.get("sample_rate_hz")}
    if step.get("status") == "OK":
        out.update(overshoot_pct=step.get("overshoot_pct"), rise_time_ms=step.get("rise_time_ms"))
    return out


def _noise(analysis: dict) -> float | None:
    vals = [s["noise_rms"].get("80_200hz") for k, s in analysis["control"].get("spectra", {}).items() if k.startswith("gyro.") and s.get("status") == "OK"]
    vals = [v for v in vals if v is not None]
    return max(vals) if vals else None


def compare(base: dict, after: dict, base_meta: dict, after_meta: dict) -> dict:
    limits = []
    if base_meta.get("ecosystem") != after_meta.get("ecosystem"):
        return {"outcome": "INSUFFICIENT", "reason": "兩次日誌屬於不同飛控生態，無法比較。", "limitations": [], "metrics": []}
    if base_meta.get("aircraft_id") != after_meta.get("aircraft_id"):
        limits.append("兩次測試不是同一架飛機。")
    if base_meta.get("firmware_version") != after_meta.get("firmware_version"):
        limits.append(f"韌體版本不同（{base_meta.get('firmware_version')} → {after_meta.get('firmware_version')}）。")
    rows = []
    improved = worse = comparable = 0
    for axis in ("roll", "pitch", "yaw"):
        b, a = _axis_metrics(base, axis), _axis_metrics(after, axis)
        if b and a:
            if b.get("stick") and a.get("stick"):
                ratio = a["stick"] / max(b["stick"], 1e-6)
                if ratio < 0.5 or ratio > 2.0:
                    limits.append(f"{axis} 軸兩次操控量差異大（{b['stick']:.2f} → {a['stick']:.2f}），比較結果受限。")
            if b.get("rate") and a.get("rate") and abs(a["rate"] - b["rate"]) / b["rate"] > 0.2:
                limits.append(f"{axis} 軸記錄頻率不同（{b['rate']} → {a['rate']} Hz）。")
        for key, lower_better, threshold, label in METRICS:
            bv, av = (b or {}).get(key), (a or {}).get(key)
            if bv is None or av is None:
                rows.append({"axis": axis, "metric": label, "baseline": bv, "after": av, "verdict": "INSUFFICIENT"})
                continue
            comparable += 1
            base_ref = max(abs(bv), 1e-6)
            rel = (av - bv) / base_ref
            if abs(av - bv) < ABS_FLOOR[key]:
                verdict = "UNCHANGED"
            elif abs(rel) < threshold:
                verdict = "UNCHANGED"
            elif (rel < 0) == lower_better:
                verdict = "IMPROVED"
            else:
                verdict = "WORSE"
            improved += verdict == "IMPROVED"
            worse += verdict == "WORSE"
            rows.append({"axis": axis, "metric": label, "baseline": bv, "after": av, "change_pct": round(rel * 100, 1) if abs(bv) >= ABS_FLOOR[key] else None, "verdict": verdict})
    bn, an = _noise(base), _noise(after)
    if bn is not None and an is not None:
        comparable += 1
        rel = (an - bn) / max(bn, 1e-6)
        verdict = "UNCHANGED" if abs(rel) < 0.2 else ("IMPROVED" if rel < 0 else "WORSE")
        improved += verdict == "IMPROVED"
        worse += verdict == "WORSE"
        rows.append({"axis": "all", "metric": "陀螺儀 80–200 Hz 雜訊", "baseline": round(bn, 2), "after": round(an, 2), "change_pct": round(rel * 100, 1), "verdict": verdict})
    bh, ah = base["health"]["overall"], after["health"]["overall"]
    rows.append({"axis": "all", "metric": "八大健康綜合分", "baseline": bh.get("score"), "after": ah.get("score"), "verdict": "INFO"})
    if not (bh.get("comparable") and ah.get("comparable")):
        limits.append("至少一次飛行的健康指標覆蓋率不足 75%，綜合分不可直接比較。")
    if comparable < 2:
        outcome, reason = "INSUFFICIENT", "可比較的關鍵指標少於 2 項。"
    elif worse:
        outcome, reason = "WORSE", f"{worse} 項指標惡化（{improved} 項改善）。"
    elif improved >= 2:
        outcome, reason = "IMPROVED", f"{improved} 項指標改善，沒有指標惡化。"
    else:
        outcome, reason = "UNCHANGED", f"僅 {improved} 項指標改善，未達「至少 2 項改善且無惡化」的標準。"
    if limits and outcome == "IMPROVED":
        reason += " 但測試條件不完全一致，請教師確認。"
    return {"outcome": outcome, "reason": reason, "metrics": rows, "limitations": sorted(set(limits)), "rule": "至少 2 項關鍵指標改善且無惡化才判定 IMPROVED；任一惡化判定 WORSE。"}
