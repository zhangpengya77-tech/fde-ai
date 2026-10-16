# P1-7 独立验收报告（Independent Acceptance Audit）

- 项目：`D:\FDE-Power-Inspection-Simulator`
- 分支：`phase1-mvp`（HEAD = `8d23ad5db9e8b61483ed0a7335ee9fe50a1f1b61`）
- 审计日期：2026-10-17
- 审计原则：只读核验，不信任交付报告，自查源码 / 提交 / 测试 / 截图真实证据

---

## 0. Git 状态确认

| 项 | 值 | 来源 |
|---|---|---|
| 当前分支 | `phase1-mvp` | `git branch --show-current` |
| HEAD | `8d23ad5` | `git rev-parse HEAD` |
| 工作区改动 | 22 个旧阶段截图被重新生成（p1-2/4/5/6 desktop + mobile），均**未** stage | `git status --short`（全部为 ` M`，第二列 = 改动但未 stage） |
| P1-7 提交范围 | 20 文件 +2129 / −25：源码 4 新 + 5 改、测试 3 新 + 1 改、截图 6 新、文档 3 改 | `git show --stat 8d23ad5` |
| 未执行 | `reset` / `clean` / `stash` / 切分支 — 0 次 | 审计全程只读 |

旧截图作为证据保留在工作区（未 stage、未丢弃），符合"保留所有既有未提交修改和证据"。

---

## 1. 七项重点核验

### 1.1 报告数据是否来自真实 ScoreSession / 照片记录 / 控制轨迹 — PASS

证据：

- `src/app/create-app.ts` 第 588-601 行：

  ```ts
  const report = buildMissionReport({
    missionId, taskName: '输电塔右侧绝缘子串巡检',
    targetId: layout.target.id, targetName: layout.target.label ?? '绝缘子串巡检点',
    startedAt: missionStartedAt || Date.now(),
    finishedAt: Date.now(),
    session: sessionRecorder.session(),
    score: scoreResult,
    captures: missionCaptures.map(toReportCaptureEntry),
    controlSamples: sessionRecorder.controlSamples(),
  });
  void reportStore.save(report).catch(() => undefined);
  ```

  报告**只**从 `sessionRecorder.session()`（真实遥测）、`scoreResult`（已评分的分数）、`missionCaptures`（来自 `captureInspection` 推送的真实 `InspectionCaptureRecord`）、`sessionRecorder.controlSamples()` 组装，无任何虚构字段。

- `src/report/mission-report.ts` 第 56-81 行 `buildMissionReport` 头注释：*"It invents nothing and uses no randomness"*；`captures: [...input.captures]`、`controlSamples: [...input.controlSamples]`、`hazardSummary: summarizeHazards(session.hazardEpisodes)`、`finalState: session.missionFinalState`、`durationMs: session.durationMs`、`pathLengthM: session.pathLengthM`、`maxAltitudeM: session.maxAltitudeM`、`enteredInspectionZone: session.enteredInspectionZone` 全部直接来自 `ScoreSession`。

- 控制轨迹边界：`src/scoring/SessionRecorder.ts` 第 19-20 行 `CONTROL_SAMPLE_INTERVAL_MS = 200`、`MAX_CONTROL_SAMPLES = 600`；第 172-177 行 `trackControl` 按 200ms 节流并在 600 封顶；第 100-101 行 `reset()` 清理；第 168-170 行 `controlSamples()` 返回拷贝快照。

- 单元测试覆盖：`preserves every capture attempt, including invalid ones`、`preserves the Mock AI source label on each capture`、`aggregates hazard episodes into count + duration`、`samples Roll/Pitch/Yaw/Throttle on a fixed cadence after takeoff` 等。

### 1.2 IndexedDB 刷新恢复 / 历史查询 / 删除 / 排序 — PASS

证据：

- `src/persistence/mission-report-store.ts` 独立 key 前缀 `fde.mission-report/`（第 15 行）。
- `save/get/delete` 直接走 `kv.put / kv.get / kv.delete`（第 37-58 行）。
- `list()`：第 45 行 `keys().filter(startsWith(KEY_PREFIX))` → `Promise.all` 读出 → `isReport` 守卫 → `buildReportSummary` → `sortReportsByCreatedAtDesc`（最新在前）。
- `resolveMissionReportStore()`（第 63-70 行）：有 `indexedDB.open` 用 `IndexedDbKeyValueStore`，否则 `createMemoryKeyValueStore()`，与 P1-3/5 capture/profile store 同模式。
- 单元测试 `mission-report-store.test.ts` 4 条：`saves and reads a single report`、`lists summaries newest-first and flags collisions`、`returns null for an unknown report id`、`deletes a report`（PASS）。

