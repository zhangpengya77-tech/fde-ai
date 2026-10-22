# F450 电力巡检仿真平台 — 功能差距分析（只读基线）

- 文档日期：2026-10-17
- 项目：`D:\FDE-Power-Inspection-Simulator`
- 分支：`phase1-mvp`
- 分析性质：**只读盘点 + 差距识别 + 优先级建议**。本轮不修改任何应用代码、不新增依赖、不训练模型。
- 结论标记：`已验证`（有源码/命令证据）、`由现有测试支持`（有测试通过但无独立断言）、`推测`（合理推断，未证实）、`尚未确认`（缺证据）

---

## 0. 参考资料来源的诚实声明（必读）

本轮**没有**获得易飞（Yifei）软件的界面截图、录屏、演示账号或功能说明书；也**没有**访问、破解、反编译或抓包任何易飞受保护内容。因此：

| 结论类型 | 本轮是否可写 |
|---|---|
| 「易飞界面上可观察到 X」 | **不可以**——没有任何观察证据 |
| 「易飞可能具备 X 功能」 | 只能标 `推测` 或 `尚未确认` |
| 「本项目设计规格要求 X」 | 可以，且给出文档章节号 |
| 「本项目代码实际实现 X」 | 可以，且给出 `文件:行号` |

所以本文档中的「参考资料来源」栏位统一取值为下列之一，**不虚构外部观察**：

1. `本项目设计规格`（`docs/superpowers/specs/2026-10-16-power-inspection-simulator-v1-design.md`，标注章节）
2. `用户任务书`（本次任务描述中明确列出的能力项）
3. `通用电力巡检教学需求`（行业通识，标 `推测`）
4. `无外部参照资料`（明确写出，不补猜测）

> 若后续用户提供合法可访问的界面截图/公开演示资料，应按本模板逐项补齐「可观察到的实际行为」栏，并把 `推测` 升级为 `已验证` 或降级为 `尚未确认`。

---

## 1. 只读检查基线

### 1.1 Git 状态（已验证）

| 项 | 实际值 |
|---|---|
| 分支 | `phase1-mvp` |
| HEAD | `c669b66ad64ac391c85369c0d7a0f613820d8283` |
| HEAD 提交说明 | `fix(test): 修正 P1-7 列表截图时机（关闭 [FIND-1]）` |
| 工作区已跟踪修改 | 24 个 `screenshots/*.png`（P1-2/4/5/6/7 历史证据被测试重跑覆盖，**未提交，保留为证据**） |
| 未跟踪文件 | `docs/superpowers/plans/phase-2-plan-{a,b,c}-*.md`（上一轮规划文档，未提交） |
| 最近提交链 | `c669b66` → `8d23ad5` (P1-7) → `751e2ec`/`713085b` (P1-6 收尾) → `96d00ea` (P1-6) → `322d1ba` (P1-5) → `9742d2b` (P1-4) → `56e9e4c` (P1-3) |

未执行 `reset / clean / stash / checkout / 切分支`；未触碰其他 FDE 项目。

### 1.2 测试与构建状态（本轮实测）

| 命令 | 结果 |
|---|---|
| `npm test` | **19 个测试文件 / 213 个用例 / 213 通过**，6.63s |
| `npm run test:browser` | **48 通过 / 2 跳过**（1 条因沙箱写图 `EPERM` 失败，单独重跑后通过，见附录 A.2） |
| `npm run build` | **通过**：`tsc -b` 无错，Vite 34 模块，589.40 kB（仅预存 >500 kB 警告） |

### 1.3 环境注意

沙箱内 Vite 清空 `dist/`、Playwright 写截图偶发 `EPERM/ETIMEDOUT`，需设 `CODEBUDDY_SAFE_DELETE_ENABLED=0`；完整命令输出见附录 A。

### 1.4 P1-1 ~ P1-7 实际实现核对（已验证）

| 阶段 | 声称内容 | 实际核对结论 | 证据 |
|---|---|---|---|
| P1-1 | 项目骨架 + Three.js 场景外壳 | **已实现** | `src/app/create-app.ts`、`src/app/render-config.ts`、`tests/browser/shell.spec.ts` |
| P1-2 | F450 实体 + 键盘飞行 | **已实现** | `src/flight/adapters/SimpleFlightController.ts`（283 行，固定步长/限速/姿态插值）、`tests/unit/simple-flight-controller.test.ts`(4)、`tests/browser/flight.spec.ts` |
| P1-3 | 通用 USB 手柄输入 + 校准 + 失联保护 | **已实现（硬件未验）** | `src/input/**`、`src/ui/controller-calibration.ts`(528 行)、`tests/unit/pilot-input-pipeline.test.ts`(7)；真实手柄仍 `PENDING_DEVICE_TEST` |
| P1-4 | 首个输电场景 + 真实安全距离引擎 | **已实现** | `src/scenes/SceneDefinition.ts`(167)、`src/safety/SafetyEngine.ts`(101)、`tests/unit/safety-engine.test.ts`(24) |
| P1-5 | 云台/拍照/照片校验/模拟 AI 任务闭环 | **已实现** | `src/camera/**`、`src/mission/MissionEngine.ts`(169)、`src/ai/MockInspectionAI.ts`(64)、`tests/browser/inspection-mission.spec.ts`(3) |
| P1-6 | 六维评分 + 遥测记录 | **已实现** | `src/scoring/ScoringEngine.ts`(456)、`src/scoring/SessionRecorder.ts`(300)、`tests/unit/scoring-engine.test.ts`(26) |
| P1-7 | 学员任务报告 + 持久化 + 教师查看 | **已实现** | `src/report/**`、`src/persistence/mission-report-store.ts`、`tests/unit/mission-report.test.ts`(16)、`tests/browser/report.spec.ts`(7) |

