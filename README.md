# fde-ai

fde-ai 是一個無需登入的無人機 AI 教學網站，第一階段先完成「學、練、做、測、證」五個獨立板塊與完整操作入口。

## v1.1 範圍

- 首頁：透明藍色無人機開機動畫與平台介紹。
- 學：F450 組裝、Mission Planner 地面站、官方文件與下載連結。
- 練：模擬器下載入口、安裝步驟與四面懸停練習任務。
- 做：F450 實物組裝 SOP，支援照片與 30 秒影片入口，預留 RAG 知識庫與 GPT 語音問答。
- 測：照片上傳與 YOLOv8 槳葉 CW / CCW 正反面檢測預留介面，目前使用模擬結果。
- 證：GitHub 成果存證清單。

## 本地開啟

直接用瀏覽器開啟：

```text
index.html
```

## 測試

```powershell
node --test tests/platform.test.js
```

## 後續接入

- RAG 知識庫：替換 `simulateBuildAssistant()`。
- GPT 語音回答：接入語音輸出服務後更新「做」板塊。
- YOLOv8 槳葉檢測：替換 `simulatePropellerAssessment()`。
- GitHub 存證：可加入自動產生報告與提交指引。
