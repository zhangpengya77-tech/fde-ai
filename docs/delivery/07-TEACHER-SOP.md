# FDE-AI-UAS 2.0 交付文件｜07 教師操作 SOP

**文件版本**：v1.0（交付驗收階段產出）
**產出日期**：2026-10-09
**依據**：【正式交付驗收指令】第七條第 9 項
**驗證狀態**：**全部流程已於真實瀏覽器實測（B 系列 10/10 PASS）**

---

## 一、適用對象與前置條件

| 項目 | 說明 |
|---|---|
| 適用對象 | 教師（具 Cohort 歸屬） |
| 前置條件 | Django :8022 與 Live Backend :8030 **同時在線** |
| 瀏覽器 | Chrome / Safari（已測 Chrome 155） |
| 登入入口 | `http://<主機>:8022/teacher/login/` |

> **⚠️ 教師帳號必須歸屬於特定 Cohort。**
> 系統以 Cohort 為隔離依據，教師**無法存取其他班級的資料**（已實測 404）。

---

## 二、SOP 總覽

```
┌────────────────────────────────────────────────────────┐
│  教師日常作業流程                                        │
├────────────────────────────────────────────────────────┤
│  1. 登入教師後台                                        │
│  2. 檢視學員 R07 模型提交                                │
│  3. 審核（退回補件 / 列為候選）                           │
│  4. 收藏候選模型至倉庫（建立 V1 不可變快照）               │
│  5. 執行模型完整性檢查                                   │
│  6. 管理 Golden Set（建立 / 上傳 / 確認 / 凍結）          │
│  7. 檢視 Golden Test 前置條件                            │
└────────────────────────────────────────────────────────┘
```

---

## 三、步驟 1：登入教師後台

| 項目 | 內容 |
|---|---|
| **URL** | `/teacher/login/` |
| **路由名稱** | `teacher_login` |
| **操作** | 輸入教師帳密 → 送出 |
| **成功後** | 導向 `/teacher/` |
| **驗收結果** | **PASS**（B1） |

---

## 四、步驟 2：檢視學員 R07 模型提交

| 項目 | 內容 |
|---|---|
| **URL** | `/teacher/vision-models/` |
| **路由名稱** | `teacher_vision_model_list` |
| **操作** | 檢視清單中來自學員 R07 提交的模型 |
| **應顯示** | 原始檔名、提交學員、所屬班級、審核狀態 |
| **驗收結果** | **PASS**（B2）— 清單正確出現 `fake-model-acc.pt` |

### 2.1 檢視詳情

| 項目 | 內容 |
|---|---|
| **URL** | `/teacher/vision-models/<evidence_id>/` |
| **路由名稱** | `teacher_vision_model_detail` |
| **應顯示** | 版本（V1）、四狀態維度（各自獨立）、SHA256、快照狀態 |
| **驗收結果** | **PASS**（B3） |

> **四狀態維度互相獨立**（設計重點）：
> `review_status`（審核）／`validation_status`（驗證）／
> `deployment_status`（部署）／`training_usage`（訓練用途）

### 2.2 ⚠️ 班級隔離（安全機制）

**不同班級的教師無法存取他班的 Candidate。**

| 情境 | 結果 |
|---|---|
| Teacher-A 存取本班 Evidence | HTTP 200 |
| **Teacher-B 存取他班 Evidence** | **HTTP 404**「No Evidence matches the given query.」 |

**阻擋位置**：**queryset 層**（`teacher_model_evidence_queryset(request.user)`），
**非**模板層隱藏 —— 屬正確的縱深防禦。
**驗收結果**：**PASS**（B4 / S8）

---

## 五、步驟 3：審核（退回補件 / 列為候選）

| 項目 | 內容 |
|---|---|
| **URL** | `/teacher/vision-models/<evidence_id>/review/` |
| **路由名稱** | `teacher_vision_model_review` |

