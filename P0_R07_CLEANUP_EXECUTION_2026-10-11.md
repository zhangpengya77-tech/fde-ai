# FDE-AI-UAS 2.0｜R07 測試資料清理 — 執行結果（部分完成）

**日期**：2026-10-11
**狀態**：**部分執行 — 檔案層完成，JSON／DB 層未執行**
**用具**：`demo/tools/r07_cleanup_apply.py`（支援 `--apply`）
**備份**：`demo/backup/r07-cleanup-20261011-080704`（完整可用）

---

## 一、⚠️ 最重要：實際發生什麼

我第一次執行 `--apply` 時，**工具在第一階段（刪 registry 目錄）執行後、第二階段前被中止**，
且因為我用 `| tail -50` 只看輸出尾端，**誤判為「GATE 未通過、什麼都沒刪」**。
第二次執行時 GATE 偵測到目錄已不存在（`registry_dirs_delete: 實際=0 基準=23`）而正確中止。

**結論：清理是「部分執行」，不是「全部未執行」。** 我必須如實說明。

### 目前三層實際狀態

| 層 | 目標刪除 | 實際狀態 |
|---|---|---|
| **A. registry 目錄（檔案）** | 23 | ✅ **已刪 23**（僅存 2 筆 ACTIVE） |
| **B. datasets 目錄（檔案）** | 10 | ⚠️ **只刪了 1 個** |
| **C. vision_center.json 記錄** | 40 models / 10 ds / 9 he | ❌ **未刪**（仍 42/12/9） |
| **D. Django DB** | 1 VMR + 1 Evidence | ❌ **未刪**（仍各 1 筆） |

**沒有任何 apply 日誌產生**（`r07_cleanup_apply_*.json` 不存在），
因為日誌是在流程結束時統一寫出，流程被中止時未落盤。**這是工具設計缺失，我會修正。**

---

## 二、保留資料驗證（全部通過 ✅）

| 項目 | 驗證結果 |
|---|---|
| `PROP_20261010_X_accv2_23fd`（ACTIVE） | 檔案存在，**SHA256 與記錄完全一致** ✅ |
| `HOVER_20261010_X_haccv1_abc8`（ACTIVE） | 檔案存在，**SHA256 與記錄完全一致** ✅ |
| `sub-ea18f5eb-...` DEMO Submission | 檔案存在（28 bytes） ✅ |
| `demo_active_submissions` | `{"PROP_DIRECTION": "sub-ea18f5eb-..."}` **未變** ✅ |
| `GrowthRecordSubmission id=7` | **存在**（共 8 筆成長紀錄，全數保留） ✅ |
| 學員／教師帳號 | `auth_user` = 2 筆，**未動** ✅ |
| `.test-temp` 測試檔 | **未動** ✅ |

---

## 三、目前狀態的風險評估

| 風險 | 評估 |
|---|---|
| 兩筆 ACTIVE 是否受損 | **否**，檔案與 hash 完整無損 |
| 手機 DEMO 檢測綁定 | **不受影響**（JSON 記錄仍在，綁定未變） |
| 是否有孤立資料 | ⚠️ **有**：`vision_center.json` 仍有 40 筆模型記錄，但其 registry 目錄已不存在（`file_path` 指向不存在的檔案） |
| 教師 Vision Center 是否會異常 | ⚠️ **可能**：列表若嘗試讀取已刪除的 `best.pt`，可能出現檔案不存在提示 |
| 正式環境 | **完全未受影響** ✅ |
| 可否還原 | **可以**：備份完整（registry 25 目錄／50 檔案、datasets 12 目錄／24 檔案、DB、JSON） |

---

## 四、我尚未執行的項目（依您的規則主動停止）

依您第 5 條「若資料或引用狀態與 Dry-Run 不一致，立即停止，不得自行擴大刪除範圍」，
**我停在此處，未繼續刪除任何 JSON 記錄或 DB 資料**。

未執行：
- JSON 層 40 筆模型記錄移除
- JSON 層 10 筆 datasets／9 筆 hard_examples 移除
- Django `VisionModelRecord c291aaee...` 移除
- Django `Evidence 74cb4253...` 移除

---

## 五、待您決定：兩個選項

### 選項 1：繼續完成（**建議**）
修好工具（日誌改為逐筆即時落盤），然後只執行**剩下三層**（B 剩餘 9 個 datasets、
C JSON 記錄、D Django），使狀態與 Dry-Run 一致。

### 選項 2：完整還原後重做
從備份還原 registry + datasets，回到 08:07 的乾淨起點，再一次性完整執行。

> 兩者皆安全，備份完整；**目前狀態不會造成資料損毀，但屬於「不一致」狀態，不建議擱置。**

---

## 六、六項驗收（目前狀態）

| 驗收項 | 狀態 |
|---|---|
| R07 可重新上傳 best.pt | ✅ 路由與視圖代碼完整（`urls.py:33`、`views.py:994`）；8111 未在線，需啟動後實測 |
| 教師 Vision Center 可正常開啟 | ✅ 代碼完整（`vision_submission.py`）；⚠️ 但列表可能顯示已刪檔案的模型 |
| 兩筆 ACTIVE 不變 | ✅ **SHA256 完全一致** |
| DEMO 模擬綁定不變 | ✅ **未變** |
| 手機檢測 API 回 DEMO 結果 | ⏸ **8111 未啟動**，無法實測（`ConnectionRefused`） |
| 正式環境未受影響 | ✅ **完全未觸碰** |

---

## 七、產出物

| 檔案 | 位置 |
|---|---|
| 清理工具（dry-run／apply） | `demo/tools/r07_cleanup_apply.py` |
| Dry-Run 分析工具 | `demo/tools/r07_cleanup_dryrun.py` |
| Dry-Run 報告（JSON） | `demo/runtime/logs/r07_cleanup_dryrun.json` |
| 備份 | `demo/backup/r07-cleanup-20261011-080704/` |

**未 commit／push／merge／deploy。**
