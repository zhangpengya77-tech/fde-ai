# FDE-AI-UAS v2.0 — 目標架構設計（修正版）

> Phase 0 架構審查產出物 | 修正日期: 2026-09-27
> **本版修正**: v2.0 核心從 Three.js Digital Twin / R08 Survey / CI/CD 修正為 **FDE Live Coach（即時 AI 實訓助教）**。
> Three.js / R08 / CI/CD 降級為 Secondary Roadmap，不刪除但不作為 v2.0 主架構。
> 本文件僅為架構設計與決策記錄，不涉及任何程式碼實作。

---

## 1. 架構原則

1. **v1.5C 凍結** — v1.5C 是穩定基準（Photo Check 模式），所有新功能從 v2.0 分支開始
2. **Live Coach 為核心** — v2.0 = AI 陪著學生一起做（即時攝影機 → 持續 YOLO → SOP → RAG → 語音）
3. **向後相容** — v2.0 必須能呼叫所有 v1.5C 服務，不破壞 Photo Check 功能
4. **漸進增強** — 靜態公開內容持續可用，Live Coach 動態功能按需啟用
5. **離線優先** — 筆電關機時公開內容仍可瀏覽，Live Coach 顯示「即時助教離線」
6. **教師覆核** — AI 即時建議始終標記「待教師複核」，不取代教師最終判斷

---

## 2. v2.0 核心產品：FDE Live Coach

### 2.1 產品定義

FDE Live Coach 是一套即時 AI 實訓助教系統。學生在組裝 F450 四旋翼時，使用手機或筆電瀏覽器開啟後攝影機，AI 持續辨識畫面中的零件、追蹤 SOP 步驟、提供 RAG 知識指導、並支援即時語音問答。

### 2.2 核心能力

| 能力 | 說明 | 對應開發階段 |
|------|------|-------------|
| 即時攝影機 | 手機瀏覽器 `getUserMedia()` 取得後攝影機畫面，定時抽 Frame（1-2 fps） | Phase 1 |
| 持續 YOLO 推論 | 每幀送至 YOLO :8765 進行零件辨識，回傳 class + confidence + bbox | Phase 1 |
| SOP 步驟追蹤 | 根據 YOLO 辨識結果，判斷學生目前做到 SOP 哪一步，顯示下一步指引 | Phase 2 |
| RAG 知識查詢 | 學生遇到問題時，AI 結合 Current Task / YOLO Result / Expected Result 查詢 RAG 知識庫 | Phase 3 |
| 即時語音 AI | 學生語音提問 → AI 取得上下文 → 語音回答；支援雙向互動 | Phase 4 |
| Session / 學習紀錄 | 記錄整個 Live Coach session 的步驟軌跡、錯誤、修正歷程 | Phase 5 |

### 2.3 與 v1.5C Photo Check 的本質差異

```
v1.5C Photo Check（做完後檢查）:
  學生操作 → 拍照 → 上傳 → YOLO 一次性檢測 → AI/RAG → PASS/NG → 教師復核

v2.0 Live Coach（陪著一起做）:
  手機攝影機持續開啟
  → 學生一邊操作
  → YOLO 持續取得最新辨識結果
  → SOP 知道目前做到哪一步
  → 學生直接語音提問
  → AI 取得 Current Task / Current Step / YOLO Result / Expected Result / RAG Knowledge
  → 即時語音回答
  → 學生修改
  → 再次辨識
  → PASS
  → 下一步
```

| 維度 | v1.5C Photo Check | v2.0 Live Coach |
|------|-------------------|-----------------|
| 攝影機 | 單次拍照 | 持續開啟 |
| YOLO | 一次性檢測 | 持續推論（1-2 fps） |
| 步驟追蹤 | 無（學生手動選擇檢查項目） | SOP 狀態機自動追蹤 |
| RAG | 學生手動輸入問題 | AI 自動組裝上下文（YOLO + SOP）查詢 |
| 語音 | 無 | 雙向即時語音互動 |
| 時序 | 做完後才檢查 | 過程中即時陪伴 |
| 速率需求 | 5/min 足夠 | 需 60-120/min（每秒 1-2 幀） |

