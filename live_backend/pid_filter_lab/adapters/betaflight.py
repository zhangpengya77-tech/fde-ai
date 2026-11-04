"""Betaflight Blackbox → 統一 FlightData。"""

from __future__ import annotations

import re

import numpy as np

from ..model import AXES, FlightData, parse_version
from ..parsers import blackbox

FEATURE_GPS = 1 << 7

DISARM_REASONS = {0: "ARMING_DISABLED", 1: "FAILSAFE", 2: "THROTTLE_TIMEOUT", 3: "STICKS", 4: "SWITCH", 5: "CRASH_PROTECTION", 6: "RUNAWAY_TAKEOFF", 7: "GPS_RESCUE", 8: "SERIAL_COMMAND"}


def _ints(raw: str) -> list[int]:
    out = []
    for x in (raw or "").split(","):
        x = x.strip()
        if not x:
            continue
        try:
            out.append(int(x, 0) if x.startswith("0x") else int(float(x)))
        except ValueError:
            out.append(0)
    return out


def firmware_info(headers: dict[str, str]) -> dict:
    revision = headers.get("Firmware revision", "")
    ftype = headers.get("Firmware type", "")
    m = re.match(r"\s*(Betaflight|Cleanflight|INAV|EmuFlight|Emuflight|Rotorflight|KISS)\s+(\S+)\s*(?:\(([0-9a-f]+)\))?\s*(\S+)?", revision, re.IGNORECASE)
    name = m.group(1) if m else (ftype or "unknown")
    if name.lower() == "emuflight":
        name = "EmuFlight"
    elif name.lower() == "inav":
        name = "INAV"
    version = m.group(2) if m else ""
    # 4.x 標頭的 revision 末段是 MCU（例如 STM32F405），板型在 Board information（例如 "AIRB OMNIBUSF4"）
    board_info = headers.get("Board information", "").strip()
    target = board_info.split(" ", 1)[-1] if board_info else (m.group(4) if m and m.group(4) else "")
    vt = parse_version(version)
    return {
        "name": name,
        "version": version or "unknown",
        "version_tuple": list(vt) if vt else None,
        "git": m.group(3) if m else None,
        "raw": revision,
        "firmware_type_header": ftype,
        "legacy": False,
        "source": "Blackbox 標頭 Firmware revision",
        "target": target,
        "mcu": m.group(4) if m and m.group(4) else None,
    }


def _rate_curve_bf(rc: np.ndarray, rc_rate: float, expo: float, super_rate: float) -> np.ndarray:
    """Betaflight 3.x～4.x「BETAFLIGHT」rates 曲線（rcCommand ±500 → deg/s）。"""
    rate = rc_rate / 100.0
    if rate > 2.0:
        rate += 14.54 * (rate - 2.0)
    x = np.clip(rc / 500.0, -1.0, 1.0)
    e = expo / 100.0
    if e:
        x = x * np.abs(x) ** 3 * e + x * (1.0 - e)
    angle = 200.0 * rate * x
    if super_rate:
        factor = 1.0 / np.clip(1.0 - np.abs(x) * (super_rate / 100.0), 0.01, 1.0)
        angle = angle * factor
    return np.clip(angle, -1998.0, 1998.0)


def header_params(headers: dict[str, str]) -> dict[str, float]:
    """把標頭轉成扁平參數表（以 Betaflight CLI 名稱為主，保留原始鍵）。"""
    params: dict[str, float] = {}
    for axis, key in (("roll", "rollPID"), ("pitch", "pitchPID"), ("yaw", "yawPID")):
        vals = _ints(headers.get(key, ""))
        for name, val in zip(("p", "i", "d", "f"), vals):
            params[f"{name}_{axis}"] = float(val)
    ff = _ints(headers.get("ff_weight", ""))
    for axis, val in zip(AXES, ff):
        params[f"f_{axis}"] = float(val)
    for key, value in headers.items():
        if key.startswith("Field ") or key in ("Product", "Data version", "Firmware revision", "Firmware date", "Firmware type", "Craft name", "Board information"):
            continue
        parts = value.split(",")
        try:
            if len(parts) == 1:
                params[key] = float(int(value, 0)) if value.startswith("0x") else float(value)
            else:
                for i, part in enumerate(parts):
                    params[f"{key}[{i}]"] = float(part)
        except ValueError:
            continue
    return params


class UnsupportedFirmware(blackbox.BlackboxError):
    """Blackbox 格式相同但韌體不是 Betaflight（INAV、EmuFlight 等）：參數與控制結構不同，不套用 Betaflight 規則。"""


