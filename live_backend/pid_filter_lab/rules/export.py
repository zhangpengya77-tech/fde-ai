"""經教師審核後的參數方案匯出：三套格式完全分開。"""

from __future__ import annotations

from . import catalog


class ExportError(ValueError):
    pass


def _approved_changes(plan: dict, ecosystem: str, firmware: dict) -> list[dict]:
    changes = []
    key = catalog.catalog_key(ecosystem, firmware)
    allowed = {spec.name: spec for specs in catalog.CATALOGS.get(key, {}).values() for spec in specs}
    version = tuple(firmware.get("version_tuple") or ()) or None
    for item in plan.get("changes", []):
        spec = allowed.get(item["name"])
        if spec is None:
            raise ExportError(f"參數 {item['name']} 不屬於 {key} 參數目錄，拒絕匯出（禁止混用不同飛控參數）。")
        if not spec.supports(version):
            raise ExportError(f"參數 {item['name']} 不適用韌體 {firmware.get('version')}。")
        value = float(item["value"])
        if not (spec.minimum <= value <= spec.maximum):
            raise ExportError(f"參數 {item['name']}={value} 超出有效範圍 {spec.minimum}～{spec.maximum}。")
        changes.append({"name": spec.name, "value": spec.clamp(value), "current": item.get("current"), "ptype": spec.ptype})
    if not changes:
        raise ExportError("方案中沒有可匯出的參數。")
    return changes


def _fmt(value: float, ptype: str) -> str:
    return str(int(value)) if ptype == "int" else f"{value:.6g}"


def render(plan: dict, analysis_meta: dict, review: dict) -> dict:
    if review.get("status") != "APPROVED":
        raise ExportError("方案尚未經教師審核通過，不能匯出。")
    eco = analysis_meta["ecosystem"]
    fw = analysis_meta["firmware"]
    changes = _approved_changes(plan, eco, fw)
    header = [
        f"FDE-AI PID & Filter Lab 參數方案 {plan['plan_id']}",
        f"飛控：{eco}  韌體：{fw.get('name')} {fw.get('version')}  硬體：{analysis_meta.get('board')}",
        f"來源日誌 SHA-256：{analysis_meta.get('log_sha256')}",
        f"教師審核：{review.get('reviewer')} 於 {review.get('reviewed_at')}",
        "安全提醒：修改前先完整備份；拆下螺旋槳再連接飛控；只修改下列參數，不得改動馬達資源映射、接收機與失控保護設定；修改後必須實機複測。",
    ]
    if eco == "betaflight":
        lines = ["# " + h for h in header]
        lines.append("# 第一步：在 Betaflight Configurator CLI 執行 `diff all`，複製全部輸出另存為備份檔。")
        lines.append("# 第二步：確認 `version` 輸出與上方韌體版本一致，再貼上以下指令。")
        for c in changes:
            lines.append(f"# 原值 {c['name']} = {_fmt(c['current'], c['ptype']) if c['current'] is not None else '未知'}")
            lines.append(f"set {c['name']} = {_fmt(c['value'], c['ptype'])}")
        lines.append("save")
        return {"filename": f"{plan['plan_id']}_betaflight_cli.txt", "content": "\n".join(lines) + "\n", "format": "Betaflight CLI"}
    if eco == "ardupilot":
        lines = ["# " + h for h in header]
        lines.append("# 載入方式：Mission Planner → 設定 → 完整參數清單 → 先「儲存到檔案」備份，再「從檔案載入」本檔並逐項確認後寫入。")
        for c in changes:
            lines.append(f"# 原值 {c['name']},{_fmt(c['current'], c['ptype']) if c['current'] is not None else '未知'}")
            lines.append(f"{c['name']},{_fmt(c['value'], c['ptype'])}")
        return {"filename": f"{plan['plan_id']}_ardupilot.param", "content": "\n".join(lines) + "\n", "format": "ArduPilot .param（Mission Planner）"}
    if eco == "px4":
        lines = ["# " + h for h in header]
        lines.append("# 載入方式：QGroundControl → 參數 → 工具 → 先「儲存到檔案」備份，再「從檔案載入」本檔。")
        lines.append("# Vehicle-Id\tComponent-Id\tName\tValue\tType")
        for c in changes:
            ptype = 6 if c["ptype"] == "int" else 9
            lines.append(f"# 原值 {c['name']}\t{_fmt(c['current'], c['ptype']) if c['current'] is not None else '未知'}")
            lines.append(f"1\t1\t{c['name']}\t{_fmt(c['value'], c['ptype'])}\t{ptype}")
        return {"filename": f"{plan['plan_id']}_px4.params", "content": "\n".join(lines) + "\n", "format": "PX4 .params（QGroundControl）"}
    raise ExportError(f"飛控 {eco} 沒有已驗證的匯出格式。")
