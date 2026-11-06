# FDE-AI V2.0C 正式版（2026-11-06）

> V2.0C ＝ 目前對外上線的正式版本。版本命名比照 V1.5C（C＝Classroom 正式課堂版）。

## 對外網址（固定不變）

| 用途 | 網址 |
|---|---|
| 公開首頁（GitHub 頁面，永遠在線） | https://zhangpengya77-tech.github.io/fde-ai/v2/ |
| 學員登入 | https://fde-ai-v2.fde-ai-gateway.workers.dev/login/ |
| 學員註冊 | https://fde-ai-v2.fde-ai-gateway.workers.dev/register/ |
| 教師登入 | https://fde-ai-v2.fde-ai-gateway.workers.dev/teacher/login/ |

## 部署架構（比照 V1.5C 靜態／動態分層）

- **靜態層（GitHub 頁面）**：公開課程、關於我們、介紹影片、F450 數位孿生；教師電腦關機時照常可看。
- **動態層（教師電腦）**：註冊、登入、上傳、AI 檢測、AI 陪做，由 8 個 Windows 服務執行。
- **固定入口（Cloudflare Worker `fde-ai-v2`）**：網址永遠不變，轉送到教師電腦當次的快速通道；
  開機登入 Windows 後由排程「FDE-AI v2.0 Worker Origin Sync」自動更新轉送目標。
- **主機在線偵測**：GitHub 頁面每 60 秒確認一次；離線時互動按鈕會提示「主機離線」。

## 本版主要內容

- 首頁：霓虹光環 3D F450、學練做測證彩色發光徽章、左上角「關於我們（點我）」、主標題一行
- 關於我們：58 秒介紹影片（台灣口音配音、繁體字幕、3D 透明無人機背景）＋橫式版
- F450 數位孿生 1.2：真機實拍對照（教師已同意公開）、Pixhawk 2.4.8 接線資料、接線教學依序播放
- 學員註冊：Gmail 驗證碼自行開通＋教師後台人工開通（寄不到信時的備案，依班級隔離）
- 登入頁：顯示密碼、自動去空白
- 固定入口 Worker（`cloudflare/v2-fixed-entry/`，7 項單元測試）

## 不包含（依規定不上傳）

金鑰（keys.env）、資料庫、學員上傳資料（media）、模型權重、Session／Cookie。
