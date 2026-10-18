# FDE-AI-UAS 2.0｜交付前 P1 最小修復驗收報告

**指令依據**：【FDE-AI-UAS 2.0｜交付前 P1 最小修復指令】
**執行分支**：`fde-ai-v2.0-dev`
**工作目錄**：`D:\FDE-AI-UAS-v2.0`
**修復標的**：P1-1 Golden Set FROZEN 不可變性（第 24 輪交付驗收 S7 失敗項）
**報告產出時間**：2026-10-09
**HEAD（修復前後皆未變動）**：`e5c044244475d18930f32e26696d2cf9cf43dfa6`

---

## 一、修改檔案清單

本輪**只做 P1 最小修復**，未新增功能分支、未修改 v1.5C、未動正式資料庫與正式 Migration。

| # | 檔案 | 動作 | 說明 |
|:-:|------|:----:|------|
| 1 | `student_portal/learning/golden_set_guard.py` | **新增** | Model 層不可變性守衛（本次修復主體） |
| 2 | `student_portal/learning/models.py` | 修改（+2 行 import、+14 行掛載） | 於檔尾呼叫 `golden_set_guard.install()`；新增 `import sys` |
| 3 | `student_portal/learning/golden_set.py` | 修改（+1 import、+5 行註解/解鎖） | `freeze_golden_set()` 的 Manifest 收尾寫入改用一次性許可 |
| 4 | `student_portal/learning/tests/test_golden_set_immutability.py` | **新增** | 42 項對抗性測試（A–L 全部入口） |
| 5 | `student_portal/learning/tests/test_golden_set_center.py` | 修改 1 個測試 | `test_h5` 由「記錄缺口」改為「斷言已修復」 |
| 6 | `student_portal/learning/tests/test_golden_set_contract.py` | 修改 1 個測試 | `test_5b` 改用原生 SQL 驗證偵測能力（ORM 路徑已改為斷言被擋） |

**未修改（明確認列）**：

- `.pt` 推論／訓練程式：**0 行**
- Live Coach、Flight Health、HQGC：**0 行**
- 正式資料庫 `student_portal/db.sqlite3`：**未開啟寫入**
- 正式 Migration：**未新增、未執行**
- v1.5C 穩定分支與其 worktree：**未觸碰**
- 前端 `live/`、`src/`：**未觸碰**

---

## 二、缺陷根因

### 2.1 缺陷描述（第 24 輪 S7 原始記錄）

FROZEN 的不可變性**只在服務層（`golden_set.py`）與 View 層檢查**，Model 層完全沒有防護。
任何繞過服務層的 ORM 寫入都會成功：

```python
s = GoldenSetSample.objects.get(pk=...)   # 父集合已 FROZEN
s.label = "CCW_B"
s.full_clean()      # 不拋錯
s.save()            # 成功（不該成功）
s.delete()          # 成功（不該成功；樣本 4 → 3）
```

結果是**「偵測得到、但擋不住」**：`manifest_binding_status` 會變成 `MISMATCH`，
可是資料已經被改壞，且無法還原。

### 2.2 根因定位

| 層級 | 修復前狀態 |
|------|-----------|
| View 層 | ✅ 有檢查（`teacher_golden_set_detail` 等頁面顯示 `mutation_blocked_reason`） |
| 服務層 | ✅ 有檢查（`add_sample()` / `confirm_sample()` / `reject_sample()` 皆 raise `GOLDEN_SET_FROZEN`） |
| **Model 層** | ❌ **完全沒有防護** |

具體缺口（讀 `models.py` 確認）：`GoldenSetSample` 只有 `__str__` 與 `Meta`，
**沒有 `save()`、沒有 `delete()`、沒有自訂 Manager / QuerySet**。
`GoldenSet` 本身同樣沒有任何 `save()`／`delete()` 守衛。
既有 DB 限制只有 CheckConstraint（稽核欄位存在性、task_id 合法性），**沒有 Trigger、沒有不可變條件**。

---

## 三、修復方法

### 3.1 設計原則

- **最小修改**：不改任何既有欄位、不改任何 Migration、不改服務層函式簽名。
- **不動資料庫結構**：不新增 Trigger、不新增 Manager 到 Migration 狀態。
- **不破壞既有行為**：DRAFT 流程、服務層錯誤碼、View 文案全部保持不變。

### 3.2 實作（新增 `golden_set_guard.py`）

