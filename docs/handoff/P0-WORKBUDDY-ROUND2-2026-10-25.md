# FDE P0 第二轮开发报告（RC Flake 修复 + P0-B／科目 E 只读核查）

- 日期：2026-10-25（Asia/Shanghai）
- 执行者：WorkBuddy（执行工程师）
- 工作树：`D:/FDE-Power-Inspection-Simulator-P0`（分支 `codex/fde-p0-visibility`）
- 本轮性质：经批准的 5 项任务全部完成；**未开始 P0-B 或科目 E 的正式功能修改**。

---

## 一、执行摘要

| 批准项 | 状态 | 结论 |
|---|---|---|
| 1. RC 移动端测试偶发失败根因分析 | ✅ 完成 | 双机制竞争（段落错位 + 录制窗口溢出），均为测试时序问题，非产品缺陷 |
| 2. 严格隔离条件下修复测试同步机制 | ✅ 完成 | 仅改 `rc-calibration-visibility.spec.ts` 一个测试的同步机制（+65/−18） |
| 3. 重新执行相关回归测试 | ✅ 完成 | 定向重复 20/20 + **全量回归 119 passed / 9 skipped / 0 failed** |
| 4. P0-B 机体尺寸与考试标准只读核查 | ✅ 完成 | 现状基本合规（对角 1.00m ∈ 90–110cm）；发现 2 项待裁决缺口 |
| 5. 科目 E 现有代码与功能缺口只读核查 | ✅ 完成 | config 层已备、判定/型别/UI/几何四层缺失；缺口清单如下 |

**唯一源码改动**：`tests/browser/rc-calibration-visibility.spec.ts`（测试同步机制）。
**未 commit**（留待架构师裁示）。

---

## 二、执行前状态确认（本轮实测）

| 项目 | 实测值 |
|---|---|
| P0 分支 / HEAD | `codex/fde-p0-visibility` / `eb242c74d247974239515b7bc676ac7807e96f47`（= eb242c7，符合预期） |
| P0 `git status --short` | 仅 3 个 untracked（handoff 报告） |
| 主工作树 | `phase1-mvp` / `fd45e607b…`，6 modified + 1 untracked，与接棒记录一致（唯读未动） |
| 4173 预览服务 | PID 16620 LISTENING（接棒时已在运行） |
| 端口 | 4173 已占用（即本服务）；8111 / 8013 无监听 |

---

## 三、任务 A-1：RC Flake 根因分析

### 3.1 失败点

`tests/browser/rc-calibration-visibility.spec.ts:456`
「recording suggestion applies only the channel that differs」，
mobile-chrome 项目，全量套件下偶发失败，单独重跑必过。

### 3.2 机制梳理（读码结论）

- 采样：`controller-calibration.ts` `setInterval(tick, 60ms)` → `recordSample()` 每 tick 推入一帧原始通道；
- 录制停止：`startRecording()` 的 `setTimeout(stopRecording, durationMs)`；
- 测试加速手段（修复前）：init script 覆写 `window.setTimeout`，把页面所有 `>= 9000ms` 的计时器压到 **1800ms**；
- 推杆驱动（修复前）：Node 端 `pushAxis()`（evaluate）+ `waitForTimeout(400)` × 4 段，共 1600ms；
- 判定：`recording-suggestion.ts` 的 `segmentMeanDeviations()` 按**样本索引前 25%** 切「上」段落（非时间轴），`pick(0)` 要求该段均值 ≥ 0.2；`axisPeaks()` 以**首样本**为基线。

### 3.3 确定性复现证据（不依赖运气）

将失败测试复制为临时探针，仅注入「按录制后等待 600ms 再首次推杆」（模拟全量套件负载下的 Node→浏览器 roundtrip 延迟），其余不动：

```
右桿上下：未偵測到峰值 ≥ 0.70 的軸對應「右桿上下」：請推到底重錄。
右桿左右：未偵測到峰值 ≥ 0.70 的軸對應「右桿左右」：請推到底重錄。
data-verdict="invalid"
```

