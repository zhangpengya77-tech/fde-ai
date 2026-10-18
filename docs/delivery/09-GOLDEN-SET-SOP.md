# FDE-AI-UAS 2.0 交付文件｜09 Golden Set 操作 SOP

**文件版本**：v1.0（交付驗收階段產出）
**產出日期**：2026-10-09
**依據**：【正式交付驗收指令】第七條第 11 項
**驗證狀態**：**完整生命週期已於真實瀏覽器實測（C 系列 10/10 PASS）**

---

## 一、什麼是 Golden Set

**Golden Set（黃金測試集）**是經教師人工確認的標準測試樣本集合，
用於未來的模型評估。它是模型驗證的**基準線**。

### 1.1 核心觀念：兩級完整度

| 級別 | 條件 | 可否凍結 | 可否正式評估 |
|---|---|---|---|
| `INCOMPLETE` | 四類標籤未齊 | ❌ | ❌ |
| **`STRUCTURAL_COMPLETE`** | **四類標籤齊備** | ✅ | ❌（每類需 ≥2 張） |
| `EVALUATION_READY` | FROZEN + 每類 ≥2 張已確認 | ✅ | ✅ |

> **⚠️ 最常見的誤解**：以為「四類齊了就能評估」。
> **不對。** 四類齊只能**凍結**，要**評估**還需每類至少 **2 張已確認樣本**。

### 1.2 四類標籤

| 標籤 | 意義 |
|---|---|
| `CW_F` | 順時針（Clockwise）/ 前側（Front） |
| `CCW_F` | 逆時針（Counter-Clockwise）/ 前側 |
| `CW_B` | 順時針 / 後側（Back） |
| `CCW_B` | 逆時針 / 後側 |

> 對應 F450 四旋翼螺旋槳方向辨識任務。

---

## 二、SOP 總覽

```
┌────────────────────────────────────────────────────────┐
│  Golden Set 生命週期                                     │
├────────────────────────────────────────────────────────┤
│  1. 建立版本（DRAFT）                                     │
│  2. 上傳四類樣本                                          │
│  3. 教師逐張確認（CONFIRMED）                             │
│  4. 檢查完整度                                            │
│  5. 凍結（FROZEN）← 不可逆                                │
│  6. 取得 Manifest SHA256                                 │
│  7. 準備 Golden Test                                     │
└────────────────────────────────────────────────────────┘
```

---

## 三、步驟 1：建立 Golden Set 版本

| 項目 | 內容 |
|---|---|
| **URL** | `/teacher/golden-sets/` → 清單頁 |
| **建立端點** | `/teacher/golden-sets/create/` |
| **路由名稱** | `teacher_golden_set_create` |
| **初始狀態** | `DRAFT` |
| **驗收結果** | **PASS**（C1、C2） |

### 3.1 操作

1. 開啟 `/teacher/golden-sets/`
2. 填寫版本名稱（**建議格式**：`<TASK>_GOLDEN_v<版本>`，如 `PROP_GOLDEN_v1`）
3. 指定 `task_id`（本輪僅支援 `PROP_DIRECTION`）
4. 送出建立

> **實測範例**：建立 `PROP_GOLDEN_vACC-v1`，狀態為 `DRAFT`。

### 3.2 ⚠️ 導覽穩定性備註

實測中曾遇 `/teacher/golden-sets/create/` 一次性導覽失敗
（落到 `chrome-error://chromewebdata/`），重試後正常。

> **屬測試驅動層的偶發問題，非產品缺陷。**
> **變通做法**：Create 表單也嵌於清單頁，可從清單頁直接提交，結果一致。

---

## 四、步驟 2：上傳四類樣本

| 項目 | 內容 |
|---|---|
| **URL** | `/teacher/golden-sets/<golden_set_id>/samples/` |
| **路由名稱** | `teacher_golden_set_add_sample` |
| **驗收結果** | **PASS**（C3） |

### 4.1 操作

1. 進入 Golden Set 詳情頁
2. 點選「新增樣本」
3. 選取圖片檔案
4. **指定標籤**（`CW_F` / `CCW_F` / `CW_B` / `CCW_B`）
5. 送出

### 4.2 建議做法

| 建議 | 原因 |
|---|---|
| 每個標籤**至少上傳 2 張** | 才能達到 `EVALUATION_READY` |
| 使用**真實拍攝**照片 | 測試集須反映真實情境 |
| 涵蓋不同角度 / 光線 | 提升測試集代表性 |
| 避免重複或近似圖片 | 避免測試集品質虛高 |

### 4.3 確認四類標籤

上傳完成後，詳情頁應顯示四類各 N 張：

```
CW_F:  N 張
CCW_F: N 張
CW_B:  N 張
CCW_B: N 張
```

**驗收結果**：**PASS**（C4）— 實測四類各 1 張

---

## 五、步驟 3：教師逐張確認

| 項目 | 內容 |
|---|---|
| **URL** | `.../samples/<sample_id>/confirm/` |
| **路由名稱** | `teacher_golden_sample_confirm` |
| **驗收結果** | **PASS**（C5）— 實測 4/4 CONFIRMED |

