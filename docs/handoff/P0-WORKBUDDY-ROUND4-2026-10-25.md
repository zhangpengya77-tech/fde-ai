# P0 第四轮交付报告（科目 E 教学反馈界面 C1–C3 + 任务 D 参数核对）

- 日期：2026-10-25
- 工作树：`D:\FDE-Power-Inspection-Simulator-P0`（分支 `codex/fde-p0-visibility`）
- HEAD：`eb242c7`（**本轮未做任何 Commit/Push/Merge/Deploy，HEAD 不变**）
- 预览服务：4173（PID 11968，vite preview 服务 P0 dist）全程未受影响
- 主工作树 `D:\FDE-Power-Inspection-Simulator`：唯读，未触碰

---

## 一、断点恢复核查（架构师指令第二节，7 项全过）

| # | 检查项 | 结果 |
|---|---|---|
| 1 | Git 分支/HEAD/差异与压缩前一致 | ✅ `codex/fde-p0-visibility` @ `eb242c7`；4 个已追踪档案为修改未暂存（第三轮遗留，未提交） |
| 2 | 备份完整 | ✅ D 槽基线备份 MANIFEST 199 文件完好 |
| 3 | `penta-training.ts` 逻辑完好 | ✅ 558→560 行、30 个导出齐全（仅修 1 处 null 窄化类型错） |
| 4 | `penta-scene.ts` `setTrainingView` 完整 | ✅ 301 行，覆叠物件（segLines/reachedMeshes/devLine）与高亮逻辑完好 |
| 5 | `penta-app.ts` 仍为修改前版本（失败的 Write 未截断） | ✅ 267 行 mtime 12:37 未动、无训练代码残留；确认失败写入未造成档案损坏 |
| 6 | 无并行代理 | ✅ 无其他代理在写该工作树 |
| 7 | 4173 服务 | ✅ 双端点 200，测试期间持续运行 |

**结论**：从 C2 断点继续安全，无需重做任务 A/B。

---

## 二、模块拆分结果（架构师第一节裁决）

按裁决的四模块拆分执行，未一次性重写任何大文件：

| 模块 | 行数 | 职责 | 状态 |
|---|---|---|---|
| `src/exam/penta-training.ts` | 560 | 教学状态机、航线/高度检测、练习记录（纯函数，无 DOM/Three） | 第三轮任务 A/B 完成，本轮仅修 1 处类型错 |
| `src/exam/penta-scene.ts` | 301 | Three.js 训练场景与可视化覆叠 | 第三轮完成 |
| `src/exam/penta-training-ui.ts` | 301 | **本轮新增（C1）**：HUD/训练按钮/状态提示/结果面板。不 import 任何飞控或评分模块；判定数据全部来自 `penta-training.ts` | 完成 |
| `src/exam/penta-app.ts` | 536 | **本轮最小修改（C2）**：在既有 267 行基础上增加 UI 初始化、状态机初始化、位置数据接线、状态/UI/覆叠更新、重置与暂停恢复事件、只读测试 Hook；未重写既有 Three.js 初始化/相机/渲染器/主循环 | 完成 |

`penta-app.ts` 的 8 项接线全部落实：UI 初始化、状态机初始化、位置数据（`updateTraining(dt)` 每帧驱动物位→`detectPentaPosition`）、状态/UI/覆叠更新、重置（restart）、暂停恢复（pause/resume）、`window.__pentaTestHook` 只读测试接口、dispose 清理。

---

## 三、修改／新增文件清单

**新增（未追踪，遵指示不 commit）**：

| 文件 | 行数 | 说明 |
|---|---|---|
| `src/exam/penta-training.ts` | 560 | 任务 A/B（状态机+检测，本轮修 1 处类型错） |
| `src/exam/penta-training-ui.ts` | 301 | 任务 C1 独立 UI 模块 |
| `src/exam/penta-app.ts` | 536 | 第三轮建立、本轮 C2 接线（267→536） |
| `src/exam/penta.ts` / `penta-scene.ts` | 210 / 301 | 第三轮（航线数据/场景） |
| `tests/unit/exam-penta-training.test.ts` | 483 | 状态机/检测单测 |
| `tests/unit/exam-penta-ui-contract.test.ts` | 62 | **本轮新增**：DOM 属性契约回归测试（4 项） |
| `tests/unit/exam-penta.test.ts` / `exam-penta-params.test.ts` | — | 第三轮参数一致性单测（11 项，本轮改造为类型安全） |
| `tests/browser/exam-penta-training.spec.ts` | 480 | **本轮新增**：浏览器专项（8 用例 × 桌面/手机） |
| `tools/penta-param-check.mjs` | 299 | **任务 D**：只读参数一致性检查工具 |
| `docs/handoff/P0-ROUND4-PARAM-CHECK-REPORT-2026-10-25.txt/.json` | — | 任务 D 实跑报告（人类可读 + 机器可读） |
| 其他第三轮文档/工具 | — | `P0-CD-VERIFICATION-REPORT` 等交接文件 |

