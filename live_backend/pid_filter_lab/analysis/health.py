"""統一八大飛行健康指標（三套飛控共用同一定義與評分框架）。

指標名稱、狀態與評分沿用 Flight Health AI 的八卡分類：
動力、電池、GPS、導航、振動、遙控通訊、姿態控制、飛行模式與控制狀態。

狀態：PASS / WARN / FAIL / N/A / INSUFFICIENT。
評分規則（Flight Health AI 原系統未定義數值權重，本模組補充，並在報告中公開）：
- PASS=100、WARN=60、FAIL=20；八項權重相同。
- N/A（不適用，例如 Betaflight 穿越機無 GPS）不列入分母，不扣分。
- INSUFFICIENT（資料不足）不列入分數，但降低「覆蓋率」；不會被當成滿分。
- 覆蓋率 = 已評估項 / 適用項。覆蓋率 < 75% 時綜合分數標記為「不可比較」。
閾值為 FDE 教學閾值（DERIVED），尚待真實機隊資料驗證，報告會標示來源。
"""

from __future__ import annotations

import numpy as np

from ..model import FlightData

INDICATORS = (
    ("power", "動力系統健康"),
    ("battery", "電池健康"),
    ("gps", "GPS 定位健康"),
    ("navigation", "導航系統健康"),
    ("vibration", "振動健康"),
    ("rc_link", "遙控與通信健康"),
    ("attitude", "姿態控制健康"),
    ("flight_mode", "飛行模式與控制狀態健康"),
)
STATUS_SCORE = {"PASS": 100, "WARN": 60, "FAIL": 20}
MIN_EVALUATED_FOR_SCORE = 4
THRESHOLD_SOURCE = "FDE 教學閾值（DERIVED，待驗證）"


def _coverage(fd: FlightData, names: list[str]) -> float:
    duration = float(fd.log_metadata.get("duration_s") or 0.0)
    sigs = [fd.sig(n) for n in names if fd.sig(n) is not None]
    if not sigs or duration <= 0:
        return 0.0
    return round(min(1.0, max(s.duration for s in sigs) / duration), 3)


def _result(key, status, summary, evidence=None, sources=None, coverage=0.0, confidence="medium", limits=None):
    label = dict(INDICATORS)[key]
    return {
        "key": key,
        "label": label,
        "status": status,
        "score": STATUS_SCORE.get(status),
        "summary": summary,
        "evidence": evidence or [],
        "data_sources": sources or [],
        "coverage": coverage,
        "confidence": confidence,
        "limitations": limits or [],
        "threshold_source": THRESHOLD_SOURCE,
    }


def _flying_mask(fd: FlightData, t: np.ndarray) -> np.ndarray:
    thr = fd.sig("throttle")
    if thr is not None:
        return np.interp(t, thr.t, thr.v) > 0.15
    motors = [fd.sig(f"motor.{i}") for i in range(1, 9) if fd.sig(f"motor.{i}") is not None]
    if motors:
        return np.interp(t, motors[0].t, motors[0].v) > 0.15
    return np.ones(len(t), dtype=bool)


