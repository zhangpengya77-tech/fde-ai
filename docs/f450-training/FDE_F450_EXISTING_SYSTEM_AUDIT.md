# FDE-AI V2.0 無人機數字孿生裝調實訓中心——P0 現有系統盤點與開發方案

- 日期：2026-11-14
- 盤點方式：**只讀**。沒有修改正式站、F450 數字孿生、資料庫或任何服務
- 開發分支：`feat/f450-assembly-training`（工作資料夾 `D:\FDE-AI-UAS-v2.0-f450-training`），從正式站分支 `fde-ai-v2.0-integration-local-20261102` 的 98040d1 開出
- 狀態：**P0 完成，等待審閱後再進 P1**

## 1. 結論摘要

1. **現有 F450 數字孿生已經具備升級成裝調實訓的基礎**：
   - 最新模型 `f450-l2-r8-twin.glb` 有 59 個**獨立網格節點**，每個節點都帶 `part_key`、`layer`、`step`、`status`、`explode`；
   - 接線也是獨立物件；
   - 程式已有爆炸、整機、組裝步驟、接線、尺寸五種模式，以及 14 條接線表、10 個組裝步驟、10 項安全檢查。
2. **現在同時存在三份不同的 F450 頁面**，開發前必須先定一份基準（見 3.2）。建議以**本機正式站（integration）**為準，它最新。
3. **學員任務卡、作業證據上傳（圖片）、模擬器成績寫回、教師審核都已經有了**。FPV 截圖上傳可以直接走現有機制，不必新建系統。
4. **2D 接線畫布建議用原生 JavaScript + SVG 自己寫**，不引入 React Flow（xyflow）或 Rete：
   - 正式站 F450 頁是原生 ES module + three.js，沒有 React；
   - 為了接線畫布引入框架，等於重構頁面，違反「優先復用、不為新框架重構」。
5. **兩個 F450 相關的 GitHub 專案都沒有授權檔**，只能當參考，不能複製檔案。
6. **Pixhawk 2.4.8 的正式接線規則還不能定稿**：ArduPilot 官方頁只涵蓋 Pixhawk 1／2.4.6；BUZZER、USB、伺服排針供電都要再查官方「Powering the Pixhawk」頁，並用教師手上的實機核對。

## 2. 正式站與服務（只讀確認）

| 項目 | 實際狀況 |
|---|---|
| 正式站程式 | `D:\FDE-AI-UAS-v2.0-integration`，分支 `fde-ai-v2.0-integration-local-20261102`，HEAD 98040d1，工作區乾淨 |
| 正式站服務 | 8 個 NSSM Windows 服務全部 Running：FDE-Django、FDE-Live、FDE-Gateway、FDE-Entry、FDE-TLS、FDE-Tunnel、FDE-RAG、FDE-FlightHealth |
| 對外 | trycloudflare 通道 → Entry 8142 → Gateway 8143 → Django 8140／Live 8141；另有雲端免費版 `fde-ai-v2.fde-ai-gateway.workers.dev`（Workers＋D1）與 GitHub Pages |
| F450 網址 | `/f450-twin/`（靜態頁，正式站與雲端版都有） |

**與本指令的埠號不一致，請確認**：指令第十一節寫 Django 8022、Bridge 8262、RAG 8770，但實際上是 Django 8140、RAG 8772。8262 目前是 FDE-GCS SITL 規格保留給 MAVLink 分流用；考照場景的轉接程式已改到 8263（本機開發分支，尚未上線）。本專案**不會改動任何既有埠號**。

## 3. 現有 F450 數字孿生

### 3.1 程式與技術

| 項目 | 內容 |
|---|---|
| 位置 | 正式站 `f450-twin/`：`index.html`、`app.js`（42 KB）、`parts-data.js`（31 KB）、`twin.css`、`models/`、`img/`、`media/` |
| 3D 引擎 | three.js（本地 `vendor/three/`，MIT），GLTFLoader、DRACOLoader、OrbitControls、EffectComposer（Bloom、描邊、柔和陰影）；手機自動降級 |
| 模式 | `explode`（爆炸拆解，分 5 層）、`whole`（整機）、`assembly`（10 步組裝說明，可播放）、`wiring`（接線表＋3D 導線脈衝動畫，依序播放）、`size`（尺寸對照） |
| 互動 | 360° 旋轉、縮放、點選零件（Raycaster）、零件資訊卡、實拍照片對照、安裝檢查清單 |

