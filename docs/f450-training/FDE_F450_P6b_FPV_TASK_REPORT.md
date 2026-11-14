# F450 實訓中心 P6-b 報告：新增 FPV 任務卡（T13）

- 日期：2026-11-14
- 分支：`feat/f450-assembly-training`（未推送、未發布）
- 依據：使用者 2026-11-14「新增 FPV 任務卡」

## 1. 做了什麼

新增任務 **T13「FPV 穿越機接線實訓」**，學員看到的編號是 **M13**。

| 欄位 | 內容 |
|---|---|
| 階段 | 練（practice） |
| 排序 | 與 T05 相同（5），所以列表上緊接在「F450 工程組裝」之後 |
| 說明 | 用外部 FPV 接線模擬器（花生FPV 公開網站 hs-fpv.com，從 F450 頁進入）練習；匯出接線圖 PNG 上傳本卡，由教師審核；外站操作不會自動記錄 |
| 要求 | 完成一組完整接線；匯出 PNG，並用文字說明電源與訊號各接到哪裡 |
| 佐證 | FPV 接線圖 PNG、接線說明 |
| 成長紀錄 | 沒有一對一槽位；標「相關：R05」，說明為 F450 工程組裝的延伸練習（與 T06 相同的做法） |

PNG 上傳走既有的「上傳佐證」（Evidence），沒有新增任何上傳程式。F450 頁的 FPV 卡第 3 步改成直接寫「打開任務卡『M13 FPV 穿越機接線實訓』」。

## 2. 請注意：學員完成度的分母會從 12 變 13

新任務對**所有班級、所有學員**都有效：
- 教師總覽的課程進度會從「x / 12」變成「x / 13」。
- **已經完成全部 12 張的學員，會顯示 12 / 13**，看起來還沒完成。

如果不希望影響既有學員，需要另外決定，例如只對新班級開放。目前系統沒有「選修」或「限定班級」的任務設定，要做的話是另一項開發。

## 3. 程式變更清單

| 檔案 | 變更 |
|---|---|
| `student_portal/learning/data/tasks_v1.json` | 新增 T13 |
| `student_portal/learning/course_sync.py` | 任務編號檢查從 T01–T12 改成 T01–T13 |
| `student_portal/learning/management/commands/seed_tasks.py` | 完成訊息改成依實際數量顯示（原本寫死「12 項」） |
| `student_portal/learning/growth_task_map.py` | T13 相關紀錄 R05 與說明 |
| `student_portal/learning/tests/test_seed_tasks.py`、`test_course_sync.py`、`test_enrollments.py` | 12 → 13、排序（T13 在 T05 後）；排序加上編號作為同分時的先後 |
| `student_portal/learning/tests/test_t13_fpv_task.py` | 新增：學員打開 M13、上傳 PNG、授權教師可下載 |
| `f450-twin/index.html` | FPV 卡第 3 步指向 M13 |

不需要資料庫 migration（任務是資料，不是結構）。

## 4. 測試

- 任務相關測試（seed、course sync、enrollments、P2 任務紀錄鏈、T13）全部通過
- `learning` 整套：1346 項，17 項失敗，逐一比對**全部是正式版既有的 17 項**，沒有新的失敗（P6 報告第 5 節有清單）

## 5. 正式站部署時（P8，需要你批准）

正式站資料庫要執行一次 `python manage.py seed_tasks`，才會出現 T13。這個指令只新增缺少的任務，不覆寫老師改過的內容。

## 6. 回滾

- `git revert <本提交>`。
- 若已在正式站建立 T13：到後台把 T13 設成「停用」（active=false），學員就看不到。不建議直接刪除，因為可能已經有學員上傳的佐證。
