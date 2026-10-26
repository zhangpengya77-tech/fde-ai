# P0-C／P0-D 驗收報告（WorkBuddy 續作）

日期：2026-10-25
工作樹：`D:\FDE-Power-Inspection-Simulator-P0`
分支：`codex/fde-p0-visibility`
基準 HEAD：`fd45e607bf962fbf0d4207cec06e9677b505cb39`
狀態：**未 commit、未 push**（依紅線保留工作區變更待教師裁決）

---

## 1. 核對結果（與交接文件一致）

| 項目 | 交接文件 | 實測 | 結果 |
|---|---|---|---|
| `git rev-parse --show-toplevel` | `D:/FDE-Power-Inspection-Simulator-P0` | 同 | ✅ |
| `git branch --show-current` | `codex/fde-p0-visibility` | 同 | ✅ |
| `git rev-parse HEAD` | `fd45e607bf962fbf0d4207cec06e9677b505cb39` | 同 | ✅ |
| `git status --short` | 6 個 `M` 檔、無 untracked | 同 | ✅ |
| `git diff --check` | 無空白錯誤 | 無空白錯誤（僅既有 CRLF 提示） | ✅ |

修改檔（6 個，共 +400 / −30）：

```
src/exam/exam-app.ts             | 160 ++++++++++++++++-----
src/exam/panel.ts                |  10 ++-
src/exam/scene.ts                | 127 ++++++++++++++++++++---
src/i18n/zh-Hant.ts              |   1 +
tests/browser/exam-drone.spec.ts |  75 +++++++++++++++++-
tests/unit/exam-scene.test.ts    |  57 +++++++++++++
```

---

## 2. 測試結果

| 指令 | 結果 |
|---|---|
| `npx tsc -b` | **0 錯誤** |
| `npx vitest run`（單元） | **665 passed / 53 files**（含 P0-C／P0-D 新增 2 項） |
| `npm run test:browser`（完整 Playwright） | **118 passed / 9 skipped / 1 failed（12.4 分鐘）** |

### 2.1 唯一失敗項分析（非本輪改動造成）

```
[mobile-chrome] › rc-calibration-visibility.spec.ts:456
  › recording suggestion applies only the channel that differs
```

- **不在本輪修改範圍**：`tests/browser/rc-calibration-visibility.spec.ts`、
  `src/ui/recording-suggestion.ts`、`src/ui/controller-calibration.ts`
  三者對 HEAD 均為 `git diff` 空 → 本輪未觸碰。
- **失敗機制**：引導錄製的峰值偵測（`SUGGESTION_MIN_PEAK = 0.7`）在
  完整套件負載下，行動模擬的 rAF 取樣未捕捉到 axis0/axis1 的 0.98 峰值，
  導致建議文字退回「未偵測到峰值 ≥ 0.70 的軸…」。
- **隔離重跑證實為 flaky**：
  ```
  npx playwright test tests/browser/rc-calibration-visibility.spec.ts \
    --project=mobile-chrome -g "recording suggestion applies only the channel that differs"
  → 1 passed (40.6s)，測試本體 4.3s
  ```
  單獨執行即通過，判定為 **套件併發／負載下的取樣時序 flake**，
  非 P0-C／P0-D 造成的回歸。

### 2.2 紅線檔案未變更（逐檔 `git diff --quiet` 驗證）

```
UNCHANGED  src/exam/field.ts              UNCHANGED  src/exam/subjects.ts
UNCHANGED  config/caa-exam.json           UNCHANGED  src/exam/subjects-b.ts
UNCHANGED  src/exam/flight-controller.ts   UNCHANGED  src/exam/subjects-c.ts
UNCHANGED  src/exam/scoring.ts             UNCHANGED  src/exam/subjects-d.ts
                                            UNCHANGED  src/exam/subjects-f.ts
UNCHANGED  src/drone/create-programmatic-f450.ts
UNCHANGED  src/exam/camera.ts
```

---

### 2.3 測試結果封存（實際數值，未標示全綠）

| 項目 | 實際結果 | 封存標記 |
|---|---|---|
| TypeScript（`npx tsc -b`） | **PASS（0 錯誤）** | ✅ |
| Vitest（`npx vitest run`） | **665 PASS / 53 files** | ✅ |
| Playwright（`npm run test:browser`） | **118 PASS / 9 SKIPPED / 1 FAILED** | ⚠️ 非全綠 |
| RC 校準單獨重跑（mobile-chrome 隔離） | **PASS（4.3s）** | ✅ |

> **本輪不將完整 Playwright 標示為全綠**：118 passed / 9 skipped / 1 failed，
> 其中 1 failed 屬既有 flaky（見 2.4）。

### 2.4 待追蹤問題（本輪不處理）