---

## 3. 完整 v2.0 架構圖

### 3.1 FDE Live Coach 核心架構

```
┌──────────────────────────────────────────────────────────────────┐
│                        學員裝置（手機 / 筆電）                       │
│                                                                    │
│  瀏覽器 (GitHub Pages 靜態站 + Cloudflare Worker 動態代理)           │
│                                                                    │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │ Live Camera │  │  Detection   │  │   SOP UI     │            │
│  │ getUserMedia│  │  Overlay     │  │  Step Guide  │            │
│  │ (後攝影機)   │  │  (bbox 繪製) │  │  (目前步驟)  │            │
│  └──────┬──────┘  └──────▲───────┘  └──────▲───────┘            │
│         │                  │                 │                     │
│         │          ┌───────┴────────────────┘                     │
│         │          │     Live Coach Frontend (JS)                │
│         │          │  - frame extraction (1-2 fps)               │
│         │          │  - detection result rendering              │
│         │          │  - SOP state machine                       │
│         │          │  - voice input/output                      │
│         └──────────┼──────────────────────────────┐              │
│                     │                              │              │
└─────────────────────┼──────────────────────────────┼──────────────┘
                      │                              │
                      ▼                              ▼
              ┌───────────────┐              ┌───────────────┐
              │ Cloudflare    │              │  (離線時)     │
              │ Worker Gateway│              │  靜態降級     │
              │               │              │  「助教離線」  │
              └───────┬───────┘              └───────────────┘
                      │
              ┌───────▼───────┐
              │ Quick Tunnel   │
              │ (trycloudflare)│
              └───────┬───────┘
                      │
    ┌─────────────────┼──────────────────────────────────┐
    │                 │                                  │
    ▼                 ▼                                  ▼
┌─────────────┐ ┌───────────┐                  ┌─────────────────┐
│  YOLO       │ │  Django   │                  │  RAG             │
│  :8765      │ │  :8022    │                  │  :8770           │
│             │ │           │                  │                  │
│ POST /api/  │ │ v1.5C     │                  │ v1.5C 保留       │
│ detect      │ │ + Live    │                  │ POST /api/rag/  │
│             │ │ Coach     │                  │ ask              │
│ (即時推論)   │ │ Endpoint  │                  │                  │
│             │ │ (新增)    │                  │                  │
└──────┬──────┘ └─────┬─────┘                  └──────────────────┘
       │              │
       ▼              ▼
┌──────────────────────────────────────────────────────┐
│              教師筆電（本地服務層）                      │
│                                                        │
│  ┌─────────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ SOP Engine  │  │ Voice AI │  │ Orchestrator     │ │
│  │ (步驟狀態機) │  │ (語音    │  │ (座標調度)        │ │
│  │             │  │  雙向)   │  │                  │ │
│  └──────┬──────┘  └────┬─────┘  └────────┬─────────┘ │
│         │              │                  │            │
│         └──────────────┴──────────────────┘           │
│                        │                              │
│                        ▼                              │
│              ┌──────────────────┐                     │
│              │ Session /        │                     │
│              │ Learning Record  │                     │
│              │ (步驟軌跡 + 修正) │                     │
│              └──────────────────┘                     │
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │ E:\ 外部資源                                     │   │
│  │  - YOLO best.pt (模型)                         │   │
│  │  - hover_model.json                             │   │
│  │  - Voice RAG knowledge_base                     │   │
│  └────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

### 3.2 v2.0 MVP 即時鏈路資料流

```
手機瀏覽器
  │
  │ 1. getUserMedia({ video: { facingMode: 'environment' } })
  │    → 取得後攝影機 video stream
  │
  │ 2. setInterval / requestAnimationFrame
  │    → 每 500-1000ms 從 video element 截一幀
  │    → canvas.drawImage → canvas.toDataURL('image/jpeg', 0.7)
  │    → 得到 base64 JPEG frame
  │
  │ 3. POST frame (base64) → Cloudflare Worker Gateway
  │    → Quick Tunnel → 教師筆電
  │
  │                          ┌─────────────────────────┐
  │                          │ YOLO :8765              │
  │                          │ POST /api/detect        │
  │                          │  - base64 imageData     │
  │                          │  - → YOLOv8 推論         │
  │                          │  - → 回傳:              │
  │                          │    className            │
  │                          │    confidence           │
  │                          │    box [x1,y1,x2,y2]   │
  │                          │    annotatedImage       │
  │                          └────────────┬────────────┘
  │                                       │
  │ 4. 回傳 JSON detections ←──────────────┘
  │
  │ 5. 前端在 video overlay 上繪製:
  │    - bounding box (canvas)
  │    - className + confidence 標籤
  │    - 顏色: PASS=綠 / NG=紅 / UNKNOWN=灰
  │
  │ 6. (MVP 範圍到此為止)
  │    SOP / RAG / Voice 在 Phase 2-4 逐步加入
  │
  ▼