**结论：旧交付报告与当前代码状态一致，未发现「报告说完成但代码缺失」的情况。** 但旧文档本身存在漂移（见 G13）。

---

## 2. 模块与依赖关系（已验证）

```text
                         ┌──────────────────────────────┐
                         │  KeyboardInputAdapter        │
                         │  GamepadInputAdapter (USB)   │
                         └──────────────┬───────────────┘
                                        │ RawPilotInput
                          PilotInputAdapter (接口, 品牌中立)
                                        │
                              InputNormalizer  (min/center/max, 反向, 死区)
                                        │
                              ChannelMapper    (设备配置 → 通道, 失联→悬停)
                                        │
                            PilotInputPipeline (源优先级/新鲜度仲裁)
                                        │ PilotCommand
                                        ▼
                          FlightControllerAdapter (接口)
                                        │
                        SimpleFlightController (状态机 + 限速 + 姿态插值)
                                        │ FlightSnapshot
                                        ▼
   SceneDefinition ──► SafetyDistanceEngine ──► InspectionGeometryResult
        │(纯几何)              │(每帧, 最坏优先)          │
        │                      ▼                        │
        │              MissionEngine ◄──────────────────┘
        │              (IDLE→…→COMPLETE/FAILED)
        │                      │
        │        ┌─────────────┼──────────────┐
        │        ▼             ▼              ▼
        │  GimbalCamera  ProjectionPhoto   InspectionAIAdapter
        │                Validator          └─ MockInspectionAI
        │                      │
        │                      ▼
        │             InspectionCaptureRecord ──► InspectionCaptureStore (IDB)
        │                      │
        │                      ▼
        │                SessionRecorder ──► ScoreSession ──► ScoringEngine
        │                      │                                   │
        │                      ▼                                   ▼
        └──────────────► buildMissionReport ─────────────► MissionReport
                                   │                            │
                                   ▼                            ▼
                          MissionReportStore (IDB)      JSON 导出 / 打印
                                   │
                                   ▼
                       报告浮层（学员历史列表 / 教师只读详情）
```

**关键边界（已验证）**

1. `src/scenes/SceneDefinition.ts` 与 `src/safety/SafetyEngine.ts` **不 import three**，因此可在纯 Node 下单测（`safety-engine.test.ts` 24 例）。
2. `src/report/**` 与 `src/scoring/**` 同样不依赖 Three.js/DOM，报告可在 Node 中构建与解析。
3. 品牌中立性成立：`src/input/**` 内**没有**任何控制器品牌分支，品牌只存在于 `device-profile` 的用户配置数据里。
4. **唯一例外**：`src/app/create-app.ts`（1367 行）同时承担渲染、DOM 装配、任务编排、评分触发、报告装配、浮层 UI——它是全项目唯一的高耦合节点（见 R1）。

---

## 3. 主要模块责任 / 输入 / 输出 / 测试覆盖

| 模块 | 责任 | 输入 | 输出 | 测试 | 覆盖评价 |
|---|---|---|---|---|---|
| `flight/adapters/SimpleFlightController` | 飞行状态机、限速、姿态插值 | `PilotCommand`, `dt` | `FlightSnapshot` | 4 例 | **偏薄**（多状态分支，4 例不足以覆盖 `paused/emergency/goto/rtl` 交叉） |
| `input/InputNormalizer` | 原始通道归一化 | `RawPilotInput`, 轴配置 | 归一化通道 | 19 例 | 好 |
| `input/ChannelMapper` | 通道→指令、死区、失联悬停 | 归一化通道, profile, now | `PilotCommand` | 16 例 | 好 |
| `input/PilotInputPipeline` | 多源仲裁、新鲜度 | adapters, keyboard | `PilotCommand` + source | 7 例 | 中（无「双源同时在线」优先级冲突用例，见 R3） |
| `ui/controller-calibration` | 校准向导、profile 草稿 | DOM 事件 | `DeviceProfile` | 10 例 | 中（UI 逻辑占 528 行，仅 10 例纯函数测试） |
| `scenes/SceneDefinition` | 场景布局、导线弧垂采样、距离数学 | 纯参数 | 几何 + 采样点 | 14 例 | 好 |
| `safety/SafetyEngine` | 最坏情况安全分级 | 位置 | `InspectionGeometryResult` | 24 例 | 好 |
| `mission/MissionEngine` | 巡检任务状态机 | `MissionTelemetry` | `MissionState` + 拒绝原因 | 12 例 | 好 |
| `camera/GimbalCamera` | 云台角度限幅 | 按键增量 | pitch/yaw | 7 例 | 好 |
| `camera/ProjectionPhotoValidator` | 投影式照片质量判定 | `PhotoSample` | `PhotoValidationResult` | 10 例 | 好 |
| `ai/MockInspectionAI` | 确定性「模拟 AI」 | `InspectionAIInput` | `InspectionAIResult` | 4 例 | 中（**接口形状本身有缺陷**，见 G1） |
| `scoring/ScoringEngine` | 六维评分 + 硬上限 | `ScoreSession` | `MissionScoreResult` | 26 例 | 好 |
| `scoring/SessionRecorder` | 遥测/危险段/控制轨迹记录 | 每帧快照 | `ScoreSession` | 17 例 | 好 |
| `report/mission-report` | 报告装配、序列化、容错解析 | `ScoreSession` + captures + samples | `MissionReport` | 16 例 | 好 |
| `persistence/mission-report-store` | 报告 KV 持久化 | `MissionReport` | 摘要列表/详情 | 4 例 | 中（无「损坏记录混入」用例，见 R4） |
| `persistence/inspection-capture-store` | 照片证据 KV 持久化 | `InspectionCaptureRecord` | `list()` | **1 例** | **偏薄 + 实际未被读取**（G3） |
| `app/create-app` | 全量装配与 UI | 全部 | 全部 | 浏览器 23 例 | **无单测**（不可单测，见 R1） |

