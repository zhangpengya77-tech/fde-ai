# F450 电力巡检仿真平台 — 下一阶段独立重建方案

- 文档日期：2026-10-17
- 配套文档：`docs/analysis/2026-10-17-f450-feature-gap-analysis.md`（差距编号 G1~G15 / R1~R7 / E1~E6 均在该文档定义）
- 本轮性质：**方案设计**。不写实现代码、不加依赖、不改评分规则、不提交。

---

## 1. 重建原则（本阶段硬约束）

1. **确定性优先**：凡是能写成纯函数规则表的，就不交给大模型。AI 只在「离线分析/代码辅助」层面参与，**不得**在运行时控制飞行器。
2. **不让 AI 改评分**：评分规则只能由人修改并单独批准；AI 可以提出建议，但不得自行落改。
3. **先测后改**：每个功能按 `需求说明 → 规则表/状态机 → 失败测试(RED) → 最小编码(GREEN) → 全量回归` 执行。
4. **最小修改面**：单次任务只允许触及方案中列出的文件；超出即停下报告。
5. **不做的事**：不引入大型 AI 框架、不接云端、不做引擎迁移、不做整项目重构、不新增第 2 个场景（本阶段）。

---

## 2. 单一优先任务（建议立即执行）

### 2.1 任务定义：**G1 + G2 — 巡检 AI 适配器边界改造**

**为什么是它**

- 这是唯一「不改就永远接不了真实模型」的硬阻塞：当前 `InspectionAIInput` 没有图像字段，且 `create-app.ts:475` 把场景标准答案 `defectType` 传给 AI，`MockInspectionAI.ts:39-40` 直接用它做等值比较（`已验证`）。
- 它**不触及**评分规则、飞行逻辑、Three.js 渲染、任务状态机语义——完全落在「接口 + 适配器 + 调用点」三个文件。
- 它是后续所有视觉识别工作的前置：Plan C 的原型若按当前接口接入，指标必然被标签泄漏污染。

### 2.2 需求说明

| 编号 | 需求 | 可测断言 |
|---|---|---|
| N1 | AI 输入必须能承载真实图像 | 类型上存在图像字段，且调用点传入真实 `photoDataUrl` |
| N2 | AI 输入**不得**包含标准答案 | 输入类型中不存在 `defectType`；`create-app` 调用处不再引用 `layout.target.defectType` |
| N3 | AI 结果可表达「真实/模拟/不可用」 | `source` 为三态联合；`'unavailable'` 有独立 UI 文案 |
| N4 | 改造后教学行为不变 | 同一场景同一几何下，mock 的 `defectDetected / defectType / confidence` 与改造前**逐字段相等** |
| N5 | UI 标注不退化 | 仍显示「模拟 AI / 非真实 YOLO」；`unavailable` 不得显示为「未检出缺陷」 |

### 2.3 规则表（Mock 适配器的新判定规则）

改造后 `MockInspectionAI` 不得读取真值，只能凭「几何 + 场景注册表」判定：

| 条件 | 判定 | 置信度 | 说明 |
|---|---|---|---|
| `targetId` 不在注册表 | 未检出 | 0 | 非教学目标 |
| 注册表该目标 `plantedDefect === null` | 未检出（正常） | 0 | 未来支持「正常任务」 |
| 图像缺失（`image` 为空） | `source: 'unavailable'`，未检出 | 0 | **不得**当作「无缺陷」 |
| `distanceToTarget` 偏离 `idealDistanceM` | 检出 | 0.92 − 距离罚分 | 与现有公式一致 |
| `angleErrorDeg` 超 `maxAngleErrorDeg` | 检出 | 再减角度罚分 | 与现有公式一致 |
| `coverageRatio` 偏低 | 检出 | 再加覆盖率奖励 | 与现有公式一致 |
| 最终值 | — | 夹在 `[0.5, 0.99]` | 与现有公式一致（保证 N4） |

> 关键：**「注册表里的 plantedDefect」是场景配置，不是本次调用的入参**。这在语义上把「AI 知道场景里种了什么」与「AI 从输入里读答案」区分开——前者是 mock 的合法简化（且必须在文档与 UI 中声明），后者是不可接受的标签泄漏。

### 2.4 文件范围（严格白名单）

