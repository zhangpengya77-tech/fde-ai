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

## 免費上線：Streamlit Community Cloud

本專案已提供 `streamlit_app.py`，可透過 Streamlit Community Cloud 從 GitHub 免費部署成公開網址。

部署步驟：

1. 登入 GitHub，確認可以看到此倉庫。
2. 打開 [Streamlit Community Cloud](https://share.streamlit.io/)。
3. 使用 GitHub 帳號登入 Streamlit。
4. 點選 `New app`。
5. Repository 選擇 `Elijahieee/fde-ai`。
6. Branch 選擇 `main`。
7. Main file path 填入 `streamlit_app.py`。
8. 按 `Deploy`。
9. 若倉庫是私人倉庫，部署完成後到 App settings 的 Sharing，把 `Who can view this app` 改成公開，其他人才能不用登入觀看。

部署完成後，Streamlit 會產生一個公開網址，其他人可直接打開觀看網站展示版。

注意：Streamlit 免費上線版目前主要用於展示 `學・練・作・測・證` 網站內容。本機 YOLOv8、RAG 知識庫、語音助教與 E 盤資料夾不會自動上傳到 Streamlit 雲端；這些功能仍需在本機服務啟動，或後續再拆成雲端後端服務。

## 測：本機 YOLOv8 檢測服務

1. 先確認模型在：
   `E:\FDE_AI_F450_Dataset 無人機影像資料集專案\05_Model_Training 訓練結果\fde_f450_parts_v2_cw_ccw_full\weights\best.pt`
   四面懸停基準模型在：
   `E:\四面懸停\hover_model_v1\hover_model.json`
2. 在網站資料夾執行：
   `python api\yolo_server.py`
   如果你的電腦有 npm，也可以用：
   `npm run yolo:serve`
3. 打開 `index.html`，到「測」上傳 F450 組裝照片或四面懸停影片，按對應檢測按鈕。

目前第二版模型使用 49 張圖片與 CW/CCW 補標資料訓練，可偵測 CW 正槳、CCW 反槳、馬達、機臂、飛控與 GPS/指南針等類別。因資料量仍小，AI 結果先作為初判，最終仍需老師複核。
四面懸停第一版模型使用 `E:\四面懸停` 的 67 段影片建立穩定度基準，其中 55 段可用；目前輸出漂移距離、越界比例、穩定時間、方向完成度、姿態晃動與 AI 初評分數。

## 測試

```powershell
node --test tests/platform.test.js
```

## 後續接入

- RAG 知識庫：替換 `simulateBuildAssistant()`。
- GPT 語音回答：接入語音輸出服務後更新「做」板塊。
- YOLOv8 組裝檢測：已新增 `api/yolo_server.py`，網站會優先呼叫本機 v2 模型，連不上時才顯示模擬結果。
- YOLOv8 四面懸停評分：替換 `simulateHoverAssessment()`。
- GitHub 存證：可加入自動產生報告與提交指引。
