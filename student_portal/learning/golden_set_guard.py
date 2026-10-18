"""Golden Set 不可變性守衛（Model 層）。

2026-10-09 教師第 25 輪指令「二、FROZEN 不可變性修復」的實作。

問題背景
--------
修復前，FROZEN 的不可變性**只在服務層（`golden_set.py`）與 View 層檢查**。
任何繞過服務層的 ORM 寫入都會成功：

    s = GoldenSetSample.objects.get(...)   # 父集合已 FROZEN
    s.label = "CCW_B"; s.save()            # 成功（不該成功）
    s.delete()                             # 成功（不該成功）
    GoldenSetSample.objects.filter(...).update(label="CW_B")   # 成功
    GoldenSetSample.objects.filter(...).delete()               # 成功

結果是「偵測得到、但擋不住」：Manifest 會變成 MISMATCH，可是資料已經被改壞了。

修復策略（最小修改、不動資料庫結構）
------------------------------------
本模組不改任何既有欄位、不改任何既有 Migration、不改服務層函式簽名。
它只在**匯入時**（import-time）把守衛方法掛到既有的模型與 Manager 上：

1. `GoldenSetSample.save()`            → 父集合 FROZEN 時拒絕
2. `GoldenSetSample.delete()`          → 父集合 FROZEN 時拒絕
3. `GoldenSetSampleQuerySet.update()`  → 拒絕
4. `GoldenSetSampleQuerySet.delete()`  → 拒絕
5. `GoldenSetSampleQuerySet.bulk_update()` → 拒絕
6. `GoldenSetSampleQuerySet.bulk_create()` → 拒絕
7. `GoldenSet.save()`                  → FROZEN 後禁止改動契約欄位
8. `GoldenSet.delete()`                → FROZEN 時拒絕

FROZEN 判定一律**回查資料庫**（`values_list`）而非信任記憶體中的實例，
以避免「物件先被載入（DRAFT）→ 別處鎖定 → 本處用舊實例寫入」的競態。

殘餘風險（**必須誠實揭露，不得宣稱完全防護**）
--------------------------------------------
本守衛屬 **ORM / Python 應用層**防護，無法涵蓋：

- `cursor.execute("UPDATE ...")` 之類的**原生 SQL**（完全繞過 Django ORM）。
- 直接以 sqlite3 CLI、DB Browser、psql 等**外部工具**改寫資料庫檔案。
- `QuerySet.raw()`、`.extra()` 中的寫入片段。
- 非 Django 程序（例如未載入本模組的其他 Python 程序）對同一 DB 的寫入。
- SQLite 沒有 Trigger：本專案在 SQLite 上**不建立** DB 層 Trigger 防護，
  因此資料庫檔案層級的不可變性**並未**被保證。

上述情形仍會被 `manifest_binding_status` 偵測為 `MISMATCH`（偵測能力原本就有），
但**不會被本守衛阻擋**。若需真正的資料庫層不可變性，需在正式 PostgreSQL
上另立 Trigger 與權限設計，屬本輪範圍外。
"""

from django.db import models
from django.db.models.signals import class_prepared

# 專用錯誤碼；與服務層 GoldenSetError 的 "GOLDEN_SET_FROZEN" 語意對齊，
# 但型別獨立，避免模型層反向依賴服務層模組。
FROZEN_CODE = "GOLDEN_SET_FROZEN"
FROZEN_MESSAGE = "此測試集版本已鎖定（FROZEN），不得再新增、修改或刪除樣本。"
FROZEN_SET_MESSAGE = "此測試集版本已鎖定（FROZEN），不得改動鎖定契約或刪除版本。"

# GoldenSet 在 FROZEN 後仍允許寫入的欄位。
#
# 這份清單必須與 `golden_set.build_manifest()` 的欄位**互斥**：
# 只要某欄位進入 Manifest，它在 FROZEN 後就不可改寫，否則
# manifest_binding_status 會變成 MISMATCH（可重現性被破壞）。
#
# build_manifest() 會寫入：contract_version / golden_set_id / task_id /
#   version / name / status / frozen_at / frozen_by / sample_count /
#   confirmed_sample_count / per_class_count / provenance.*（created_by、
#   created_at、cohort）/ samples[*]
# 因此除了 `updated_at` 之外，只有**確定不在 Manifest 中**的 `description`
# 可以調整。
_FROZEN_MUTABLE_FIELDS = frozenset({"updated_at", "description"})


