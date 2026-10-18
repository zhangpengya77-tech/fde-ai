# FDE-AI-UAS 2.0｜工作流程圖（Workflow Diagram）

| 項目 | 內容 |
| --- | --- |
| 文件編號 | `FDE_AI_2_0_Workflow_Diagram.md` |
| 前置文件 | `FDE_AI_2_0_Current_State_Audit.md`、`FDE_AI_2_0_Integration_Architecture.md` |
| 專案目錄 | `D:\FDE-AI-UAS-v2.0` |
| 稽核日期 | 2026-10-12 |
| 性質 | 唯讀產出；所有節點對應追蹤編號 |

---

## 圖例（三類區分）

| 標記 | 意義 | 顏色 |
| --- | --- | --- |
| **已驗證功能** | 已在磁碟確認存在且可運作；**凍結保護** | 🟩 綠 |
| **待整合** | 接口／實體已存在，但尚未接線或尚未系統性串接 | 🟨 黃 |
| **待開發／待確認** | 已確認有獨立開發版本，但**位置待確認**，或範疇未定 | 🟥 紅（虛線框） |
| **實線箭頭** | 現況已存在的連線 | `-->` |
| **虛線箭頭** | 候選連線（**尚未實作，僅規劃**） | `-.->` |

> **F450 數位孿生特別標註**（教師指令 2026-10-12 修正）：
> 原報告誤判為「不存在」。實際為**已有獨立開發版本，但完整專案路徑尚未確認**。
> 本文件中一律標示為「**獨立模組／位置待確認／尚未整合**」，**不得畫成已完成整合，亦不得標為不存在**。

---

## 圖 1｜六層架構總覽（含現況／候選連線區分）