**已追踪档案的修改（均为第三轮/本轮既有工作，未暂存未提交）**：`config/caa-exam.json`、`src/exam/config.ts`、`src/main.ts`、`tests/browser/rc-calibration-visibility.spec.ts`。`git diff --check` 通过（无 whitespace 错误）。

**dist 已重建**：`penta-app-ClVuc_rt.js`（28.7 kB），4173 根路径验证提供新 chunk（HTTP 200、text/javascript、含修复字面量）。

---

## 四、状态机实际运行证据（任务 C3，全部实测非推断）

浏览器专项 16 个运行（8 用例 × 桌面/手机）：**15 passed / 1 skipped（47.2s）**。手机端「真实键盘飞行」按设计 skip（spec 内注明理由：键盘飞行用例仅 desktop-chrome）。

| C3 要求 | 证据 |
|---|---|
| READY→TAKEOFF→ENTER_ROUTE→SEGMENT_1~5→COMPLETE | 用例 3：脚本位姿真实按钮 begin→TAKEOFF，依序走 W0→W1→W2→W3→W4→W1→W0；断言 5 段 legIndex 全 reached、labels 五邊、reachedWaypoints=[1,2,3,4,0]、transitions=[begin,enter,segment×5,complete] |
| PAUSED/RESUMED | 用例 4：chip「（已暫停）」+ data-paused=true；暂停中到位姿不推进（防作弊）、恢复即推进 |
| RESTARTED | 用例 5：clearPose 后点击重新開始→READY、restartCount=1、记录清空、transitions=['restart']、演示恢复、可再次 begin |
| ABORTED | 用例 6：data-result-state=aborted、浮层含中止原因、关闭后可 restart |
| 高度偏差／偏离提示 | 用例 7：进入段中点无提示；(-5,23,-11)→「高度偏差 +3.0 m」+琥珀色 chip `rgb(90,67,24)`；(0,20,-8)→「偏離教學航線 3.3 m」+琥珀色；maxAltitudeDeviationM≥3、maxRouteDeviationM>2 |
| 练习记录 | 用例 3 末：浮层「教學練習記錄（非官方成績）」、五航段表（时长/最大偏差/到達状态）、无评等 |
| **浏览器实际飞机位置数据驱动状态变化** | 双重证明：①用例 3 以 `window.__pentaTestHook.setScriptedPose` 写入位姿→状态机按真实位姿推进（非直接调状态函数）；②用例 8 **真实键盘飞行**（无脚本位姿）：真实起飞→ENTER_ROUTE（超时 30s 内完成）、`getFlight()` y∈(19.4,20.6) 且 state='flying'、keyboard 'w' 1.2s 后 z<-0.5 且不掉高 |

### 本轮发现并修复的关键缺陷（必须报告）

**症状**：浏览器专项首跑 16 个运行**全部失败**（桌面脚本闭环 begin 按钮 90s 超时；初始挂载 chips 断言通过但 `[data-penta-training-begin]` 找不到元素）。

**根因**：`penta-training-ui.ts` 按钮 dataset 以 `dataset[\`pentaTraining${action}\`]` 拼接，`action` 为小写 `'begin'` 时产生属性 `data-penta-trainingbegin`（camelCase→kebab 转换缺连字符），与测试契约 `data-penta-training-begin` 不符。chips 的 key 首字母大写故正确（chips 断言确实通过）。单元测试只覆盖纯逻辑，未覆盖 DOM 属性，缺陷漏网。

**修复**（小范围编辑，未动飞控/评分/状态机）：
1. 按钮与 chip 的 dataset 键改为**类型化映射表**（`BTN_ATTR: Record<PentaTrainingUIAction, string>`、`CHIP_ATTR as const` + `keyof`），tsc 强制覆盖全部动作/chip，属性名成为可 grep 字面量（对压缩器与大小写错误免疫）；
2. 新增 `tests/unit/exam-penta-ui-contract.test.ts`（4 项）：五个按钮/七个 chip 属性字面量齐备、禁止字串拼接产生 dataset 键、UI 字面量经 kebab 转换与浏览器 spec 选择器一一对应。

**验证**：先前失败用例 729ms 通过（原 90s 超时）；全量浏览器专项 47.2s 全绿。

---

## 五、定向测试

