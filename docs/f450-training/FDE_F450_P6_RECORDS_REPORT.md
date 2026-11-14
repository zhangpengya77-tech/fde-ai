# F450 實訓中心 P6 報告：成績接到練習紀錄與教師後台

- 日期：2026-11-14
- 分支：`feat/f450-assembly-training`（未推送、未發布）
- 批准：使用者 2026-11-14「批准開始 P6」（含 `SimPracticeRecord` 新增 mode 與 migration）

## 1. 做了什麼

### 資料庫
- `SimPracticeRecord.Mode` 新增 `f450`「F450 組裝接線」。
- 新 migration `0033_sim_practice_f450_mode`：只改 Django 的允許值。`sqlmigrate` 顯示 **no-op**，資料表結構完全不變。
- 沒有新增資料表或欄位，也沒有動到任何既有資料。

### 成績 API（沿用 `/student/sim-practice/api/`，與網頁模擬器同一支）
- **既有保護**：登入學員才能存、要 CSRF、學員與班級由後端依登入身分決定、每天上限 300 筆。
- **F450 專屬規則**（`F450_RULES_VERIFIED = False` 期間）：
  - 標題由後端決定，例如「考核（試行分數）」，不採用前端送的標題。
  - 不記「通過／不通過」。
  - 摘要只收白名單欄位（模式、五個分項、安裝件數、接對條數、錯誤次數）；多送的欄位直接丟掉。
  - 摘要強制 `trial: true`，前端關不掉。
  - 總分必須等於五個分項相加（容許四捨五入），擋掉明顯竄改的資料。

### 學員與教師頁面
- **學員「模擬練飛紀錄」頁**：F450 紀錄顯示分項（例如「機架 20/20、…」）和「試行分數，規則待實機核對，不計正式成績」。
- **教師「全班模擬練飛紀錄」頁**：同上；學員總覽多一欄「F450 組裝接線（試行最佳）」。
- 原本的「最佳分數」**不含** F450 試行分數，避免和模擬器飛行分數混在一起。

### F450 頁面
- 新增 `training/records.js`：
  - 先問 API 是否已登入，再帶 CSRF 送出。
  - 只送成績摘要，不送學員或班級。
- 成績單下方新增保存列：
  - 已登入：顯示暱稱。練習或教學模式有「保存這次成績到練習紀錄」按鈕；考核交卷後自動保存。
  - 未登入：說明要登入並給登入連結，不會送出任何資料。
  - 沒有後端的版本（本機檔案、GitHub Pages、雲端靜態版）：說明成績不會保存，不顯示按鈕。
- 實訓卡 A 加上「我的練習紀錄」連結。
- 實訓卡 B（FPV）的第 3 步改成：到「我的學習」，在老師指定的任務卡「上傳佐證」放入 PNG（走既有的 Evidence 上傳）。

## 2. 需要你決定的事

1. **FPV 用哪張任務卡**：目前沒有專門的 FPV 任務卡，所以頁面寫「老師指定的任務卡」。要新增一張 FPV 任務卡嗎？新增任務會出現在所有學員的任務列表裡，是教學安排上的決定，我沒有自行新增。
2. **正式考核**：分數仍是瀏覽器計算的試行分數。要變成正式成績，需要：
   - 教師用 Pixhawk 2.4.8 實機照片逐條核對規則。
   - 把判分搬到後端重算（防止竄改）。

## 3. 順手處理的既有問題

`learning/tests/migration_assertions.py` 的遷移登記清單（保護「不可悄悄新增 migration」）：
- 正式站 2026-11-07 加的 `0032_sim_practice_record` 當時沒有登記，所以這個保護測試在正式版本來就是失敗的。
- 這次補登 0032，並登記 0033。只改清單，不改任何 migration 內容。

## 4. 程式變更清單