def power(fd: FlightData) -> dict:
    if fd.vehicle_type != "multirotor":
        return _result("power", "INSUFFICIENT", f"載具類型為 {fd.vehicle_type}，輸出通道含舵機或混控，尚未驗證動力平衡判讀。", limits=["目前僅驗證多旋翼"])
    motors = [(i, fd.sig(f"motor.{i}")) for i in range(1, 9) if fd.sig(f"motor.{i}") is not None]
    if len(motors) < 3:
        return _result("power", "INSUFFICIENT", "日誌缺少完整的馬達輸出資料。", sources=[m.source for _, m in motors], limits=["至少需要 3 路馬達輸出"])
    t = motors[0][1].t
    vals = np.vstack([np.interp(t, m.t, m.v) for _, m in motors])
    fly = vals.mean(axis=0) > 0.15
    if np.sum(fly) < 20:
        return _result("power", "INSUFFICIENT", "幾乎沒有飛行中的馬達資料。", sources=[m.source for _, m in motors], coverage=_coverage(fd, [f"motor.{i}" for i, _ in motors]))
    v = vals[:, fly]
    sat = float(np.mean(np.any(v >= 0.98, axis=0)))
    means = v.mean(axis=1)
    imbalance = float(np.max(np.abs(means - means.mean())))
    ev = [
        {"metric": "馬達飽和時間比例", "value": round(sat * 100, 1), "unit": "%", "warn": 5, "fail": 15},
        {"metric": "最大單顆馬達平均輸出偏差", "value": round(imbalance * 100, 1), "unit": "%", "warn": 10, "fail": 18},
        {"metric": "各馬達平均輸出", "value": [round(float(x) * 100, 1) for x in means], "unit": "%"},
    ]
    status = "FAIL" if sat > 0.15 or imbalance > 0.18 else ("WARN" if sat > 0.05 or imbalance > 0.10 else "PASS")
    summary = {"PASS": "馬達輸出平衡，無明顯飽和。", "WARN": "馬達輸出有偏差或偶有飽和，請檢查槳、馬達、重心。", "FAIL": "馬達長時間飽和或嚴重不平衡，禁止以調參掩蓋硬體問題。"}[status]
    return _result("power", status, summary, ev, [m.source for _, m in motors], _coverage(fd, [f"motor.{i}" for i, _ in motors]), limits=["這是飛控輸出命令，不是馬達真實轉速"])


def battery(fd: FlightData) -> dict:
    v = fd.sig("battery.voltage")
    if v is None:
        return _result("battery", "INSUFFICIENT", "日誌沒有電池電壓資料，無法判斷電池健康（不視為正常）。", limits=["請在飛控開啟電壓量測與記錄"])
    vals = v.v[v.v > 0.5]
    if len(vals) < 5:
        return _result("battery", "INSUFFICIENT", "電池電壓資料過少。", sources=[v.source])
    vmax, vmin = float(np.percentile(vals, 99)), float(np.percentile(vals, 1))
    cells = int(np.ceil(vmax / 4.35 - 0.05))
    if cells < 1 or cells > 14 or vmax / cells < 3.0:
        return _result("battery", "INSUFFICIENT", f"電壓數值 {vmax:.2f} V 無法推得合理的電芯數，可能量測未校準。", sources=[v.source], limits=["請校準電壓量測比例"])
    per_min = vmin / cells
    sag = (vmax - vmin) / cells
    ev = [
        {"metric": "推估電芯數", "value": cells, "unit": "S"},
        {"metric": "最低單芯電壓（1% 分位）", "value": round(per_min, 2), "unit": "V", "warn": 3.3, "fail": 3.0},
        {"metric": "單芯壓降", "value": round(sag, 2), "unit": "V", "warn": 0.8},
    ]
    status = "FAIL" if per_min < 3.0 else ("WARN" if per_min < 3.3 or sag > 0.8 else "PASS")
    summary = {"PASS": "電壓在正常範圍。", "WARN": "電壓偏低或壓降偏大，注意電池老化與放電深度。", "FAIL": "單芯電壓過低，存在斷電風險。"}[status]
    lim = ["電芯數由最高電壓推估"]
    if v.note:
        lim.append(v.note)
    return _result("battery", status, summary, ev, [v.source], _coverage(fd, ["battery.voltage"]), limits=lim)


