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
TYPE_RCIN = 205
TYPE_MODE = 206
TYPE_CTUN = 207
TYPE_BARO = 208


def _fmt_payload(type_id: int, length: int, name: str, fmt: str, labels: str) -> bytes:
    name_b = name.encode("ascii")[:4].ljust(4, b"\x00")
    fmt_b = fmt.encode("ascii")[:16].ljust(16, b"\x00")
    labels_b = labels.encode("ascii")[:64].ljust(64, b"\x00")
    return bytes([type_id, length]) + name_b + fmt_b + labels_b


def _frame(type_id: int, payload: bytes) -> bytes:
    """真实 DataFlash 帧： [0xA3][0x95][type:uint8][payload]。"""
    return _HEAD + bytes([type_id]) + payload


def _fmt_frame(type_id: int, name: str, fmt: str, labels: str) -> bytes:
    """FMT 定义帧：payload = [ftype][flen][name:4][format:16][labels:64]。

    flen = 该消息类型自身的总长度（含 3 字节帧头），供解析器切帧。
    """
    msg_len = 3 + struct.calcsize("<" + fmt)
    return _frame(FMT_TYPE, _fmt_payload(type_id, msg_len, name, fmt, labels))


def _msg_frame(type_id: int, fmt: str, values: tuple) -> bytes:
    """普通消息帧：长度 = 3 + struct 打包后 payload 长度。"""
    payload = struct.pack("<" + fmt, *values)
    return _frame(type_id, payload)


# 八卡规则全部有对应消息：BAT / VIBE / GPS / ATT / RCOU / RCIN / MODE / CTUN / BARO
def build_sample(healthy: bool = True, count: int = 40) -> bytes:
    out = bytearray()

    # FMT 定义（自描述，真实帧头 0xA3 0x95 0x80）
    out += _fmt_frame(TYPE_BAT, "BAT", "Qfff", "TimeUS,Vol,Curr,Pct")
    out += _fmt_frame(TYPE_VIBE, "VIBE", "QfffB", "TimeUS,VibeX,VibeY,VibeZ,Clip")
    out += _fmt_frame(TYPE_GPS, "GPS", "QBff", "TimeUS,NSats,HDop,Status")
    out += _fmt_frame(TYPE_ATT, "ATT", "Qffffff", "TimeUS,DesRoll,Roll,DesPitch,Pitch,DesYaw,Yaw")
    out += _fmt_frame(TYPE_RCOU, "RCOU", "QHHHH", "TimeUS,C1,C2,C3,C4")
    out += _fmt_frame(TYPE_RCIN, "RCIN", "QHHHH", "TimeUS,C1,C2,C3,C4")
    out += _fmt_frame(TYPE_MODE, "MODE", "QBBB", "TimeUS,Mode,ModeNum,Rsn")
    out += _fmt_frame(TYPE_CTUN, "CTUN", "Qfffff", "TimeUS,ThrOut,DAlt,Alt,BAlt")
    out += _fmt_frame(TYPE_BARO, "BARO", "Qff", "TimeUS,Alt,Press")

    for i in range(count):
        t = i * 1000000
        if healthy:
            vol = 15.8 - (i % 5) * 0.02      # ~15.7-15.8V
            pct = 92.0 - (i % 5) * 0.5
            vx = 0.3 + (i % 3) * 0.05
            vy = 0.25 + (i % 3) * 0.04
            vz = 0.2 + (i % 2) * 0.05
            clip = 0
            sats = 13
            hdop = 0.8
            roll = 0.5 + (i % 3) * 0.1
            desroll = 0.5
            pitch = -0.2 + (i % 2) * 0.1
            despitch = -0.2
            yaw = 90.0 + (i % 4) * 0.2
            desyaw = 90.0
            # 动力均衡：四通道命令接近（极差 < 200）
            c1 = 1450 + (i % 7) * 10
            c2 = 1452 + (i % 5) * 10
            c3 = 1448 + (i % 6) * 10
            c4 = 1451 + (i % 4) * 10
            # 遥控正常带 1000~2000 内
            rc1, rc2, rc3, rc4 = 1500, 1505, 1000, 1995
            mode, modenum = 5, 5          # LOITER
            dalt = alt = 12.0 + (i % 3) * 0.05   # 定高一致
            baro_alt = alt + 0.02
        else:
            vol = 9.8 + (i % 3) * 0.15        # 危险低电压（低于 10.5V 危险阈值）
            pct = 12.0
            vx = 3.4                          # 振动危险
            vy = 3.2
            vz = 2.9
            clip = 1
            sats = 3                          # 定位危险
            hdop = 3.5
            roll = 18.0 + (i % 3)
            desroll = 0.5
            pitch = 12.0
            despitch = -0.2
            yaw = 90.0 + (i % 5) * 4.0
            desyaw = 90.0
            # 动力不均衡：C2 持续偏低（极差 > 200 检查阈值）
            c1 = 1500
            c2 = 1250
            c3 = 1498
            c4 = 1501
            # 遥控越界：C4 跌出正常带（失控保护迹象）
            rc1, rc2, rc3, rc4 = 1500, 1505, 1000, 850
            mode, modenum = 5, 5
            dalt = 12.0                        # 定高与气压高度偏差 5m（> 3m 阈值）
            alt = 7.0 + (i % 3) * 0.05
            baro_alt = 12.02

        out += _msg_frame(TYPE_BAT, "Qfff", (t, vol, 0.0, pct))
        out += _msg_frame(TYPE_VIBE, "QfffB", (t, vx, vy, vz, clip))
        out += _msg_frame(TYPE_GPS, "QBff", (t, sats, hdop, 3))
        out += _msg_frame(TYPE_ATT, "Qffffff", (t, desroll, roll, despitch, pitch, desyaw, yaw))
        out += _msg_frame(TYPE_RCOU, "QHHHH", (t, int(c1), int(c2), int(c3), int(c4)))
        out += _msg_frame(TYPE_RCIN, "QHHHH", (t, rc1, rc2, rc3, rc4))
        out += _msg_frame(TYPE_MODE, "QBBB", (t, mode, modenum, 1))
        out += _msg_frame(TYPE_CTUN, "Qfffff", (t, 1450.0, dalt, alt, 12.0, 0.0))
        out += _msg_frame(TYPE_BARO, "Qff", (t, baro_alt, 98500.0))

    return bytes(out)


if __name__ == "__main__":
    import sys
    healthy = "--bad" not in sys.argv
    data = build_sample(healthy=healthy)
    fn = "sample_flight_healthy.bin" if healthy else "sample_flight_bad.bin"
    with open(fn, "wb") as f:
        f.write(data)
    print(f"wrote {fn} ({len(data)} bytes, healthy={healthy})")
