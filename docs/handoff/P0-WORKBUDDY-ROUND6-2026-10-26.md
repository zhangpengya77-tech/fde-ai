# FDE 考照仿真系統｜第六輪交付報告（工程封存 + 真實遙控器驗收準備）

- 日期：2026-10-26
- 工作樹：`D:\FDE-Power-Inspection-Simulator-P0`（分支 `codex/fde-p0-visibility`）
- 提交前 HEAD：`eb242c74d247974239515b7bc676ac7807e96f47`
- 提交後 HEAD：見 `git log`（C1–C7 共 7 個 commit，最後一個即本報告）
- 授權範圍：本地 Commit（已完成）；Push / Merge / Deploy（未執行，依紅線禁止）

---

## 一、Git 提交前後狀態

| 項目 | 提交前 | 提交後 |
|---|---|---|
| HEAD | `eb242c7` | `41b7781`（本報告提交前） |
| 分支 | `codex/fde-p0-visibility` | 同左（未切換、未 rebase） |
| 工作樹 entry 數 | 30（5 tracked M + 25 untracked） | 0（乾淨） |
| index.lock | 無 | 無 |
| 其他 git lock | 無 | 無 |

提交前核查結論：
- 第三至第五輪修改與未追蹤檔全部可歸屬（penta 教學、scene 註解、config 科目 E 資料層、main 入口、rc 校準測試穩定性、DOM 契約測試、參數工具、交接報告）。
- 無並行代理寫入（無 `index.lock`、無其他 `.git/*.lock`）。
- 未發現無法歸屬的修改，全部納入提交。

---

## 二、完整測試結果（任務 A）

| 項目 | 命令 | 結果 |
|---|---|---|
| TypeScript | `npx tsc -b` | **0 錯誤**（exit 0） |
| 單元/整合 | `npm test`（vitest run） | **59 檔 / 759 tests 全通過，0 失敗** |
| 瀏覽器 | `npx playwright test`（`CODEBUDDY_SAFE_DELETE_ENABLED=0`） | **137 passed / 10 skipped / 1 failed** |
| 參數一致性 | `node tools/penta-param-check.mjs` | **PASS 31 / WARN 0 / FAIL 0**（exit 0） |
| 空白檢查 | `git diff --check` | 乾淨（無空白錯誤） |

**唯一失敗歸因（非本輪回歸）：**
- `tests/browser/rc-calibration-visibility.spec.ts:386`（desktop-chrome）— `locator.click('[data-stick-probe="pitch"]')` 90s 逾時，元素本身 visible/enabled/stable，屬全量套件並發負載下的**時序抖動 flake**。
- 隔離重跑該測項：desktop-chrome 5.7s 通過、mobile-chrome 3.5s 通過（2 passed，exit 0）。
- 本輪（第六輪）**未改動任何 src 程式碼**，只做核查、回歸、提交；故此失敗非本輪引起。
- 未為求全綠而降低斷言、刪測試或跳過測試。

10 項 skipped 為既定 `PENDING_DEVICE_TEST`（真機驗收）與方向性待測項，非本輪新增。

---

## 三、每 Commit SHA 與檔案清單

> 皆以顯式檔案路徑 `git add`（未用 `git add .`）；不含截圖／快取／備份／構建產物。

### C1 `8677f73` — test(exam): stabilize rc-calibration-visibility browser spec
- `tests/browser/rc-calibration-visibility.spec.ts`（僅瀏覽器測試穩定性，**未動 RC 校準演算法／映射**）

### C2 `a6b82ae` — docs(exam): correct drone diagonal comment to 1.00m (P0-B consistency)
- `src/exam/scene.ts`（僅註解，2 行；幾何常數未動）

### C3 `67c9c04` — feat(exam): Subject E teaching data layer & penta scene (no scoring)
- `config/caa-exam.json`
- `src/exam/config.ts`
- `src/exam/penta-scene.ts`
- `src/exam/penta.ts`