```mermaid
flowchart TB
    subgraph L6["L6 使用者介面層 — ARCH-01"]
        UI_MAIN["主站 index.html<br/>13 個 section"]
        UI_LIVE["Live Coach<br/>live/index.html"]
        UI_DL["下載中心<br/>downloads/index.html"]
        UI_FH["飛行健康<br/>flight-health/index.html"]
        UI_DJ["Django 模板 x38<br/>student_portal"]
        UI_MP["MP12 前端<br/>D:/FDE-AI-UAS-MP12"]
        UI_TWIN["F450 數位孿生<br/>獨立開發版本／位置待確認／尚未整合"]
    end

    subgraph L5["L5 學習流程層 — ARCH-02"]
        F_LEARN["學 FLOW-01<br/>learn / fde-column"]
        F_PRACTICE["練 FLOW-02<br/>practice"]
        F_BUILD["做 FLOW-03<br/>build + MP12"]
        F_TEST["測 FLOW-04<br/>inspection"]
        F_CERT["證 FLOW-05<br/>certify + cohorts"]
    end

    subgraph L4["L4 AI 能力層 — ARCH-03"]
        AI_LLM["General AI<br/>gpt-5.6-luna"]
        AI_RAG["RAG :8770"]
        AI_YOLO["YOLO :8765"]
        AI_SOP["SOP Engine"]
        AI_VOICE["Voice<br/>前端 SpeechSynthesis"]
        AI_STYLE["Teacher Style Layer"]
    end

    subgraph L3["L3 服務層 — ARCH-04"]
        S_LIVE["Starlette Live Backend<br/>:8111 DEMO / :8030 正式"]
        S_DJ["Django Portal<br/>:8110 DEMO / :8022 正式"]
        S_FH["Flight Health 後端 :8040"]
        S_MP["MP12 API<br/>file-level adoption"]
    end

    subgraph L2["L2 資料層 — ARCH-05"]
        D_DB["Django SQLite<br/>demo.sqlite3"]
        D_JSON["Live JSON Store<br/>vision_center.json"]
        D_REG["模型倉庫<br/>model_registry/"]
        D_MEDIA["媒體<br/>private_media/"]
        D_MANIFEST["下載 manifest<br/>download_manifest.json"]
    end

    subgraph L1["L1 證據層 — ARCH-06"]
        E_EVID["Evidence<br/>models.py:526"]
        E_SUB["GrowthRecordSubmission<br/>models.py:164"]
        E_REV["GrowthRecordReview<br/>models.py:605"]
        E_VMR["VisionModelRecord<br/>models.py:683"]
        E_CAND["CandidatePool<br/>models.py:656"]
    end

    UI_MAIN --> L5
    UI_LIVE --> S_LIVE
    UI_DL --> S_LIVE
    UI_FH --> S_FH
    UI_DJ --> S_DJ
    UI_MP --> S_MP

    F_LEARN --> F_PRACTICE
    F_PRACTICE --> F_BUILD
    F_BUILD --> F_TEST
    F_TEST --> F_CERT

    S_LIVE --> AI_LLM
    S_LIVE --> AI_RAG
    S_LIVE --> AI_YOLO
    S_LIVE --> AI_SOP
    S_LIVE --> AI_VOICE
    AI_LLM --> AI_STYLE
    AI_SOP --> AI_RAG

    S_LIVE --> D_JSON
    S_LIVE --> D_REG
    S_LIVE --> D_MANIFEST
    S_DJ --> D_DB
    S_DJ --> D_MEDIA
    D_JSON -.->|RISK-02 雙軌無同步| D_DB

    D_DB --> E_EVID
    E_EVID --> E_SUB
    E_SUB --> E_REV
    E_EVID --> E_VMR
    E_VMR --> E_CAND

    F_CERT --> E_SUB
    F_TEST -.->|INT-01 候選| E_SUB
    F_BUILD -.->|INT-01 候選| E_SUB
    F_PRACTICE -.->|INT-01 候選| E_SUB
    F_LEARN -.->|INT-01 候選| E_SUB

    UI_TWIN -.->|INT-08 候選| AI_YOLO
    UI_TWIN -.->|INT-09 候選| E_SUB

    classDef verified fill:#d4edda,stroke:#28a745,color:#14532d,stroke-width:2px
    classDef pending fill:#fff3cd,stroke:#ffc107,color:#664d03,stroke-width:2px
    classDef missing fill:#f8d7da,stroke:#dc3545,color:#721c24,stroke-width:2px,stroke-dasharray:5 5

    class UI_MAIN,UI_LIVE,UI_DL,UI_FH,UI_DJ,UI_MP verified
    class F_LEARN,F_PRACTICE,F_BUILD,F_TEST,F_CERT pending
    class AI_LLM,AI_RAG,AI_YOLO,AI_SOP,AI_VOICE,AI_STYLE verified
    class S_LIVE,S_DJ,S_FH,S_MP verified
    class D_DB,D_JSON,D_REG,D_MEDIA,D_MANIFEST verified
    class E_EVID,E_SUB,E_REV,E_VMR,E_CAND verified
    class UI_TWIN missing
```

> **注意**：`F_*` 五階段標為黃色，是因為**階段本身可運作，但階段成果未系統性回寫證據鏈**（`INT-01`），而非階段不存在。

---

## 圖 2｜學 → 練 → 做 → 測 → 證 主流程（含成長紀錄對應）

