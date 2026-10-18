# FDE-AI-UAS 2.0 交付文件｜10 已知限制與未完成項目

**文件版本**：v1.0（交付驗收階段產出）
**產出日期**：2026-10-09
**依據**：【正式交付驗收指令】第七條第 12 項
**性質**：**限制揭露文件，所有項目均有實測證據**

---

## 一、閱讀須知

本文件列出 FDE-AI-UAS 2.0 目前**不可宣稱已完成**的所有項目。

> **依【正式交付驗收指令】第五條**：
> 「不得將未實作的 Django → Live Backend 資料介面宣稱為已整合。」
>
> **依第六條**：
> 「無法執行的安全測試標記 PENDING，不得視為 PASS。」

**所有對外文件與簡報，均不得繞過本文件的限制。**

---

## 二、未實作功能（UI 已誠實標示）

以下功能在視覺模型中心頁面**明確標示「未啟用」**：

| # | 功能 | 頁面原文 | 影響 |
|---|---|---|---|
| 1 | **圖片驗證推論** | 「未啟用（無可靠模型隔離沙箱）」 | 無法自動驗證圖片 |
| 2 | **Golden Test 執行** | 「未啟用（需 Golden Set 真實樣本）」 | 無法實際評估模型 |
| 3 | **ACTIVE 模型發布** | 「未啟用（需通過驗證並由教師明確操作）」 | 無正式模型可上線 |
| 4 | **收藏至訓練模型倉庫** | 「預留入口，尚未開放寫入」 | 無法寫入訓練倉庫 |

### 2.1 正面評價

> 系統**未把「框架預留」包裝成「已完成」**。
> 這是**正面的工程誠信訊號**：UI 誠實反映實作狀態。
> **交付時應保留這些聲明**，不得移除或淡化。

---

## 三、⚠️ 未接線（架構層級限制）

### 3.1 Django ↔ Live Backend 的 Golden Set 介面**未接線**

**這是本次驗收的決定性發現。**

| # | Golden Set 實作 | 位置 | 儲存 | 接線狀態 |
|---|---|---|---|---|
| 1 | Django `GoldenSet` / `GoldenSetSample` | `student_portal/learning/` | ORM / SQLite | **本體** |
| 2 | `vision_center.py` `golden_sets[]` | `live_backend/app/` | JSON Store | **未接線** |
| 3 | `benchmark.py` `PropValidationSet` | `live_backend/app/` | 檔案 manifest | **未接線** |

**證據**：

1. Django 端**唯一**的跨系統呼叫點是
   `student_portal/learning/vision_submission.py:26`
   的 `POST /api/v1/vision/submissions` —— **只有這一條**。
2. Live Backend `vision_api.py` 確實暴露了
   `GET/POST /api/v1/vision/golden-sets`、
   `GET /api/v1/vision/golden-sets/{id}`、
   `GET /api/v1/vision/models/{id}/golden-sets`，
   但 **Django 從未呼叫這些端點**。
3. `live_backend/app/main.py` 中**零筆** `golden` 相關參照。
4. `PropValidationSet` 是第三個獨立來源，走檔案系統 manifest。

> **結論：三套實作僅命名相近，並未互相接線。**
> **唯一真正接線的跨系統路徑是 R07 `.pt` 提交。**

### 3.2 影響

| 影響 | 說明 |
|---|---|
| 資料雙來源風險 | 未來開發可能誤用錯誤來源 |
| 維護成本 | 三套需分別維護 |
| 誤判風險 | 看到「Golden Set」字樣需確認是哪一套 |

### 3.3 建議

1. **文件明示**（已於本文件與交付報告中明示）
2. 或**統一命名**（例如加前綴區分）
3. 或**評估整合**（未來輪次）

---

## 四、⚠️ 正式環境不可用（**最高優先限制**）

### 4.1 正式 DB 從未套用 `0016`–`0019`

| 項目 | 實際狀態 |
|---|---|
| 正式 DB | `student_portal/db.sqlite3` |
| 最後 migration | **`0015_studentsurvey_survey_version_and_more`** |
| `0016` / `0017` / `0018` / `0019` | **從未套用** |
| `learning_visionmodelrecord` 表 | **不存在** |
| `learning_goldenset` / `learning_goldensetsample` 表 | **不存在** |

**影響**：正式環境**目前無法使用** Vision Model Repository 與 Golden Set 功能。

**修復方案**：見 `04-MIGRATION-PLAN.md`

> **⚠️ 任何「正式環境已可用」的宣稱，都必須先完成 migration 套用。**

---

## 五、P1 缺陷（核心操作流程）

