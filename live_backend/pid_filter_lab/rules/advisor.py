"""確定性調參建議引擎 + 中文解釋（規則模板，未呼叫外部大模型）。

輸出等級：
- INFO：教學解釋，不含可匯出數值。
- REVIEW：含版本驗證過的建議值，必須教師審核後才能匯出。
- INSUFFICIENT：資料不足，不給結論。
- BLOCKED：存在安全或硬體風險，禁止給出調參方案。
建議值一律為「目前值 ± 10%」的小步調整並夾在參數目錄範圍內；這不是最佳值，
必須實機複測驗證。系統不會連接飛控、不會寫入參數。
"""

from __future__ import annotations

from ..model import ALGORITHM_VERSION, FlightData
from . import catalog

STEP = 0.10
RULESET_VERSION = "pidlab-rules/1.0"
AXIS_LABEL = {"roll": "橫滾 Roll", "pitch": "俯仰 Pitch", "yaw": "偏航 Yaw"}
ROLE_LABEL = {"p": "P", "i": "I", "d": "D", "ff": "Feedforward", "gyro_lpf": "陀螺儀低通濾波", "dterm_lpf": "D 項低通濾波", "notch_enable": "陷波濾波"}

# 各生態的「反應偏慢」上升時間門檻（ms），屬教學經驗值
SLOW_RISE_MS = {"betaflight": 35.0, "ardupilot": 80.0, "px4": 80.0}


def _param_change(fd: FlightData, role: str, factor: float | None) -> dict:
    r = catalog.resolve(fd.ecosystem, fd.firmware, fd.params, role)
    item = {"role": role, "role_label": ROLE_LABEL.get(role.split(".")[0], role), "catalog": catalog.catalog_key(fd.ecosystem, fd.firmware)}
    if r["status"] != "OK":
        item.update(name=r.get("spec").name if r.get("spec") else None, status=r["status"], reason=r["reason"])
        return item
    spec, current = r["spec"], r["current"]
    proposed = spec.clamp(current * factor) if factor is not None else None
    if proposed is not None and proposed == current:
        item.update(name=spec.name, current=current, proposed=None, status="AT_LIMIT", reason=f"目前值已在範圍邊界（{spec.minimum}～{spec.maximum}），不再調整")
        return item
    item.update(
        name=spec.name,
        current=current,
        proposed=proposed,
        change_pct=round((factor - 1) * 100, 1) if factor else None,
        range=[spec.minimum, spec.maximum],
        ptype=spec.ptype,
        status="OK",
        validated_by=f"參數存在於{fd.param_source}；韌體 {fd.firmware.get('version')} 在目錄版本範圍內",
    )
    return item


def _suggestion(rule_id, level, title, observation, evidence, axis=None, params=None, hardware="", direction="", risk="", retest="", confidence="medium", completeness=1.0):
    return {
        "rule_id": rule_id,
        "level": level,
        "axis": axis,
        "title": title,
        "observation": observation,
        "evidence": evidence,
        "hardware_check": hardware,
        "params": params or [],
        "direction": direction,
        "risk": risk,
        "retest": retest,
        "confidence": confidence,
        "evidence_completeness": round(completeness, 2),
    }


RETEST = "保持相同機體、電池、螺旋槳與飛行動作，做 3～5 次單軸快速翻滾/俯仰與懸停，各至少 20 秒，上傳新日誌與本次 BASELINE 比對。"