---

## 4. 七项重点系统的逐项分析

### 4.1 F450 模型与飞行控制

- **已有（已验证）**：`create-programmatic-f450.ts`(147) 程序化建模 + `load-f450.ts` GLB 加载回退；`SimpleFlightController` 实现 arm/takeoff/goto/setAltitude/setYaw/rtl/land/pause/resume/emergencyStop，水平限速 8 m/s、垂直 2.5 m/s、最大高度 50 m、最大姿态 18°、偏航 90°/s（`SimpleFlightController.ts:11-17`）。
- **缺失**：无风场/电池/电机模型，无 GPS 漂移、无姿态角速度耦合（roll 只影响视觉，不产生横向位移），无失控返航触发条件（仅手动 `rtl()`）。
- **待验证**：`teleport()` 是测试专用旁路（`SimpleFlightController.ts:125-141`），生产路径是否可能被误调用——目前仅经 `window.__fdeTeleport` 暴露，`已由现有测试支持`，但**无守卫断言**（建议加 R2 用例）。

### 4.2 遥控器输入与输入标准化

- **已有（已验证）**：`PilotInputAdapter` 接口、Gamepad 轮询、`InputNormalizer`（min/center/max/反向/死区）、`ChannelMapper`（失联→悬停、油门保持不归零）、`PilotInputPipeline`（源优先级 + 250 ms 新鲜度）、校准向导 + IndexedDB profile。
- **缺失**：**触控摇杆未实现**。`PilotInputType` 声明了 `'keyboard-touch'`（`PilotInputAdapter.ts:11`）但全仓库无 touch adapter —— 类型声明与实现不符（G11）。
- **重复**：无。
- **待验证**：真实硬件（RadioMaster EdgeTX / RadioLink AT9S / DJI FPV RC3 / CRSF-ELRS）仍 `PENDING_DEVICE_TEST`；模拟 Gamepad **不等于**硬件通过（`tests/browser/gamepad.spec.ts` 的 `test.fixme` 明确记录）。

### 4.3 电力巡检场景与任务状态机

- **已有（已验证）**：单一输电场景（铁塔 + 弧垂导线 + 障碍树 + 绝缘子串缺片缺陷 + 巡检区环）；`MissionEngine` 14 状态、状态推进**只依赖真实遥测**（非计时器）、碰撞无条件中止、拍摄质量由 validator 事后判定（差照片可重拍，这是教学核心）。
- **缺失**：仅 1 个场景、1 个巡检目标、1 种缺陷（`InspectionDefectType = 'MISSING_INSULATOR_DISC'`，`inspection/types.ts:32`）；无航点规划/航线剖面（G9）；无热成像（G8）。
- **待验证**：`MissionEngine.update()` 的 `RETURN` 分支只检查 `distanceToHome`，不检查高度/障碍——`推测` 返航途中穿塔不会失败（除 COLLISION 由 SafetyEngine 先判）。建议补一条用例确认。

### 4.4 云台、拍照与照片验证

- **已有（已验证）**：`GimbalCamera`（pitch/yaw 限幅）、I/K/J/L/C 教学按键、独立 `WebGLRenderTarget` 抓拍 → `dataUrl`、`ProjectionPhotoValidator` 六项判定（可见性/覆盖率/距离/角度误差/区域/安全）→ 具体中文拒绝原因。
- **缺失**：无遮挡可见比例计算（设计规格 §10 要求「无遮挡可见比例」，当前只有覆盖率）；无 Zoom；无主视图/FPV/云台三路相机分离。
- **待验证**：`coverageRatio` 是解析式投影估算，非像素测量——`已由现有测试支持`（10 例），但**「照片质量」与真实画面观感是否一致**属 `尚未确认`（需人工目视比对，见证据缺口 E3）。

### 4.5 MockInspectionAI 与未来真实模型的接口边界 ⚠ 核心问题

- **已有（已验证）**：`InspectionAIAdapter` 接口 + `MockInspectionAI`（确定性置信度，无 `Math.random`）+ UI 明确标注「模拟 AI / 非真实 YOLO」。
- **缺失 / 缺陷（这是本轮最重要的发现）**：

  1. **接口无图像输入**。`InspectionAIInput`（`inspection/types.ts:55-61`）只有 `targetId / defectType / distanceToTarget / angleErrorDeg / coverageRatio`，**没有 image/blob/pixels 字段**。真实模型无法接入。
  2. **真值标签泄漏**。`create-app.ts:475` 把 `layout.target.defectType`（场景预置的标准答案）直接传入 AI；`MockInspectionAI.ts:39-40` 的判定就是 `input.defectType === this.config.defectType`。也就是说「检测」等于「把答案和答案比一次」。作为教学演示可接受，但**作为 AI 契约是错的**：任何真实模型若沿用此接口，必然被标签泄漏污染，指标会虚高。
  3. **结果类型锁死**。`InspectionAIResult.source` 类型是字面量 `'mock'`（`inspection/types.ts:69`），无法表达 `'real'` 或 `'unavailable'`。
  4. **与设计规格不符**。设计规格 §15 定义的接口是 `analyze(image: Blob): Promise<InspectionAIResult>`，返回 `status: 'mock' | 'real' | 'unavailable'` 与 `detections[]`（含 bbox）。当前实现是**规格漂移**，不是「规格允许的简化」。