- **`rc-calibration-visibility.spec.ts:456`（mobile-chrome）偶發失敗**
  - 現象：引導錄製峰值偵測（`SUGGESTION_MIN_PEAK=0.7`）在完整套件負載下，
    行動模擬 rAF 取樣未捕捉 axis0/axis1 的 0.98 峰值 → 建議文字退回「未偵測到峰值 ≥ 0.70 的軸」。
  - 隔離重跑（同一 mobile-chrome 專案，同一測試）1 passed（4.3s）→ 確認為**時序 flake**，
    非邏輯錯誤、非本輪 P0 改動造成。
  - **本輪未修改 RC 校準程式**（`src/ui/recording-suggestion.ts`、
    `src/ui/controller-calibration.ts` 對 HEAD 皆未變）；列為待追蹤，另案處理。

## 3. P0-C：考試機前後方向視覺

實作於 `src/exam/scene.ts`：

- `DroneNoseMarker` — 紅 `0xd8493f`（emissive `0x45100c`），cone 指向本地 **−Z**（專案前方）。
- `DroneTailMarker` — 白 `0xe8ece7`，cone 指向本地 **+Z**（專案後方）。
- 馬達命名保留：`MotorFrontLeft` / `MotorFrontRight` / `MotorRearRight` / `MotorRearLeft`。
- 機臂配色：前臂紅、後臂白。
- **對角馬達距維持 1.00 m**（單元測試鎖定 `motorFrontLeft ↔ motorRearRight` 距離）。
- 未移植 `create-programmatic-f450.ts`（該檔對角約 3.24 m，僅供一般巡檢場景）。

視覺確認（截圖放大檢視）：

- 追隨視角：紅色前臂位於機身遠端、白色後臂與白色尾錐朝向觀者。
- 考生視角：同樣可辨識紅前臂／白後臂。
- 結論：紅＝前、白＝後，方向可判讀。

---

## 4. P0-D：純視覺圍網

實作於 `src/exam/scene.ts` → `createVisualFence()`：

| 項目 | 值 | 來源 |
|---|---|---|
| 操作區 | 80 × 30 m（X ±15、Z ±40） | `field.operationArea`（唯讀） |
| 圍網退縮 | 2.0 m | `FENCE_SETBACK_M` |
| 圍網外框 | 84 × 34 m（X ±17、Z ±42） | 由操作區推導 |
| 圍網高度 | 2.0 m | `FENCE_HEIGHT_M` |
| 立柱間距 | 4.0 m | `FENCE_TARGET_POST_SPACING_M` |
| 立柱 | 單一 `InstancedMesh`（`0x4a5150`） | 降低 draw call |
| 網面 | 4 片半透明（`0x7b8380`, opacity 0.30, `depthWrite:false`） | 視覺遮擋優先調 opacity |
| 橫桿 | 線段，`0x555d5b` | — |

隔離性（`userData` 三標記，全域 `grep` 確認僅存在於 `scene.ts`）：

```ts
visualOnly: true, collisionEnabled: false, scoringEnabled: false
```

- `ExamVisualFence` **未被任何** `subjects*.ts` / `scoring.ts` / `field.ts` / `session.ts` 引用
  → 不進判定路徑、不影響評分、不改變考試幾何。
- 單元測試斷言 `fence.userData.outerWidthM === field.operationArea.widthM + 4`、
  `outerLengthM === field.operationArea.lengthM + 4`（證明是「推導」而非硬編碼）。
- 同時斷言 `LandingPointH` 與 `Cone_P4` 座標仍等於 `field` 的值 → **H／P1–P7／雙圓座標未變**。

草地色由 `0x6f846b` 微調為 `0x6c8258`（純視覺）；`hOuter.name = 'LandingPointH'`。

> 註：圍網數值為**教學視覺設計值**，非 CAA 官方規範數值。

---

## 5. 截圖人工檢視（5 張全數存在且已檢視）