| 檔案 | 變更 |
|---|---|
| `student_portal/learning/models.py` | `SimPracticeRecord.Mode` 加 `F450` |
| `student_portal/learning/migrations/0033_sim_practice_f450_mode.py` | 新增（no-op） |
| `student_portal/learning/sim_practice.py` | F450 摘要白名單、試行標記、總分檢查、後端決定標題；最佳分數不含試行；F450 分項文字 |
| `student_portal/learning/templates/learning/student_sim_practice.html`、`teacher_sim_practice.html` | 顯示分項與試行標記；教師總覽加試行最佳欄 |
| `student_portal/learning/tests/test_sim_practice.py` | 新增 7 項 F450 測試 |
| `student_portal/learning/tests/migration_assertions.py` | 登記 0032（補登）、0033 |
| `f450-twin/training/records.js` | 新增：保存成績 |
| `f450-twin/training/session.js` | 保存列、交卷自動保存；說明文字更新 |
| `f450-twin/training/sync3d.js` | 畫線時立刻判斷可見性（修正一格畫面的多餘線） |
| `f450-twin/index.html`、`twin.css` | 連結、樣式、快取版本 |
| `live_backend/tests/test_f450_twin_page.py` | 新增：實訓模組都能載入、FPV 連結安全、沒有 iframe |
| `tests/f450-training/records_e2e.cjs`、`fixtures/*.json` | 新增：成績保存端對端與擷取的實際送出資料 |
| `tests/f450-training/*_e2e.cjs` | 截圖逾時改為記「略過」，不中斷功能檢查 |

## 5. 測試結果

| 測試 | 結果 |
|---|---|
| Django `learning.tests.test_sim_practice`＋兩個遷移登記測試 | 21／21 |
| Django `learning` 整套（1344 項） | 19 項失敗，**在原始版本 98040d1 上同樣 19 項失敗**（逐一比對），都是正式版既有問題、與 F450 無關；其中 2 項遷移登記測試已因補登而通過 |
| live_backend `test_f450_twin_page` | 5／5 |
| 單元（model＋scoring） | 53／53 |
| 瀏覽器端對端 | 見第 6 節 |

**前後端格式一致的驗證**：
- 瀏覽器測試擷取頁面「實際送出」的 JSON（練習、考核各一份），存成 `tests/f450-training/fixtures/`。
- Django 測試把同一份 JSON 原封不動送進真的 API，兩份都得到 201。

### 其餘 17 項既有失敗（未處理，供參考）
平台入口與靜態資源（`test_platform_access` 7 項、`test_public_platform`、`test_auth` 首頁按鈕）、R07 上傳（3 項）、CSRF 來源交換、電力巡檢入口資料、學員 email 登入訊息、螺旋槳檢測頁、視覺模型教師頁。多半與這個工作目錄缺少正式站的平台檔案或環境設定有關，**不在 F450 範圍，沒有修改**。

## 6. 端對端（瀏覽器）

最後一次完整重跑（五套依序、單獨執行），全部通過、沒有略過任何截圖：

| 套件 | 結果 |
|---|---|
| `records_e2e.cjs`（P6 成績保存：已登入、未登入、沒有後端三種情況） | 20／20 |
| `sync_e2e.cjs`（P4 同步） | 20／20 |
| `wiring_e2e.cjs`（P3 接線） | 29／29 |
| `modes_e2e.cjs`（P5 三模式） | 36／36 |
| `practice_e2e.cjs`（P2 組裝，30 件實際拖曳） | 80／80 |

過程中發現：電腦忙的時候，P4「勾選後 3D 畫線數」偶爾會多算一條。原因是新畫的線要等下一格畫面才隱藏 3D 沒有的零件，學員也可能看到一瞬間的多餘線。已改成畫線時立刻判斷。截圖逾時改為只記「略過」，不中斷功能檢查；這次重跑沒有發生。

## 7. 風險

| 風險 | 程度 | 處理 |
|---|---|---|
| 分數由瀏覽器計算，可被竄改 | 中 | 標「試行」、不判通過、不算最佳分數；總分與分項須一致；正式考核前要改成後端重算 |
| F450 紀錄算進每天 300 筆上限 | 低 | 與練飛共用上限；一般練習量遠低於上限 |
| 0032 補登被誤解為新變更 | 低 | 清單註解寫明「已在正式站，當時未登記，2026-11-14 補登」 |
| 正式站部署需要跑 migrate | 低 | 0033 是 no-op，但 P8 部署時仍需執行 `migrate`（P8 需要你批准） |

## 8. 回滾

P6 只有一個提交：`git revert <P6 提交>`。0033 是 no-op；若已在正式站執行過，回滾到 0032 的指令：`python manage.py migrate learning 0032`（不影響資料）。