- **结论**：`已验证` —— 当前 AI 边界是 **mock-shaped**，接真实模型前必须改接口。这是 G1/G2，也是下一阶段唯一建议的优先任务。

### 4.6 六维评分、任务记录与学员报告

- **已有（已验证）**：`ScoringEngine` 六维（25/25/15/15/10/10）、危险段按「连续停留计一次 + 时长扣分」、碰撞/失败硬上限 59、`SessionRecorder` 记录路径/高度/危险段/满舵次数/反向次数/悬停偏差 + 有界控制轨迹（200 ms / 最多 600 点）；`buildMissionReport` 只从真实 `ScoreSession` + captures + samples 装配，空数据显示「无记录」。
- **缺失**：无「故障判断」维度（设计规格 §13 原为 25/25/20/20/10，含故障判断 20 分）——当前六维**没有学生自主判断环节**（G7）；无评分规则版本号（规则改动后旧报告无法解释，见 R5）。
- **重复**：`photoValidation` 同时存在于 `InspectionCaptureRecord`、`ScoreCaptureAttempt`、`ReportCaptureEntry`（三处同源派生，可接受）；但 `missionCaptures`（内存数组）与 `InspectionCaptureStore`（IDB）是**同一批数据的双份真源**，且报告只读内存版（G3）。
- **待验证**：评分规则未与「教学大纲/评分标准」做外部校准，属 `推测` 合理性。

### 4.7 教师查看与历史任务恢复

- **已有（已验证）**：报告浮层含「学员/教师」角色切换、教师只读提示（`create-app.ts:236`：「教师查看模式为只读…本机未实现多用户隔离」）、历史列表按 `createdAt` 倒序、详情含六维/照片/危险事件/建议。
- **缺失**：无教师复核状态与备注持久化（设计规格 §14 要求 `教师复核状态与备注`）；无按学员/班级检索；无任务下发（教师设置正常/指定/随机缺陷）；**无路径回放**（G5）；**无未完成会话恢复**（G6）。
- **重复**：无。
- **待验证**：刷新后报告可从 IDB 恢复（`已由现有测试支持`——`mission-report-store` 4 例 + 浏览器 CASE5 导出比对），但**照片是否随报告一起恢复**取决于报告内嵌 `photoDataUrl`（是内嵌的），这一点 `已验证`。

---

## 5. 功能差距清单（AI 分析模板，9 字段）

> 优先级：**P0** = 阻塞下一阶段正确性；**P1** = 教学闭环明显缺口；**P2** = 增强；**P3** = 明确不做（本阶段）

### G1 · 巡检 AI 接口无图像输入（含真值标签泄漏）

| 字段 | 内容 |
|---|---|
| 功能名称 | 真实缺陷识别适配器边界 |
| 参考资料来源 | 本项目设计规格 §15（`analyze(image: Blob)`） |
| 可观察到的实际行为 | `已验证`：`InspectionAIInput` 无图像字段（`inspection/types.ts:55-61`）；`create-app.ts:475` 传入场景标准答案 `layout.target.defectType`；`MockInspectionAI.ts:39-40` 用它做等值比较 |
| 推测内容及不确定性 | `尚未确认`：真实模型接入后精度会虚高到何种程度（取决于泄漏字段是否被模型使用）；`推测` 若只喂几何量，模型等价于查表 |
| 用户需求 | 未来接 YOLO 类模型时，任务循环不重写；指标可信 |
| 独立实现方案 | 新增 `image?: Blob`（或 `ImageBitmap`）+ **移除** `defectType`；结果改 `source: 'mock' \| 'real' \| 'unavailable'`；`MockInspectionAI` 改为仅凭几何 + 场景注册表判定，不再读入参真值；`create-app` 传 `photoDataUrl` 而非答案 |
| 验收条件 | 契约测试断言：输入不含 `defectType`；`source` 三态可编译；mock 在给定几何下结果与改造前**逐字段一致**（回归等价）；真实模型未接入时 `source='mock'` 且 UI 标签不变 |
| 对应自动化测试 | `tests/unit/inspection-ai-contract.test.ts`（新增）+ 改造 `mock-inspection-ai.test.ts`；浏览器 `inspection-mission.spec.ts` 保持绿 |
| 优先级 | **P0** |

### G2 · AI 结果类型无法表达「真实/不可用」

| 字段 | 内容 |
|---|---|
| 功能名称 | AI 结果来源与降级表达 |
| 参考资料来源 | 本项目设计规格 §15（`status: 'mock' \| 'real' \| 'unavailable'`） |
| 可观察到的实际行为 | `已验证`：`InspectionAIResult.source: 'mock'` 为字面量类型（`inspection/types.ts:69`） |
| 推测内容及不确定性 | `推测`：若真实模型加载失败，当前代码只能抛异常或返回假阴性，无「不可用」态，学员会误以为「无缺陷」 |
| 用户需求 | 模型缺失/加载失败时教学流程不中断，且明确告知 |
| 独立实现方案 | 三态 `source`；`MissionEngine.submitAI` 接受 `unavailable` 时进入 `INSPECTION_COMPLETE` 但在报告中标「AI 不可用，需人工判读」 |
| 验收条件 | 单测覆盖三态；报告 JSON 保留 `source`；UI 对 `unavailable` 显示独立文案（不得显示为「未检出缺陷」） |
| 对应自动化测试 | `mission-report.test.ts` 增 1 例；`mock-inspection-ai.test.ts` 增 1 例 |
| 优先级 | **P0**（与 G1 同批） |

### G3 · 照片证据只写不读，报告依赖内存数组

