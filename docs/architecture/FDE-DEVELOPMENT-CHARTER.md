# FDE-AI-UAS 總體架構認知與開發總綱 V1.0

> 本文件為長期架構總綱，不每次開發都全部載入上下文。
> 開發鐵律（MVP / 最小修改 / 垂直開發 / 最省 Token / 保護區 / Git 等）請見根目錄 `AGENTS.md`。
> 本文件只保存架構方向，不載入實作細節；核心方向以使用者原始定義為準，不擅自更改。

---

## 1. 平台定位（Platform Positioning）

FDE-AI-UAS 是 **AI 驅動的無人載具人才培養與職業能力驗證平台**。

五大原則（開發與架構的北極星）：

- **One Platform**：單一平台承載所有載具與課程。
- **Multiple Vehicles**：多載具（UAV / Rover / Fixed Wing）共用同一套邏輯。
- **One Mission Logic**：任務邏輯跨載具複用，不為每種載具重寫。
- **One Data Layer**：統一資料層，學習與驗證資料互通。
- **One Student Record**：單一學生紀錄，跨 LEVEL、跨載具、跨課程累積。

平台貫穿七階段：**Learn → Practice → Build → Simulate → Execute → Assess → Certify**。

---

## 2. Learn → Practice → Build → Simulate → Execute → Assess → Certify

這是一條連續的能力養成與驗證鏈：

1. **Learn（學）**：理論、SOP、安全紅線、RAG 知識檢索。
2. **Practice（練）**：桌面 / 仿真環境操作練習。
3. **Build（組）**：真機組裝（F450 等），零件辨識與準備。
4. **Simulate（擬）**：軟體在環 / 外部模擬器驗證，不上真機。
5. **Execute（行）**：真機任務執行，AI Live Coach 陪做與即時提示。
6. **Assess（評）**：教師審核、Vision / Flight 指標評估、能力判定。
7. **Certify（證）**：職業能力驗證與證照對應。

每一階段都寫入 **One Student Record**，最終匯出能力畫像。

---

## 3. LEVEL 0 ～ LEVEL 4

- **LEVEL 0 — 認知／理論**：概念、安全、SOP；以教學與測驗為主。
- **LEVEL 1 — 組裝與零件辨識**：F450 零件辨識、準備、靜態檢查。
- **LEVEL 2 — 真機實訓（Live Coach）**：即時 AI 陪做、攝影機預覽、語音對話、完成任務。
- **LEVEL 3 — 模擬任務（Simulate）**：仿真環境任務執行與決策驗證。
- **LEVEL 4 — 真機任務執行與驗證（Execute / Certify）**：真機飛行／任務，紅線需教師確認。

每個 LEVEL 對應明確能力指標與驗收標準，進階前須通過前一 LEVEL 的 Assess。

---

## 4. QGC / Mission Planner 分工

- **QGroundControl (QGC)**：真機參數、感測器校準、即時飛行畫面、Mission 上傳與監控。
- **Mission Planner**：桌面規劃、離線任務設計、飛行日誌分析。
- FDE 透過 **API / Reference** 整合兩者，不重寫地面站；資料回流到 One Data Layer 與 Flight Data Flywheel。

---

## 5. UAV / Rover / Fixed Wing 定位

- **UAV（多旋翼，如 F450）**：當前主戰載具，Live Coach 首發對象。
- **Rover（地面載具）**：後續載具類型，複用同一 Mission Logic。
- **Fixed Wing（固定翼）**：遠期載具，待 UAV 路線成熟後擴展。
- 三者共用 One Mission Logic 與 One Student Record，差異只在 Vehicle Adapter。

---

## 6. Simulation → Real Vehicle

- 任何真機操作前，先在仿真（Software-in-the-Loop、桌面模擬器）驗證。
- 黑羊模擬器、UCarsDD 等外部模擬器以 **Reference** 方式整合，不在平台內重寫。
- 仿真與真機共用同一套評估指標，降低真機風險與成本。

---

## 7. Industry Mission Card（產業任務卡）

- 以真實產業任務封裝教學單元，讓訓練貼近職場。
- 每張卡定義：任務場景、所需能力指標、安全紅線、驗收標準、對應 LEVEL。
- 產業任務卡是 Learn→Certify 鏈路上的標準單位。

---

## 8. Vision Data Flywheel（視覺資料飛輪）

- 閉環：**學生提交 best.pt → 教師審核 → Benchmark → Candidate → Production → 回流資料 → 下一版 Dataset**。
- YOLO 只負責「辨識」；**Rule Engine 負責決策**；**AI Coach 只解釋**，三者職責分離。
- 第一版聚焦 **PROP_DETECTION（槳葉方向）**；預留 **HOVER / MOTOR / GPS / ESC / FRAME / BATTERY** 類別。
- 學生提交的 `.pt` 只作為作業附件保存，**禁止自動 torch.load / YOLO load / 推理 / 入倉 / 變 Candidate / 變 ACTIVE**；僅教師審核後導入模型倉庫。
- 模型與規則版本分離；每類型同一時間僅一個 ACTIVE 模型。

