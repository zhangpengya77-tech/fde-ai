# fde-ai

fde-ai 是一個無需登入的無人機 AI 教學網站，第一階段先完成「科技展廳感 + 項目控制台感 + 教學平台感」的 1.0 MVP。

## v1.0 MVP 範圍

- 首頁：深藍黑科技展廳，呈現「FDE-AI 無人載具學習平台」、「AI 驅動雙師教學系統」與「鷹眼 AI 評測系統」。
- 學習資料流：用「學・練・作・測・證」五個節點作為全站核心視覺語言。
- 學生控制台：顯示本週任務、AI 待檢測、教師待複核、已完成作品與目前 Mission 進度。
- Mission Pack：依課程大綱呈現 M01–M12 任務包卡片。
- 鷹眼 AI 檢測中心：整合 F450 組裝檢測、四面懸停評分、PASS / WARNING / FAIL 與教師待複核狀態。
- 教師復核中心：高資訊密度呈現今日提交、待復核、AI 警告、本班完成率與待復核隊列。
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

## 測：本機 YOLOv8 檢測服務

1. 先確認模型在：
   `E:\FDE_AI_F450_Dataset 無人機影像資料集專案\05_Model_Training 訓練結果\fde_f450_parts_v1\weights\best.pt`
2. 在網站資料夾執行：
   `python api\yolo_server.py`
   如果你的電腦有 npm，也可以用：
   `npm run yolo:serve`
3. 打開 `index.html`，到「測」上傳 F450 組裝照片，按「執行組裝檢測」。

目前第一版模型使用 49 張已標註圖片訓練，可偵測馬達、機臂、飛控與 GPS/指南針等現有標註類別。若要判斷 CW/CCW 槳葉方向，需要下一版資料集中新增槳葉方向標註。

## 測試

```powershell
node --test tests/platform.test.js
```

## 後續接入

- RAG 知識庫：替換 `simulateBuildAssistant()`。
- GPT 語音回答：接入語音輸出服務後更新「做」板塊。
- YOLOv8 組裝檢測：已新增 `api/yolo_server.py`，網站會優先呼叫本機模型，連不上時才顯示模擬結果。
- YOLOv8 四面懸停評分：替換 `simulateHoverAssessment()`。
- GitHub 存證：可加入自動產生報告與提交指引。