| 字段 | 内容 |
|---|---|
| 功能名称 | 照片证据的持久化读取与恢复 |
| 参考资料来源 | 本项目设计规格 §14（记录与图片保存 IndexedDB 并可按逻辑路径取回） |
| 可观察到的实际行为 | `已验证`：`create-app.ts:502` 调 `captureStore.save(record)`；全文件**没有** `captureStore.list()` 调用；报告改用内存数组 `missionCaptures`（声明于 `:309`，写入于 `:504`，装配于 `:597`，重置于 `:925`） |
| 推测内容及不确定性 | `已验证`：刷新后无法从 IDB 重建照片列表（报告本身内嵌照片，故单份报告不丢图）；`推测` 存储会无界增长（无清理/上限） |
| 用户需求 | 历史任务的照片可回溯；存储不无限膨胀 |
| 独立实现方案 | 报告构建改为 `await captureStore.list()` 按 `missionId` 过滤；或在 `MissionReport` 落库后清理已归档 capture（保留 N 份）；两者择一，**先测后改** |
| 验收条件 | 刷新页面后打开历史报告，照片数量与拍摄次数一致；新增单测覆盖「按 missionId 过滤」与「无记录返回空」 |
| 对应自动化测试 | `inspection-capture-store.test.ts` 由 1 例扩到 ≥4 例；`report.spec.ts` 增刷新恢复用例 |
| 优先级 | **P1** |

### G4 · 无课程档案 ZIP / 逻辑目录导出

| 字段 | 内容 |
|---|---|
| 功能名称 | 课程档案导出（`sessions/{id}/session.json` + `photos/`） |
| 参考资料来源 | 本项目设计规格 §14 |
| 可观察到的实际行为 | `已验证`：仅实现单文件 JSON 导出（`exportCurrentReport`），无 ZIP、无目录结构 |
| 推测内容及不确定性 | `推测`：教师批量收作业时需要逐份下载，操作成本高 |
| 用户需求 | 一次导出一份完整档案，含照片原图 |
| 独立实现方案 | 不引入 zip 库（避免大依赖）：用 `JSZip` 属新增依赖，需用户批准；**替代方案**为「导出目录清单 + 多文件下载」或浏览器 File System Access API（`showDirectoryPicker`），降级到单 JSON |
| 验收条件 | 导出的 `session.json` 可被 `parseReport` 还原；照片文件名与报告内索引一一对应；无 File System Access 支持时优雅降级 |
| 对应自动化测试 | 单测覆盖清单生成；浏览器覆盖「降级路径不报错」 |
| 优先级 | **P2**（依赖需批准） |

### G5 · 无飞行路径回放

| 字段 | 内容 |
|---|---|
| 功能名称 | 历史任务路径回放 |
| 参考资料来源 | 本项目设计规格 §14（「路径回放从已保存的 flightPath 生成，不重新计算飞行」） |
| 可观察到的实际行为 | `已验证`：`SessionRecorder` 只累计 `pathLengthM`（标量），**不保存轨迹点序列**；报告无轨迹字段 |
| 推测内容及不确定性 | `推测`：教师复核时无法判断「是飞行失误还是判定失误」 |
| 用户需求 | 复盘可看飞行轨迹与危险段位置 |
| 独立实现方案 | `SessionRecorder` 增有界轨迹采样（复用控制轨迹的 200 ms/600 点上限策略），写入 `MissionReport.trajectory`；前端用现有 Three.js 场景画折线回放，**不重算物理** |
| 验收条件 | 报告 JSON 含轨迹点；回放折线与记录点完全一致（逐点比对）；旧报告无轨迹时显示「无记录」 |
| 对应自动化测试 | `session-recorder.test.ts` +3；`mission-report.test.ts` +2；浏览器 +1 |
| 优先级 | **P2** |

### G6 · 无未完成任务恢复

| 字段 | 内容 |
|---|---|
| 功能名称 | 刷新后恢复未完成任务 |
| 参考资料来源 | 本项目设计规格 §14 |
| 可观察到的实际行为 | `已验证`：任务状态仅在内存；刷新即回 `IDLE`；只有**已完成**的报告落库 |
| 推测内容及不确定性 | `推测`：学员误刷新会丢失整段训练，教学体验差 |
| 用户需求 | 意外刷新可继续 |
| 独立实现方案 | 任务结束/每 N 秒快照 `MissionEngine` 状态 + 飞行位姿 + 已拍记录到 IDB；启动时询问「继续/放弃」。**风险**：状态机反序列化易产生非法中间态，需白名单校验 |
| 验收条件 | 刷新后可恢复到同一状态且拒绝非法快照；恢复后评分与不刷新一致（同输入同分） |
| 对应自动化测试 | 单测覆盖快照/恢复/非法快照；浏览器覆盖「刷新→继续→完成」 |
| 优先级 | **P2** |

### G7 · 仅 1 种缺陷，且无学员自主缺陷判断环节

| 字段 | 内容 |
|---|---|
| 功能名称 | 多缺陷类型 + 学员判读 |
| 参考资料来源 | 本项目设计规格 §11（8 类缺陷、学生选择正常/疑似异常）与 §13（故障判断 20 分） |
| 可观察到的实际行为 | `已验证`：`InspectionDefectType` 只有 `'MISSING_INSULATOR_DISC'`；六维评分中**无故障判断维度**；学员只按提示飞到点、对准、拍照，AI 直接给结论 |
| 推测内容及不确定性 | `推测`：这使「教学」退化为「按步骤操作」，学员未练习判读能力——这是与真实巡检教学目标最大的差距 |
| 用户需求 | 学员应自己判断有无缺陷、是什么缺陷 |
| 独立实现方案 | 扩展 `InspectionDefectType` 为联合类型；任务定义含「本场景预置缺陷（可为 null=正常）」；拍照后弹「判读」步骤（正常 / 疑似异常 + 类型选择），与 AI 结果比对，新增第 7 维或调整现有权重（**需用户批准改评分规则**） |
| 验收条件 | 判读正确/错误/漏判三种路径各有明确评分与文案；AI 结果与学员判读**分别记录**，不互相覆盖 |
| 对应自动化测试 | `mission-engine.test.ts` +4（判读状态）；`scoring-engine.test.ts` +5；浏览器 +2 |
| 优先级 | **P1**（但改评分权重需单独批准） |

