"""PX4 ULog → 統一 FlightData。PX4 主題名稱依版本不同，皆以「存在才使用」處理。"""

from __future__ import annotations

import numpy as np

from ..model import AXES, FlightData
from ..parsers import ulog

NAV_STATES = {0: "MANUAL", 1: "ALTCTL", 2: "POSCTL", 3: "AUTO_MISSION", 4: "AUTO_LOITER", 5: "AUTO_RTL", 10: "ACRO", 12: "DESCEND", 13: "TERMINATION", 14: "OFFBOARD", 15: "STAB", 17: "AUTO_TAKEOFF", 18: "AUTO_LAND", 19: "AUTO_FOLLOW_TARGET", 20: "AUTO_PRECLAND", 21: "ORBIT"}


def _release(value) -> dict:
    """ver_sw_release 編碼為 0xAABBCCTT（主、次、修訂、類型）。"""
    if not isinstance(value, int) or value <= 0:
        return {}
    major, minor, patch, kind = (value >> 24) & 0xFF, (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF
    kind_name = "release" if kind == 255 else ("rc" if kind >= 192 else ("beta" if kind >= 128 else ("alpha" if kind >= 64 else "dev")))
    return {"version": f"{major}.{minor}.{patch}", "version_tuple": [major, minor, patch], "release_type": kind_name}


def firmware_info(u: ulog.ULogData) -> dict:
    rel = _release(u.info.get("ver_sw_release"))
    git = u.info.get("ver_sw")
    return {
        "name": str(u.info.get("sys_name") or "PX4"),
        "version": rel.get("version", "unknown"),
        "version_tuple": rel.get("version_tuple"),
        "release_type": rel.get("release_type"),
        "git": git,
        "raw": f"ver_sw_release={u.info.get('ver_sw_release')} ver_sw={git}",
        "legacy": None,
        "source": "ULog Info：ver_sw_release" if rel else "ULog 未記錄 ver_sw_release，只有 git 雜湊，版本需人工確認",
        "os": u.info.get("sys_os_name"),
    }


def _vehicle(params: dict) -> str:
    mav = int(params.get("MAV_TYPE", 0) or 0)
    if mav in (2, 3, 4, 13, 14, 15):
        return "multirotor"
    if mav == 1:
        return "plane"
    if mav in (19, 20, 21, 22, 23):
        return "vtol"
    if mav == 10:
        return "rover"
    return "unknown"


def _euler(q: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    w, x, y, z = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    roll = np.degrees(np.arctan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)))
    pitch = np.degrees(np.arcsin(np.clip(2 * (w * y - z * x), -1, 1)))
    yaw = np.degrees(np.arctan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)))
    return roll, pitch, yaw


