# F450 實訓中心 P8：正式部署紀錄

- 部署時間：2026-11-15 01:07–01:08
- 批准：使用者 2026-11-15「批准，現在部署」
- 執行：`docs/f450-training/p8/p8_deploy.ps1`（日誌 `D:\FDE-AI-Runtime\v2-integration\logs\p8_f450_deploy_20261115_*.log`）

## 結果

| 步驟 | 結果 |
|---|---|
| 0. 檢查 | 通過（工作目錄乾淨、原版本 98040d1、可快轉、1f2d99a 之後只有文件） |
| 1. 備份 | 程式標籤 `backup/pre-f450-training-20261115` → 98040d1；資料庫 `db\integration.before-f450-training-20261115_010741.sqlite3` |
| 2. 程式 | 98040d1 → 2a85087（快轉） |
| 3. 資料庫 | `learning.0033_sim_practice_f450_mode` OK；`seed_tasks` 新增 1 項（T13），其他任務未覆寫 |
| 4. Django 重新啟動 | 01:08 完成（`restart_django_clean_20261115_010746.log`：登入頁已是新版） |
| 5. 自動檢查 | `ok: true`，沒有問題 |

Git 輸出的「failed to write commit-graph」是 Git 自己的索引快取寫不進去，不影響程式；`git log` 與快轉結果正常。

## 部署後檢查

- 服務：FDE-Django、Live、Gateway、Entry、Tunnel 都在執行。
- 公開網址回應 200：`/f450-twin/`、`/f450-twin/training/session.js`、`/student/sim-practice/api/`、`/`、`/login/`、`/airspace/`；F450 頁含實訓區與 M13。
- 公開網址瀏覽器冒煙測試（只讀、不登入、不送成績），電腦與手機尺寸都通過：
  - 3D 模型與實訓模組載入
  - 3D 拖曳安裝
  - 2D 連線
  - 真實成績 API 回應「未登入」
  - 沒有腳本錯誤

## 還需要人工做的

部署計畫第 6 節的清單需要登入帳號與實機：
- 測試學員登入後保存成績；
- 教師頁查看；
- M13 上傳 PNG；
- iPhone 實機走一遍。

## 回滾

```powershell
& 'D:\FDE-AI-UAS-v2.0-integration\docs\f450-training\p8\p8_rollback.ps1' -Tag backup/pre-f450-training-20261115
```
