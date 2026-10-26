# FDE 考照仿真系統｜架構師第三輪交付報告（科目 E 第一階段）

- 日期：2026-10-25（UTC 04:24–05:15）
- 工作樹：`D:\FDE-Power-Inspection-Simulator-P0`（分支 `codex/fde-p0-visibility`）
- HEAD：`eb242c7`（**未動**；本輪無 Commit／Push／Merge／Deploy）
- 主工作樹：`D:\FDE-Power-Inspection-Simulator`（`phase1-mvp`／`fd45e60`）全程唯讀

---

## 一、Git 狀態及開發前基線備份

### 1.1 開發前基線備份

`D:\FDE-REA-Review\backups\P0-BASELINE-20261025-041229\`（11 MB，未覆蓋舊備份 093943）：

| 內容 | 說明 |
|---|---|
| `p0-repo.bundle` | `git bundle create --all` 完整歷史 |
| `worktree/` | 源碼樹快照（排除 node_modules/dist/.git，含當時 1 M + 4 untracked） |
| `rc-fix-evidence/` | RC 修復 diff、worktree-vs-HEAD stat、關鍵檔 SHA-256、README |
| `MANIFEST.txt` | 340 行：git 狀態/log + 全部 src/config/tests 檔 SHA-256 + 備份自身雙層 SHA-256 |

### 1.2 本輪結束時 Git 狀態

```
 M src/exam/config.ts                                  （+68：科目 E 數據層）
 M src/main.ts                                         （+8：?mode=penta 路由）
 M tests/browser/rc-calibration-visibility.spec.ts     （測試同步，見第二節）
