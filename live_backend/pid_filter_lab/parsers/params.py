"""CLI 與參數檔匯入：Betaflight version / diff all / dump all、ArduPilot .param、PX4 .params。"""

from __future__ import annotations

import re

BF_VERSION_RE = re.compile(r"#\s*(Betaflight|INAV|Emuflight)\s*/\s*(\S+)\s*\((\w+)\)\s*(\d+\.\d+\.\d+)")


class ParamImportError(ValueError):
    pass


def parse_betaflight_cli(text: str) -> dict:
    params: dict[str, float] = {}
    raw_values: dict[str, str] = {}
    firmware = None
    board = None
    for line in text.splitlines():
        line = line.strip()
        m = BF_VERSION_RE.search(line)
        if m:
            firmware = {"name": m.group(1), "version": m.group(4), "mcu": m.group(2), "target": m.group(3)}
        if line.startswith("board_name "):
            board = line.split(" ", 1)[1].strip()
        if line.startswith("set ") and "=" in line:
            name, _, value = line[4:].partition("=")
            name, value = name.strip(), value.strip()
            raw_values[name] = value
            try:
                params[name] = float(value)
            except ValueError:
                pass
    if not params and not firmware:
        raise ParamImportError("沒有找到 Betaflight CLI 內容（需要 version、diff all 或 dump all 的輸出）。")
    return {"ecosystem": "betaflight", "firmware": firmware, "board": board, "params": params, "raw_values": raw_values, "count": len(params)}


def parse_ardupilot_params(text: str) -> dict:
    params: dict[str, float] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = re.split(r"[,\s\t]+", line)
        if len(parts) >= 2 and re.fullmatch(r"[A-Z][A-Z0-9_]+", parts[0]):
            try:
                params[parts[0]] = float(parts[1])
            except ValueError:
                continue
    if not params:
        raise ParamImportError("沒有找到 ArduPilot 參數（格式：NAME,VALUE）。")
    return {"ecosystem": "ardupilot", "params": params, "count": len(params)}


def parse_px4_params(text: str) -> dict:
    params: dict[str, float] = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        parts = line.split("\t") if "\t" in line else line.split()
        if len(parts) >= 4 and parts[0].isdigit():
            try:
                params[parts[2]] = float(parts[3])
            except ValueError:
                continue
    if not params:
        raise ParamImportError("沒有找到 PX4 參數（QGroundControl 匯出格式）。")
    return {"ecosystem": "px4", "params": params, "count": len(params)}


def parse(ecosystem: str, text: str) -> dict:
    if ecosystem == "betaflight":
        return parse_betaflight_cli(text)
    if ecosystem == "ardupilot":
        return parse_ardupilot_params(text)
    if ecosystem == "px4":
        return parse_px4_params(text)
    raise ParamImportError("此飛控尚未支援參數匯入。")
