# P0 階段性成果封存 — WorkBuddy 執行驗證報告

- 日期：2026-10-25
- 操作工作樹：`D:\FDE-Power-Inspection-Simulator-P0`
- 分支：`codex/fde-p0-visibility`
- 性質：依封存指令執行核查／驗證；本輪未新建 commit、未 push、未啟動正式服務。

---

## 任務一：提交前核查

| 項目 | 實測 | 結果 |
|---|---|---|
| `git branch --show-current` | `codex/fde-p0-visibility` | ✅ |
| `git rev-parse HEAD` | `eb242c74d247974239515b7bc676ac7807e96f47` | ✅ |
| `git status --short` | 僅 1 個 `??`：`docs/handoff/P0-CD-VERIFICATION-REPORT-2026-10-25.md`；無 `M` 檔 | ✅ |
| 六個 P0 修改檔 | 已於 `eb242c7` 提交（非工作樹未提交差異） | ⚠️ 見備註 |
| 主工作樹 `D:\FDE-Power-Inspection-Simulator`（phase1-mvp） | HEAD `fd45e60` 不變；6 `M` + 1 `??` 未變 | ✅ 未觸碰 |
| `git diff --check`（工作樹 vs index、vs HEAD） | 無空白錯誤（exit 0） | ✅ |
| 並發程序 | 無 `.git/index.lock`，無並發 git 操作 | ✅ |

> 備註：封存指令前提為「P0 工作樹有 6 個未提交修改檔」，但實測該 6 檔已於 `eb242c7` 提交、工作樹乾淨。此與指令前提不符，已於報告末「待裁決／回報」列明。

---

## 任務二：測試結果封存（與交接報告一致，實際數值）

| 指令 | 結果 | 封存標記 |
|---|---|---|
| TypeScript（`npx tsc -b`） | PASS（0 錯誤） | ✅ |
| Vitest（`npx vitest run`） | **665 PASS / 53 files** | ✅ |
| Playwright（`npm run test:browser`，完整） | **118 PASS / 9 SKIPPED / 1 FAILED** | ⚠️ 非全綠 |
| RC 校準單獨重跑（mobile-chrome 隔離） | PASS（約 4.3s） | ✅ |

- **未將完整 Playwright 標示為全綠**：118/9/1，其中 1 FAILED 為既有 flaky。
- **待追蹤問題（本輪未改 RC 校準程式）**：`tests/browser/rc-calibration-visibility.spec.ts:456`（mobile-chrome）引導錄製峰值取樣（`SUGGESTION_MIN_PEAK=0.7`）在完整套件負載下偶發失敗；隔離重跑即通過，判定為時序 flake，非本輪 P0 改動造成。`src/ui/recording-suggestion.ts`、`src/ui/controller-calibration.ts` 對 HEAD 未變。

---

## 任務三：本地 Commit

- **發現**：目標 commit 已存在。
  - SHA：`eb242c74d247974239515b7bc676ac7807e96f47`（`eb242c7`）
  - 分支：`codex/fde-p0-visibility`（**LOCAL ONLY，未 push**）
  - Message：`feat(exam): improve camera visibility, controls and field visuals`
- **提交檔案（6 個，+400 / −30）**：

  ```
  src/exam/exam-app.ts             | 160 ++++++
  src/exam/panel.ts                |  10 +-
  src/exam/scene.ts                | 127 ++++++
  src/i18n/zh-Hant.ts              |   1 +
  tests/browser/exam-drone.spec.ts | 75 +++++
  tests/unit/exam-scene.test.ts    | 57 +++++
  ```

- **工作樹狀態**：6 個程式碼／測試檔已提交；其餘無變更；僅 1 個 untracked 交接報告。
- **決策**：**本輪未新建 commit**。理由：工作樹無可提交之差異（6 檔已於 `eb242c7` 提交），新建 commit 將為重複／空 commit；且交接報告依 Task 3 規則（含本機絕對路徑與測試產物路徑）保留為 untracked。如需補做或調整 commit，請於下一階段明確指示。
- 全程未使用 `git add .` 或 `git add -A`。

---

## 任務四：教師驗收準備

### 本機考試畫面 URL（啟動後）
- `http://localhost:4173`
- `http://127.0.0.1:4173`（Playwright `baseURL` 同此）

### P0 隔離啟動指令（須在 P0 工作樹目錄執行）
- **驗收推薦（與 Playwright 測試版本一致）**：
  ```
  cd D:\FDE-Power-Inspection-Simulator-P0
  npm run build && npm run preview -- --port 4173 --strictPort --host 127.0.0.1
  ```
- **開發預覽（含 HMR，較輕量）**：
  ```
  cd D:\FDE-Power-Inspection-Simulator-P0
  npm run dev
  ```
- 考試模式於應用內選擇（選模式 → 選科目），非 URL 參數；未擅自啟動或重啟正式服務。

### 五張實際截圖路徑 — ⚠️ 缺口
交接報告聲稱位於 `D:\FDE-Power-Inspection-Simulator-P0\.playwright-output\exam-shots\` 的 5 張截圖：
`1280x720-before.png`、`1920x1080-follow.png`、`1920x1080-overview.png`、`1920x1080-flying.png`、`390x844-mobile-examinee.png`
**經查該目錄不存在，P0 樹內亦無任何 png/jpg/webp 檔**（`.playwright-output` 僅含 `.last-run.json`）。
→ 無法提供實際截圖路徑。建議由教師以上述啟動指令開啟後，手動擷取或以 `tools/manual-verify-smoke.mjs` 重新產出。

### 尚未驗收功能清單
- P0-B 機體尺寸變更（不在本輪範圍）
- 科目 E（高度保持五邊）（本輪禁止開始）
- 實體搖桿 `PENDING_DEVICE_TEST`（未測）
- RC 校準 mobile-chrome flake（待追蹤，本輪未修）
- 效能數據未量測（draw calls／FPS 未提供）

---

## 紅線遵守
- 未 push / merge / deploy ✅
- 未修改主工作樹 ✅
- 未修改 RC 校準程式 ✅
- 未修改 P0-B 機體尺寸 ✅
- 未開始科目 E 開發 ✅
- 未啟動／重啟正式服務（僅提供指令，未執行）✅

## 待下一階段裁決／回報事項
1. **六個 P0 修改檔已於 `eb242c7` 提交**；本輪無新建 commit（避免重複）。是否需補做／調整？
2. **五張截圖缺失**：需教師／下一階段實際擷取，方能補齊驗收影像證據。
3. 主工作樹 6 修改 + 1 untracked 為既有外部狀態，本輪保持不變。

> 停止條件回報：本輪發現 (a) P0 六檔已提交（非指令假設的「未提交修改」）、(b) 交接報告聲稱之五張截圖實際不存在。二者均未違反紅線，但與封存指令前提不符，故如實回報並停止，等待下一階段批准。