def adapt(data: bytes) -> FlightData:
    u = ulog.parse(data)
    fw = firmware_info(u)
    warnings = []
    if fw["version"] == "unknown":
        warnings.append("ULog 未記錄正式版本號（ver_sw_release），只能以 git 雜湊識別；請教師確認韌體版本。")
    if fw["name"] != "PX4":
        warnings.append(f"ULog sys_name 為 {fw['name']}，不是 PX4。")
    fd = FlightData(
        ecosystem="px4",
        vehicle_type=_vehicle(u.params),
        firmware=fw,
        hardware={"board": str(u.info.get("ver_hw") or "unknown"), "source": "ULog Info：ver_hw"},
        params=dict(u.params),
        param_source="ULog 參數快照" if u.params else "無",
        warnings=warnings,
    )
    t0 = u.start_timestamp

    def ts(arr: np.ndarray) -> np.ndarray:
        return (arr["timestamp"].astype(np.float64) - t0) / 1e6

    av = u.topic("vehicle_angular_velocity")
    att = u.topic("vehicle_attitude")
    if av is not None and len(av):
        t = ts(av)
        for i, axis in enumerate(AXES):
            fd.add(f"rate.{axis}.actual", t, np.degrees(av["xyz"][:, i]), "deg/s", f"vehicle_angular_velocity.xyz[{i}]")
    elif att is not None and "rollspeed" in (att.dtype.names or ()):
        t = ts(att)
        for axis, key in zip(AXES, ("rollspeed", "pitchspeed", "yawspeed")):
            fd.add(f"rate.{axis}.actual", t, np.degrees(att[key]), "deg/s", f"vehicle_attitude.{key}（舊版 PX4）")
    sp = u.topic("vehicle_rates_setpoint")
    if sp is not None and len(sp):
        t = ts(sp)
        for axis in AXES:
            fd.add(f"rate.{axis}.setpoint", t, np.degrees(sp[axis]), "deg/s", f"vehicle_rates_setpoint.{axis}")
    if att is not None and len(att) and "q" in att.dtype.names:
        r, p, _ = _euler(att["q"].astype(np.float64))
        t = ts(att)
        fd.add("att.roll.actual", t, r, "deg", "vehicle_attitude.q")
        fd.add("att.pitch.actual", t, p, "deg", "vehicle_attitude.q")
    asp = u.topic("vehicle_attitude_setpoint")
    if asp is not None and len(asp):
        t = ts(asp)
        names = asp.dtype.names
        if "q_d" in names:
            r, p, _ = _euler(asp["q_d"].astype(np.float64))
            fd.add("att.roll.setpoint", t, r, "deg", "vehicle_attitude_setpoint.q_d")
            fd.add("att.pitch.setpoint", t, p, "deg", "vehicle_attitude_setpoint.q_d")
        elif "roll_body" in names:
            fd.add("att.roll.setpoint", t, np.degrees(asp["roll_body"]), "deg", "vehicle_attitude_setpoint.roll_body")
            fd.add("att.pitch.setpoint", t, np.degrees(asp["pitch_body"]), "deg", "vehicle_attitude_setpoint.pitch_body")
    motors = u.topic("actuator_motors")
    outs = u.topic("actuator_outputs")
    count = 0
    if motors is not None and len(motors):
        t = ts(motors)
        ctrl = motors["control"]
        for i in range(min(8, ctrl.shape[1])):
            if np.all(np.isnan(ctrl[:, i])):
                break
            fd.add(f"motor.{i + 1}", t, ctrl[:, i], "0..1", f"actuator_motors.control[{i}]")
            count += 1
    elif outs is not None and len(outs):
        t = ts(outs)
        n_out = int(np.max(outs["noutputs"])) if "noutputs" in outs.dtype.names else 4
        pmin = float(u.params.get("PWM_MAIN_MIN", u.params.get("PWM_MIN", 1000)) or 1000)
        pmax = float(u.params.get("PWM_MAIN_MAX", u.params.get("PWM_MAX", 2000)) or 2000)
        mav_motors = {2: 4, 13: 6, 14: 8, 15: 8}.get(int(u.params.get("MAV_TYPE", 2) or 2), 4)
        for i in range(min(n_out, mav_motors)):
            fd.add(f"motor.{i + 1}", t, (outs["output"][:, i] - pmin) / max(1.0, pmax - pmin), "0..1", f"actuator_outputs.output[{i}] / PWM {pmin:.0f}-{pmax:.0f}")
            count += 1
    fd.flags["motor_count"] = count
    bat = u.topic("battery_status")
    if bat is not None and len(bat):
        t = ts(bat)
        vkey = "voltage_v" if "voltage_v" in bat.dtype.names else "voltage_filtered_v"
        if np.any(bat[vkey] > 0.5):
            fd.add("battery.voltage", t, bat[vkey], "V", f"battery_status.{vkey}")
        if "current_a" in bat.dtype.names and np.any(bat["current_a"] > 0):
            fd.add("battery.current", t, bat["current_a"], "A", "battery_status.current_a")
    gps = u.topic("vehicle_gps_position") if u.topic("vehicle_gps_position") is not None else u.topic("sensor_gps")
    fd.flags["gps_configured"] = gps is not None
    if gps is not None and len(gps):
        t = ts(gps)
        names = gps.dtype.names
        if "satellites_used" in names:
            fd.add("gps.sats", t, gps["satellites_used"], "count", "vehicle_gps_position.satellites_used")
        if "hdop" in names:
            fd.add("gps.hdop", t, gps["hdop"], "", "vehicle_gps_position.hdop")
        if "fix_type" in names:
            fd.add("gps.fix", t, gps["fix_type"], "", "vehicle_gps_position.fix_type")
    est = u.topic("estimator_status")
    if est is not None and len(est):
        t = ts(est)
        for key, name in (("vel_test_ratio", "ekf.sv"), ("pos_test_ratio", "ekf.sp"), ("hgt_test_ratio", "ekf.sh"), ("mag_test_ratio", "ekf.sm")):
            if key in est.dtype.names:
                fd.add(name, t, est[key], "ratio", f"estimator_status.{key}")
    imu_status = u.topic("vehicle_imu_status")
    if imu_status is not None and len(imu_status) and "accel_vibration_metric" in imu_status.dtype.names:
        t = ts(imu_status)
        fd.add("vibe.accel_metric", t, imu_status["accel_vibration_metric"], "m/s²", "vehicle_imu_status.accel_vibration_metric")
        if "gyro_vibration_metric" in imu_status.dtype.names:
            fd.add("vibe.gyro_metric", t, imu_status["gyro_vibration_metric"], "rad/s", "vehicle_imu_status.gyro_vibration_metric")
    sc = u.topic("sensor_combined")
    if sc is not None and len(sc):
        t = ts(sc)
        for i, axis in enumerate(AXES):
            fd.add(f"imu.gyro.{axis}", t, np.degrees(sc["gyro_rad"][:, i]), "deg/s", f"sensor_combined.gyro_rad[{i}]")
        for i, axis in enumerate("xyz"):
            fd.add(f"imu.acc.{axis}", t, sc["accelerometer_m_s2"][:, i], "m/s²", f"sensor_combined.accelerometer_m_s2[{i}]")
    rc = u.topic("input_rc")
    if rc is not None and len(rc):
        t = ts(rc)
        if "rc_lost" in rc.dtype.names:
            fd.add("rc.signal", t, 1.0 - rc["rc_lost"].astype(float), "flag", "input_rc.rc_lost（反相）")
        if "rssi" in rc.dtype.names and np.any(rc["rssi"] > 0):
            fd.add("rc.rssi", t, rc["rssi"], "%", "input_rc.rssi")
    vs = u.topic("vehicle_status")
    if vs is not None and len(vs):
        t = ts(vs)
        last = None
        for ti, ns in zip(t, vs["nav_state"]):
            if ns != last:
                fd.modes.append({"t": round(float(ti), 3), "name": NAV_STATES.get(int(ns), f"NAV {int(ns)}")})
                last = ns
        if "failsafe" in vs.dtype.names:
            fd.add("rc.failsafe_phase", t, vs["failsafe"].astype(float), "flag", "vehicle_status.failsafe")
    for ts_us, text in u.logged:
        if text.startswith(("[3]", "[2]", "[1]", "[0]", "[4]")) or "fail" in text.lower():
            fd.events.append({"t": round((ts_us - t0) / 1e6, 3), "kind": "LOG", "text": text[:200]})
    fd.flags["autotune_present"] = u.topic("autotune_attitude_control_status") is not None
    duration = max((s.t[-1] for s in fd.signals.values() if len(s.t)), default=0.0)
    rate_sig = fd.sig("rate.roll.actual")
    fd.log_metadata = {
        "format": "PX4 ULog",
        "ulog_version": u.version,
        "topics": u.topic_names(),
        "dropouts": u.stats["dropouts"],
        "dropout_ms": u.stats["dropout_ms"],
        "truncated": u.stats["truncated"],
        "corrupt_ratio": 0.0 if not u.stats["truncated"] else 0.01,
        "duration_s": round(float(duration), 2),
        "rate_log_hz": round(rate_sig.rate_hz, 1) if rate_sig else 0.0,
    }
    if u.stats["dropout_ms"] > 0:
        fd.warnings.append(f"ULog 記錄有 {u.stats['dropouts']} 次掉資料（共 {u.stats['dropout_ms']} ms）。")
    if rate_sig and rate_sig.rate_hz < 150:
        fd.warnings.append(f"角速度記錄頻率約 {rate_sig.rate_hz:.0f} Hz，高頻振盪與濾波分析受限（可啟用 SDLOG_PROFILE 高速率記錄）。")
    return fd
