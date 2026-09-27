# FDE-AI-UAS v2.0 — 開發交接文件（修正版）

> Phase 0 架構審查產出物 | 修正日期: 2026-09-27
> **本版修正**: v2.0 核心從 Three.js/R08/CI/CD 修正為 FDE Live Coach（即時 AI 實訓助教）。
> 本輪僅修正架構文件，不寫功能程式、不建立 Live Camera、不建立 WebSocket、不修改 YOLO/RAG/Cloudflare、不 Push GitHub。

---

# 【FDE-AI-UAS v2.0 Architecture Correction Report】

以下為 16 項架構修正報告，涵蓋 v1.5C 現況確認、v2.0 核心修正、開發順序、Git 策略及三份文件修正結果。

---

## 1. 已確認的 v1.5C 架構

### 1.1 專案概要

| 項目 | 值 |
|------|-----|
| 專案名稱 | FDE-AI-UAS — 無人載具學習控制中心 |
| GitHub 遠端 | `zhangpengya77-tech/fde-ai` |
| 主倉庫路徑 | `C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI` |
| v1.5C worktree | `D:\FDE-AI-UAS\v1.5C` |
| 獨立 clone | `D:\FDE-AI`（main 分支，有獨立 .git） |
| Gateway | `D:\FDE-AI-Gateway`（獨立 Git） |

### 1.2 v1.5C 技術棧

| 層 | 技術 |
|----|------|
| 前端 | 純 vanilla JavaScript（無框架），GitHub Pages 部署 |
| 後端 | Django 5.2.17, SQLite, FFmpeg 影片轉碼 |
| AI | YOLOv8 (ultralytics), 自訂 RAG (hashed-char-ngram-2048), Voice RAG |
| 基礎設施 | Cloudflare Worker + Quick Tunnel + Windows Task Scheduler |

### 1.3 Git Worktree 現況

| Worktree 路徑 | 分支 | Commit |
|---------------|------|--------|
| `C:\...\FDE-AI` (主工作樹) | `fde-ai-v2.0a` | c7a0b25 |
| `C:\...\FDE-AI-v1.2` | `fde-ai-v1.2` | dcce4e9 |
| `C:\...\FDE-AI-v1.5` | `fde-ai-v1.5b` | 310048f |
| `D:\FDE-AI-UAS\v1.5C` | `fde-ai-v1.5c` | 12cabfb |

已有分支: `main`, `gh-pages`, `fde-ai-v1.1`, `fde-ai-v1.2`, `fde-ai-v1.5b`, `fde-ai-v1.5b-mobile-hotfix`, `fde-ai-v1.5c`, `fde-ai-v1.5`, `fde-ai-v2.0a`

### 1.4 關鍵埠與端點

| 服務 | 埠 | 端點 | 速率限制 |
|------|-----|------|---------|
| Django | 8022 | `/api/public/inspection/detect/` (代理 YOLO) | **5/min** |
| Django | 8022 | `/api/public/rag/ask/` (代理 RAG) | 30/min |
| Django | 8022 | `/api/public/voice/ask/` (代理 Voice) | 20/min |
| RAG | 8770 | `POST /api/rag/ask`, `GET /api/rag/health` | 無 |
| YOLO | 8765 | `POST /api/detect`, `POST /api/hover`, `POST /api/voice/ask` | 無 |
| Gateway | Cloudflare | 所有動態路徑代理 | 無 |

### 1.5 YOLO 模型現況

| 項目 | 值 |
|------|-----|
| 模型路徑 | `E:\FDE_AI_F450_Dataset...\weights\best.pt` |
| 現有類別 | `cw_propeller`, `ccw_propeller`, `flight_controller`, `motor`, `esc`, `gps_compass`, `receiver`, `battery`, `frame_arm`, `power_module` |
| 預設置信度 | 0.25 |
| API 回傳格式 | className, confidence, box [x1,y1,x2,y2], center, annotatedImage |
| F450 規則 | M1→CCW, M2→CCW, M3→CW, M4→CW（blade_side: FRONT） |
| 規則檔案 | `D:\FDE-AI\config\f450_rules.json` |

### 1.6 v1.5C 已穩定功能（15 項，不可破壞）