| 文件 | 变更 |
|---|---|
| `src/inspection/types.ts` | `InspectionAIInput` 增 `image: string \| null`（data URL），**删除** `defectType`；`InspectionAIResult.source` 改三态 |
| `src/ai/MockInspectionAI.ts` | 改为查场景注册表 + 几何判定；不读 `input.defectType`；`image` 为空返回 `unavailable` |
| `src/app/create-app.ts` | **仅** AI 调用点（约 470-480 行）：删 `defectType`、加 `image: photoDataUrl`；`unavailable` 的 UI 文案分支 |
| `tests/unit/mock-inspection-ai.test.ts` | 适配新契约 + 新增 `unavailable` 用例 |
| `tests/unit/inspection-ai-contract.test.ts` | **新增**：契约测试（N1/N2/N3） |
| `docs/analysis/*` | 完成后回填实测结果 |

**禁止改动**：`src/scoring/**`、`src/mission/**`、`src/flight/**`、`src/scenes/**`、`src/camera/**`、`src/report/**`（除非类型联动导致编译错误，且必须在报告中逐条说明）。

### 2.5 测试用例清单（先写，必须 RED）

`tests/unit/inspection-ai-contract.test.ts`

1. 编译期断言：构造 `InspectionAIInput` 时传 `defectType` 应报错（用 `@ts-expect-error` 固化 N2）。
2. 运行期断言：`Object.keys(input)` 不含 `defectType`。
3. `image` 为 `null` → `source === 'unavailable'` 且 `defectDetected === false`。
4. `image` 为有效 data URL + 目标在注册表 → `source === 'mock'`。
5. `source` 取值集合 ⊆ `{'mock','real','unavailable'}`。

`tests/unit/mock-inspection-ai.test.ts`（改造）

6. 未知 `targetId` → 未检出、置信度 0。
7. 注册表目标 `plantedDefect === null` → 未检出。
8. 理想几何 → 检出，置信度与改造前基准值相等（N4 回归等价）。
9. 距离/角度/覆盖率三档 → 置信度单调性（越差越低）。
10. 相同输入两次调用 → 完全相等（确定性）。

浏览器（保持绿，不改断言）

- `tests/browser/inspection-mission.spec.ts` CASE1-CASE3：任务闭环、差照片重拍、碰撞失败。
- `tests/browser/report.spec.ts` CASE2：报告含 Mock AI 结果且标注「非真实 YOLO」。

### 2.6 验收条件

| 编号 | 条件 | 判定方式 |
|---|---|---|
| A1 | `npm test` 全绿，且新增用例数 ≥ 5 | 命令输出 |
| A2 | `npm run test:browser` 无新增失败 | 命令输出（仅允许既有 `PENDING_DEVICE_TEST` 跳过） |
| A3 | `npm run build` 通过 | `tsc -b` + Vite |
| A4 | 同一场景同一几何的 mock 置信度与改造前完全一致 | 单测 8 的基准值比对 |
| A5 | `grep -rn "defectType" src/app/create-app.ts` 不再出现在 AI 调用点 | 命令证据 |
| A6 | 报告中的 AI 结果仍标注「模拟 AI / 非真实 YOLO」 | 浏览器 CASE2 断言 + 截图 |
| A7 | 未改动评分/飞行/场景/报告模块 | `git diff --stat` 白名单核对 |

### 2.7 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 删除 `defectType` 导致其他调用点编译失败 | 中 | 先全仓 `grep defectType`，确认只有 2 处（`create-app.ts:302` 配置、`:475` 调用） |
| `photoDataUrl` 为空（无 WebGL 环境）导致 AI 全部 `unavailable` | 中 | 单测注入伪 data URL；浏览器有真实 RenderTarget |
| 置信度公式被无意改动 | 高 | 先冻结基准值（改造前跑一次记录），再改，逐字段比对 |
| 「注册表」被误当成新的标签泄漏 | 低 | 文档 + 代码注释明确：注册表是**场景配置**，且 `source='mock'` 强制标注 |

### 2.8 预计工作量

3 个源文件 + 2 个测试文件 + 文档回填。**单次会话可完成**，不需要跨阶段依赖。

---

## 3. 后续阶段（按优先级，需逐项批准）

### 阶段 2：G13 文档漂移修正（零风险，建议与阶段 1 同批提交）

- 需求：README 更新到 P1-7；ARCHITECTURE 用真实模块名重画；规格 §13 追加「P1-6 六维变更说明」（不改写历史）。
- 规则表：文档中出现的每个 `XxxEngine` / `XxxStore` / `XxxAdapter` 必须存在于 `src/`。
- 测试：可选 `tests/unit/docs-module-names.test.ts`（读 md + `fs.existsSync`）。
- 验收：该测试通过；README 首段阶段号 = P1-7。