### 5.1 為什麼要逐張確認

**Golden Set 的價值來自「人工確認」。**
自動上傳的樣本不具備基準線效力，必須由教師**親自檢視**並確認標籤正確。

| 狀態 | 意義 |
|---|---|
| `PENDING` | 尚未確認 |
| **`CONFIRMED`** | 教師已確認標籤正確 |

> **只有 `CONFIRMED` 的樣本才計入完整度與評估。**

---

## 六、步驟 4：檢查完整度

詳情頁會顯示當前完整度等級：

| 顯示 | 等級 | 可否凍結 |
|---|---|---|
| 不完整 | `INCOMPLETE` | ❌ |
| **結構完整（尚不可正式評估）** | `STRUCTURAL_COMPLETE` | ✅ |
| 可正式評估 | `EVALUATION_READY` | ✅ |

### 6.1 `STRUCTURAL_COMPLETE` 時的實際顯示（實測原文）

```
完整度：結構完整（尚不可正式評估）
  結構已完整且已鎖定，但每類至少需 2 張已確認樣本才可正式評估；
  目前不足：CW_F（1 張）、CCW_F（1 張）、CW_B（1 張）、CCW_B（1 張）。
```

> **系統會明確告訴你「還缺幾張」。** 這是刻意的誠實設計。

---

## 七、步驟 5：凍結（FROZEN）— **不可逆操作**

| 項目 | 內容 |
|---|---|
| **URL** | `/teacher/golden-sets/<golden_set_id>/freeze/` |
| **路由名稱** | `teacher_golden_set_freeze` |

### 7.1 凍結前的防護（實測 PASS）

| 情境 | 系統行為 | 驗收 |
|---|---|---|
| 四類未齊 | **按鈕 disabled + 後端阻擋** | **PASS**（C6） |
| 四類齊備 | 允許凍結 | **PASS**（C7） |

> **View 層與服務層雙重防護**，無法用前端繞過。

### 7.2 凍結後的行為

| 項目 | 結果 |
|---|---|
| 狀態 | `DRAFT` → **`FROZEN`** |
| 上傳欄位 | **不再渲染**（實測 `NO_FILE_INPUT`） |
| 頁面訊息 | 「此測試集版本已鎖定（FROZEN），不得再新增、修改或刪除樣本。」 |
| 再次上傳 | 樣本數 4 → **4**（被拒） |

**驗收結果**：**PASS**（C8）

### 7.3 ⚠️⚠️ 重要限制：FROZEN 不可變性**只在 View 層**

**這是已記錄的 P1 缺陷。**

| 層級 | 狀態 |
|---|---|
| **View 層**（UI + 表單） | ✅ 正確阻擋 |
| **Model 層**（ORM 直攻） | ❌ **無守衛** |

**已實測的攻擊**：

```python
s.label = 'CCW_B'
s.full_clean()   # ← 未拋出 ValidationError
s.save()         # ← 成功
s.delete()       # ← 成功（4 → 3）
```

**Manifest 會在事後重算時判為 `MISMATCH`（偵測），但無法阻止（Prevention）。**

### 7.4 操作紀律（**務必遵守**）

| # | 規則 |
|---|---|
| 1 | **不得**以 Django shell / ORM 直接操作 FROZEN 的 Golden Set |
| 2 | **不得**直接修改資料庫 |
| 3 | **不得**直接刪除 Golden Set 檔案 |
| 4 | 所有變更**一律**透過教師後台 UI |
| 5 | 若懷疑被竄改，比對 Manifest SHA256（見步驟 6） |

---

## 八、步驟 6：取得並驗證 Manifest SHA256

| 項目 | 內容 |
|---|---|
| **位置** | Golden Set 詳情頁 |
| **驗收結果** | **PASS**（C9） |

### 8.1 實測值

| 項目 | 值 |
|---|---|
| Manifest SHA256 | `a1a15c8f796f62249357ca6d87440475ab39fec1034010fbd7e04cb58c9b98fa` |
| 契約版本 | `GOLDEN_SET_CONTRACT_V1` |
| canonical bytes | 2,034 |
| binding 狀態 | `BOUND` |

### 8.2 Manifest 的意義

Manifest 是以 **canonical JSON**（`sort_keys` + 緊湊格式）序列化後計算的雜湊。

| 特性 | 說明 |
|---|---|
| **可重複驗證** | 任何環境重算都應得到相同 SHA256 |
| **可偵測竄改** | 任何樣本變更都會改變雜湊 |
| **可跨環境比對** | 不依賴環境差異 |

### 8.3 如何判斷是否被竄改

| 情境 | Manifest 重算結果 |
|---|---|
| 未變更 | `MATCH`，binding = `BOUND` |
| 樣本被改 / 被刪 | **`MISMATCH`** |

> **實測證明**：在 S7 缺陷測試中，ORM 直攻刪除樣本後，
> Manifest **正確判為 `MISMATCH`**。
> → **偵測機制有效，但阻止機制缺失。**