1. GitHub Pages 公開靜態網站
2. 學員註冊與 Email 驗證
3. 學員登入
4. 教師後台與教師審核
5. R01～R08 學習成長日誌
6. 圖片 Evidence
7. iPhone 圖片上傳
8. MOV / MP4 影片上傳
9. 最長 30 秒影片處理與 FFmpeg 轉碼
10. YOLO 目標檢測入口（一次性拍照檢查 = Photo Check）
11. RAG 動態介面
12. 靜態／動態網站分層
13. Gateway、Worker 與離線回退
14. Quick Tunnel 自動恢復
15. Windows Task Scheduler 啟動鏈

---

## 2. v2.0 核心產品定義：FDE Live Coach

### 2.1 定義

**v2.0 核心產品 = FDE Live Coach（即時 AI 實訓助教）**

學生在組裝 F450 四旋翼時，使用手機或筆電瀏覽器開啟後攝影機，AI 持續辨識畫面中的零件、追蹤 SOP 步驟、提供 RAG 知識指導、並支援即時語音問答。

**不是** Three.js Digital Twin。**不是** R08 Survey。**不是** CI/CD。

### 2.2 核心能力

| 能力 | 說明 | 開發階段 |
|------|------|---------|
| 即時攝影機 | 手機瀏覽器 `getUserMedia()` 取得後攝影機，定時抽 Frame（1-2 fps） | P1 |
| 持續 YOLO 推論 | 每幀送至 YOLO :8765，回傳 class + confidence + bbox | P1 |
| SOP 步驟追蹤 | 根據 YOLO 結果判斷目前步驟，顯示下一步指引 | P2 |
| RAG 知識查詢 | AI 自動組裝上下文（YOLO + SOP）查詢 RAG 知識庫 | P3 |
| 即時語音 AI | 學生語音提問 → AI 回答，雙向互動 | P4 |
| Session / 學習紀錄 | 記錄整個 session 的步驟軌跡、錯誤、修正歷程 | P5 |

---

## 3. v1.5C Photo Check vs v2.0 Live Coach 差異

### 3.1 本質差異

| 維度 | v1.5C Photo Check | v2.0 Live Coach |
|------|-------------------|-----------------|
| **核心概念** | 做完後 AI 幫忙檢查 | AI 陪著學生一起做 |
| 攝影機 | 單次拍照 | 持續開啟（getUserMedia） |
| YOLO | 一次性檢測 | 持續推論（1-2 fps） |
| 步驟追蹤 | 無（學生手動選擇檢查項目） | SOP 狀態機自動追蹤 |
| RAG | 學生手動輸入問題 | AI 自動組裝上下文查詢 |
| 語音 | 無 | 雙向即時語音互動 |
| 時序 | 做完後才檢查 | 過程中即時陪伴 |
| 速率需求 | 5/min 足夠 | 需 60-120/min（每秒 1-2 幀） |
| Django 代理 | 是（public_ai.py） | MVP 否（直接到 YOLO），Phase 2+ 可新增專用 endpoint |

### 3.2 流程比較

```
v1.5C Photo Check:
  學生操作 → 拍照 → 上傳 → YOLO 一次性檢測 → AI/RAG → PASS/NG → 教師復核

v2.0 Live Coach:
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

---

## 4. 5 階段開發順序（P1-P5）

| Phase | 名稱 | 內容 | 前置依賴 |
|-------|------|------|---------|
| P1 | Live Camera + YOLO（MVP） | 手機 getUserMedia → frame 抽取 → Cloudflare → YOLO :8765 → 結果回手機 overlay | 無 |
| P2 | SOP Engine | F450 組裝 SOP 狀態機；根據 YOLO 結果判斷步驟；顯示下一步指引 | P1 |
| P3 | RAG 整合 | AI 自動組裝查詢上下文 → RAG :8770 → 回傳知識指引 | P2 |
| P4 | Voice AI | 學生語音提問 → STT → RAG/Voice RAG → TTS → 語音回答 | P3 |
| P5 | Session / Learning Record | 記錄 session 步驟軌跡、錯誤、修正歷程；教師可回顧 | P4 |

**原則**: 每個 Phase 完成後才進入下一個。P1 MVP 必須先驗證手機→YOLO→手機即時鏈路可行。

---

## 5. MVP 定義

### 5.1 MVP 範圍

MVP 只驗證一件事：**手機瀏覽器後攝影機 → frame 抽取 → Cloudflare → 本地 YOLO :8765 → 辨識結果回手機 overlay**。

### 5.2 MVP 資料流

```
1. 手機瀏覽器 getUserMedia({ video: { facingMode: 'environment' } })
   → 取得後攝影機 video stream