於 `models.py` **檔尾**（所有模型定義完成後）呼叫 `install()`，把守衛掛上：

| # | 攔截入口 | 實作方式 |
|:-:|---------|---------|
| 1 | `GoldenSetSample.save()` | 覆寫實例方法；父集合 FROZEN 即 raise |
| 2 | `GoldenSetSample.delete()` | 覆寫實例方法；父集合 FROZEN 即 raise |
| 3 | `QuerySet.update()` | 覆寫 `models.QuerySet.update` |
| 4 | `QuerySet.delete()` | 覆寫 `models.QuerySet.delete` |
| 5 | `QuerySet.bulk_update()` | 覆寫 `models.QuerySet.bulk_update` |
| 6 | `QuerySet.bulk_create()` | 覆寫 `models.QuerySet.bulk_create` |
| 7 | `Manager.create()` / `bulk_create()` / `get_or_create()` | 覆寫 `models.Manager.*` |
| 8 | `QuerySet.get_or_create()` | 覆寫（Manager 於類別建立時已複製此方法，須兩處都攔） |
| 9 | `GoldenSet.save()` | FROZEN 後禁止改動契約欄位 |
| 10 | `GoldenSet.delete()` / `QuerySet.delete()` | FROZEN 時禁止刪除版本（會 CASCADE 刪樣本） |

**為什麼覆寫 `models.QuerySet` 而非換 Manager**：
`ModelBase` 在類別建立時就把 `objects` 綁定為 `Manager.from_queryset(QuerySet)` 的產物；
事後 `add_to_class("objects", ...)` 或改 `_meta.default_manager_name` **實測無效**。
改為覆寫基底類別方法、並在方法內以 `self.model._meta.label_lower` 判斷是否為目標模型，
可涵蓋所有 QuerySet 派生結果（`filter()` / `values()` / `all()` / related manager `.samples.*`），
對其他模型完全透明（非目標模型直接走原方法，行為零改變）。

### 3.3 兩個關鍵技術決策

**(A) FROZEN 判定一律回查資料庫，不信任記憶體**

```python
def _sample_parent_frozen(instance) -> bool:
    set_id = getattr(instance, "golden_set_id", None)
    if not set_id:
        return False
    GoldenSet = instance.__class__.golden_set.field.related_model
    row = GoldenSet.objects.filter(pk=set_id).values_list("status", flat=True).first()
    return row == "FROZEN"
```

這可擋下最真實的競態：「先載入 DRAFT 實例 → 他處完成鎖定 → 再用舊實例寫入」。

**(B) 鎖定一次性許可（sealed capability）**

`freeze_golden_set()` 的寫入分兩步：先寫入 `status=FROZEN`，再回寫剛算出的 `manifest_sha256`。
第二步在守衛眼中就是「對 FROZEN 列改動契約欄位」——若一律拒絕，**連合法鎖定流程都會被自己擋死**
（本輪實際發生過，已修正）。

因此提供一個**受限於當次交易、且只能成功一次**的許可：

- 僅在 `transaction.atomic()` 區塊內有效；
- 一旦用掉（consumed）即刻失效，無法在同一交易內二次寫入；
- 離開交易即自動清除；
- 開啟函式要求傳入模組私有 token，外部呼叫端無法偽造。

### 3.4 同時發現並修正的一個設計細節

原本我將 `name` 列入「FROZEN 後仍可改」的欄位。實測發現 `build_manifest()` **有把 `name` 寫入 Manifest**，
因此改名會直接造成 `MISMATCH`。已修正允許清單為 `{updated_at, description}`（僅 `description` 不在 Manifest 中）。

---

## 四、測試證據

### 4.1 對抗性測試（新增，42 項）

`learning.tests.test_golden_set_immutability` — 覆蓋指令要求的每一個入口：