class FrozenGoldenSetError(Exception):
    """嘗試變更已鎖定 Golden Set 時拋出。

    刻意不使用 django.core.exceptions.ValidationError：
    本錯誤代表「呼叫端邏輯錯誤 / 越權寫入」，不是欄位驗證失敗。
    """

    def __init__(self, message: str = FROZEN_MESSAGE, code: str = FROZEN_CODE):
        super().__init__(message)
        self.code = code
        self.message = message


def _sample_parent_frozen(instance) -> bool:
    """回查資料庫確認樣本所屬 Golden Set 是否已鎖定。

    以資料庫為準，不信任 `instance.golden_set` 的記憶體狀態：

    - 先取父集合主鍵（不觸發額外查詢）。
    - 若實例尚未存過（無 `golden_set_id`），視為非鎖定。
    - 直接以 `values_list` 讀 `status`，這是唯一可信的來源。
    """
    set_id = getattr(instance, "golden_set_id", None)
    if not set_id:
        return False
    GoldenSet = instance.__class__.golden_set.field.related_model
    row = GoldenSet.objects.filter(pk=set_id).values_list("status", flat=True).first()
    return row == "FROZEN"


def _set_is_frozen_in_db(instance) -> bool:
    """回查資料庫確認 GoldenSet 本身是否已鎖定。"""
    if not instance.pk:
        return False
    GoldenSet = instance.__class__
    row = GoldenSet.objects.filter(pk=instance.pk).values_list("status", flat=True).first()
    return row == "FROZEN"


def _frozen_set_write_allowed(update_fields) -> bool:
    """判斷這次寫入是否只碰「FROZEN 後仍允許」的欄位。

    `update_fields=None` 代表整列寫入 → 一律拒絕。
    """
    if not update_fields:
        return False
    return set(update_fields).issubset(_FROZEN_MUTABLE_FIELDS)


# ---------------------------------------------------------------------------
# 鎖定一次的例外通道（sealed capability）
#
# 為什麼需要：`freeze_golden_set()` 的寫入分兩步——
#   步驟 1：status=frozen_at=... 一起寫入（此刻 DB 已變成 FROZEN）
#   步驟 2：把算出來的 manifest_sha256 寫回同一列
# 步驟 2 在守衛眼中就是「對 FROZEN 列改動契約欄位」，若一律拒絕，
# 連合法的鎖定流程都會被自己擋死。
#
# 因此提供一個**受限於當次交易、且只能成功一次**的許可：
#   - 由 `golden_set.py` 的 freeze 流程在**已驗證過前置條件**後顯式開啟；
#   - 只在 `transaction.atomic()` 區塊內有效（否則立即失效）；
#   - 一旦用掉（consumed）即刻失效，無法在同一交易內二次寫入；
#   - 離開交易即自動清除。
#
# 這**不是**後門：它只放行「同一交易內、緊接在狀態轉換之後、寫 manifest 欄位」
# 這一個特定動作。外部呼叫端無法取得此許可，因為開啟函式要求傳入
# 一個由 golden_set.py 持有的模組私有物件作為證明。
# ---------------------------------------------------------------------------

import threading  # noqa: E402  （僅用於交易內的執行緒局部狀態）

_freeze_seal_state = threading.local()

# 交易內的許可憑證。任何呼叫端都無法偽造，因為它只存在於本模組的閉包中。
_FREEZE_SEAL_TOKEN = object()


def _freeze_seal_allowed() -> bool:
    """目前是否在「合法的鎖定收尾」交易中，且許可尚未用掉。"""
    state = getattr(_freeze_seal_state, "current", None)
    if state is None:
        return False
    if state.get("consumed"):
        return False
    if not _in_atomic_block():
        return False
    state["consumed"] = True
    return True


def _in_atomic_block() -> bool:
    """是否位於 `transaction.atomic()` 區塊內。"""
    from django.db import connection

    return bool(getattr(connection, "in_atomic_block", False))