---

## 9. Flight Data Flywheel（飛行資料飛輪）

- 飛行日誌 → 指標抽取 → 能力畫像 → 教學回饋 → 任務難度調節。
- 與 **Flight Health** 模組透過 API 整合，不重寫 Flight Health。
- 與 Vision Data Flywheel 共同構成平台資料層的核心回流機制。

---

## 10. Digital Learning Record（數位學習歷程）

- 單一學生紀錄（One Student Record）由以下組成：**Session、Evidence、Reflection、Teacher Review、Growth Record**。
- 跨載具、跨 LEVEL、跨課程累積，最終匯出 **Student Capability Profile**。
- 既有 Growth Record 機制優先 Reuse / Extend，不新建第二套。

---

## 11. Industry Partner Architecture（產業夥伴架構）

- 產業端：提供驗證任務與能力標準；學校端：教學與紀錄；平台：串接兩端。
- 夥伴系統以 **API / Reference** 整合，不重寫夥伴既有系統。
- 資料交換遵循隱私與權限規範（見第 15 節）。

---

## 12. Software Modules（軟體模組）

既有核心模組，開發優先 **Reuse / Extend / Adapter**，禁止 **Rewrite / Duplicate / V2 Copy**：

- **Session**：學生實訓會話與狀態機。
- **Teacher Review**：教師審核與安全放行。
- **Candidate Queue**：候選佇列（已有，不另建 Model Queue）。
- **Growth Record**：成長紀錄與附件。
- **Vision**：視覺辨識（YOLO）與規則引擎。
- **RAG**：知識檢索增強。
- **General AI**：通用 AI 回答（預設 gpt-5.6-luna，最低成本優先）。
- **Teacher Style**：教師風格適配。

---

## 13. Vehicle Architecture（載具架構）

- F450 四旋翼關鍵部件：**M1～M4 馬達、槳葉方向（CW/CCW + F/B 面）、電源、ESC、飛控、GPS、接收機、電池**。
- 槳葉方向規則（PROP_DETECTION）：M1/M2 = CCW_F，M3/M4 = CW_F（作為規則參考，非實作細節）。
- 模組化設計：同一 Mission Logic 透過 Vehicle Adapter 適配不同載具。

---

## 14. Student Capability Profile（學生能力畫像）

- 由 LEVEL、任務完成度、Vision / Flight 指標、教師審核綜合生成。
- 對應職業能力驗證與證照。
- 是 One Student Record 的最終輸出，跨載具、跨課程累積。

---

## 15. Government / SBIR Data（政府 / SBIR 資料）

- 專案產出與驗收資料、能力指標、匿名化學習資料。
- 嚴格權限與隱私控管；僅授權角色可存取。
- 不與個人隱私資料混用，符合專案合規要求。

---

## 16. Development Roadmap（開發路線圖）

路線圖順序固定，後階段依賴前階段完成：

- **P0 — Student Live Coach Final**
  Camera → Voice → ONE FRAME → gpt-5.6-luna → Subtitle → Auto TTS。
  目標：完成學生真機實訓最小可用鏈。

- **P1 — AI Model Center**
  R07 best.pt 上傳 → Teacher Review → Benchmark → Candidate → Production → A06 → Data Flywheel。
  第一版：**PROP_DETECTION**；預留 HOVER / MOTOR / GPS / ESC / FRAME / BATTERY。

- **P2 — MP-12 Integration**
  使用已經存在的 **MP-12 Worktree**；禁止重新開發一套。

- **P3 — Flight Health Integration**
  使用現有 **Flight Health**；禁止重寫。

- **後續**：Industry Mission、QGC Advanced、3.0。

> 路線圖順序即優先級。**P0 未完成前，不擅自啟動 P1 以後的範圍**（除非使用者明確要求）。

---

## 附：開發鐵律速查（詳見 AGENTS.md）

- 最小 MVP、最小修改、垂直開發、最省 Token、一次只做一件事。
- 保護區：**v1.5C（絕對唯讀）**、**Flight Health**、**MP-12**、**External Dirty State（不 reset / clean / stash / 覆蓋 / 格式化）**。
- 測試區分 **AUTOMATED PASS** 與 **REAL DEVICE PASS**；自動測試不能冒充真實 iPhone 驗收。
- 依賴變更（pip / npm / 升級 / Provider / Firewall / Cloudflare 生產）須使用者批准。
- 核心程式（Class / Function / API / Adapter）須加簡短繁體中文註解。
- 未經允許禁止 Commit / Push / Merge / Deploy Production。
- 完成本輪 Scope 立即停止，不自行開始下一階段。
