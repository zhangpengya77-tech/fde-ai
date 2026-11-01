"""
测试辅助：生成结构合法的 ArduPilot DataFlash .bin 日志样本（真实帧格式）。

仅用于单元测试与端到端演示，绝不用于伪造健康判定结果。
2026-10-16：帧格式从旧测试私有格式（[len][name:4s][payload]）改为真实
ArduPilot DataFlash 格式（[0xA3][0x95][type:uint8][payload:(len-3)]，FMT 自描述），
与 builtin_rule_engine.parse_bin_log 及 pymavlink DFReader 完全一致，
因此样本可用于验证「真实解析」确实发生（字段取自真实字节，而非写死）。
"""

from __future__ import annotations

import struct

_HEAD = b"\xa3\x95"
FMT_TYPE = 0x80

# 样本消息类型号（任意唯一即可，真实日志由飞控分配）
TYPE_BAT = 200
TYPE_VIBE = 201
TYPE_GPS = 202
TYPE_ATT = 203
TYPE_RCOU = 204
TYPE_MODE = 206
TYPE_CTUN = 207
TYPE_POWR = 209
TYPE_MAG = 210
TYPE_XKF4 = 211
TYPE_ERR = 212
TYPE_PARM = 213


def _fmt_payload(type_id: int, length: int, name: str, fmt: str, labels: str) -> bytes:
    name_b = name.encode("ascii")[:4].ljust(4, b"\x00")
    fmt_b = fmt.encode("ascii")[:16].ljust(16, b"\x00")
    labels_b = labels.encode("ascii")[:64].ljust(64, b"\x00")
    return bytes([type_id, length]) + name_b + fmt_b + labels_b


def _frame(type_id: int, payload: bytes) -> bytes:
    """真实 DataFlash 帧： [0xA3][0x95][type:uint8][payload]。"""
    return _HEAD + bytes([type_id]) + payload


def _fmt_frame(type_id: int, name: str, fmt: str, labels: str, struct_fmt: str = "") -> bytes:
    """FMT 定义帧：payload = [ftype][flen][name:4][format:16][labels:64]。

    flen = 该消息类型自身的总长度（含 3 字节帧头），供解析器切帧。
    """
    msg_len = 3 + struct.calcsize("<" + (struct_fmt or fmt))  # DataFlash 字符 N 对应 struct 16s
    return _frame(FMT_TYPE, _fmt_payload(type_id, msg_len, name, fmt, labels))


def _msg_frame(type_id: int, fmt: str, values: tuple) -> bytes:
    """普通消息帧：长度 = 3 + struct 打包后 payload 长度。"""
    payload = struct.pack("<" + fmt, *values)
    return _frame(type_id, payload)


