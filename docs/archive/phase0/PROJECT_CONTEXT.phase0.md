# FDE-AI-UAS v2.0 — 專案背景文件（修正版）

> Phase 0 架構審查產出物 | 修正日期: 2026-09-27
> v1.5C 為凍結穩定版本，本文件僅供 v2.0 開發參考，不涉及任何程式碼修改。
> **本版修正**: v2.0 核心目標從 Three.js/R08/CI/CD 修正為 FDE Live Coach（即時 AI 實訓助教）。

---

## 1. 專案概述

FDE-AI-UAS（無人載具學習控制中心）是一套 AI 雙師教學系統，用於培訓學員操作 F450 四旋翼無人載具。

### v1.5C 核心模式 — Photo Check（拍照檢查）
```
學生操作 → 拍照 → 上傳 → YOLO → AI/RAG → PASS/NG
```
**做完後 AI 幫忙檢查。**

### v2.0 核心模式 — FDE Live Coach（即時 AI 實訓助教）
```
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
**AI 陪著學生一起做。**

---

## 2. 專案目錄結構

### 2.1 三大專案目錄

| 目錄 | 用途 | Git 狀態 |
|------|------|----------|
| `C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI` | 主 Git 倉庫（含所有 worktree） | `.git` 目錄在此；當前分支 `fde-ai-v2.0a` |
| `D:\FDE-AI` | 主倉庫的獨立 clone（只有 main 分支） | 獨立 `.git` 目錄；當前分支 `main` |
| `D:\FDE-AI-UAS\v1.5C` | v1.5C 穩定版本（Git worktree） | `.git` 檔案指向主倉庫 worktree |
| `D:\FDE-AI-Gateway` | Cloudflare Worker 閘道（獨立 Git 倉庫） | 獨立 `.git` |
| `D:\FDE-AI-UAS-v2.0` | v2.0 開發副本目標（Phase 0 文件在此） | 尚未建立 worktree |

### 2.2 Git Worktree 現況

主倉庫 `C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI` 已有的 worktree：

| Worktree 路徑 | 分支 | Commit |
|---------------|------|--------|
| `C:\...\FDE-AI` (主工作樹) | `fde-ai-v2.0a` | c7a0b25 |
| `C:\...\FDE-AI-v1.2` | `fde-ai-v1.2` | dcce4e9 |
| `C:\...\FDE-AI-v1.5` | `fde-ai-v1.5b` | 310048f |
| `D:\FDE-AI-UAS\v1.5C` | `fde-ai-v1.5c` | 12cabfb |

已知分支清單：
- `main`、`gh-pages`、`fde-ai-v1.1`、`fde-ai-v1.2`、`fde-ai-v1.5b`、`fde-ai-v1.5b-mobile-hotfix`、`fde-ai-v1.5c`、`fde-ai-v1.5`、`fde-ai-v2.0a`

### 2.3 v1.5C 內部結構

```
D:\FDE-AI-UAS\v1.5C\
├── .git                    # gitlink → worktree/v1.5C
├── index.html              # 前端 SPA 入口（zh-Hant）
├── V1.5C_BASELINE.md       # v1.5C 基準文件
├── CODEX_START_V1.5C.md    # v1.5C 開發規則
├── src/                    # 前端原始碼
│   ├── app.js              # 主應用邏輯
│   ├── router.js           # 客戶端路由
│   ├── rag-client.js       # RAG API 客戶端（auto 模式, 支援本地/公開切換）
│   ├── rag-config.js       # RAG 設定（RAG_API_BASE_URL: http://127.0.0.1:8770）
│   ├── platform-browser.js
│   ├── course-definitions.js
│   ├── fde-column.js
│   ├── styles.css
│   └── data/fdeVideos.js
├── student_portal/         # Django 後端
│   ├── manage.py
│   ├── db.sqlite3
│   ├── config/
│   │   ├── settings.py     # Django 5.2.17（DEBUG 模式, SQLite, FFmpeg）
│   │   └── urls.py
│   └── learning/
│       ├── models.py        # Cohort, LearningGroup, Enrollment, StudentProfile...
│       ├── views.py         # 首頁/註冊/登入/學員/教師
│       ├── public_ai.py     # 公開 AI API 代理（RAG/檢測/語音, 有速率限制）
│       ├── growth_video.py  # 影片處理（FFmpeg, 30s, CRF 28）
│       ├── survey_analytics.py
│       └── urls.py          # 55 條 URL 路由
├── docs/
└── ops/                    # 啟動/停止腳本
    ├── classroom-start.ps1
    └── start-classroom.cmd