```mermaid
flowchart LR
    subgraph 學["學 — FLOW-01"]
        L1["課程影片<br/>renderLearningResources:456"]
        L2["FDE 專欄<br/>renderFdeColumn:492"]
        L3["下載中心 6 項軟體<br/>main.py:566"]
    end

    subgraph 練["練 — FLOW-02"]
        P1["模擬器與考照練習<br/>renderPracticeResources:541"]
        P2["SOP 引擎<br/>sop.py:107"]
    end

    subgraph 做["做 — FLOW-03"]
        B1["F450 組裝流程<br/>renderBuildWorkflow:559"]
        B2["MP12 調參 12 子任務<br/>mp12_catalog.py:38"]
        B3["F450 數位孿生<br/>獨立模組／位置待確認／尚未整合"]
    end

    subgraph 測["測 — FLOW-04"]
        T1["鷹眼 AI 檢測<br/>renderAssessmentWorkflows:576"]
        T2["手機槳葉辨識<br/>student_prop_scan:1121"]
        T3["教師 Vision Center<br/>teacher_vision_center:2710"]
    end

    subgraph 證["證 — FLOW-05"]
        C1["GitHub 成果存證<br/>renderCertificationChecklist:1109"]
        C2["歷屆學員成果<br/>renderCohorts:412"]
        C3["成長紀錄 R01-R08<br/>GrowthRecordSubmission:164"]
    end

    R01["R01 無人機基礎認知"]
    R02["R02 模擬飛行訓練"]
    R03["R03 真機飛行訓練"]
    R04["R04 證照技能驗證"]
    R05["R05 F450 工程組裝"]
    R06["R06 鷹眼 AI 目標檢測"]
    R07["R07 專業任務驗證"]
    R08["R08 綜合成果作品展示"]

    學 --> 練 --> 做 --> 測 --> 證

    L1 --> R01
    P1 --> R02
    P1 --> R04
    T1 --> R03
    T1 --> R06
    B1 --> R05
    B2 --> R05
    B3 -.-> R05
    T2 --> R07
    C1 --> R08
    C2 --> R08

    R01 -.-> C3
    R02 -.-> C3
    R03 -.-> C3
    R04 -.-> C3
    R05 -.-> C3
    R06 -.-> C3
    R07 --> C3
    R08 -.-> C3

    classDef verified fill:#d4edda,stroke:#28a745,color:#14532d,stroke-width:2px
    classDef pending fill:#fff3cd,stroke:#ffc107,color:#664d03,stroke-width:2px
    classDef missing fill:#f8d7da,stroke:#dc3545,color:#721c24,stroke-width:2px,stroke-dasharray:5 5

    class L1,L2,L3,P1,P2,B1,B2,T1,T2,T3,C1,C2,C3 verified
    class B3 missing
    class R01,R02,R03,R04,R05,R06,R08 pending
    class R07 verified
```

> **關鍵事實**：R07 是**唯一**以實線自動寫入 `GrowthRecordSubmission` 的 slot（`views.py:994`）；R01–R06、R08 目前為虛線（需手動 `evidence_add:1427` 或尚未系統性接線）。**R07 ≠ 全部成長日誌**。

---

## 圖 3｜R07 端到端資料流（現況，凍結保護）

```mermaid
sequenceDiagram
    autonumber
    participant STU as 學員瀏覽器
    participant DJ as Django Portal
    participant VS as vision_submission.py
    participant LB as Live Backend
    participant VC as VisionCenter
    participant JS as JSON Store
    participant TEA as 教師 Vision Center

    Note over STU,TEA: 🟩 現況已驗證連線（凍結保護）

    STU->>DJ: POST growth/R07/model/（上傳 best.pt）
    DJ->>DJ: views.py:1005 gate（project_direction=ai_flight_assessment）
    DJ->>DJ: views.py:1029 建立 Evidence(type=MODEL)
    DJ->>VS: views.py:1045 submit_model_evidence_to_vision
    VS->>VS: vision_submission.py:240 組 payload
    VS->>LB: POST /api/v1/vision/submissions
    LB->>VC: vision_api.py:217 create_submission
    VC->>VC: vision_center.py:496 存 submission.pt
    VC->>JS: vision_center.py:508 JsonStore.save
    VC-->>DJ: 回傳 vision_submission_id
    DJ->>DJ: views.py:1059 記錄 ID
    Note over DJ: 失敗時 views.py:1066-1068 回滾刪除已存檔

    TEA->>DJ: teacher_vision_model_list:1650
    TEA->>DJ: teacher_vision_model_verify:1821（圖片驗證）
    TEA->>DJ: teacher_vision_model_review:1945（複核）
    TEA->>DJ: teacher_vision_model_catalogue:1777（入庫）
    DJ->>DJ: 建立 VisionModelRecord（OneToOne PROTECT → Evidence）
    Note over DJ: ⚠️ RISK-01 刪除順序：先 VisionModelRecord 再 Evidence
    TEA->>DJ: teacher_vision_center_activate:3066（需 VALIDATED 安全閘）
    TEA->>DJ: teacher_vision_center_rollback:3101（回滾）
```

---

## 圖 3b｜R07 三層概念釐清（**教師指令 2026-10-12：不得誤認為同一個已完成接口**）

