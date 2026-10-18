# FDE-AI-UAS 2.0｜R07 清理事故恢復 — 完成報告

**日期**：2026-10-11
**方案**：方案 2（先還原，再重新清理）
**狀態**：**安全還原完成 ✅｜工具修正完成 ✅｜重新 Dry-Run 完成 ✅｜未執行 --apply（依指示）**

---

## 第一階段：安全還原 — 完成

### 1.1 事故狀態快照（已保存）

`D:\FDE-AI-UAS-v2.0\demo\backup\incident-snapshot-20261011-081616`（12 MB，30 檔）
保存部分清理後的狀態，供事故追蹤。

### 1.2 備份完整性確認

| 項目 | 結果 |
|---|---|
| `demo.sqlite3` | SHA256 `e24b89c7…`，**`integrity_check = ok`** ✅ |
| `vision_center.json` | SHA256 `ba736ce0…` ✅ |
| registry | 25 目錄 / 50 檔案 ✅ |
| datasets | 12 目錄 / 24 檔案 ✅ |
| DB 內容 | `auth_user=2`、成長紀錄 8、VMR 1、Evidence 1 ✅ |

### 1.3 備份 vs 現況差異比對（關鍵發現）

| 範圍 | 備份 | 現況 | 差異 |
|---|---|---|---|
| registry | 50 檔 | 4 檔 | **誤刪 46 檔 / 23 目錄** |
| datasets | 24 檔 | 22 檔 | **誤刪 2 檔 / 1 目錄** |
| submissions | 1 檔 | 1 檔 | 無 |
| DB | — | — | **完全未變更** ✅ |
| JSON | — | — | **SHA256 完全一致** ✅ |
| 內容被修改 | — | — | **0 筆** ✅ |

> ✅ **重大確認**：DB 指紋（含最新時間戳）**逐項相同**，JSON SHA256 **完全相同**
> → **沒有任何新的學員提交或教師操作**，確認可安全還原，無需暫停回報。

### 1.4 精準還原執行

工具：`demo/tools/r07_incident_restore.py`（只還原「備份有、現況無」者，**不覆蓋任何現存檔案**）

| 項目 | 數量 |
|---|---|
| 待還原（備份有/現況無） | **48** |
| **衝突（內容不同）** | **0** ← 零衝突，最理想條件 |
| 已一致（跳過） | 27 |

**還原結果**：48 檔全部成功，逐檔 SHA256 核對通過。
日誌：`demo/runtime/logs/r07_restore_20261011-081723.jsonl`（50 筆，逐筆 flush）

### 1.5 還原後一致性驗證 — **位元級 100% 一致**

```
✓ model_registry   備份= 50 現況= 50 缺=0 多=0 內容異=0
✓ datasets         備份= 24 現況= 24 缺=0 多=0 內容異=0
✓ submissions      備份=  1 現況=  1 缺=0 多=0 內容異=0
✓ DB   現在 vs 備份：一致
✓ JSON 現在 vs 備份：一致
```

**未覆蓋任何未受影響的資料**（DB、JSON、學員上傳檔案全部保持原狀）。

---

## 第二階段：修正清理工具 — 完成

新工具：`demo/tools/r07_cleanup_apply_v2.py`

| # | 教師要求 | 實作 | 驗證 |
|---|---|---|---|
| 1 | 逐筆記錄日誌，立即 flush | `JsonlLog` 類別，每筆 `write` + `flush()` | ✅ 實測：中斷後不遺失 |
| 2 | 中斷後安全續跑或重跑保護 | GATE 支援「部分已清理」狀態（0 或 23 皆合法） | ✅ 4 項情境測試通過 |
| 3 | 不使用 tail 截斷輸出 | 輸出完整導向檔案（`>` 非 `\| tail`） | ✅ 本輪全程遵守 |
| 4 | 刪前核對 ID/路徑/SHA256/ACTIVE 引用 | `pre_delete_check()` 確認路徑在預期根目錄之下；ACTIVE 白名單硬阻擋 | ✅ 實作並測試 |
| 5 | 中途失敗停止 + 明確錯誤回報 | `Abort` 例外 + `rowcount != 1` 檢查 + DB rollback | ✅ 實作 |

### 保護機制實測（4 項情境）