### 1.3 JSON 导出 / 导入解析 / 旧字段 / 非法输入 — PASS

证据：

- `serializeReport` = `JSON.stringify(report, null, 2)`（第 119-121 行）。
- `parseReport` 容错设计（第 129-169 行）：
  - 空串 → `null`；`JSON.parse` 抛错 → `null`；非对象 → `null`。
  - 缺 `reportId` / `missionId` / `score` 必需 → `null`（`coerceScore` 第 171-186 行要求 `totalScore`/`grade`/`dimensions`）。
  - 可选字段缺省：`taskName → '未命名任务'`、`targetId/targetName → '未知目标'`、`controlSamples/captures/hazardSummary` 缺省 → `[]`、`finalState` 缺省 → `'IDLE'`、`status` 由 `finalState` 重派生。
- 单元测试 4 条相关：`exports JSON and parses it back identically`、`returns null for invalid JSON and empty input`、`falls back to empty arrays for missing optional fields`、`stays compatible with older exports that lack newer keys`（PASS）。
- 浏览器 CASE5：`exported JSON matches the recorded report`（PASS）— 端到端 round-trip。

### 1.4 完成 / 失败 / 未完成状态与评分一致性 — PASS

证据：

- `toReportStatus`（第 36-40 行）：`COMPLETE → completed`、`FAILED → failed`、其余 → `incomplete`。
- 单元测试 5 条相关：
  - `produces a complete report for a finished mission`（PASS）
  - `marks a FAILED mission and keeps the total under the safety ceiling`（PASS）
  - `caps the total at 59 when a collision happens on an otherwise strong run`（PASS）— 碰撞 + 完成态 = 封顶 59
  - `marks an unfinished mission as incomplete`（PASS）
  - `keeps the six dimensions consistent with the total score`（PASS）
  - `derives a status from the final mission state`（PASS）
  - `builds a compact summary, flagging collisions`（PASS，`hadCollision` 由 `hazardSummary.some(state==='COLLISION')` 派生）
- 截图 `p1-7-failed-report-desktop-chrome.png` 真实呈现 28/100 FAIL（封顶）、失败徽标、碰撞徽标、累计 4ms 碰撞事件，与规则一致。

### 1.5 教师视图本地数据 + 权限边界 — PASS

证据（`src/app/create-app.ts`）：

- 第 234 行按钮：`<button ... data-report-role-tab="teacher" ...>教师查看</button>`。
- 第 236 行说明：`<p class="report-teacher-note" data-report-teacher-note hidden>教师查看模式为只读，用于复核学员提交的任务报告；本机未实现多用户隔离。</p>` — **明确声明只读 + 本机无多用户隔离**。
- 第 762 行（detail HTML）：`role === 'teacher' ? '<p class="report-role-flag">教师查看模式（只读）：用于复核学员提交的任务报告。</p>' : ''`。
- 第 887 行（badge）：`role === 'teacher' ? '教师查看（只读）' : '学员任务记录'`。
- Mock AI 同样清晰标注（第 696、744、749、969 行反复出现"模拟 AI / 非真实 YOLO 模型 / 仅用于教学演示"）。
- 浏览器 CASE4：`the teacher view opens and shows the same report read-only`（PASS）— 切到教师 tab 仍为只读，DOM 不变。

### 1.6 浏览器跳过项目是否仅涉及真实设备测试 — PASS

证据：

- 全局 grep `tests/browser` 内的 `test.fixme|test.skip|describe.skip|.skip(` 唯一命中：`tests/browser/gamepad.spec.ts:150 test.fixme(`（即 P1-3 引入的 `PENDING_DEVICE_TEST: real USB hardware acceptance / RadioMaster EdgeTX / RadioLink AT9S / DJI FPV RC3 / CRSF-ELRS`）。
- Playwright 全套运行结果显示 `2 skipped`（desktop + mobile 同一 fixme × 2），其余 46 passed。
- 无应用逻辑或 UI 测试被跳过。

### 1.7 六张 P1-7 截图是否真实存在且对应当前实现 — 部分 PASS（5/6），含 1 项文档/命名瑕疵

证据：

| 文件 | 大小 | 实际内容 | 对应实现 |
|---|---|---|---|
| `p1-7-reports-list-desktop-chrome.png` | 169 789 B | 桌面、覆盖在 3D 场景上的报告详情卡（98/100 EXCELLENT，控制表 48 条采样） | **是详情，不是列表** — 见下"瑕疵" |
| `p1-7-report-detail-desktop-chrome.png` | 28 617 B | 详情元素 | 是 |
| `p1-7-failed-report-desktop-chrome.png` | 132 021 B | 28/100 FAIL、失败/碰撞徽标、4ms 碰撞事件 | 是 |
| `p1-7-reports-list-mobile-chrome.png` | 63 341 B | 移动端详情 | **是详情** |
| `p1-7-report-detail-mobile-chrome.png` | 67 017 B | 移动端详情元素 | 是 |
| `p1-7-failed-report-mobile-chrome.png` | 63 137 B | 移动端覆盖：列表项卡片（"2026-10-17 / 输电塔…巡检 / 失败 / 28 分·FAIL / 碰撞"）+ 详情字段 | 是（恰好同时呈现列表项摘要 + 详情） |