与历史全量套件故障訊息**逐字一致**。

### 3.4 根因（双机制，皆为测试时序）

1. **段落错位**：负载下首段推杆延迟落地 →「上」段落（样本前 25%）只取到静止值 → 均值 ≈ 0 < 0.2 → `pick(0)` 返回 null → 建议 invalid。
2. **窗口溢出**：推杆总时长（含延迟）超过被压缩的 1800ms 录制窗口 → 尾部推送从未被采样。

补充实测：干净环境 + 4 进程 CPU 压力下，**原测试 12/12 通过**——纯 CPU 压力不足以复现，故障需要 roundtrip 延迟型负载（全量套件特有）。这解释了为何「单独重跑必过」。

---

## 四、任务 A-2：最小修复（仅测试同步机制）

### 4.1 改了什么（`tests/browser/rc-calibration-visibility.spec.ts`，+65/−18）

1. **录制窗口**：由 `setTimeout` 覆写（压到 1800ms）改为正式测试接缝 `window.__fdeRecordingDurationMs = 8000`（`controller-calibration.ts` 既有 documented seam），不再波及页面其他计时器。
2. **推送排程**：4 段推杆从「Node 端逐段 evaluate」改为「浏览器端一次 evaluate 内完成」，并以录制状态文字（`RECORDING_PROMPT` 含「畫圈」，`startRecording` 同步写入）为锚点；排程前留 **400ms 静止引导段**确保峰值基线为静止值；四段各 1500ms，合计 6400ms < 8000ms 窗口，余量 1600ms。
3. 首条建议断言超时 8s → 15s（录制窗口变长后的相应调整）。

### 4.2 明确未动（红线）

- ❌ 未降低 `SUGGESTION_MIN_PEAK`（仍为 0.7）；
- ❌ 未跳过、删除或 skip 任何测试；
- ❌ 未修改 `recording-suggestion.ts` / `controller-calibration.ts` 的真实 RC 校准算法；
- ❌ 未改任何产品源码（`git diff` 仅一个测试文件）。

---

## 五、任务 A-3：重复定向重跑与全量回归（本轮实测）

| 轮次 | 配置 | 结果 |
|---|---|---|
| 原测试 · CPU 压力 | mobile-chrome，repeat-each=12，4 进程压力 | 12 passed（证明纯压力不触发） |
| 探针复现 | mobile-chrome，注入 600ms 延迟 | **1 failed**（历史签名，证据固化） |
| 修复后 · 单次 | mobile-chrome | 1 passed（11.8s） |
| 修复后 · 干净重复 | mobile-chrome，repeat-each=10 | **10 passed**（2.5m） |
| 修复后 · 压力重复 | mobile-chrome，repeat-each=10，4 进程压力 | **10 passed**（3.0m） |
| **全量回归** | desktop-chrome + mobile-chrome 全 13 个 spec | **119 passed / 9 skipped / 0 failed**（11.0m） |

**对比封存值**：修复前全量 118 passed / 9 skipped / **1 failed** → 修复后 **119 / 9 / 0**（118+1=119，即唯一失败项转绿）。该测试在全量输出中为 `rc-calibration-visibility.spec.ts:456`（9.8s 通过）。

测试基建说明：全量回归经临时配置 `playwright.reuse.config.ts`（`webServer: undefined`，复用 4173 上既有预览服务，其余与基底一致）执行，**已删除**；基底 `playwright.config.ts` 未改。教师预览服务全程未重启（回归复用它）。

---

## 六、任务 D-1：P0-B 机体尺寸与考试标准只读核查

### 6.1 官方标准（config 记载，附出处）

`config/exam-aircraft.json`／`config/caa-exam.json .aircraft`：

