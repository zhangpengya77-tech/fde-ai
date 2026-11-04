"""PID 控制響應與頻譜分析（確定性數值演算法，與飛控生態無關）。

演算法說明（皆為公開的訊號處理方法，自行實作）：
- 重取樣：以實際角速度的中位取樣率建立等間隔時間軸，目標值線性內插。
- 追蹤誤差：RMS(actual - setpoint)，並以 RMS(setpoint) 正規化。
- 延遲：誤差最小化的互相關延遲（0～150 ms）。
- 階躍響應：分段 Hann 視窗 + Wiener 反卷積估計脈衝響應，再積分為階躍響應；
  僅採用目標值振幅足夠的視窗（PID-Analyzer / PIDtoolbox 所用的同類方法）。
- 頻譜：Welch 平均週期圖（Hann、50% 重疊）。
"""

from __future__ import annotations

import numpy as np

from ..model import ALGORITHM_VERSION, AXES, FlightData, Signal

MIN_SETPOINT_DPS = 20.0
STEP_WINDOW_S = 1.0
STEP_RESPONSE_S = 0.5
WIENER_LAMBDA = 0.05


def _uniform(actual: Signal, setpoint: Signal, max_rate: float = 4000.0):
    rate = min(actual.rate_hz, max_rate)
    if rate <= 0:
        return None
    t0 = max(actual.t[0], setpoint.t[0])
    t1 = min(actual.t[-1], setpoint.t[-1])
    if t1 - t0 < 1.0:
        return None
    t = np.arange(t0, t1, 1.0 / rate)
    a = np.interp(t, actual.t, actual.v)
    s = np.interp(t, setpoint.t, setpoint.v)
    # 標記日誌中斷（取樣間隔 > 5 倍中位數），避免跨斷點計算。
    gaps = np.diff(actual.t) > 5.0 / actual.rate_hz
    valid = np.ones(len(t), dtype=bool)
    for idx in np.nonzero(gaps)[0]:
        valid &= ~((t > actual.t[idx]) & (t < actual.t[idx + 1]))
    return t, a, s, rate, valid


