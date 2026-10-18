"""五階段學習工作台 ↔ 成長紀錄（R01–R08）↔ 任務（T01–T12）對應表。

建立依據（教師 P2 指令第五、六節）：
  1. 以 ``data/growth_records_v1.json``（R01–R08 定義）與 ``data/tasks_v1.json``
     （T01–T12 定義）的實際內容為準；不改寫 R01–R08 原始名稱、任務代碼或資料格式。
  2. ``TaskDefinition`` 與 ``GrowthRecordDefinition`` 在資料庫層沒有外鍵關聯，
     因此對應關係集中由本模組維護，不在檢視／模板／ migration 中散落複本。
  3. 本模組只做「對應與查詢」，不建立第二套 Evidence／Submission／成長日誌／
     教師審核資料庫；提交與審核一律走既有流程（task_detail／growth_record_detail／
     evidence_add／review_growth_record）。

對應判斷：
  * T01–T05 與 R01–R05 的 ``evidence_required`` 清單逐項相同（資料實證），
    視為同一能力的兩個呈現面（任務面／成長紀錄面）。
  * T09↔R06、T11↔R07 依標題與語義對應（鷹眼 AI 檢測／專業任務驗證）。
  * T06／T07／T08／T10／T12 沒有 1:1 的 R 槽位：T07／T08（航線規劃、3D 測繪）
    屬 R07 專業方向子能力；T06（飛控調校）屬 R05 飛控基礎認識的延伸練習；
    T12 為後續綜合進階方向；T10（無人系統開發）目前無對應 R 槽位。
    這些任務只顯示「相關成長紀錄」提示，不得顯示為已完成或已對應。

階段歸屬（每槽恰好歸入一個階段；import 時自我驗證）：
  * R03 在 P1 工作台原置於 assess；依 tasks_v1.json 中 T03（安全真機飛行）
    stage=practice，以及五階段語義（練＝飛行訓練），P2 起 R03 改隸屬於 practice。
  * 已知與 tasks_v1.json stage 標註的差異（保留待教師確認，不自行改寫資料檔）：
    - T02（模擬飛行訓練）資料標為 learn；對應 R02 依「練＝飛行訓練」置於 practice。
    - T05（F450 工程組裝）資料標為 practice；對應 R05 依「做＝實作」置於 build。
    兩筆皆以同一張對應卡呈現（任務卡標註 R 編號、紀錄卡標註任務編號），
    任務與紀錄互相可達，不影響學員操作與教師審核流程。
"""

import json
import re
from pathlib import Path


STAGE_RECORD_SLOTS = {
    "learn": ("R01",),
    "practice": ("R02", "R03", "R04"),
    "build": ("R05",),
    "assess": ("R06",),
    "certify": ("R07", "R08"),
}

TASK_RECORD_MAP = {
    "T01": "R01",
    "T02": "R02",
    "T03": "R03",
    "T04": "R04",
    "T05": "R05",
    "T09": "R06",
    "T11": "R07",
}

# 無 1:1 R 槽位的任務：只提供「相關成長紀錄」參考，供工作台顯示歸屬提示。
TASK_RELATED_RECORDS = {
    "T06": ("R05",),
    "T07": ("R07",),
    "T08": ("R07",),
    "T12": ("R08",),
}

# 任務卡上對「無一對一對應」的繁中說明（不假裝已對應、不顯示完成狀態）。
TASK_MAP_NOTES = {
    "T06": "屬 R05 飛控基礎認識的延伸練習，調校成果併入 R05 檢核一併檢視。",
    "T07": "屬 R07 專業任務驗證的方向子能力（航線任務），成果供教師複核時一併評閱。",
    "T08": "屬 R07 專業任務驗證的方向子能力（測繪建模），成果供教師複核時一併評閱。",
    "T10": "進階概念任務，目前沒有對應的成長紀錄槽位。",
    "T12": "後續綜合進階方向；R08 以整理 R01～R07 既有成果為主，不強制對應。",
}

_SLOT_PATTERN = re.compile(r"^R0[1-8]$")
_TASK_PATTERN = re.compile(r"^T\d{2}$")
_TASKS_CONFIG = Path(__file__).parent / "data" / "tasks_v1.json"
_GROWTH_CONFIG = Path(__file__).parent / "data" / "growth_records_v1.json"