| 参数 | 值 | 来源 |
|---|---|---|
| 对角马达轴心距离 | **90–110cm**（默认 100cm） | 管理規則附件十二 級別I（PDF p35／印刷頁33），官方原文「對角馬達之軸心距離介於九十公分至一百一十公分」 |
| 起飛重量 | **≥4kg**（模擬預設 4.0kg） | 附件十二 級別I |
| maxTiltDeg / maxSpeed / acceleration / drag | caa-exam.json 为 **null（待原廠規格）**；exam-aircraft.json 有模擬假設值 25°/8m/s/2.5/0.6（標非官方、可調） | 模擬假設 |
| 慣性 | τ_水平 0.7s、τ_姿態 0.45s、姿態速率上限 45°/s | 模擬假設（飛控實際讀取） |

法规核验备注（config 内已载）：官方連結 404，改以鏡像 PDF 交叉核對（SHA-256 已记录），法規數值標「待官方原檔核驗」。

### 6.2 现状（代码实测）

- 考试机体 = `scene.ts createExamQuad()`（程序化）：马达半径 0.5m → **对角 1.00m**，机身 0.34×0.12×0.34m，臂 0.74m；红头白尾标记。**数值落在官方 90–110cm 区间内，与 config 默认值一致。**
- 飞控参数（maxTilt/accel/drag/慣性）确实来自 `exam-aircraft.json`（`config.ts` 导入 → `ExamAircraftParams` → `flight-controller.ts` 消费）。
- `create-programmatic-f450.ts`（马达半径 2.25m → 对角约 3.2m）属巡检任务，考试场景**未使用**（正确：3.2m 远超 110cm 上限）。

### 6.3 发现（待裁决，未修改）

1. **模型与配置未联动**：`diagonalSpanCm` 在 `src/` 中**零引用**——1.00m 是 `scene.ts` 硬编码。config 标注 adjustable，但调整 config 不会改变视觉模型。
2. **双配置源**：机体参数同时存在于 `caa-exam.json .aircraft`（null，待原厂）与 `exam-aircraft.json`（模拟假设，实际生效）。哪份为权威、null 项是否用模拟假设填充，需架构师定调。
3. `ExamAircraftParams` 型别含 `massKg`／`maxHorizontalSpeedMps`，但飞控未直接用（动力学由 tilt/accel/drag/τ 表达）——4kg 目前是纸面参数，非模拟量。

---

## 七、任务 D-2：科目 E（高度保持五邊）只读核查

### 7.1 各层现状

| 层 | 状态 | 证据 |
|---|---|---|
| config 数据 | **已备** | `caa-exam.json .subjects.E_altitude_hold_five_sided`：name／3 条 criteria／`minOperationAirspaceByLevelM`（I 80×20、II 120×30、III 160×40）／`operationAltitudeM: 20`／page 165／`phase2: true`；`exam-aircraft.json` levels[].pentaAirspaceM 与之一致 |
| config.ts 型别/规范化 | **缺失** | `subjects` 型别仅 B/C/D/F/A/G；规范化映射同样无 E——**JSON 里的 E 数据不会进入 App** |
| 判定逻辑 | **缺失** | 无 `judgeSubjectE`／`subject-e.ts`；现有：`judgeSubjectA/G`(subject-ag.ts)、`B/C`(subjects.ts)、`D`(subject-d.ts)、`F`(subject-f.ts) |
| session 汇总 | **缺失** | `SubjectReport` 无 `subjectE`；`finalize()` 只算 6 科；`ExamSubjectKey` 型别含 'E' 但无实现 |
| 成绩单 | **已正确留空** | `REPORT_ITEMS` 第 4 项（五邊）恒为 `rating: null / note: '本模擬未涵蓋'`——符合「不造假及格线」原则 |
| UI | **缺失** | `SUBJECT_KEYS` 无 E 按钮；i18n `subjects` 无 E 标签 |
| 场地几何 | **缺失** | `field.ts` 无五边航線几何；E 準則要求「第一/五邊通過 P3→P7 延伸線上方」，该延伸線未建模 |
| 飞行能力 | 部分可用 | position/attitude 模式 + 風場已存在；20m 操作高度下的相机/视野/输入未经适配验证 |