def gps(fd: FlightData) -> dict:
    if not fd.flags.get("gps_configured"):
        return _result("gps", "N/A", "此飛機未配置 GPS（例如 FPV 穿越機），本項不適用，不扣分。", confidence="high")
    sats, hdop = fd.sig("gps.sats"), fd.sig("gps.hdop")
    if sats is None and hdop is None:
        return _result("gps", "INSUFFICIENT", "已配置 GPS 但日誌沒有 GPS 品質資料。")
    ev, status = [], "PASS"
    if sats is not None:
        smin = float(np.percentile(sats.v, 5))
        ev.append({"metric": "衛星數（5% 分位）", "value": round(smin, 1), "warn": 10, "fail": 6})
        status = "FAIL" if smin < 6 else ("WARN" if smin < 10 else status)
    if hdop is not None:
        hmax = float(np.percentile(hdop.v, 95))
        ev.append({"metric": "HDOP（95% 分位）", "value": round(hmax, 2), "warn": 2.0, "fail": 4.0})
        if hmax > 4.0:
            status = "FAIL"
        elif hmax > 2.0 and status == "PASS":
            status = "WARN"
    summary = {"PASS": "GPS 定位品質良好。", "WARN": "GPS 衛星數或精度偏弱。", "FAIL": "GPS 定位品質不足，不適合依賴定位的飛行模式。"}[status]
    srcs = [s.source for s in (sats, hdop) if s is not None]
    return _result("gps", status, summary, ev, srcs, _coverage(fd, ["gps.sats", "gps.hdop"]))


def navigation(fd: FlightData) -> dict:
    if fd.ecosystem == "betaflight":
        return _result("navigation", "N/A", "Betaflight 穿越機以手動/Acro 飛行為主，沒有導航估測器，本項不適用。", confidence="high")
    keys = ["ekf.sv", "ekf.sp", "ekf.sh", "ekf.sm"]
    sigs = [(k, fd.sig(k)) for k in keys if fd.sig(k) is not None]
    if not sigs:
        return _result("navigation", "INSUFFICIENT", "日誌沒有 EKF 創新檢定比資料。")
    ev, worst = [], 0.0
    labels = {"ekf.sv": "速度", "ekf.sp": "位置", "ekf.sh": "高度", "ekf.sm": "磁羅盤"}
    for k, s in sigs:
        p = float(np.percentile(s.v, 99))
        worst = max(worst, p)
        ev.append({"metric": f"EKF {labels[k]}檢定比（99% 分位）", "value": round(p, 2), "warn": 0.5, "fail": 1.0})
    status = "FAIL" if worst > 1.0 else ("WARN" if worst > 0.5 else "PASS")
    summary = {"PASS": "導航估測一致性正常。", "WARN": "EKF 檢定比偏高，感測器資料之間有不一致。", "FAIL": "EKF 檢定比超過 1，導航估測曾拒絕感測器資料。"}[status]
    return _result("navigation", status, summary, ev, [s.source for _, s in sigs], _coverage(fd, keys))


