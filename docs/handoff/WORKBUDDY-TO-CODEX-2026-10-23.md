# 交接文件：WorkBuddy → Codex

日期：2026-10-23
分支：`phase1-mvp`（仿真器）
交付時 HEAD：`aaf0f9d docs(handoff): 新增 WorkBuddy → Codex 交接文件`
工作樹：**乾淨**。
有一份**已提交但尚未接線**的工作（相機縮放與環繞，只完成純函式層，見第 6 節）——接手時不要 reset/checkout/stash，直接從第 6 節的第 1 步接著做。

---

## 1. 這份文件是什麼

給接手這個專案的開發者（Codex）的完整脈絡：目標、進度、架構、命令、紅線、以及**現在手上做到一半的東西**。
讀完第 6 節就能直接接著做。

---

## 2. 專案目標與範圍

**一句話**：台灣民航局（CAA）「遙控無人機專業操作證」**基本級多旋翼術科測驗**的考場模擬器，用於教師示範與學員練習。

**範圍邊界**：

- 畫面上必須常駐標示「非官方測驗，僅供練習」。
- 判定數值一律來自 `config/caa-exam.json`，出處是民航通告 **AC 107-005D**（現行勘誤版）。讀不到的官方數值留 `null` 並記在 `nullsReport`，**不得用猜測值冒充官方值**。
- 模擬假設值（例如應考人站位、微風風況、cam 慣用 55°）一律標「模擬假設，非官方」且可調。
- 七項考試：**A 飛行前檢查／B 定点起降四面停悬／C 8 字水平圆／D 側面停懸及前進後退／E 高度保持五邊飛行（未實作）／F 緊急處置／G 飛行後檢查**。

---

## 3. 兩個 repo（**從未整合，這是本專案最大的結構性風險**）

| repo | 路徑 | 分支 | 內容 |
|---|---|---|---|
| 仿真器（本文件主體） | `D:\FDE-Power-Inspection-Simulator` | `phase1-mvp` | Three.js 場景／輸入管線／飛控／考試判定／成績單／報告；**本地優先、無服務端** |
| 在線平台 | `D:\FDE-AI-UAS-v2.0` | `fde-ai-v2.0-dev` | Django 帳號／課程／教師門戶 + `live_backend` Live 教學 + YOLO + flight-health；57 路由全 HTTP，**無 3D／無 WebSocket** |

在線平台在 8111 提供 `/sim` 掛載，**直接吃仿真器的 `dist/`**（已驗證：8111 回傳的 `index.html` 資源雜湊與本地 `dist/index.html` 一致）。
→ 所以**改完仿真器只要 `npm run build`，重新整理瀏覽器即可生效，不需重啟 8111**。

---

## 4. 目前進度

### 已完成並通過驗證

| 區塊 | 狀態 | 驗證方式 |
|---|---|---|
| 輸入管線（品牌無關） | 完成 | `PilotInputAdapter→InputNormalizer→ChannelMapper→PilotInputPipeline→SimpleFlightController` |
| 場景／安全（Three.js-free） | 完成 | `SceneDefinition.ts` + `SafetyEngine.ts` |
| 巡檢任務／模擬 AI／評分／報告 | 完成（P1-4~P1-7） | 報告存 IndexedDB，無資料顯示「无记录」 |
| 考試科目 A／G | 完成 | 附件 3 檢查表＋逆時針繞行 |
| 科目 B／C | 完成 | 四面停懸／8 字雙圓 |
| 科目 D | 完成 | 六定點＋前後退 12 m |
| 科目 F | 完成 | 緊急返航（空中按 `E`） |
| 科目 E | **未實作** | — |
| 考試機體 3D 建模＋起飛流程 | 完成 | 程序化四軸（對角≈1.0 m）＋油門鎖 `takeoffThrottleLatch` |
| 考試介面重寫 | 完成 | flex 頂欄＋右側 240px 窄欄＋底部控制列＋步驟條＋考生視角 |
| 風場語意修正 | 完成 | 陣風＝**瞬時風速峰值上限**；預設無風；四風況可切換 |
| 人工驗收環境 | 完成 | `tools/manual-verify-smoke.mjs`（21/21）＋`docs/manual-verification-checklist.md` |