v1.5C 限制（不得用於 Live Coach）:
  - Django public_ai.py inspection 5/min 速率限制 → 不夠即時
  - Django public_ai.py 是同步 POST base64 → 延遲太高
  - 需要: 直接呼叫 YOLO :8765 或新增專用 Live Coach endpoint（無速率限制 or 60+/min）
```

### 3.3 v2.0 Phase 1-5 開發順序

```
Phase 1: Live Camera + YOLO（MVP）
  ├── 手機瀏覽器 getUserMedia() 後攝影機
  ├── Frame extraction (1-2 fps, JPEG base64)
  ├── Cloudflare Worker 代理 → YOLO :8765
  ├── YOLO 回傳 detections → 前端 overlay 繪製 bbox
  └── MVP 只測螺旋槳類別: CW_F, CCW_F, CW_B, CCW_B
      ⚠️ 目前模型只有 cw_propeller / ccw_propeller（無 front/back）
      → 需重新訓練或使用新模型

Phase 2: SOP Engine（步驟追蹤）
  ├── F450 組裝 SOP 狀態機定義
  ├── 根據 YOLO 辨識結果判斷目前步驟
  ├── 顯示「目前步驟」+「下一步指引」
  └── 步驟 PASS/NG 判定邏輯

Phase 3: RAG 知識查詢
  ├── AI 自動組裝查詢上下文:
  │   Current Task + Current Step + YOLO Result + Expected Result
  ├── 呼叫 RAG :8770 /api/rag/ask
  ├── 回傳知識庫答案 → 前端顯示
  └── 與 SOP Engine 整合：步驟錯誤時自動觸發 RAG 查詢

Phase 4: Voice AI（即時語音）
  ├── 學生語音輸入 → Speech-to-Text
  ├── AI 取得上下文 → RAG / Voice RAG 查詢
  ├── 回答 → Text-to-Speech → 語音輸出
  └── 支援雙向即時互動（非預錄音檔）

Phase 5: Session / Learning Record
  ├── 記錄整個 Live Coach session
  ├── 步驟軌跡（每步的 YOLO 結果、時間戳）
  ├── 錯誤記錄與修正歷程
  ├── 學習成果匯出
  └── 教師可回顧學生 session

──────────────────────────────────────────────
Secondary Roadmap（非 v2.0 核心，不刪除但降級）:
  ├── Three.js Digital Twin（3D 互動檢視）
  ├── R08 結訓調查表
  └── GitHub Actions CI/CD