### 7.2 若要实作科目 E 的缺口清单（供立项估算，本轮未动）

1. `config.ts`：补 `subjects.E` 型别与规范化映射；
2. 新建 `subject-e.ts`：`judgeSubjectE()`（高度保持、机头朝飞行方向、滚转/俯仰平顺度、第一/五邊过 P3–P7 延伸线）；
3. `types.ts`／`session.ts`：`SubjectEResult` + `subjectE` + finalize 接线；
4. `field.ts`：五边航線与 P3–P7 延伸线几何；
5. `exam-app.ts`／i18n：科目列按钮、面板引导、成绩单索引 4 接线；
6. 单测 + browser 测试；20m 高度的相机与操作适配。

---

## 八、红线遵守与禁止事项核对

| 红线 | 状态 |
|---|---|
| 只改 P0 工作树 | ✅ 主工作树 6M+1?? 未动 |
| 不修改飞控/评分/RC 校准算法 | ✅ 仅改一个测试文件 |
| 不降低峰值检测阈值 | ✅ SUGGESTION_MIN_PEAK=0.7 未动 |
| 不跳过/删除失败测试 | ✅ 断言原文保留 |
| 不开始 P0-B／科目 E 正式功能修改 | ✅ 两项均为只读核查 |
| 不 commit / push / merge / deploy | ✅ 改动留待架构师裁示 |
| 不重启/关闭其他服务 | ⚠️ 见下方附录 A（意外事件与恢复） |

---

## 九、待架构师裁决事项

1. **是否 commit 本轮修复**（建议：单独提交，message 如 `test(rc): fix recording-suggestion spec timing race on mobile-chrome`）；
2. **P0-B 立项范围**：是否将 `diagonalSpanCm` 接入视觉模型（config→scene 联动）？双配置源以哪份为权威？原厂规格（maxTilt/maxSpeed/accel/drag）何时可取？
3. **科目 E 是否进入下一阶段**（教师明令未授权前不得进入实作；本轮仅产出缺口清单）；
4. 法规原档核验：附件十二官方 PDF 直链 404，镜像 PDF 元数据与档名不一致，数值仍标「待官方原檔核驗」——是否安排正式取證。

---

## 附录 A：环境事件记录（透明披露）

本轮执行中，为清理 CPU 压力进程，误用 `taskkill //F //IM bash.exe`（按映像名批量结束），**误杀了承载 4173 预览服务的后台 shell**（PID 16620，已运行 1h40m）。

处置：立即以相同环境变量（`npm_config_cache=D:\FDE-Tools\npm-cache`、`TEMP/TMP=D:\FDE-Tools\tmp`）重启 `npm run preview -- --port 4173 --strictPort --host 127.0.0.1`，新 PID 11968，实测 root / `?mode=exam` 均 HTTP 200。dist 未重建（本轮无产品码变更，仅测试文件）。教师入口 `http://127.0.0.1:4173/?mode=exam` 恢复可用。

教训（已记入工作记忆）：本环境禁止按映像名批量 taskkill；压力进程须用 `timeout N bash -c …` 自限时限。

## 附录 B：证据文件位置

| 文件 | 路径 |
|---|---|
| 复现探针（原测试 + 600ms 延迟注入） | `D:\FDE-Tools\p0-flake-evidence\_flake-repro.spec.ts` |
| 复现输出与根因说明 | `D:\FDE-Tools\p0-flake-evidence\REPRO-EVIDENCE-2026-10-25.md` |
| 本轮 diff | `git diff tests/browser/rc-calibration-visibility.spec.ts`（+65/−18） |

---

*报告生成：WorkBuddy（执行工程师）｜2026-10-25｜测试数据除标注「封存」外均为本轮实测*