```

### 2.4 主倉庫 `D:\FDE-AI` 結構

```
D:\FDE-AI\
├── api/                    # AI 服務
│   ├── yolo_server.py      # YOLO + Hover + Voice 伺服器（:8765）
│   ├── hover_model.py      # 四面懸停分析
│   └── f450_validator.py   # F450 規則驗證（cw/ccw, M1-M4, blade_side）
├── config/
│   └── f450_rules.json     # F450 槳葉/馬達規則
├── rag/                    # RAG 索引與執行環境
│   ├── active_version.json # {"active_version": "f450_v1"}
│   └── f450_v1/
│       ├── manifest.json    # 1105 docs, 2048-dim, top_k=5, min_score=0.58
│       ├── index/           # documents.jsonl, vectors.npz
│       └── runtime/         # rag_http_server.py (:8770), rag_service.py
├── startup/
│   └── start_fde_ai_v15b.ps1  # 開機自動啟動腳本
├── tests/
├── work/                   # YOLO 訓練腳本
└── .github/workflows/      # 空目錄
```

### 2.5 Gateway 結構

```
D:\FDE-AI-Gateway\
├── src/index.js            # Cloudflare Worker（代理 + 離線降級 + 平台資產重寫）
├── public/                 # 靜態資產
├── wrangler.jsonc          # Worker 設定
└── test/                   # 測試
```

## 3. 技術棧

| 層 | 技術 |
|----|------|
| 前端 | 純 vanilla JavaScript（無框架）, GitHub Pages 部署 |
| 後端 | Django 5.2.17, SQLite, FFmpeg 影片轉碼 |
| AI | YOLOv8 (ultralytics), 自訂 RAG (hashed-char-ngram-2048), Voice RAG |
| 基礎設施 | Cloudflare Worker + Quick Tunnel + Task Scheduler |

## 4. 關鍵埠與端點

| 服務 | 埠 | 端點 | 速率限制 |
|------|-----|------|---------|
| Django | 8022 | `/api/public/inspection/detect/` (代理 YOLO) | 5/min |
| Django | 8022 | `/api/public/rag/ask/` (代理 RAG) | 30/min |
| Django | 8022 | `/api/public/voice/ask/` (代理 Voice) | 20/min |
| RAG | 8770 | `POST /api/rag/ask`, `GET /api/rag/health` | 無 |
| YOLO | 8765 | `POST /api/detect`, `POST /api/hover`, `POST /api/voice/ask` | 無 |
| Gateway | Cloud | `GET /gateway-status`, 所有動態路徑代理 | 無 |

**v2.0 關鍵限制**: Django `public_ai.py` 速率限制 5/min 不夠即時使用。v2.0 Live Coach 需要直接到 YOLO 或新增專用即時端點。

## 5. YOLO 模型資訊

| 項目 | 值 |
|------|-----|
| 模型路徑 | `E:\FDE_AI_F450_Dataset...\weights\best.pt` |
| 現有類別 | cw_propeller, ccw_propeller, flight_controller, motor, esc, gps_compass, receiver, battery, frame_arm, power_module |
| 預設置信度 | 0.25 |
| 圖片大小限制 | 18MB |
| API | `POST /api/detect` (base64 imageData → JSON detections) |
| 回傳格式 | className, label, confidence, box [x1,y1,x2,y2], center, annotatedImage |
| 槳葉規則 | M1→CCW, M2→CCW, M3→CW, M4→CW（blade_side: FRONT） |
| 規則檔案 | `D:\FDE-AI\config\f450_rules.json` |

**v2.0 MVP 模型**: 用戶指定第一階段只測螺旋槳類別 `CW_F / CCW_F / CW_B / CCW_B`。目前模型只有 `cw_propeller / ccw_propeller`（無正面/反面區分），可能需要重新訓練或使用新模型。

## 6. v1.5C 與 v2.0 的真正差異

### v1.5C — Photo Check
```
學生操作 → 拍照 → 上傳 → YOLO 一次性檢測 → AI/RAG → PASS/NG → 教師復核
```
- 單次 HTTP POST base64 圖片
- Django 代理，有速率限制
- 非即時，做完後才檢查

### v2.0 — FDE Live Coach
```
手機攝影機持續開啟 → 定時抽 Frame → YOLO 即時辨識 → SOP 追蹤步驟
→ RAG 知識查詢 → 即時語音回答 → 學生修改 → 再次辨識 → PASS → 下一步
```
- 攝影機持續開啟（getUserMedia）
- 即時畫面幀上傳（1-2 fps）
- YOLO 持續推論
- SOP 狀態機追蹤目前步驟
- 語音雙向互動
- AI 陪著學生一起做

## 7. 外部資源路徑

| 資源 | 路徑 |
|------|------|
| YOLO 模型 | `E:\FDE_AI_F450_Dataset...\weights\best.pt` |
| Hover 模型 | `E:\四面懸停\hover_model_v1\hover_model.json` |
| Voice RAG 知識庫 | `E:\FDE_AI_Voice_RAG\knowledge_base` |
| RAG 索引 | `D:\FDE-AI\rag\f450_v1\` |
| Django 專案 | `D:\FDE-AI-UAS\v1.5C\student_portal\` |
| 啟動腳本引用 | `C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI-v1.5\student_portal` |

## 8. v1.5C 已穩定功能（不可破壞）

1. GitHub Pages 公開靜態網站
2. 學員註冊與 Email 驗證
3. 學員登入
4. 教師後台與教師審核
5. R01～R08 學習成長日誌
6. 圖片 Evidence
7. iPhone 圖片上傳
8. MOV / MP4 影片上傳
9. 最長 30 秒影片處理與 FFmpeg 轉碼
10. YOLO 目標檢測入口（一次性拍照檢查）
11. RAG 動態介面
12. 靜態／動態網站分層
13. Gateway、Worker 與離線回退
14. Quick Tunnel 自動恢復
15. Windows Task Scheduler 啟動鏈

## 9. 啟動鏈順序

```
Windows 開機
  → Task Scheduler → start_fde_ai_v15b.ps1
    → Wait-Network (180s)
    → Start-RagIfNeeded (8770, 45s)
    → Start-DjangoIfNeeded (8022, 45s)
    → Start-TunnelIfNeeded (Quick Tunnel, 90s)
    → Update-GatewayOrigin (Wrangler secret put ORIGIN_URL)
    → Test-FixedGateway (/login/ 可達)
    → 最多 4 次重試
```

## 10. 離線降級邏輯

- 關機時: Gateway 回傳離線 HTML，公開首頁/影片/課程仍可瀏覽
- 開機後: 動態教學服務自動恢復
- 寫入請求在離線時: 回傳 502

**v2.0 離線策略**: Live Coach 功能需要本地 YOLO + RAG + Voice AI，筆電關機時無法使用。離線時前端應顯示「即時助教離線」提示，公開靜態內容仍可瀏覽。