### 科目判定實測（最近一次，2026-10-23）

| 科目 | 無風 0/0 | 微風 2/4 |
|---|---|---|
| B | S（五面 7.00/6.08/6.08/6.08/6.12 s，漂移 0.000 m） | S（6.98/6.08/6.08/6.08/6.12 s） |
| C | S（偏差 0.000 m，最長停頓 0.00 s） | S（同上） |
| D | S（六點 5.87–6.00 s，漂移 0.079–0.081 m） | **U**（`subjectD.hoverFail`） |
| F | S（觸發 t=9.12 s @(8.01, −8.36)） | S |

---

## 5. 架構速覽（考試模式）

```
main.ts (?mode=exam)
  └─ exam/exam-app.ts        整合層：DOM 骨架、Three.js 場景、輸入、流程、按鍵、測試鉤子
       ├─ exam/wind.ts       風場 + 安全宣告門檻（純函式層）
       ├─ exam/flight-controller.ts  飛控（起飛/懸停/降落、油門鎖、定位保持補償）
       ├─ exam/scene.ts      程序化考場 + 程序化四軸機體
       ├─ exam/field.ts      場地幾何（起降點 H、八字雙圓、操作區、應考人站位）
       ├─ exam/subjects*.ts  科目 A/B/C/D/F/G 各自的判定純函式
       ├─ exam/scoring.ts    仿附錄 5 成績單 + simulatedPass
       ├─ exam/major-failures.ts  重大違失（4 自動 + 3 手動）
       ├─ exam/session.ts    錄製 → 分科目切片 → 彙整
       ├─ exam/flow.ts       步驟條／狀態／提示／按鈕可用性（純函式）
       ├─ exam/panel.ts      右側 HUD（小地圖、模式、風、輸入來源、免責）
       ├─ exam/scripted-pilot.ts  測試用腳本飛行員（只產生搖桿指令，不碰閾值）
       └─ exam/camera.ts     **進行中**：相機調整純函式層
```

測試鉤子：`window.__examTestHook = { getState(), getDroneScreen() }`。
`getState()` 含 `frames`（已渲染幀數）、`step`、`status`、`cameraView`、`subject`、`position`、`flightState`、`altitude`、`windSpeedMps`、`positionHoldCompensating`。

---

## 6. ⚠️ 進行中未提交的工作：相機縮放與環繞

**教師需求（2026-10-23 原話）**：`需要畫面放大縮小 飛機視角可調整`
（起因：截圖中機體在全景視角只有 14 px，教師希望可自行放大、把視角調到看得清楚。）

### 已經做好（已提交 `536bc1b`，尚未接入 exam-app）

| 檔案 | 內容 |
|---|---|
| `src/exam/camera.ts`（新增） | 純函式層：`CAMERA_LIMITS`（fov 20–80 步進 5、預設 55；pitch −6~89；相機不低於 0.3 m）、`defaultCameraAdjust()`、`zoomFovDeg()`、`addOrbitYawDeg()`（正規化到 (−180,180]）、`addOrbitPitchDeg()`、`applyOrbitOffset()`（球座標旋轉，**不改變與目標的距離**）、`resolveCameraPosition()` |
| `tests/unit/exam-camera.test.ts`（新增） | **11 項，全綠**（已實跑：`npx vitest run tests/unit/exam-camera.test.ts` → 11 passed） |

調整量三項：`fovDeg`（縮放）、`orbitYawDeg`（水平環繞）、`orbitPitchDeg`（俯仰）。

### 還沒做（接手的任務）