### 3.1 ⚠️ 操作要點（實作細節）

`action` 是 **submit button 的 name/value**，**不是** hidden input：

```html
<button name="action" value="candidate">列為候選</button>
<button name="action" value="return">退回補件</button>
```

### 3.2 兩種動作

| 動作 | value | 結果狀態 | 用途 |
|---|---|---|---|
| **退回補件** | `return` | `RETURNED` | 要求學員重新提交 |
| **列為候選** | `candidate` | `CANDIDATE` | 進入收藏流程 |

### 3.3 歷史歷程

每次審核都寫入 `vision_model_review.history`，**保留完整歷程**。

| 項目 | 內容 |
|---|---|
| 驗收結果 | **PASS**（B7 退回 → `RETURNED`；B8 候選 → `CANDIDATE`） |
| 持久化 | **PASS**（B10 重新登入後狀態仍存在） |

---

## 六、步驟 4：收藏候選模型至倉庫

| 項目 | 內容 |
|---|---|
| **URL** | `/teacher/vision-models/<evidence_id>/catalogue/` |
| **路由名稱** | `teacher_vision_model_catalogue` |
| **前置條件** | 狀態必須為 **`CANDIDATE`**（否則不顯示表單） |

### 4.1 收藏後的行為

| 項目 | 結果 |
|---|---|
| 建立 `VisionModelRecord` | V1 版本 |
| `snapshot_status` | `STORED`（**不可變快照已建立**） |
| `snapshot_sha256` | 內容定址雜湊 |
| `deployment_status` | `CATALOGUED` |
| `validation_status` | `NOT_EVALUATED` |

**驗收結果**：**PASS**（B9）

> **不可變快照**：建立後內容定址，任何變更都會被完整性檢查偵測為 `MISMATCH`。

### 6.2 檢視模型倉庫

| 項目 | 內容 |
|---|---|
| **URL** | `/teacher/vision-flywheel/` |
| **路由名稱** | `teacher_vision_flywheel` |
| **應顯示** | 入庫模型數量、各模型狀態 |
| **驗收結果** | **PASS**（B5、B6） |

---

## 七、步驟 5：執行模型完整性檢查

| 項目 | 內容 |
|---|---|
| **URL** | `/teacher/vision-models/<evidence_id>/verify/` |
| **路由名稱** | `teacher_vision_model_verify` |
| **執行端點** | `/teacher/vision-models/<evidence_id>/verify/run/` |

### 5.1 檢查結果對照

| 結果 | 意義 | 處理 |
|---|---|---|
| `INTACT` | 快照雜湊與 DB 記錄一致 | 正常 |
| `MISMATCH` | 檔案內容與 DB 記錄不符 | **立即調查**（可能遭竄改或損毀） |
| `MISSING` | 檔案不存在 | **檢查 MEDIA 儲存** |

**驗收結果**：**PASS**（B11 / B12）→ `INTACT`

> **重要特性**：完整性檢查為**唯讀重算**，**不會載入 `.pt`**。
> 全程僅做位元組串流 + SHA256，**不執行反序列化**（安全設計）。
> 已實測：`torch.load` / `pickle.load` 命中數 = **0**（S10 PASS）。

---

## 八、步驟 6：管理 Golden Set

### 6.1 開啟 Golden Set 清單

| 項目 | 內容 |
|---|---|
| **URL** | `/teacher/golden-sets/` |
| **路由名稱** | `teacher_golden_set_list` |
| **驗收結果** | **PASS**（C1） |

### 6.2 建立測試集版本

| 項目 | 內容 |
|---|---|
| **URL** | `/teacher/golden-sets/create/` |
| **路由名稱** | `teacher_golden_set_create` |
| **操作** | 填寫版本名稱 → 建立（初始狀態 `DRAFT`） |
| **驗收結果** | **PASS**（C2）— 實測建立 `PROP_GOLDEN_vACC-v1` |