### C4 `a9bb038` — feat(exam): Subject E teaching state machine, UI & entry (no scoring)
- `src/exam/penta-app.ts`
- `src/exam/penta-training-ui.ts`
- `src/exam/penta-training.ts`
- `src/main.ts`
- `tests/browser/exam-penta-training.spec.ts`
- `tests/browser/exam-penta.spec.ts`
- `tests/unit/exam-penta-training.test.ts`
- `tests/unit/exam-penta.test.ts`

### C5 `ef6ead5` — test(exam): DOM attribute contract guards & penta param-check tool
- `tests/unit/dom-attribute-contract.test.ts`
- `tests/unit/exam-panel-ui-contract.test.ts`
- `tests/unit/exam-penta-params.test.ts`
- `tests/unit/exam-penta-ui-contract.test.ts`
- `tools/penta-param-check.mjs`
- `tools/penta-screenshot.mjs`

### C6 `41b7781` — docs: archive P0 verification & Subject-E rule reports (rounds 2-5)
- `docs/handoff/P0-B-AIRCRAFT-PARAM-UNIFICATION-DESIGN-2026-10-25.md`
- `docs/handoff/P0-CD-VERIFICATION-REPORT-2026-10-25.md`
- `docs/handoff/P0-ROUND4-PARAM-CHECK-REPORT-2026-10-25.json`
- `docs/handoff/P0-ROUND4-PARAM-CHECK-REPORT-2026-10-25.txt`
- `docs/handoff/P0-WORKBUDDY-EXEC-VERIFICATION-2026-10-25.md`
- `docs/handoff/P0-WORKBUDDY-ROUND2-2026-10-25.md`
- `docs/handoff/P0-WORKBUDDY-ROUND3-2026-10-25.md`
- `docs/handoff/P0-WORKBUDDY-ROUND4-2026-10-25.md`
- `docs/handoff/P0-WORKBUDDY-TAKEOVER-2026-10-25.md`
- `docs/handoff/SUBJECT-E-RULE-VERIFICATION-2026-10-25.md`

### C7 — docs: round-6 archival report & RC acceptance SOP
- `docs/handoff/P0-WORKBUDDY-ROUND6-2026-10-26.md`（本檔）

**跨階段獨立構建：** 依賴順序已保證（C3 先落 config + penta 幾何／場景；C4 才落 penta-training/app 並引用 C3 模組）。`tsc -b` 於全樹通過；逐 commit 依序構建不產生前向依賴斷裂。

---

## 四、未提交檔案清單