def vibration(fd: FlightData) -> dict:
    vx = [fd.sig(f"vibe.{a}") for a in "xyz"]
    if all(s is not None for s in vx):  # ArduPilot VIBE
        peak = max(float(np.percentile(s.v, 95)) for s in vx)
        clip = fd.sig("vibe.clip")
        clips = float(clip.v[-1] - clip.v[0]) if clip is not None else 0.0
        ev = [
            {"metric": "VIBE 振動（95% 分位，最大軸）", "value": round(peak, 1), "unit": "m/s²", "warn": 30, "fail": 60},
            {"metric": "加速度計削波次數", "value": int(clips), "warn": 1, "fail": 100},
        ]
        status = "FAIL" if peak > 60 or clips > 100 else ("WARN" if peak > 30 or clips > 0 else "PASS")
        srcs = [s.source for s in vx] + ([clip.source] if clip else [])
        cov = _coverage(fd, ["vibe.x"])
        threshold_note = "ArduPilot 官方建議：VIBE 低於 30 m/s² 正常，超過 60 有問題；削波應為 0"
    elif fd.sig("vibe.accel_metric") is not None:  # PX4
        s = fd.sig("vibe.accel_metric")
        peak = float(np.percentile(s.v, 95))
        ev = [{"metric": "加速度振動指標（95% 分位）", "value": round(peak, 2), "unit": "m/s²", "warn": 4.0, "fail": 8.0}]
        status = "FAIL" if peak > 8 else ("WARN" if peak > 4 else "PASS")
        srcs, cov = [s.source], _coverage(fd, ["vibe.accel_metric"])
        threshold_note = THRESHOLD_SOURCE
    else:  # Betaflight 等：以陀螺儀高頻雜訊推估
        gyros = [fd.sig(f"rate.{a}.actual") for a in ("roll", "pitch")]
        gyros = [g for g in gyros if g is not None and g.rate_hz >= 400]
        if not gyros:
            return _result("vibration", "INSUFFICIENT", "沒有振動感測資料，且陀螺儀取樣率不足以估計高頻雜訊。")
        from .control import welch
        hf = []
        for g in gyros:
            t = np.arange(g.t[0], g.t[-1], 1.0 / g.rate_hz)
            v = np.interp(t, g.t, g.v)
            fly = _flying_mask(fd, t)
            if np.sum(fly) > g.rate_hz * 2:
                v = v[fly]
            f, p = welch(v, g.rate_hz)
            sel = f >= 80
            hf.append(float(np.sqrt(np.sum(p[sel]) * (f[1] - f[0]))) if np.any(sel) else 0.0)
        peak = max(hf)
        ev = [{"metric": "陀螺儀 80 Hz 以上雜訊 RMS（已濾波）", "value": round(peak, 2), "unit": "deg/s", "warn": 4.0, "fail": 10.0}]
        status = "FAIL" if peak > 10 else ("WARN" if peak > 4 else "PASS")
        srcs, cov = [g.source for g in gyros], _coverage(fd, ["rate.roll.actual"])
        threshold_note = THRESHOLD_SOURCE
    summary = {"PASS": "振動在可接受範圍。", "WARN": "振動偏高，先檢查槳平衡、馬達軸承與飛控減震。", "FAIL": "振動過大，必須先處理機械問題，暫停 PID 調參。"}[status]
    r = _result("vibration", status, summary, ev, srcs, cov)
    r["threshold_source"] = threshold_note
    return r


def rc_link(fd: FlightData) -> dict:
    sig, fs, rssi = fd.sig("rc.signal"), fd.sig("rc.failsafe_phase"), fd.sig("rc.rssi")
    if sig is None and fs is None:
        return _result("rc_link", "INSUFFICIENT", "日誌沒有遙控訊號或失控保護狀態資料。")
    # 只評估飛行中（油門 / 馬達 > 15%）的遙控狀態；台架測試未接接收機不應判為通訊故障
    ref = sig if sig is not None else fs
    fly_ref = _flying_mask(fd, ref.t)
    has_flight_data = fd.sig("throttle") is not None or any(fd.sig(f"motor.{i}") is not None for i in range(1, 9))
    if has_flight_data and not np.any(fly_ref):
        return _result("rc_link", "INSUFFICIENT", "日誌中沒有飛行段（可能是地面 / 台架測試），不評估遙控通訊。",
                       sources=[s.source for s in (sig, fs) if s is not None], limits=["只評估飛行中的遙控狀態"])

    def flying(s):
        if s is None:
            return None
        m = _flying_mask(fd, s.t)
        return s.v[m] if np.any(m) else s.v

    ev, status = [], "PASS"
    if sig is not None:
        lost = float(np.mean(flying(sig) < 0.5))
        ev.append({"metric": "遙控訊號遺失時間比例", "value": round(lost * 100, 2), "unit": "%", "warn": 0.1, "fail": 1.0})
        status = "FAIL" if lost > 0.01 else ("WARN" if lost > 0.001 else status)
    if fs is not None:
        triggered = bool(np.any(flying(fs) > 0))
        ev.append({"metric": "失控保護觸發", "value": "是" if triggered else "否"})
        if triggered:
            status = "FAIL"
    if rssi is not None:
        low = float(np.percentile(rssi.v, 5))
        ev.append({"metric": "RSSI（5% 分位）", "value": round(low, 1), "unit": "%", "warn": 40})
        if low < 40 and status == "PASS":
            status = "WARN"
    summary = {"PASS": "遙控連線穩定。", "WARN": "遙控訊號偶有減弱。", "FAIL": "發生訊號遺失或失控保護，需先排除通訊問題。"}[status]
    srcs = [s.source for s in (sig, fs, rssi) if s is not None]
    return _result("rc_link", status, summary, ev, srcs, _coverage(fd, ["rc.signal", "rc.failsafe_phase"]))