- 本轮先跑定向 60 项（exam-penta 相关单测）：**60/60 通过**（压缩前执行）。
- 修复后复跑相关单测：`exam-penta-training.test.ts` + `exam-penta.test.ts` **75/75**；新增契约测试 4/4。
- `tsc -b`：**0 错误**（含新 UI 模块、新 spec、新契约测试）。

## 六、完整回归

| 范围 | 结果 |
|---|---|
| Vitest 全量 | **57 文件 / 755 测试全部通过**（15.3s） |
| 科目 E 浏览器专项（桌面+手机） | **15 passed / 1 skipped**（47.2s），见第四节 |
| 原考试模式回归（exam-drone/ground-check/penta/smoke/subject-f 五 spec） | ✅ **27 passed / 3 skipped（1.4m）**，skip 为既有设计（待实体装置项） |
| Playwright 完整回归（全部 spec） | ✅ **138 passed / 10 skipped（10.4m）**，skip 均为 PENDING_DEVICE_TEST，零失败 |
| `git diff --check` | 通过（无 whitespace 错误） |

（考试模式回归与完整回归的实跑结果在下方「回归实跑记录」更新。）

---

## 七、参数一致性报告（任务 D）

新增只读工具 `tools/penta-param-check.mjs`（299 行；`node --check` 通过；不修改任何参数/模型/飞控）：

- 用法：`node tools/penta-param-check.mjs [--json]`；退出码 0=无 FAIL、1=有 FAIL。
- 核对六类对象：`exam-aircraft.json`、`caa-exam.json`、`scene.ts`（ExamDrone）、`penta-scene.ts`（PentaDrone）、`diagonalSpanCm` 三处一致性、官方已核实值 vs 模擬假設/教學假設值；另加飞控不含轴距常数（防隐性耦合）、級距空域交叉核对、操作区≥最低空域、penta-app 无硬编码高度/空域。
- **实跑结果：31 项检查 = PASS 29 / WARN 2 / FAIL 0（退出码 0）**。
  - 实测几何：scene.ts 与 penta-scene.ts 马达半径常数均 0.5 → 对角 1.00m = config 100cm（附件十二級別 I 区间 90–110cm 内）✓
  - 官方值（附件十二）：massKg=4（≧4kg）、diagonalSpanCm=100（90–110cm）；其余 5 项（maxTilt/maxSpeed/acceleration/drag/inertia）均标「模擬假設，非官方」✓
  - 教學容差 `assumption=true`、note 载明模擬假設；caa 原廠規格欄位留 null 不造假 ✓
  - **2 项 WARN（文档层面，不影响数值）**：`scene.ts:148` 与 `scene.ts:372` 注释声称「馬達對角約 1.1m」，与源码常数实测 1.00m 不符（`scene.ts:185`、`penta-scene.ts:186` 注释「1.00m」正确）。**按只读 mandate 未修改注释**，建议下阶段由人工裁决是否更新注释文字。
- 报告留存：`docs/handoff/P0-ROUND4-PARAM-CHECK-REPORT-2026-10-25.txt`（人类可读）与 `.json`（机器可读）。

---

## 八、截图（全部来自真实运行画面）

`.playwright-output/penta-training-shots/` 共 14 张（桌面/手机各 7），已逐一抽验：

| 截图 | 内容确认 |
|---|---|
| `{project}-01-initial.png` | 初始挂载：训练列 7 chips 初值、按钮启用态、两处免责 |
| `{project}-02-flying-segment-1.png` | 飛行中：航線高亮、已達航點綠球、實際高度 20.0m |
| `{project}-03-altitude-deviation.png` | 高度偏差 +3.0m、琥珀色 chip、偏離連線 |
| `{project}-04-route-deviation.png` | 偏離教學航線 3.3m、琥珀色 chip |
| `{project}-05-paused.png` / `06-resumed.png` | 暫停/恢复状态 |
| `{project}-07-complete-record.png` | 完成結果浮层：教學練習記錄（非官方成績）、五航段表 |

---

## 九、未完成事项

1. **科目 E 實體硬體考試驗收**：仍待教師在場（實體遙控器 + 考場場景）；考試場景/判定為模擬輔助，未經教師授權不得進入正式驗收。
2. **2 项注释 WARN**（scene.ts:148/372「約 1.1m」）：只读 mandate 未改，待人工裁決。
3. **Playwright 完整回归**：✅ 已完成，138 passed / 10 skipped / 0 failed（10.4m）。
4. `playwright.reuse.tmp.config.ts` 临时配置：回归全部跑完后删除。
5. **未提交**：遵指示全程无 Commit/Push/Merge/Deploy；所有新档案保持未追踪状态，等架构师验收后另行裁决提交策略。

## 十、下阶段建议

