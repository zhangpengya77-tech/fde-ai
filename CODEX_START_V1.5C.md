# FDE-AI-UAS v1.5C 開發規則

## 開發基準

目前唯一正式開發基準是 `fde-ai-v1.5c`。

`v1.5B` 是冻结的歷史穩定版本，禁止直接修改。新功能只能從 v1.5C 開始。

## 工作流程

每次開發前先執行現有測試；完成後必須執行完整回歸測試、Django check 與 Migration check，再提交變更。

## 禁止提交

- `.env`
- 資料庫檔案
- 學員資料
- `media/` 與 `uploads/`
- Token、密碼、Cookie、Session、驗證碼
- `logs/` 與執行期狀態

## 必須維持

- 註冊與登入
- R01～R08
- 照片上傳
- 影片上傳與 30 秒處理
- Gateway
- GitHub Pages 靜態／動態分層

本基準不實作 R08 調查表、Digital Twin、Three.js 或 2.0 功能。