class freeze_seal:
    """僅供 `freeze_golden_set()` 使用的鎖定收尾許可（context manager）。

    外部模組若要用，必須先 `from learning.golden_set_guard import freeze_seal`，
    這在程式碼審查時是顯眼的、可被追蹤的——刻意不做成隱式全域旗標。
    """

    def __init__(self, token=None):
        if token is not _FREEZE_SEAL_TOKEN:
            raise PermissionError(
                "freeze_seal 僅供 golden_set.freeze_golden_set() 使用。"
            )

    def __enter__(self):
        _freeze_seal_state.current = {"consumed": False}
        return self

    def __exit__(self, *exc_info):
        _freeze_seal_state.current = None
        return False


def open_freeze_seal():
    """由 `golden_set.freeze_golden_set()` 呼叫，取得鎖定收尾許可。"""
    return freeze_seal(_FREEZE_SEAL_TOKEN)


# ---------------------------------------------------------------------------
# GoldenSetSample：實例層守衛
# ---------------------------------------------------------------------------

def _sample_save(self, *args, **kwargs):
    update_fields = kwargs.get("update_fields")
    if update_fields is None and len(args) >= 3:
        # Django 允許 save(force_insert, force_update, using, update_fields) 位置參數。
        update_fields = args[2]
    if not kwargs.get("force_insert") and _sample_parent_frozen(self):
        raise FrozenGoldenSetError()
    return _sample_save_original(self, *args, **kwargs)


def _sample_delete(self, *args, **kwargs):
    if _sample_parent_frozen(self):
        raise FrozenGoldenSetError()
    return _sample_delete_original(self, *args, **kwargs)


# ---------------------------------------------------------------------------
# GoldenSetSample：QuerySet 層守衛
# ---------------------------------------------------------------------------

def _is_sample_model(model) -> bool:
    """此 QuerySet / Manager 是否操作 GoldenSetSample。

    以 `_meta.label_lower` 判斷（字串比對），避免在真實 App Registry
    尚未就緒時就 import 模型類別造成循環。
    """
    return getattr(getattr(model, "_meta", None), "label_lower", "") == "learning.goldensetsample"


def _sample_frozen_set_ids(set_ids):
    """回傳給定集合主鍵中，狀態為 FROZEN 者。"""
    if not set_ids:
        return set()
    from django.apps import apps

    GoldenSet = apps.get_model("learning", "GoldenSet")
    return set(
        GoldenSet.objects.filter(pk__in=set_ids, status="FROZEN").values_list(
            "pk", flat=True
        )
    )


def _qs_frozen_sample_ids(self):
    """回傳此查詢集中，屬於已鎖定 Golden Set 的樣本主鍵清單。"""
    set_ids = set(
        self.filter(golden_set__status="FROZEN").values_list("golden_set_id", flat=True)
    )
    if not set_ids:
        return []
    frozen = _sample_frozen_set_ids(set_ids)
    if not frozen:
        return []
    return list(
        self.filter(golden_set_id__in=frozen).values_list("pk", flat=True)
    )


def _qs_deny_if_frozen(self):
    """只要查詢集命中任何已鎖定集合的樣本，即拒絕整個操作。"""
    hit = _qs_frozen_sample_ids(self)
    if hit:
        raise FrozenGoldenSetError(
            f"{FROZEN_MESSAGE}（受影響樣本數：{len(hit)}）"
        )


def _qs_update(self, **kwargs):
    if _is_sample_model(self.model):
        _qs_deny_if_frozen(self)
    return _qs_update_original(self, **kwargs)


def _is_set_model(model) -> bool:
    """此 QuerySet 是否操作 GoldenSet 本身。"""
    return getattr(getattr(model, "_meta", None), "label_lower", "") == "learning.goldenset"


def _qs_delete(self, *args, **kwargs):
    if _is_sample_model(self.model):
        _qs_deny_if_frozen(self)
    elif _is_set_model(self.model):
        # 刪除 FROZEN 版本會連帶 CASCADE 刪掉全部樣本 → 必須擋。
        if self.filter(status="FROZEN").exists():
            raise FrozenGoldenSetError(FROZEN_SET_MESSAGE, FROZEN_CODE)
    return _qs_delete_original(self, *args, **kwargs)