| 群組 | 內容 | 結果 |
|------|------|:----:|
| 0 | 守衛掛載確認、殘餘風險清單非空 | 2/2 |
| A | `save()` 被擋（含 `update_fields`、`full_clean` 後） | 3/3 |
| B | 實例 `delete()` 被擋 | 1/1 |
| C | `QuerySet.update()` 被擋（單筆／全集合／關聯過濾） | 3/3 |
| D | `QuerySet.delete()` 被擋（全集合／依 label） | 3/3 |
| E | `bulk_update()` 被擋 | 1/1 |
| F | `bulk_create()` / `create()` / `get_or_create()` 被擋；既有列命中不誤擋 | 5/5 |
| G | 併發：4 執行緒全擋；舊實例繞過被擋；惰性 QuerySet 被擋 | 4/4 |
| H | FROZEN 版本：status 回退／改 Manifest／改 frozen_at／刪除 皆被擋 | 5/5 |
| I | Manifest SHA256：BOUND、可重現、被擋寫入不改變雜湊、原生 SQL 仍可偵測 | 4/4 |
| J | FROZEN 正常操作不受影響（讀取、審核、服務層錯誤碼、文案） | 5/5 |
| K | DRAFT 完全不受影響（save/update/bulk_update/delete/服務層/改名/刪除） | 4/4 |
| L | 殘餘風險已明確記錄（原生 SQL、無 Trigger） | 2/2 |

```
Ran 42 tests in 38.514s
OK
```

### 4.2 既有 Golden Set 套件回歸（105 項 → 更新後）

`test_golden_set_center` + `test_golden_set_contract`：

```
Ran 147 tests in 232.260s
OK
```

（147 = 兩套既有 105 項 + 本輪新增 42 項一併執行時的總數；既有 105 項全數通過。）

### 4.3 服務層端到端複驗（指令「四」的 10 項）

`.test-temp/acceptance-r24/r25_verify.py` — **10/10 PASS**

| # | 項目 | 結果 | 證據 |
|:-:|------|:----:|------|
| 1 | FROZEN 正常運作 | ✅ | samples=4 confirmed=4 missing=[] |
| 2 | ORM 修改與刪除被擋 | ✅ | save✓ delete✓ save(update_fields)✓ |
| 3 | 批量更新與刪除被擋 | ✅ | update✓ delete✓ bulk_update✓ bulk_create✓ create✓ |
| 4 | 併發修改被擋 | ✅ | successes=[] blocked=4 |
| 5 | Manifest SHA256 一致 | ✅ | BOUND，sha256 前後相同 |
| 6 | R07 提交（離線時明確失敗） | ✅ | `RuntimeError(vision_submission_unavailable)` |
| 7 | 教師審核正常 | ✅ | DRAFT confirm/reject 成功；FROZEN 被擋 |
| 8 | Golden Set 建立與鎖定正常 | ✅ | status=FROZEN samples=4 frozen_by 正確 |
| 9 | 完整回歸測試 | ✅ | 576 tests，FAIL 1（既有無關項）、ERROR 0、SKIPPED 26；與基準逐項一致，見 4.4 |
| 10 | 正式 DB / JSON Store 前後一致 | ✅ | 見 4.5 |

### 4.4 完整回歸（指令「四」第 9 項）

```
cd student_portal && manage.py test learning --verbosity=1
```

| 指標 | 第 24 輪基準 | 本輪（第 25 輪） | 差異 | 判定 |
|------|------------:|----------------:|-----:|:----:|
| **Total** | 534 | **576** | +42 | ✅ 恰為本輪新增測試數 |
| **PASS** | 507 | **549** | +42 | ✅ |
| **FAIL** | 1 | **1** | 0 | ✅ 未新增任何失敗 |
| **ERROR** | 0 | **0** | 0 | ✅ |
| **SKIPPED** | 26 | **26** | 0 | ✅ |
| **執行時間** | 1326.637s | 1356.763s | +30.1s | 環境負載差異，非程式問題 |

原始輸出（逐字）：

```
Ran 576 tests in 1356.763s

FAILED (failures=1, skipped=26)
Destroying test database for alias 'default'...
Found 576 test(s).
System check identified no issues (0 silenced).
```

**唯一失敗項為既有、無關且依指令不得修改者**：

```
FAIL: test_platform_hero_action_opens_student_growth_portal
      (learning.tests.test_auth.StudentRegistrationTests
       .test_platform_hero_action_opens_student_growth_portal)
File "student_portal/learning/tests/test_auth.py", line 104
  self.assertIn("label: '我的學習日誌'", source)
AssertionError: "label: '我的學習日誌'" not found in
  "...{ label: '我的成長日誌', target: '/student/growth/', kind: 'primary' }..."
```

- 本項與第 24 輪基準為**同一項、同一斷言、同一原因**（測試期望 `我的學習日誌`，實際產品文案為 `我的成長日誌`）。
- 依指令「不得為了測試全綠擅自修改無關產品或測試」，**本輪維持原狀，未修改**。
- 本輪所有修改（Golden Set 不可變性）與此失敗項**無任何關聯**。

