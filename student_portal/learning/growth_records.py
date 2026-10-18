import json
from pathlib import Path

from django.db.models import Q

from .models import (
    Evidence,
    GrowthRecordDefinition,
    GrowthRecordReview,
    GrowthRecordSubmission,
)


GROWTH_RECORDS_CONFIG = Path(__file__).parent / "data" / "growth_records_v1.json"


def load_growth_record_config():
    with GROWTH_RECORDS_CONFIG.open(encoding="utf-8") as config_file:
        return json.load(config_file)


def seed_growth_record_definitions(cohort):
    definitions = []
    for item in load_growth_record_config():
        definition, _ = GrowthRecordDefinition.objects.get_or_create(
            cohort=cohort,
            slot_id=item["slot_id"],
            group_scope=None,
            defaults={key: value for key, value in item.items() if key != "slot_id"},
        )
        definitions.append(definition)
    return definitions


def ensure_growth_submissions(enrollment):
    seed_growth_record_definitions(enrollment.cohort)
    definitions = GrowthRecordDefinition.objects.filter(cohort=enrollment.cohort).filter(
        Q(group_scope__isnull=True) | Q(group_scope_id=enrollment.group_id)
    )
    selected_by_slot = {}
    for definition in definitions:
        current = selected_by_slot.get(definition.slot_id)
        if current is None or definition.group_scope_id:
            selected_by_slot[definition.slot_id] = definition

    submissions = []
    for definition in selected_by_slot.values():
        if not definition.enabled:
            continue
        submission, _ = GrowthRecordSubmission.objects.get_or_create(
            enrollment=enrollment, definition=definition
        )
        submissions.append(submission)
    return sorted(submissions, key=lambda submission: (submission.definition.display_order, submission.definition.slot_id))


# ---------------------------------------------------------------------------
#  P9-A：唯讀統計（與上方 ensure_growth_submissions 分離）
#
#  背景：P8-A 稽核確認 build_cohort_report() 為「讀取 ＋ 冪等惰性初始化」，
#  資料缺失時會補建定義與提交列。P9 要求 P5 報告／P6 結訓清單／P6 CSV／
#  P7 成果展示的**讀取**不產生任何資料庫寫入。
#
#  設計原則：
#    1. **不刪除** ensure_growth_submissions（學員端開啟自己的成長紀錄時
#       仍需要初始化；教師端寫入路徑亦同）。
#    2. 唯讀路徑以「槽位定義（含配置檔預設）」為基準，缺資料列時以記憶體
#       替身表達「未開始」，因此**0 項提交的學員不會從統計中消失**。
#    3. 統計語意與補建後完全一致，已由
#       tests/test_p9_readonly_report.py 的修正前後基準對照逐項證明。
# ---------------------------------------------------------------------------


class VirtualGrowthDefinition:
    """唯讀統計替身：資料庫尚無此槽位定義時，以配置檔內容代替（**不落庫**）。"""

    __slots__ = ("slot_id", "title", "display_order", "enabled")

    def __init__(self, payload):
        self.slot_id = payload["slot_id"]
        self.title = payload.get("title", "")
        self.display_order = payload.get("display_order", 1)
        # 配置檔即「預設應啟用」的定義；與 seed 後 GrowthRecordDefinition
        # 的 enabled 預設值（True）一致。
        self.enabled = True


class VirtualGrowthSubmission:
    """唯讀統計替身：資料庫尚無此提交列時，以「未開始」狀態代替（**不落庫**）。

    狀態為 NOT_STARTED，與 ensure_growth_submissions() 補建後完全相同，
    故「尚未提交」的統計與顯示皆不變。
    """

    __slots__ = ("definition", "status", "submitted_at", "teacher_final_score", "pk")

    def __init__(self, definition):
        self.definition = definition
        self.status = GrowthRecordSubmission.Status.NOT_STARTED
        self.submitted_at = None
        self.teacher_final_score = None
        self.pk = None

    @property
    def reviews(self):
        """尚無複核紀錄（空查詢集，支援 .select_related()／.order_by()）。"""
        return GrowthRecordReview.objects.none()

    @property
    def evidence(self):
        """尚無成果證據（空查詢集，支援 .all()）。"""
        return Evidence.objects.none()


def growth_record_slot_plan(enrollment):
    """P9-A：唯讀版的槽位計畫，**不建立任何資料列**。

    回傳與 ensure_growth_submissions() 相同結構與排序的 submissions 清單，
    差別只在於缺資料時不寫入資料庫，而以等價的記憶體替身表達：

      - 缺 GrowthRecordDefinition → 以配置檔預設定義代替（VirtualGrowthDefinition）。
      - 缺 GrowthRecordSubmission → 以 NOT_STARTED 狀態代替（VirtualGrowthSubmission）。

    選擇邏輯（小組專屬定義優先、enabled 過濾、排序）與寫入版逐行對應，
    確保統計結果等價。
    """
    config = {item["slot_id"]: item for item in load_growth_record_config()}

    definitions = GrowthRecordDefinition.objects.filter(cohort=enrollment.cohort).filter(
        Q(group_scope__isnull=True) | Q(group_scope_id=enrollment.group_id)
    )
    selected_by_slot = {}
    for definition in definitions:
        current = selected_by_slot.get(definition.slot_id)
        if current is None or definition.group_scope_id:
            selected_by_slot[definition.slot_id] = definition

    existing_by_slot = {
        item.definition.slot_id: item
        for item in GrowthRecordSubmission.objects.filter(
            enrollment=enrollment
        ).select_related("definition")
    }

    submissions = []
    for slot_id in config:
        definition = selected_by_slot.get(slot_id)
        if definition is None:
            definition = VirtualGrowthDefinition(config[slot_id])
        if not definition.enabled:
            continue
        submission = existing_by_slot.get(slot_id)
        if submission is None:
            submission = VirtualGrowthSubmission(definition)
        submissions.append(submission)
    return sorted(
        submissions,
        key=lambda submission: (submission.definition.display_order, submission.definition.slot_id),
    )