### G8 · 无热成像模式

| 字段 | 内容 |
|---|---|
| 功能名称 | RGB / THERMAL 切换与热点判定 |
| 参考资料来源 | 本项目设计规格 §11 |
| 可观察到的实际行为 | `已验证`：全仓库无 `thermal` / 热成像 相关代码 |
| 推测内容及不确定性 | `尚未确认`：是否属于 V1 必需项（规格写了，但计划 Task 1-7 未列入） |
| 用户需求 | 覆盖红外巡检教学场景 |
| 独立实现方案 | 材质覆盖实现假彩色 + 热点标记；判定复用 `ProjectionPhotoValidator` 的「热点是否入画」，**不显示伪造摄氏温度** |
| 验收条件 | 切换不改变主画面；热点判定有独立拒绝原因；文案明确「模拟热源，非真实测温」 |
| 对应自动化测试 | 单测（热点投影）+1 文件；浏览器 +1 |
| 优先级 | **P2** |

### G9 · 无航点规划与航线剖面

| 字段 | 内容 |
|---|---|
| 功能名称 | RoutePlanner / 航点规划 |
| 参考资料来源 | 本项目设计规格 §9（明确「V1 只保留 `RoutePlanner` 接口和直线段安全验证」） |
| 可观察到的实际行为 | `已验证`：无 `RoutePlanner`、无航点数据结构、无剖面图；`SimpleFlightController.goto()` 存在但无规划器调用 |
| 推测内容及不确定性 | `推测`：规格自身把 A* 排除在 V1 外，故「无 A*」不算缺陷；但「无 RoutePlanner 接口」是**规格未落地** |
| 用户需求 | 学员练习航线设计 |
| 独立实现方案 | 先只做**接口 + 直线段安全校验**（纯函数），不做 UI；有 UI 需求时再加俯视规划图 |
| 验收条件 | 接口有单测；非法航点（超高/穿塔/超距）返回明确原因 |
| 对应自动化测试 | `tests/unit/route-planner.test.ts`（新增） |
| 优先级 | **P2** |

### G10 · 无教师任务设置（正常 / 指定缺陷 / 随机缺陷）

| 字段 | 内容 |
|---|---|
| 功能名称 | 教师下发任务参数 |
| 参考资料来源 | 本项目设计规格 §11（「教师可在开始前选择正常、指定缺陷或随机缺陷任务」） |
| 可观察到的实际行为 | `已验证`：`MockInspectionAI` 的 `targetId/defectType` 由 `layout.target` 硬编码（`create-app.ts:300-303`）；UI 无教师设置面板 |
| 推测内容及不确定性 | `推测`：「随机缺陷」若用 `Math.random` 会破坏测试确定性，必须用**可播种**随机 |
| 用户需求 | 同一场景可出不同题 |
| 独立实现方案 | `MissionConfig` 增 `defectMode: 'none' \| 'fixed' \| 'seeded-random'` + `seed`；随机用确定性 PRNG；报告记录 `seed` 以便复现 |
| 验收条件 | 同 seed 同题；`none` 时 AI 返回未检出且学员判读「正常」得分；报告含 seed |
| 对应自动化测试 | 单测（PRNG 确定性、三模式）；浏览器 +1 |
| 优先级 | **P1**（与 G7 同批更经济） |

### G11 · 触控摇杆缺失（类型声明与实现不符）

| 字段 | 内容 |
|---|---|
| 功能名称 | 移动端触控飞行 |
| 参考资料来源 | 本项目设计规格 §16（移动端「触控摇杆」）；`PilotInputType` 含 `'keyboard-touch'` |
| 可观察到的实际行为 | `已验证`：`PilotInputAdapter.ts:11` 声明 `'keyboard-touch'`；全仓库无 touch/pointer 输入适配器；移动端仅能看不能飞 |
| 推测内容及不确定性 | `已验证`：移动端浏览器用例（`*-mobile-chrome`）只验证「可查看」，不验证「可操纵」 |
| 用户需求 | 平板/手机可完成训练 |
| 独立实现方案 | 新增 `TouchJoystickAdapter implements PilotInputAdapter`，复用现有 `InputNormalizer`/`ChannelMapper`，**不改飞行层**；或先把类型改为 `'keyboard' \| 'gamepad' \| 'receiver-bridge'` 消除假声明（最小修复） |
| 验收条件 | 触控输入产生与手柄同构的 `PilotCommand`；失联/抬起归中；无触摸设备不报错 |
| 对应自动化测试 | `tests/unit/touch-joystick-adapter.test.ts`（新增）；浏览器移动端 +1 |
| 优先级 | **P2**（若先做最小修复消声明，则 **P1 文档**） |

### G12 · 教师复核状态/备注未持久化