### 8.4 持久化確認

**重新登入後**：FROZEN 狀態與 4 筆樣本仍存在。
**驗收結果**：**PASS**（C10）

---

## 九、步驟 7：準備 Golden Test

凍結完成後，即可在模型評估頁使用該 Golden Set。

| 項目 | 內容 |
|---|---|
| **URL** | `/teacher/vision-repository/<model_id>/golden-test/` |
| **路由名稱** | `teacher_golden_test_page` |
| **驗收結果** | **PASS**（D1–D8） |

### 9.1 前置條件（服務層自驗證）

| 規則 | 驗收 |
|---|---|
| 僅接受 **FROZEN** | **PASS**（D4：DRAFT 不可選） |
| **task_id 必須相符** | **PASS**（D5） |
| 無真實結果 → 不得 `VALIDATED` | **PASS**（D6） |
| 無合格結果 → 不得 `ACTIVE` | **PASS**（D7） |

### 9.2 ⚠️ 目前**不執行**推論

頁面原文：
> 本頁為框架預留：呈現評估所需欄位與前置條件，**本輪不執行推論、不載入 .pt、不變更任何模型狀態**。

執行按鈕顯示：`執行 Golden Test（尚未實作）` ← **不可用**

### 9.3 不會產生假數據（實測）

```
validation_status   = NOT_EVALUATED
golden_test_summary = {}
validation_history  = []
deployment_status   = CATALOGUED
```

> **未產生任何偽造的 Precision / Recall / mAP。**
> 指標欄位僅為**預留欄位**，全部顯示「尚未評估」。

---

## 十、⚠️⚠️ 三套 Golden Set 資料來源（**必讀**）

本輪驗收的**決定性發現**：系統中存在**三套** Golden Set 實作，
**彼此並未接線**，僅命名相近。

| # | 實作 | 儲存位置 | 是否為真實來源 |
|---|---|---|---|
| 1 | **Django `GoldenSet`/`GoldenSetSample`** | **Django DB** | ✅ **本操作 SOP 使用的就是這套** |
| 2 | `vision_center.py` `golden_sets[]` | Vision Center JSON Store | ❌ **未接線（目前為空）** |
| 3 | `benchmark.py` `PropValidationSet` | 檔案系統 manifest | ❌ **未接線（0 張圖）** |

### 10.1 教師需要注意什麼

| 注意事項 | 說明 |
|---|---|
| **教師後台操作的是第 1 套** | 這是唯一有效的來源 |
| JSON Store 的 `golden_sets[]` **恆為空** | `golden_sets: 0`（實測） |
| 不要期待兩者同步 | **它們沒有同步機制** |
| 未來若看到「Golden Set」字樣 | 確認是哪一套 |

> **本輪已在交付文件中明示此限制**，
> 避免後續開發或運維誤判為「已整合」。

---

## 十一、Golden Set 操作檢查清單

| # | 步驟 | URL | 完成 |
|---|---|---|---|
| 1 | 建立版本 | `/teacher/golden-sets/create/` | ☐ |
| 2 | 上傳樣本（每類 ≥2 張） | `.../samples/` | ☐ |
| 3 | 逐張確認 | `.../samples/<id>/confirm/` | ☐ |
| 4 | 檢查完整度等級 | 詳情頁 | ☐ |
| 5 | 凍結 | `.../freeze/` | ☐ |
| 6 | 記錄 Manifest SHA256 | 詳情頁 | ☐ |
| 7 | 重新登入驗證持久化 | — | ☐ |
| 8 | 於 Golden Test 頁選用 | `.../golden-test/` | ☐ |

---

## 十二、常見問題

| # | 問題 | 原因 | 處理 |
|---|---|---|---|
| 1 | 無法凍結 | 四類未齊 | 補齊四個標籤 |
| 2 | 凍結後仍顯示「尚不可正式評估」 | 每類不足 2 張 | 這是正確的；需重新建立新版本補足 |
| 3 | 已凍結想再改 | FROZEN 為鎖定狀態 | **建立新版本**（勿繞過） |
| 4 | Golden Test 下拉沒有選項 | 尚未凍結或 task_id 不符 | 確認已 FROZEN 且 task 相符 |
| 5 | 頁面顯示無法評估 | Golden Test 尚未實作 | 屬已知限制，勿期待 |

---

## 十三、操作紀律總結

> **Golden Set 是模型驗證的基準線。它的價值完全來自「不可被任意修改」。**

| # | 紀律 |
|---|---|
| 1 | 凍結前務必確認樣本品質（凍結後不可改） |
| 2 | 每類至少 2 張再凍結（否則無法評估） |
| 3 | **不得**以 ORM / shell / SQL 直接操作 FROZEN 的 Golden Set |
| 4 | 定期記錄並比對 Manifest SHA256 |
| 5 | 需要修改時，**建立新版本**，而非繞過鎖定 |

---

**人工 iPhone 驗收：PENDING**