### 3.2 三份版本（必須先統一）

| 位置 | app.js 大小 | 狀態 |
|---|---|---|
| 本機正式站 `D:\FDE-AI-UAS-v2.0-integration\f450-twin` | 42,235 bytes | **最新**：多了「接線教學依序播放」、教師的 Pixhawk 2.4.8 安裝指導 |
| 雲端版 `fde-ai-v2.fde-ai-gateway.workers.dev/f450-twin/` | 39,141 bytes | 較舊 |
| 分支 `feature/f450-twin-2.0`（`D:\FDE-AI-UAS-v2.0-f450-twin`） | 40,285 bytes | 與正式站不同 |
| GitHub Pages | — | 沒有 F450 頁（404） |

### 3.3 模型與零件

| 模型 | 節點 | 說明 |
|---|---|---|
| `f450-l2-r8-twin.glb`（357 KB，Draco 壓縮） | 59 個獨立網格 | **主模型**。節點帶 `part_key`／`layer`／`step`／`status`／`explode`。含 4 機臂、上下中心板、4 馬達（含槳夾、槳帽）、4 ESC、4 槳葉（標 CW／CCW）、Pixhawk 2.4.8＋減震泡棉、R9DS 接收機、GPS M8N＋支架、電源模組、電池托板、4S 電池、固定帶、XT60 主電源線、束帶／膠帶／腳架／螺絲 ×4、**接線 7 條**（訊號線束 MAIN1-4＋RC IN、ESC 電源 ×4、GPS 線、電源模組→POWER） |
| `f450-l2-r4-preview-assembly.glb`／`-exploded.glb`（各 1.6 MB） | 44 | 舊版預覽（照片剪影、標示未驗證） |

- **零件是否獨立**：是，每個零件都是獨立節點，有固定的爆炸位移向量，可以直接作為「安裝目標位置」與「吸附點」。
- **安裝動畫**：有。爆炸／收合的插值動畫，以及組裝步驟播放，但都是「看」的，不是學員自己裝。
- **零件資料**：`parts-data.js` 有 16 類零件，每類都有中英文名稱、功能、安裝位置、接口、相關零件、注意事項、常見故障、資料來源。
  - 驗證狀態分三級：VERIFIED、REFERENCE、PLACEHOLDER。目前**沒有任何零件是 VERIFIED**，接線全部標「待實機核對」。
- **指令要求的零件中，現有模型沒有的**：H743 飛控、Telemetry 數傳、LD06 安裝座、攝像頭安裝座、獨立的 Compass，以及上下中心板與機臂的拆分零件（已有）。這些需要新增模型或簡化示意件。

### 3.4 現有接線資料（`WIRING`／`WIRING_LINKS`）

| # | 從 | 到 | 備註 |
|---|---|---|---|
| 1 | 電池 XT60 | 電源模組輸入 | 整機主電源 |
| 2 | 電源模組輸出 | 下中心板（配電板） | 分電給 ESC |
| 3 | 電源模組 6P | Pixhawk POWER | 供電＋電壓電流量測 |
| 4 | 下中心板焊盤 | ESC ×4 電源 | 焊接，紅正黑負 |
| 5–8 | ESC 右前／左後／左前／右後 | MAIN OUT 1／2／3／4 | Quad X 標準順序 |
| 9 | ESC 三相線 | 馬達 | 轉向錯交換任兩條 |
| 10 | R9DS 接收機 | RC 埠 | SBUS 模式 |
| 11 | GPS 6pin | Pixhawk GPS | 教師安裝指導 |
| 12 | 羅盤 4pin | Pixhawk I2C | 教師安裝指導 |
| 13 | 安全開關 3pin | Pixhawk SWITCH | 教師安裝指導 |
| 14 | 蜂鳴器 2pin | Pixhawk BUZZER | 教師安裝指導 |

這份資料是 2D 接線規則的起點，但目前只有「零件到零件」，還沒有**端口 ID、腳位、極性、電壓**，不能直接拿來自動判分。