### 4.5 正式資源完整性（指令「四」第 10 項）

| 資源 | 修復前 SHA256 | 修復後 SHA256 | 結論 |
|------|---------------|---------------|------|
| `student_portal/db.sqlite3` | `1fa462fef825980eb1808cc7f3535d336240c41b91ebc440031d156d9c19c133` | 同左 | **完全一致** |
| 正式 Vision Center JSON Store | `7b3f674fbca0e6a13f2f154d5dddd926ecc9506e486926d3009ee5ae02615c36` | 同左 | **完全一致** |

- 正式 DB mtime：`2026-10-07 19:08:32`（未變）
- 正式 JSON Store mtime：`2026-10-08 12:37:51`（未變），`golden_sets: 0`、`submissions: 3`
- 既有服務未被接管：`127.0.0.1:8022` PID 21360、`127.0.0.1:8770` PID 14640 全程 LISTENING

### 4.6 R07 離線失敗與資料回滾（指令「三」第 2 項）

獨立精確驗證（`r25_r07_rollback_precise.py`，隔離 DB／MEDIA，`VISION_URL=http://127.0.0.1:9`）：

```
VISION URL          : http://127.0.0.1:9
error message shown : True
success message     : False
Evidence delta      : 0
new files on disk   : 0
submission status   : not_started

RESULT: PASS — R07 失敗時 DB 與檔案皆完整回滾
```

**四項全部正確**：顯示失敗訊息、無成功訊息、DB 回滾（Evidence +0）、
MEDIA 無殘留檔案、提交狀態未推進。

> **過程記錄（測試假象，非產品缺陷）**：本項驗證初次執行時曾誤判為「提交成功」。
> 根因是**環境中有 `HTTP_PROXY`（WorkBuddy 服務代理 `127.0.0.1:55957`）**，
> Python `urlopen` 把 `127.0.0.1:9` 的請求也送進代理，代理回了看似成功的回應；
> 另有一個**殘留的 `runserver` 佔用 8099 埠**，導致請求打到舊伺服器（用了預設 8030 端點）。
> 兩者皆已排除（清空代理變數 + 加入埠佔用前置檢查），
> 並已在腳本中固化為防護，確保不再誤判。此為測試工具問題，與產品程式無關。

---

## 五、交付環境檢查（指令「三」）

### 5.1 Django 與 Live Backend 啟動順序

| 檢查項 | 結果 |
|--------|------|
| Django 是否依賴 Live Backend 啟動 | **否**。`settings.py` 只把上游位址當字串設定（`PUBLIC_RAG_UPSTREAM_URL`、`PUBLIC_INSPECTION_UPSTREAM_URL`、`VISION_SUBMISSION_API_BASE_URL`），啟動時不建立連線，也不檢查可達性 |
| Live Backend 是否依賴 Django | **是（單向）**。`live_backend/app/main.py` 的 `django_portal_proxy` 會把 `/login/`、`/register/`、`/logout/` 等路徑轉發到 `FDE_DJANGO_PORTAL_URL`（預設 `http://127.0.0.1:8022`），且硬編碼 `headers["host"] = "127.0.0.1:8022"` |

**結論**：**Live Backend 依賴 Django，Django 不依賴 Live Backend。**
啟動順序應為 **先 Django（:8022）→ 再 Live Backend**；
R07 上傳另需 Vision Submission 服務（:8030）在線，否則提交會明確失敗（見 4.6）。

### 5.2 三套 Golden Set 資料來源是否已接線

**明確回答：三套資料來源仍未接線。**

| # | 實作 | 位置 | 接線狀態 |
|:-:|------|------|---------|
| 1 | Django `GoldenSet` + `GoldenSetSample`（ORM/SQLite） | `learning/models.py` | **唯一的真實來源**，但僅供教師後台使用 |
| 2 | `golden_sets[]` JSON 註冊表 | `live_backend/app/vision_center.py` | **未接線**。正式 JSON Store 仍為 `golden_sets: 0` |
| 3 | `PropValidationSet`（filesystem manifest） | `live_backend/app/benchmark.py` | **未接線**。Django 端無任何呼叫 |

**跨系統唯一呼叫點**：`learning/vision_submission.py:26` → `POST /api/v1/vision/submissions`，
即 R07 的 `.pt` 提交。**除此之外沒有任何 Django → Live Backend 的 Golden Set 資料流。**

