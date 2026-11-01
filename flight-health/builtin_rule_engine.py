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

import bisect
import math
import statistics
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

# 四色语义（学员端：🔴 危险不建议飞行 / 🟠 需要检查 / 🟢 健康 / ⚪ 未检测≠正常）
S_NORMAL = "normal"
S_INSPECT = "inspect"
S_DANGER = "danger"
S_UNKNOWN = "unknown"

_STATUS_META = {
    S_NORMAL: {"display": "健康", "icon": "🟢"},
    S_INSPECT: {"display": "需要檢查", "icon": "🟠"},
    S_DANGER: {"display": "危險，不建議飛行", "icon": "🔴"},
    S_UNKNOWN: {"display": "未檢測", "icon": "⚪"},
}


# ───────────────────────── 参考安全阈值（可审阅 / 可调整） ─────────────────────────
# 2026-11-01 八卡改版：按真实飞控日志实务重排为
#   电池与供电 / 马达输出 / 振动 / 姿态追踪 / 事件与失效保护 / GPS / 罗盘 / EKF。
# 阈值参考 ArduPilot 官方 LogAnalyzer 与 Wiki（振动、磁干扰、EKF 失效保护默认值等），
# 是「起始值」，教师可用本校真实日志再校正。
# 判定只看「真正在空中」的时段，且超标需持续 sustain_s 秒才算，单一尖峰不算。
SAFETY_THRESHOLDS = {
    "flight": {
        "airborne_throttle_frac": 0.25,  # 四路马达平均输出超过 PWM 行程 25% 视为在空中
        "takeoff_ignore_s": 2.0,         # 起飞后前 2 秒不评估（起飞瞬态）
        "landing_ignore_s": 1.0,         # 降落前 1 秒不评估
    },
    "sustain_s": 1.0,                    # 超标需持续 ≥1 秒才计入
    "battery": {
        "cell_inspect_v": 3.5,           # 带载单片最低 < 3.5V → 需要检查
        "cell_danger_v": 3.3,            # 带载单片最低 < 3.3V → 危险
        "cell_full_v": 4.25,             # 用于由最高电压估算电芯数
        "vcc_danger_v": 4.6,             # 飞控供电 Vcc 最低 < 4.6V → 危险
        "vcc_swing_inspect_v": 0.15,     # 飞控供电波动 > 0.15V → 需要检查
    },
    "motor": {
        "spread_inspect_us": 75.0,       # 四路马达平均输出差 > 75µs → 需要检查
        "spread_danger_us": 150.0,       # > 150µs → 危险
        "saturation_frac": 0.95,         # 输出达 PWM 行程 95% 视为顶到最大（饱和）
        "hover_inspect_frac": 0.60,      # 悬停油门 > 60% → 机体偏重 / 动力不足
        "yaw_pair_inspect_us": 50.0,     # 对角两组马达平均差 > 50µs → 偏航不平衡
    },
    "vibe": {
        "inspect": 30.0,                 # VIBE m/s² > 30 → 需要检查
        "danger": 60.0,                  # > 60 → 危险
    },
    "attitude": {
        "err_inspect_deg": 5.0,          # 实际与期望姿态差 > 5° → 需要检查
        "err_danger_deg": 10.0,          # > 10° → 危险
    },
    "gps": {
        "sats_inspect": 8,
        "sats_danger": 6,
        "hdop_inspect": 1.4,
        "hdop_danger": 2.0,
    },
    "compass": {
        "interf_inspect_pct": 30.0,      # 磁干扰（油门 0→100% 外推）> 30% → 需要检查
        "interf_danger_pct": 60.0,       # > 60% → 危险
        "field_min": 120.0,              # 磁场强度合理范围（mGauss）
        "field_max": 600.0,
        "min_throttle_span": 0.10,       # 油门变化不足 10% 时无法估算磁干扰
    },
    "ekf": {
        "var_inspect": 0.5,              # EKF 方差 > 0.5 → 需要检查
        "var_danger": 0.8,               # ≥ 0.8（ArduPilot FS_EKF_THRESH 默认）→ 危险
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


# ───────────────────────── 飞行时段与通用工具 ─────────────────────────

# ArduCopter 需要 GPS 的飞行模式编号（Loiter / RTL / Auto / PosHold 等）
GPS_MODES = {3, 4, 5, 6, 7, 11, 16, 17, 18, 19, 21, 23, 24, 27}

# ArduCopter ERR 子系统（Subsys）中文名；ECode=0 代表「已恢复」，不计入
ERR_SUBSYS = {
    1: "主程式", 2: "遙控接收", 3: "羅盤", 4: "光流", 5: "遙控失效保護", 6: "電池失效保護",
    7: "GPS 失效保護", 8: "地面站失效保護", 9: "電子圍欄", 10: "飛行模式切換", 11: "GPS",
    12: "墜機偵測", 13: "翻滾", 14: "自動調參", 15: "降落傘", 16: "EKF 檢查",
    17: "EKF 失效保護", 18: "氣壓計", 19: "CPU", 20: "ADSB 失效保護", 21: "地形",
    22: "導航", 23: "地形失效保護", 24: "EKF 主核心切換", 25: "推力不足", 26: "感測器失效保護",
    27: "漏水失效保護", 28: "遙控輸入", 29: "振動失效保護", 30: "內部錯誤", 31: "航位推算失效保護",
}
# 出现即视为危险的子系统（失效保护 / 坠机 / 推力不足 / 内部错误）
ERR_DANGER = {5, 6, 7, 8, 12, 17, 25, 26, 29, 30, 31}


def _num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(float(v)) else None


def _fmt_t(t):
    return f"第 {t:.0f} 秒" if t is not None else "時間未知"


class _Ctx:
    """一次分析的共享上下文：按消息名分组、参数、PWM 行程、飞行时段。"""

    def __init__(self, messages):
        self.by = {}
        for name, rec in messages:
            self.by.setdefault(name, []).append(rec)
        times = [_num(r.get("TimeUS")) for _, r in messages]
        times = [t for t in times if t is not None and t > 0]
        self.t0 = min(times) if times else 0.0

        self.params = {}
        for rec in self.by.get("PARM", []):
            n, v = rec.get("Name"), _num(rec.get("Value"))
            if isinstance(n, str) and v is not None:
                self.params[n] = v
        pmin = self.params.get("MOT_PWM_MIN") or self.params.get("RC3_MIN") or 1000.0
        pmax = self.params.get("MOT_PWM_MAX") or self.params.get("RC3_MAX") or 2000.0
        if pmax - pmin < 200:
            pmin, pmax = 1000.0, 2000.0
        self.pwm_min, self.pwm_max = pmin, pmax

        # 马达输出时间序列（只取 C1~C4，Quad-X）
        self.rcou = []
        for rec in self.by.get("RCOU", []):
            t = self.t(rec)
            ch = [_num(rec.get(f"C{i}")) for i in range(1, 5)]
            if t is not None and all(c is not None for c in ch):
                self.rcou.append((t, ch))
        self.rcou.sort(key=lambda x: x[0])
        self._rcou_t = [t for t, _ in self.rcou]

        # 在空中的时段：四路平均输出超过行程 25%
        th = pmin + SAFETY_THRESHOLDS["flight"]["airborne_throttle_frac"] * (pmax - pmin)
        self.segments = []
        start = prev = None
        for t, ch in self.rcou:
            flying = sum(ch) / 4 > th
            if flying and start is None:
                start = t
            if not flying and start is not None:
                self.segments.append((start, prev))
                start = None
            prev = t
        self.ended_in_air = start is not None
        if start is not None:
            self.segments.append((start, prev))
        self.has_flight = bool(self.segments)
        fl = SAFETY_THRESHOLDS["flight"]
        self.trimmed = [(a + fl["takeoff_ignore_s"], b - fl["landing_ignore_s"])
                        for a, b in self.segments if b - a > fl["takeoff_ignore_s"] + fl["landing_ignore_s"]]
        self.flight_seconds = sum(b - a for a, b in self.segments)

    def t(self, rec):
        v = _num(rec.get("TimeUS"))
        return (v - self.t0) / 1e6 if v is not None else None

    def airborne(self, t, trimmed=True):
        """t 是否在空中；未侦测到飞行时（无 RCOU）退回全程评估。"""
        if not self.rcou:
            return True
        segs = self.trimmed if trimmed and self.trimmed else self.segments
        return any(a <= t <= b for a, b in segs)

    def throttle_at(self, t):
        if not self.rcou:
            return None
        i = max(0, bisect.bisect_right(self._rcou_t, t) - 1)
        avg = sum(self.rcou[i][1]) / 4
        return (avg - self.pwm_min) / (self.pwm_max - self.pwm_min)

    def series(self, name, getter, trimmed=True, names=None):
        """取 (t, value) 序列，只保留在空中的样本。"""
        out = []
        for n in (names or (name,)):
            for rec in self.by.get(n, []):
                t = self.t(rec)
                v = getter(rec)
                if t is None or v is None:
                    continue
                if self.airborne(t, trimmed):
                    out.append((t, v))
        out.sort(key=lambda x: x[0])
        return out

    def scope_note(self):
        if not self.rcou:
            return "（無馬達輸出紀錄，以全程資料評估）"
        return ""


def _sustained(series, pred, min_s=None, max_gap=2.0):
    """最长「连续满足 pred」的持续时间（秒）与起点时间。单一尖峰持续 0 秒。"""
    min_s = SAFETY_THRESHOLDS["sustain_s"] if min_s is None else min_s
    best, best_t, start, prev = -1.0, None, None, None
    for t, v in series:
        if prev is not None and t - prev > max_gap:
            start = None
        if pred(v):
            if start is None:
                start = t
            if t - start > best:
                best, best_t = t - start, start
        else:
            start = None
        prev = t
    return best >= min_s, max(best, 0.0), best_t


def _result(status, finding, metric="", evidence=None, action=None, missing=None):
    return {"status": status, "finding": finding, "metric": metric,
            "evidence": evidence or {}, "action": action, "missing": missing}


def _unknown(missing, finding=None):
    return _result(S_UNKNOWN, finding or f"本次日誌{missing}，這一項未檢測。未檢測不代表正常。",
                   metric="未檢測", missing=missing)


# ───────────────────────── 八项规则 ─────────────────────────

def _rule_battery(ctx):
    """01 电池与供电：带载最低单片电压 + 飞控 Vcc。"""
    th = SAFETY_THRESHOLDS["battery"]
    get_v = lambda r: _num(r.get("Volt")) if r.get("Volt") is not None else _num(r.get("Vol"))
    all_v = [get_v(r) for r in ctx.by.get("BAT", []) + ctx.by.get("CURR", [])]
    all_v = [v for v in all_v if v is not None and v > 0.5]
    if not all_v:
        return _unknown("沒有電池電壓（BAT）紀錄，通常是沒接電源模組或沒設定 BATT_MONITOR")

    vmax = max(all_v)
    mot_vmax = ctx.params.get("MOT_BAT_VOLT_MAX") or 0
    cells = round(mot_vmax / 4.2) if mot_vmax > 4 else max(1, math.ceil(vmax / th["cell_full_v"]))
    vs = ctx.series("BAT", get_v, trimmed=False, names=("BAT", "CURR"))
    vs = [(t, v) for t, v in vs if v > 0.5] or [(None, v) for v in all_v]
    t_min, v_min = min(vs, key=lambda x: x[1])
    cell_min = v_min / cells
    cell_series = [(t, v / cells) for t, v in vs if t is not None]
    danger, d_dur, d_t = _sustained(cell_series, lambda c: c < th["cell_danger_v"])
    inspect, _, _ = _sustained(cell_series, lambda c: c < th["cell_inspect_v"])

    ev = {"cells_estimated": cells, "volt_max": round(vmax, 2), "volt_min_in_flight": round(v_min, 2),
          "cell_min_v": round(cell_min, 3)}
    notes = []
    status = S_NORMAL
    if danger:
        status = S_DANGER
        notes.append(f"帶載時單片電壓低於 {th['cell_danger_v']}V 持續 {d_dur:.1f} 秒（{_fmt_t(d_t)}），電池已過放")
    elif inspect:
        status = S_INSPECT
        notes.append(f"帶載時單片電壓低於 {th['cell_inspect_v']}V，電量偏低或電池老化")

    vcc = ctx.series("POWR", lambda r: _num(r.get("Vcc")), trimmed=False)
    if vcc:
        vmin_cc = min(v for _, v in vcc)
        swing = max(v for _, v in vcc) - vmin_cc
        ev.update({"vcc_min": round(vmin_cc, 3), "vcc_swing": round(swing, 3)})
        if vmin_cc < th["vcc_danger_v"]:
            status = S_DANGER
            notes.append(f"飛控供電最低 {vmin_cc:.2f}V，有斷電重啟風險")
        elif swing > th["vcc_swing_inspect_v"] and status == S_NORMAL:
            status = S_INSPECT
            notes.append(f"飛控供電波動 {swing:.2f}V，電源模組或接線可能不穩")

    metric = f"最低 {cell_min:.2f}V/片（{cells}S 共 {v_min:.1f}V）· {_fmt_t(t_min)}"
    if vcc:
        metric += f" · 飛控 {ev['vcc_min']:.2f}V"
    if status == S_NORMAL:
        finding = f"電池電壓正常，帶載最低 {cell_min:.2f}V/片{ctx.scope_note()}。"
    else:
        finding = "；".join(notes) + "。"
    return _result(status, finding, metric, ev,
                   action="充飽電再飛；檢查電池是否鼓包老化、電源模組與 XT60 接線，並確認電源模組已校準。")


def _rule_motor(ctx):
    """02 马达输出（电机）：四路输出均衡度、饱和、悬停油门、对角偏航不平衡。"""
    th = SAFETY_THRESHOLDS["motor"]
    if not ctx.rcou:
        return _unknown("沒有馬達輸出（RCOU）紀錄")
    if not ctx.has_flight:
        return _unknown("沒有偵測到起飛（馬達輸出一直未達飛行油門）")
    samples = [(t, ch) for t, ch in ctx.rcou if ctx.airborne(t)]
    if not samples:
        samples = [(t, ch) for t, ch in ctx.rcou if ctx.airborne(t, trimmed=False)]
    avgs = [sum(ch[i] for _, ch in samples) / len(samples) for i in range(4)]
    spread = max(avgs) - min(avgs)
    # 离其余三颗最远的那颗：偏低 = 其余在补偿它；偏高 = 它在多出力
    med = statistics.median(avgs)
    odd_i = max(range(4), key=lambda i: abs(avgs[i] - med))
    odd = odd_i + 1
    odd_desc = (f"M{odd} 一直在多出力" if avgs[odd_i] > med
                else f"M{odd} 輸出明顯偏低（其他馬達在幫它補償）")
    # ArduCopter Quad-X：M1、M2 为 CCW，M3、M4 为 CW
    yaw_diff = (avgs[0] + avgs[1]) / 2 - (avgs[2] + avgs[3]) / 2
    sat_level = ctx.pwm_min + th["saturation_frac"] * (ctx.pwm_max - ctx.pwm_min)
    sat = []
    for i in range(4):
        hit, dur, t = _sustained([(t, ch[i]) for t, ch in samples], lambda v: v >= sat_level)
        if hit:
            sat.append((i + 1, dur, t))
    hover = None
    thos = ctx.series("CTUN", lambda r: _num(r.get("ThO")))
    if thos:
        hover = statistics.median(v for _, v in thos)
    else:
        hover = statistics.median((sum(ch) / 4 - ctx.pwm_min) / (ctx.pwm_max - ctx.pwm_min) for _, ch in samples)

    ev = {"motor_avg": {f"M{i+1}": round(a) for i, a in enumerate(avgs)}, "spread_us": round(spread, 1),
          "yaw_pair_diff_us": round(yaw_diff, 1), "hover_throttle": round(hover, 3),
          "saturated": [f"M{m}" for m, _, _ in sat], "pwm_range": [ctx.pwm_min, ctx.pwm_max]}
    notes = []
    status = S_NORMAL
    if sat:
        status = S_DANGER
        m, dur, t = sat[0]
        notes.append(f"M{m} 輸出頂到最大持續 {dur:.1f} 秒（{_fmt_t(t)}），飛控已沒有餘力控制")
    if spread > th["spread_danger_us"]:
        status = S_DANGER
        notes.append(f"四顆馬達輸出相差 {spread:.0f}µs，{odd_desc}")
    elif spread > th["spread_inspect_us"]:
        status = S_DANGER if status == S_DANGER else S_INSPECT
        notes.append(f"四顆馬達輸出相差 {spread:.0f}µs，{odd_desc}")
    pair_split = (min(avgs[0], avgs[1]) > max(avgs[2], avgs[3])
                  or min(avgs[2], avgs[3]) > max(avgs[0], avgs[1]))
    if abs(yaw_diff) > th["yaw_pair_inspect_us"] and pair_split:
        status = S_DANGER if status == S_DANGER else S_INSPECT
        pair = "M1/M2（逆時針）" if yaw_diff > 0 else "M3/M4（順時針）"
        notes.append(f"對角 {pair} 一起偏高 {abs(yaw_diff):.0f}µs，可能馬達座歪或槳裝錯，造成偏航不平衡")
    if hover > th["hover_inspect_frac"]:
        status = S_DANGER if status == S_DANGER else S_INSPECT
        notes.append(f"懸停油門 {hover:.0%}，機體偏重或動力不足")

    detail = " / ".join(f"M{i+1} {a:.0f}" for i, a in enumerate(avgs))
    metric = f"{detail} · 差 {spread:.0f}µs · 懸停油門 {hover:.0%}"
    finding = ("；".join(notes) + "。") if notes else f"四顆馬達輸出平衡（最大差 {spread:.0f}µs），懸停油門 {hover:.0%}。"
    return _result(status, finding, metric, ev,
                   action=f"拆槳檢查 M{odd}：槳葉正反與裂痕、馬達軸與軸承、電調與焊點、馬達座是否歪斜，最後確認重心。")


def _rule_vibration(ctx):
    """03 振动：VIBE X/Y/Z（m/s²）与 Clip 计数增长。"""
    th = SAFETY_THRESHOLDS["vibe"]
    if not ctx.by.get("VIBE"):
        return _unknown("沒有振動（VIBE）紀錄")
    def peak(r):
        vals = [_num(r.get(a)) for a in ("VibeX", "VibeY", "VibeZ")]
        vals = [abs(v) for v in vals if v is not None]
        return max(vals) if vals else None

    vib = ctx.series("VIBE", peak)
    if not vib:
        return _unknown("在空中時段沒有振動數據")
    # Clip 为累计计数：同一 IMU 首尾差 > 0 即发生过削顶
    clip_growth = 0
    by_imu = {}
    for rec in ctx.by["VIBE"]:
        key = rec.get("IMU", 0)
        for f in ("Clip", "Clip0", "Clip1", "Clip2"):
            v = _num(rec.get(f))
            if v is not None:
                lo, hi = by_imu.get((key, f), (v, v))
                by_imu[(key, f)] = (min(lo, v), max(hi, v))
    clip_growth = int(sum(hi - lo for lo, hi in by_imu.values()))
    t_max, v_max = max(vib, key=lambda x: x[1])
    danger, d_dur, d_t = _sustained(vib, lambda v: v > th["danger"])
    inspect, i_dur, i_t = _sustained(vib, lambda v: v > th["inspect"])
    ev = {"vibe_max": round(v_max, 2), "vibe_median": round(statistics.median(v for _, v in vib), 2),
          "clip_growth": clip_growth}
    metric = f"最大 {v_max:.1f} m/s² · {_fmt_t(t_max)} · Clip +{clip_growth}"
    action = "檢查飛控減震墊、槳葉動平衡與裂痕、馬達螺絲與機架是否鬆動。"
    if clip_growth > 0:
        return _result(S_DANGER, f"加速度計發生削頂（Clip 增加 {clip_growth} 次），飛控讀到的數據失真，可能突然竄升或失控。",
                       metric, ev, action)
    if danger:
        return _result(S_DANGER, f"振動超過 {th['danger']:.0f} m/s² 持續 {d_dur:.1f} 秒（{_fmt_t(d_t)}），定高與定位會失準。",
                       metric, ev, action)
    if inspect:
        return _result(S_INSPECT, f"振動超過 {th['inspect']:.0f} m/s² 持續 {i_dur:.1f} 秒（{_fmt_t(i_t)}），建議處理後再飛。",
                       metric, ev, action)
    return _result(S_NORMAL, f"振動正常（最大 {v_max:.1f} m/s²，未發生削頂）{ctx.scope_note()}。", metric, ev, action)


def _rule_attitude(ctx):
    """04 姿态追踪：Roll/Pitch 实际 vs 期望（不看 Yaw，避免 0/360 跳变误判）。"""
    th = SAFETY_THRESHOLDS["attitude"]
    if not ctx.by.get("ATT"):
        return _unknown("沒有姿態（ATT）紀錄")

    def err(r):
        vals = []
        for d, a in (("DesRoll", "Roll"), ("DesPitch", "Pitch")):
            dv, av = _num(r.get(d)), _num(r.get(a))
            if dv is not None and av is not None:
                vals.append(abs(av - dv))
        return max(vals) if vals else None

    s = ctx.series("ATT", err)
    if not s:
        return _unknown("在空中時段沒有姿態追蹤數據")
    t_max, e_max = max(s, key=lambda x: x[1])
    danger, d_dur, d_t = _sustained(s, lambda v: v > th["err_danger_deg"])
    inspect, i_dur, i_t = _sustained(s, lambda v: v > th["err_inspect_deg"])
    ev = {"att_err_max_deg": round(e_max, 2), "att_err_median_deg": round(statistics.median(v for _, v in s), 2)}
    metric = f"最大偏差 {e_max:.1f}° · {_fmt_t(t_max)}"
    action = "先排除馬達、振動、槳葉問題，再做低空復測；仍不穩才請老師檢查 PID 參數。"
    if danger:
        return _result(S_DANGER, f"實際姿態和飛控想要的姿態差超過 {th['err_danger_deg']:.0f}° 持續 {d_dur:.1f} 秒（{_fmt_t(d_t)}），飛機控制不住。",
                       metric, ev, action)
    if inspect:
        return _result(S_INSPECT, f"姿態偏差超過 {th['err_inspect_deg']:.0f}° 持續 {i_dur:.1f} 秒（{_fmt_t(i_t)}），姿態跟不太上。",
                       metric, ev, action)
    return _result(S_NORMAL, f"姿態追蹤良好（最大偏差 {e_max:.1f}°）{ctx.scope_note()}。", metric, ev, action)


def _rule_events(ctx):
    """05 事件与失效保护：ERR 错误事件 + 日志是否在空中中断。"""
    events = []
    for rec in ctx.by.get("ERR", []):
        sub, code = _num(rec.get("Subsys")), _num(rec.get("ECode"))
        if sub is None or code is None or code == 0:
            continue
        events.append((ctx.t(rec), int(sub), int(code)))
    danger = [e for e in events if e[1] in ERR_DANGER or (e[1] == 16 and e[2] == 2)]
    other = [e for e in events if e not in danger]
    names = lambda es: "、".join(f"{ERR_SUBSYS.get(s, f'子系統{s}')}（{_fmt_t(t)}）" for t, s, _ in es[:4])
    ev = {"errors": [{"t_s": round(t, 1) if t is not None else None, "subsys": s,
                      "name": ERR_SUBSYS.get(s, ""), "ecode": c} for t, s, c in events],
          "ended_in_air": ctx.ended_in_air}
    metric = f"{len(events)} 個錯誤事件" + (" · 日誌在空中中斷" if ctx.ended_in_air else "")
    action = "把錯誤事件時間點對照其他卡片；失效保護或墜機事件一律先找老師確認再飛。"
    notes = []
    status = S_NORMAL
    if danger:
        status = S_DANGER
        notes.append(f"觸發 {names(danger)}")
    if ctx.ended_in_air:
        status = S_DANGER
        notes.append("日誌在馬達仍在飛行輸出時突然結束，可能是空中斷電或墜機")
    if other and status == S_NORMAL:
        status = S_INSPECT
    if other:
        notes.append(f"另有 {names(other)} 等錯誤紀錄")
    if status == S_NORMAL:
        extra = "" if ctx.rcou else "（無馬達輸出紀錄，無法檢查是否空中斷電）"
        return _result(S_NORMAL, f"沒有失效保護、墜機或錯誤事件{extra}。", metric, ev, action)
    return _result(status, "；".join(notes) + "。", metric, ev, action)


def _rule_gps(ctx):
    """06 GPS 定位：定位类型、卫星数、HDOP；严重度随飞行模式调整。"""
    th = SAFETY_THRESHOLDS["gps"]
    names = ("GPS", "GPS2")
    if not any(ctx.by.get(n) for n in names):
        return _unknown("沒有 GPS 紀錄")
    rows = ctx.series("GPS", lambda r: (_num(r.get("Status")), _num(r.get("NSats")), _num(r.get("HDop"))),
                      trimmed=False, names=names)
    rows = [(t, v) for t, v in rows if v[1] is not None]
    if not rows:
        return _unknown("在空中時段沒有 GPS 衛星數紀錄")
    modes = {int(m) for m in (_num(r.get("ModeNum")) if r.get("ModeNum") is not None else _num(r.get("Mode"))
                              for r in ctx.by.get("MODE", [])) if m is not None}
    gps_needed = bool(modes & GPS_MODES) or not modes

    def bad(v, sats, hdop):
        st, ns, hd = v
        return (st is not None and st < 3) or ns < sats or (hd is not None and hd > hdop)

    danger, d_dur, d_t = _sustained(rows, lambda v: bad(v, th["sats_danger"], th["hdop_danger"]))
    inspect, i_dur, i_t = _sustained(rows, lambda v: bad(v, th["sats_inspect"], th["hdop_inspect"]))
    sats_min = int(min(v[1] for _, v in rows))
    hdops = [v[2] for _, v in rows if v[2] is not None]
    hdop_max = max(hdops) if hdops else None
    ev = {"sats_min": sats_min, "hdop_max": round(hdop_max, 2) if hdop_max is not None else None,
          "modes_used": sorted(modes), "gps_mode_used": bool(modes & GPS_MODES)}
    metric = f"最少 {sats_min} 顆星" + (f" · HDOP 最高 {hdop_max:.1f}" if hdop_max is not None else "")
    action = "到開闊處等 GPS 穩定（10 顆星以上）再起飛；檢查 GPS 是否離電源線太近。"
    if danger:
        msg = f"定位品質不足（3D 定位丟失、衛星少於 {th['sats_danger']} 顆或 HDOP 高於 {th['hdop_danger']}）持續 {d_dur:.1f} 秒（{_fmt_t(d_t)}）"
        if gps_needed:
            return _result(S_DANGER, msg + "，定點與返航不可靠。", metric, ev, action)
        return _result(S_INSPECT, msg + "；本次只用了自穩/定高模式，暫列需要檢查，切勿使用定點或返航。", metric, ev, action)
    if inspect:
        return _result(S_INSPECT, f"定位品質偏弱持續 {i_dur:.1f} 秒（{_fmt_t(i_t)}），使用定點或返航前要確認。", metric, ev, action)
    return _result(S_NORMAL, f"GPS 定位穩定（最少 {sats_min} 顆星）。", metric, ev, action)


def _rule_compass(ctx):
    """07 罗盘 / 磁干扰：磁场强度范围 + 随油门变化（外推到 0→100% 油门）。"""
    th = SAFETY_THRESHOLDS["compass"]
    if not ctx.by.get("MAG"):
        return _unknown("沒有羅盤（MAG）紀錄")

    def field(r):
        if r.get("I") not in (None, 0):
            return None
        xs = [_num(r.get(a)) for a in ("MagX", "MagY", "MagZ")]
        return math.sqrt(sum(x * x for x in xs)) if all(x is not None for x in xs) else None

    s = ctx.series("MAG", field, trimmed=False)
    if not s:
        return _unknown("在空中時段沒有羅盤數據")
    f_med = statistics.median(v for _, v in s)
    ev = {"field_median_mGauss": round(f_med, 1)}
    status, notes = S_NORMAL, []
    if not th["field_min"] <= f_med <= th["field_max"]:
        status = S_INSPECT
        notes.append(f"磁場強度 {f_med:.0f} 超出合理範圍（{th['field_min']:.0f}~{th['field_max']:.0f}），可能沒校準或附近有鐵件")

    pairs = [(ctx.throttle_at(t), v) for t, v in s]
    pairs = [(a, b) for a, b in pairs if a is not None]
    interf = None
    if len(pairs) >= 8:
        thr = sorted(a for a, _ in pairs)
        lo_cut, hi_cut = thr[len(thr) // 4], thr[3 * len(thr) // 4]
        lo = [(a, b) for a, b in pairs if a <= lo_cut]
        hi = [(a, b) for a, b in pairs if a >= hi_cut]
        span = statistics.mean(a for a, _ in hi) - statistics.mean(a for a, _ in lo)
        if span >= th["min_throttle_span"]:
            f_lo = statistics.median(b for _, b in lo)
            f_hi = statistics.median(b for _, b in hi)
            interf = abs(f_hi - f_lo) / span / max(f_lo, 1.0) * 100
            ev["interference_pct"] = round(interf, 1)
    if interf is not None and interf > th["interf_danger_pct"]:
        status = S_DANGER
        notes.append(f"磁干擾約 {interf:.0f}%，羅盤被馬達電流嚴重干擾，可能繞圈或飛走")
    elif interf is not None and interf > th["interf_inspect_pct"]:
        status = S_DANGER if status == S_DANGER else S_INSPECT
        notes.append(f"磁干擾約 {interf:.0f}%，偏高")

    metric = f"磁場 {f_med:.0f} mG" + (f" · 磁干擾 {interf:.0f}%" if interf is not None else " · 油門變化不足，未估算磁干擾")
    action = "把 GPS 羅盤架高、遠離電源線與電調，確認箭頭朝機頭，再重做羅盤校準。"
    if notes:
        return _result(status, "；".join(notes) + "。", metric, ev, action)
    tail = "" if interf is not None else "（本次油門變化太小，磁干擾未估算）"
    return _result(S_NORMAL, f"羅盤磁場正常{tail}。", metric, ev, action)


def _rule_ekf(ctx):
    """08 EKF 位置估算：XKF4（EKF3）/ NKF4（EKF2）各项方差。"""
    th = SAFETY_THRESHOLDS["ekf"]
    names = ("XKF4", "NKF4")
    if not any(ctx.by.get(n) for n in names):
        return _unknown("沒有 EKF 方差（XKF4/NKF4）紀錄")

    def var(r):
        vals = [_num(r.get(k)) for k in ("SV", "SP", "SH", "SM", "SMX", "SVT")]
        vals = [abs(v) for v in vals if v is not None]
        return max(vals) if vals else None

    s = ctx.series("XKF4", var, trimmed=False, names=names)
    if not s:
        return _unknown("在空中時段沒有 EKF 方差數據")
    t_max, v_max = max(s, key=lambda x: x[1])
    danger, d_dur, d_t = _sustained(s, lambda v: v >= th["var_danger"])
    inspect, i_dur, i_t = _sustained(s, lambda v: v > th["var_inspect"])
    ev = {"variance_max": round(v_max, 3)}
    metric = f"方差最高 {v_max:.2f} · {_fmt_t(t_max)}"
    action = "EKF 多半是結果：先看振動、GPS、羅盤三張卡；三者都正常仍異常，請老師深入檢查。"
    if danger:
        return _result(S_DANGER, f"EKF 方差達 {th['var_danger']} 以上持續 {d_dur:.1f} 秒（{_fmt_t(d_t)}），飛控不確定自己在哪，會觸發 EKF 失效保護。",
                       metric, ev, action)
    if inspect:
        return _result(S_INSPECT, f"EKF 方差超過 {th['var_inspect']} 持續 {i_dur:.1f} 秒（{_fmt_t(i_t)}），感測器之間說法不一致。",
                       metric, ev, action)
    return _result(S_NORMAL, f"EKF 位置估算穩定（方差最高 {v_max:.2f}）。", metric, ev, action)


# 学员端固定 8 张健康卡（按优先级排序）：与前端 health-cards-grid 的 DOM id 一一对应。
# critical=True 为关键项：关键项「未检测」时，总结论不得显示健康。
CARD_DEFS = [
    ("battery", "01 電池與供電", "電池電壓（每片電芯）＋飛控供電", True, "BAT-01", _rule_battery),
    ("propulsion", "02 馬達輸出（電機）", "四顆馬達輸出平衡、飽和、懸停油門", True, "MOT-01", _rule_motor),
    ("vibration", "03 振動", "機體振動與加速度計削頂", True, "VIB-01", _rule_vibration),
    ("stability", "04 姿態追蹤", "實際姿態 vs 飛控期望姿態", True, "ATT-01", _rule_attitude),
    ("events", "05 事件與失效保護", "錯誤、失效保護、墜機、空中斷電", True, "EVT-01", _rule_events),
    ("gps", "06 GPS 定位", "定位類型、衛星數、HDOP（看飛行模式）", False, "GPS-01", _rule_gps),
    ("compass", "07 羅盤／磁干擾", "磁場強度與馬達電流干擾", False, "MAG-01", _rule_compass),
    ("ekf", "08 EKF 位置估算", "飛控「位置裁判」的方差", False, "EKF-01", _rule_ekf),
]

# 每卡读取的日志消息类型（教师抽屉「实际命中消息」）
CARD_SOURCES = {
    "battery": ("BAT", "CURR", "POWR"), "propulsion": ("RCOU", "CTUN", "PARM"), "vibration": ("VIBE",),
    "stability": ("ATT",), "events": ("ERR", "RCOU"), "gps": ("GPS", "GPS2", "MODE"),
    "compass": ("MAG", "RCOU"), "ekf": ("XKF4", "NKF4"),
}

_SEVERITY = {S_UNKNOWN: 0, S_NORMAL: 1, S_INSPECT: 2, S_DANGER: 3}
_NORMAL_ACTION = "按標準飛前檢查繼續觀察。"


def analyze(file_bytes: bytes, filename: str = "", aircraft_name: str = "", training_task: str = ""):
    """对 .bin 日志做真实解析与规则判断（八卡统一契约）。

    每卡输出：card_id / title / subtitle / critical / status / display_status /
    main_finding / metric / next_action / rule_id / evidence / missing_reason（UNKNOWN 时）。
    安全约束：绝不返回伪造结果；数据不足时对应卡为 UNKNOWN 并说明缺哪项数据。
    """
    messages = parse_bin_log(file_bytes)
    present = {n for n, _ in messages}

    def _card(cid, title, subtitle, critical, rule_id, res):
        status = res["status"]
        card = {
            "card_id": cid,
            "title": title,
            "subtitle": subtitle,
            "critical": critical,
            "status": status,
            "display_status": _STATUS_META[status]["display"],
            "main_finding": res["finding"],
            "metric": res["metric"],
            "next_action": _NORMAL_ACTION if status == S_NORMAL else (res["action"] or "請老師協助確認。"),
            "rule_id": rule_id,
            "evidence": res["evidence"],
            "evidence_found_types": sorted(n for n in CARD_SOURCES.get(cid, ()) if n in present),
        }
        if status == S_UNKNOWN:
            card["missing_reason"] = res["missing"] or "該卡所需欄位在日誌中記錄不完整"
            card["next_action"] = "下次飛行前確認飛控有記錄這項資料，再重新分析。"
        return card

    if not messages:
        return {
            "overall_status": S_UNKNOWN,
            "display_status": "無法判定",
            "main_finding": "未能從日誌解析出任何有效數據，請確認文件為完整的 ArduPilot DataFlash .bin。未檢測不代表正常。",
            "next_action": "重新導出飛行日誌，或聯繫教師確認日誌來源。",
            "health_cards": [_card(cid, t, sub, crit, rid, _unknown("無法解析"))
                             for cid, t, sub, crit, rid, _ in CARD_DEFS],
            "engine": "builtin_rule_engine",
            "parsed_message_count": 0,
        }

    ctx = _Ctx(messages)
    cards = []
    for cid, title, sub, crit, rid, rule in CARD_DEFS:
        try:
            res = rule(ctx)
        except Exception as exc:  # 单卡异常不得拖垮整份报告，也不得伪装成健康
            res = _unknown(f"分析這一項時發生錯誤（{type(exc).__name__}）")
        cards.append(_card(cid, title, sub, crit, rid, res))

    overall = _overall_status(cards)
    return {
        "overall_status": overall,
        "display_status": "無法判定" if overall == S_UNKNOWN else _STATUS_META[overall]["display"],
        "main_finding": _overall_finding(overall, cards),
        "next_action": _next_action(overall),
        "health_cards": cards,
        "flight_seconds": round(ctx.flight_seconds, 1),
        "engine": "builtin_rule_engine",
        "engine_display": "系統標準規則",
        "parsed_message_count": len(messages),
    }


def _overall_status(cards):
    """总结论：任一危险 → 危险；关键项未检测 → 无法判定；任一需检查 → 需要检查；否则健康。"""
    if any(c["status"] == S_DANGER for c in cards):
        return S_DANGER
    if any(c["critical"] and c["status"] == S_UNKNOWN for c in cards):
        return S_UNKNOWN
    if any(c["status"] == S_INSPECT for c in cards):
        return S_INSPECT
    return S_NORMAL


def _overall_finding(overall, cards):
    pick = lambda st, crit=None: [c["title"] for c in cards
                                  if c["status"] == st and (crit is None or c["critical"] == crit)]
    if overall == S_DANGER:
        return f"檢測到危險項：{'、'.join(pick(S_DANGER))}。不建議飛行，請先排除並由老師確認。"
    if overall == S_UNKNOWN:
        return f"關鍵項未檢測：{'、'.join(pick(S_UNKNOWN, True))}。未檢測不代表正常，無法給出健康結論。"
    gray = pick(S_UNKNOWN)
    tail = f"（{'、'.join(gray)} 未檢測，不代表正常）" if gray else ""
    if overall == S_INSPECT:
        return f"需要檢查：{'、'.join(pick(S_INSPECT))}。可以飛，但下次起飛前要先處理{tail}。"
    return f"本次日誌未發現異常{tail}。"


def _next_action(overall):
    if overall == S_DANGER:
        return "先處理紅色危險項，修好後重新飛一次並上傳新日誌確認。"
    if overall == S_UNKNOWN:
        return "補齊缺少的資料（例如接上電源模組、插好 SD 卡）後重新分析。"
    if overall == S_INSPECT:
        return "按橘色卡片的提示依序排查，再重新體檢。"
    return "可進行下一步手感回饋與教師複核。"


if __name__ == "__main__":
    import sys, json
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if not path:
        print("usage: python builtin_rule_engine.py <log.bin>")
        sys.exit(2)
    with open(path, "rb") as f:
        result = analyze(f.read(), filename=path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