| # | 缺陷 | 影響 | 證據 |
|---|---|---|---|
| **P1-1** | **FROZEN 不可變性僅在 View 層** | 具 shell/ORM 權限者可竄改黃金基準；僅事後被 Manifest 判 `MISMATCH` | S7 FAIL（見下） |
| **P1-2** | **R07 硬依賴 Live Backend :8030** | 該服務離線 → 學員無法完成 R07 | A4 第一次測試 BLOCKED |
| **P1-3** | **三套 Golden Set 未接線但命名相近** | 後續開發易誤判已整合 | 見本文件第三節 |

### 5.1 P1-1 詳細記錄

**現象**（實測）：

```python
s.label = 'CCW_B'
s.full_clean()   # ← 未拋出 ValidationError（應拋出）
s.save()         # ← 成功（應被拒）
s.delete()       # ← 成功，samples 4 → 3（應被拒）
```

**事後偵測**：Manifest 重算後**正確判為 `MISMATCH`**。

| 面向 | 狀態 |
|---|---|
| 偵測（Detection） | ✅ 有效 |
| 阻止（Prevention） | ❌ **缺失** |

**建議修法**（本輪未執行）：
於 `GoldenSetSample.save()` / `delete()` 加入 FROZEN 守衛，
或以 DB trigger 實作。

**為何未修**：依【正式交付驗收指令】第一條
「發現問題先記錄，不自行展開大規模修復」。

---

## 六、PENDING 安全項（**不得視為 PASS**）

依指令「無法執行的安全測試標記 PENDING，不得視為 PASS」：

| # | 項目 | 狀態 | 原因 |
|---|---|---|---|
| 1 | symlink 來源防護（S6） | **PENDING** | Windows 非管理員權限無法建立 symlink |
| 2 | symlink 目標防護（S6） | **PENDING** | 同上 |
| 3 | symlink 讀取防護（S6） | **PENDING** | 同上 |
| 4 | junction 來源防護（S8） | **PENDING** | 同上 |
| 5 | 符號連結拒絕邏輯 | **PENDING** | 同上 |
| 6 | 缺檔（MISSING）情境實測 | **PENDING** | 本輪未刻意製造缺檔（以程式碼審查推定） |
| 7 | 正式設定下 MEDIA 是否公開 serve | **PENDING** | 未動正式設定（凍結規則） |
| 8 | Golden Set 契約 vs 正式 JSON Store 一致性 | **PENDING** | 隔離環境無正式 Store |
| 9 | 成長影片產生（ffmpeg 路徑） | **PENDING** | 環境無 ffmpeg / ffprobe |

### 6.1 部分覆蓋說明

| 項目 | 已被動覆蓋 | 但仍缺 |
|---|---|---|
| junction 路徑逃逸 | S3 掃描確認隔離 media 下**無 reparse point**（PASS） | **主動建立惡意 junction** 的對抗性驗證 |

> **被動掃描 ≠ 主動對抗測試。兩者不可互相替代。**

---

## 七、測試套件限制

### 7.1 26 個 SKIPPED

| 類型 | 原因 | 項數 |
|---|---|---:|
| 環境依賴 | `ffmpeg` / `ffprobe` 未安裝 | 多項 |
| 環境依賴 | 隔離環境無正式 JSON Store | 1 |
| 平台限制 | Windows 非管理員無法建 symlink | 多項 |
| 平台限制 | 同上，目錄連結 / junction | 2 |
| — | **合計** | **26** |

### 7.2 1 個既有 FAIL（保留，未修）

```
FAIL: test_platform_hero_action_opens_student_growth_portal
      (learning.tests.test_auth.StudentRegistrationTests)
  File "learning/tests/test_auth.py", line 104
    self.assertIn("label: '我的學習日誌'", source)
AssertionError: "label: '我的學習日誌'" not found in
  "...{ label: '我的成長日誌', target: '/student/growth/', kind: 'primary' }..."
```

| 項目 | 內容 |
|---|---|
| 性質 | 文案變更後測試未同步的**既有失敗** |
| `src/app.js` mtime | `2026-10-08 06:31` |
| `test_auth.py` mtime | `2026-09-28 07:08` |
| 與本輪關係 | **無關** |
| 處置 | **保留紀錄，未修復** |

> **依指令：「不得為了測試全綠擅自修改無關產品或測試。」**
> **不得宣稱「測試全綠」。**

---

## 八、未完成的人工驗收

| 項目 | 狀態 |
|---|---|
| 桌面 Chrome 瀏覽器驗收 | ✅ `DESKTOP BROWSER PASS`（36/36） |
| **人工 iPhone 實機驗收** | ❌ **`PENDING`** |

> **依專案兩級完成標準**：
> - 自動測試通過 → 只能寫 `AUTOMATED PASS`
> - iPhone 實際測試通過 → 才允許寫 `REAL DEVICE PASS`
>
> **iPhone 測試完成前，所有報告必須標註「人工 iPhone 驗收：PENDING」。**

### 8.1 iPhone 驗收的重要性