def _build_record_slot_stage():
    reverse = {}
    for stage, slots in STAGE_RECORD_SLOTS.items():
        for slot in slots:
            if not _SLOT_PATTERN.match(slot):
                raise ValueError(f"成長紀錄槽位格式錯誤：{slot}")
            if slot in reverse:
                raise ValueError(f"成長紀錄 {slot} 同時歸屬於 {reverse[slot]} 與 {stage}，每槽只能歸屬一個階段")
            reverse[slot] = stage
    expected = tuple(f"R{index:02d}" for index in range(1, 9))
    if tuple(sorted(reverse)) != expected:
        missing = sorted(set(expected) - set(reverse))
        raise ValueError(f"對應表未覆蓋全部成長紀錄槽位，缺少：{missing}")
    return reverse


RECORD_SLOT_STAGE = _build_record_slot_stage()


def _validate_task_map():
    for task_id, slot in TASK_RECORD_MAP.items():
        if not _TASK_PATTERN.match(task_id):
            raise ValueError(f"任務代碼格式錯誤：{task_id}")
        if slot not in RECORD_SLOT_STAGE:
            raise ValueError(f"任務 {task_id} 對應到不存在的成長紀錄槽位：{slot}")
    for task_id, slots in TASK_RELATED_RECORDS.items():
        if not _TASK_PATTERN.match(task_id):
            raise ValueError(f"任務代碼格式錯誤：{task_id}")
        if task_id in TASK_RECORD_MAP:
            raise ValueError(f"任務 {task_id} 同時存在一對一對應與相關紀錄，請擇一")
        for slot in slots:
            if slot not in RECORD_SLOT_STAGE:
                raise ValueError(f"任務 {task_id} 參照到不存在的成長紀錄槽位：{slot}")


_validate_task_map()


def stage_record_slots(stage):
    """取得階段對應的成長紀錄槽位（未知階段回傳空 tuple）。"""
    return STAGE_RECORD_SLOTS.get(stage, ())


def record_slot_stage(slot_id):
    """取得成長紀錄槽位所屬階段（未知槽位回傳 None）。"""
    return RECORD_SLOT_STAGE.get(str(slot_id).upper())


def task_record_slot(task_id):
    """取得任務的一對一成長紀錄槽位；無一對一對應時回傳 None。"""
    return TASK_RECORD_MAP.get(str(task_id).upper())


def task_related_records(task_id):
    """取得任務的「相關成長紀錄」提示槽位（無則空 tuple）。"""
    return TASK_RELATED_RECORDS.get(str(task_id).upper(), ())


def task_map_note(task_id):
    """取得任務在對應表上的繁中說明；一對一對應的任務回傳 None。"""
    if task_record_slot(task_id):
        return None
    return TASK_MAP_NOTES.get(str(task_id).upper())


def validate_against_data():
    """對照實際資料檔驗證對應表（供測試呼叫；不寫入任何資料）。

    檢查：TASK_RECORD_MAP 的任務代碼都存在於 tasks_v1.json；
    STAGE_RECORD_SLOTS 的槽位都存在於 growth_records_v1.json；
    tasks_v1.json 中每個階段都至少被一張任務卡覆蓋。
    """
    with _TASKS_CONFIG.open(encoding="utf-8") as tasks_file:
        tasks = {item["task_id"]: item for item in json.load(tasks_file)}
    with _GROWTH_CONFIG.open(encoding="utf-8") as growth_file:
        slots = {item["slot_id"] for item in json.load(growth_file)}

    unknown_tasks = sorted(set(TASK_RECORD_MAP) - set(tasks))
    if unknown_tasks:
        raise ValueError(f"對應表參照了 tasks_v1.json 不存在的任務：{unknown_tasks}")
    unknown_slots = sorted(set(RECORD_SLOT_STAGE) - slots)
    if unknown_slots:
        raise ValueError(f"對應表參照了 growth_records_v1.json 不存在的槽位：{unknown_slots}")
    missing_slots = sorted(slots - set(RECORD_SLOT_STAGE))
    if missing_slots:
        raise ValueError(f"growth_records_v1.json 有槽位未列入對應表：{missing_slots}")
    for stage in STAGE_RECORD_SLOTS:
        covered = any(item["stage"] == stage for item in tasks.values())
        if not covered:
            raise ValueError(f"階段 {stage} 在 tasks_v1.json 中沒有任何任務")
    return True