本輪**未新增**任何 Golden Test 推論功能，**未載入任何 `.pt`**。

### 5.3 資料庫 Migrations 狀態

| 環境 | 狀態 |
|------|------|
| **正式 DB** `student_portal/db.sqlite3` | **僅到 `0015`**。`0016`/`0017`/`0018`/`0019` **從未套用**；正式庫中**不存在** `learning_visionmodelrecord` / `learning_goldenset*` 資料表 |
| 隔離驗收 DB | 已套用至 `0019`（`.test-temp/acceptance-r24/db/acceptance.sqlite3`） |

本輪 `makemigrations --check --dry-run` → **`No changes detected`**（守衛不產生 Migration 漂移）。

---

## 六、未涵蓋風險（殘餘風險）— **不得宣稱完全防護**

本守衛屬 **ORM / Python 應用層**防護。以下途徑**不受保護**，已於程式碼與測試中明確記錄
（`golden_set_guard.residual_risks()`，並由 `test_l1`/`test_l2` 斷言）：

| # | 未受保護的途徑 | 說明 |
|:-:|---------------|------|
| 1 | **原生 SQL** | `connection.cursor().execute("UPDATE ...")` 完全繞過 ORM。實測可寫入成功 |
| 2 | `QuerySet.raw()` / `.extra()` | 其中夾帶的寫入語句不受攔截 |
| 3 | **外部工具** | 直接以 sqlite3 CLI、DB Browser、psql 改寫資料庫檔案 |
| 4 | **未載入 `learning.models` 的其他行程** | 守衛是行程內的 monkey-patch，管不到別的行程 |
| 5 | **SQLite 無 Trigger** | 本專案**未建立任何 DB Trigger**（實測 `sqlite_master` 中 trigger 數為 **0**），資料庫檔案層級的不可變性**未受保證** |

**這些情形仍會被 `manifest_binding_status` 偵測為 `MISMATCH`**（偵測能力為第 24 輪既有，本輪未破壞，
並由 `test_i4` / `test_5b` 以原生 SQL 實證），**但不會被本守衛阻擋**。

**未建立 DB Trigger 的理由**：
本輪要求「最小修改、不動資料庫結構、不執行正式 Migration」。
在 SQLite 上建立 Trigger 屬結構變更，且 SQLite Trigger 無法可靠辨識「合法的鎖定收尾寫入」與「惡意寫入」，
誤擋風險高。若需真正的資料庫層不可變性，建議在**正式 PostgreSQL** 上另立 Trigger 與權限設計
（例如撤銷 `UPDATE/DELETE` 權限、改用 append-only 表 + 檢視），此屬**本輪範圍外**。

---

## 七、正式 Migration 前置條件

本輪程式碼變更**不新增任何 Migration**（`makemigrations --check` 為 `No changes detected`）。
但若要把 Golden Set 功能正式上線到正式環境，**仍必須先處理以下前置條件**：

1. **備份**：`student_portal/db.sqlite3` 與正式 Vision Center JSON Store 必須先完整備份並驗證可還原
   （程序見 `docs/delivery/05-BACKUP-RESTORE.md`）。
2. **停機窗口**：Migration 期間需停止 Django 寫入（避免 `0016`~`0019` 套用時併發寫入）。
3. **Migration 內容確認**：`0016`~`0019` 全部為 `CreateModel` / `AddField`，**無破壞性操作**
   （無 `DeleteModel`、無 `RemoveField`、無資料轉換）。此點已逐檔確認。
4. **套用方式**：`manage.py migrate learning`，並於套用後驗證四張新表存在。
5. **`.pt` 保護**：正式環境仍**嚴禁**載入／反序列化任何 `.pt`；只允許 byte-stream SHA256。
6. **上游服務**：R07 提交需 Vision Submission（:8030）在線；離線時學生會看到明確失敗訊息（已驗證）。
7. **回滾方案**：若需回退，`0019`→`0016` 可用 `migrate learning 0015` 反向套用
   （因皆為建表/加欄，反向為刪表/刪欄，**會遺失新表資料**，須先備份）。

> **本輪未執行任何正式 Migration，未開啟正式資料庫寫入。**

---

## 八、是否達到交付前驗收標準

### 8.1 逐條對照指令要求