1. **先验收属性契约修复**：本轮缺陷表明「纯逻辑单测 + 浏览器 E2E」之间缺一层 DOM 契约测试；建议将 `exam-penta-ui-contract.test.ts` 的模式推广到其他 UI 模块（exam-panel 等）。
2. **注释修正**：scene.ts:148/372 的「約 1.1m」改為「1.00m」（或刪除具體數字），消除文档不一致 tripwire。
3. **科目 E 實體驗收**：教師在場用實體遙控器跑 `?mode=penta`，確認真實輸入下五邊航線可練習、暫停/重啟/中止行為符合預期。
4. **提交策略**：验收通过后按 phase 分组提交（penta 训练四模块 + UI 契约测试 + 参数检查工具 + 文档），保持每 phase 一个 commit 的既有惯例。
5. **P0-B 參數工具納入 CI/定期檢查**：`tools/penta-param-check.mjs` 可作為參數漂移的守門員（退出碼 1 即失敗）。

---

## 回归实跑记录

| 回归 | 命令 | 结果 |
|---|---|---|
| 原考试模式回归 | `npx playwright test --config playwright.reuse.tmp.config.ts tests/browser/exam-{drone,ground-check,penta,smoke,subject-f}.spec.ts` | **27 passed / 3 skipped（1.4m）**；skip 为既有设计（待实体装置项），无失败 |
| Playwright 完整回归 | `npx playwright test --config playwright.reuse.tmp.config.ts`（全部 spec × 桌面/手机） | ✅ **138 passed / 10 skipped（10.4m）**；10 个 skip 均为 PENDING_DEVICE_TEST（实体装置验收，既有设计），**零失败** |

---

## 十一、第五轮增补（2026-10-26，HEAD 仍 eb242c7，未 commit）

用戶下「繼續開發」，跳過選項詢問後，按本報告「十、下階段建議」中兩項**安全且無需授權/硬體**的方向推進（真實科目 E、提交仍按紅線待授權/裁決，未涉足）。

### 11.1 修正 scene.ts 註釋 WARN（第九节未完 #2）
- `src/exam/scene.ts:148` 與 `:372` 的「馬達對角約 1.1m」→ **「1.00m」**（與實測幾何：馬達半徑 0.5 → 對角 1.00m，及 `config diagonalSpanCm=100` 一致）。僅改註釋文字，不動飛控/評分/幾何常數。
- `tools/penta-param-check.mjs` 複跑：**PASS 31 / WARN 0 / FAIL 0（退出碼 0）**——兩處 WARN 已收斂。

### 11.2 同步修正既有 tripwire 斷言
- `tests/unit/exam-penta-params.test.ts:80` 原本特意斷言「舊註解約 1.1m 存在」作為文件不一致標記；註釋修正後改為：斷言「對角 1.00m 一致」且「約 1.1m 已移除」。

### 11.3 DOM 契約測試推廣（第十节建議 #1 的系統化）
全倉審計：動態 `dataset[` 鍵生成唯一存在於已修復的 `penta-training-ui.ts`（現為 `BTN_ATTR`/`CHIP_ATTR` 類型化字面量映射）；`exam-panel` 用 `dataset.hudWind`（點號字面量）、`controller-calibration` 用 `dataset.verdict/state` 等點號字面量、`create-app.ts` 的 data-* 全為靜態 HTML 模板字面量——**無其它動態鍵構造**。

- **新增 `tests/unit/dom-attribute-contract.test.ts`（2 項）**：以 `import.meta.glob('../../src/**/*.ts',{query:'?raw',eager:true})` 掃全部 src，斷言「不得以模板字符串／拼接產生 `dataset[...]` 鍵或 `setAttribute` 的 data-* 屬性名」。把第四輪缺陷類永久擋在全倉，任何模塊重蹈覆轍即單元層失敗。
- **新增 `tests/unit/exam-panel-ui-contract.test.ts`（2 項）**：鎖定 `panel.ts` 根 class `exam-hud`（與 `exam-smoke.spec.ts` 的 `.exam-hud canvas` 對應）與 `dataset.hudWind` 字面量，禁止模塊內動態 dataset 鍵。

### 11.4 測試結果（第五轮）
- `npx tsc -b` → **0 錯誤**
- `npx vitest run` → **59 文件 / 759 測試全綠**（較第四輪 755 增 4 項契約測試）

### 11.5 範圍與紅線
- 未動飛控/評分/RC/其他科目/成績單；未提交（HEAD `eb242c7` 不變）；未重建 dist（僅註釋改動，bundle 不變）；4173（PID 11968）未動。
- 真實科目 E 與第四輪提交，依紅線仍待教師授權/裁決。