```mermaid
flowchart TB
    subgraph 方向層["專業方向層 — Enrollment.project_direction"]
        D1["ai_flight_assessment<br/>AI 目標檢測與模型訓練"]
        D2["uav_3d_mapping<br/>測繪／3D 建模與列印"]
        D3["autonomous_mission<br/>航線規劃與任務執行"]
        D4["flight_f450<br/>無人機組裝與考照"]
    end

    GATE{"gate<br/>views.py:1005<br/>project_direction ==<br/>ai_flight_assessment ?"}
    R07["R07 專業任務驗證<br/>GrowthRecordSubmission.slot_id<br/>growth_records_v1.json:57-59"]

    subgraph 模型類型層["模型類型層 — VisionCenter.MODEL_TYPES（vision_center.py:17）"]
        M_PROP["PROP_DIRECTION<br/>prefix PROP / 目錄 prop_direction"]
        M_HOVER["FOUR_SIDE_HOVER<br/>prefix HOVER / 目錄 four_side_hover"]
    end

    D1 --> GATE
    D2 -.->|"被 gate 擋下"| GATE
    D3 -.->|"被 gate 擋下"| GATE
    D4 -.->|"被 gate 擋下"| GATE
    GATE -->|"通過"| R07
    GATE -.->|"不通過 → 訊息擋下"| X["「此專業方向不開放模型成果上傳」"]

    R07 -->|"硬編碼 task_type=PROP_DIRECTION<br/>views.py:1038 / 1046"| M_PROP
    M_HOVER -.->|"❌ 不在 R07 學員上傳路徑<br/>（僅教師懸停分析鏈）"| OTHER["/api/v1/vision/hover-analyze<br/>/api/v1/vision/hover-video<br/>（vision_api.py:121-133）"]

    classDef verified fill:#d4edda,stroke:#28a745,color:#14532d,stroke-width:2px
    classDef pending fill:#fff3cd,stroke:#ffc107,color:#664d03,stroke-width:2px

    class D1,R07,M_PROP verified
    class D2,D3,D4,GATE,X,M_HOVER,OTHER pending
```

> **兩條獨立任務鏈（不得視為同一接口）**：
> - `PROP_DIRECTION` 鏈＝學員 R07 上傳 + 手機槳葉檢測 + Golden Set（本輪開放）
> - `FOUR_SIDE_HOVER` 鏈＝教師懸停分析 + 影片抽幀（`process_video:638`）+ 模型倉庫 `four_side_hover/`
> 兩者僅共用模型倉庫目錄結構與 Session 層，**R07 上傳接口僅覆蓋 `PROP_DIRECTION`**。

---

## 圖 3c｜MP12 已接入與未接入範圍（教師指令 2026-10-12）

```mermaid
flowchart TB
    subgraph 主專案["主專案 D:/FDE-AI-UAS-v2.0（file-level adoption）"]
        PKG["後端封裝已接入<br/>mp12_models.py:7-22<br/>mp12_catalog.py:38<br/>mp12_state.py"]
        H["後端 handler 3 支<br/>main.py:321/328/335"]
        RT["已接通路由 3 支<br/>main.py:578/579/580<br/>select / complete / teacher-review"]
        SESS["Session 層 3 支<br/>sessions.py:331-353"]
        UI["前端面板<br/>live/index.html:52（:50-113）"]
        JS["前端邏輯 3 支呼叫<br/>live/live.js:549-567<br/>renderMissionPlannerState:931-957"]
        TEST2["主專案測試 2 支<br/>mp12-frontend-integration.test.cjs<br/>test_mp12_backend_integration.py"]
    end

    subgraph WORKTREE["獨立 worktree D:/FDE-AI-UAS-MP12（分支 fde-ai-v2.0-mp12-dev）"]
        WT["完整 MP12 站點<br/>index.html / src/ / live/<br/>live_backend/app/ / student_portal/"]
        WTEST["worktree 獨有測試 3 支<br/>test_mp12_api.py<br/>test_mp12_catalog.py<br/>test_mp12_state.py"]
        WFE["worktree 獨有前端測試<br/>mp12-ui.test.cjs"]
        WSHOT["驗收截圖<br/>.test-temp/mp12-acceptance/"]
    end

    subgraph 頁面層["只是頁面或資料接口"]
        L1["掛在 TASK_07 深度子模組<br/>（非獨立任務）<br/>main.py:317 / sessions.py:331"]
        L2["目錄 12 筆為靜態資料<br/>mp12_catalog.py:38 → live.js"]
        L3["教師複核散佈前端邏輯<br/>僅 MP06/MP08/MP11/MP12<br/>live/index.html:87"]
        L4["教師複核走 Live Backend handler<br/>未打通 Django 教師端<br/>main.py:335"]
    end

    subgraph 未收["尚未端到端驗收"]
        U1["僅 2 支 AUTOMATED 測試"]
        U2["iPhone REAL DEVICE：PENDING"]
        U3["教師現場複核流程未實測"]
        U4["worktree 未 Merge<br/>（AGENTS.md:153-161 禁止未經要求）"]
    end

    PKG --> H --> RT --> UI --> JS
    RT --> SESS
    UI --> TEST2
    主專案 -.->|"未 Merge"| WORKTREE
    RT -.->|"未打通"| L4

    classDef verified fill:#d4edda,stroke:#28a745,color:#14532d,stroke-width:2px
    classDef pending fill:#fff3cd,stroke:#ffc107,color:#664d03,stroke-width:2px

    class PKG,H,RT,SESS,UI,JS,TEST2,WORKTREE,WT,WTEST,WFE,WSHOT verified
    class L1,L2,L3,L4,U1,U2,U3,U4 pending
```

