# FDE-AI-UAS 2.0｜R07 測試資料精準清理 — 備份與 Dry-Run 報告

**日期**：2026-10-11
**模式**：**DRY-RUN（尚未刪除任何資料）**
**依據**：教師確認採用「A＋C 保守版」
**腳本**：`demo/tools/r07_cleanup_dryrun.py`（只讀，永不寫入）
**報告**：`demo/runtime/logs/r07_cleanup_dryrun.json`

---

## 一、備份（已完成並驗證）

**備份目錄**：`D:\FDE-AI-UAS-v2.0\demo\backup\r07-cleanup-20261011-080704`

| 項目 | 內容 | 驗證 |
|---|---|---|
| `demo.sqlite3` | 593,920 bytes | SHA256 **一致**，`integrity_check = ok` |
| `vision_center.json` | 64,674 bytes | SHA256 **一致** |
| `model_registry/` | 50 個檔案 | 檔案數 **一致**（50 = 50） |
| `datasets/` | 24 個檔案 | 檔案數 **一致**（24 = 24） |
| `submissions/` | 1 個檔案 | 已複製 |
| **合計** | **101 MB** | — |

> 備份資料庫經實測可正常開啟：`auth_user=2`、`learning_visionmodelrecord=1`。

---

## 二、引用鏈檢查（釐清後結論）

### 2.1 Django 端（單一線性鏈，無分支）

```
GrowthRecordSubmission id=7  (slot=R07「專業任務驗證」, status=submitted)
  └─ Evidence 74cb4253184b484dac54b24a25563c2f  (model, 2,097 bytes 佔位檔)
       └─ VisionModelRecord c291aaee...  (is_demo_test_only=1, CANDIDATE,
                                          integrity_status=MISSING)
```

**反向引用檢查（全部為 0，表示無其他表引用此 Evidence）**：

| 表 | 引用筆數 |
|---|---|
| `learning_candidatepool` | 0 |
| `learning_teacherreviewevent` | 0 |
| `learning_growthrecordsubmission_selected_evidence` | 0 |

### 2.2 關鍵技術限制

`VisionModelRecord.evidence` 為 **`on_delete=models.PROTECT`** 的 OneToOneField。
**因此不可直接刪除 Evidence** —— Django 會拋 `ProtectedError`。

**採用最小安全三步方案：**

| 步驟 | 動作 | 目標 | 理由 |
|---|---|---|---|
| step 1 | DELETE | `learning_visionmodelrecord` pk=`c291aaee...` | 先刪本表才能解除對 Evidence 的 PROTECT |
| step 2 | DELETE | `learning_evidence` pk=`74cb4253...` | 損壞的測試模型證據（2,097 B 佔位檔） |
| step 3 | **KEEP** | `learning_growthrecordsubmission` **pk=7** | **學員 R07 成長紀錄本體完整保留** |

> ✅ **可安全解除**，無需中止。學員成長紀錄、狀態、`student_note`、`submitted_at` 全部不動。

---

## 三、逐筆刪除清單（Dry-Run 結果）

### 3.1 總覽

| 項目 | 保留 | 刪除 |
|---|---|---|
| **模型** | **2** | **40**（約 157.5 MB） |
| datasets | 2 | 10 |
| hard_examples | 0 | 9 |
| submissions | 1 | 0 |
| registry 目錄 | 2 | 23 |
| Django 記錄 | 1（成長紀錄） | 2（VMR + Evidence） |

### 3.2 ✅ 保留（2 筆 ACTIVE，**絕不刪除**）

| model_id | 狀態 | 用途 |
|---|---|---|
| `PROP_20261010_X_accv2_23fd` | **ACTIVE** | 槳葉方向推論 |
| `HOVER_20261010_X_haccv1_abc8` | **ACTIVE** | 四面懸停推論 |

其各自引用的 dataset 亦保留：
`dataset-1c41e63a-...`（PROP_DIRECTION）、`dataset-febb9949-...`（FOUR_SIDE_HOVER）

### 3.3 保留 DEMO Submission（手機檢測命脈）

| 項目 | 值 |
|---|---|
| submission_id | `sub-ea18f5eb-a1a5-41f2-ae7d-512ad380f79e` |
| demo_review_status | `DEMO_REVIEW_APPROVED` |
| demo_active_submissions | `{"PROP_DIRECTION": "sub-ea18f5eb-..."}` |

> **此筆為手機 DEMO 模擬推論的唯一觸發來源**，本次明確保留。
> 另有一筆 `submissions/prop_direction/...` 目錄亦保留。

### 3.4 刪除分類統計（40 筆）