def _delay_ms(a: np.ndarray, s: np.ndarray, rate: float) -> float | None:
    # 降到 ≤1 kHz 計算，解析度 1 ms 已足夠教學判讀
    k = max(1, int(rate // 1000))
    a, s, rate = a[::k], s[::k], rate / k
    max_lag = int(0.15 * rate)
    if max_lag < 1 or len(a) < 4 * max_lag:
        return None
    best, best_lag = None, 0
    for lag in range(0, max_lag + 1):
        err = np.mean((a[lag:] - s[: len(s) - lag]) ** 2)
        if best is None or err < best:
            best, best_lag = err, lag
    return round(best_lag / rate * 1000.0, 1)


def step_response(t: np.ndarray, a: np.ndarray, s: np.ndarray, rate: float, valid: np.ndarray) -> dict:
    win = int(STEP_WINDOW_S * rate)
    resp_len = int(STEP_RESPONSE_S * rate)
    if win < 32 or len(a) < win:
        return {"status": "INSUFFICIENT", "reason": "資料長度或取樣率不足以估計階躍響應", "windows": 0}
    hann = np.hanning(win)
    steps = []
    for start in range(0, len(a) - win, win // 2):
        seg = slice(start, start + win)
        if not np.all(valid[seg]):
            continue
        sp = s[seg]
        if np.max(np.abs(sp)) < MIN_SETPOINT_DPS:
            continue
        x = np.fft.rfft(sp * hann)
        y = np.fft.rfft(a[seg] * hann)
        # Wiener 正則化：雜訊功率取輸入平均功率的 WIENER_LAMBDA 倍
        power = np.abs(x) ** 2
        h = (y * np.conj(x)) / (power + WIENER_LAMBDA * np.mean(power) + 1e-9)
        impulse = np.fft.irfft(h, n=win)[:resp_len]
        step = np.cumsum(impulse)
        steps.append(step)
    if len(steps) < 5:
        return {"status": "INSUFFICIENT", "reason": f"只有 {len(steps)} 個有效操控視窗（目標角速度需 ≥ {MIN_SETPOINT_DPS:.0f} deg/s，至少 5 個）", "windows": len(steps)}
    arr = np.asarray(steps)
    # 去除離群視窗（穩態偏離中位數過大者）
    ss_idx = slice(int(0.2 * rate), int(0.45 * rate))
    ss = np.mean(arr[:, ss_idx], axis=1)
    med = np.median(ss)
    keep = np.abs(ss - med) < 0.5 * max(abs(med), 0.2)
    arr = arr[keep] if np.sum(keep) >= 5 else arr
    mean = np.mean(arr, axis=0)
    steady = float(np.mean(mean[ss_idx]))
    if steady <= 0.1:
        return {"status": "INSUFFICIENT", "reason": "階躍響應穩態值異常（可能資料品質不足或目標值推導不正確）", "windows": len(steps)}
    norm = mean / steady
    peak = float(np.max(norm))
    tt = np.arange(len(norm)) / rate
    def first_cross(level: float):
        idx = np.nonzero(norm >= level)[0]
        return float(tt[idx[0]] * 1000.0) if len(idx) else None
    t10, t50, t90 = first_cross(0.1), first_cross(0.5), first_cross(0.9)
    settle = None
    outside = np.nonzero(np.abs(norm - 1.0) > 0.05)[0]
    if len(outside):
        settle = float(tt[min(outside[-1] + 1, len(tt) - 1)] * 1000.0)
    step_ds = max(1, len(norm) // 250)
    return {
        "status": "OK",
        "windows": int(len(arr)),
        "steady_state_gain": round(steady, 3),
        "peak": round(peak, 3),
        "overshoot_pct": round(max(0.0, peak - 1.0) * 100.0, 1),
        "rise_time_ms": round(t90 - t10, 1) if t10 is not None and t90 is not None else None,
        "latency_50_ms": round(t50, 1) if t50 is not None else None,
        "settling_ms": round(settle, 1) if settle is not None else None,
        "curve": {"t_ms": [round(x * 1000.0, 2) for x in tt[::step_ds]], "y": [round(float(x), 4) for x in norm[::step_ds]]},
    }


def welch(v: np.ndarray, rate: float, nperseg: int | None = None) -> tuple[np.ndarray, np.ndarray]:
    n = len(v)
    nperseg = nperseg or int(min(n, max(256, 2 ** int(np.log2(max(rate * 0.5, 64))))))
    if n < nperseg or nperseg < 16:
        return np.zeros(0), np.zeros(0)
    win = np.hanning(nperseg)
    scale = 1.0 / (rate * np.sum(win ** 2))
    acc = None
    count = 0
    for start in range(0, n - nperseg + 1, nperseg // 2):
        seg = v[start:start + nperseg]
        seg = (seg - np.mean(seg)) * win
        p = np.abs(np.fft.rfft(seg)) ** 2 * scale
        acc = p if acc is None else acc + p
        count += 1
    psd = acc / count
    psd[1:-1] *= 2
    return np.fft.rfftfreq(nperseg, 1.0 / rate), psd


def spectrum(sig: Signal, label: str, throttle: Signal | None = None) -> dict:
    rate = sig.rate_hz
    if rate < 50 or sig.duration < 2:
        return {"status": "INSUFFICIENT", "reason": f"{label} 取樣率 {rate:.0f} Hz 或長度不足，無法做頻譜分析", "rate_hz": round(rate, 1)}
    t = np.arange(sig.t[0], sig.t[-1], 1.0 / rate)
    v = np.interp(t, sig.t, sig.v)
    if throttle is not None:
        thr = np.interp(t, throttle.t, throttle.v)
        flying = thr > 0.1
        if np.sum(flying) > rate * 2:
            v = v[flying]
    f, p = welch(v, rate)
    if not len(f):
        return {"status": "INSUFFICIENT", "reason": "資料不足", "rate_hz": round(rate, 1)}
    nyq = rate / 2.0
    db = 10 * np.log10(p + 1e-12)
    band = f >= 20
    peaks = []
    if np.any(band):
        fb, pb = f[band], p[band]
        floor = np.median(pb)
        for i in range(1, len(pb) - 1):
            if pb[i] > pb[i - 1] and pb[i] >= pb[i + 1] and pb[i] > 6 * floor:
                peaks.append((float(pb[i]), float(fb[i])))
        peaks.sort(reverse=True)
    df = f[1] - f[0]
    def band_rms(lo, hi):
        sel = (f >= lo) & (f < min(hi, nyq))
        return float(np.sqrt(np.sum(p[sel]) * df)) if np.any(sel) else None
    step = max(1, len(f) // 400)
    return {
        "status": "OK",
        "label": label,
        "source": sig.source,
        "rate_hz": round(rate, 1),
        "nyquist_hz": round(nyq, 1),
        "window": {"type": "hann", "nperseg": int((len(f) - 1) * 2), "overlap": 0.5, "seconds_used": round(len(v) / rate, 1)},
        "peaks_hz": [round(fr, 1) for _, fr in peaks[:5]],
        "noise_rms": {
            "0_20hz": band_rms(0, 20),
            "20_80hz": band_rms(20, 80),
            "80_200hz": band_rms(80, 200),
            "200hz_plus": band_rms(200, nyq),
        },
        "curve": {"f": [round(float(x), 2) for x in f[::step]], "db": [round(float(x), 2) for x in db[::step]]},
    }


def flying_mask(fd: FlightData, t: np.ndarray) -> np.ndarray:
    """以油門或馬達平均輸出 > 15% 判定飛行中；沒有資料時全部視為飛行中並由呼叫端標示限制。"""
    thr = fd.sig("throttle")
    if thr is not None:
        return np.interp(t, thr.t, thr.v) > 0.15
    motors = [fd.sig(f"motor.{i}") for i in range(1, 9) if fd.sig(f"motor.{i}") is not None]
    if motors:
        avg = np.mean([np.interp(t, m.t, m.v) for m in motors], axis=0)
        return avg > 0.15
    return np.ones(len(t), dtype=bool)


def _activity_window(t: np.ndarray, s: np.ndarray, rate: float, seconds: float = 4.0) -> slice:
    n = int(seconds * rate)
    if len(s) <= n:
        return slice(0, len(s))
    energy = np.convolve(np.abs(s), np.ones(n), mode="valid")
    start = int(np.argmax(energy))
    return slice(start, start + n)


def analyze_axis(fd: FlightData, axis: str) -> dict:
    actual = fd.sig(f"rate.{axis}.actual")
    setpoint = fd.sig(f"rate.{axis}.setpoint")
    result: dict = {"axis": axis, "loop": "rate"}
    if actual is None or setpoint is None:
        result.update(status="INSUFFICIENT", reason="缺少實際角速度或目標角速度資料")
        return result
    u = _uniform(actual, setpoint)
    if u is None:
        result.update(status="INSUFFICIENT", reason="資料重疊時間不足 1 秒")
        return result
    t, a, s, rate, valid = u
    if rate < 50:
        result.update(status="INSUFFICIENT", sample_rate_hz=round(rate, 1), reason=f"角速度記錄頻率僅 {rate:.0f} Hz（低於 50 Hz），內環追蹤、延遲與階躍響應無法可靠計算；請提高日誌記錄頻率後複測")
        return result
    valid = valid & flying_mask(fd, t)
    if np.sum(valid) < rate * 2:
        result.update(status="INSUFFICIENT", reason="飛行中（油門/馬達輸出 > 15%）的資料不足 2 秒")
        return result
    if float(np.percentile(np.abs(a[valid]), 95)) < 2.0:
        result.update(status="INSUFFICIENT", reason="實際角速度幾乎為零（95% 分位 < 2 deg/s），判定為地面或台架測試，未進行控制響應分析")
        return result
    err = a - s
    active = (np.abs(s) > MIN_SETPOINT_DPS) & valid
    # 只在有明顯操控量的樣本上計算正規化誤差，避免懸停時分母趨近 0
    rms_sp = float(np.sqrt(np.mean(s[active] ** 2))) if np.sum(active) > rate else 0.0
    rms_err = float(np.sqrt(np.mean(err[active] ** 2))) if np.sum(active) > rate else float(np.sqrt(np.mean(err[valid] ** 2)))
    result.update(
        status="OK",
        sources={"actual": actual.source, "setpoint": setpoint.source, "setpoint_derived": setpoint.derived},
        sample_rate_hz=round(rate, 1),
        window={"start_s": round(float(t[0]), 2), "end_s": round(float(t[-1]), 2), "valid_ratio": round(float(np.mean(valid)), 3)},
        stick_activity_ratio=round(float(np.mean(active)), 3),
        setpoint_rms_dps=round(rms_sp, 2),
        tracking_rms_dps=round(rms_err, 2),
        tracking_norm=round(rms_err / rms_sp, 3) if rms_sp > MIN_SETPOINT_DPS else None,
        tracking_scope="僅計算 |目標| > 20 deg/s 的飛行樣本" if rms_sp > MIN_SETPOINT_DPS else "操控量不足 1 秒，未計算正規化誤差",
        delay_ms=_delay_ms(a[valid], s[valid], rate),
        step=step_response(t, a, s, rate, valid),
    )
    if setpoint.derived:
        result["note"] = setpoint.note
    sl = _activity_window(t, s, rate)
    ds = max(1, (sl.stop - sl.start) // 1500)
    result["trace"] = {
        "t": [round(float(x), 4) for x in t[sl][::ds]],
        "setpoint": [round(float(x), 2) for x in s[sl][::ds]],
        "actual": [round(float(x), 2) for x in a[sl][::ds]],
    }
    if rate >= 100:
        f, p = welch(err[valid], rate)
        if len(f):
            band = (f >= 5) & (f <= min(60, rate / 2))
            if np.any(band):
                i = int(np.argmax(p[band]))
                prom = float(p[band][i] / (np.median(p[band]) + 1e-12))
                result["oscillation"] = {"peak_hz": round(float(f[band][i]), 1), "prominence": round(prom, 1), "band_hz": [5, 60]}
    return result


UPSET_DEG = 80.0
UPSET_MARGIN_S = 1.0


def upset_segments(fd: FlightData) -> list[dict]:
    """找出翻覆 / 失控姿態段（任一軸 |實際角度| > 80°），回傳時間區間（含前後 1 秒）。"""
    segs = []
    for axis in ("roll", "pitch"):
        a = fd.sig(f"att.{axis}.actual")
        if a is None:
            continue
        # 只計算飛行中（油門 / 馬達輸出 > 15%）的翻覆；落地後搬動機體不算
        idx = np.nonzero((np.abs(a.v) > UPSET_DEG) & flying_mask(fd, a.t))[0]
        if not len(idx):
            continue
        for part in np.split(idx, np.nonzero(np.diff(idx) > 1)[0] + 1):
            segs.append({"start_s": float(a.t[part[0]]) - UPSET_MARGIN_S, "end_s": float(a.t[part[-1]]) + UPSET_MARGIN_S, "axis": axis, "peak_deg": round(float(np.max(np.abs(a.v[part]))), 1)})
    segs.sort(key=lambda s: s["start_s"])
    merged = []
    for s in segs:
        if merged and s["start_s"] <= merged[-1]["end_s"]:
            merged[-1]["end_s"] = max(merged[-1]["end_s"], s["end_s"])
            merged[-1]["peak_deg"] = max(merged[-1]["peak_deg"], s["peak_deg"])
        else:
            merged.append(dict(s))
    for s in merged:
        s["start_s"], s["end_s"] = round(s["start_s"], 2), round(s["end_s"], 2)
    return merged


def attitude_loop(fd: FlightData) -> dict:
    out = {}
    upsets = upset_segments(fd)
    for axis in ("roll", "pitch"):
        a, s = fd.sig(f"att.{axis}.actual"), fd.sig(f"att.{axis}.setpoint")
        if a is None or s is None:
            out[axis] = {"status": "INSUFFICIENT", "reason": "缺少姿態或姿態目標資料"}
            continue
        fly = flying_mask(fd, a.t)
        upset = np.zeros(len(a.t), dtype=bool)
        for seg in upsets:
            upset |= (a.t >= seg["start_s"]) & (a.t <= seg["end_s"])
        use = fly & ~upset
        if np.sum(use) < 10:
            out[axis] = {"status": "INSUFFICIENT", "reason": "飛行中的姿態資料不足（已排除翻覆段）"}
            continue
        t = a.t[use]
        sv = np.interp(t, s.t, s.v)
        # 角度差回繞到 ±180°，避免跨越 ±180° 時誤差被誤判為 360°
        err = (a.v[use] - sv + 180.0) % 360.0 - 180.0
        out[axis] = {
            "status": "OK",
            "loop": "attitude",
            "sources": {"actual": a.source, "setpoint": s.source},
            "tracking_rms_deg": round(float(np.sqrt(np.mean(err ** 2))), 2),
            "max_error_deg": round(float(np.max(np.abs(err))), 2),
            "sample_rate_hz": round(a.rate_hz, 1),
            "excluded_upset_s": round(float(np.sum(fly & upset)) / max(a.rate_hz, 1e-6), 1),
        }
    if upsets:
        out["upsets"] = upsets
    return out


def batch_spectrum(fd: FlightData, sensor: str, stage: str, axis_key: str, label: str) -> dict | None:
    """以 IMU 批次取樣計算平均頻譜：每批為連續高頻資料，各批 Welch 後再平均（只取飛行中的批次）。"""
    batches = [b for b in fd.batches if b["sensor"] == sensor and b.get("stage") == stage and len(b[axis_key]) >= 256]
    if not batches:
        return None
    flying = []
    for b in batches:
        fm = flying_mask(fd, np.asarray([b["t0"]]))
        if fm[0]:
            flying.append(b)
    used = flying if len(flying) >= 3 else []
    if not used:
        return {"status": "INSUFFICIENT", "reason": f"{label}：飛行中的批次取樣不足 3 批", "rate_hz": round(batches[0]["rate_hz"], 1)}
    rate = float(np.median([b["rate_hz"] for b in used]))
    nper = 2 ** int(np.log2(min(len(b[axis_key]) for b in used)))
    psds = []
    for b in used:
        f, p = welch(b[axis_key], b["rate_hz"], nperseg=nper)
        if len(f):
            psds.append(p)
    f = np.fft.rfftfreq(nper, 1.0 / rate)
    p = np.mean(psds, axis=0)
    nyq = rate / 2.0
    db = 10 * np.log10(p + 1e-12)
    band = f >= 20
    peaks = []
    fb, pb = f[band], p[band]
    floor = np.median(pb) if len(pb) else 0
    for i in range(1, len(pb) - 1):
        if pb[i] > pb[i - 1] and pb[i] >= pb[i + 1] and pb[i] > 6 * floor:
            peaks.append((float(pb[i]), float(fb[i])))
    peaks.sort(reverse=True)
    df = f[1] - f[0]

    def band_rms(lo, hi):
        sel = (f >= lo) & (f < min(hi, nyq))
        return float(np.sqrt(np.sum(p[sel]) * df)) if np.any(sel) else None

    step = max(1, len(f) // 400)
    return {
        "status": "OK",
        "label": label,
        "source": f"{'ISBD 陀螺儀' if sensor == 'gyro' else 'ISBD 加速度計'}批次取樣（{'濾波後' if stage == 'post' else '濾波前'}，instance {used[0]['instance']}）",
        "rate_hz": round(rate, 1),
        "nyquist_hz": round(nyq, 1),
        "window": {"type": "hann", "nperseg": nper, "overlap": 0.5, "seconds_used": round(sum(len(b[axis_key]) for b in used) / rate, 1), "batches": len(used)},
        "peaks_hz": [round(fr, 1) for _, fr in peaks[:5]],
        "noise_rms": {"0_20hz": band_rms(0, 20), "20_80hz": band_rms(20, 80), "80_200hz": band_rms(80, 200), "200hz_plus": band_rms(200, nyq)},
        "curve": {"f": [round(float(x), 2) for x in f[::step]], "db": [round(float(x), 2) for x in db[::step]]},
    }


def filter_effect(spectra: dict) -> dict | None:
    """比較濾波前後同一軸的雜訊，量化濾波器實際衰減。"""
    out = {}
    for axis in ("roll", "pitch", "yaw"):
        pre, post = spectra.get(f"gyro_unfiltered.{axis}"), spectra.get(f"gyro.{axis}")
        if not (pre and post and pre.get("status") == "OK" and post.get("status") == "OK"):
            continue
        row = {}
        for band in ("20_80hz", "80_200hz", "200hz_plus"):
            a, b = pre["noise_rms"].get(band), post["noise_rms"].get(band)
            if a and b:
                row[band] = round(float(20 * np.log10(b / a)), 1)
        out[axis] = {"attenuation_db": row, "pre_peaks_hz": pre["peaks_hz"], "post_peaks_hz": post["peaks_hz"]}
    return out or None


def analyze(fd: FlightData) -> dict:
    axes = {axis: analyze_axis(fd, axis) for axis in AXES}
    spectra = {}
    if fd.batches:
        for axis, key in zip(AXES, ("x", "y", "z")):
            pre = batch_spectrum(fd, "gyro", "pre", key, f"{axis} 陀螺儀（濾波前，批次取樣）")
            post = batch_spectrum(fd, "gyro", "post", key, f"{axis} 陀螺儀（濾波後，批次取樣）")
            if pre:
                spectra[f"gyro_unfiltered.{axis}"] = pre
            if post:
                spectra[f"gyro.{axis}"] = post
    thr = fd.sig("throttle")
    for axis in AXES:
        src = fd.sig(f"rate.{axis}.actual")
        if fd.ecosystem in ("ardupilot", "px4") and fd.sig(f"imu.gyro.{axis}") is not None:
            imu = fd.sig(f"imu.gyro.{axis}")
            if src is None or imu.rate_hz > src.rate_hz:
                src = imu
        if src is not None and f"gyro.{axis}" not in spectra and f"gyro_unfiltered.{axis}" not in spectra:
            spectra[f"gyro.{axis}"] = spectrum(src, f"{axis} 陀螺儀", thr)
        unf = fd.sig(f"rate.{axis}.unfiltered")
        if unf is not None:
            spectra[f"gyro_unfiltered.{axis}"] = spectrum(unf, f"{axis} 未濾波陀螺儀", thr)
        d = fd.sig(f"pid.{axis}.d")
        if d is not None and axis != "yaw":
            spectra[f"dterm.{axis}"] = spectrum(d, f"{axis} D 項", thr)
    return {
        "algorithm_version": ALGORITHM_VERSION,
        "rate_loop": axes,
        "attitude_loop": attitude_loop(fd) if fd.ecosystem in ("ardupilot", "px4") else {"note": "Betaflight Acro 以角速度內環為主，無姿態外環資料"},
        "spectra": spectra,
        "filter_effect": filter_effect(spectra),
    }