## 4. 學員、評分與教師後台（Django `learning` app）

| 需求 | 現有機制 | 可否直接用 |
|---|---|---|
| 學員任務卡 | `TaskDefinition`（學／練／做／測／證五階段，含 `requirements`、`evidence_required`）＋`StudentTaskProgress` | 可以：新增「F450 組裝接線」「FPV 接線」兩張任務卡，屬於資料而非程式 |
| 作業上傳 | `Evidence`（圖片／影片／檔案…）＋`/student/courses/<id>/tasks/<task_id>/evidence/` | **可以直接用於 FPV 截圖上傳** |
| 模擬器成績 | `SimPracticeRecord`（分數、等第、是否通過、`summary` JSON）＋`/student/sim-practice/api/`（考照模擬器已在用） | 可以，但 `mode` 目前只有「電力巡檢」「考場模擬」，加「裝調實訓」要改 choices（會產生一個不動資料表結構的 migration，**需要你批准**） |
| 教師審核 | `teacher_sim_practice`、`TeacherReviewEvent`、`GrowthRecordReview` | 可以 |
| 權限隔離 | `Cohort`／`Enrollment`／`TeacherCohortAccess` | 沿用，不修改 |
| AI 評分 | 現有的是視覺檢測與電力巡檢的 AI 模型；**沒有接線評分**。依指令：分數一律用確定性規則算，AI 只做中文解說與建議（可接現有 RAG／AI 助教） | 新增規則引擎，AI 只解說 |

## 5. HyperQGC 與 ArduPilot SITL

| 項目 | 現況 |
|---|---|
| HyperQGC（超維空間） | `C:\Program Files\cwkj\cwkj.exe`；另有 HQGC（`E:\OneDrive\…\HQGC`，QGC 5.1.4 系，沒有原始碼）。2026-11-14 已實測多機任務 |
| SITL | Mission Planner 內建 ArduCopter.exe（V4.8.0-dev），多機腳本在 `D:\FDE-Sim-SITL-Mode`（本機開發分支）；FDE-DT 的 Gazebo＋SITL 在 `D:\FDE-DT`（只在本機） |
| 與本專案的關係 | 第一版**完全不連 SITL 或真機**。接線與組裝都是教學模擬，不送任何電氣或控制指令。之後若要「接完線→進 SITL 飛」，可以接 FDE-GCS 的多機仿真（`feat/fde-gcs-sitl-fleet`，已在 GitHub） |

## 6. REA 參考分析：花生 FPV 接線模擬器

觀察日期 2026-11-14，只觀察公開頁面的互動行為。**不複製程式碼、不保存或使用其截圖與視覺素材**，截圖只用於本次觀察，沒有放進專案。

| 功能 | 觀察結果 | 我方做法 |
|---|---|---|
| 1. 元件選擇 | 左側「配件」清單 15 種（F722 飛控、四合一電調、6S 電池、XT60、電容、電機、ELRS 接收機、GPS、蜂鳴器、LED、攝像頭、圖傳、O4 Pro、兩種天線），每項旁有「＋」加入畫布 | 同樣做「零件盤」，但改為 F450 零件 |
| 2. 元件拖拽 | 元件以真實外觀圖放在畫布上，可移動 | 我方用自繪簡化圖示（SVG），不使用對方圖片 |
| 3. 元件旋轉 | 本次未確認操作方式 | 第一版先不做旋轉，需要時再加 |
| 4. 端口 | 焊盤／接頭都有文字標籤（例如圖傳的 5V-OUT、GND、VIDEO、7-26V-IN、IRC），導線接在焊盤圓點上 | 端口用 Pixhawk 實際名稱（POWER、GPS、I2C、MAIN OUT 1–8…） |
| 5. 拉線 | 從焊盤拖到空白處不會產生導線；正確的拉線手勢本次未完全確認 | 我方採「點端口 → 點另一端口」，手機也好操作 |
| 6. 導線顏色 | 依用途自動上色（紅＝電源、灰／黑＝地線、黃＝影像、藍＝控制…），以平滑曲線繪製 | 依「電源／地線／訊號」自動上色，可手動改色 |
| 7. 導線刪除 | **點一下導線就直接刪除**，沒有確認 | 我方改成「點選 → 按刪除」，避免誤刪 |
| 8. 重新連接 | 刪除後重新拉 | 同 |
| 9. 正確性檢查 | 右上「檢查接線＋目前導線數」，結果分類列出，例如「發現 1 項問題｜缺線（1）｜模擬圖傳 還需正確連接 7-26V-IN」；全對時顯示「接線檢查通過」 | 同樣分類：缺線、接錯、極性錯、重複、不允許的連接，並在 3D 同步標紅 |
| 10. 完整示例 | 一鍵載入完整接線（49 根線），自動縮放到全圖 | 同樣提供「完整示範」，考核模式隱藏 |
| 11. 縮放與移動 | 滾輪以游標為中心縮放、右下有 −／百分比／＋、適配畫面、主題切換 | 同 |
| 12. 保存與載入 | 「文件」選單：匯入 JSON、匯出 JSON、匯出 PNG | 練習狀態存瀏覽器並可匯出 JSON；**FPV 作業可直接用它的「匯出 PNG」當截圖上傳** |