FDE-AI-UAS 2.0 的目標場景是**手機端**（學生用手機攝影機 + App）。
桌面 Chrome 驗收**不能替代**手機實機驗收。

| 風險 | 桌面驗收無法覆蓋 |
|---|---|
| 手機相機存取 | 需實機 |
| 響應式版面 | 小螢幕可能破版 |
| 觸控操作 | 需實機 |
| iOS Safari 相容性 | 需實機 |
| 網路環境 | 行動網路延遲 |

---

## 九、P3 低風險項目

| # | 問題 | 建議 |
|---|---|---|
| 1 | fail-safe 殘留空目錄 `media/evidence/<uuid>/` | `storage.delete()` 後清理父目錄 |
| 2 | `django_portal_proxy` 硬編 `host: 127.0.0.1:8022` | 改由 `django_origin` 推導 |
| 3 | `golden_test_blocked_reason` 標記為【已棄用】但保留為相容別名 | 確認無呼叫端後移除 |
| 4 | `PropValidationSet` 的 `manifest.json` 為 `BLOCKED_NO_REAL_SAMPLES` | 明示為未使用，或補真實樣本 |

---

## 十、能力矩陣（總表）

| 能力 | 自動化 | 真實瀏覽器 | 持久化 | 可交付 |
|---|---|---|---|---|
| 學員登入 / 課程入口 | ✅ | ✅ | ✅ | **是** |
| R07 專業任務頁 | ✅ | ✅ | ✅ | **是** |
| R07 `.pt` 提交 | ✅ | ✅ | ✅ | **是（條件式）** |
| 教師視覺模型中心 | ✅ | ✅ | ✅ | **是** |
| 教師候選 / 退回審核 | ✅ | ✅ | ✅ | **是** |
| 模型入庫 + 不可變快照 | ✅ | ✅ | ✅ | **是** |
| 模型完整性檢查 | ✅ | ✅ | ✅ | **是** |
| Golden Set 版本管理 | ✅ | ✅ | ✅ | **是** |
| Golden Set 凍結 + Manifest | ✅ | ✅ | ✅ | **是** |
| Golden Test 前置條件驗證 | ✅ | ✅ | ✅ | **是** |
| **Golden Test 實際推論執行** | ❌ | ❌ | — | **否（未實作）** |
| **圖片驗證推論** | ❌ | ❌ | — | **否（未實作）** |
| **ACTIVE 模型發布** | ❌ | ❌ | — | **否（未實作）** |
| **Django ↔ Live Backend Golden Set 整合** | ❌ | ❌ | — | **否（未接線）** |
| **正式環境 Golden Set 可用性** | ❌ | ❌ | — | **否（DB 未遷移）** |

### 10.1 「R07 提交」交付條件

| 條件 | 結果 |
|---|---|
| Live Backend 可達 | 提交成功，建立 Evidence + submission，雙向 binding |
| Live Backend 不可達 | 顯示失敗訊息並完整回滾 |

> **交付清單必須包含：同時啟動 Django（:8022）與 Live Backend（:8030）。**

---

## 十一、交付前必做清單

| # | 項目 | 優先級 |
|---|---|---|
| 1 | 補 FROZEN Model 層守衛（P1-1） | **高** |
| 2 | 擬定並執行 `0016`–`0019` migration 計畫 | **高** |
| 3 | 安排 iPhone 實機驗收 | **高** |
| 4 | 確認交付啟動程序（雙服務同時在線） | **中** |
| 5 | 補 symlink / junction 主動對抗測試 | **中** |
| 6 | 實測正式設定下 MEDIA 是否公開 serve | **中** |
| 7 | 文件層明示三套 Golden Set 未接線 | **中** |
| 8 | 執行一次完整還原演練 | **中** |
| 9 | 清理 fail-safe 殘留空目錄 | **低** |

---

## 十二、不可對外宣稱的內容

> 以下語句**不得**出現在交付簡報、對外文件或驗收結論中：

| ❌ 不可宣稱 | ✅ 應改為 |
|---|---|
| 「Golden Test 已完成」 | 「Golden Test 前置條件驗證已完成；實際推論執行尚未實作」 |
| 「模型可自動評估」 | 「模型評估框架已預留；推論尚未實作」 |
| 「Golden Set 已整合」 | 「Django 端 Golden Set 已完成；與 Live Backend **未接線**」 |
| 「正式環境已就緒」 | 「程式碼已完成；正式 DB 尚需套用 `0016`–`0019`」 |
| 「測試全綠」 | 「507 PASS / 1 既有 FAIL（已記錄、未修復）/ 26 SKIPPED」 |
| 「iPhone 驗收通過」 | 「**人工 iPhone 驗收：PENDING**」 |
| 「系統可發布 ACTIVE 模型」 | 「ACTIVE 模型發布尚未實作」 |

---

**本文件所列限制均有實測證據，不得刪減或淡化。**
**人工 iPhone 驗收：PENDING**
