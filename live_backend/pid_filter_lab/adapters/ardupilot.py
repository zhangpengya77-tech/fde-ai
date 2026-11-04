"""ArduPilot DataFlash → 統一 FlightData（含舊版 APM 相容判斷）。"""

from __future__ import annotations

import re

import numpy as np

from ..model import AXES, FlightData
from ..parsers import dataflash

FW_RE = re.compile(r"(ArduCopter|ArduPlane|ArduRover|ArduSub|APM:Copter|APM:Plane|APM:Rover|ArduHeli|Blimp|AntennaTracker)\s+V?(\d+)\.(\d+)(?:\.(\d+))?(?:-(\w+))?")
BOARD_HINTS = ("Cube", "Pixhawk", "fmuv", "Matek", "Kakute", "SpeedyBee", "Durandal", "Pixracer", "CUAV", "Holybro", "MatekH743", "APM", "SITL", "Omnibus", "Pix32")

COPTER_MODES = {0: "STABILIZE", 1: "ACRO", 2: "ALT_HOLD", 3: "AUTO", 4: "GUIDED", 5: "LOITER", 6: "RTL", 7: "CIRCLE", 9: "LAND", 11: "DRIFT", 13: "SPORT", 14: "FLIP", 15: "AUTOTUNE", 16: "POSHOLD", 17: "BRAKE", 18: "THROW", 19: "AVOID_ADSB", 20: "GUIDED_NOGPS", 21: "SMART_RTL", 22: "FLOWHOLD", 23: "FOLLOW", 24: "ZIGZAG", 25: "SYSTEMID", 26: "AUTOROTATE", 27: "AUTO_RTL", 28: "TURTLE"}
PLANE_MODES = {0: "MANUAL", 1: "CIRCLE", 2: "STABILIZE", 3: "TRAINING", 4: "ACRO", 5: "FBWA", 6: "FBWB", 7: "CRUISE", 8: "AUTOTUNE", 10: "AUTO", 11: "RTL", 12: "LOITER", 13: "TAKEOFF", 15: "GUIDED", 17: "QSTABILIZE", 18: "QHOVER", 19: "QLOITER", 20: "QLAND", 21: "QRTL", 22: "QAUTOTUNE", 23: "QACRO", 24: "THERMAL"}

WANTED = {"RATE", "ATT", "PIDR", "PIDP", "PIDY", "VIBE", "BAT", "GPS", "XKF4", "NKF4", "EKF4", "RCOU", "RCIN", "MODE", "ERR", "EV", "IMU", "VER", "ATUN", "RSSI", "CTUN", "POWR", "MSG"}


def firmware_info(log: dataflash.DataFlashLog) -> dict:
    for _, text in log.texts:
        m = FW_RE.search(text)
        if m:
            name = m.group(1)
            major, minor, patch = int(m.group(2)), int(m.group(3)), int(m.group(4) or 0)
            legacy = name.startswith("APM:") or (major, minor) < (3, 4)
            return {
                "name": name,
                "version": f"{major}.{minor}.{patch}" + (f"-{m.group(5)}" if m.group(5) else ""),
                "version_tuple": [major, minor, patch],
                "raw": text,
                "legacy": legacy,
                "source": "日誌 MSG 訊息（開機韌體字串）",
            }
    ver = log.messages.get("VER")
    if ver and len(ver.get("Maj", [])):
        major, minor, patch = int(ver["Maj"][0]), int(ver["Min"][0]), int(ver["Pat"][0])
        return {"name": "ArduPilot", "version": f"{major}.{minor}.{patch}", "version_tuple": [major, minor, patch], "raw": "VER 訊息", "legacy": False, "source": "VER 訊息"}
    return {"name": "unknown", "version": "unknown", "version_tuple": None, "raw": "", "legacy": None, "source": "日誌中找不到韌體版本字串"}


def _vehicle(fw_name: str) -> str:
    if "Copter" in fw_name or "Heli" in fw_name:
        return "multirotor"
    if "Plane" in fw_name:
        return "plane"
    if "Rover" in fw_name:
        return "rover"
    return "unknown"


def _instance(msg: dict, key: str) -> np.ndarray | None:
    inst = msg.get(key)
    if inst is None:
        return None
    return inst == np.min(inst)