| 字段 | 内容 |
|---|---|
| 功能名称 | 教师复核（状态 + 备注） |
| 参考资料来源 | 本项目设计规格 §14 |
| 可观察到的实际行为 | `已验证`：教师视图为**纯只读**（`create-app.ts:236`），无复核状态字段、无备注输入、无持久化 |
| 推测内容及不确定性 | `已验证`：报告类型 `MissionReport` 无复核相关字段 |
| 用户需求 | 教师批注「已复核/需重做」并留存 |
| 独立实现方案 | `MissionReport` 增 `review?: { status, note, reviewedAt }`；`schemaVersion` 保持 1（可选字段，向后兼容）；教师视图加备注框 + 保存 |
| 验收条件 | 保存后刷新仍在；旧报告无该字段时不报错；导出 JSON 含复核信息 |
| 对应自动化测试 | `mission-report.test.ts` +2（含旧报告兼容）；浏览器 +1 |
| 优先级 | **P2** |

### G13 · 文档漂移（README / ARCHITECTURE / 规格 vs 实现）

| 字段 | 内容 |
|---|---|
| 功能名称 | 文档与实现一致性 |
| 参考资料来源 | 仓库内文档本身 |
| 可观察到的实际行为 | `已验证` 三处：① `README.md:22` 仍写「当前阶段：P1-1 项目骨架」；② `ARCHITECTURE.md:11,13` 列出**不存在**的 `InspectionEngine` 与 `SessionRepository`；③ 设计规格 §13 评分为 25/25/20/20/10，实现为六维 25/25/15/15/10/10（P1-6 已获批变更，但规格未同步） |
| 推测内容及不确定性 | `推测`：新加入者会按幽灵模块名找代码，浪费工时；验收方会误判「评分被擅自改动」 |
| 用户需求 | 文档可作为唯一事实源 |
| 独立实现方案 | 仅改文档：README 更新到 P1-7；ARCHITECTURE 用真实模块名重画（本文章节 2 可直接复用）；规格 §13 加「P1-6 变更说明」而非改写历史 |
| 验收条件 | 文档中出现的每个模块名在 `src/` 下都存在（可用脚本校验） |
| 对应自动化测试 | 可选：`tests/unit/docs-module-names.test.ts` 读文档 + `fs.existsSync` 校验（低成本、高收益） |
| 优先级 | **P1（文档，零风险）** |

### G14 · 仅 1 个场景（明确 out of scope）

| 字段 | 内容 |
|---|---|
| 功能名称 | 多场景（变电站/变压器/避雷器） |
| 参考资料来源 | 本项目设计规格 §11 |
| 可观察到的实际行为 | `已验证`：仅 `transmission` 一个场景目录 |
| 推测内容及不确定性 | — |
| 用户需求 | 后续扩展 |
| 独立实现方案 | **本阶段不做**。先把场景注册表抽象出来（`SceneDefinition` 已足够纯），新增场景时不改安全/评分/报告 |
| 验收条件 | 新增第 2 场景时 `ScoringEngine` 零改动（架构验收，非功能验收） |
| 对应自动化测试 | 现有 `transmission-layout.test.ts` 保持绿 |
| 优先级 | **P3** |

### G15 · 真实硬件验收未完成

| 字段 | 内容 |
|---|---|
| 功能名称 | 真实遥控器上机验收 |
| 参考资料来源 | `tests/browser/gamepad.spec.ts` 的 `test.fixme` 说明 |
| 可观察到的实际行为 | `已验证`：唯一跳过项即 `PENDING_DEVICE_TEST`；模拟 Gamepad 通过 ≠ 硬件通过 |
| 推测内容及不确定性 | `尚未确认`：真实设备轴序/死区/反向是否与默认 profile 匹配 |
| 用户需求 | 教学现场可用真实遥控器 |
| 独立实现方案 | 按 `gamepad.spec.ts` 记录的流程上机；结果写入 `TEST_REPORT.md`；不通过则调整 `device-profile` 默认值 |
| 验收条件 | 4 款目标遥控器至少 1 款完成 arm/takeoff/移动/降落全流程；失联拔线 → 悬停 |
| 对应自动化测试 | `test.fixme` 改为正式用例（需人工在环，保留 skip 说明） |
| 优先级 | **P0（外部依赖，非代码）** |

---

## 6. 高发回归点与建议测试

| 编号 | 回归点 | 原因 | 现有覆盖 | 建议 |
|---|---|---|---|---|
| R1 | `create-app.ts`（1367 行）任何改动 | 渲染/编排/UI/持久化混在一个闭包，无单测，只能靠浏览器端到端 | 23 个浏览器用例（×2 设备） | 每次改动必须跑全量浏览器套件；**不做大重构**，只按阶段外提纯函数 |
| R2 | 测试专用旁路被生产路径调用（`teleport` / `__fde*` 全局） | 旁路可绕过物理与安全判定 | 无守卫断言 | 加单测：非测试环境访问 `window.__fde*` 返回 undefined，或 `teleport` 需显式 flag |
| R3 | 多输入源仲裁（手柄 + 键盘同时在线） | 优先级/新鲜度逻辑分支多 | 7 例，无「双源冲突」 | 补 2 例：手柄新鲜→用手柄；手柄过期→回键盘且油门保持 |
| R4 | 报告存储混入损坏/异构记录 | `isReport` 只查 3 个键，浅校验 | 4 例，无脏数据用例 | 补：写入 `{schemaVersion:1,reportId:'x',score:null}` → `list()` 应跳过而非崩溃 |
| R5 | 评分规则变更后旧报告不可解释 | 报告无 `scoreConfigVersion` | 无 | 增 `scoreConfigVersion` 字段 + 报告显示「按 vN 规则计分」 |
| R6 | 危险段「连续停留计一次」边界 | 帧采样抖动可能导致段被切碎或合并 | 26 例，含段计数 | 补：同一 DANGER 中间夹 1 帧 SAFE 时是否应算 2 段（当前语义需明确并锁死） |
| R7 | 照片 `dataUrl` 体积 | 每张 PNG 内嵌进报告，多拍会撑爆 IDB | 无 | 补：连续 10 次拍摄后报告体积上限断言（或改存 Blob 引用） |