### 阶段 3：G3 照片证据读取 + 存储上限

- 需求：报告构建改从 `captureStore.list()` 按 `missionId` 过滤；存储设上限（建议保留最近 50 次任务或 200 张）。
- 规则表：`list()` → filter(`record.missionId === current`) → 按 `timestamp` 升序 → 作为报告 captures。
- 测试：`inspection-capture-store.test.ts` 由 1 扩到 ≥4（按 missionId 过滤 / 空集 / 上限裁剪 / 脏数据跳过）；浏览器 +1（刷新后报告照片数一致）。
- 验收：刷新页面 → 打开历史报告 → 照片数量 = 拍摄次数；连续 10 次拍摄后存储条数 ≤ 上限。
- 风险：裁剪策略若误删当前任务照片会导致报告缺图 → 裁剪必须在报告落库**之后**执行。

### 阶段 4：G7 + G10 学员判读 + 教师出题（**需单独批准改评分**）

- 需求：① 缺陷类型扩为联合类型；② 拍照后新增「判读」步骤（正常/疑似异常+类型）；③ 教师可设 `none/fixed/seeded-random`。
- 状态机变更（建议）：在 `AI_INSPECTION` 之后插入 `TRAINEE_JUDGEMENT`，再进 `INSPECTION_COMPLETE`。
  | 当前状态 | 事件 | 下一状态 | 守卫 |
  |---|---|---|---|
  | `AI_INSPECTION` | AI 返回（任意 source） | `TRAINEE_JUDGEMENT` | 必须有 `photoResult.valid` |
  | `TRAINEE_JUDGEMENT` | 学员提交判读 | `INSPECTION_COMPLETE` | 判读字段非空 |
  | `TRAINEE_JUDGEMENT` | 超时/放弃 | `INSPECTION_COMPLETE` | 记为「未判读」，扣分 |
- 评分变更（**需批准**）：现有六维 25/25/15/15/10/10 → 建议 22/22/14/14/14/14 或新增第 7 维「缺陷判读」并重分配。**未获批准前不得实现**。
- 测试：`mission-engine.test.ts` +4、`scoring-engine.test.ts` +5、浏览器 +2。
- 风险：状态机插入新状态会让 P1-5/P1-6/P1-7 的既有浏览器用例路径变长 → 需要同步更新用例的完成路径，但**不得放宽断言**。

### 阶段 5：G12 教师复核 / G11 触控 / G4 ZIP / G5 回放 / G6 恢复 / G8 热成像 / G9 航线

- 逐项按 §2 同结构（需求→规则表→测试→最小改→验收）执行。
- G11 可先做「最小修复」：把 `PilotInputType` 的 `'keyboard-touch'` 改为 `'keyboard'`，消除假声明（1 行 + 类型联动），再排期真触控适配器。
- G4 若坚持 ZIP，需要用户批准新增依赖（建议优先 File System Access API 降级方案）。

---

## 4. 测试计划（每阶段统一执行）

| 层 | 命令 | 通过标准 |
|---|---|---|
| 单元 | `npm test` | 全绿；新增用例先 RED 后 GREEN |
| 浏览器 | `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run test:browser` | 除 `PENDING_DEVICE_TEST` 外全绿 |
| 构建 | `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build` | `tsc -b` 无错；仅允许既有 >500 kB 警告 |
| 差异审查 | `git diff --stat` | 文件列表 ⊆ 本阶段白名单 |
| 截图证据 | 对应 `screenshots/p{N}-*.png` | 内容与文件名语义一致（避免 [FIND-1] 类问题） |

**环境注意**（已验证）：沙箱内 Vite 清空 `dist/` 与 Playwright 写截图偶发 `EPERM/ETIMEDOUT`，需设 `CODEBUDDY_SAFE_DELETE_ENABLED=0`；若单条用例因写图失败，重跑该 spec 确认，**不得**据此改断言。

---

## 5. 本轮结论

- 现状：P1-1~P1-7 全部落地且测试可复现（213 单测 + 浏览器套件），旧报告与代码一致。
- 最大差距不是「功能少」，而是 **AI 边界形状错误**（无图像输入 + 真值泄漏 + 结果三态缺失），它会让后续所有视觉识别工作建立在错误契约上。
- 因此下一阶段**唯一**建议任务：**G1+G2 AI 适配器边界改造**（3 源文件 + 2 测试文件，不碰评分/飞行/场景）。
- 其余差距已按 P0/P1/P2/P3 排序，逐项待批准。