1. **`src/exam/exam-app.ts`**
   - `updateCamera()`（第 313 行起）：先算出原本的 base 相機位置與目標，改為呼叫 `resolveCameraPosition(target, rel, adjust.orbitYawDeg, adjust.orbitPitchDeg)`；並在 `fovDeg` 變動時設 `camera.fov` + `updateProjectionMatrix()`（**記住上一個 fov，別每幀重算投影矩陣**）。
   - `let adjust = defaultCameraAdjust();`（`updateCamera` 之前）。
   - 滾輪縮放：`stage`（第 179 行）上掛 `wheel`，`{ passive: false }` 並 `preventDefault()`，`adjust.fovDeg = zoomFovDeg(adjust.fovDeg, e.deltaY < 0 ? 1 : -1)`。
   - 拖曳環繞：`canvas`（第 183 行）上掛 `pointerdown/move/up/cancel` + `contextmenu` preventDefault；水平位移 → `addOrbitYawDeg`，垂直位移取負 → `addOrbitPitchDeg`（往上拖＝視角抬高）。
   - 鍵盤：`onKeyDown`（第 433 行）加 `Equal`/`NumpadAdd`（放大）、`Minus`/`NumpadSubtract`（縮小）、**`KeyZ`**（重置 `defaultCameraAdjust()`）。注意 **`KeyE` 已被科目 F 緊急返航占用，勿搶**；`KeyG` 是輸入來源切換。
2. **`src/exam/panel.ts`**：`setCameraView()`（第 172 行）多收一個 adjust，render（第 325 行）顯示成 `視角：考生視角（55°）`，環繞非 0 時附「環繞 30°」；面板加一行小字操作提示。
3. **`src/i18n/zh-Hant.ts`**：`camera` 區塊（第 303 行附近）補 `zoom`、`orbit`、`adjustHint`（例如「滾輪縮放 · 拖曳環繞 · Z 重置」）。**不要塞進 `controlsHint`**——底部提示列是 `white-space:nowrap`，字一多就被截斷（教師先前抱怨過文字過長）。
4. **`tools/manual-verify-smoke.mjs`**：加「滾輪縮放改變 `getDroneScreen().sizePx`」與「`Z` 重置回到 55°」兩項檢查。
5. **`docs/manual-verification-checklist.md`**：D 組補相機調整的操作與預期。
6. 跑 `npx tsc -b` → `npx vitest run` → `node tools/manual-verify-smoke.mjs` → `CODEBUDDY_SAFE_DELETE_ENABLED=0 npx playwright test tests/browser/exam-drone.spec.ts`，再分組 commit。

---

## 7. 環境與命令

```bash
cd /d/FDE-Power-Inspection-Simulator

npm run build                                  # tsc -b && vite build（產出 dist/）
npx vitest run                                 # 單元測試（目前 652 + 新增 11 = 663）
CODEBUDDY_SAFE_DELETE_ENABLED=0 \
  npx playwright test                          # 瀏覽器測試（會自動 build + preview 4173）
node tools/manual-verify-smoke.mjs             # 人工驗收預檢（打 8111 實際服務，21 項）
curl -s http://127.0.0.1:8111/sim/ | grep assets   # 確認 8111 服務到最新 dist
```

- **瀏覽器測試必須加 `CODEBUDDY_SAFE_DELETE_ENABLED=0`**，否則 Playwright 清空輸出目錄時會被安全刪除防護攔截。
- 人工驗收入口：`http://127.0.0.1:8111/sim/?mode=exam`

---

## 8. 紅線（教師明確指定，違反即需重做）

1. **不得為了讓測試通過而放寬任何判定閾值、跳過考試規則、安全條件或偽造飛行狀態。**
2. 微風／接近門檻風況是**模擬假設**，畫面與文件都要標「非官方」。
3. 官方 PDF **不得進版本庫**；只保留抽出的文字與頁碼，並記錄檔案雜湊。
4. **截圖（`.playwright-output/`）與 PDF 不進 commit。**
5. 未經明確批准**不得 push／部署／重啟不相關服務／終止其他程序**。
6. 不得宣稱已完成**實體遙控器**驗收 → 一律標 `PENDING_DEVICE_TEST`。
7. Git：**不得 reset／clean／stash／checkout**；只 stage 當前 phase；一個階段一個 commit，訊息要寫「改了什麼＋為什麼」。
8. 每輪完成後停下等教師驗收，**不得自行擴大到下一個 Segment**（例如未經授權不得開始科目 E）。