## 7. 開源資源與授權

| 資源 | 授權 | 內容 | 結論 |
|---|---|---|---|
| sinanp1x/f450-drone-cad-stl | **沒有授權檔** | F450 機架 STL（機臂、上下板、槳、螺絲）、Simulink、MATLAB | **不能使用檔案**（沒有授權＝保留所有權利）。只能參考尺寸概念；現有自建模型已足夠 |
| rushabhdhoke/Pixhawk-F450-RPi3b-Mavlink | **沒有授權檔** | 只有 README：F450＋Pixhawk 2.4.8＋樹莓派接線與 DroneKit 範例 | 只能閱讀參考，不能複製文字或程式；接線規則以 ArduPilot 官方文件與實機為準 |
| ArduPilot/ardupilot_gazebo | LGPL-3.0 | Gazebo 的 ArduPilot 外掛（C++） | 本專案第一版用不到 |
| xyflow/xyflow（React Flow） | MIT | React／Svelte 節點連線元件 | 授權可用，但**需要 React**，正式站 F450 頁沒有 React → 不採用 |
| retejs/rete | MIT | 節點式視覺程式框架 | 授權可用，但對簡單接線來說太重，需要額外框架 → 不採用 |
| mrdoob/three.js | MIT | 3D 函式庫 | **已在使用**，沿用 |

### 7.1 Pixhawk 2.4.8 端口依據（ArduPilot 官方 Pixhawk Overview）

官方頁可確認的端口：
- POWER（6 腳：5V×2、電流、電壓、GND×2）
- GPS（6 腳）
- I2C（4 腳）
- TELEM1／TELEM2（6 腳，3.3V 邏輯）
- SERIAL 4/5
- CAN
- SPI
- SWITCH（安全開關，3 腳）
- ADC
- Spektrum/DSM
- 14 個 3 腳伺服接頭：MAIN OUT 1–8、AUX 1–6；同一排針帶 PPM／SBUS 輸入

**還不能定稿的部分**：
- 官方頁說明的是 Pixhawk 1（3DR）與 2.4.6，沒有提到 2.4.8；而且明確寫「許多相容機改用 Molex 接頭，不能假設相容」。
- 頁面文字沒有 BUZZER、USB 接頭章節，也沒有寫明「RC IN」端口名稱。
- 伺服排針由誰供電、ESC 的 BEC 怎麼接：這一頁沒說，要另查官方「Powering the Pixhawk」。

→ 2D 接線考核的規則，要用**官方文件＋教師手上的 2.4.8 實機照片**逐一核對，標成 VERIFIED 後才能用於正式考核。H743 依指令在確認型號與腳位前不開放考核。

## 8. 開發方案

### 8.1 共用資料模型（2D／3D 同步的核心）

新增一個純資料與規則模組（不依賴畫面），2D 與 3D 都只讀寫它：