def adapt(data: bytes, log_index: int | None = None) -> FlightData:
    first = blackbox.headers_only(data)
    if first:
        fw0 = firmware_info(first[0])
        if fw0["name"] != "Betaflight":
            raise UnsupportedFirmware(
                f"這份 Blackbox 日誌的韌體是 {fw0['name']} {fw0['version']}，不是 Betaflight。"
                f"{fw0['name']} 的參數名稱與控制結構不同，系統尚未建立對應的解析與調參規則，因此不提供分析；"
                "可在「其他飛控」建立飛機檔案保存資料。"
            )
    logs = blackbox.decode(data)
    usable = [l for l in logs if l.stats["frames"] > 100]
    if not usable:
        raise blackbox.BlackboxError("Blackbox 檔案中沒有包含足夠資料框的飛行段（可能只有開機或空記錄）。")
    if log_index is not None:
        chosen = next((l for l in logs if l.index == log_index), None)
        if chosen is None or chosen.stats["frames"] <= 100:
            raise blackbox.BlackboxError(f"第 {log_index} 段日誌沒有足夠資料。")
    else:
        chosen = max(usable, key=lambda l: l.stats["frames"])
    h = chosen.headers
    fw = firmware_info(h)
    warnings: list[str] = []
    vt = fw["version_tuple"] or (0, 0, 0)
    if tuple(vt) < (3, 0, 0):
        warnings.append("Betaflight 3.0 以前的日誌單位定義不同，陀螺儀數值未經驗證。")
    params = header_params(h)
    fd = FlightData(
        ecosystem="betaflight",
        vehicle_type="multirotor",
        firmware=fw,
        hardware={"board": fw.get("target") or "unknown", "mcu": fw.get("mcu"), "source": "Blackbox 標頭（Board information，無則 Firmware revision 末段）", "craft_name": h.get("Craft name", "")},
        params=params,
        param_source="Blackbox 標頭參數快照",
        warnings=warnings,
    )
    time_us = chosen.column("time").astype(np.float64)
    t = (time_us - time_us[0]) / 1e6
    # 陀螺儀：Betaflight ≥3.0 的 gyroADC 已是 deg/s
    for i, axis in enumerate(AXES):
        g = chosen.column(f"gyroADC[{i}]")
        if g is not None:
            fd.add(f"rate.{axis}.actual", t, g, "deg/s", f"gyroADC[{i}]")
        g_unf = chosen.column(f"gyroUnfilt[{i}]")
        if g_unf is not None:
            fd.add(f"rate.{axis}.unfiltered", t, g_unf, "deg/s", f"gyroUnfilt[{i}]")
        sp = chosen.column(f"setpoint[{i}]")
        if sp is not None:
            fd.add(f"rate.{axis}.setpoint", t, sp, "deg/s", f"setpoint[{i}]")
        for term, prefix in (("p", "axisP"), ("i", "axisI"), ("d", "axisD"), ("ff", "axisF")):
            col = chosen.column(f"{prefix}[{i}]")
            if col is not None:
                fd.add(f"pid.{axis}.{term}", t, col, "raw", f"{prefix}[{i}]")
    if "rate.roll.setpoint" not in fd.signals:
        # 舊版未記錄 setpoint：依 rcCommand 與 rates 標頭推導（標示為推導值）。
        rc_rates = _ints(h.get("rc_rates", "")) or [_ints(h.get("rcRate", "100"))[0]] * 2 + [_ints(h.get("rcYawRate", "100"))[0]]
        expos = _ints(h.get("rc_expo", "")) or [_ints(h.get("rcExpo", "0"))[0]] * 2 + [_ints(h.get("rcYawExpo", "0"))[0]]
        supers = _ints(h.get("rates", "0,0,0"))
        rates_type = h.get("rates_type", "0")
        if rates_type not in ("0", ""):
            warnings.append("日誌使用非 Betaflight 型 rates 且未記錄 setpoint，無法推導目標角速度。")
        else:
            for i, axis in enumerate(AXES):
                rc = chosen.column(f"rcCommand[{i}]")
                if rc is None:
                    continue
                sp = _rate_curve_bf(rc.astype(np.float64), rc_rates[min(i, len(rc_rates) - 1)], expos[min(i, len(expos) - 1)], supers[min(i, len(supers) - 1)] if supers else 0)
                fd.add(f"rate.{axis}.setpoint", t, sp, "deg/s", f"rcCommand[{i}] + rates 標頭", derived=True, note="舊版日誌未記錄 setpoint，依 Betaflight rates 公式推導；未含 RC smoothing。")
    # 油門
    thr = chosen.column("setpoint[3]")
    if thr is not None:
        fd.add("throttle", t, thr / 1000.0, "0..1", "setpoint[3]")
    else:
        rc3 = chosen.column("rcCommand[3]")
        if rc3 is not None:
            fd.add("throttle", t, (rc3 - 1000.0) / 1000.0, "0..1", "rcCommand[3]")
    # 馬達
    mo = _ints(h.get("motorOutput", "0,2047"))
    mmin, mmax = (mo[0], mo[1]) if len(mo) >= 2 else (0, 2047)
    motors = 0
    for i in range(8):
        col = chosen.column(f"motor[{i}]")
        if col is None:
            break
        fd.add(f"motor.{i + 1}", t, (col - mmin) / max(1.0, (mmax - mmin)), "0..1", f"motor[{i}] / motorOutput {mmin}-{mmax}")
        motors += 1
    fd.flags["motor_count"] = motors
    # 電池
    vb = chosen.column("vbatLatest")
    if vb is not None and np.any(vb > 0):
        scale = 0.01 if tuple(vt) >= (4, 0, 0) else 0.1
        fd.add("battery.voltage", t, vb * scale, "V", "vbatLatest", note=f"單位假設 {scale} V/LSB（依韌體版本）")
    amp = chosen.column("amperageLatest")
    if amp is not None and np.any(amp != 0):
        fd.add("battery.current", t, amp * 0.01, "A", "amperageLatest")
    # 慢速框：遙控、失控保護、飛行模式
    if chosen.slow:
        sidx = np.asarray([min(i, len(t) - 1) for i, _ in chosen.slow])
        st = t[sidx] if len(t) else np.zeros(0)
        names = chosen.slow_fields
        vals = np.asarray([v for _, v in chosen.slow], dtype=np.float64)
        for field_name, sig in (("rxSignalReceived", "rc.signal"), ("failsafePhase", "rc.failsafe_phase"), ("flightModeFlags", "mode.flags")):
            if field_name in names:
                fd.add(sig, st, vals[:, names.index(field_name)], "flag", f"S 框 {field_name}")
    rssi = chosen.column("rssi")
    if rssi is not None:
        fd.add("rc.rssi", t, rssi / 1023.0 * 100.0, "%", "rssi")
    # GPS
    features = _ints(h.get("features", "0"))[0]
    fd.flags["gps_configured"] = bool(features & FEATURE_GPS) or bool(chosen.gps)
    if chosen.gps:
        names = chosen.gps_fields
        g = np.asarray(chosen.gps, dtype=np.float64)
        gt = np.linspace(0, t[-1], len(g)) if "time" not in names else (g[:, names.index("time")] - time_us[0]) / 1e6
        if "GPS_numSat" in names:
            fd.add("gps.sats", gt, g[:, names.index("GPS_numSat")], "count", "G 框 GPS_numSat")
    # 事件
    for ev in chosen.events:
        idx = min(ev.get("frame_index", 0), len(t) - 1)
        item = {"t": round(float(t[idx]), 3) if len(t) else 0.0, "kind": ev["name"]}
        if ev["name"] == "DISARM":
            item["text"] = DISARM_REASONS.get(ev.get("reason"), f"reason {ev.get('reason')}")
        fd.events.append(item)
    fd.log_metadata = {
        "format": "Betaflight Blackbox",
        "segments": len(logs),
        "segment_index": chosen.index,
        "segments_summary": [{"index": l.index, "frames": l.stats["frames"]} for l in logs],
        "frames": chosen.stats["frames"],
        "corrupt_frames": chosen.stats["corrupt_frames"],
        # 以位元組計的中段損毀比例；檔尾殘留（未擦除的 Flash 等）另列，不視為損毀
        "corrupt_ratio": chosen.stats["interior_unparsed_ratio"],
        "trailing_garbage_bytes": chosen.stats["trailing_garbage_bytes"],
        "ended_cleanly": chosen.stats["ended_cleanly"],
        "duration_s": round(float(t[-1]), 2) if len(t) else 0.0,
        "main_rate_hz": round(float(1.0 / np.median(np.diff(t))), 1) if len(t) > 2 else 0.0,
        "looptime_us": h.get("looptime"),
        "debug_mode": h.get("debug_mode"),
        "fields": chosen.main_fields,
    }
    if not chosen.stats["ended_cleanly"]:
        fd.warnings.append("日誌沒有正常結束標記（可能斷電或記錄被截斷），尾段資料可能不完整。")
    if fd.log_metadata["corrupt_ratio"] > 0.01:
        fd.warnings.append(f"日誌中段有 {fd.log_metadata['corrupt_ratio'] * 100:.1f}% 的資料無法解析，已略過並重新同步。")
    trailing = chosen.stats["trailing_garbage_bytes"]
    if trailing > 4096:
        fd.warnings.append(f"日誌結尾有 {trailing / 1024:.0f} KB 無法解析的資料（常見於未擦除的 Flash 殘留），已忽略，不影響前面的有效資料。")
    return fd