| 類別 | 筆數 | 內容特徵 | 判定依據 |
|---|---|---|---|
| `FAKE_PLACEHOLDER` | 9 | 3,800 B，內容為 `THIS IS NOT A MODEL` | 明顯假檔 |
| `DEBUG_PLACEHOLDER` | 1 | 3,800 B，`PROP_..._zz-debug` | debug 用 |
| `MISMATCH_TEST` | 11 | 5.5 MB，簽章不符測試 | notes `model_signature_invalid` |
| `ACCEPTANCE_REAL` | 19 | 5.5 MB，真實模型但非 ACTIVE | 驗收用，已被 ACTIVE 取代 |

**全部 40 筆的 `uploaded_by`**：`acceptance-teacher` ×39、`debug` ×1
→ **無任何一筆是真人教師或學員上傳**。

**狀態分布**：`ARCHIVED` ×18、`REJECTED` ×21、`VALIDATED` ×1
→ **無 ACTIVE**。

### 3.5 待刪 datasets（10 筆）

```
dataset-b5acfce7-b9e6-4760-a845-2426e9ceab51  PROP_DIRECTION
dataset-35e6923a-5669-4e3f-8f1e-1be471b608a2  FOUR_SIDE_HOVER
dataset-cf99fb9b-92ec-4e0a-b25b-31a5f8f0265a  PROP_DIRECTION
dataset-f1937bf1-f5d1-47de-a051-8ba861971d7e  FOUR_SIDE_HOVER
dataset-90cf6826-5a1a-49b7-b585-df0d58910d36  PROP_DIRECTION
dataset-7dd81548-be0e-4be1-8ca9-b7601d0dad11  FOUR_SIDE_HOVER
dataset-ffaa6080-7946-44af-aab4-474fad3715df  PROP_DIRECTION
dataset-392eaa23-2469-4863-8407-3b2a732b0f8d  FOUR_SIDE_HOVER
dataset-778d07da-4b54-42d9-9f80-ab23b0486226  PROP_DIRECTION
dataset-5f65dda8-4da8-4c9f-bea7-7cd0638905e6  FOUR_SIDE_HOVER
```
> 全部由 `acceptance-teacher` 建立，且**未被任何 ACTIVE 模型引用**。

### 3.6 待刪 hard_examples（9 筆）

全部為 `source=RULE_ENGINE_NON_PASS`、`model_version=accv2` 的測試樣本
（`IMG_7788.jpeg` / `IMG_7789.jpeg`），無對外引用。

---

## 四、安全檢查（全部通過）

| # | 檢查項 | 結果 |
|---|---|---|
| 1 | 待刪目錄 ∩ 保留目錄 = ∅ | ✅ `set()` |
| 2 | 保留目錄都存在於磁碟 | ✅ True |
| 3 | 待刪 + 保留 == 磁碟全集（無遺漏） | ✅ True |
| 4 | 有不明歸屬的孤兒目錄 | ✅ 無（`[]`） |
| 5 | ACTIVE 模型是否落在刪除清單 | ✅ **False**（兩筆皆否） |
| 6 | ACTIVE 模型檔案是否仍存在 | ✅ True |
| 7 | 刪除清單中是否有 ACTIVE 狀態 | ✅ 無 |
| 8 | 刪除清單上傳者是否全為測試帳號 | ✅ 是 |
| 9 | Django 反向引用是否為零 | ✅ 是 |

---

## 五、未執行項目

| 項目 | 狀態 |
|---|---|
| `.test-temp/r07-demo-model/` 5.5 MB 測試檔 | **依指示保留，不列入清理** |
| 真實 best.pt | **未尋找、未製造**（星期天由學員上傳） |
| commit / push / merge / deploy | **未執行** |

---

## 六、⚠️ 等待教師最終確認

**目前尚未刪除任何資料。** 請確認上述刪除範圍後回覆，我才會執行 apply。

執行 apply 時將：
1. 再次列出實際刪除範圍
2. 逐筆執行（不做整批清空）
3. 每一步記錄至 `r07_cleanup_apply.log`
4. 完成後驗證：R07 上傳入口、教師 Vision Center、手機 DEMO 檢測、兩筆 ACTIVE

---

## 七、執行後之驗證計畫（完成條件對應）

| 完成條件 | 驗證方式 |
|---|---|
| R07 可正常重新上傳 | 檢查 `/student/courses/1/growth/R07/` 回 200 且含 `model_file` 欄位 |
| 教師 Vision Center 可見新 R07 模型 | 檢查 `/teacher/vision-models/` 列表頁正常 |
| 手機 DEMO 檢測不受影響 | POST `/api/v1/vision/prop-check` 應回 200 且 `simulation_mode: true` |
| 兩筆 ACTIVE 保持不變 | 重讀 `vision_center.json` 比對 model_id 與 file_hash |
| 正式環境完全不受影響 | 未觸碰 `:8022` / `:8765` / `:8770` / v1.5C / Cloudflare |

**人工 iPhone 驗收：PENDING**
