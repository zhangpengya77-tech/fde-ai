"""ArduPilot DataFlash（.BIN）二進位日誌解析器。

依 ArduPilot 公開的 DataFlash 格式自行實作（LogStructure.h 中的 FMT 自描述格式），
不依賴 pymavlink（LGPL），以便本模組授權單純。每筆訊息以 0xA3 0x95 <type> 開頭，
型別 128 為 FMT，用來定義其他訊息的名稱、欄位與格式字元。
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

import numpy as np

HEAD = b"\xa3\x95"
FMT_TYPE = 128

# 格式字元 → (struct 代碼, 縮放)
FORMAT_CHARS = {
    "a": ("32h", None),
    "b": ("b", 1), "B": ("B", 1), "h": ("h", 1), "H": ("H", 1),
    "i": ("i", 1), "I": ("I", 1), "f": ("f", 1), "d": ("d", 1),
    "n": ("4s", None), "N": ("16s", None), "Z": ("64s", None),
    "c": ("h", 0.01), "C": ("H", 0.01), "e": ("i", 0.01), "E": ("I", 0.01),
    "L": ("i", 1e-7), "M": ("B", 1), "q": ("q", 1), "Q": ("Q", 1),
}


class DataFlashError(ValueError):
    pass


@dataclass
class MessageDef:
    type: int
    length: int
    name: str
    fmt: str
    labels: list[str]
    struct: struct.Struct | None


@dataclass
class DataFlashLog:
    messages: dict[str, dict[str, np.ndarray]]
    texts: list[tuple[float, str]]
    params: dict[str, float]
    modes: list[tuple[float, int, int]]
    stats: dict

    def has(self, name: str) -> bool:
        return name in self.messages and len(next(iter(self.messages[name].values()), [])) > 0

    def field(self, msg: str, name: str) -> np.ndarray | None:
        return self.messages.get(msg, {}).get(name)


def sniff(data: bytes) -> bool:
    return len(data) >= 3 and data[:2] == HEAD and data[2] == FMT_TYPE


def _make_struct(fmt: str) -> struct.Struct | None:
    parts = []
    for ch in fmt:
        if ch not in FORMAT_CHARS:
            return None
        parts.append(FORMAT_CHARS[ch][0])
    return struct.Struct("<" + "".join(parts))


def parse(data: bytes, wanted: set[str] | None = None) -> DataFlashLog:
    """解析整個檔案。wanted 為需要保留數值的訊息名稱（None = 全部）。"""
    if not sniff(data):
        raise DataFlashError("檔案內容不是 ArduPilot DataFlash 日誌（開頭不是 FMT 訊息）。")
    defs: dict[int, MessageDef] = {
        FMT_TYPE: MessageDef(FMT_TYPE, 89, "FMT", "BBnNZ", ["Type", "Length", "Name", "Format", "Columns"], struct.Struct("<BB4s16s64s"))
    }
    rows: dict[str, list[tuple]] = {}
    texts: list[tuple[float, str]] = []
    params: dict[str, float] = {}
    pos = 0
    n = len(data)
    skipped = 0
    count = 0
    unknown_types = 0
    while pos + 3 <= n:
        if data[pos] != 0xA3 or data[pos + 1] != 0x95:
            nxt = data.find(HEAD, pos + 1)
            if nxt < 0:
                skipped += n - pos
                break
            skipped += nxt - pos
            pos = nxt
            continue
        mtype = data[pos + 2]
        mdef = defs.get(mtype)
        if mdef is None:
            unknown_types += 1
            pos += 1
            continue
        end = pos + mdef.length
        if end > n:
            break
        body = data[pos + 3:end]
        if mdef.struct is None or mdef.struct.size != len(body):
            pos = end
            continue
        values = mdef.struct.unpack(body)
        count += 1
        if mtype == FMT_TYPE:
            t, length, name, fmt, cols = values
            name_s = name.rstrip(b"\x00").decode("ascii", "replace")
            fmt_s = fmt.rstrip(b"\x00").decode("ascii", "replace")
            labels = cols.rstrip(b"\x00").decode("ascii", "replace").split(",")
            defs[t] = MessageDef(t, length, name_s, fmt_s, labels, _make_struct(fmt_s))
        else:
            name = mdef.name
            if name == "PARM" and "a" not in mdef.fmt:
                labels = mdef.labels
                pname = values[labels.index("Name")].rstrip(b"\x00").decode("ascii", "replace")
                params[pname] = float(values[labels.index("Value")])
            elif name == "MSG" and "a" not in mdef.fmt:
                labels = mdef.labels
                tus = values[labels.index("TimeUS")] if "TimeUS" in labels else 0
                text = values[labels.index("Message")].rstrip(b"\x00").decode("utf-8", "replace")
                texts.append((tus / 1e6, text))
            if wanted is None or name in wanted:
                rows.setdefault(name, []).append(values)
        pos = end
    messages: dict[str, dict[str, np.ndarray]] = {}
    for name, items in rows.items():
        mdef = next(d for d in defs.values() if d.name == name)
        cols = {}
        # 'a'（int16[32]）在 struct 中展開為 32 個值，需以偏移量對應欄位，避免後續欄位錯位
        offset = 0
        for idx, label in enumerate(mdef.labels):
            if idx >= len(mdef.fmt):
                break
            ch = mdef.fmt[idx]
            width = 32 if ch == "a" else 1
            if ch == "a":
                cols[label] = np.asarray([row[offset:offset + 32] for row in items], dtype=np.int16)
            else:
                scale = FORMAT_CHARS[ch][1]
                if scale is not None:
                    arr = np.asarray([row[offset] for row in items], dtype=np.float64)
                    cols[label] = arr * scale if scale != 1 else arr
            offset += width
        messages[name] = cols
    modes = []
    if "MODE" in messages:
        m = messages["MODE"]
        t = m.get("TimeUS", np.zeros(0)) / 1e6
        mode = m.get("Mode", m.get("ModeNum", np.zeros(len(t))))
        reason = m.get("Rsn", np.zeros(len(t)))
        modes = [(float(a), int(b), int(c)) for a, b, c in zip(t, mode, reason)]
    stats = {
        "messages": count,
        "skipped_bytes": skipped,
        "unknown_type_bytes": unknown_types,
        "bytes": n,
        "types": sorted(messages.keys()),
    }
    if count == 0:
        raise DataFlashError("日誌中沒有可解析的訊息。")
    return DataFlashLog(messages=messages, texts=texts, params=params, modes=modes, stats=stats)
