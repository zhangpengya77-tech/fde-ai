"""Betaflight / Cleanflight Blackbox（BBL / BFL）解碼器。

依公開的 Blackbox 日誌格式說明自行實作（未複製 GPL 原始碼）：
- 純文字標頭 ``H key:value``；
- 資料框 I / P / S / G / H / E，欄位以各自的 encoding + predictor 解碼；
- 一個檔案可含多段日誌（每段以 ``H Product:Blackbox`` 開頭）。

只支援 Data version 2（Betaflight 3.x 起的預設）。遇到損毀資料時會跳到下一個
合法框標記重新同步，並記錄損毀框數，不會靜默產生假資料。
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

import numpy as np

PRODUCT_MARKER = b"H Product:Blackbox flight data recorder"
FRAME_MARKERS = frozenset(b"IPESGH")

# encoding 代碼
ENC_SIGNED_VB = 0
ENC_UNSIGNED_VB = 1
ENC_NEG_14BIT = 3
ENC_TAG8_8SVB = 6
ENC_TAG2_3S32 = 7
ENC_TAG8_4S16 = 8
ENC_NULL = 9
ENC_TAG2_3SVARIABLE = 10

# 事件代碼
EVT_SYNC_BEEP = 0
EVT_INFLIGHT_ADJUSTMENT = 13
EVT_LOGGING_RESUME = 14
EVT_DISARM = 15
EVT_FLIGHT_MODE = 30
EVT_LOG_END = 255

# 相鄰 I 框之間可接受的最大時間跳躍（微秒）；超過視為重新同步時誤判的雜訊框
MAX_I_FRAME_GAP_US = 60_000_000


class BlackboxError(ValueError):
    """日誌無法解碼時拋出，訊息為給使用者看的中文說明。"""


def _sign_extend(value: int, bits: int) -> int:
    sign = 1 << (bits - 1)
    return (value & (sign - 1)) - (value & sign)


@dataclass
class FrameDef:
    names: list[str] = field(default_factory=list)
    signed: list[int] = field(default_factory=list)
    predictor: list[int] = field(default_factory=list)
    encoding: list[int] = field(default_factory=list)


@dataclass
class BlackboxLog:
    index: int
    headers: dict[str, str]
    main_fields: list[str]
    main: np.ndarray  # shape (n_frames, n_fields)，int64
    slow_fields: list[str]
    slow: list[tuple[int, list[int]]]  # (main frame index, values)
    gps_fields: list[str]
    gps: list[list[int]]
    events: list[dict]
    stats: dict

    def column(self, name: str) -> np.ndarray | None:
        try:
            return self.main[:, self.main_fields.index(name)]
        except ValueError:
            return None


class _Reader:
    __slots__ = ("data", "pos", "end")

    def __init__(self, data: bytes, pos: int, end: int) -> None:
        self.data = data
        self.pos = pos
        self.end = end

    def byte(self) -> int:
        if self.pos >= self.end:
            raise EOFError
        value = self.data[self.pos]
        self.pos += 1
        return value

    def uvb(self) -> int:
        result = 0
        shift = 0
        for _ in range(5):
            b = self.byte()
            result |= (b & 0x7F) << shift
            if b < 128:
                return result
            shift += 7
        raise ValueError("varint too long")

    def svb(self) -> int:
        u = self.uvb()
        return (u >> 1) ^ -(u & 1)

    def tag2_3s32(self) -> list[int]:
        lead = self.byte()
        kind = lead >> 6
        if kind == 0:
            return [_sign_extend((lead >> 4) & 3, 2), _sign_extend((lead >> 2) & 3, 2), _sign_extend(lead & 3, 2)]
        if kind == 1:
            v0 = _sign_extend(lead & 0x0F, 4)
            b = self.byte()
            return [v0, _sign_extend(b >> 4, 4), _sign_extend(b & 0x0F, 4)]
        if kind == 2:
            v0 = _sign_extend(lead & 0x3F, 6)
            b1 = self.byte()
            b2 = self.byte()
            return [v0, _sign_extend(b1 & 0x3F, 6), _sign_extend(b2 & 0x3F, 6)]
        return self._tag2_variable(lead)

    def _tag2_variable(self, lead: int) -> list[int]:
        values = []
        for i in range(3):
            sel = (lead >> (i * 2)) & 3
            if sel == 0:
                values.append(_sign_extend(self.byte(), 8))
            elif sel == 1:
                b0, b1 = self.byte(), self.byte()
                values.append(_sign_extend(b0 | (b1 << 8), 16))
            elif sel == 2:
                b0, b1, b2 = self.byte(), self.byte(), self.byte()
                values.append(_sign_extend(b0 | (b1 << 8) | (b2 << 16), 24))
            else:
                b0, b1, b2, b3 = self.byte(), self.byte(), self.byte(), self.byte()
                values.append(_sign_extend(b0 | (b1 << 8) | (b2 << 16) | (b3 << 24), 32))
        return values

    def tag2_3svariable(self) -> list[int]:
        lead = self.byte()
        kind = lead >> 6
        if kind == 0:
            return [_sign_extend((lead >> 4) & 3, 2), _sign_extend((lead >> 2) & 3, 2), _sign_extend(lead & 3, 2)]
        if kind == 1:
            b = self.byte()
            return [
                _sign_extend((lead & 0x3E) >> 1, 5),
                _sign_extend(((lead & 1) << 4) | (b >> 4), 5),
                _sign_extend(b & 0x0F, 4),
            ]
        if kind == 2:
            b1 = self.byte()
            b2 = self.byte()
            return [
                _sign_extend(((lead & 0x3F) << 2) | (b1 >> 6), 8),
                _sign_extend(((b1 & 0x3F) << 2) | (b2 >> 6), 8),
                _sign_extend(b2 & 0x7F, 7),
            ]
        return self._tag2_variable(lead)

    def tag8_4s16(self) -> list[int]:
        selector = self.byte()
        values = [0, 0, 0, 0]
        nibble = 0
        buffer = 0
        for i in range(4):
            kind = selector & 3
            if kind == 1:
                if nibble == 0:
                    buffer = self.byte()
                    values[i] = _sign_extend(buffer >> 4, 4)
                    nibble = 1
                else:
                    values[i] = _sign_extend(buffer & 0x0F, 4)
                    nibble = 0
            elif kind == 2:
                if nibble == 0:
                    values[i] = _sign_extend(self.byte(), 8)
                else:
                    c = (buffer << 4) & 0xFF
                    buffer = self.byte()
                    c |= buffer >> 4
                    values[i] = _sign_extend(c, 8)
            elif kind == 3:
                if nibble == 0:
                    c1, c2 = self.byte(), self.byte()
                    values[i] = _sign_extend((c1 << 8) | c2, 16)
                else:
                    c1, c2 = self.byte(), self.byte()
                    values[i] = _sign_extend(((buffer & 0x0F) << 12) | (c1 << 4) | (c2 >> 4), 16)
                    buffer = c2
            selector >>= 2
        return values

    def tag8_8svb(self, count: int) -> list[int]:
        if count == 1:
            return [self.svb()]
        header = self.byte()
        values = []
        for _ in range(count):
            values.append(self.svb() if header & 1 else 0)
            header >>= 1
        return values


def split_logs(data: bytes) -> list[tuple[int, int]]:
    """回傳每段日誌的 (start, end) 位元組區間。"""
    starts = []
    pos = data.find(PRODUCT_MARKER)
    while pos >= 0:
        starts.append(pos)
        pos = data.find(PRODUCT_MARKER, pos + 1)
    return [(s, starts[i + 1] if i + 1 < len(starts) else len(data)) for i, s in enumerate(starts)]


def _parse_headers(data: bytes, start: int, end: int) -> tuple[dict[str, str], int]:
    headers: dict[str, str] = {}
    pos = start
    while pos < end and data[pos:pos + 2] == b"H ":
        nl = data.find(b"\n", pos, end)
        if nl < 0:
            nl = end
        line = data[pos + 2:nl].decode("latin-1").rstrip("\r")
        if ":" in line:
            key, value = line.split(":", 1)
            headers[key.strip()] = value.strip()
        pos = nl + 1
    return headers, pos


def _frame_def(headers: dict[str, str], kind: str) -> FrameDef | None:
    names = headers.get(f"Field {kind} name")
    if not names:
        return None
    fd = FrameDef(names=names.split(","))

    def ints(key: str) -> list[int]:
        raw = headers.get(key, "")
        return [int(x) for x in raw.split(",")] if raw else [0] * len(fd.names)

    fd.signed = ints(f"Field {kind} signed")
    fd.predictor = ints(f"Field {kind} predictor")
    fd.encoding = ints(f"Field {kind} encoding")
    return fd


def _p_interval(headers: dict[str, str]) -> tuple[int, int]:
    raw = headers.get("P interval", "1/1")
    if "/" in raw:
        num, den = raw.split("/", 1)
        return max(1, int(num)), max(1, int(den))
    # 新版 Betaflight 以 "P ratio" 表示每個 I 間隔的 P 框比例；此處只用於 loopIteration 推算
    return 1, max(1, int(raw or 1))


def _decode_raw(reader: _Reader, fd: FrameDef) -> list[int]:
    n = len(fd.names)
    out = [0] * n
    i = 0
    enc = fd.encoding
    while i < n:
        e = enc[i]
        if e == ENC_SIGNED_VB:
            out[i] = reader.svb(); i += 1
        elif e == ENC_UNSIGNED_VB:
            out[i] = reader.uvb(); i += 1
        elif e == ENC_NEG_14BIT:
            out[i] = -_sign_extend(reader.uvb(), 14); i += 1
        elif e == ENC_NULL:
            out[i] = 0; i += 1
        elif e == ENC_TAG8_8SVB:
            count = 1
            while count < 8 and i + count < n and enc[i + count] == ENC_TAG8_8SVB:
                count += 1
            vals = reader.tag8_8svb(count)
            out[i:i + count] = vals; i += count
        elif e == ENC_TAG2_3S32:
            vals = reader.tag2_3s32()
            k = min(3, n - i)
            out[i:i + k] = vals[:k]; i += 3
        elif e == ENC_TAG2_3SVARIABLE:
            vals = reader.tag2_3svariable()
            k = min(3, n - i)
            out[i:i + k] = vals[:k]; i += 3
        elif e == ENC_TAG8_4S16:
            vals = reader.tag8_4s16()
            k = min(4, n - i)
            out[i:i + k] = vals[:k]; i += 4
        else:
            raise ValueError(f"unsupported encoding {e}")
    return out


class _LogDecoder:
    def __init__(self, data: bytes, start: int, end: int, index: int) -> None:
        self.data = data
        self.index = index
        self.headers, self.body_start = _parse_headers(data, start, end)
        self.end = end
        version = self.headers.get("Data version", "")
        if version and version != "2":
            raise BlackboxError(f"不支援的 Blackbox Data version {version}（目前僅支援 2）。")
        self.idef = _frame_def(self.headers, "I")
        if self.idef is None:
            raise BlackboxError("找不到主資料框欄位定義（Field I name），日誌可能不完整。")
        # P 框沒有自己的欄位名稱列，沿用 I 框名稱，只讀取 predictor / encoding。
        self.pdef = FrameDef(names=self.idef.names, signed=self.idef.signed)
        if self.headers.get("Field P encoding"):
            self.pdef.predictor = [int(x) for x in self.headers["Field P predictor"].split(",")]
            self.pdef.encoding = [int(x) for x in self.headers["Field P encoding"].split(",")]
        self.sdef = _frame_def(self.headers, "S")
        self.gdef = _frame_def(self.headers, "G")
        self.hdef = _frame_def(self.headers, "H")
        self.i_interval = max(1, int(self.headers.get("I interval", "1") or 1))
        self.p_num, self.p_den = _p_interval(self.headers)
        self.minthrottle = int(self.headers.get("minthrottle", "0") or 0)
        self.vbatref = int(self.headers.get("vbatref", "0") or 0)
        motor_output = self.headers.get("motorOutput", "0").split(",")
        self.minmotor = int(motor_output[0] or 0)
        names = self.idef.names
        self.motor0 = names.index("motor[0]") if "motor[0]" in names else -1
        self.unsigned = [not s for s in self.idef.signed]

    # ------------------------------------------------------------ 預測器
    def _apply(self, fd: FrameDef, raw: list[int], prev, prev2, skipped: int, is_main: bool) -> list[int]:
        out = list(raw)
        home_idx = 0
        for i, pred in enumerate(fd.predictor):
            if pred == 0:
                continue
            if pred == 1:
                base = prev[i] if prev is not None else 0
            elif pred == 2:
                base = (2 * prev[i] - prev2[i]) if prev is not None else 0
            elif pred == 3:
                if prev is None:
                    base = 0
                else:
                    total = prev[i] + prev2[i]
                    base = int(total / 2) if total < 0 else total // 2
            elif pred == 4:
                base = self.minthrottle
            elif pred == 5:
                base = out[self.motor0] if self.motor0 >= 0 else 0
            elif pred == 6:
                base = (prev[i] if prev is not None else 0) + skipped + 1
            elif pred == 7:
                base = self.home[home_idx] if home_idx < len(self.home) else 0
                home_idx += 1
            elif pred == 8:
                base = 1500
            elif pred == 9:
                base = self.vbatref
            elif pred == 10:
                base = self.last_time
            elif pred == 11:
                base = self.minmotor
            else:
                raise ValueError(f"unsupported predictor {pred}")
            out[i] = out[i] + base
            if is_main and i < len(self.unsigned) and self.unsigned[i]:
                out[i] &= 0xFFFFFFFF
        return out

    SLOW_LIMITS = {"failsafePhase": (0, 7), "rxSignalReceived": (0, 1), "rxFlightChannelsValid": (0, 1)}

    def _slow_plausible(self, values: list[int]) -> bool:
        names = self.sdef.names if self.sdef else []
        for name, value in zip(names, values):
            if name in self.SLOW_LIMITS:
                lo, hi = self.SLOW_LIMITS[name]
                if not lo <= value <= hi:
                    return False
            elif value < 0:
                return False
        return True

    def _should_have_frame(self, index: int) -> bool:
        return (index % self.i_interval + self.p_num - 1) % self.p_den < self.p_num

    def _skipped(self, last_iter: int) -> int:
        count = 0
        idx = last_iter + 1
        while not self._should_have_frame(idx) and count < 10000:
            count += 1
            idx += 1
        return count

    def decode(self) -> BlackboxLog:
        data, end = self.data, self.end
        r = _Reader(data, self.body_start, end)
        rows: list[list[int]] = []
        slow: list[tuple[int, list[int]]] = []
        gps: list[list[int]] = []
        events: list[dict] = []
        prev = prev2 = None
        self.home = [0, 0]
        self.last_time = 0
        corrupt = 0  # 解碼失敗或被判定不合理的框（每次嘗試計一次）
        accepted_bytes = 0  # 被接受的框所佔位元組
        last_good_end = self.body_start  # 最後一個被接受框的結束位置（之後為檔尾殘留）
        resume_pending = False
        ended_cleanly = False
        time_idx = self.idef.names.index("time") if "time" in self.idef.names else 1
        iter_idx = self.idef.names.index("loopIteration") if "loopIteration" in self.idef.names else 0
        last_slow = None
        while r.pos < end:
            frame_start = r.pos
            marker = data[r.pos]
            if marker not in FRAME_MARKERS:
                r.pos += 1
                continue
            r.pos += 1
            try:
                kind = chr(marker)
                if kind == "I":
                    raw = _decode_raw(r, self.idef)
                    values = self._apply(self.idef, raw, prev, prev2, 0, True)
                    pending = ("I", values)
                elif kind == "P":
                    if prev is None or not self.pdef.encoding:
                        raise ValueError("P frame without I frame")
                    raw = _decode_raw(r, self.pdef)
                    skipped = self._skipped(prev[iter_idx])
                    values = self._apply(self.pdef, raw, prev, prev2, skipped, True)
                    pending = ("P", values)
                elif kind == "S" and self.sdef:
                    pending = ("S", _decode_raw(r, self.sdef))
                elif kind == "G" and self.gdef:
                    raw = _decode_raw(r, self.gdef)
                    pending = ("G", self._apply(self.gdef, raw, None, None, 0, False))
                elif kind == "H" and self.hdef:
                    pending = ("H", _decode_raw(r, self.hdef))
                elif kind == "E":
                    pending = ("E", self._event(r))
                else:
                    raise ValueError("unknown frame")
                # 下一個位元組必須是合法框標記或檔尾，否則視為損毀框。
                if r.pos < end and data[r.pos] not in FRAME_MARKERS:
                    raise ValueError("frame not followed by marker")
            except (EOFError, ValueError):
                corrupt += 1
                r.pos = frame_start + 1
                if pending_is_io(kind):
                    prev = prev2 = None  # 主框鏈中斷，等待下一個 I 框
                continue
            tag, payload = pending
            if tag == "I":
                # 重新同步時雜訊可能剛好像 I 框：時間不得倒退，也不得無故前跳超過 60 秒（記錄恢復事件除外）
                if rows and not resume_pending:
                    gap = payload[time_idx] - self.last_time
                    if gap < 0 or gap > MAX_I_FRAME_GAP_US:
                        corrupt += 1
                        r.pos = frame_start + 1
                        prev = prev2 = None
                        continue
                resume_pending = False
                prev2 = prev = payload
                rows.append(payload)
                self.last_time = payload[time_idx]
            elif tag == "P":
                # 時間倒退表示解碼錯位，丟棄該框並等待下一個 I 框。
                if payload[time_idx] < prev[time_idx]:
                    corrupt += 1
                    r.pos = frame_start + 1
                    prev = prev2 = None
                    continue
                prev2, prev = prev, payload
                rows.append(payload)
                self.last_time = payload[time_idx]
            elif tag == "S":
                # 慢速框是旗標：負值或超出範圍代表重新同步時誤判的雜訊，丟棄
                if not self._slow_plausible(payload):
                    corrupt += 1
                    r.pos = frame_start + 1
                    continue
                last_slow = payload
                slow.append((len(rows), payload))
            elif tag == "G":
                gps.append(payload)
            elif tag == "H":
                self.home = payload[:2]
            elif tag == "E":
                payload["frame_index"] = len(rows)
                events.append(payload)
                if payload["type"] == EVT_LOG_END:
                    ended_cleanly = True
                    break
                if payload["type"] == EVT_LOGGING_RESUME:
                    prev = prev2 = None
                    resume_pending = True
            accepted_bytes += r.pos - frame_start
            last_good_end = r.pos
        main = np.asarray(rows, dtype=np.int64) if rows else np.zeros((0, len(self.idef.names)), dtype=np.int64)
        body = max(1, end - self.body_start)
        trailing = end - last_good_end
        interior_unparsed = max(0, (last_good_end - self.body_start) - accepted_bytes)
        stats = {
            "frames": len(rows),
            "corrupt_frames": corrupt,
            "ended_cleanly": ended_cleanly,
            "slow_frames": len(slow),
            "gps_frames": len(gps),
            "bytes": body,
            "accepted_bytes": accepted_bytes,
            # 資料品質以位元組計：中段無法解析的比例（檔尾殘留另計，不視為損毀）
            "interior_unparsed_ratio": round(interior_unparsed / body, 4),
            "trailing_garbage_bytes": trailing,
        }
        _ = last_slow
        return BlackboxLog(
            index=self.index,
            headers=self.headers,
            main_fields=list(self.idef.names),
            main=main,
            slow_fields=list(self.sdef.names) if self.sdef else [],
            slow=slow,
            gps_fields=list(self.gdef.names) if self.gdef else [],
            gps=gps,
            events=events,
            stats=stats,
        )

    def _event(self, r: _Reader) -> dict:
        etype = r.byte()
        if etype == EVT_SYNC_BEEP:
            return {"type": etype, "name": "SYNC_BEEP", "time": r.uvb()}
        if etype == EVT_INFLIGHT_ADJUSTMENT:
            func = r.byte()
            if func & 128:
                value = struct.unpack("<f", bytes(r.byte() for _ in range(4)))[0]
            else:
                value = r.svb()
            return {"type": etype, "name": "INFLIGHT_ADJUSTMENT", "function": func & 127, "value": value}
        if etype == EVT_LOGGING_RESUME:
            return {"type": etype, "name": "LOGGING_RESUME", "iteration": r.uvb(), "time": r.uvb()}
        if etype == EVT_DISARM:
            return {"type": etype, "name": "DISARM", "reason": r.uvb()}
        if etype == EVT_FLIGHT_MODE:
            return {"type": etype, "name": "FLIGHT_MODE", "flags": r.uvb(), "last_flags": r.uvb()}
        if etype == EVT_LOG_END:
            text = bytes(r.byte() for _ in range(11))
            if not text.startswith(b"End of log"):
                raise ValueError("bad log end")
            return {"type": etype, "name": "LOG_END"}
        raise ValueError(f"unknown event {etype}")


def pending_is_io(kind: str) -> bool:
    return kind in ("I", "P")


def sniff(data: bytes) -> bool:
    """以檔案內容判斷是否為 Blackbox（不依副檔名）。"""
    return data[:4096].find(PRODUCT_MARKER) >= 0


def decode(data: bytes, max_logs: int = 50) -> list[BlackboxLog]:
    if not sniff(data):
        raise BlackboxError("檔案內容不是 Betaflight Blackbox 日誌（找不到 Blackbox 標頭）。")
    logs = []
    for idx, (start, end) in enumerate(split_logs(data)[:max_logs]):
        logs.append(_LogDecoder(data, start, end, idx).decode())
    return logs


def headers_only(data: bytes) -> list[dict[str, str]]:
    return [_parse_headers(data, s, e)[0] for s, e in split_logs(data)]