> **本輪不合併、不重寫、不補開發 MP12。**

---

## 圖 4｜MP12 整合四候選方案（比較，未選定）

```mermaid
flowchart TB
    MAIN["主站 index.html<br/>src/app.js:82-88 primaryNav"]

```mermaid
flowchart TB
    MAIN["主站 index.html<br/>src/app.js:82-88 primaryNav"]
    MP12["MP12 獨立 worktree<br/>D:/FDE-AI-UAS-MP12<br/>分支 fde-ai-v2.0-mp12-dev"]
    LIVE_MP["主專案內 MP12 模組<br/>live_backend/app/mp12_*.py<br/>live/index.html:50-113"]

    A["方案 A：Deep Link<br/>R1"]
    B["方案 B：Embed iframe<br/>R2"]
    C["方案 C：API Integration<br/>R2"]
    D["方案 D：暫不整合<br/>R0（＝現況）"]

    MAIN -.->|候選| A
    MAIN -.->|候選| B
    MAIN -.->|候選| C
    MAIN -->|現況 file-level adoption| D

    A -.-> MP12
    B -.-> MP12
    C -.-> LIVE_MP
    D --> LIVE_MP

    SESS["Session 層<br/>sessions.py:331-353"]
    C -.-> SESS
    D --> SESS

    classDef verified fill:#d4edda,stroke:#28a745,color:#14532d,stroke-width:2px
    classDef pending fill:#fff3cd,stroke:#ffc107,color:#664d03,stroke-width:2px

    class MAIN,LIVE_MP,SESS,D verified
    class A,B,C,MP12 pending