def attitude(fd: FlightData, control: dict) -> dict:
    rate = control.get("rate_loop", {})
    norms = {ax: r.get("tracking_norm") for ax, r in rate.items() if r.get("status") == "OK" and r.get("tracking_norm") is not None and ax != "yaw"}
    active = {ax: r.get("stick_activity_ratio", 0) for ax, r in rate.items()}
    att = control.get("attitude_loop", {})
    att_ok = {ax: a for ax, a in (att.items() if isinstance(att, dict) else []) if isinstance(a, dict) and a.get("status") == "OK"}
    if (not norms or max(active.get(a, 0) for a in norms) < 0.02) and att_ok:
        # 內環資料不可用時，改以姿態外環誤差評估（低頻，限制會標示）
        worst = max(a["tracking_rms_deg"] for a in att_ok.values())
        ev = [{"metric": f"{ax} 姿態誤差 RMS（外環，飛行中）", "value": a["tracking_rms_deg"], "unit": "deg", "warn": 3.0, "fail": 6.0} for ax, a in att_ok.items()]
        status = "FAIL" if worst > 6.0 else ("WARN" if worst > 3.0 else "PASS")
        summary = {"PASS": "姿態外環追蹤良好。", "WARN": "姿態追蹤誤差偏大。", "FAIL": "姿態追蹤誤差明顯，需檢查機構、重心與控制參數。"}[status]
        srcs = sorted({v for a in att_ok.values() for v in a["sources"].values()})
        lims = ["角速度內環資料不可用，僅以姿態外環評估"]
        upsets = att.get("upsets") or []
        if upsets:
            status = "FAIL"
            summary = f"偵測到 {len(upsets)} 段翻覆 / 失控姿態（|角度| > 80°），不屬於正常控制範圍；其餘飛行段姿態誤差 RMS 最大 {worst}°。"
            ev.append({"metric": "翻覆 / 失控姿態段", "value": [f"{u['start_s']}–{u['end_s']} s（峰值 {u['peak_deg']}°）" for u in upsets]})
            lims.append("翻覆段已排除於追蹤誤差計算之外，單獨列出")
        return _result("attitude", status, summary, ev, srcs, _coverage(fd, ["att.roll.actual"]), confidence="low", limits=lims)
    if not norms or max(active.get(a, 0) for a in norms) < 0.02:
        return _result("attitude", "INSUFFICIENT", "缺少目標/實際角速度，或操控量太小，無法評估控制追蹤。", limits=["需要有明顯桿量的飛行段"])
    worst = max(norms.values())
    ev = [{"metric": f"{ax} 角速度正規化追蹤誤差", "value": v, "warn": 0.35, "fail": 0.6} for ax, v in norms.items()]
    for ax in ("roll", "pitch"):
        a = att.get(ax) if isinstance(att, dict) else None
        if a and a.get("status") == "OK":
            ev.append({"metric": f"{ax} 姿態誤差 RMS（外環）", "value": a["tracking_rms_deg"], "unit": "deg"})
    status = "FAIL" if worst > 0.6 else ("WARN" if worst > 0.35 else "PASS")
    summary = {"PASS": "角速度內環追蹤良好。", "WARN": "控制追蹤誤差偏大，可進入 PID 分析查看原因。", "FAIL": "控制追蹤明顯不良，請先確認硬體與振動後再調參。"}[status]
    lims = []
    if any(r.get("sources", {}).get("setpoint_derived") for r in rate.values()):
        lims.append("目標角速度由搖桿與 rates 推導，未含 RC smoothing，誤差會偏高")
    if any((r.get("sample_rate_hz") or 0) < 100 for r in rate.values() if r.get("status") == "OK"):
        lims.append("角速度記錄頻率低於 100 Hz，只反映低頻追蹤")
    srcs = sorted({v for r in rate.values() for v in (r.get("sources") or {}).values() if isinstance(v, str)})
    return _result("attitude", status, summary, ev, srcs, _coverage(fd, ["rate.roll.actual", "rate.roll.setpoint"]), limits=lims)