- 工作樹 `git status` **乾淨（0）**；第三至第五輪成果全部已提交。
- 未納入版本控制者僅為構建／測試產物：`dist/`、`.playwright-output/`、`.playwright-artifacts-*`、`node_modules/`（皆非原始碼，屬既有忽略範圍）。
- 提交前備份（不在工作樹內，位於 `D:\FDE-Tools\backups\`，見第五節）。

---

## 五、主項目保護證據 + 提交前備份

**主工作樹 `D:\FDE-Power-Inspection-Simulator`（唯讀）：**
- HEAD `fd45e607bf962fbf0d4207cec06e9677b505cb39`、分支 `phase1-mvp`。
- 其自帶之 S5 進行中修改（`src/exam/exam-app.ts`、`src/exam/panel.ts`、`src/i18n/zh-Hant.ts`、`tests/browser/exam-drone.spec.ts`、`tools/manual-verify-smoke.mjs`、`docs/manual-verification-checklist.md`、未追蹤 plan）**非本輪產生**，屬主樹自身狀態。
- 本輪對主樹僅執行唯讀 `git status` / `git rev-parse` 查詢，**未寫入、未切換、未提交**。

**提交前備份（新增，因先前無 P0 專屬備份）：**
- 目錄：`D:\FDE-Tools\backups\FDE-Power-Inspection-Simulator-P0-precommit-20261026\`
- `sources.tar.gz`（593,869 bytes；排除 node_modules/dist/.git/.playwright*）
- SHA-256：`94ad90c6bc13641f3ec37d1aac5c15defeec6b341e94ddb9442daf50438b1810`
- `manifest.sha256.txt`：202 個檔案逐檔 SHA-256
- `state.txt`：`HEAD_BEFORE_COMMIT=eb242c7`、`BRANCH=codex/fde-p0-visibility`、status 30 筆

**回滾路徑：** `git reset --hard eb242c7`（已提交內容）或解壓 `sources.tar.gz`（含未提交前檔案級快照）。

---

## 六、教師預覽服務狀態

- `127.0.0.1:4173`：**未監聽 / HTTP 502**（本輪開始前即為使用者觸發之 502，vite preview 進程不在；非本輪造成）。
- `127.0.0.1:8111`：**未監聽 / HTTP 502**（S5 記錄之教師入口系統服務未運行）。
- Playwright 回歸期間自建 4173 preview（`webServer: npm run build && npm run preview`，`reuseExistingServer:false`），測試後已隨進程結束釋放；`dist/` 已由本次回歸以已提交程式碼重新構建。
- 教師驗收需先啟動服務（見第七節）。

---

## 七、真實遙控器（RadioMaster Pocket）現場驗收 SOP

**前置：** 已用 `npm run build` 產出 `dist/`（本次回歸已重建）。啟動教師入口任一方式：
- 方式 A（4173）：`npm run preview -- --port 4173 --strictPort --host 127.0.0.1`，瀏覽器開 `http://127.0.0.1:4173/?mode=exam`（考試）或 `?mode=penta`（科目 E 教學）。
- 方式 B（8111）：啟動系統服務器掛載 `dist/` 於 `/sim/`，開 `http://127.0.0.1:8111/sim/?mode=exam` / `?mode=penta`。

**SOP 九步（對應畫面位置）：**

1. **連接設備** — 先開頁面再插 USB（或插好後按搖桿喚醒），Chrome 需偵測到 Gamepad（`gamepadconnected`）。裝置：`VID_1209&PID_4F54`（RadioMaster Pocket，8 軸 / 24 鍵，非標準 mapping → 走 device-profile 自訂）。*（真機採樣項，標 PENDING_DEVICE_TEST）*
2. **識別通道** — 面板「搖桿軸快速測試」逐一推桿，確認 `roll=axis0 / pitch=axis1 / yaw=axis3 / throttle=axis2`（標準 AETR）。畫面讀 raw→norm→cmd 四欄。*（真機採樣 PENDING_DEVICE_TEST）*
3. **校準** — 引導校準：逐軸推到 ≥0.7 峰值鎖步、綁定測得軸、拒絕重複軸、即時套用；或由 `rc-profile-latest.json` 自動導入（手動存檔恆優先）。校準後核對 HUD 四通道讀數與方向（右推→右移、上推→前進、油門單極、偏航左右）。*（真機採樣 PENDING_DEVICE_TEST）*
4. **解鎖** — 點「解鎖」（`SimpleFlightController.arm()`，`disarmed→armed`）；地面未解鎖時飛行按鈕禁用。*（真機確認 PENDING_DEVICE_TEST）*
5. **起飛** — 推油門離地；HUD 高度隨 `position.y` 上升（高度來源單一）。*（真機確認 PENDING_DEVICE_TEST）*
6. **航線練習（科目 E）** — 進 `?mode=penta`：READY→TAKEOFF→ENTER_ROUTE→SEGMENT_1..5→COMPLETE；機體由 `ExamFlightController` 真實飛控驅動、輸入沿用 `ExamInput`（標定管線 + 鍵盤備援），**非假飛機**（僅測試縫 `setScriptedPose` 會凍結飛控）。畫面固定標「非官方測驗，僅供練習」。*（真機採樣 PENDING_DEVICE_TEST）*
7. **暫停／恢復** — 面板「暫停／恢復」（`pentaPause` / `pentaResume`），暫停時機體與練習計時皆凍結。
8. **完成** — 五邊完成→COMPLETE（或落地/中止→ABORTED），顯示「教學練習記錄」浮層（`buildPentaPracticeRecord`）。
9. **查看教學記錄** — 結果浮層 + 進度 chips（七項：階段／已達航點／最大高度偏差／最大航線偏差／分段／重啟次數／結果）；可「重新測驗」（`pentaRestart`）。