| 物件 | 欄位 |
|---|---|
| Component | `id`（例如 `esc_fr`）、`kind`（對應 `parts-data.js` 的 key）、`glbNode`（對應 3D 節點名）、`ports[]` |
| Port | `id`（例如 `pixhawk.main_out_1`）、`label`、`role`（power-in／power-out／gnd／signal／data）、`voltage`、`connector` |
| Wire | `id`、`from`、`to`、`color`、`kind` |
| ConnectionGraph | 全部導線 |
| AssemblyState | 每個零件：未安裝／已安裝／方向錯 |
| ValidationResult | 缺線、接錯、極性錯、重複、不允許、組裝順序錯，每項都指向元件與導線 ID |

規則（Pixhawk 2.4.8 第一版）由 3.4 的 14 條接線加上端口屬性產生，以單元測試鎖住：
- 每條正確接線一個測試；
- 每種錯誤一個測試。

### 8.2 三種操作模式

1. **零件認識**：沿用現有點選與資訊卡，補齊中英文名稱、功能、位置、接口、安全注意。
2. **3D 模擬組裝**：
   - 零件從「零件盤」拖進場景；
   - 靠近 `explode` 反向算出的安裝位置時自動吸附；
   - 檢查方向（例如 Pixhawk、GPS 箭頭朝機頭）與順序（依 `step`）；
   - 錯誤即時提示、進度條、一鍵重置；
   - 絕不用動畫假裝完成。
3. **2D 接線**：原生 SVG 畫布，功能如第 6 節「我方做法」欄。

### 8.3 階段與預估

| 階段 | 內容 | 會動到的檔案 |
|---|---|---|
| P1 | 在 F450 頁下方加「無人機組裝與接線實訓」專區：F450 入口（站內）＋FPV 入口（新分頁開 hs-fpv.com，`rel="noopener noreferrer"`）＋FPV 任務卡說明 | `f450-twin/index.html`、`twin.css`；不動既有入口與導航 |
| P2 | 共用資料模型＋3D 組裝模式 | 新增 `f450-twin/training/*.js`；`app.js` 只加模式切換掛勾 |
| P3 | 2D 接線畫布 | 新增 `f450-twin/training/wiring-canvas.js` |
| P4 | 2D／3D 同步 | 同上，透過共用資料模型 |
| P5 | 規則判分（100 分：機架 20、馬達與 ESC 20、飛控 15、電源與訊號 30、安全 15）＋教學／練習／考核三模式 | 新增規則模組與測試 |
| P6 | 接任務卡與教師後台：成績寫入 `SimPracticeRecord`（需批准加 mode）、FPV 走 `Evidence` 上傳 | Django 小改＋任務卡資料 |
| P7 | 電腦、手機、權限、效能測試 | 測試 |
| P8 | 正式站部署 | **等你批准** |

每階段都附：變更清單、測試結果、截圖、風險、回滾方式。

### 8.4 風險

| 風險 | 處理 |
|---|---|
| 三份 F450 版本不一致 | P1 前先以正式站版本為基準，雲端版在 P8 一起更新 |
| 接線規則錯誤會教錯學生 | 規則逐條標來源與驗證狀態；未 VERIFIED 的規則只用於練習，不計正式考核分數 |
| 手機效能 | 沿用現有手機降級；2D 畫布用 SVG，元件數量少（約 20 個） |
| 第三方網站變動或下線 | FPV 只是外部連結；連結失效時入口顯示提示，不影響 F450 |
| 加 `SimPracticeRecord` mode 需要 migration | P6 再處理，先問你 |

### 8.5 回滾

所有開發都在 `feat/f450-assembly-training`。P1–P7 只動 `f450-twin/` 下的新增檔案，以及 `index.html`、`app.js` 的少量掛勾；revert 該分支即可回到現況。P8 正式發布前保留目前正式站 commit（98040d1）作為回滾點。

## 9. 需要你決定的事

1. **基準版本**：以本機正式站的 F450（最新版）為開發基準，可以嗎？
2. **2D 畫布**：用原生 SVG 自己寫，不引入 React Flow，可以嗎？
3. **埠號**：指令寫的 8022／8262／8770 與實際的 8140／8772 不一致。我照實際埠號保護，不改任何埠號，對嗎？
4. **缺少的零件**（H743、數傳、LD06 座、攝像頭座、獨立羅盤）：第一版先用簡化示意件，標「示意」，可以嗎？
5. **核對實機**：請教師提供 Pixhawk 2.4.8 實機各接口的照片，用來把接線規則標成 VERIFIED。