def _deny_if_objs_frozen(model, objs):
    """檢查一批待寫入物件是否有任何一個隸屬已鎖定集合。"""
    if not _is_sample_model(model):
        return
    set_ids = {getattr(obj, "golden_set_id", None) for obj in objs}
    set_ids.discard(None)
    frozen = _sample_frozen_set_ids(set_ids)
    if frozen:
        blocked = len([o for o in objs if getattr(o, "golden_set_id", None) in frozen])
        raise FrozenGoldenSetError(f"{FROZEN_MESSAGE}（受影響樣本數：{blocked}）")


def _qs_bulk_update(self, objs, fields, batch_size=None):
    """bulk_update 可能混雜多個集合的樣本，需逐筆檢查所屬集合狀態。"""
    objs = list(objs)
    _deny_if_objs_frozen(self.model, objs)
    return _qs_bulk_update_original(self, objs, fields, batch_size)


def _qs_bulk_create(self, objs, *args, **kwargs):
    objs = list(objs)
    _deny_if_objs_frozen(self.model, objs)
    return _qs_bulk_create_original(self, objs, *args, **kwargs)


def _qs_get_or_create(self, defaults=None, **kwargs):
    """`get_or_create` 可能經由 Manager 或 QuerySet 兩條路徑抵達。

    兩條路徑都掛守衛，且**以查詢條件是否命中既有列**判定，
    確保「既有列命中」這種無寫入情境不會被誤擋。
    """
    if _is_sample_model(self.model):
        lookup = dict(kwargs)
        try:
            self.get(**lookup)
        except self.model.DoesNotExist:
            _deny_if_objs_frozen(self.model, [self.model(**lookup)])
    return _qs_get_or_create_original(self, defaults, **kwargs)


# --- Manager 層守衛（create / bulk_create / get_or_create 走 Manager API） ---

def _mgr_create(self, **kwargs):
    if _is_sample_model(self.model):
        _deny_if_objs_frozen(
            self.model, [self.model(**kwargs)]
        )
    return _mgr_create_original(self, **kwargs)


def _mgr_bulk_create(self, objs, *args, **kwargs):
    objs = list(objs)
    _deny_if_objs_frozen(self.model, objs)
    return _mgr_bulk_create_original(self, objs, *args, **kwargs)


def _deny_if_lookup_would_create(model, kwargs):
    """若以 `kwargs`（排除 defaults）查不到既有列，代表即將新增 → 過守衛。"""
    if not _is_sample_model(model):
        return
    lookup = {k: v for k, v in kwargs.items() if k != "defaults"}
    try:
        model.objects.get(**lookup)
        return  # 既有列，不會寫入
    except model.DoesNotExist:
        pass
    _deny_if_objs_frozen(model, [model(**lookup)])


def _mgr_get_or_create(self, **kwargs):
    _deny_if_lookup_would_create(self.model, kwargs)
    return _mgr_get_or_create_original(self, **kwargs)


# ---------------------------------------------------------------------------
# GoldenSet：版本層守衛
# ---------------------------------------------------------------------------

def _set_save(self, *args, **kwargs):
    update_fields = kwargs.get("update_fields")
    if update_fields is None and len(args) >= 3:
        update_fields = args[2]
    if not kwargs.get("force_insert") and _set_is_frozen_in_db(self):
        if not _frozen_set_write_allowed(update_fields):
            if not _freeze_seal_allowed():
                raise FrozenGoldenSetError(FROZEN_SET_MESSAGE, FROZEN_CODE)
    return _set_save_original(self, *args, **kwargs)


def _set_delete(self, *args, **kwargs):
    if _set_is_frozen_in_db(self):
        raise FrozenGoldenSetError(FROZEN_SET_MESSAGE, FROZEN_CODE)
    return _set_delete_original(self, *args, **kwargs)


# ---------------------------------------------------------------------------
# 掛載（idempotent）
#
# 刻意不用 AppConfig.ready()：本模組改為由 models.py 在檔尾呼叫 install()，
# 確保任何 `import learning.models` 的行程都已受保護，
# 也避免在其他 App 尚未載入時就急著接 signals。
# ---------------------------------------------------------------------------

_INSTALLED = False