def adapt(data: bytes) -> FlightData:
    log = dataflash.parse(data, wanted=WANTED)
    fw = firmware_info(log)
    vehicle = _vehicle(fw["name"])
    board = "unknown"
    for _, text in log.texts:
        if any(h.lower() in text.lower() for h in BOARD_HINTS) and not FW_RE.search(text):
            board = text.split(" ")[0]
            break
    warnings = []
    if fw["name"] == "unknown":
        warnings.append("無法從日誌識別 ArduPilot 韌體與版本，請學員手動確認；調參建議將停用。")
    if fw.get("legacy"):
        warnings.append("偵測到舊版 APM / ArduPilot（3.4 以前）韌體：參數名稱與控制結構不同，僅採用日誌參數快照中實際存在的參數。")
    if not log.params:
        warnings.append("日誌中沒有 PARM 參數快照，無法驗證參數名稱與版本。")
    fd = FlightData(
        ecosystem="ardupilot",
        vehicle_type=vehicle,
        firmware=fw,
        hardware={"board": board, "source": "日誌 MSG 訊息" if board != "unknown" else "日誌中未記錄板型"},
        params=dict(log.params),
        param_source="日誌 PARM 參數快照" if log.params else "無",
        warnings=warnings,
    )
    all_t = []

    def tsec(msg: dict) -> np.ndarray:
        return msg["TimeUS"] / 1e6

    rate = log.messages.get("RATE")
    if rate:
        t = tsec(rate)
        all_t.append(t)
        for axis, (des, act, out) in zip(AXES, (("RDes", "R", "ROut"), ("PDes", "P", "POut"), ("YDes", "Y", "YOut"))):
            if act in rate:
                fd.add(f"rate.{axis}.actual", t, rate[act], "deg/s", f"RATE.{act}")
                fd.add(f"rate.{axis}.setpoint", t, rate[des], "deg/s", f"RATE.{des}")
                fd.add(f"rate.{axis}.output", t, rate[out], "-1..1", f"RATE.{out}")
    att = log.messages.get("ATT")
    if att:
        t = tsec(att)
        all_t.append(t)
        for axis, (des, act) in (("roll", ("DesRoll", "Roll")), ("pitch", ("DesPitch", "Pitch"))):
            fd.add(f"att.{axis}.actual", t, att[act], "deg", f"ATT.{act}")
            fd.add(f"att.{axis}.setpoint", t, att[des], "deg", f"ATT.{des}")
    for axis, name in zip(AXES, ("PIDR", "PIDP", "PIDY")):
        pid = log.messages.get(name)
        if pid:
            t = tsec(pid)
            for term, key in (("p", "P"), ("i", "I"), ("d", "D"), ("ff", "FF")):
                if key in pid:
                    fd.add(f"pid.{axis}.{term}", t, pid[key], "raw", f"{name}.{key}")
    imu = log.messages.get("IMU")
    if imu:
        sel = _instance(imu, "I")
        t = tsec(imu)[sel] if sel is not None else tsec(imu)
        for axis, key in zip(AXES, ("GyrX", "GyrY", "GyrZ")):
            v = imu[key][sel] if sel is not None else imu[key]
            fd.add(f"imu.gyro.{axis}", t, np.degrees(v), "deg/s", f"IMU.{key}（第一顆 IMU）")
    vibe = log.messages.get("VIBE")
    if vibe:
        sel = _instance(vibe, "IMU")
        t = tsec(vibe)[sel] if sel is not None else tsec(vibe)
        for key in ("VibeX", "VibeY", "VibeZ"):
            v = vibe[key][sel] if sel is not None else vibe[key]
            fd.add(f"vibe.{key[-1].lower()}", t, v, "m/s²", f"VIBE.{key}")
        clip_key = "Clip" if "Clip" in vibe else ("Clip0" if "Clip0" in vibe else None)
        if clip_key:
            v = vibe[clip_key][sel] if sel is not None else vibe[clip_key]
            fd.add("vibe.clip", t, v, "count", f"VIBE.{clip_key}")
    bat = log.messages.get("BAT")
    if bat:
        sel = _instance(bat, "Inst")
        t = tsec(bat)[sel] if sel is not None else tsec(bat)
        fd.add("battery.voltage", t, bat["Volt"][sel] if sel is not None else bat["Volt"], "V", "BAT.Volt")
        if "Curr" in bat:
            fd.add("battery.current", t, bat["Curr"][sel] if sel is not None else bat["Curr"], "A", "BAT.Curr")
    gps = log.messages.get("GPS")
    fd.flags["gps_configured"] = bool(gps) or float(log.params.get("GPS_TYPE", 1) or 0) > 0
    if gps:
        sel = _instance(gps, "I")
        t = tsec(gps)[sel] if sel is not None else tsec(gps)
        for key, name in (("NSats", "gps.sats"), ("HDop", "gps.hdop"), ("Status", "gps.fix")):
            if key in gps:
                fd.add(name, t, gps[key][sel] if sel is not None else gps[key], "", f"GPS.{key}")
    ekf = log.messages.get("XKF4") or log.messages.get("NKF4") or log.messages.get("EKF4")
    if ekf:
        src = "XKF4" if "XKF4" in log.messages else ("NKF4" if "NKF4" in log.messages else "EKF4")
        sel = _instance(ekf, "C")
        t = tsec(ekf)[sel] if sel is not None else tsec(ekf)
        for key in ("SV", "SP", "SH", "SM"):
            if key in ekf:
                fd.add(f"ekf.{key.lower()}", t, ekf[key][sel] if sel is not None else ekf[key], "ratio", f"{src}.{key}")
    rcou = log.messages.get("RCOU")
    if rcou:
        t = tsec(rcou)
        pmin = float(log.params.get("MOT_PWM_MIN", 0) or 1000) or 1000.0
        pmax = float(log.params.get("MOT_PWM_MAX", 0) or 2000) or 2000.0
        frame_class = int(log.params.get("FRAME_CLASS", 1) or 1)
        count = {1: 4, 2: 6, 3: 8, 4: 8, 5: 6, 7: 3, 10: 4, 12: 4}.get(frame_class, 4) if vehicle == "multirotor" else 0
        for i in range(count):
            key = f"C{i + 1}"
            if key in rcou:
                fd.add(f"motor.{i + 1}", t, (rcou[key] - pmin) / max(1.0, pmax - pmin), "0..1", f"RCOU.{key} / MOT_PWM {pmin:.0f}-{pmax:.0f}")
        fd.flags["motor_count"] = count
    rcin = log.messages.get("RCIN")
    if rcin:
        t = tsec(rcin)
        fd.add("rc.ch3", t, rcin.get("C3", np.zeros(len(t))), "PWM", "RCIN.C3")
        fd.add("rc.signal", t, (rcin.get("C3", np.zeros(len(t))) > 800).astype(float), "flag", "RCIN.C3 > 800 視為有訊號")
    rssi = log.messages.get("RSSI")
    if rssi and "RXRSSI" in rssi:
        fd.add("rc.rssi", tsec(rssi), rssi["RXRSSI"] * (100.0 if np.nanmax(rssi["RXRSSI"]) <= 1.0 else 1.0), "%", "RSSI.RXRSSI")
    names = COPTER_MODES if vehicle == "multirotor" else PLANE_MODES
    for t, mode, reason in log.modes:
        fd.modes.append({"t": round(t, 3), "name": names.get(mode, f"MODE {mode}"), "reason": reason})
    err = log.messages.get("ERR")
    if err:
        for t, sub, code in zip(tsec(err), err.get("Subsys", []), err.get("ECode", [])):
            fd.events.append({"t": round(float(t), 3), "kind": "ERR", "subsys": int(sub), "code": int(code)})
    ev = log.messages.get("EV")
    if ev:
        for t, eid in zip(tsec(ev), ev.get("Id", [])):
            fd.events.append({"t": round(float(t), 3), "kind": "EV", "id": int(eid)})
    fd.flags["autotune_present"] = "ATUN" in log.messages or any(m["name"] in ("AUTOTUNE", "QAUTOTUNE") for m in fd.modes)
    t0 = min((a[0] for a in all_t if len(a)), default=0.0)
    if t0:
        for s in fd.signals.values():
            s.t = s.t - t0
        for item in fd.events + fd.modes:
            item["t"] = round(item["t"] - t0, 3)
    duration = max((s.t[-1] for s in fd.signals.values() if len(s.t)), default=0.0)
    rate_sig = fd.sig("rate.roll.actual")
    fd.log_metadata = {
        "format": "ArduPilot DataFlash BIN",
        "messages": log.stats["messages"],
        "skipped_bytes": log.stats["skipped_bytes"],
        "corrupt_ratio": round(log.stats["skipped_bytes"] / max(1, log.stats["bytes"]), 4),
        "message_types": log.stats["types"],
        "duration_s": round(float(duration), 2),
        "rate_log_hz": round(rate_sig.rate_hz, 1) if rate_sig else 0.0,
        "texts": [t for _, t in log.texts[:40]],
    }
    if log.stats["skipped_bytes"] > 0.05 * log.stats["bytes"]:
        fd.warnings.append("日誌有大量無法解析的位元組，可能損毀或不完整。")
    if rate_sig and rate_sig.rate_hz < 100:
        fd.warnings.append(f"RATE 記錄頻率僅 {rate_sig.rate_hz:.0f} Hz，只能分析低頻控制響應；高頻振盪與濾波需開啟較高記錄頻率（例如 LOG_BITMASK / INS_LOG_BAT_*）。")
    return fd