> **提示**：Create 表單也嵌於清單頁，可從清單頁直接提交。

### 6.3 上傳樣本與確認

| 動作 | URL | 路由名稱 |
|---|---|---|
| **上傳樣本** | `.../samples/` | `teacher_golden_set_add_sample` |
| **確認樣本** | `.../samples/<sample_id>/confirm/` | `teacher_golden_sample_confirm` |

**四類標籤**（F450 方向分類）：

| 標籤 | 意義 |
|---|---|
| `CW_F` | 順時針 / 前側 |
| `CCW_F` | 逆時針 / 前側 |
| `CW_B` | 順時針 / 後側 |
| `CCW_B` | 逆時針 / 後側 |

**驗收結果**：**PASS**（C3 上傳 4 張、C4 四類齊備、C5 教師確認 4/4 CONFIRMED）

### 6.4 ⚠️ 兩級完整度（**重要觀念**）

系統採**兩級完整度**，切勿混淆：

| 級別 | 條件 | 意義 |
|---|---|---|
| `INCOMPLETE` | 四類標籤未齊 | 無法凍結 |
| **`STRUCTURAL_COMPLETE`** | **四類標籤齊備** | **可凍結，但尚不可正式評估** |
| `EVALUATION_READY` | FROZEN **且**每類 ≥ 2 張已確認樣本 | 可正式評估 |

**凍結後若為 `STRUCTURAL_COMPLETE`，頁面會誠實顯示**：

```
完整度：結構完整（尚不可正式評估）
  結構已完整且已鎖定，但每類至少需 2 張已確認樣本才可正式評估；
  目前不足：CW_F（1 張）、CCW_F（1 張）、CW_B（1 張）、CCW_B（1 張）。
```

> **這是刻意的誠實設計**：避免把「有東西」謊報為「可用」。

### 6.5 凍結測試集

| 項目 | 內容 |
|---|---|
| **URL** | `/teacher/golden-sets/<golden_set_id>/freeze/` |
| **路由名稱** | `teacher_golden_set_freeze` |

| 情境 | 結果 | 驗收 |
|---|---|---|
| 四類未齊 | **按鈕 disabled + 後端阻擋** | **PASS**（C6） |
| 四類齊備 | 成功凍結 → `FROZEN` | **PASS**（C7） |
| 凍結後再上傳 | 頁面不再渲染上傳欄位，樣本數不變 | **PASS**（C8，View 層） |

**凍結後頁面顯示**：
> 此測試集版本已鎖定（FROZEN），不得再新增、修改或刪除樣本。

### 6.6 ⚠️ FROZEN 不可變性的**已知限制**（必讀）

| 層級 | 狀態 |
|---|---|
| **View 層**（UI + 表單） | ✅ **正確阻擋** |
| **Model 層**（ORM 直攻） | ❌ **無守衛（P1 缺陷，已記錄）** |

**已實測的缺陷**：

```python
s.label = 'CCW_B'
s.full_clean()   # ← 未拋出 ValidationError
s.save()         # ← 成功
s.delete()       # ← 成功（samples 4 → 3）
```

**Manifest 會在事後判為 `MISMATCH`（偵測），但無法阻止（Prevention）。**

> **操作建議**：**不要**以 ORM / shell 直接操作 FROZEN 的 Golden Set。
> 所有變更一律透過教師後台 UI。
> 修復建議見 `DELIVERY_ACCEPTANCE_REPORT.md` 缺陷清單 P1-1。

### 6.7 檢視 Manifest SHA256

**URL**：`/teacher/golden-sets/<golden_set_id>/`

| 項目 | 實測值 |
|---|---|
| Manifest SHA256 | `a1a15c8f796f62249357ca6d87440475ab39fec1034010fbd7e04cb58c9b98fa` |
| 契約版本 | `GOLDEN_SET_CONTRACT_V1` |
| canonical bytes | 2,034 |
| binding 狀態 | `BOUND` |