2. setInterval(500-1000ms)
   → canvas.drawImage(video) → canvas.toDataURL('image/jpeg', 0.7)
   → base64 JPEG frame

3. POST frame → Cloudflare Worker Gateway → Quick Tunnel → 教師筆電

4. YOLO :8765 POST /api/detect
   → base64 imageData → YOLOv8 推論
   → 回傳: className, confidence, box [x1,y1,x2,y2], annotatedImage

5. 前端在 video overlay 上繪製:
   - bounding box (canvas)
   - className + confidence 標籤
   - 顏色: PASS=綠 / NG=紅 / UNKNOWN=灰

6. MVP 範圍到此為止
   SOP / RAG / Voice 在 Phase 2-4 逐步加入
```

### 5.3 MVP 不包含

- ❌ SOP 步驟追蹤（Phase 2）
- ❌ RAG 知識查詢（Phase 3）
- ❌ 語音 AI（Phase 4）
- ❌ Session 記錄（Phase 5）
- ❌ WebSocket（P1 用 HTTP POST，P4+ 才評估）

### 5.4 明確排除

- ❌ 照片/影片上傳 → YOLO → 教師復核（這是 v1.5C Photo Check，不是 v2.0 MVP）

---

## 6. MVP 測試類別

### 6.1 指定類別

MVP 第一階段只測螺旋槳類別：

| 類別 | 說明 |
|------|------|
| `CW_F` | 順時針槳葉 — 正面 (Clockwise, Front) |
| `CCW_F` | 逆時針槳葉 — 正面 (Counter-clockwise, Front) |
| `CW_B` | 順時針槳葉 — 反面 (Clockwise, Back) |
| `CCW_B` | 逆時針槳葉 — 反面 (Counter-clockwise, Back) |

### 6.2 F450 槳葉規則對應

| 馬達 | 位置 | 應裝槳葉 | v2.0 目標類別 |
|------|------|---------|-------------|
| M1 | 右前 | CCW | CCW_F |
| M2 | 左後 | CCW | CCW_F |
| M3 | 左前 | CW | CW_F |
| M4 | 右後 | CW | CW_F |

---

## 7. 現有 YOLO 模型缺口

### 7.1 問題

| 項目 | 現有模型 | v2.0 MVP 目標 |
|------|---------|-------------|
| 螺旋槳類別 | `cw_propeller`, `ccw_propeller` | `CW_F`, `CCW_F`, `CW_B`, `CCW_B` |
| 正面/反面區分 | **無** | 需區分 Front / Back |
| 其他零件 | 8 類（motor, esc, ...） | 保留 |

### 7.2 影響分析

- 現有模型只有 `cw_propeller` / `ccw_propeller`，無法區分槳葉正面/反面
- v2.0 MVP 需要辨識 `CW_F`（順時針正面）vs `CCW_F`（逆時針正面），因為安裝時正面朝上
- F450 規則 `f450_rules.json` 中 `blade_side: FRONT` 目前只是標記，無法由 YOLO 實際辨識

### 7.3 解決方案（待定，不在本輪執行）

| 方案 | 說明 | 優缺 |
|------|------|------|
| A. 重新訓練 | 用含 CW_F/CCW_F/CW_B/CCW_B 標籤的資料集重新訓練 YOLO | 最準確，但需收集/標註資料 |
| B. 使用新模型 | 使用其他已有 front/back 區分的預訓練模型 | 快速，但可能不適用 F450 |
| C. 後處理推斷 | 用 cw_propeller + 額外邏輯推斷 front/back | 不需重訓，但準確度低 |

**Phase 1 開始前需確認採用哪個方案。本輪不做決定。**

---

## 8. Django 速率限制分析

### 8.1 現況

`D:\FDE-AI-UAS\v1.5C\student_portal\learning\public_ai.py` 的速率限制：

| 服務 | 速率限制 | v1.5C 場景 | v2.0 Live Coach 需求 |
|------|---------|-----------|---------------------|
| Inspection (YOLO) | **5/min** | 足夠（單次拍照） | **嚴重不足**（需 60-120/min） |
| RAG | 30/min | 足夠 | 可能不足（Phase 3 每步驟可能查詢） |
| Voice | 20/min | 足夠 | 可能不足（Phase 4 語音互動） |

### 8.2 分析

- Inspection 5/min = 每 12 秒只能 1 次檢測
- Live Coach 需要 1-2 fps = 60-120 次/min
- Django 的同步 POST base64 處理 + 代理也會增加延遲

### 8.3 解決方案

| 方案 | 說明 | MVP 適用 | Phase 2+ 適用 |
|------|------|---------|--------------|
| A. 直接呼叫 YOLO | 前端 → Gateway → YOLO :8765（繞過 Django） | ✅ 推薦 | 可繼續用 |
| B. Django 新增 endpoint | Django 新增 `/api/live-coach/detect/`，速率 120/min | 可行但多一層 | ✅ 推薦（可記錄 session） |
| C. WebSocket | 雙向串流，最低延遲 | 太複雜 | P4+ 評估 |

**MVP 採用方案 A**（直接呼叫 YOLO :8765）。Phase 2 評估升級到 B。

---

## 9. 即時通訊方案

### 9.1 方案比較

| 方案 | 延遲 | 複雜度 | Gateway 支援 | MVP 適用 |
|------|------|--------|-------------|---------|
| HTTP POST (輪詢) | 300-800ms | 低 | ✅ 已支援 | ✅ 採用 |
| WebSocket | 50-200ms | 中高 | 需修改 Worker | ❌ P4+ |
| SSE (Server-Sent Events) | 50-200ms | 中 | 需修改 Worker | ❌ P3+ |

### 9.2 MVP 決策

**P1 MVP 採用 HTTP POST 輪詢**：
- 前端 `setInterval(500-1000ms)` 抽幀 → POST base64 → YOLO → 回傳
- 不需要 WebSocket，不需要修改 Gateway
- 延遲 300-800ms 可接受（教學場景非競技）

### 9.3 後續升級路徑

- Phase 2 (SOP): 仍用 HTTP POST，因為 SOP 邏輯在前端
- Phase 4 (Voice): 語音雙向互動可能需要 WebSocket，屆時評估
- 方案 C (WebSocket) 需要: 修改 Cloudflare Worker 支援 WebSocket 代理 + Django ASGI 或獨立 WS server

---

## 10. 服務邊界定義

### 10.1 v2.0 新增服務元件

| 元件 | 屬於 | 依賴 | 對外提供 | 階段 |
|------|------|------|---------|------|
| Live Camera Module | 前端靜態 | getUserMedia API | 攝影機畫面 + Frame 抽取 | P1 |
| Detection Overlay | 前端靜態 | Canvas API | bbox 繪製 + 標籤 | P1 |
| SOP Engine | 前端 JS | YOLO 結果 + f450_rules | 步驟狀態 + 下一步指引 | P2 |
| RAG Context Builder | 後端 | SOP + YOLO + RAG :8770 | 自動知識查詢 | P3 |
| Voice AI Module | 後端 | STT + TTS + RAG/Voice RAG | 雙向語音互動 | P4 |
| Session Recorder | 後端 | 全部元件 | 學習軌跡記錄 | P5 |
| Live Coach Endpoint (可選) | Django | YOLO :8765 | 即時檢測代理（120/min） | P2+ |

### 10.2 v1.5C 保留服務邊界

| 服務 | 位置 | v2.0 呼叫方式 | 修改風險 |
|------|------|-------------|---------|
| Django :8022 | 本地 | 透過 Gateway（v1.5C 路由保留） | 低 — 新增路由不影響舊有 |
| RAG :8770 | 本地 | HTTP API 直連或 Django 代理 | 無 — 不修改 |
| YOLO :8765 | 本地 | HTTP API 直連（P1 MVP 採用） | 無 — 不修改 |
| Gateway Worker | Cloudflare | 代理層 | 低 — 可新增路由規則 |
| Photo Check (v1.5C) | Django + YOLO | 保留原有路由 | 無 — 不修改 |

### 10.3 關鍵邊界規則

1. **YOLO 不修改** — `yolo_server.py` 和 `best.pt` 保持不動
2. **RAG 不修改** — `rag_http_server.py` 和索引保持不動
3. **Cloudflare 不修改核心** — 可新增路由規則，不改 Gateway 核心邏輯
4. **Django 可新增路由** — 不修改 v1.5C 既有路由，可新增 Live Coach 專用路由
5. **前端可新增模組** — 不修改 v1.5C 既有 JS，新增 Live Coach 專用 JS

---

## 11. 離線降級策略

### 11.1 v1.5C 既有離線邏輯（保留）

| 狀態 | 行為 |
|------|------|
| 筆電關機 | Gateway 回傳離線 HTML，公開首頁/影片/課程仍可瀏覽 |
| 筆電開機 | 動態教學服務自動恢復（啟動鏈） |
| 離線時寫入請求 | 回傳 502 `classroom_upstream_unavailable` |

### 11.2 v2.0 Live Coach 離線策略

| 狀態 | Live Coach 行為 | 靜態內容行為 |
|------|----------------|-------------|
| 筆電在線 + 服務正常 | Live Coach 完整可用 | 正常 |
| 筆電在線 + YOLO 離線 | 顯示「YOLO 服務離線，無法即時辨識」 | 正常 |
| 筆電離線（關機/斷網） | 顯示「即時助教離線，請聯繫教師」 | 正常瀏覽 |
| 學生手機斷網 | Live Coach 無法取得畫面推論 | 離線頁面 |

### 11.3 關鍵原則

Live Coach 是即時服務，完全依賴本地 YOLO + RAG + Voice AI。筆電關機 = Live Coach 不可用。但公開靜態內容（GitHub Pages）仍可瀏覽。前端必須有明確的離線狀態提示。

---

## 12. Secondary Roadmap（Three.js / R08 / CI/CD 降級）

### 12.1 修正原因

初版 v2.0 架構將以下三項設為核心，現修正為 Secondary Roadmap：

| 項目 | 原定位 | 修正定位 | 修正原因 |
|------|--------|---------|---------|
| Three.js Digital Twin | v2.0 核心元件 | Secondary — Future Feature | 3D 檢視是輔助工具，非核心價值；Live Coach 完成後可作為 v2.1 加入 |
| R08 結訓調查表 | v2.0 核心元件 | Secondary — 可與 P5 整合 | `survey_analytics.py` 已存在，可在 Session Recorder 完成後整合 |
| GitHub Actions CI/CD | v2.0 核心元件 | Secondary — 工程改善 | CI/CD 是工程工具，不應作為產品架構核心 |

### 12.2 不刪除原因

- Three.js: 可作為未來增強，且不影響 Live Coach 開發
- R08: 基礎設施已有（survey_analytics.py + urls.py 路由），低成本低風險
- CI/CD: `.github/workflows/` 目錄已存在，加入成本低

### 12.3 三項均不在 v2.0 主開發範圍

以上三項可以列入 Future / Secondary Features，但不得作為 v2.0 主架構。

---

## 13. Git Worktree 策略

### 13.1 現況分析

| 項目 | 現況 |
|------|------|
| 主倉庫 | `C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI` |
| 主工作樹當前分支 | `fde-ai-v2.0a`（前次 v2.0 嘗試） |
| v1.5C worktree | `D:\FDE-AI-UAS\v1.5C`（分支 `fde-ai-v1.5c`） |
| 獨立 clone | `D:\FDE-AI`（分支 `main`，有獨立 .git） |
| v2.0 目標目錄 | `D:\FDE-AI-UAS-v2.0`（已有 Phase 0 文件） |
| 已有 `fde-ai-v2.0a` 分支 | 是（前次 v2.0 嘗試，不使用） |

### 13.2 Worktree 建立方案（僅規劃，本輪不執行）

| 項目 | 值 |
|------|-----|
| 倉庫根目錄 | `C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI` |
| 基準分支 | `fde-ai-v1.5c`（穩定基準） |
| 新分支名稱 | `fde-ai-v2.0-dev`（不用 `fde-ai-v2.0a`） |
| 目標目錄 | `D:\FDE-AI-UAS-v2.0` |

### 13.3 衝突分析

| 衝突點 | 說明 | 解決方案 |
|--------|------|---------|
| 目標目錄已存在 | `D:\FDE-AI-UAS-v2.0` 內有三份 Phase 0 文件 | 先備份 → 建立 worktree → 恢復文件 |
| 已有 `fde-ai-v2.0a` 分支 | 前次 v2.0 嘗試，主工作樹已 checkout | 使用新分支名 `fde-ai-v2.0-dev`，不影響 v2.0a |
| `D:\FDE-AI` 是獨立 clone | 有自己的 .git，不是 worktree | 不在此 clone 操作；在主倉庫操作 |

### 13.4 建立步驟（規劃方案，本輪不執行）

```bash
# 步驟 1: 在主倉庫建立新分支（從 v1.5c 拉出）
cd "C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI"
git branch fde-ai-v2.0-dev fde-ai-v1.5c