def advise(fd: FlightData, control: dict, health: dict) -> dict:
    ind = {i["key"]: i for i in health["indicators"]}
    out: list[dict] = []
    blockers = []
    for key, reason in (("vibration", "振動過大"), ("power", "動力飽和或嚴重不平衡"), ("battery", "電池電壓過低"), ("rc_link", "遙控訊號遺失 / 失控保護")):
        if ind.get(key, {}).get("status") == "FAIL":
            blockers.append((key, reason, ind[key]))
    corrupt = float(fd.log_metadata.get("corrupt_ratio") or 0.0)
    if corrupt > 0.05:
        blockers.append(("log", f"日誌損毀比例 {corrupt * 100:.1f}%", None))
    if blockers:
        for key, reason, item in blockers:
            out.append(_suggestion(
                f"BLOCK-{key.upper()}", "BLOCKED", f"暫停調參：{reason}",
                f"{reason}時調整 PID 只會掩蓋硬體問題，甚至加劇失控風險。",
                item["evidence"] if item else [{"metric": "損毀比例", "value": corrupt}],
                hardware="先完成硬體檢查（螺旋槳、馬達、減震、電池、接收機與天線），排除後重新上傳日誌。",
                risk="在硬體問題未排除前修改參數可能導致炸機。", confidence="high",
            ))
        return _finish(fd, out, blocked=True)
    if fd.firmware.get("version_tuple") is None:
        out.append(_suggestion("FW-UNKNOWN", "INSUFFICIENT", "韌體版本無法確認", "日誌未提供可驗證的韌體版本，無法確認參數名稱與範圍。", [{"metric": "韌體識別", "value": fd.firmware.get("raw")}],
                               hardware="請學員在飛控工具中確認版本，或匯入 CLI version / 參數檔。", confidence="high"))
        return _finish(fd, out, blocked=False)
    if fd.vehicle_type != "multirotor":
        out.append(_suggestion("VEHICLE-UNVALIDATED", "INFO", f"載具類型 {fd.vehicle_type} 尚未建立調參規則", "目前規則僅針對多旋翼驗證；固定翼 / VTOL 控制結構不同，不套用多旋翼參數。", [], confidence="high"))
        return _finish(fd, out, blocked=False)
    if fd.flags.get("autotune_present"):
        out.append(_suggestion("AUTOTUNE-PRESENT", "INFO", "本日誌包含 AutoTune 資料", "AutoTune 會自行調整 PID；請比對 AutoTune 前後的參數快照，並由教師確認結果是否保存。", [{"metric": "AutoTune", "value": "存在"}], confidence="high"))
    vib = ind.get("vibration", {})
    noisy = vib.get("status") == "WARN"
    for axis, r in control["rate_loop"].items():
        if r.get("status") != "OK":
            out.append(_suggestion(f"DATA-{axis.upper()}", "INSUFFICIENT", f"{AXIS_LABEL[axis]}：資料不足", r.get("reason", "缺少資料"), [], axis=axis, retest="提高記錄頻率並做有明確桿量的飛行動作後複測。", confidence="high"))
            continue
        step = r.get("step") or {}
        if step.get("status") != "OK":
            out.append(_suggestion(f"STEP-{axis.upper()}", "INSUFFICIENT", f"{AXIS_LABEL[axis]}：無法估計階躍響應", step.get("reason", ""), [{"metric": "有效視窗數", "value": step.get("windows", 0)}], axis=axis, retest=RETEST, confidence="high"))
            continue
        windows = step["windows"]
        conf = "high" if windows >= 30 else ("medium" if windows >= 10 else "low")
        complete = min(1.0, windows / 30.0) * (0.7 if r["sources"].get("setpoint_derived") else 1.0)
        evidence = [
            {"metric": "過衝", "value": step["overshoot_pct"], "unit": "%"},
            {"metric": "上升時間（10→90%）", "value": step["rise_time_ms"], "unit": "ms"},
            {"metric": "50% 響應延遲", "value": step["latency_50_ms"], "unit": "ms"},
            {"metric": "正規化追蹤誤差", "value": r.get("tracking_norm")},
            {"metric": "有效操控視窗", "value": windows},
            {"metric": "演算法", "value": ALGORITHM_VERSION},
        ]
        if r["sources"].get("setpoint_derived"):
            evidence.append({"metric": "限制", "value": "目標角速度為推導值"})
        if axis == "yaw":
            if step["overshoot_pct"] > 25:
                out.append(_suggestion("YAW-INFO", "INFO", "偏航響應過衝偏大", f"偏航過衝 {step['overshoot_pct']}%。偏航通常較不敏感，建議先確認馬達固定與螺旋槳狀況，必要時由教師判斷。", evidence, axis=axis, confidence=conf, completeness=complete))
            continue
        if step["overshoot_pct"] > 15:
            if noisy:
                params = [_param_change(fd, f"p.{axis}", 1 - STEP)]
                direction = "振動已偏高，不建議提高 D；改為降低 P 約 10%。"
            else:
                params = [_param_change(fd, f"d.{axis}", 1 + STEP)]
                direction = "提高 D 約 10% 以增加阻尼；若 D 項雜訊上升則改為降低 P。"
            out.append(_suggestion(
                f"OVERSHOOT-{axis.upper()}", "REVIEW", f"{AXIS_LABEL[axis]}：過衝 {step['overshoot_pct']}%",
                f"階躍響應峰值為穩態的 {step['peak']} 倍，代表阻尼不足或 P 偏高。", evidence, axis=axis, params=params,
                hardware="確認螺旋槳無損傷、馬達螺絲鎖緊、飛控減震正常。",
                direction=direction, risk="D 過高會放大高頻雜訊、使馬達發熱；P 降太多會變得鬆軟。", retest=RETEST, confidence=conf, completeness=complete,
            ))
        elif step["overshoot_pct"] < 3 and (step.get("rise_time_ms") or 0) > SLOW_RISE_MS.get(fd.ecosystem, 80):
            params = [_param_change(fd, f"p.{axis}", 1 + STEP)]
            if fd.ecosystem == "betaflight" and fd.params.get(f"f_{axis}", 0) > 0:
                params.append(_param_change(fd, f"ff.{axis}", 1 + STEP))
            out.append(_suggestion(
                f"SLOW-{axis.upper()}", "REVIEW", f"{AXIS_LABEL[axis]}：響應偏慢",
                f"上升時間 {step['rise_time_ms']} ms，幾乎沒有過衝，控制偏保守。", evidence, axis=axis, params=params,
                hardware="確認電池電量充足、馬達無異常發熱。",
                direction="小幅提高 P（以及 Feedforward）約 10%。", risk="P 提高後可能出現過衝或高頻抖動，需觀察馬達溫度。", retest=RETEST, confidence=conf, completeness=complete,
            ))
        else:
            out.append(_suggestion(f"OK-{axis.upper()}", "INFO", f"{AXIS_LABEL[axis]}：響應在教學合理範圍", f"過衝 {step['overshoot_pct']}%、上升時間 {step['rise_time_ms']} ms。單次日誌不代表已是最佳參數。", evidence, axis=axis, confidence=conf, completeness=complete))
        osc = r.get("oscillation")
        if osc and osc["prominence"] > 30 and (r.get("tracking_norm") or 0) > 0.35:
            out.append(_suggestion(f"OSC-{axis.upper()}", "INFO", f"{AXIS_LABEL[axis]}：追蹤誤差在 {osc['peak_hz']} Hz 有明顯峰值",
                                   "可能是 propwash、P/D 比例或機架共振。請教師對照曲線判讀，不自動給出數值。", [{"metric": "峰值頻率", "value": osc["peak_hz"], "unit": "Hz"}, {"metric": "峰值顯著度", "value": osc["prominence"]}], axis=axis, confidence="low"))
    # 濾波
    spectra = control.get("spectra", {})
    gyro_specs = [s for k, s in spectra.items() if k.startswith("gyro.") and s.get("status") == "OK"]
    if not gyro_specs:
        out.append(_suggestion("FILTER-DATA", "INSUFFICIENT", "濾波分析：資料不足", "陀螺儀記錄頻率不足（需 ≥ 50 Hz 且足夠長度），無法分析雜訊頻譜。",
                               [{"metric": "可用頻譜", "value": 0}], hardware="ArduPilot 可設定 INS_LOG_BAT_MASK 開啟 IMU 批次取樣；PX4 可提高 SDLOG_PROFILE。", confidence="high"))
    else:
        hf = max((s["noise_rms"].get("80_200hz") or 0) for s in gyro_specs)
        peaks = sorted({p for s in gyro_specs for p in s.get("peaks_hz", [])[:2]})
        ev = [{"metric": "陀螺儀 80–200 Hz 雜訊 RMS", "value": round(hf, 2), "unit": "deg/s"}, {"metric": "頻譜峰值", "value": peaks[:6], "unit": "Hz"}, {"metric": "Nyquist", "value": gyro_specs[0]["nyquist_hz"], "unit": "Hz"}]
        if noisy or hf > 4.0:
            params = [_param_change(fd, "gyro_lpf", 1 - STEP)]
            if fd.ecosystem == "ardupilot" and float(fd.params.get("INS_HNTCH_ENABLE", 1)) == 0:
                params = [_param_change(fd, "notch_enable", None)]
            out.append(_suggestion("FILTER-NOISE", "REVIEW", "陀螺儀高頻雜訊偏高", "高頻雜訊會經 D 項放大，造成馬達發熱與抖動。", ev, params=params,
                                   hardware="優先處理雜訊來源：螺旋槳平衡、馬達軸承、飛控減震與線材固定。",
                                   direction="硬體排除後仍偏高，才小幅降低陀螺儀低通截止頻率（或依峰值設定陷波）。", risk="濾波越強延遲越大，可能降低穩定裕度。", retest=RETEST, confidence="medium"))
        else:
            out.append(_suggestion("FILTER-OK", "INFO", "陀螺儀雜訊在可接受範圍", "目前不需要加強濾波；過度濾波會增加控制延遲。", ev, confidence="medium"))
    return _finish(fd, out, blocked=False)