**驗收結果**：**PASS**（C9）；重新登入後版本仍存在 **PASS**（C10）

> Manifest 使用 `sort_keys + compact JSON` 產生 canonical bytes，
> 因此**任何環境重算都應得到相同 SHA256**（可重複驗證）。

---

## 九、步驟 7：檢視 Golden Test 前置條件

| 項目 | 內容 |
|---|---|
| **URL** | `/teacher/vision-repository/<model_id>/golden-test/` |
| **路由名稱** | `teacher_golden_test_page` |
| **驗收結果** | **PASS**（D1） |

### 9.1 前置條件規則（**服務層自驗證**）

| 規則 | 說明 | 驗收 |
|---|---|---|
| 僅接受 **FROZEN** 測試集 | DRAFT 不可選 | **PASS**（D4） |
| **task_id 必須相符** | 不同任務不可混用 | **PASS**（D5） |
| 無真實結果 → 不得 `VALIDATED` | — | **PASS**（D6） |
| 無合格結果 → 不得 `ACTIVE` | — | **PASS**（D7） |

**task_id 不符時的實際錯誤訊息**：
> 「…與模型任務 FOUR_SIDE_HOVER 不相容，不可混用。」

### 9.2 ⚠️ 頁面顯示的清單**不作為安全判斷依據**

頁面原文：
> 以下判斷由服務層自行查詢資料庫重新驗證…本頁顯示的清單不作為安全判斷依據。

**已實測**：傳入偽造的 FROZEN 清單，結果與傳 `None` **完全相同**
→ **呼叫端提供的清單不被信任**（正確的安全設計）。

### 9.3 本頁**不執行**任何推論

頁面原文：
> 本頁為框架預留：呈現評估所需欄位與前置條件，**本輪不執行推論、不載入 .pt、不變更任何模型狀態**。

**執行按鈕狀態**：`執行 Golden Test（尚未實作）` ← 存在但**不可用**

**驗收結果**：**PASS**（D8）— 實測資料庫：
```
validation_status   = NOT_EVALUATED
golden_test_summary = {}
validation_history  = []
deployment_status   = CATALOGUED
```
**未產生任何偽造的 Precision / Recall / mAP。**

---

## 十、⚠️ 教師後台「尚未實作」的功能

視覺模型中心**誠實列出**以下未啟用功能（原文）：

> - 圖片驗證推論：未啟用（無可靠模型隔離沙箱）。
> - Golden Test 執行：未啟用（需 Golden Set 真實樣本）。
> - ACTIVE 模型發布：未啟用（需通過驗證並由教師明確操作）。
> - 收藏至訓練模型倉庫：預留入口，尚未開放寫入。

> **這是正面訊號**：系統未把「框架預留」包裝成「已完成」。
> 教師操作時請以此為準，**勿期待這些功能可用**。

---

## 十一、教師操作檢查清單

| # | 步驟 | URL | 完成 |
|---|---|---|---|
| 1 | 登入教師後台 | `/teacher/login/` | ☐ |
| 2 | 檢視 R07 提交清單 | `/teacher/vision-models/` | ☐ |
| 3 | 檢視 Candidate 詳情 | `/teacher/vision-models/<id>/` | ☐ |
| 4 | 退回補件（如需要） | `.../review/`（action=return） | ☐ |
| 5 | 列為候選 | `.../review/`（action=candidate） | ☐ |
| 6 | 收藏至倉庫 | `.../catalogue/` | ☐ |
| 7 | 檢視飛輪 | `/teacher/vision-flywheel/` | ☐ |
| 8 | 執行完整性檢查 | `.../verify/run/` | ☐ |
| 9 | 建立 / 管理 Golden Set | `/teacher/golden-sets/` | ☐ |
| 10 | 檢視 Golden Test 前置條件 | `/teacher/vision-repository/<id>/golden-test/` | ☐ |

---

**人工 iPhone 驗收：PENDING**