──────────────────────────────────────────────
```

---

## 4. 服務邊界

### 4.1 v2.0 新增服務元件

| 元件 | 屬於 | 依賴 | 對外提供 | 開發階段 |
|------|------|------|---------|---------|
| Live Camera Module | 前端靜態 | getUserMedia API | 攝影機畫面 + Frame 抽取 | P1 |
| Detection Overlay | 前端靜態 | Canvas API | bbox 繪製 + 標籤 | P1 |
| SOP Engine | 前端/後端 | YOLO 結果 + f450_rules | 步驟狀態 + 下一步指引 | P2 |
| RAG Context Builder | 後端 | SOP + YOLO + RAG :8770 | 自動知識查詢 | P3 |
| Voice AI Module | 後端 | STT + TTS + RAG/Voice RAG | 雙向語音互動 | P4 |
| Session Recorder | 後端 | 全部元件 | 學習軌跡記錄 | P5 |
| Live Coach Endpoint | 後端 (Django or 獨立) | YOLO :8765 | 即時檢測代理（無嚴格速率限制） | P1 |

### 4.2 v1.5C 保留服務（不可破壞）

| 服務 | 位置 | v2.0 呼叫方式 | 修改風險 |
|------|------|-------------|---------|
| Django :8022 | 本地 | 透過 Gateway（v1.5C 路由保留） | 低 — 新增路由不影響舊有 |
| RAG :8770 | 本地 | HTTP API 直連或 Django 代理 | 無 — 不修改 |
| YOLO :8765 | 本地 | HTTP API 直連（P1 MVP 採用） | 無 — 不修改 YOLO 伺服器 |
| Gateway Worker | Cloudflare | 代理層 | 低 — 可新增 Live Coach 路由 |
| Photo Check (v1.5C) | Django + YOLO | 保留原有路由 | 無 — 不修改 |

### 4.3 關鍵架構決策：Live Coach 的 YOLO 呼叫路徑

**問題**: v1.5C 的 Django `public_ai.py` inspection 速率限制為 5/min，且同步 POST base64 延遲高。Live Coach 需要 60-120/min（1-2 fps），5/min 完全不夠。

**重要修正**: 外部手機**不能**直接訪問 `localhost:8765` 或教師筆電本地 IP。所有請求必須經過 Cloudflare Gateway + Tunnel 安全抵達本地服務。

正確的資料流路徑：
```
手機瀏覽器
  → GitHub Pages (前端靜態站)
  → Cloudflare Gateway (fde-ai-gateway.workers.dev)
  → Cloudflare Quick Tunnel (trycloudflare.com)
  → Django :8022 (新 endpoint, 不經 public_ai.py 5/min 限制)
  → YOLO :8765 POST /api/detect
  → 回傳 detections
  → Django → Tunnel → Gateway → 手機
```

**方案 A（MVP 推薦）**: Django 新增專用 Live Coach endpoint（不經 public_ai.py 速率限制）
- 前端 → Cloudflare Gateway → Quick Tunnel → Django `POST /api/live/vision/`（新路由）→ YOLO :8765 `/api/detect`
- Django 新路由不套用 public_ai.py 的 5/min 限制（設為 120/min 或無限制）
- 仍然經過 Cloudflare Gateway + Tunnel，安全且有記錄
- 可記錄 session、加入基本認證
- 不修改 YOLO 伺服器、不修改 RAG、不修改 Gateway Worker 核心

**方案 B（Phase 4+ 考慮）**: WebSocket 雙向通道
- 前端 ↔ Gateway ↔ Django/YOLO WebSocket
- 持續雙向串流，最低延遲
- 缺點: 需要修改 Gateway 支援 WebSocket 代理，架構複雜度高

**MVP 採用方案 A**（Django 新 endpoint），Phase 4 評估是否升級到 B。

**禁止**: 前端直接呼叫 `localhost:8765` 或教師筆電本地 IP — 外部手機無法也不可這樣做。

---

## 5. 資料流設計

### 5.1 Phase 1 MVP 資料流（Live Camera → YOLO → Overlay）

```
[手機瀏覽器]
  │
  │ getUserMedia({ video: { facingMode: 'environment' } })
  │ → <video> element 持續播放後攝影機畫面
  │
  │ setInterval(500-1000ms):
  │   1. canvas.drawImage(video, 0, 0, w, h)
  │   2. frame_base64 = canvas.toDataURL('image/jpeg', 0.7)
  │   3. fetch(GATEWAY_URL + '/api/detect', {
  │        method: 'POST',
  │        body: JSON.stringify({ imageData: frame_base64 })
  │      })
  │
  ▼
