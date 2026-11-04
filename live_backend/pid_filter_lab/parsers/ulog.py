"""PX4 ULog（.ulg）解析器。

依 PX4 官方公開的 ULog 檔案格式文件自行實作（不依賴 pyulog，以便控制依賴）。
支援：檔頭、Flag Bits、格式定義（含巢狀型別與陣列）、Info / Info Multi、
參數、訂閱、資料、Logging 文字訊息與 Dropout 統計。
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

import numpy as np

MAGIC = b"ULog\x01\x12\x35"

BASIC_TYPES = {
    "int8_t": "i1", "uint8_t": "u1", "int16_t": "<i2", "uint16_t": "<u2",
    "int32_t": "<i4", "uint32_t": "<u4", "int64_t": "<i8", "uint64_t": "<u8",
    "float": "<f4", "double": "<f8", "bool": "u1", "char": "S1",
}


class ULogError(ValueError):
    pass


@dataclass
class ULogData:
    version: int
    start_timestamp: int
    info: dict[str, object]
    params: dict[str, float]
    topics: dict[tuple[str, int], np.ndarray]
    logged: list[tuple[int, str]]
    dropouts: list[tuple[int, int]]
    stats: dict

    def topic(self, name: str, multi_id: int = 0) -> np.ndarray | None:
        return self.topics.get((name, multi_id))

    def topic_names(self) -> list[str]:
        return sorted({name for name, _ in self.topics})


def sniff(data: bytes) -> bool:
    return data[:7] == MAGIC


def _parse_format(text: str) -> tuple[str, list[tuple[str, str, int]]]:
    name, _, body = text.partition(":")
    fields = []
    for item in body.split(";"):
        item = item.strip()
        if not item:
            continue
        ftype, _, fname = item.partition(" ")
        count = 1
        if "[" in ftype:
            ftype, _, rest = ftype.partition("[")
            count = int(rest.rstrip("]"))
        fields.append((ftype, fname, count))
    return name, fields


def _build_dtype(name: str, formats: dict, cache: dict) -> np.dtype:
    if name in cache:
        return cache[name]
    parts = []
    for ftype, fname, count in formats[name]:
        if ftype in BASIC_TYPES:
            base = np.dtype(BASIC_TYPES[ftype])
        elif ftype in formats:
            base = _build_dtype(ftype, formats, cache)
        else:
            raise ULogError(f"未知的 ULog 欄位型別 {ftype}")
        if ftype == "char" and count > 1:
            parts.append((fname, np.dtype(f"S{count}")))
        elif count > 1:
            parts.append((fname, base, (count,)))
        else:
            parts.append((fname, base))
    dtype = np.dtype(parts)  # numpy 預設 packed，與 ULog 相同
    cache[name] = dtype
    return dtype


def _value(type_key: str, raw: bytes):
    vtype, _, key = type_key.partition(" ")
    if vtype.startswith("char["):
        return key, raw.decode("utf-8", "replace").rstrip("\x00")
    base = vtype.split("[")[0]
    if base in BASIC_TYPES and base != "char":
        dt = np.dtype(BASIC_TYPES[base])
        arr = np.frombuffer(raw[: (len(raw) // dt.itemsize) * dt.itemsize], dtype=dt)
        return key, (arr[0].item() if arr.size == 1 else arr.tolist())
    return key, raw


def parse(data: bytes) -> ULogData:
    if not sniff(data):
        raise ULogError("檔案內容不是 PX4 ULog 日誌（檔頭不符）。")
    if len(data) < 16:
        raise ULogError("ULog 檔頭不完整。")
    version = data[7]
    start_ts = struct.unpack_from("<Q", data, 8)[0]
    pos = 16
    n = len(data)
    formats: dict[str, list] = {}
    info: dict[str, object] = {}
    params: dict[str, float] = {}
    subs: dict[int, tuple[str, int]] = {}
    payloads: dict[int, list[bytes]] = {}
    logged: list[tuple[int, str]] = []
    dropouts: list[tuple[int, int]] = []
    truncated = False
    while pos + 3 <= n:
        size, mtype = struct.unpack_from("<HB", data, pos)
        body_start = pos + 3
        body_end = body_start + size
        if body_end > n:
            truncated = True
            break
        body = data[body_start:body_end]
        t = chr(mtype)
        if t == "F":
            fname, fields = _parse_format(body.decode("ascii", "replace"))
            formats[fname] = fields
        elif t == "I" and size >= 1:
            klen = body[0]
            key, value = _value(body[1:1 + klen].decode("ascii", "replace"), body[1 + klen:])
            info[key] = value
        elif t == "M" and size >= 2:
            klen = body[1]
            key, value = _value(body[2:2 + klen].decode("ascii", "replace"), body[2 + klen:])
            if isinstance(value, str) and isinstance(info.get(key), str) and body[0]:
                info[key] = info[key] + value
            else:
                info.setdefault(key, value)
        elif t == "P" and size >= 1:
            klen = body[0]
            key, value = _value(body[1:1 + klen].decode("ascii", "replace"), body[1 + klen:])
            if isinstance(value, (int, float)):
                params[key] = float(value)
        elif t == "A" and size >= 3:
            multi_id = body[0]
            msg_id = struct.unpack_from("<H", body, 1)[0]
            subs[msg_id] = (body[3:].decode("ascii", "replace"), multi_id)
        elif t == "D" and size >= 2:
            msg_id = struct.unpack_from("<H", body, 0)[0]
            payloads.setdefault(msg_id, []).append(body[2:])
        elif t in ("L", "C"):
            if t == "L" and size >= 9:
                level = body[0]
                ts = struct.unpack_from("<Q", body, 1)[0]
                logged.append((ts, f"[{chr(level) if level > 32 else level}] " + body[9:].decode("utf-8", "replace")))
            elif t == "C" and size >= 11:
                ts = struct.unpack_from("<Q", body, 3)[0]
                logged.append((ts, body[11:].decode("utf-8", "replace")))
        elif t == "O" and size >= 2:
            dropouts.append((len(logged), struct.unpack_from("<H", body, 0)[0]))
        pos = body_end
    cache: dict = {}
    topics: dict[tuple[str, int], np.ndarray] = {}
    for msg_id, chunks in payloads.items():
        if msg_id not in subs:
            continue
        name, multi = subs[msg_id]
        if name not in formats:
            continue
        try:
            dtype = _build_dtype(name, formats, cache)
        except ULogError:
            continue
        size = dtype.itemsize
        # 尾端 padding 可能未寫入，補零到完整長度；過長者截斷。
        buf = b"".join(c[:size].ljust(size, b"\x00") for c in chunks)
        topics[(name, multi)] = np.frombuffer(buf, dtype=dtype)
    if not topics:
        raise ULogError("ULog 中沒有任何可解析的資料主題。")
    stats = {
        "bytes": n,
        "truncated": truncated,
        "topics": len(topics),
        "dropouts": len(dropouts),
        "dropout_ms": int(sum(d for _, d in dropouts)),
    }
    return ULogData(version, start_ts, info, params, topics, logged, dropouts, stats)