def _finish(fd: FlightData, items: list[dict], blocked: bool) -> dict:
    for idx, item in enumerate(items, 1):
        item["id"] = f"S{idx:02d}"
        # 有任何參數無法驗證時，該建議降為 INFO（不得匯出）
        if item["level"] == "REVIEW" and not any(p.get("status") == "OK" and p.get("proposed") is not None for p in item["params"]):
            item["level"] = "INFO"
            item["observation"] += "（參數未能通過版本 / 快照驗證，僅供教學參考，不產生可匯出數值）"
    counts = {}
    for item in items:
        counts[item["level"]] = counts.get(item["level"], 0) + 1
    return {
        "ruleset_version": RULESET_VERSION,
        "algorithm_version": ALGORITHM_VERSION,
        "ecosystem": fd.ecosystem,
        "catalog": catalog.catalog_key(fd.ecosystem, fd.firmware),
        "blocked": blocked,
        "counts": counts,
        "suggestions": items,
        "explanation": explain(fd, items, blocked),
        "disclaimer": "建議由確定性規則產生，數值為小步調整方向，不是最佳參數；須教師審核並由學員在官方工具（Betaflight Configurator / Mission Planner / QGroundControl）手動修改後實機複測。系統不會連接飛控或寫入參數。",
    }


def explain(fd: FlightData, items: list[dict], blocked: bool) -> str:
    eco = {"betaflight": "Betaflight", "ardupilot": "ArduPilot", "px4": "PX4"}.get(fd.ecosystem, fd.ecosystem)
    lines = [f"這份 {eco} {fd.firmware.get('version')} 日誌（{fd.hardware.get('board')}）共 {fd.log_metadata.get('duration_s')} 秒。"]
    if blocked:
        lines.append("系統偵測到硬體或安全風險，本次不提供任何調參方案，請先完成檢查後重新上傳。")
    review = [i for i in items if i["level"] == "REVIEW"]
    insufficient = [i for i in items if i["level"] == "INSUFFICIENT"]
    if review:
        lines.append(f"有 {len(review)} 項建議需要教師審核：" + "；".join(i["title"] for i in review) + "。")
    if insufficient:
        lines.append(f"有 {len(insufficient)} 項因資料不足沒有結論，請依提示改善記錄設定。")
    if not review and not blocked:
        lines.append("目前沒有需要修改的參數；這代表在現有資料下未發現明顯問題，不代表參數已是最佳。")
    if fd.warnings:
        lines.append("資料限制：" + "；".join(fd.warnings[:3]))
    lines.append("（本說明由規則模板生成，未將日誌上傳到任何外部 AI 服務。）")
    return "\n".join(lines)