# 步驟 2: 備份現有 Phase 0 文件
mv "D:\FDE-AI-UAS-v2.0" "D:\FDE-AI-UAS-v2.0-phase0-backup"

# 步驟 3: 建立 worktree
git worktree add "D:\FDE-AI-UAS-v2.0" fde-ai-v2.0-dev

# 步驟 4: 將 Phase 0 文件移回
cp "D:\FDE-AI-UAS-v2.0-phase0-backup"/*.md "D:\FDE-AI-UAS-v2.0"/

# 步驟 5: 確認
cd "D:\FDE-AI-UAS-v2.0"
git branch        # 應顯示 fde-ai-v2.0-dev
git log --oneline # 應與 v1.5c 相同 commit
```

### 13.5 注意事項

1. **不在 `D:\FDE-AI` 操作** — 它是獨立 clone，不是主倉庫 worktree
2. **不使用 `fde-ai-v2.0a`** — 前次嘗試的分支，保留不動
3. **不刪除 Phase 0 文件** — 先備份再建立 worktree
4. **本輪不執行任何 Git 操作** — 以上僅為規劃方案

---

## 14. 修正後 PROJECT_CONTEXT.md

### 14.1 修正狀態

| 項目 | 狀態 |
|------|------|
| 檔案路徑 | `D:\FDE-AI-UAS-v2.0\PROJECT_CONTEXT.md` |
| 修正完成 | ✅ 已完成 |
| 核心修正 | v2.0 核心從 Three.js/R08/CI/CD 修正為 FDE Live Coach |

### 14.2 主要修正內容

1. **Section 1 專案概述** — 新增 v1.5C 核心模式（Photo Check）vs v2.0 核心模式（Live Coach）對比
2. **Section 2.1 三大專案目錄** — 修正主倉庫路徑、獨立 clone 說明、worktree 清單
3. **Section 4 關鍵埠與端點** — 新增「v2.0 關鍵限制：Django 5/min 不夠即時」
4. **Section 5 YOLO 模型資訊** — 新增「v2.0 MVP 模型：CW_F/CCW_F/CW_B/CCW_B，目前模型缺口」
5. **Section 6 v1.5C 與 v2.0 的真正差異** — 全新章節，Photo Check vs Live Coach 流程對比
6. **Section 10 離線降級邏輯** — 新增「v2.0 離線策略：Live Coach 需要本地服務」

---

## 15. 修正後 V2_ARCHITECTURE.md

### 15.1 修正狀態

| 項目 | 狀態 |
|------|------|
| 檔案路徑 | `D:\FDE-AI-UAS-v2.0\V2_ARCHITECTURE.md` |
| 修正完成 | ✅ 已完成 |
| 核心修正 | 整份文件重寫，FDE Live Coach 為唯一核心架構 |

### 15.2 主要修正內容

1. **Section 1 架構原則** — 新增「Live Coach 為核心」原則
2. **Section 2 v2.0 核心產品** — 從 Three.js/R08/CI/CD 完全替換為 FDE Live Coach 六大能力
3. **Section 3 完整架構圖** — 三張新圖：核心架構、MVP 資料流、Phase 1-5 開發順序
4. **Section 4 服務邊界** — 新增 v2.0 元件表、YOLO 呼叫路徑方案 A/B/C
5. **Section 5 資料流設計** — 五個 Phase 的完整資料流（P1 MVP、P2 SOP、P3 RAG、P4 Voice、P5 Session）
6. **Section 6 離線降級** — 新增 v2.0 Live Coach 專屬離線策略
7. **Section 7 Secondary Roadmap** — Three.js/R08/CI/CD 降級處理，不刪除但不作為核心
8. **Section 8 安全性** — 新增攝影機隱私、即時端點濫用、語音資料、Session 資料風險
9. **Section 9 技術債** — 新增 YOLO 模型缺口、即時延遲、手機相容性、頻寬風險
10. **Section 10 分支策略** — 修正為 `fde-ai-v2.0-dev` 新分支，含 worktree 建立方案
11. **Section 11 開發規則** — 新增「不修改 YOLO/RAG/Cloudflare」規則

---

## 16. 修正後 DEV_HANDOFF.md

### 16.1 修正狀態

| 項目 | 狀態 |
|------|------|
| 檔案路徑 | `D:\FDE-AI-UAS-v2.0\DEV_HANDOFF.md` |
| 修正完成 | ✅ 本文件即為修正版 |
| 核心修正 | 從 26 項舊報告修正為 16 項架構修正報告 + 正確 Git worktree 策略 |

### 16.2 主要修正內容

1. **架構報告** — 從舊版 26 項（Three.js/R08/CI/CD 為核心）修正為 16 項架構修正報告
2. **Git worktree 策略** — 修正倉庫路徑（不是 `D:\FDE-AI`）、基準分支（`fde-ai-v1.5c`）、新分支（`fde-ai-v2.0-dev`）、衝突分析
3. **開發順序** — 從舊版 Phase 1-6（R08→數位孿生→CI/CD）修正為 Phase 1-5（Camera+YOLO→SOP→RAG→Voice→Session）
4. **MVP 定義** — 從舊版（照片上傳→YOLO→教師復核 = v1.5C 能力）修正為手機→YOLO→手機即時鏈路
5. **Secondary Roadmap** — 新增章節，Three.js/R08/CI/CD 降級處理

---

# 附錄 A: Phase 1-5 開發計畫

## Phase 1: Live Camera + YOLO（MVP）

### 前置條件
- [ ] 確認 YOLO 模型方案（重新訓練 CW_F/CCW_F/CW_B/CCW_B 或使用新模型或後處理推斷）
- [ ] 確認 Git worktree 已建立（`fde-ai-v2.0-dev`）
- [ ] 確認 Gateway 可代理 `/api/detect` 到 YOLO :8765

### 開發項目
1. 前端新增 `src/live-coach-camera.js` — getUserMedia + frame 抽取
2. 前端新增 `src/live-coach-overlay.js` — Canvas bbox 繪製
3. 前端新增 Live Coach 頁面/路由
4. 驗證手機瀏覽器（iOS Safari + Android Chrome）相容性
5. 驗證延遲（frame → YOLO → overlay round-trip）
6. 驗證 CW_F/CCW_F/CW_B/CCW_B 辨識結果

### MVP 驗收標準
- [ ] 手機瀏覽器可開啟後攝影機
- [ ] 每 500-1000ms 抽幀送至 YOLO
- [ ] YOLO 回傳辨識結果
- [ ] 前端 overlay 正確繪製 bbox + 標籤
- [ ] 延遲 < 1000ms 可接受
- [ ] CW_F/CCW_F/CW_B/CCW_B 可辨識

## Phase 2: SOP Engine

### 前置條件
- [ ] Phase 1 MVP 通過驗收

### 開發項目
1. 定義 F450 組裝 SOP 狀態機（JSON）
2. 前端新增 `src/live-coach-sop.js` — SOP 步驟追蹤邏輯
3. 整合 YOLO 結果與 f450_rules.json
4. UI 顯示「目前步驟」+「下一步指引」+「進度條」
5. 步驟 PASS/NG 判定邏輯
6. 評估是否需要 Django Live Coach endpoint（方案 B）

## Phase 3: RAG 整合

### 前置條件
- [ ] Phase 2 SOP Engine 通過驗收

### 開發項目
1. 後端新增 RAG Context Builder（組裝 currentStep + yoloResult + expectedResult）
2. 整合 RAG :8770 `/api/rag/ask`
3. SOP 步驟錯誤時自動觸發 RAG 查詢
4. 前端顯示知識指引 + 來源
5. 學生可手動追加問題

## Phase 4: Voice AI

### 前置條件
- [ ] Phase 3 RAG 整合通過驗收

### 開發項目
1. 前端新增語音輸入（MediaRecorder / Web Speech API）
2. 後端 STT 整合
3. 整合 Voice RAG（YOLO :8765 `/api/voice/ask`）和 RAG :8770
4. 後端 TTS 整合
5. 前端播放語音回答
6. 雙向互動（可追問）
7. 評估是否升級 WebSocket（方案 C）

## Phase 5: Session / Learning Record

### 前置條件
- [ ] Phase 4 Voice AI 通過驗收

### 開發項目
1. 後端新增 Session Recorder（記錄每幀 YOLO、每次 SOP 步驟變更、錯誤、修正、RAG 查詢、語音互動）
2. 新增 Django model（或 SQLite collection）
3. session_id 關聯學生 enrollment
4. 教師後台查看 session 回放
5. 步驟軌跡時間線
6. 錯誤熱點分析
7. 學習成果匯出
8. 可整合 R08 結訓調查表（Secondary Roadmap）

---

# 附錄 B: Codex 2026-10-01 交接指示

以下為預計在 2026-10-01 交付給下一階段開發者（人或 AI 代理）的交接指示：

### 1. 文件位置
```
D:\FDE-AI-UAS-v2.0\
├── PROJECT_CONTEXT.md   ← v1.5C 現況 + v2.0 定義（已修正）
├── V2_ARCHITECTURE.md   ← v2.0 目標架構（已修正）
└── DEV_HANDOFF.md       ← 本文件（16 項架構修正報告 + 開發計畫）
```

### 2. 第一步：建立 Git worktree
按照本文件 Section 13 的方案執行：
```bash
cd "C:\Users\admin\Documents\Codex\2026-08-30\new-chat\FDE-AI"
git branch fde-ai-v2.0-dev fde-ai-v1.5c
# 備份 Phase 0 文件
mv "D:\FDE-AI-UAS-v2.0" "D:\FDE-AI-UAS-v2.0-phase0-backup"
git worktree add "D:\FDE-AI-UAS-v2.0" fde-ai-v2.0-dev
# 恢復文件
cp "D:\FDE-AI-UAS-v2.0-phase0-backup"/*.md "D:\FDE-AI-UAS-v2.0"/
```

### 3. 第二步：確認 YOLO 模型方案
在開始 Phase 1 之前，必須確認螺旋槳辨識方案：
- 現有模型只有 `cw_propeller` / `ccw_propeller`（無 front/back）
- v2.0 MVP 需要 `CW_F` / `CCW_F` / `CW_B` / `CCW_B`
- 選項：重新訓練 / 使用新模型 / 後處理推斷

### 4. 第三步：開始 Phase 1 MVP
按照附錄 A Phase 1 的開發項目和驗收標準執行。

### 5. 禁止事項（延續至開發階段）
- ❌ 不修改 v1.5C 原始碼（在 `fde-ai-v1.5c` 分支上）
- ❌ 不修改 YOLO 伺服器核心邏輯（除非重新訓練模型）
- ❌ 不修改 RAG 伺服器核心邏輯
- ❌ 不修改 Cloudflare Worker 核心邏輯（可新增路由規則）
- ❌ 不提交 `.env`、資料庫、學員資料、`media/`、`uploads/`、Token、`logs/`
- ✅ AI 即時建議始終標記「待教師複核」

---

# 附錄 C: Phase 0 產出物清單

| 產出物 | 路徑 | 狀態 |
|--------|------|------|
| 專案背景文件 | `D:\FDE-AI-UAS-v2.0\PROJECT_CONTEXT.md` | ✅ 已修正 |
| 目標架構設計 | `D:\FDE-AI-UAS-v2.0\V2_ARCHITECTURE.md` | ✅ 已修正 |
| 開發交接文件 | `D:\FDE-AI-UAS-v2.0\DEV_HANDOFF.md` | ✅ 已修正（本文件） |
| 架構圖: Live Coach 核心架構 | V2_ARCHITECTURE.md Section 3.1 | ✅ |
| 架構圖: MVP 即時鏈路資料流 | V2_ARCHITECTURE.md Section 3.2 | ✅ |
| 架構圖: Phase 1-5 開發順序 | V2_ARCHITECTURE.md Section 3.3 | ✅ |
| 16 項架構修正報告 | DEV_HANDOFF.md Section 1-16 | ✅ |
| Git worktree 策略 | DEV_HANDOFF.md Section 13 | ✅（僅規劃，未執行） |

---

> **本輪完成聲明**:
> Phase 0 架構修正已完成。三份文件均已修正為 FDE Live Coach 為核心。
> 16 項架構修正報告已輸出。
> Git worktree 策略已提供（僅規劃，未執行）。
>
> 目前仍然：
> - ❌ 不要寫功能程式
> - ❌ 不要建立 Live Camera
> - ❌ 不要建立 WebSocket
> - ❌ 不要修改 YOLO
> - ❌ 不要修改 RAG
> - ❌ 不要修改正式 Cloudflare
> - ❌ 不要 Push GitHub
>
> 本輪只修正：v2.0 Architecture（架構）。
> 完成後停止，等待人工確認。
