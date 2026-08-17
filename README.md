# fde-ai

fde-ai 是一個無需登入的無人機 AI 教學網站，第一階段先完成「學、練、做、測、證」五個獨立板塊與完整操作入口。

## v1.0 MVP 範圍

- 首頁：透明藍色無人機開機動畫，呈現「FDE-AI 無人載具學習平台」、「AI 驅動雙師教學系統」與「鷹眼 AI 評測系統」。
- 學：分為 F450 組裝與飛控、鳳凰模擬器、無人機證照學科、AI 應用、3D 列印、GitHub 成果存證，已放入 34 個 YouTube 影片連結。
- 練：聚焦鳳凰模擬器飛行練習、考照模擬練習與學科題庫刷題；鳳凰模擬器下載需聯繫後台管理員線下取得。
- 做：第一版只做 Pixhawk 2.4.8 的 F450 組裝與調參流程，支援照片與 30 秒影片入口，預留 RAG 知識庫與 GPT 語音問答。
- 測：包含 F450 組裝 AI 檢測與四面懸停 AI 評分，目前使用模擬結果，後續替換成真實 YOLOv8 模型。
- 證：整理學習過程、組裝證據、AI 測評結果與反思，上傳到自己的 GitHub 倉庫作為成果存證。

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
- YOLOv8 組裝檢測：替換 `simulatePropellerAssessment()`。
- YOLOv8 四面懸停評分：替換 `simulateHoverAssessment()`。
- GitHub 存證：可加入自動產生報告與提交指引。