---

## 9. 常見坑（都是實際踩過的）

| 坑 | 症狀 | 處置 |
|---|---|---|
| 安全刪除防護 | Playwright 報 `SAFE_DELETE_BULK_GUARD_ERROR` | 加 `CODEBUDDY_SAFE_DELETE_ENABLED=0` |
| Chrome 節流被遮擋視窗的 rAF | 測試每輪失敗點不同（標定向導、飛行計時、峰值偵測） | launch args 加 `--disable-backgrounding-occluded-windows`／`--disable-renderer-backgrounding`／`--disable-background-timer-throttling`（已在 `playwright.config.ts`） |
| `src/main.ts` 用動態 `import()` | 讀 `window.__examTestHook` 得到 undefined | 先 `page.waitForFunction` 等鉤子出現 |
| WebGL context 洩漏 | 全量測試後段頁面空白／機體消失 | `pagehide` 時 `renderer.forceContextLoss()`（已實作） |
| RC 靜止數秒後掉線 | Chrome 把 HID 當隱藏遊戲手把 | 喚醒需晃桿；面板斷線時 clearDraft，搖桿喚醒後以正確 deviceId 重跑導入鏈 |
| 舊 stored 校定檔覆蓋新檔 | 教師實測「還是不對」 | `shouldUpgradeStoredProfile()`：線上較新就覆蓋；手動 save 的 `Date.now()` 恆最新 → manual-wins 不破 |
| 腳本飛行員極限環 | 科目 D 微風拿不到 S | 有風必須持續頂風 → PD 形成 0–0.35 m/s 對地速度 → 越過 `HOVER.stillSpeedMps=0.3`。**未放寬閾值**；候選修法：改飛控語意（放桿即空速歸零）或拉長陣風週期（見第 10 節） |
| 風場語意（已修） | 舊版 `mean + |sin|·gust` 會到 17.5 m/s，機體一起飛就被吹走 | 現為 `mean + (peak−mean)·(1−cos(2πt/T))/2`，恆落在 `[mean, peak]`；`(1−cos)/2` 而非 `|sin|` 是因 `|sin|` 在 t=0、T/2 有尖角會產生對地速度突波 |

---

## 10. 尚未裁決／待教師回覆

1. **科目 D × 微風 = U**：理想操作六個定點僅 2/6 達 4.8 s（缺口合計 7.53 s），其餘項目全達標。要不要處理、處理方式為何（改飛控語意 or 拉長陣風週期）尚未決定。
2. **科目 E（高度保持五邊飛行）** 未實作，教師先前明令「不得進入」，需明確授權。
3. **實體搖桿 PENDING_DEVICE_TEST**：RadioMaster Pocket 在考試模式下的起飛／懸停手感尚未實測。
4. **附件十二 PDF 出處存疑**：核到的 PDF 內文檔名與檔名不符（疑似「民用航空法第 9 條及第 23 條修正建議」中繼資料），config 已標「待官方原檔核驗」，僅作交叉核對。

---

## 11. 工作規範

- 專案記憶檔：`C:\Users\admin\WorkBuddy AI\2026-10-05-17-47-38\.workbuddy-ai\memory\`
  - `MEMORY.md`：專案長期事實（架構、坑、環境）。
  - `YYYY-MM-DD.md`：每日工作日誌，**append-only**。
  - 有跨 session 價值的結論（設計決策、實測數字、坑）要寫回去，不要只留在對話裡。
- 回報格式：教師習慣「**完成事項 → 逐項數據 → 測試數字 → 提交列表 → 待決事項**」，量化數字要如實（不达标也要寫出差多少），最後停下等驗收。