---

## 2. 发现项

### [FIND-1] 截图命名与内容不一致（minor，文档/测试命名瑕疵，非应用缺陷）

- 现象：桌面与移动 `p1-7-reports-list-*.png` 实际拍摄的是**已打开的报告详情**（含控制表），而非独立的历史列表。
- 根因（可复现）：`tests/browser/report.spec.ts`
  - 第 92-97 行 `openReportFromList(page)`：点击"任务记录"按钮 → 等待 `.report-item` 出现 → **点击第一项** → 等待 `[data-report-detail]` 可见。
  - 第 118 行 `await openReportFromList(page)` 后立即执行。
  - 第 127-130 行随后才 `page.screenshot({ path: '...p1-7-reports-list-...png', fullPage: true })`。
  - 因此"列表"截图是在详情已打开后拍的，内容自然是详情。
- 影响范围：仅 1 个文件命名 + 1 处文档描述；列表功能本身被 CASE1/CASE3/CASE5 端到端验证（`.report-item` 可见、可点击进入详情）。
- 相关文档失真：`TEST_REPORT.md` 描述 `p1-7-reports-list-desktop-chrome.png` 为 *"history list (date/status/total/grade/collision) after a completed mission"*，与实际不符。

**最小修复方案**（仅文档 + 测试，不改应用）：

- 方案 A（推荐，改动最小）：在 `openReportFromList` 内**点击第一项之前**增加一次 `page.screenshot({ path: '...p1-7-reports-list-...png', fullPage: true })`；现有 118 行调用后不再额外拍"列表"图。
- 方案 B：保留现状但将现有文件重命名为 `p1-7-reports-detail-*.png`（与 detail 截图合并），并把 `TEST_REPORT.md` 的描述改为 "full-page with the detail overlay open"。
- 本轮未应用修复（遵守 *"如果发现缺陷…没有必要时不修改代码"* 与 *"不擅自扩大修改范围"*）。等待用户确认后再修。

**Resolution (2026-10-17 follow-up task):** [FIND-1] has been fixed in the follow-up commit. The `openReportFromList` helper now accepts an optional `listScreenshotPath` and captures the history list **before** clicking the first item, so `p1-7-reports-list-{desktop,mobile}-chrome.png` now genuinely show the history list (date / status / score / collision flag, "共 1 条"). Both screenshots were regenerated by re-running CASE1 (desktop + mobile, 2 passed) and visually verified to display the list. No application code, scoring rule, flight control, AI or database change. The detail-only screenshot and the failed-report screenshot are unchanged. Unit tests stay 213/213, build clean, and old-phase evidence screenshots remain unstaged.

---

## 3. 七项核验汇总

| # | 检查项 | 结果 |
|---|---|---|
| 1 | 报告数据来自真实记录 | **PASS** |
| 2 | IndexedDB 持久化 / 历史 / 删除 / 排序 | **PASS** |
| 3 | JSON 导出 / 解析 / 旧字段 / 非法输入 | **PASS** |
| 4 | 完成 / 失败 / 未完成状态与评分一致 | **PASS** |
| 5 | 教师视图本地边界 | **PASS** |
| 6 | 浏览器跳过项仅真实设备 | **PASS** |
| 7 | 六张截图真实且对应实现 | **PASS（应用层）**，含 [FIND-1] 文档/命名瑕疵 |

应用行为层全部 PASS；[FIND-1] 为非阻塞的命名/文档瑕疵，不影响 P1-7 教学闭环正确性。

---

## 4. 项目保护合规

- 未执行 `git reset` / `git clean` / `git stash` / `git checkout` — 0 次。
- 未修改其他 FDE 项目 — 0 次（全程限定在 `D:\FDE-Power-Inspection-Simulator`）。
- 未改动评分规则（P1-6 `DEFAULT_SCORE_CONFIG` 未触）、飞行逻辑（`SimpleFlightController` 未触）、Three.js 架构（场景/渲染管线未触）— 0 次。
- 未 stage 旧阶段截图（p1-2/4/5/6 仍为 ` M` 未 stage，作为证据保留）。
- 本审计全程只读（`Read` / `Grep` / `Bash` 查看），未写应用代码。
