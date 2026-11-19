# 部署與回退計畫（尚未部署，需使用者授權）

## 目前狀態
- 程式在 `D:\FDE-AI-youth-lab`（分支 `feature/youth-drone-stem-lab`），**未 commit、未 push、未部署**。
- 正式站沒有任何改動。

## 建議部署步驟（使用者說「更新正式站」後才執行）
1. 正式站建立回退標籤：`git -C D:\FDE-AI-UAS-v2.0-integration tag backup/pre-youth-lab-YYYYMMDD`。
2. 在開發分支 commit，再把正式站快轉合併此分支。
3. `live/youth/` 由既有 `/live` 掛載提供，**不需重啟任何服務**；網址 `/live/youth/`。
4. 入口：先維持 `YOUTH_LAB_ENTRY = false`（只有知道網址或用 `?youth=1` 的人看得到），老師試用後再改成 `true`。
5. 部署後驗收：手機、平板、電腦各開一次；接一支實體 USB 遙控器測試。

## 選配（需要另外授權）
- `/youth/` 短網址：在 Worker 或 Live 加轉址到 `/live/youth/`（新 Mount 需重啟 FDE-Live，需系統管理員）。
- GitHub Pages 離線版：three.js 路徑目前是站內絕對路徑 `/f450-twin/vendor/...`，搬到 Pages 需改 importmap。
- 教師後台正式化：學習紀錄寫入伺服器、沿用 student_portal 班級權限，需後端開發。

## 回退
- 部署後要撤下：`git -C D:\FDE-AI-UAS-v2.0-integration reset --keep backup/pre-youth-lab-YYYYMMDD`（靜態檔，不需重啟）。
- 只想關入口：把 `src/programs.js` 的 `YOUTH_LAB_ENTRY` 改回 `false`。
- 學員紀錄在各自瀏覽器，回退不會刪除或影響任何正式資料庫。