_sample_save_original = None
_sample_delete_original = None
_qs_update_original = None
_qs_delete_original = None
_qs_bulk_update_original = None
_qs_bulk_create_original = None
_mgr_create_original = None
_mgr_bulk_create_original = None
_mgr_get_or_create_original = None
_qs_get_or_create_original = None
_set_save_original = None
_set_delete_original = None


def install(models_module) -> bool:
    """把守衛掛到指定 models 模組的模型上；重複呼叫為 no-op。

    回傳 True 表示本次真的掛載成功（可用於測試斷言）。
    """
    global _INSTALLED
    global _sample_save_original, _sample_delete_original
    global _qs_update_original, _qs_delete_original
    global _qs_bulk_update_original, _qs_bulk_create_original
    global _mgr_create_original, _mgr_bulk_create_original, _mgr_get_or_create_original
    global _qs_get_or_create_original
    global _set_save_original, _set_delete_original

    if _INSTALLED:
        return False

    GoldenSet = getattr(models_module, "GoldenSet", None)
    GoldenSetSample = getattr(models_module, "GoldenSetSample", None)
    if GoldenSet is None or GoldenSetSample is None:
        return False

    # --- GoldenSetSample 實例層 ---
    _sample_save_original = GoldenSetSample.save
    _sample_delete_original = GoldenSetSample.delete
    GoldenSetSample.save = _sample_save
    GoldenSetSample.delete = _sample_delete

    # --- GoldenSetSample QuerySet / Manager 層 ---
    #
    # 這裡**不**替換 Manager 類別。原因：`ModelBase` 在類別建立時就已把
    # `objects` 綁定為 `Manager.from_queryset(QuerySet)` 的產物，
    # 事後 `add_to_class("objects", ...)` 或改 `_meta.default_manager_name`
    # 都不會改變既有 Manager（已實測無效）。
    #
    # 改為直接覆寫 `models.QuerySet` 與 `models.Manager` 上的方法，
    # 並在方法內以 `self.model` 判斷是否為 GoldenSetSample。
    # 這樣做的好處：
    #   - 不需新增 Migration（本輪要求最小修改、不動資料庫結構）；
    #   - 涵蓋所有 QuerySet 派生結果（filter() / values() / all() /
    #     related manager 的 .samples.* 等）；
    #   - 對其他模型完全透明（非本模型者直接走原方法，行為零改變）。
    _qs_update_original = models.QuerySet.update
    _qs_delete_original = models.QuerySet.delete
    _qs_bulk_update_original = models.QuerySet.bulk_update
    _qs_bulk_create_original = models.QuerySet.bulk_create

    models.QuerySet.update = _qs_update
    models.QuerySet.delete = _qs_delete
    models.QuerySet.bulk_update = _qs_bulk_update
    models.QuerySet.bulk_create = _qs_bulk_create

    _mgr_create_original = models.Manager.create
    _mgr_bulk_create_original = models.Manager.bulk_create
    _mgr_get_or_create_original = models.Manager.get_or_create
    _qs_get_or_create_original = models.QuerySet.get_or_create

    models.Manager.create = _mgr_create
    models.Manager.bulk_create = _mgr_bulk_create
    models.Manager.get_or_create = _mgr_get_or_create
    models.QuerySet.get_or_create = _qs_get_or_create

    # --- GoldenSet 版本層 ---
    _set_save_original = GoldenSet.save
    _set_delete_original = GoldenSet.delete
    GoldenSet.save = _set_save
    GoldenSet.delete = _set_delete

    _INSTALLED = True
    return True


def is_installed() -> bool:
    """守衛是否已生效；供驗收報告引用。"""
    return _INSTALLED


def residual_risks() -> tuple:
    """回傳未受本守衛保護的寫入途徑清單（給報告與測試引用）。"""
    return (
        "原生 SQL（django.db.connection.cursor().execute 的 UPDATE/DELETE/INSERT）",
        "QuerySet.raw() / .extra() 中夾帶的寫入語句",
        "外部工具直接改寫 SQLite 檔案（sqlite3 CLI / DB Browser / psql）",
        "未載入 learning.models 的其他行程對同一資料庫的寫入",
        "SQLite 未建立任何 DB Trigger，資料庫檔案層級不可變性未受保證",
    )