---

## 7. 建议优先级（本轮建议）

| 顺序 | 事项 | 类型 | 理由 |
|---|---|---|---|
| 1 | **G1 + G2：AI 适配器边界改造** | P0 代码 | 唯一「不改就永远接不了真实模型」的硬阻塞；范围小（3 源文件 + 2 测试），不碰评分/飞行/状态机 |
| 2 | G13：文档漂移修正 | P1 文档 | 零风险，且能防止后续验收误判 |
| 3 | G3：照片证据读取 + 存储上限 | P1 代码 | 数据已写入却不用，属「半成品」；影响教师复核可信度 |
| 4 | G7 + G10：多缺陷 + 学员判读 + 教师出题 | P1 代码（需批准改评分） | 教学价值最大，但触及评分权重，必须单独批准 |
| 5 | G12 / G11 最小修复 / G4 / G5 / G6 / G8 / G9 | P2 | 增强项，逐项排期 |

**不建议现在做的**：多场景（G14）、引擎迁移、任何大依赖（zip/模型运行时）、整项目重构。

---

## 8. 证据缺口（尚未确认）

| 编号 | 缺口 | 影响 | 补齐方式 |
|---|---|---|---|
| E1 | 无易飞界面/演示资料 | 无法做「参考行为」对照，本文档所有外部参照为空 | 用户提供合法可访问的截图/公开演示 |
| E2 | 真实遥控器未上机 | 输入层硬件兼容性未知 | 现场 `PENDING_DEVICE_TEST` |
| E3 | 照片质量判定未与真实画面目视比对 | 「合格照片」的教学说服力未知 | 人工抽检 10 张合格/不合格截图 |
| E4 | 评分规则未与教学大纲校准 | 分数是否反映真实水平未知 | 教师评审 5 份样例报告 |
| E5 | 报告体积/IDB 配额未实测 | 长时间使用可能写失败 | 压测 50 份报告 + 每份 10 张图 |
| E6 | 移动端真实设备（非 Chromium 模拟）未验 | 触控/性能未知 | 真机手测 |

---

## 附录 A：本轮实测命令输出（2026-10-17，不引用历史报告）

### A.1 单元测试 `npm test`

```text
 ✓ tests/unit/controller-calibration.test.ts (10 tests)
 ✓ tests/unit/pilot-input-pipeline.test.ts (7 tests)
 ✓ tests/unit/mock-inspection-ai.test.ts (4 tests)
 ✓ tests/unit/gimbal-camera.test.ts (7 tests)
 ✓ tests/unit/inspection-capture-store.test.ts (1 test)
 ✓ tests/unit/render-config.test.ts (2 tests)

 Test Files  19 passed (19)
      Tests  213 passed (213)
   Duration  6.63s
```

按文件用例数：channel-mapper 16、controller-calibration 10、gamepad-input-adapter 8、gimbal-camera 7、input-normalizer 19、inspection-capture-store 1、mission-engine 12、mission-report-store 4、mission-report 16、mock-inspection-ai 4、pilot-input-pipeline 7、profile-store 12、projection-photo-validator 10、render-config 2、safety-engine 24、scoring-engine 26、session-recorder 17、simple-flight-controller 4、transmission-layout 14。

### A.2 浏览器测试 `CODEBUDDY_SAFE_DELETE_ENABLED=0 npx playwright test`

```text
  1 failed
    [desktop-chrome] › tests/browser/inspection-mission.spec.ts:226:3 ›
    CASE3: the mission runs to completion and failure is real
    Error: EPERM: operation not permitted, open
    'D:\FDE-Power-Inspection-Simulator\screenshots\p1-5-complete-desktop-chrome.png'
  2 skipped
  45 passed (4.1m)
```

**定性**：该失败是沙箱 broker 拒绝写入截图（`file-write` 被拦），**不是断言失败**——用例在写图前已走完全流程。单独重跑该 spec 确认：

```text
Running 3 tests using 1 worker
  ok 1 [desktop-chrome] CASE1: gimbal keyboard control and the capture gate (2.9s)
  ok 2 [desktop-chrome] CASE2: a bad photo is rejected and retried; a good one reaches the AI (8.0s)
  ok 3 [desktop-chrome] CASE3: the mission runs to completion and failure is real (15.7s)
  3 passed (36.5s)
```

**结论**：浏览器套件实际状态 = **48 通过 / 2 跳过**（含重跑的 3 条），无功能回归。2 个跳过项即 `tests/browser/gamepad.spec.ts` 的 `test.fixme`（真实硬件 `PENDING_DEVICE_TEST`），全仓库无其他 skip。

### A.3 构建 `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build`

```text
✓ 34 modules transformed.
dist/index.html                   0.55 kB │ gzip:   0.38 kB
dist/assets/index-D_0_dSc-.css   15.06 kB │ gzip:   3.79 kB
dist/assets/index-BYhXDdrM.js   589.40 kB │ gzip: 155.40 kB
(!) Some chunks are larger than 500 kB after minification.
✓ built in 2.89s
```

`tsc -b` 无错误；唯一警告为预存的 three.js 未拆分块（>500 kB），属既有状态，本轮未引入新依赖。

### A.4 环境注意事项（已验证）

- 沙箱内 Vite 清空 `dist/` 与 Playwright 写截图偶发 `EPERM / ETIMEDOUT`，需设 `CODEBUDDY_SAFE_DELETE_ENABLED=0`；这是环境产物，不是应用缺陷。
- 单条用例若因写图失败，应重跑该 spec 确认，**不得**据此放宽断言。
