"""
FDE Flight Health — 系统内建飞行健康规则引擎 (Built-in Rule Engine)

职责：对学员上传的 ArduPilot DataFlash .bin 日志做「真实解析 + 确定性安全规则判断」。

铁律（教师硬要求）：
    * 绝不 Math.random()、绝不随机 PASS、绝不 hard-code 假健康结果、绝不使用固定 DEMO 数据。
    * 字段缺失 / 无法解析时，该卡必须返回 UNKNOWN（⚪ 无法判断），严禁臆测。
    * 所有判定都来自真实日志数值与公开的安全阈值，可追溯到具体字段。

解析范围：ArduPilot DataFlash 二进制 .bin 格式（真实飞控日志格式）。
    帧结构（与 pymavlink DFReader 一致）：
        [0xA3][0x95][type:uint8][payload:(len-3) 字节]
        len 由该消息自己的 FMT 定义给出（含 3 字节帧头）；FMT(type=0x80)
        自描述后续消息的字段布局（[ftype][flen][name:4][format:16][labels:64]）。
    本引擎读取日志内真实 FMT，据此解析真实消息。
    ⚠️ 2026-10-16 修复：此前解析器只认 [len:uint8][name:4s][payload] 的测试样本
    私有格式，对任何真实 ArduPilot 日志（含教师 929 日志）均解析出 0 条消息，
    导致八卡全部 UNKNOWN。本版对齐真实 DataFlash 帧结构；规则与阈值未改动。
    参考安全阈值集中定义于 SAFETY_THRESHOLDS，便于教师审阅与调整。
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

# ───────────────────────── 格式字符 → (struct 格式, 字节数, 倍率) ─────────────────────────
# 与 pymavlink DFReader.FORMAT_TO_STRUCT 完全一致（含内置倍率：c/C/e/E ×0.01、
# L ×1e-7）；n/N/Z/a 为定长字符串字段，消费字节并保留解码值以对齐后续标签。
_FMT_CHARS = {
    "b": ("b", 1, 1.0), "B": ("B", 1, 1.0),
    "h": ("h", 2, 1.0), "H": ("H", 2, 1.0),
    "i": ("i", 4, 1.0), "I": ("I", 4, 1.0),
    "l": ("i", 4, 1.0), "L": ("i", 4, 1.0e-7),
    "f": ("f", 4, 1.0), "d": ("d", 8, 1.0),
    "q": ("q", 8, 1.0), "Q": ("Q", 8, 1.0),
    "c": ("h", 2, 0.01), "C": ("H", 2, 0.01),   # 厘度（centidegree）
    "e": ("i", 4, 0.01), "E": ("I", 4, 0.01),   # 厘倍 int32
    "g": ("e", 2, 1.0),                          # 半精度浮点
    "M": ("b", 1, 1.0),
    "n": ("4s", 4, None), "N": ("16s", 16, None), "Z": ("64s", 64, None), "a": ("64s", 64, None),
}

# 四色语义
S_NORMAL = "normal"
S_INSPECT = "inspect"
S_DANGER = "danger"
S_UNKNOWN = "unknown"

_STATUS_META = {
    S_NORMAL: {"display": "通过", "icon": "🟢"},
    S_INSPECT: {"display": "需要检查", "icon": "🟠"},
    S_DANGER: {"display": "危险", "icon": "🔴"},
    S_UNKNOWN: {"display": "无法判断", "icon": "⚪"},
}


# ───────────────────────── 参考安全阈值（可审阅 / 可调整） ─────────────────────────
# 来源：多旋翼地面检查与常见飞行前隐患排查经验阈值。教师可按机型微调。
SAFETY_THRESHOLDS = {
    "battery": {
        "vol_min_danger_v": 10.5,    # 满电 4S≈16.8V；低于此视为危险
        "vol_min_inspect_v": 13.5,   # 低于此提示检查电量/单节
        "pct_min_inspect": 25,       # 剩余电量低于此提示
    },
    "vibe": {
        "max_inspect": 2.0,          # 振动加速度 m/s 超过此提示检查
        "max_danger": 3.0,           # 超过此视为危险（可能传感器/结构问题）
        "clip_danger": 1,            # 任一轴发生 clipping 即危险
    },
    "gps": {
        "sats_min_inspect": 7,       # 卫星数低于此提示
        "sats_min_danger": 4,        # 低于此危险（定位不可靠）
        "hdop_max_inspect": 2.0,     # HDOP 高于此提示
    },
    "attitude": {
        "err_inspect_deg": 10.0,     # 姿态指令跟踪误差超过此提示
        "err_danger_deg": 25.0,      # 超过此危险
    },
    # ── 2026-10-16 新增规则域（阈值与教师诊断主机 D:\FDE-Flight-Health-AI 对齐）──
    "motor": {
        # 动力输出均衡度：RCOU 四通道平均命令的极差。
        # 与教师诊断主机 basic_rules.py 的 MOTOR_COMMAND_SPREAD 一致。
        "spread_max_inspect": 200.0,
    },
    "rc": {
        # 遥控输入 PWM 正常带（正常行程 1000~2000，留容差）。
        "min_normal": 900.0,
        "max_normal": 2100.0,
    },
    "altitude": {
        # 气压高度（BARO）与飞控定高（CTUN）交叉核对容差（米）。
        "cross_check_max_inspect_m": 3.0,
    },
}


@dataclass
class _MsgSchema:
    name: str
    fmt: str
    labels: list
    type_id: int = 0    # 真实帧中的消息类型号（FMT payload 第 1 字节）
    length: int = 0     # 该消息总长度（含 3 字节帧头；FMT payload 第 2 字节）


def _parse_fmt_payload(payload: bytes):
    """FMT 消息自身布局固定：[ftype:1][flen:1][name:4][format:16][labels:64]。

    flen 含 3 字节帧头（0xA3 0x95 type），即 payload 长度 = flen - 3。
    """
    if len(payload) < 86:
        return None
    mtype = payload[0]
    mlen = payload[1]
    name = payload[2:6].split(b"\x00")[0].decode("ascii", "ignore").strip()
    fmt = payload[6:22].split(b"\x00")[0].decode("ascii", "ignore").strip()
    labels_raw = payload[22:86].decode("ascii", "ignore")
    # labels 字段 64 字节零填充：split 后最后一项会带尾随 \x00，必须剥掉，
    # 否则最后一个字段名永远匹配不上（曾导致 RCOU/RCIN 的 C4 通道失联）。
    labels = [x.replace("\x00", "").strip() for x in labels_raw.split(",") if x.replace("\x00", "").strip()]
    if not name:
        return None
    return _MsgSchema(name=name, fmt=fmt, labels=labels, type_id=mtype, length=mlen)


def _parse_fields(payload: bytes, fmt: str):
    """按 format 字符串顺序把 payload 解析为值列表（best-effort，遇未知字符跳过）。

    倍率按 pymavlink FORMAT_TO_STRUCT 内建规则应用（c/C/e/E ×0.01、L ×1e-7），
    因此 ATT 的厘度角度会还原为度、GPS 的经纬度会还原为度——与 pymavlink 取值一致。
    字符串字段（n/N/Z/a）消费定长字节并保留解码值，保证后续字段标签不错位。
    """
    values = []
    offset = 0
    for ch in fmt:
        if offset >= len(payload):
            break
        spec = _FMT_CHARS.get(ch)
        if spec is None:
            # 未知格式字符（如单位/倍率后缀）— 跳过该字符，不再消耗字节
            continue
        sfmt, size, mult = spec
        if offset + size > len(payload):
            break
        chunk = payload[offset:offset + size]
        try:
            (val,) = struct.unpack("<" + sfmt, chunk)
        except struct.error:
            break
        if mult is not None and mult != 1.0:
            val = val * mult
        elif isinstance(val, bytes):
            val = val.split(b"\x00")[0].decode("ascii", "ignore").strip()
        values.append(val)
        offset += size
    return values


# 真实 ArduPilot DataFlash 帧头（与 pymavlink DFReader 一致）
_HEAD1 = 0xA3
_HEAD2 = 0x95
_HEADER_LEN = 3  # 帧头 = sync(2) + type(1)，payload 长度 = fmt.len - 3
_FMT_TYPE = 0x80  # FMT 消息类型号（自描述其它消息的布局）


def parse_bin_log(data: bytes):
    """解析真实 ArduPilot DataFlash .bin 日志，返回 [(name, {label: value, ...}), ...]。

    帧结构： [0xA3][0x95][type:uint8][payload:(len-3) 字节]
      * len（payload 之外的消息总长，含 3 字节帧头）由该消息自己的 FMT 定义给出。
      * FMT(type=0x80) 的 payload 布局：[ftype][flen][name:4][format:16][labels:64]。
    仅依赖日志内真实 FMT；FMT 缺失时对应消息无法解析（跳过）。
    遇未知类型 / 损坏帧按 pymavlink 策略向后重同步（跳过 1 字节继续寻找帧头）。
    """
    schemas = {}   # type_id -> _MsgSchema
    messages = []
    pos = 0
    n = len(data)

    while pos + _HEADER_LEN <= n:
        if data[pos] != _HEAD1 or data[pos + 1] != _HEAD2:
            pos += 1  # 重同步：逐字节寻找真实帧头
            continue
        mtype = data[pos + 2]
        schema = schemas.get(mtype)

        if schema is None:
            # 未知类型：只有 FMT 自身可在无 schema 时被识别（布局固定）
            if mtype == _FMT_TYPE and pos + _HEADER_LEN + 86 <= n:
                s = _parse_fmt_payload(data[pos + _HEADER_LEN:pos + _HEADER_LEN + 86])
                # 注意：type_id 可能为 0（真实日志存在 type=0 的消息，如 CTUN），不可用真值判断
                if s is not None and s.length >= _HEADER_LEN + 1:
                    schemas[s.type_id] = s
                    pos += _HEADER_LEN + 86
                    continue
            pos += 1
            continue

        plen = schema.length - _HEADER_LEN
        if plen < 0 or pos + _HEADER_LEN + plen > n:
            pos += 1  # 帧被截断 / 长度非法，重同步
            continue
        payload = data[pos + _HEADER_LEN:pos + _HEADER_LEN + plen]

        if schema.name == "FMT":
            s = _parse_fmt_payload(payload)
            if s is not None and s.length >= _HEADER_LEN + 1:
                schemas[s.type_id] = s
        else:
            vals = _parse_fields(payload, schema.fmt)
            rec = {}
            for i, lab in enumerate(schema.labels):
                if i < len(vals):
                    rec[lab] = vals[i]
            messages.append((schema.name, rec))
        pos += _HEADER_LEN + plen

    return messages


# ───────────────────────── 规则判断 ─────────────────────────

def _rule_battery(messages):
    vols, pcts = [], []
    for name, rec in messages:
        if name != "BAT":
            continue
        # 真实日志 BAT 电压字段名为 Volt（旧样本为 Vol），电量百分比为 RemPct（旧样本为 Pct）
        v = rec.get("Vol")
        if v is None:
            v = rec.get("Volt")
        if isinstance(v, (int, float)):
            vols.append(float(v))
        p = rec.get("Pct")
        if p is None:
            p = rec.get("RemPct")
        if isinstance(p, (int, float)):
            pcts.append(float(p))
    if not vols:
        return S_UNKNOWN, "日志中未找到电池电压字段，无法判断电量健康。"
    vmin = min(vols)
    th = SAFETY_THRESHOLDS["battery"]
    if vmin < th["vol_min_danger_v"]:
        return S_DANGER, f"电池最低电压 {vmin:.2f}V 过低，存在放电风险，禁止起飞。"
    if vmin < th["vol_min_inspect_v"] or (pcts and min(pcts) < th["pct_min_inspect"]):
        return S_INSPECT, f"电池最低电压 {vmin:.2f}V 偏低，建议充满后再飞。"
    return S_NORMAL, f"电池电压稳定（最低 {vmin:.2f}V），电量充足。"


def _rule_vibration(messages):
    peaks = []
    clip = False
    for name, rec in messages:
        if name != "VIBE":
            continue
        for ax in ("VibeX", "VibeY", "VibeZ"):
            if ax in rec and isinstance(rec[ax], (int, float)):
                peaks.append(abs(float(rec[ax])))
        if "Clip" in rec and float(rec["Clip"]) > 0:
            clip = True
    if not peaks:
        return S_UNKNOWN, "日志中未找到振动字段，无法判断机体振动。"
    vmax = max(peaks)
    th = SAFETY_THRESHOLDS["vibe"]
    if clip or vmax > th["max_danger"]:
        return S_DANGER, f"机体振动峰值 {vmax:.2f} 过高或发生 clipping，检查桨叶/马达/机架。"
    if vmax > th["max_inspect"]:
        return S_INSPECT, f"机体振动峰值 {vmax:.2f} 偏高，建议检查桨叶动平衡与机架松动。"
    return S_NORMAL, f"机体振动正常（峰值 {vmax:.2f}）。"


def _rule_gps(messages):
    sats, hdops = [], []
    for name, rec in messages:
        if name not in ("GPS", "GPS2"):
            continue
        if "NSats" in rec and isinstance(rec["NSats"], (int, float)):
            sats.append(float(rec["NSats"]))
        elif "Sat" in rec and isinstance(rec["Sat"], (int, float)):
            sats.append(float(rec["Sat"]))
        if "HDop" in rec and isinstance(rec["HDop"], (int, float)):
            hdops.append(float(rec["HDop"]))
    if not sats:
        return S_UNKNOWN, "日志中未找到 GPS 卫星数，无法判断定位健康。"
    smin = min(sats)
    th = SAFETY_THRESHOLDS["gps"]
    if smin < th["sats_min_danger"]:
        return S_DANGER, f"GPS 卫星数最低仅 {int(smin)} 颗，定位不可靠，禁止依赖定高/返航。"
    if smin < th["sats_min_inspect"] or (hdops and max(hdops) > th["hdop_max_inspect"]):
        return S_INSPECT, f"GPS 卫星数偏低（最低 {int(smin)} 颗），悬停/返航前确认定位稳定。"
    return S_NORMAL, f"GPS 定位正常（最少 {int(smin)} 颗星）。"


def _rule_attitude(messages):
    errs = []
    for name, rec in messages:
        if name != "ATT":
            continue
        for d, a in (("DesRoll", "Roll"), ("DesPitch", "Pitch"), ("DesYaw", "Yaw")):
            if d in rec and a in rec:
                try:
                    errs.append(abs(float(rec[a]) - float(rec[d])))
                except (TypeError, ValueError):
                    pass
    if not errs:
        return S_UNKNOWN, "日志中未找到姿态跟踪字段，无法判断姿态控制。"
    emax = max(errs)
    th = SAFETY_THRESHOLDS["attitude"]
    if emax > th["err_danger_deg"]:
        return S_DANGER, f"姿态指令跟踪误差最大 {emax:.1f}°，控制异常，需检修。"
    if emax > th["err_inspect_deg"]:
        return S_INSPECT, f"姿态指令跟踪误差 {emax:.1f}° 偏大，建议校准与检查。"
    return S_NORMAL, f"姿态控制跟踪良好（最大误差 {emax:.1f}°）。"


# ── 2026-10-16 新增：补齐原本恒 UNKNOWN 的四张卡（规则语义与教师诊断主机一致）──

def _rule_motor(messages):
    """01 动力健康：RCOU 四通道电机输出命令均衡度。

    原 CARD_DEFS 误用 _rule_battery（动力卡看电池电压）；本规则对齐教师诊断主机
    basic_rules.py 的 MOTOR 规则（平均命令极差 > 200 → 检查）。
    """
    sums = {ch: 0.0 for ch in ("C1", "C2", "C3", "C4")}
    counts = {ch: 0 for ch in ("C1", "C2", "C3", "C4")}
    for name, rec in messages:
        if name != "RCOU":
            continue
        for ch in sums:
            v = rec.get(ch)
            if isinstance(v, (int, float)):
                sums[ch] += float(v)
                counts[ch] += 1
    if min(counts.values()) == 0:
        return S_UNKNOWN, "缺少 RCOU 电机输出命令记录，无法判断动力输出是否均衡。"
    avgs = {ch: sums[ch] / counts[ch] for ch in sums}
    spread = max(avgs.values()) - min(avgs.values())
    th = SAFETY_THRESHOLDS["motor"]["spread_max_inspect"]
    detail = " / ".join(f"{ch}≈{v:.0f}" for ch, v in avgs.items())
    if spread > th:
        return S_INSPECT, (
            f"四路电机输出命令差值达 {spread:.0f}（{detail}），动力输出不均衡，"
            "飞控可能在持续补偿某一侧，建议检查桨叶、马达与电调。"
        )
    return S_NORMAL, f"四路电机输出命令均衡（最大差值 {spread:.0f}，{detail}）。"


def _rule_rc(messages):
    """05 遥控信号：RCIN 四通道 PWM 是否全程落在正常带内。"""
    chans = {ch: [] for ch in ("C1", "C2", "C3", "C4")}
    for name, rec in messages:
        if name != "RCIN":
            continue
        for ch in chans:
            v = rec.get(ch)
            if isinstance(v, (int, float)):
                chans[ch].append(float(v))
    if not any(chans.values()):
        return S_UNKNOWN, "缺少 RCIN 遥控输入通道记录，无法判断遥控信号。"
    th = SAFETY_THRESHOLDS["rc"]
    out_of_range = []
    for ch, vals in chans.items():
        if vals and (min(vals) < th["min_normal"] or max(vals) > th["max_normal"]):
            out_of_range.append(f"{ch}（{min(vals):.0f}~{max(vals):.0f}）")
    if out_of_range:
        return S_INSPECT, (
            f"遥控通道数值越出正常带（{th['min_normal']:.0f}~{th['max_normal']:.0f}）："
            f"{'、'.join(out_of_range)}，可能触发失控保护或存在信号干扰。"
        )
    return S_NORMAL, "遥控输入四通道全程处于正常范围，未见失控保护触发迹象。"


def _rule_mode(messages):
    """06 飞行模式：MODE 记录存在且模式编号有效。"""
    modes = []
    for name, rec in messages:
        if name != "MODE":
            continue
        mn = rec.get("ModeNum")
        if mn is None:
            mn = rec.get("Mode")
        if isinstance(mn, (int, float)):
            modes.append(int(mn))
    if not modes:
        return S_UNKNOWN, "缺少 MODE 飞行模式记录，无法判断飞行模式使用情况。"
    bad = [m for m in modes if m < 0 or m > 30]
    if bad:
        return S_INSPECT, f"飞行模式编号出现无效值（{bad[:3]}），日志可能不完整，请教师复核。"
    distinct = sorted(set(modes))
    return S_NORMAL, (
        f"飞行模式记录正常（共 {len(modes)} 次模式记录，使用 {len(distinct)} 种模式）。"
    )


def _rule_altitude(messages):
    """07 高度控制：BARO 气压高度与 CTUN 飞控定高交叉核对。"""
    baro, ctun = [], []
    for name, rec in messages:
        if name == "BARO" and isinstance(rec.get("Alt"), (int, float)):
            baro.append(float(rec["Alt"]))
        if name == "CTUN" and isinstance(rec.get("Alt"), (int, float)):
            ctun.append(float(rec["Alt"]))
    if not baro or not ctun:
        missing = "BARO 气压高度" if not baro else "CTUN 飞控定高"
        return S_UNKNOWN, f"缺少 {missing} 数据，无法交叉验证高度控制。"
    import statistics
    diff = abs(statistics.median(baro) - statistics.median(ctun))
    th = SAFETY_THRESHOLDS["altitude"]["cross_check_max_inspect_m"]
    if diff > th:
        return S_INSPECT, (
            f"气压高度与飞控定高偏差达 {diff:.1f}m（阈值 {th:.0f}m），"
            "高度数据来源不一致，可能气压计或定高异常，请教师复核。"
        )
    return S_NORMAL, f"气压高度与飞控定高一致（偏差 {diff:.1f}m），高度控制正常。"


# 学员端固定 8 张健康卡：与前端 health_cards_grid 的 id 一一对应
# 2026-10-16：propulsion 由误挂的 _rule_battery 改为 _rule_motor（动力看电机输出命令，
# 与教师诊断主机 MOTOR 规则一致）；rc-signal / flight-mode / altitude 补齐真实规则。
CARD_DEFS = [
    ("propulsion", "01 动力健康", _rule_motor),
    ("battery", "02 电池健康", _rule_battery),
    ("gps", "03 定位健康", _rule_gps),
    ("stability", "04 姿态稳定", _rule_attitude),
    ("rc-signal", "05 遥控信号", _rule_rc),
    ("flight-mode", "06 飞行模式", _rule_mode),
    ("altitude", "07 高度控制", _rule_altitude),
    ("sensors", "08 传感器", _rule_vibration),
]

_SEVERITY = {S_UNKNOWN: 0, S_NORMAL: 1, S_INSPECT: 2, S_DANGER: 3}


# ── 八卡统一 API 契约（2026-10-16）──────────────────────────────────────────
# 每张卡固定输出：card_id / title / status / display_status / main_finding /
# next_action / rule_id / missing_reason（UNKNOWN 时）；evidence 供教师层查核。
# next_action 文案与教师诊断主机 result_views.py 的八卡文案保持一致。
CARD_CONTRACT = {
    "propulsion": {"rule_id": "MOT-01", "next_action": "先检查桨叶，再检查马达、电调、接线和重心。", "required": ("RCOU",)},
    "battery": {"rule_id": "BAT-01", "next_action": "确认电池节数、电量、电源模块校准和接线。", "required": ("BAT",)},
    "gps": {"rule_id": "GPS-01", "next_action": "到开阔区域复测，并由教师查看定位证据。", "required": ("GPS", "GPS2")},
    "stability": {"rule_id": "ATT-01", "next_action": "先检查桨叶、紧固件、马达和飞控减震，再进行低空复测。", "required": ("ATT",)},
    "rc-signal": {"rule_id": "RC-01", "next_action": "请老师协助检查遥控器、接收机及天线。", "required": ("RCIN",)},
    "flight-mode": {"rule_id": "MODE-01", "next_action": "请老师协助确认当时的操作条件与飞行模式记录。", "required": ("MODE",)},
    "altitude": {"rule_id": "ALT-01", "next_action": "由教师结合定高相关证据复核。", "required": ("BARO", "CTUN")},
    "sensors": {"rule_id": "VIB-01", "next_action": "请老师协助查看传感器与状态估计证据。", "required": ("VIBE",)},
}


def _card_evidence(card_id: str, messages):
    """教师查核证据：该卡判断依据的原始字段与实测数值（学员视图不可见）。"""
    ev = {}
    if card_id == "propulsion":
        sums, counts = {}, {}
        for name, rec in messages:
            if name != "RCOU":
                continue
            for ch in ("C1", "C2", "C3", "C4"):
                v = rec.get(ch)
                if isinstance(v, (int, float)):
                    sums[ch] = sums.get(ch, 0.0) + float(v)
                    counts[ch] = counts.get(ch, 0) + 1
        if counts:
            ev["channel_avg"] = {ch: round(sums[ch] / counts[ch], 1) for ch in sums}
            ev["spread"] = round(max(ev["channel_avg"].values()) - min(ev["channel_avg"].values()), 1)
    elif card_id == "battery":
        vols = []
        pcts = []
        for n, r in messages:
            if n != "BAT":
                continue
            v = r.get("Vol")
            if v is None:
                v = r.get("Volt")
            if isinstance(v, (int, float)):
                vols.append(float(v))
            p = r.get("Pct")
            if p is None:
                p = r.get("RemPct")
            if isinstance(p, (int, float)):
                pcts.append(float(p))
        if vols:
            ev["volt_min"] = round(min(vols), 3)
            ev["volt_max"] = round(max(vols), 3)
        if pcts:
            ev["pct_min"] = round(min(pcts), 1)
    elif card_id == "gps":
        sats = [float(r["NSats"]) for n, r in messages if n in ("GPS", "GPS2") and isinstance(r.get("NSats"), (int, float))]
        hdops = [float(r["HDop"]) for n, r in messages if n in ("GPS", "GPS2") and isinstance(r.get("HDop"), (int, float))]
        if sats:
            ev["sats_min"] = int(min(sats))
        if hdops:
            ev["hdop_max"] = round(max(hdops), 2)
    elif card_id == "stability":
        errs = []
        for n, r in messages:
            if n != "ATT":
                continue
            for d, a in (("DesRoll", "Roll"), ("DesPitch", "Pitch"), ("DesYaw", "Yaw")):
                if d in r and a in r:
                    try:
                        errs.append(abs(float(r[a]) - float(r[d])))
                    except (TypeError, ValueError):
                        pass
        if errs:
            ev["att_err_max_deg"] = round(max(errs), 2)
    elif card_id == "rc-signal":
        chans = {}
        for n, r in messages:
            if n != "RCIN":
                continue
            for ch in ("C1", "C2", "C3", "C4"):
                v = r.get(ch)
                if isinstance(v, (int, float)):
                    chans.setdefault(ch, []).append(float(v))
        if chans:
            ev["channel_range"] = {ch: [round(min(v)), round(max(v))] for ch, v in chans.items()}
    elif card_id == "flight-mode":
        modes = [int(r["ModeNum"]) for n, r in messages if n == "MODE" and isinstance(r.get("ModeNum"), (int, float))]
        if modes:
            ev["mode_records"] = len(modes)
            ev["distinct_modes"] = sorted(set(modes))
    elif card_id == "altitude":
        baro = [float(r["Alt"]) for n, r in messages if n == "BARO" and isinstance(r.get("Alt"), (int, float))]
        ctun = [float(r["Alt"]) for n, r in messages if n == "CTUN" and isinstance(r.get("Alt"), (int, float))]
        if baro and ctun:
            import statistics
            ev["baro_median_m"] = round(statistics.median(baro), 2)
            ev["ctun_median_m"] = round(statistics.median(ctun), 2)
            ev["cross_diff_m"] = round(abs(ev["baro_median_m"] - ev["ctun_median_m"]), 2)
    elif card_id == "sensors":
        peaks = [abs(float(r[ax])) for n, r in messages if n == "VIBE"
                 for ax in ("VibeX", "VibeY", "VibeZ") if isinstance(r.get(ax), (int, float))]
        clips = sum(1 for n, r in messages if n == "VIBE" and float(r.get("Clip", 0) or 0) > 0)
        if peaks:
            ev["vibe_peak_max"] = round(max(peaks), 3)
        ev["clip_count"] = clips
    return ev


def analyze(file_bytes: bytes, filename: str = "", aircraft_name: str = "", training_task: str = ""):
    """对 .bin 日志做真实解析与规则判断。

    返回与前端 student_view 对齐的结构化结果（八卡统一契约）。
    安全约束：绝不返回伪造结果；数据不足时对应卡为 UNKNOWN 并说明缺哪项数据。
    """
    messages = parse_bin_log(file_bytes)

    def _card(cid, title, status, finding):
        """统一八卡契约：无论 status 如何，字段齐全、绝不出现 undefined。"""
        contract = CARD_CONTRACT[cid]
        ev = _card_evidence(cid, messages)
        found = sorted({n for n, _ in messages if n in contract["required"]})
        card = {
            "card_id": cid,
            "title": title,
            "status": status,
            "display_status": _STATUS_META[status]["display"],
            "main_finding": finding,
            "next_action": contract["next_action"],
            "rule_id": contract["rule_id"],
            "evidence": ev,
            "evidence_found_types": found,
        }
        if status == S_UNKNOWN:
            missing = [t for t in contract["required"] if t not in found]
            card["missing_reason"] = (
                f"本次日志中未找到 {'、'.join(missing)} 数据" if missing
                else "该卡所需字段在日志中记录不完整"
            )
        return card

    if not messages:
        return {
            "overall_status": S_UNKNOWN,
            "display_status": "无法判断",
            "main_finding": "未能从日志解析出任何有效数据，请确认文件为完整的 ArduPilot DataFlash .bin。",
            "next_action": "重新导出飞行日志，或联系教师确认日志来源。",
            "health_cards": [_card(cid, title, S_UNKNOWN, "数据缺失，无法判断。") for cid, title, _ in CARD_DEFS],
            "engine": "builtin_rule_engine",
            "parsed_message_count": 0,
        }

    cards = []
    worst = S_NORMAL
    for cid, title, rule in CARD_DEFS:
        status, finding = rule(messages)
        worst = worst if _SEVERITY[worst] >= _SEVERITY[status] else status
        cards.append(_card(cid, title, status, finding))

    # 全部卡片均无法判断时，整体不得报「良好」（避免把无数据说成健康）
    if all(c["status"] == S_UNKNOWN for c in cards):
        worst = S_UNKNOWN

    overall = worst
    return {
        "overall_status": overall,
        "display_status": _STATUS_META[overall]["display"],
        "main_finding": _overall_finding(overall, cards, messages),
        "next_action": _next_action(overall),
        "health_cards": cards,
        "engine": "builtin_rule_engine",
        "engine_display": "系统标准规则",
        "parsed_message_count": len(messages),
    }


def _overall_finding(overall, cards, messages):
    if overall == S_DANGER:
        danger = [c["title"] for c in cards if c["status"] == S_DANGER]
        return f"检测到危险项：{', '.join(danger)}。请先排除后再考虑起飞。"
    if overall == S_INSPECT:
        insp = [c["title"] for c in cards if c["status"] == S_INSPECT]
        return f"存在需检查项：{', '.join(insp)}。建议按提示排查后再飞。"
    if overall == S_NORMAL:
        return "整体飞行健康状态良好，未见明显隐患。"
    return "部分数据缺失，无法完整判断，建议结合教师端专业资料层复核。"


def _next_action(overall):
    if overall == S_DANGER:
        return "先处理危险项，确认无误后再重新体检。"
    if overall == S_INSPECT:
        return "按提示依次排查动力/电池/定位/振动，再重新体检。"
    if overall == S_NORMAL:
        return "可进行下一步手感回饋与教师复校。"
    return "补充完整日志后重新体检。"


if __name__ == "__main__":
    import sys, json
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if not path:
        print("usage: python builtin_rule_engine.py <log.bin>")
        sys.exit(2)
    with open(path, "rb") as f:
        result = analyze(f.read(), filename=path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