| 指令要求 | 結果 |
|---------|:----:|
| FROZEN 後不得新增／修改／刪除 `GoldenSetSample` | ✅ 已達成 |
| 不得修改已鎖定的標籤、圖片、確認狀態及 Manifest | ✅ 已達成 |
| 檢查 `save()`／`delete()`／`QuerySet.update()`／`QuerySet.delete()`／`bulk_update()`／`bulk_create()` | ✅ 全數覆蓋並實證被擋（另含 `create`／`get_or_create`／關聯刪除） |
| 評估是否需要資料庫 Trigger 或其他資料庫層防護 | ✅ 已評估；**結論為本輪不建立**，理由與建議見第六節 |
| 防止併發操作繞過鎖定 | ✅ 4 執行緒全擋；舊實例與惰性 QuerySet 繞道皆被擋 |
| 保留原有 Manifest SHA256 驗證 | ✅ 保留且未破壞（BOUND／可重現／仍能偵測竄改） |
| 如無法保證直接 SQL 的不可變性，必須明確列為殘餘風險，**不得宣稱完全防護** | ✅ 已於程式碼 docstring、`residual_risks()`、測試 `test_l1`/`test_l2`、本報告第六節**三處明確記錄** |
| 所有修改及測試只在隔離環境進行 | ✅ 全部在 `.test-temp/acceptance-r24/` 之下；正式資源 SHA256 前後一致 |
| 不新增功能分支／不動 v1.5C／不動正式 DB／不跑正式 Migration | ✅ 全部遵守 |
| 不啟動 YOLO 訓練或 `.pt` 推論 | ✅ 未觸發；`.pt` 僅做 byte 傳輸，從未載入或反序列化 |
| 不動 Live Coach／Flight Health／HQGC | ✅ 0 行變更 |
| 不 Commit／Push／Merge／Deploy | ✅ 全部未執行；HEAD 仍為 `e5c04424` |
| 產出 `P1_REPAIR_ACCEPTANCE_REPORT.md`（7 項內容） | ✅ 本報告 |

### 8.2 最終結論

> ## **P1 修復：AUTOMATED PASS**
>
> ## **人工 iPhone 驗收：PENDING**
>
> ## **不得自行正式部署。**

**理由**：

1. 缺陷根因已定位（Model 層完全無防護），修復已實作並以 42 項對抗性測試 + 105 項既有回歸 + 10 項服務層端到端複驗涵蓋。
2. 所有指令要求的 ORM 入口均實證被擋；併發與舊實例繞道亦被擋。
3. 原有 Manifest SHA256 驗證能力完整保留且未破壞。
4. **殘餘風險（原生 SQL、外部工具、SQLite 無 Trigger）已誠實揭露，未宣稱完全防護。**
5. 正式 DB 與 JSON Store SHA256 前後一致；HEAD 未變動；未 Commit／Push／Merge／Deploy。

**尚未完成（不得視為已驗收）**：

- **人工 iPhone 實機驗收：PENDING**。本輪為自動化驗收，尚未在真實 iPhone 上執行 Golden Set 教師流程。
- 殘餘風險的資料庫層防護（Trigger／權限）尚未實作，屬後續輪次範圍。
- 正式 Migration（`0016`~`0019`）尚未套用。

**依指令要求，本輪於此停止，等待核准。不得自行正式部署。**

---

## 附錄 A｜完整回歸原始輸出

見 `.test-temp/acceptance-r24/logs/r25-regression.txt`（逐字輸出）。
基準比對見第 4.4 節。

## 附錄 B｜本輪驗收腳本與日誌

| 檔案 | 用途 |
|------|------|
| `.test-temp/acceptance-r24/r25_verify.py` | 服務層 10 項端到端複驗 |
| `.test-temp/acceptance-r24/r25_r07_offline.py` | R07 離線失敗與回滾（HTTP 全鏈路） |
| `.test-temp/acceptance-r24/r25_r07_rollback_precise.py` | R07 回滾精確驗證（DB + MEDIA 快照） |
| `.test-temp/acceptance-r24/logs/r25-service-verify.json` | 10/10 PASS 結構化結果 |
| `.test-temp/acceptance-r24/logs/r25-r07-rollback.json` | R07 回滾結果 |
| `.test-temp/acceptance-r24/logs/r25-regression.txt` | 完整回歸逐字輸出 |
| `.test-temp/acceptance-r24/logs/r25-center.txt` / `r25-golden2.txt` | Golden Set 套件輸出 |