def flight_mode(fd: FlightData) -> dict:
    events = fd.events
    failsafes = [e for e in events if e.get("kind") == "DISARM" and e.get("text") in ("FAILSAFE", "CRASH_PROTECTION", "RUNAWAY_TAKEOFF")]
    errs = [e for e in events if e.get("kind") == "ERR" and e.get("code", 0) != 0]
    critical = [e for e in errs if e.get("critical")]
    logs = [e for e in events if e.get("kind") == "LOG" and "fail" in e.get("text", "").lower()]
    has_mode_data = bool(fd.modes) or fd.sig("mode.flags") is not None or bool(events)
    if not has_mode_data:
        return _result("flight_mode", "INSUFFICIENT", "日誌沒有飛行模式或狀態事件資料。")
    ev = [
        {"metric": "飛行模式切換次數", "value": len(fd.modes)},
        {"metric": "模式序列", "value": [m["name"] for m in fd.modes[:12]]},
        {"metric": "異常解除武裝 / 失控保護事件", "value": len(failsafes)},
        {"metric": "飛控錯誤訊息（ERR / 失敗訊息）", "value": len(errs) + len(logs)},
    ]
    for e in (critical or errs)[:6]:
        ev.append({"metric": f"事件 {e['t']:.1f} s", "value": e.get("text") or e.get("name")})
    status = "FAIL" if failsafes or critical else ("WARN" if errs or logs else "PASS")
    if critical:
        names = sorted({e.get("text", "").split("（")[0] for e in critical})
        summary = "飛控記錄到安全事件：" + "、".join(names) + "。必須先完成事故檢查，暫停調參。"
    else:
        summary = {"PASS": "飛行模式與控制狀態正常。", "WARN": "飛控回報錯誤訊息，請查看事件明細。", "FAIL": "發生失控保護或異常解除武裝。"}[status]
    return _result("flight_mode", status, summary, ev, ["MODE / 事件訊息"], 1.0 if fd.modes else 0.5)


def evaluate(fd: FlightData, control: dict) -> dict:
    items = [power(fd), battery(fd), gps(fd), navigation(fd), vibration(fd), rc_link(fd), attitude(fd, control), flight_mode(fd)]
    applicable = [i for i in items if i["status"] != "N/A"]
    evaluated = [i for i in applicable if i["status"] in STATUS_SCORE]
    # 可評估項目少於 4 項（例如台架測試）時不給綜合分，避免少數 PASS 被誤讀成「健康 100 分」
    score = round(sum(i["score"] for i in evaluated) / len(evaluated), 1) if len(evaluated) >= MIN_EVALUATED_FOR_SCORE else None
    coverage = round(len(evaluated) / len(applicable), 3) if applicable else 0.0
    return {
        "indicators": items,
        "overall": {
            "score": score,
            "evaluated": len(evaluated),
            "applicable": len(applicable),
            "not_applicable": len(items) - len(applicable),
            "insufficient": len(applicable) - len(evaluated),
            "coverage": coverage,
            "comparable": coverage >= 0.75,
            "worst_status": "FAIL" if any(i["status"] == "FAIL" for i in items) else ("WARN" if any(i["status"] == "WARN" for i in items) else ("PASS" if evaluated else "INSUFFICIENT")),
            "rule": "PASS=100、WARN=60、FAIL=20，八項等權；N/A 不計入；INSUFFICIENT 不計分但降低覆蓋率；可評估項目少於 4 項時不計算綜合分；覆蓋率 <75% 時不可與其他飛行比較。",
        },
    }