?? src/exam/penta.ts / penta-scene.ts / penta-app.ts   （科目 E 第一階段新模組）
?? tests/unit/exam-penta.test.ts / tests/browser/exam-penta.spec.ts
?? tools/penta-screenshot.mjs
?? docs/handoff/P0-B-AIRCRAFT-PARAM-UNIFICATION-DESIGN-2026-10-25.md
?? docs/handoff/SUBJECT-E-RULE-VERIFICATION-2026-10-25.md
?? docs/handoff/P0-WORKBUDDY-ROUND2-2026-10-25.md（既有）
?? docs/handoff/P0-WORKBUDDY-TAKEOVER-2026-10-25.md（既有）
?? docs/handoff/P0-CD-VERIFICATION-REPORT-2026-10-25.md（既有）
?? docs/handoff/P0-WORKBUDDY-EXEC-VERIFICATION-2026-10-25.md（既有）
```

- `git diff --check`：乾淨（無空白錯誤）。
- 臨時 `playwright.reuse.config.ts` 已刪除；基底 `playwright.config.ts` 未改。
- **未 commit／push／merge／deploy**，等待架構師審查。

---

## 二、RC 測試修復封存證據（任務 A）

| 核查項 | 結果 |
|---|---|
| Git 狀態 | `eb242c7`；唯一 M 為 `tests/browser/rc-calibration-visibility.spec.ts` |
| 修復範圍 | **僅測試同步機制**：① 刪除 setTimeout 覆寫（≥9000ms→1800ms 壓縮 hack），改用既有正式接縫 `window.__fdeRecordingDurationMs=8000`；② 推桿排程由 Node 端 4× evaluate+waitForTimeout 改為瀏覽器端單次 evaluate（錨點：錄製狀態含「畫圈」+ MutationObserver 保險 + 400ms 靜止引導 + 4×1500ms=6400ms<8000ms 窗口）；③ 斷言原文未動，timeout 8s→15s |
| 0.7 閾值 | `SUGGESTION_MIN_PEAK = 0.7`（`src/ui/recording-suggestion.ts:20`）**原值未變** |
| 生產算法 | `src/ui/controller-calibration.ts`、`recording-suggestion.ts`、`raw-axis-recorder.ts` 與 HEAD **零差異**（`git diff --quiet` 實測） |
| 接縫性質 | `recordingDurationMs()`（controller-calibration.ts:1041-1048）生產預設 `RECORDING_DURATION_MS=10_000`（raw-axis-recorder.ts:50），僅測試全局覆寫 |
| 20/20 定向 | Round 2 實測封存（乾淨 repeat 10/10 + 壓力 repeat 10/10），報告第五節 |
| 119/9/0 全量 | Round 2 實測封存；本輪在此基礎上復現並擴大（見第七節） |

**本輪新增的 RC 測試同步修復**（全量回歸中復發的 flake，非 Round 2 已修項）：
- 失敗點：`rc-calibration-visibility.spec.ts:310`（guided calibration 第 3 步 yaw 檢測，mobile-chrome × 全量負載）。
- 根因：`guidedStart()` 的 off-center 守衛（controller-calibration.ts:745-752）以 `lastRaw` 為基準；`restoreAllAxes`（Node evaluate）與 `click start` 之間採樣尚未收斂時，arm 被拒→detection 恆空。
- 修復（僅測試檔）：新增 `waitSticksAtRest()`——以畫面原始值 `[data-channel-raw]`（不經校準）為錨點，等 4 軸回到靜止值（0.015/0.000/-1.000/-0.006）再按開始。**未動 `GUIDED_MIN_PEAK=0.7`、未動任何產品斷言/算法、未跳過/刪除測試**。
- 驗證：定向（guided 相關 + penta renders）44/44 → 全量 123/9/0。

---

## 三、P0-B 機體參數一致性設計（任務 B，只設計未修改）

完整設計：`docs/handoff/P0-B-AIRCRAFT-PARAM-UNIFICATION-DESIGN-2026-10-25.md`。要點：

**現狀（調查結論）**
- `diagonalSpanCm`（官方：附件十二級別 I 對角馬達軸心 90–110cm，PDF p35／印刷頁33）定義於**兩份** config、`src/` **零引用**；視覺 1.00m 為 `scene.ts:198` 硬編碼（馬達半徑 0.5×2）。
- 飛控 8 參數**不含軸距**（軸距是規格/視覺屬性，與動力學正交）；`massKg` 僅 config→型別傳遞，飛控未使用（傾角-加速度比例模型）。
- `caa-exam.json .aircraft`（含 sampleAircraftDefaults）**整段無讀取端**；`exam-aircraft.json .sampleAircraft` 為實際生效源（含 5 個模擬假設值，caa 側為 null）——雙源無消歧規則。
- 註釋瑕疵：`scene.ts:148/372` 寫「馬達對角約 1.1m」與實際 1.00m 不符。

**單一參數來源方案（三層權威）**
- L0 官方規範數值 → `caa-exam.json` 唯一權威；L1 附件十二樣機規格（4kg/100cm）→ 激活 `caa-exam.json .aircraft` 讀取；L2 模擬假設（飛控動力學）→ `exam-aircraft.json` 明標非官方。
- 讀取鏈：diagonalSpanCm 取 caa → exam-aircraft → 100 兜底（warn）；原廠規格填入 caa 時自動優先（消歧路徑）。
- 型別：`ExamAircraftParams` 增 `diagonalSpanCm`/`diagonalSpanRangeCm`；`createExamQuad(track, motorRadiusM?)` 參數化（缺省 0.5=現值，不破壞現有行為）。
- 防不一致：單一換算函式 `motorRadiusFromDiagonalSpanCm`（90→0.45/100→0.5/110→0.55）+ 單測 + 啟動一致性檢查（偏差>1cm 警示）+ 註釋修正 + UI 範圍校驗預留。
- **1.00m 對角馬達距、90–110cm 官方區間、4kg 假設均維持不變。**

**待裁決 4 項**：caa 優先鏈是否批准；原廠規格時程；級別 II/III 軸距是否另核；附件十二官方原檔替代取得途徑（現有連結 404，鏡像僅交叉核對）。

---

## 四、科目 E 官方規則對應表（任務 C）

完整核查：`docs/handoff/SUBJECT-E-RULE-VERIFICATION-2026-10-25.md`。摘要：

| # | 項目 | 狀態 | 依據 |
|---|---|---|---|
| 1 | CAA 規範及附件版本 | `官方已核實`（原檔待補） | AC 107-005D；附件十二（109.3.31 施行）；鏡像 PDF SHA-256 `7b4e8f61…b589fd3` 已核，官方原檔連結 404 |
| 2 | 考試類別 | `官方已核實` | 專業操作證基本級（多旋翼）；級距 I 未達25公斤 ≥4kg |
| 3 | 操作區域尺寸 | `官方已核實` | I 80×20／II 120×30／III 160×40（p165）。**注意與 B/C 場地 80×30 語意不同** |
| 4 | 目標飛行高度 | `官方已核實` | 20m（p165） |
| 5 | 五邊航線及轉彎要求 | 質性 `官方已核實`／幾何 `尚未核實` | 三條件原文（p165）；P3(-6,-22)–P7(6,-22) 延伸線由場幾何導出；各邊位置/方向/轉彎半徑/起降方向未錄入 |
| 6 | 起飛/進入/結束/降落條件 | `尚未核實` | config 無欄位；不進入第一階段任何判定 |
| 7 | 評分與失敗判定 | 框架 `官方已核實`／細項 `尚未核實` | S/U/N（附錄5 p220）+ 重大違失否決；級距量化容差 null（未讀到） |
| 8 | config 數值證據來源 | `官方已核實` | `caa-exam.json` subjects.E_altitude_hold_five_sided（page 165）+ `exam-aircraft.json` levels[].pentaAirspaceM |

**紅線遵守**：無法核實者未標示官方、未進入正式評分；成績單第 4 項（高度保持五邊飛行）維持 `rating: null, note: '本模擬未涵蓋', simulated: false` 事實狀態（scoring.ts 未改）。

---

## 五、新增文件與功能（任務 D）

| 檔案 | 功能 |
|---|---|
| `src/exam/penta.ts` | 五邊幾何純函式：`p3ToP7ExtensionLine`（延伸線）、`distanceToExtensionLineM`、`pentaAirspaceForLevel`、`buildTeachingPentaRoute`（教學假設矩形五邊：5 航路點、進入段+五邊、leg 與延伸線關係 along/crossing/touch-end/none）、`pentaFlightOrder`。**恆標 `assumption: true`** |
| `src/exam/penta-scene.ts` | 獨立 Three.js 場景：`PentaRouteLine`（航線）、`PentaExtensionLine`（P3–P7 延伸線@20m）、`PentaAirspaceBox`（級距空域 80×20）、`PentaAltitudeReference`（20m 參考面）、`PentaDrone`（簡易教學機，對角 1.00m）、`setDronePose`/`dispose`。**不含任何評分物件**（單測斷言無 score/judge/rating/pass/fail 命名） |
| `src/exam/penta-app.ts` | `?mode=penta` 教學預覽：HUD（官方三條件+教學假設標示+操作說明）、免責橫幅、配置徽章、播放/暫停演示（機體沿航線巡遊）、拖曳環繞+滾輪縮放+R 重置 |
| `src/exam/config.ts` | `SubjectEDef` 型別、`subjects.E` 規範化映射、`validateSubjectEConfig()`（criteria/空域/高度/page 合法性；page=null 不視為錯誤） |
| `src/main.ts` | `?mode=penta` 路由分支（既有 exam/巡檢路由不變） |
| `tests/unit/exam-penta.test.ts` | 26 項（數據層 6 + 驗證 7 + 幾何 6 + 場景 5 + 成績單事實狀態 2） |
| `tests/browser/exam-penta.spec.ts` | 冒煙 2 項（掛載/免責/無評分 UI；framebuffer 非背景像素 ≥1%） |
| `tools/penta-screenshot.mjs` | 截圖固化腳本 |

**隔離性核對**：A–D/F/G 科目判定、飛控、RC 映射、P0-A/C/D 既有功能零改動；科目 E **不接評分**（無 judgeSubjectE、buildExamReport 未擴展、SUBJECT_KEYS 未加 E 按鈕）；未核實幾何全部標「教學假設」。

---

## 六、RED → GREEN 測試結果

| 階段 | 結果 |
|---|---|
| RED | `exam-penta.test.ts` 首次運行：`Cannot find module '../../src/exam/penta'`（模組未實現） |
| 實現後 | 26/26 通過（期間修正一處幾何規則：第五邊「一端在線上且沿線方向有位移」判 crossing，使第一/五邊 crossesExtension=true、中間三邊=false） |
| 冒煙 RED | framebuffer 中心區域顏色數 2–3（依賴演示時序的脆弱設計）→ 改為全畫面非背景像素比例（≥1%）後 2/2 通過 |

---

## 七、完整回歸結果

| 項目 | 結果 |
|---|---|
| `tsc -b` | **0 錯誤** |
| Vitest 全量 | **691 passed / 0 failed**（54 檔；Round 2 基線 665 + 新增 26） |
| Playwright 全量（desktop-chrome + mobile-chrome，14 spec） | **123 passed / 9 skipped / 0 failed**（11.9m） |
| 對比 | Round 2 封存 119/9/0 → 第一輪復跑 120/9/3（2 項新測試設計脆弱 + 1 項 RC guided flake 復發）→ 修復測試同步後 **123/9/0** |
| `git diff --check` | 乾淨 |
| 教師預覽服務 | 4173（PID 11968）全程未重啟；`?mode=exam` 與 `?mode=penta` 均 HTTP 200 |

**回歸方法說明**：全量 Playwright 經臨時 `playwright.reuse.config.ts`（webServer undefined 復用 4173，其餘與基底一致）執行後刪除；基底配置未改。測試期間未修改 src（無 HMR 干擾）。**未按进程名批量結束任何進程**。

---

## 八、實際場景截圖（固化於 D 盤）

`D:\FDE-REA-Review\evidence\P0-ROUND3-SUBJECT-E-2026-10-25\`：

| 檔案 | 內容 |
|---|---|
| `penta-preview-default.png`（42 KB） | 五邊教學預覽：頂部標題+紅色免責+配置徽章、左側官方三條件/教學假設面板、3D 場景（航路點、藍色航線、金黃色 P3–P7 延伸線、綠色空域、20m 參考面、演示機體） |
| `penta-preview-orbit.png`（60 KB） | 拖曳環繞後視角 |
| `exam-mode-regression.png`（64 KB） | 既有考試模式迴歸對照（?mode=exam 正常） |

三張截圖 pageerror 均為 0。

---

## 九、主工作樹保護證據

| 項目 | 狀態 |
|---|---|
| 主工作樹 `D:\FDE-Power-Inspection-Simulator` | `phase1-mvp`／`fd45e60`，**未執行任何寫入/切換/清理**（本輪所有 git 操作均在 P0 工作樹） |
| 8111／8013 服務 | 無監聽、未觸碰 |
| 4173 預覽服務 | PID 11968 沿用未重殺（Round 2 誤殺事件後嚴禁按进程名批量結束，本輪遵守） |
| RC 校準/映射/標定檔 | 零改動（第二節 SHA-256 與 diff 證據） |
| P0-B 機體尺寸 | 1.00m 對角/90–110cm 官方區間/4kg 假設未動（scene.ts 未改） |

---

## 十、下一階段建議（待架構師批准）

1. **科目 E 第二階段（狀態機/航線判定/評分）**：**須另行批准**。前置條件：官方五邊幾何（各邊位置/方向/轉彎）與起降條件核實——本輪標記為 `尚未核實`，建議架構師提供 AC 107-005D p165 附圖或官方原文；在核實前不建議進入評分實作。
2. **P0-B 立項**：批准第三節設計（caa 優先讀取鏈 + createExamQuad 參數化 + 一致性檢查）後實作；同步裁決 4 項待決事項。
3. **原廠規格取得**：maxTilt/maxSpeed/accel/drag 填入 caa-exam.json 後，自動消歧路徑即生效（無需改碼）。
4. **提交策略**：本輪 3 M + 7 新檔尚未 commit；建議按「科目 E 第一階段」單一主題提交（測試修復可合併或分立，由架構師決定）。
5. **性能基線**：Draw calls／三角面數／FPS 仍未量測（不得杜撰），建議列入後續輪次。

---

## 結語

本輪完成：RC 修復封存核查（證據鏈完整）、開發前基線備份（SHA-256 雙層）、P0-B 單一參數來源設計（只讀）、科目 E 八項規則三態核查、科目 E 第一階段實現（數據層+合法性驗證+獨立五邊可視化+教學預覽入口）、兩輪全量迴歸（最終 123/9/0 全綠）與截圖固化。全程未 commit／push／merge／deploy，未改動既有科目、飛控、RC 映射與 P0-B 機體尺寸，成績單「科目 E 未涵蓋」狀態保持不變。**現停止並等待架構師審查。**