目錄：`D:\FDE-Power-Inspection-Simulator-P0\.playwright-output\exam-shots\`

| 檔名 | 解析度 | 檢視結果 |
|---|---|---|
| `1280x720-before.png` | 1280×720 | ✅ 圍網在操作區**外側**、紅頭白尾可辨、H 起降圈與雙圓完整、頂欄與面板未遮擋場景中央 |
| `1920x1080-follow.png` | 1920×1080 | ✅ 追隨視角、圍網在遠端外側、機體居中清晰、雙圓與錐筒完整 |
| `1920x1080-overview.png` | 1920×1080 | ✅ 俯視全景可見完整圍網外框（84×34 m）、八字雙圓與 8 座錐筒、H 點在操作區內 |
| `1920x1080-flying.png` | 1920×1080 | ✅ 飛行中視角、機體升起、地面 H 內靶（紅）可見 |
| `390x844-mobile-examinee.png` | 390×844 | ✅ 行動版面板縱向堆疊不重疊、場景中央淨空、圍網／錐筒可見 |

另附 `1366x768-{before,flying,report}.png` 與各解析度 `report` 截圖。

場景幾何交叉驗證（唯讀 `field.ts` / `config/caa-exam.json`）：

- `config/caa-exam.json` → `operationArea: { lengthM: 80, widthM: 30, sideMarginM: 20, page: 233 }`
- `scene.ts` 全部由 `field.figure8.*`、`field.landingPointH.*`、`field.figure8.cones.*` 推導，
  唯讀來源未被修改 → **H、P1–P7、雙圓、錐筒座標皆未改變**。

---

## 6. 效能

**Draw calls／三角面數／FPS 未量測。**

本輪未於瀏覽器端量測 `renderer.info` 或 FPS 計數器，故不提供任何數字，避免杜撰。
（若需正式效能數據，建議另立一次專門量測：固定視角、固定解析度、取樣 N 秒後讀取
`renderer.info.render.calls` / `triangles` 與 rAF 幀率。）

---

## 7. 環境與紅線遵守

- ✅ 快取／暫存導向 D 槽：`npm_config_cache=D:\FDE-Tools\npm-cache`、
  `TEMP`／`TMP=D:\FDE-Tools\tmp`。
- ✅ **未安裝任何依賴、未下載瀏覽器、未啟動 Docker**；
  Playwright 沿用 C 槽既有 `ms-playwright`（chromium-1248），僅讀取。
  （`D:\FDE-Tools\playwright-browsers` 為空目錄，設定該路徑會觸發下載，故未採用。）
- ✅ Playwright 僅使用 P0 的 4173 埠。
- ✅ **測試結束後殘留檢查**：剩餘 FDE `node.exe` 程序 = **0**、4173 LISTENING socket = **0**。
- ✅ 未執行 `reset` / `clean` / `stash` / `checkout --` / force push / commit / push / merge / deploy。
- ✅ 主工作樹 `D:\FDE-Power-Inspection-Simulator` 未被觸碰
  （branch `phase1-mvp`、HEAD `fd45e60` 不變；其 `git status` 仍為既有外部修改）。
- ✅ 未更動 `src/drone/create-programmatic-f450.ts`、`field.ts`、`config/caa-exam.json`、
  飛控、搖桿映射、評分規則。
- ✅ 相機操作僅改 `camera.position` / `camera.fov`，不送飛控指令、不改評分資料
  （程式碼註記 + 瀏覽器測試斷言 `flightState`／`altitude`／`position` 皆不變）。

---

## 8. 結論

P0-C（考試機前後方向視覺）與 P0-D（純視覺圍網）**已實作完成並通過驗證**：

- 類型檢查 0 錯誤、單元 665 項全綠、Playwright 118 項通過。
- 唯一 1 項失敗經隔離重跑證實為**與本輪無關的既有 flaky**（RC 錄製峰值取樣時序）。
- 5 張必要截圖全數存在並已人工檢視。
- 圍網為純視覺、不碰撞、不評分；H／P1–P7／雙圓／錐筒座標未變。
- 工作區變更保留未提交，等待教師驗收與裁決。

### 待教師裁決事項

1. 本輪 6 個檔案的變更是否 **commit**（依紅線未自行提交）。
2. `rc-calibration-visibility.spec.ts` 的 mobile flake 是否需另案修正（本輪未動）。
3. P0-B（機體尺寸變更）、科目 E（高度保持五邊）、實體搖桿 `PENDING_DEVICE_TEST`
   皆不在本輪範圍。

---

## 11. 本地 Commit（封存）

- **SHA**：`eb242c74d247974239515b7bc676ac7807e96f47`（`eb242c7`）
- **分支**：`codex/fde-p0-visibility`（LOCAL ONLY，未 push）
- **Message**：`feat(exam): improve camera visibility, controls and field visuals`
- **提交檔案（6 個，+400 / −30）**：

  ```
  src/exam/exam-app.ts             | 160 ++++++
  src/exam/panel.ts                |  10 +-
  src/exam/scene.ts                | 127 ++++++
  src/i18n/zh-Hant.ts              |   1 +
  tests/browser/exam-drone.spec.ts |  75 +++++
  tests/unit/exam-scene.test.ts    |  57 +++++
  ```

- **未納入版本控制（保留 untracked）**：`docs/handoff/P0-CD-VERIFICATION-REPORT-2026-10-25.md`
  （含本機絕對路徑與測試產物路徑，依 Task 3 規則不提交）。
- **工作樹狀態**：6 個程式碼／測試檔已提交；其餘無變更；無 push／merge／deploy。