| 測試 | 情境 | 結果 |
|---|---|---|
| 1 | registry 已全部清空（續跑） | ✅ 通過，提示「續跑模式」，跳過該階段 |
| 2 | registry 只刪一半（8 個） | ✅ **正確中止**（這正是上次事故情境，v2 會擋住） |
| 3 | ACTIVE 目錄被誤刪 | ✅ **正確中止**「保留模型目錄遺失」 |
| 4 | DEMO 綁定被改動 | ✅ **正確中止**「DEMO 綁定不符」 |

### 日誌 flush 實測

```
第一次 add 後檔案大小: 88 bytes   （已即時落盤）
第二次 add 後檔案大小: 176 bytes  （逐筆遞增）
模擬中斷後仍保留筆數: 2           （不遺失）
```

---

## 第三階段：重新 Dry-Run — 完成

**與原核准範圍完全一致**（STEP 0 GATE 通過）：

| 刪除項目 | 數量 |
|---|---|
| registry 目錄 | 23 |
| datasets 目錄 | 10 |
| JSON models | 40 |
| JSON datasets | 10 |
| JSON hard_examples | 9 |
| Django VMR | 1 |
| Django Evidence | 1 |

**保留項目**：
- `PROP_20261010_X_accv2_23fd`、`HOVER_20261010_X_haccv1_abc8`（兩筆 ACTIVE）
- registry 目錄：`PROP_20261010_X_accv2_23fd`、`HOVER_20261010_X_haccv1_abc8`
- datasets：`dataset-1c41e63a-…`、`dataset-febb9949-…`
- submission：`sub-ea18f5eb-…`
- DEMO 綁定：`{"PROP_DIRECTION": "sub-ea18f5eb-…"}`
- 成長紀錄 id=7

計畫檔：`demo/runtime/logs/r07_cleanup_plan_v2.json`

**本輪未執行 `--apply`**（依指示）。

---

## 第四階段：驗收 — 七項

| # | 項目 | 結果 |
|---|---|---|
| 1 | 25 個原 Registry 目錄恢復 | ✅ **25** |
| 2 | 12 個原 Dataset 目錄恢復 | ✅ **12** |
| 3 | 42 筆模型 JSON 引用一致 | ✅ 42 筆；`file_path` 缺 17 筆**為事故前既有狀態**（見下） |
| 4 | 兩筆 ACTIVE 完整 | ✅ **SHA256 完全一致** |
| 5 | R07 成長紀錄完整 | ✅ 8 筆，id=7 `status=submitted` |
| 6 | DEMO 模擬啟用關聯完整 | ✅ 綁定與 submission 均在 |
| 7 | 正式環境未受影響 | ✅ 未觸碰 `:8022`/`:8765`/`:8770`/v1.5C/Cloudflare |

### 關於「17 筆 file_path 不存在」

已用備份 JSON 比對確認：**這是備份時就已存在的狀態**（`備份 JSON == 現況 JSON` 為 `True`），
**與本次還原無關**。

- 42 筆 JSON 記錄中，只有 25 筆有對應 registry 目錄
- 缺檔的 17 筆狀態為 `ARCHIVED`×8 / `REJECTED`×8 / `VALIDATED`×1
- 這正是**事故前既有**的「JSON 有記錄、磁碟無檔案」不一致
- 本次清理（刪除 40 筆）正好會修掉這個問題

---

## 附：事故根因檢討

| 根因 | 說明 | 已修正 |
|---|---|---|
| 日誌流程結束才落盤 | v1 在 `DONE` 時統一寫檔，中斷即遺失 | ✅ v2 逐筆 flush |
| 續跑無保護 | v1 假設「全未執行」，已刪部分會誤判 | ✅ v2 接受 0 或全量 |
| **操作者誤判** | 我用 `\| tail -50` 只看尾端，漏掉中止訊息 | ✅ 本輪全程完整落盤 |

---

## 產出物

| 檔案 | 位置 |
|---|---|
| 事故快照 | `demo/backup/incident-snapshot-20261011-081616/` |
| 原始備份 | `demo/backup/r07-cleanup-20261011-080704/` |
| 差異比對工具 | `demo/tools/r07_incident_diff.py` |
| 精準還原工具 | `demo/tools/r07_incident_restore.py` |
| 清理工具 v2 | `demo/tools/r07_cleanup_apply_v2.py` |
| 還原日誌 | `demo/runtime/logs/r07_restore_20261011-081723.jsonl` |
| 差異報告 | `demo/runtime/logs/r07_incident_diff.json` |
| Dry-Run 計畫 | `demo/runtime/logs/r07_cleanup_plan_v2.json` |

**未 commit／push／merge／deploy。等待您批准後才執行 `--apply`。**