# 2026-11-01 八卡改版：样本具备真实时间轴（地面待机 → 起飞悬停 → 降落），
# 覆盖八卡所需消息：BAT / POWR / RCOU / CTUN / VIBE / ATT / ERR / GPS / MODE / MAG / XKF4 / PARM。
# healthy=False 时刻意制造各卡危险特征，用于验证规则真实生效。
def build_sample(healthy: bool = True, count: int = 30, hz: int = 5) -> bytes:
    """count = 日志秒数；hz = 采样率。"""
    import math

    out = bytearray()
    out += _fmt_frame(TYPE_PARM, "PARM", "QNf", "TimeUS,Name,Value", "Q16sf")
    out += _fmt_frame(TYPE_BAT, "BAT", "Qfff", "TimeUS,Volt,Curr,RemPct")
    out += _fmt_frame(TYPE_POWR, "POWR", "Qf", "TimeUS,Vcc")
    out += _fmt_frame(TYPE_VIBE, "VIBE", "QBfffI", "TimeUS,IMU,VibeX,VibeY,VibeZ,Clip")
    out += _fmt_frame(TYPE_GPS, "GPS", "QBBf", "TimeUS,Status,NSats,HDop")
    out += _fmt_frame(TYPE_ATT, "ATT", "Qffffff", "TimeUS,DesRoll,Roll,DesPitch,Pitch,DesYaw,Yaw")
    out += _fmt_frame(TYPE_RCOU, "RCOU", "QHHHH", "TimeUS,C1,C2,C3,C4")
    out += _fmt_frame(TYPE_MODE, "MODE", "QBBB", "TimeUS,Mode,ModeNum,Rsn")
    out += _fmt_frame(TYPE_CTUN, "CTUN", "Qff", "TimeUS,ThO,Alt")
    out += _fmt_frame(TYPE_MAG, "MAG", "QBfff", "TimeUS,I,MagX,MagY,MagZ")
    out += _fmt_frame(TYPE_XKF4, "XKF4", "QBfffff", "TimeUS,C,SV,SP,SH,SM,SVT")
    out += _fmt_frame(TYPE_ERR, "ERR", "QBB", "TimeUS,Subsys,ECode")

    def name16(n):
        return n.encode("ascii").ljust(16, b"\x00")

    out += _msg_frame(TYPE_PARM, "Q16sf", (1, name16("MOT_PWM_MIN"), 1000.0))
    out += _msg_frame(TYPE_PARM, "Q16sf", (1, name16("MOT_PWM_MAX"), 2000.0))
    out += _msg_frame(TYPE_MODE, "QBBB", (1, 5, 5, 1))  # LOITER（需要 GPS 的模式）

    n = count * hz
    takeoff = 2 * hz
    landing = n - 3 * hz if healthy else n + 1   # 危险样本：日志在空中中断
    clip = 0
    err_written = False
    for i in range(n):
        t = 1_000_000 + i * (1_000_000 // hz)
        sec = i / hz
        flying = takeoff <= i < landing
        wave = math.sin(sec * 0.8)             # 油门起伏，供磁干扰估算
        if healthy:
            base = 1500 + 90 * wave if flying else 1000
            c = [base + 6, base - 4, base + 3, base - 5]
            vol = (16.4 - 0.03 * sec) if flying else 16.6
            vcc = 5.05 + 0.02 * ((i % 3) - 1)
            vib = 9.0 + 3.0 * abs(wave) if flying else 0.5
            status, sats, hdop = 3, 14, 0.8
            droll, roll = 1.0 * wave, 1.0 * wave + 0.6
            dpitch, pitch = -0.5, -0.1
            thr = (base - 1000) / 1000
            mag = 450.0 + 5.0 * thr
            var = 0.1 + 0.05 * abs(wave)
        else:
            base = 1520 + 90 * wave if flying else 1000
            c = [base + 10, base - 230, base + 5, base + 8]  # M2 持续偏低
            vol = (15.6 - 0.15 * sec) if flying else 16.0      # 带载跌到 ~3.2V/片
            vcc = 4.5 if 10 * hz <= i < 14 * hz else 5.0
            vib = 68.0 if flying else 0.5
            if flying and i % hz == 0:
                clip += 1                                     # Clip 持续增长
            status, sats, hdop = 3, 4, 3.2
            droll, roll = 0.0, 15.0 + wave if flying else 0.0
            dpitch, pitch = 0.0, 0.0
            thr = (base - 1000) / 1000
            mag = 420.0 + 300.0 * thr                         # 磁场随油门剧烈变化
            var = 0.95 if flying else 0.1
        out += _msg_frame(TYPE_RCOU, "QHHHH", (t, *[int(x) for x in c]))
        out += _msg_frame(TYPE_BAT, "Qfff", (t, vol, 12.0 if flying else 0.5, 80.0))
        out += _msg_frame(TYPE_POWR, "Qf", (t, vcc))
        out += _msg_frame(TYPE_VIBE, "QBfffI", (t, 0, vib * 0.8, vib * 0.9, vib, clip))
        out += _msg_frame(TYPE_GPS, "QBBf", (t, status, sats, hdop))
        out += _msg_frame(TYPE_ATT, "Qffffff", (t, droll, roll, dpitch, pitch, 90.0, 90.0))
        out += _msg_frame(TYPE_CTUN, "Qff", (t, thr, 5.0 if flying else 0.0))
        out += _msg_frame(TYPE_MAG, "QBfff", (t, 0, mag * 0.6, mag * 0.0, mag * 0.8))
        out += _msg_frame(TYPE_XKF4, "QBfffff", (t, 0, var, var, var * 0.5, var * 0.5, var * 0.3))
        if not healthy and not err_written and sec >= 20:
            out += _msg_frame(TYPE_ERR, "QBB", (t, 6, 1))     # 电池失效保护
            err_written = True

    return bytes(out)


if __name__ == "__main__":
    import sys
    healthy = "--bad" not in sys.argv
    data = build_sample(healthy=healthy)
    fn = "sample_flight_healthy.bin" if healthy else "sample_flight_bad.bin"
    with open(fn, "wb") as f:
        f.write(data)
    print(f"wrote {fn} ({len(data)} bytes, healthy={healthy})")
