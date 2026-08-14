# FDE-AI 無人機 AI 教官平台

FDE-AI 是一個「學、練、做、測、證」五位一體的無人機訓練網站。第一版聚焦 F450 組裝與四面懸停訓練流程，先完成可展示、可操作的網站，再接入真正的 AI 評測系統。

## v1.0 範圍

- 無需登入，打開網站即可使用。
- 提供 Learn、Practice、Build、Assess、Certify 五個模組。
- F450 組裝 SOP 依照 10 個階段呈現。
- 評測區支援照片與影片上傳介面。
- AI 評測目前使用模擬結果，方便先展示完整流程。
- 後續可接入 YOLOv8、Python 指標計算與 rules.yaml 規則引擎。

## 本地開啟

直接用瀏覽器開啟 `index.html`。

## 測試

```powershell
node --test tests/platform.test.js
```

## 後續評測系統接入點

- `src/platform.js`：可測試的平台資料與模擬評測函式，未來可替換為 API 呼叫。
- `src/platform-browser.js`：讓 `index.html` 可直接用瀏覽器開啟的資料橋接檔。
- `simulatePhotoAssessment()`：接入 F450 組裝照片檢測。
- `simulateHoverAssessment()`：接入四面懸停影片評分。
- `src/app.js`：負責把評測結果顯示在網站上。