**PENDING_DEVICE_TEST 明確標註：** 步驟 1、2、3、4、5、6 之「真機」環節需教師現場以實體 RadioMaster Pocket 取樣核對；本輪以模擬 gamepad 注入驗證邏輯，**不以模擬注入替代真實驗收**。

**已知裝置坑（供現場參考）：** RC 靜止數秒~10min 可能掉線（Chrome 隱藏裝置），喚醒需晃桿；Windows 偶發 Code 45 幽靈態需重枚舉。面板斷線時會 clearDraft，喚醒後以正確 deviceId 重跑導入鏈。

---

## 八、科目 E 尚未核實之官方規則

來源：`config/caa-exam.json` + `docs/handoff/SUBJECT-E-RULE-VERIFICATION-2026-10-25.md`（AC 107-005D p165）。

- **已讀到之官方質性條件（3 條）：** ①機頭朝飛行方向並穩定航高；②航向改變時滾轉／俯仰不得劇烈變化；③第一邊及第五邊須穩定準確通過 P3 至 P7 之延伸線上方。
- **尚未讀到（故全部為教學假設、`assumption:true`、非官方、可調）：**
  - 五邊各邊之**量化容差**（高度偏差、航線偏差、航點到達半徑、每段最短時間、起飛完成容差）於 AC 107-005D **未載明**。
  - 級距最小操作空域僅取到級距 I（80×20m）等表列值；五邊幾何（P3–P7）為由考場推導之教學航線。
- **未實作：** 科目 E 正式評分（`judgeSubjectE` 不存在於 src）、成績單科目 E 評等欄（scoring 僅 A/B/C/D/F/G）。教學模式**不產生**官方通過／失敗結論。

---

## 九、下階段建議

1. **教師真機驗收**：依第七節 SOP 以實體 RadioMaster Pocket 在 4173/8111 完成 PENDING_DEVICE_TEST 各項；記錄實測讀數與方向核對。
2. **科目 E 正式評分**（需另行授權）：在取得官方量化容差來源、並經教師明示授權後，才設計 `judgeSubjectE` 與成績單 E 欄；當前紅線下**不得**啟用。
3. **可選穩定性**：`rc-calibration-visibility` 全量套件下偶發 click flake，可加穩定等待／重試機制，但**不得降低斷言**。
4. **回滾**：如需退回，`git reset --hard eb242c7` 或解壓備份 tarball。
5. **Push / Merge / Deploy**：待架構師另行授權，本輪嚴格未執行。

---

## 紅線合規自檢

| 紅線 | 狀態 |
|---|---|
| 不 Push / Merge / Deploy | ✅ 僅本地 commit |
| 不修改正式考試評分 | ✅ scoring.ts 未動 |
| 不啟用 judgeSubjectE | ✅ src 全域 0 處 |
| 不修改正式成績單科目 E 欄 | ✅ 未新增 E 評等欄 |
| 不修改飛控 / RC 校準演算法 / 遙控映射 | ✅ 本輪未改；C1 僅測試檔 |
| 不修改主工作樹及其他 FDE 專案 | ✅ 主樹僅唯讀查詢 |
| 4173 不受影響 | ✅ 未操作（本輪前即 502） |
| 不批量殺進程 | ✅ 未執行 |