```

---

## 圖 5｜證據層資料模型關係（L1）

```mermaid
erDiagram
    Enrollment ||--o{ GrowthRecordSubmission : "FK CASCADE :173"
    GrowthRecordDefinition ||--o{ GrowthRecordSubmission : "FK PROTECT :174"
    GrowthRecordSubmission ||--o{ Evidence : "FK CASCADE 可空 :541"
    GrowthRecordSubmission ||--o{ GrowthRecordReview : "FK CASCADE :611"
    StudentTaskProgress ||--o{ Evidence : "FK CASCADE 可空 :538"
    Evidence ||--|| VisionModelRecord : "OneToOne PROTECT :733"
    Evidence ||--o| CandidatePool : "OneToOne CASCADE :657"
    StudentProfile ||--o{ VisionModelRecord : "FK PROTECT :740"
    Cohort ||--o{ VisionModelRecord : "FK PROTECT :743"
    VisionModelRecord ||--o{ VisionModelRecord : "parent_record PROTECT :750"
    GoldenSet ||--o{ GoldenSetSample : "FK CASCADE :1112"
    GoldenSet ||--o{ User : "created_by PROTECT :983"

    Enrollment {
        int id PK
        string project_direction
        bool teacher_verified
    }
    GrowthRecordSubmission {
        int id PK
        string status
        int teacher_final_score
    }
    Evidence {
        uuid evidence_id PK
        string evidence_type
        string file
    }
    VisionModelRecord {
        uuid id PK
        string model_id
        string status
    }
    GoldenSet {
        string golden_set_id PK
        string version
        bool frozen
    }
```

---

## 節點 ↔ 追蹤編號對照表

| 節點 | 追蹤編號 | 狀態 |
| --- | --- | --- |
| 主站 index.html | `ARCH-01` / `AUD-02` | 🟩 |
| Live Coach live/index.html | `ARCH-01` / `AUD-07` | 🟩 |
| 下載中心 | `AUD-03` / `INT-11` | 🟩 凍結 |
| 飛行健康 | `AUD-04` / `INT-12` | 🟩 凍結 |
| Django 38 模板 | `ARCH-01` / `AUD-01` | 🟩 |
| MP12 前端 / 後端 | `AUD-06` / `INT-02` | 🟨 待決 |
| F450 數位孿生 | `AUD-05` / `INT-08` / `INT-09` / `RISK-06` / `RISK-12` | 🟨 獨立模組／位置待確認／尚未整合 |
| 學 learn | `FLOW-01` | 🟩 |
| 練 practice | `FLOW-02` | 🟩 |
| 做 build + MP12 | `FLOW-03` | 🟨 |
| 測 inspection | `FLOW-04` | 🟩 |
| 證 certify + R01–R08 | `FLOW-05` | 🟨 |
| General AI | `AUD-07` | 🟩 |
| RAG | `AUD-07` / `INT-05` | 🟩 凍結 |
| YOLO | `AUD-07` / `INT-03` | 🟨 PARTIAL |
| SOP Engine | `AUD-07` / `INT-04` | 🟩 |
| Voice | `AUD-07` | 🟩 |
| Starlette Live Backend | `ARCH-04` / `AUD-10` | 🟩 |
| Django Portal | `ARCH-04` / `AUD-01` | 🟩 |
| Django SQLite | `ARCH-05` / `AUD-10` | 🟩 |
| Live JSON Store | `ARCH-05` / `AUD-10` | 🟩 |
| 模型倉庫 | `ARCH-05` / `AUD-10` | 🟩 |
| Evidence | `ARCH-06` / `AUD-08` | 🟩 |
| GrowthRecordSubmission | `ARCH-06` / `AUD-09` | 🟩 |
| VisionModelRecord | `ARCH-06` / `AUD-08` | 🟩 凍結 |
| R01–R08 | `AUD-09` / `FLOW-05` | 🟩（R07 已接線） |

---

## 現況連線 vs 候選連線彙總

| 連線 | 類型 | 編號 |
| --- | --- | --- |
| 攝影機 → 視覺模型 | **現況**（實線） | `INT-03` |
| 視覺模型 → SOP | **現況**（實線） | `INT-04` |
| SOP → RAG | **現況**（實線） | `INT-05` |
| RAG → LLM | **現況**（實線） | `INT-06` |
| R07 → VisionModelRecord → ACTIVE | **現況**（實線） | `INT-10` |
| 下載中心 → manifest → 檔案串流 | **現況**（實線） | `INT-11` |
| 主站 → 飛行健康（連結） | **現況**（實線） | `INT-12` |
| 主站 → MP12（file-level adoption） | **現況**（實線） | `INT-02-D` |
| LLM → 證據提交 | **候選**（虛線） | `INT-07` |
| 學／練／做／測 → 成長證據鏈 | **候選**（虛線） | `INT-01` |
| 數位孿生 → 攝影機／視覺模型 | **候選**（虛線，實體位置待確認／尚未整合） | `INT-08` |
| 數位孿生 → SOP／證據提交 | **候選**（虛線，實體位置待確認／尚未整合） | `INT-09` |
| MP12 Deep Link / Embed / API | **候選**（虛線） | `INT-02-A/B/C` |
| Django SQLite ↔ Live JSON Store 雙向同步 | **候選**（虛線） | `RISK-02` |

---

*本文件為唯讀產出，所有圖為規劃用途。未修改產品程式、API、頁面、導航、路由、資料表。*