[Cloudflare Worker Gateway]
  │
  │ 動態前綴 /api/* → 代理到 Quick Tunnel
  │ → 教師筆電 Django 或直接 YOLO
  │
  │ ⚠️ MVP 可考慮:
  │   方案 A: /api/detect → 直接代理到 YOLO :8765
  │   方案 B: /api/live-coach/detect/ → Django 新路由
  │
  ▼
[YOLO :8765]
  │
  │ POST /api/detect
  │ → base64 imageData → YOLOv8 推論
  │ → 回傳 JSON:
  │   {
  │     "detections": [
  │       {
  │         "className": "cw_propeller",  // MVP 目標: CW_F
  │         "confidence": 0.87,
  │         "box": [x1, y1, x2, y2],
  │         "center": [cx, cy],
  │         "annotatedImage": "data:image/jpeg;base64,..."
  │       }
  │     ]
  │   }
  │
  ▼
[前端 Detection Overlay]
  │
  │ 在 <video> 上疊加 <canvas>
  │ → 繪製 bbox + 標籤
  │ → 顏色判斷:
  │   confidence >= 0.55 → 綠色 (PASS)
  │   confidence < 0.55 → 紅色 (NG)
  │   未偵測 → 灰色 (UNKNOWN)
  │
  └── 學生即時看到辨識結果疊加在攝影機畫面上
```

### 5.2 Phase 2 SOP Engine 資料流

```
[YOLO 持續回傳 detections]
  │
  ▼
[SOP Engine (前端 JS)]
  │
  │ 1. 載入 SOP 定義 (JSON):
  │    Step 1: 準備零件 → 偵測 frame_arm, motor, esc...
  │    Step 2: 安裝馬達 → 偵測 motor 位置 (M1-M4)
  │    Step 3: 安裝槳葉 → 偵測 CW_F/CCW_F/CW_B/CCW_B
  │    Step 4: 連接飛控 → 偵測 flight_controller
  │    ...
  │
  │ 2. 根據 YOLO detections 判斷目前步驟:
  │    - 偵測到 frame_arm + motor → 可能 Step 2
  │    - 偵測到 cw_propeller → 可能 Step 3
  │
  │ 3. 查詢 f450_rules.json:
  │    M1 → CCW, M2 → CCW, M3 → CW, M4 → CW
  │    (blade_side: FRONT → v2.0 需 CW_F/CCW_F/CW_B/CCW_B)
  │
  │ 4. 判定 PASS/NG:
  │    - M1 位置偵測到 CCW → PASS → 下一步
  │    - M1 位置偵測到 CW → NG → 顯示錯誤提示
  │
  ▼
[UI 顯示]
  │
  │ - 目前步驟: Step 3 - 安裝槳葉
  │ - 進度: ████░░░░░░ 3/8
  │ - 下一步: 將 CCW 槳葉安裝到 M1（右前）
  │ - 狀態: M1=CCW ✓ / M2=? / M3=? / M4=?
  │
  └── NG 時觸發 Phase 3 RAG 查詢
```

### 5.3 Phase 3 RAG 資料流

```
[SOP Engine 偵測到錯誤]
  │
  │ Context: {
  │   currentStep: "Step 3 - 安裝槳葉",
  │   currentTask: "M1 安裝 CCW 槳葉",
  │   yoloResult: { className: "cw_propeller", confidence: 0.89 },
  │   expectedResult: "CCW 槳葉 (CCW_F)",
  │   actualResult: "CW 槳葉 (CW_F)",
  │   error: "M1 應安裝 CCW 槳葉，但偵測到 CW 槳葉"
  │ }
  │
  ▼
[RAG Context Builder]
  │
  │ 自動組裝查詢:
  │ "F450 M1 右前馬達應安裝 CCW 槳葉，但偵測到 CW 槳葉。
  │  請說明正確的槳葉安裝方式和注意事項。"
  │
  ▼
[RAG :8770 POST /api/rag/ask]
  │
  │ → hashed-char-ngram-2048 嵌入
  │ → top_k=5 檢索
  │ → min_score=0.58 過濾
  │ → 回傳 answer + sources
  │
  ▼
[前端顯示]
  │
  │ 知識指引:
  │ "M1 位於右前，應安裝 CCW（逆時針）槳葉。
  │  CCW 槳葉的標記通常在槳葉背面...
  │  [來源: F450 組裝手冊 p.12]"
  │
  └── 學生可選擇語音提問（Phase 4）
```

### 5.4 Phase 4 Voice AI 資料流

```
[學生語音輸入]
  │
  │ MediaRecorder API / Web Speech API
  │ → 錄音 → base64 audio
  │
  ▼
[Voice AI Module (後端 :8765 或獨立服務)]
  │
  │ 1. Speech-to-Text (STT)
  │    → 學生問題文字
  │
  │ 2. 取得上下文 (from SOP Engine + RAG):
  │    - currentStep, currentTask
  │    - yoloResult, expectedResult
  │    - 上一筆 RAG 答案
  │
  │ 3. 查詢 Voice RAG:
  │    → POST /api/voice/ask (YOLO :8765)
  │    → 關鍵詞匹配 + 查詢擴展
  │    → 或 RAG :8770 知識查詢
  │
  │ 4. Text-to-Speech (TTS)
  │    → 語音回答
  │
  ▼
[前端播放語音回答]
  │
  │ + 文字同步顯示
  │ + 學生可繼續追問
  │
  └── 雙向即時互動
```

### 5.5 Phase 5 Session / Learning Record 資料流

```
[整個 Live Coach session]
  │
  │ 每幀 YOLO 結果 → 時間戳 + detection
  │ 每次 SOP 步驟變更 → 步驟 ID + 狀態 + 時間戳
  │ 每次錯誤 → 錯誤類型 + YOLO 結果 + 預期結果
  │ 每次修正 → 修正前後對比
  │ 每次 RAG 查詢 → 問題 + 答案 + 來源
  │ 每次語音互動 → 文字記錄
  │
  ▼
[Session Recorder]
  │
  │ → 寫入資料庫 (SQLite or 新 collection)
  │ → session_id 關聯學生 enrollment
  │
  ▼
[教師後台]
  │
  │ - 查看學生 session 回放
  │ - 步驟軌跡時間線
  │ - 錯誤熱點分析
  │ - 學習成果匯出
  │
  └── 教師覆核最終結果
```

---

## 6. 離線降級策略

### 6.1 v1.5C 既有離線邏輯（保留）

| 狀態 | 行為 |
|------|------|
| 筆電關機 | Gateway 回傳離線 HTML，公開首頁/影片/課程仍可瀏覽 |
| 筆電開機 | 動態教學服務自動恢復（啟動鏈） |
| 離線時寫入請求 | 回傳 502 `classroom_upstream_unavailable` |

### 6.2 v2.0 Live Coach 離線策略

| 狀態 | Live Coach 行為 | 靜態內容行為 |
|------|----------------|-------------|
| 筆電在線 + 服務正常 | Live Coach 完整可用 | 正常 |
| 筆電在線 + YOLO 離線 | 顯示「YOLO 服務離線，無法即時辨識」 | 正常 |
| 筆電離線（關機/斷網） | 顯示「即時助教離線，請聯繫教師」 | 正常瀏覽 |
| 學生手機斷網 | Live Coach 無法取得畫面推論 | 離線頁面 |

**關鍵原則**: Live Coach 是即時服務，完全依賴本地 YOLO + RAG + Voice AI。筆電關機 = Live Coach 不可用。但公開靜態內容（GitHub Pages）仍可瀏覽。前端必須有明確的離線狀態提示。

---

## 7. Secondary Roadmap（非核心，降級處理）

以下三項在初版 v2.0 架構中被誤設為核心，現修正為 Secondary Roadmap。不刪除，但不在 v2.0 主開發範圍內：

### 7.1 Three.js Digital Twin

| 項目 | 內容 |
|------|------|
| 原定位 | v2.0 核心架構元件 |
| 修正定位 | Secondary Roadmap — Future Feature |
| 說明 | 3D 互動檢視是好的輔助工具，但不是 v2.0 的核心價值。Live Coach 完成後可作為 v2.1 或獨立功能加入 |
| 不刪除原因 | 可作為未來增強，且不影響 Live Coach 開發 |

### 7.2 R08 結訓調查表

| 項目 | 內容 |
|------|------|
| 原定位 | v2.0 核心架構元件 |
| 修正定位 | Secondary Roadmap — 可與 Phase 5 Learning Record 整合 |
| 說明 | R08 Survey 的 `survey_analytics.py` 已存在，可在 Live Coach Session Recorder 完成後整合為學習成果調查 |
| 不刪除原因 | 基礎設施已有，低成本低風險可加入 |

### 7.3 GitHub Actions CI/CD

| 項目 | 內容 |
|------|------|
| 原定位 | v2.0 核心架構元件 |
| 修正定位 | Secondary Roadmap — 工程改善 |
| 說明 | CI/CD 是工程實踐工具，不應作為產品架構核心。可在 v2.0 開發穩定後加入自動化測試管線 |
| 不刪除原因 | `.github/workflows/` 目錄已存在，加入成本低 |

---

## 8. 安全性考量

### 8.1 v1.5C 既有安全機制（保留）

- CSRF 驗證（Django 中介層）
- Session Cookie（生產環境 Secure + HttpOnly）
- SSL Redirect（生產環境）
- HSTS（生產環境）
- API 速率限制（RAG 30/min, Inspection 5/min, Voice 20/min）
- 檔案大小限制（圖片 18MB, 影片 260MB）
- 本機路徑隱去（RAG 錯誤訊息自動遮蔽）

### 8.2 v2.0 Live Coach 新增安全事項

| 風險 | 說明 | 緩解措施 |
|------|------|---------|
| 攝影機隱私 | 學生持續開啟攝影機，畫面透過網路傳輸 | 僅傳輸 frame base64，不儲存影像；session 結束後清除；HTTPS 加密傳輸 |
| 即時端點濫用 | Live Coach endpoint 無嚴格速率限制，可能被濫用 | 需認證 token；限制來源 IP（Gateway 層）；記錄使用日誌 |
| 語音資料 | 學生語音錄音含個資 | STT 完成後刪除音檔；僅保留文字記錄；不提交到 Git |
| Session 資料 | 學習軌跡屬學員個資 | 僅存本地 SQLite；禁止提交到 Git；教師需認證才能查看 |

---

## 9. 技術債與風險

### 9.1 v1.5C 已知問題（繼承至 v2.0）

| 問題 | 嚴重度 | 說明 | v2.0 影響 |
|------|--------|------|-----------|
| 啟動腳本硬編碼路徑 | 中 | `start_fde_ai_v15b.ps1` 引用 Codex 路徑 | Live Coach 服務依賴同一啟動鏈 |
| SQLite 用於生產 | 低 | 教學環境可接受 | Live Coach session 記錄可存 SQLite |
| E 盤依賴 | 中 | YOLO 模型、Hover 模型、Voice RAG 在 E 盤 | 磁碟遷移可能斷裂 |
| Django 速率限制 | 高 | Inspection 5/min 不夠即時 | **Live Coach 必須繞過或新增 endpoint** |

### 9.2 v2.0 新增風險

| 風險 | 嚴重度 | 說明 | 緩解方案 |
|------|--------|------|---------|
| YOLO 模型缺口 | 高 | 現有模型無 front/back 區分 | 需重新訓練 CW_F/CCW_F/CW_B/CCW_B 或使用新模型 |
| 即時延遲 | 中 | base64 同步 POST 可能延遲 300-800ms | P1 先驗證延遲；P4+ 考慮 WebSocket |
| 手機瀏覽器相容性 | 中 | getUserMedia 在舊版瀏覽器可能不支援 | 需要 HTTPS；測試 iOS Safari + Android Chrome |
| 攝影機頻寬 | 中 | 1-2 fps base64 JPEG 約 50-200KB/幀 | 壓縮品質 0.7；降低解析度 |
| Gateway WebSocket | 中 | Cloudflare Worker 免費版 WebSocket 有限制 | P1 先用 HTTP POST；P4+ 評估升級 |

---

## 10. 分支策略

### 10.1 v1.5C 分支結構（現況）

```
主倉庫: C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI

main (GitHub: zhangpengya77-tech/fde-ai)
  ├── fde-ai-v1.2 (歷史版本, worktree: FDE-AI-v1.2)
  ├── fde-ai-v1.5b (凍結, worktree: FDE-AI-v1.5)
  ├── fde-ai-v1.5c (穩定基準, worktree: D:\FDE-AI-UAS\v1.5C)
  └── fde-ai-v2.0a (前次 v2.0 嘗試, 主工作樹 checked out)
```

### 10.2 v2.0 建議分支策略

```
main
  ├── fde-ai-v1.5b (凍結，不動)
  ├── fde-ai-v1.5c (穩定基準，只做 bugfix)
  └── fde-ai-v2.0-dev (新功能開發 ← 從 v1.5c 拉出)
       ├── Phase 1: Live Camera + YOLO (MVP)
       ├── Phase 2: SOP Engine
       ├── Phase 3: RAG Integration
       ├── Phase 4: Voice AI
       └── Phase 5: Session / Learning Record
```

**規則**:
- v2.0 從 `fde-ai-v1.5c` 拉出新分支 `fde-ai-v2.0-dev`
- 已有的 `fde-ai-v2.0a` 分支保留不動（前次嘗試的記錄）
- v1.5C worktree 不動，只接受 bugfix
- Phase 1-5 在 `fde-ai-v2.0-dev` 分支上漸進開發
- 所有 Phase 完成且回歸測試通過後考慮合併到 `main`

### 10.3 Worktree 建立方案（僅規劃，不執行）

**目標目錄**: `D:\FDE-AI-UAS-v2.0`（目前已有 Phase 0 文件）

**衝突分析**:
1. `D:\FDE-AI-UAS-v2.0` 目錄已存在，內含三份 Phase 0 文件
2. 主倉庫已有 `fde-ai-v2.0a` 分支（前次 v2.0 嘗試，主工作樹已 checkout）
3. 需要建立新分支 `fde-ai-v2.0-dev`（不使用 v2.0a）

**建立步驟（規劃，本輪不執行）**:
```bash
# 1. 在主倉庫建立新分支（從 v1.5c）
cd "C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI"
git branch fde-ai-v2.0-dev fde-ai-v1.5c

# 2. 將現有 Phase 0 文件備份
mv "D:\FDE-AI-UAS-v2.0" "D:\FDE-AI-UAS-v2.0-phase0-backup"

# 3. 建立 worktree
git worktree add "D:\FDE-AI-UAS-v2.0" fde-ai-v2.0-dev

# 4. 將 Phase 0 文件移回
cp -r "D:\FDE-AI-UAS-v2.0-phase0-backup"/* "D:\FDE-AI-UAS-v2.0"/

# 5. 確認
cd "D:\FDE-AI-UAS-v2.0"
git branch   # 應顯示 fde-ai-v2.0-dev
```

**注意**: 上述步驟僅為規劃方案，Phase 0 階段不執行任何 Git 操作。

---

## 11. v2.0 開發規則

1. **不修改 v1.5C** — 所有修改只在 `fde-ai-v2.0-dev` 分支
2. **不修改 YOLO** — `yolo_server.py` 保持不動（除非重新訓練模型）
3. **不修改 RAG** — `rag_http_server.py` 保持不動
4. **不修改正式 Cloudflare** — Gateway Worker 不動（可新增路由規則，不改核心邏輯）
5. **漸進開發** — Phase 1 MVP 先驗證手機→YOLO→手機鏈路
6. **回歸測試** — 每次變更後執行完整測試
7. **禁止提交** — `.env`、資料庫、學員資料、`media/`、`uploads/`、Token、`logs/`
8. **教師覆核** — AI 即時建議標記「待教師複核」

---

## 12. Phase 0 產出物清單

- [x] `D:\FDE-AI-UAS-v2.0\PROJECT_CONTEXT.md` — 專案背景文件（已修正）
- [x] `D:\FDE-AI-UAS-v2.0\V2_ARCHITECTURE.md` — 目標架構設計（本文件，已修正）
- [ ] `D:\FDE-AI-UAS-v2.0\DEV_HANDOFF.md` — 開發交接文件（待修正）
- [x] 架構圖: FDE Live Coach 核心架構（Section 3.1）
- [x] 架構圖: MVP 即時鏈路資料流（Section 3.2）
- [x] 架構圖: Phase 1-5 開發順序（Section 3.3）
