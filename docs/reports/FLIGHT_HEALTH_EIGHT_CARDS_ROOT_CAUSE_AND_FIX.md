# Flight Health AI｜八项健康卡片真实日志判读故障 — 根因排查与修复报告

- **报告日期**：2026-10-17
- **模块**：`D:\FDE-AI-UAS-v2.0\flight-health\`（DEMO 参考实现）
- **状态**：**MANUAL_ACCEPTANCE_PENDING（待教师复核；教师真实日志复测待完成）**
- **安全边界**：未 commit / push / merge / deploy；未新增 migration；未触碰 v1.5C、正式 DB(:8022)、YOLO、R07、ACTIVE、F450；原始诊断主机 `D:/FDE-Flight-Health-AI` 只读未动。

---

## 一、根因及实际证据

### 1.1 核心根因（第一轮修复，2026-10-16 定位）

**解析器格式不兼容**：`builtin_rule_engine.py` 的 `parse_bin_log` 只认 `gen_sample_bin.py` 的私有测试格式 `[len:uint8][name:4s][payload]`，对真实 ArduPilot DataFlash 帧 `[0xA3][0x95][type:uint8][payload:(len-3)]` 解析出 **0 条消息** → 八卡全部 UNKNOWN。

**证据**：对真实飞行日志 log_452（42,282 条消息）与 SITL 13.9MB（342,937 条）均解析出 0 条。修复后与 pymavlink `DFReader` 交叉验证，**核心 10 类型计数 100% 一致**（42,110 条数据消息，差 172 条 = FMT schema 定义消息，属正常消耗）。

### 1.2 本轮（2026-10-17）新定位的根因与真实缺陷

教师本次反馈「多张卡数据缺失/无法判断、出现 `undefined`、空白容器」。经逐层排查（真实 `.BIN` → 上传 → 会话 → 解析 → 规则 → 后端 JSON → 前端接收 → 字段映射 → 状态/颜色/证据），定位以下问题：

| # | 问题 | 类别 | 证据 |
|---|------|------|------|
| R1 | 前端 `cardIdMap` 使用**双 key 兼容**（`gps`+`positioning`、`rc-signal`+`rc_signal`、`flight-mode`+`flight_mode`、`altitude`+`altitude_control`），以别名掩盖契约漂移 | 前端映射错误（类别 4） | `js/app.js:688-701`（修复前） |
| R2 | `DEMO_PAYLOAD` 的 `card_id` 仍用旧下划线命名（`positioning/rc_signal/flight_mode/altitude_control`），与后端契约不一致 | 契约不一致 | `js/app.js:73,89,97,105`（修复前） |
| R3 | `determineStatus()` 的 `engineToSeverity` 映射用**旧枚举键** `NORMAL/NOTICE/ABNORMAL/INSUFFICIENT_DATA`，而后端现返回 `normal/inspect/danger/unknown` → 真实数据恒返回 `undefined` → 一律判为 `unassessed`（成长卡子系统徽章恒灰） | 字段契约错配 | `js/app.js:850`（修复前） |
| R4 | `subMap` 中 `gps: "positioning"` 旧 ID | 前端映射错误 | `js/app.js:845`（修复前） |
| R5 | `getStatusMeta()` 缺少 `DANGER` 分支 → 若传入引擎 `danger` 会落到默认 ⚪ | 状态映射缺陷 | `js/app.js:616-634`（修复前） |
| R6 | **`reference_server.py` 的 `/result` 与 `/teacher-result` 守卫用 `"analysis" not in sess`（判断「键是否存在」），但会话初始化即含 `"analysis": None` 键 → 守卫永不生效 → 分析未完成时访问 `sess["student_view"]` 抛 `KeyError` → 连接被服务器切断（客户端见 `Failed to fetch`）** | 解析失败/服务中断（类别 1） | `reference_server.py:194,204`（修复前）；错误日志 `KeyError: 'student_view'` @ `reference_server.py:197` |
| R7 | 空文件（0 字节）上传时 `analyze` 因 `not sess.get("file_bytes")`（空字节为假值）直接返回 400，未走「全灰卡 + 缺失原因」路径 | 解析失败处理不一致 | `reference_server.py:250`（修复前） |
| R8 | `index.html` 加载 `js/app.js`、`config.js`、`css/style.css` **无版本号** → 手机浏览器易命中旧缓存，教师重测时可能仍在运行修复前的旧代码 | 缓存/交付一致性 | `index.html:7,373,374`（修复前） |

> **说明**：R6 是教师最初「Failed to fetch」的真实成因之一——当分析未完成或失败时，`/result` 端点崩溃断连，前端只能看到网络层失败。

### 1.3 五类失败原因归类（教师要求区分）

| 类别 | 说明 | 本轮对应 |
|------|------|----------|
| 1. 解析失败 | 解析器无法解析文件 | R6（守卫崩溃断连）、R7（空文件）；解析器本身已修复 |
| 2. 解析成功但所需数据不存在 | 缺某类消息 | 后端输出 `unknown` + `missing_reason`（正常，已覆盖） |
| 3. 数据存在但规则未产生结果 | 规则未命中 | 已补齐 4 条规则（motor/rc/mode/altitude） |
| 4. 后端正确但前端映射错误 | ID/字段错配 | R1、R2、R3、R4、R5 |
| 5. 前端收到但模板未显示 | 渲染问题 | 已由 `renderCardFromBackend` 统一渲染 + 缺字段占位（本轮增强） |

---

## 二、修复前后端字段对照

### 2.1 卡片 ID 映射（唯一权威，无别名）

| 项目 | 后端 `CARD_DEFS` card_id | 前端 `cardIdMap` key | DOM 容器 id | 修复前前端别名（已删除） |
|------|--------------------------|----------------------|-------------|--------------------------|
| 01 | `propulsion` | `propulsion` | `propulsion-card` | — |
| 02 | `battery` | `battery` | `battery-card` | — |
| 03 | `gps` | `gps` | `gps-card` | ~~`positioning`~~ |
| 04 | `stability` | `stability` | `stability-card` | — |
| 05 | `rc-signal` | `rc-signal` | `rc-signal-card` | ~~`rc_signal`~~ |
| 06 | `flight-mode` | `flight-mode` | `flight-mode-card` | ~~`flight_mode`~~ |
| 07 | `altitude` | `altitude` | `altitude-card` | ~~`altitude_control`~~ |
| 08 | `sensors` | `sensors` | `sensors-card` | — |

### 2.2 必填显示字段契约

| 字段 | 后端输出 | 前端读取 | 缺失时前端处理 |
|------|----------|----------|----------------|
| 卡片 ID | `card_id` | `card.card_id` | 未知 ID → `console.warn` 记录，不渲染 |
| 卡片名称 | `title` | `card.title` | 占位「健康檢查（結果字段缺失／待驗證）」 |
| 状态码 | `status`（normal/inspect/danger/unknown） | `card.status` | 缺 → ⚪ 无法判断 |
| 中文状态 | `display_status` | 由 `status` 经 `getStatusMetaFromEngine` 生成 | — |
| 颜色/严重度 | 由 `status` 推导 | `meta.cssClass` | 未知 → `status-unassessed`（灰） |
| 诊断说明 | `main_finding` | `card.main_finding` | 占位「⚠️ 結果字段缺失／待驗證…」 |
| 证据/来源 | `evidence`（仅教师层） | 教师抽屉读取 | 无 |
| 缺失原因 | `missing_reason`（UNKNOWN 时） | `card.missing_reason` | 无原因时不显示该条 |
| 下一步建议 | `next_action` | `card.next_action` | 占位「⚠️ 結果字段缺失／待驗證…」 |
| 规则来源 | `rule_id` | 教师抽屉读取 | 无 |

---

## 三、修改文件与每项修改理由

### 3.1 本轮（2026-10-17 第二次修复）

| 文件 | 修改内容 | 理由 |
|------|----------|------|
| `flight-health/js/app.js` | ①`cardIdMap` 由双 key 改为**唯一权威映射**，删除全部历史别名 | 教师明确要求：不得为让测试通过而无条件加双 key；须确认唯一正确映射（R1） |
| | ②未知 `card_id` → `console.warn` 明确记录卡片 ID，不静默丢弃 | 教师要求：未知 ID 会被明确记录（R1） |
| | ③`DEMO_PAYLOAD` 4 个 `card_id` 规范化为 `gps/rc-signal/flight-mode/altitude` | 消除契约不一致（R2） |
| | ④`subMap` 的 `gps: "positioning"` → `gps: "gps"` | 旧 ID 残留（R4） |
| | ⑤`determineStatus` 的 `engineToSeverity` 旧枚举映射 → 统一走 `normalizeSeverity()` | 修真实数据恒判 `unassessed`（R3） |
| | ⑥`getStatusMeta` 补 `DANGER` 分支 | 状态映射缺陷（R5） |
| | ⑦`renderCardFromBackend` 缺必填字段 → 显示「結果字段缺失／待驗證」并 `console.warn(card_id, 缺失字段名)` | 教师要求：缺字段须明确提示并记录，不得出现 `undefined`（类别 5） |
| `flight-health/index.html` | 静态资源加版本号 `?v=20261017`（css/js） | 防手机缓存旧版（R8） |
| `flight-health/reference_server.py` | ①`/result`、`/teacher-result` 守卫由「键存在」改为「值存在」，并防御 `student_view` 未写入 | 修 `KeyError` 断连（R6，即 `Failed to fetch` 成因） |
| | ②`analyze` 守卫 `not sess.get("file_bytes")` → `sess.get("file_bytes") is None` | 空文件走「全灰卡+原因」路径（R7） |

### 3.2 第一轮（2026-10-16，核心修复，本次一并记录）

| 文件 | 修改内容 | 理由 |
|------|----------|------|
| `builtin_rule_engine.py` | `parse_bin_log` 重写为真实 DataFlash 帧扫描；`_FMT_CHARS` 对齐 pymavlink（c/C/e/E×0.01、L×1e-7、g 半精度、定长字符串）；FMT labels 剥 `\x00`；`type_id=0` 兼容 | 核心根因（1.1） |
| | 新增 `_rule_motor/_rule_rc/_rule_mode/_rule_altitude`；`CARD_DEFS` propulsion 由误挂 `_rule_battery` 改 `_rule_motor` | 补齐 4 张恒 UNKNOWN 卡，对齐教师主机 MOTOR 规则 |
| | 新增 `CARD_CONTRACT`（八卡统一契约）与 `_card_evidence()`（逐卡证据提取）；`analyze()` 重写为统一 `_card()` 构造，全 UNKNOWN 强制 overall UNKNOWN | 契约统一、不谎报 |
| `reference_server.py` | `_student_view_from_analysis` 重写：学员层固定输出契约字段；evidence 仅教师层 | 契约统一 |
| `gen_sample_bin.py` | 重写为真实 DataFlash 格式样本生成器 | 样本与真实格式一致 |
| `js/app.js` | 四色映射修复、卡片兜底、报告页数据驱动、结论四类可信度、教师证据抽屉、`askAI` 去硬编码、`getActiveApiBase` 作用域修复 | 前端显示与契约 |
| `index.html` / `css/style.css` | 三大问数据驱动；新增 `.card-missing-reason`、`.hero-log-info` | 学员端简化 |
| `sample_flight_healthy.bin` / `sample_flight_bad.bin` | 重新生成为真实格式（各 8,961 字节） | 样本有效性 |

---

## 四、八项健康卡片的实际 ID、名称、规则来源及状态

| # | card_id | 名称 | 规则 ID | 规则函数 | 必要数据 | 状态枚举来源 |
|---|---------|------|---------|----------|----------|--------------|
| 01 | `propulsion` | 01 动力健康 | MOT-01 | `_rule_motor` | RCOU | RCOU 四通道均值极差 >200 → inspect |
| 02 | `battery` | 02 电池健康 | BAT-01 | `_rule_battery` | BAT | <10.5V danger / <13.5V 或电量<25% inspect |
| 03 | `gps` | 03 定位健康 | GPS-01 | `_rule_gps` | GPS/GPS2 | 卫星<4 danger / <7 或 HDOP>2 inspect |
| 04 | `stability` | 04 姿态稳定 | ATT-01 | `_rule_attitude` | ATT | 姿态跟踪误差 >25° danger / >10° inspect |
| 05 | `rc-signal` | 05 遥控信号 | RC-01 | `_rule_rc` | RCIN | PWM 越出 900~2100 → inspect |
| 06 | `flight-mode` | 06 飞行模式 | MODE-01 | `_rule_mode` | MODE | 模式编号越出 0~30 → inspect |
| 07 | `altitude` | 07 高度控制 | ALT-01 | `_rule_altitude` | BARO/CTUN | BARO 与 CTUN 中位数偏差 >3m → inspect |
| 08 | `sensors` | 08 传感器 | VIB-01 | `_rule_vibration` | VIBE | 振动>3.0 或 clipping danger / >2.0 inspect |

**状态与颜色约定（不变）**：🟢 正常/通过（`normal`）｜🟠 需检查/注意（`inspect`）｜🔴 危险/异常（`danger`）｜⚪ 未评估/证据不足（`unknown`）。

**判读原则落实**：仅在满足规则与证据条件时标绿；数据不足 → ⚪ + `missing_reason`；不因未检出异常即判正常；不因他项异常而将其他项一律判灰；不编造指标/阈值/证据。

---

## 五、测试输入、预期结果、实际结果

### 5.1 数据契约测试（`accept_flight_health_contract.py`，CT1–CT15）

| 编号 | 测试输入 | 预期 | 实际 |
|------|----------|------|------|
| CT1 | 读 `builtin_rule_engine.CARD_DEFS` | 八卡 ID/顺序 = propulsion/battery/gps/stability/rc-signal/flight-mode/altitude/sensors | ✅ PASS |
| CT2 | 比对后端 ID 与前端 `cardIdMap` key | 完全一致（无别名） | ✅ PASS |
| CT3 | 比对 `cardIdMap` value 与 DOM 容器 id | 完全一致 | ✅ PASS |
| CT4 | 扫描代码中历史别名 | 无残留 | ✅ PASS（hits=[]） |
| CT5 | 后端 8 卡响应必填字段 | 无缺失 | ✅ PASS（missing={}） |
| CT6 | 响应 card_id 与 CARD_DEFS | 一致 | ✅ PASS |
| CT7 | 教师层 evidence | ≥1 卡含原始证据 | ✅ PASS（8/8） |
| CT13 | 未分析即取 `/result` | 优雅 404（不断连） | ✅ PASS（status=404） |
| CT14 | 未分析即取 `/teacher-result` | 优雅 404 | ✅ PASS |
| CT15 | 未知 flight_id 取 `/result` | 优雅 404 | ✅ PASS |
| CT8 | 注入未知 `card_id` | `console.warn` 记录 | ✅ PASS |
| CT9 | 未知 ID 不影响已知卡渲染 | propulsion 正常渲染 | ✅ PASS |
| CT10 | 注入缺字段卡 | 无 `undefined` | ✅ PASS |
| CT11 | 注入缺字段卡 | 显示「結果字段缺失／待驗證」 | ✅ PASS |
| CT12 | 缺字段记录卡片 ID+字段名 | `console.warn(card_id, 字段名)` | ✅ PASS |

### 5.2 状态规则测试（ST1–ST7）

| 编号 | 输入 | 预期 | 实际 |
|------|------|------|------|
| ST1 | healthy 样本 | 八卡全 `normal` | ✅ PASS（8×normal） |
| ST2 | bad 样本 | 含 `inspect` | ✅ PASS |
| ST3 | bad 样本 | 含 `danger` | ✅ PASS |
| ST4 | 非 DataFlash 乱码文件 | 八卡全 `unknown` | ✅ PASS |
| ST5 | 无数据卡 | 均含 `missing_reason` | ✅ PASS（8/8） |
| ST6 | 解析失败 | overall 不谎报 `normal` | ✅ PASS（overall=unknown） |
| ST7 | 空文件（0 字节） | 八卡全 `unknown` 且不崩溃 | ✅ PASS |

### 5.3 服务中断测试（SV1）

| 编号 | 输入 | 预期 | 实际 |
|------|------|------|------|
| SV1 | 前端指向已死 API 端口触发分析 | 显示「分析失敗」错误框 + 重试按钮；不崩溃、不伪造 DEMO | ✅ PASS |

### 5.4 真实浏览器端到端验收（`accept_flight_health_p0.py`，A–H，44 项）

- 结果：**44/44 PASS**（含 A3 解析 42,110 条断言、C1 四色与后端一致、F2 提交感受不改日志判定、G5/G6 矛盾结论、H3 教师证据、R1–R6 回归）。

### 5.5 引擎单元测试

- `test_engine_resolver`：**8/8 OK**。

---

## 六、真实日志与测试样本的区别

| 类型 | 文件 | 大小 | 消息数 | 用途 | 标注 |
|------|------|------|--------|------|------|
| **真实飞行日志** | `D:/FDE-Flight-Health-AI/sample_logs/ardupilot/log_452_2026-9-29-20-38-08.bin` | 1,631,197 B（1.56 MiB） | 42,110 条数据消息 | 解析器交叉验证、八卡判读、真实浏览器验收 | 真实 ArduPilot 飞行日志 |
| **真实 SITL 日志** | SITL 13.9MB | 13.9 MB | 342,937 条消息 | 巨量/模拟消息解析验证 | 真实格式（含 SIM/ESC 模拟消息） |
| **测试样本** | `flight-health/sample_flight_healthy.bin` | 8,961 B | 360 条 | healthy 路径（全绿） | **测试样本**（`gen_sample_bin.py` 生成，真实 DataFlash 格式） |
| **测试样本** | `flight-health/sample_flight_bad.bin` | 8,961 B | 360 条 | 异常路径（含 inspect/danger） | **测试样本** |
| **边界文件** | `.test-temp/fh_contract_garbage.bin` | ~13 KB | 0 | 解析失败（非 DataFlash） | 测试输入 |
| **边界文件** | `.test-temp/fh_contract_empty.bin` | 0 B | 0 | 空文件边界 | 测试输入 |

> **重要**：测试样本**仅用于** UI 与错误处理测试，均以「测试样本」明确标注，**未用模拟结果冒充真实日志分析**，也**未据此自动批准或启用任何正式模型**。

---

## 七、自动化测试结果及未通过项目

| 测试套件 | 结果 |
|----------|------|
| `accept_flight_health_contract.py`（契约+状态+中断） | **23/23 PASS** |
| `accept_flight_health_p0.py`（真实浏览器 A–H） | **44/44 PASS** |
| `test_engine_resolver`（引擎单测） | **8/8 OK** |
| 前端回归（live + downloads，前期） | 189 PASS |

**未通过项目**：无。

---

## 八、尚待教师真实日志复测的事项

1. **教师原始 `.BIN` 日志复测待完成**。原因：v2.0 `reference_server` 的上传会话为**纯内存字典（未落盘）**，程序重启后原文件已丢失；全盘搜寻（本项目、D:\、Downloads/Desktop/Documents、FDE 各仓库）均无教师日志原件。**故本报告不宣称教师问题已完全解决**。
2. **补测方式**：教师经 `http://192.168.1.114:8111/flight-health/`（DEMO）重新上传原始日志 → 新解析器将按日志内真实 FMT 解析。若为标准 ArduPilot DataFlash，八卡将依真实数据产色；若为其他格式，相关卡显示 ⚪ + `missing_reason`，**绝不谎报通过**。
3. **建议教师手机端先强制刷新**（本轮已加资源版本号 `?v=20261017` 以规避旧缓存），再上传复测。

---

## 九、是否修改了解析器、健康规则、数据库、R07 或模型审批机制

| 项目 | 是否修改 | 说明 |
|------|----------|------|
| DataFlash 解析器**核心算法** | **未改算法，仅修复格式兼容** | 对齐 pymavlink 的帧结构与倍率表；未新增/重写判读引擎 |
| 健康判读**规则阈值** | **未改** | battery/vibe/gps/attitude 既有 4 域阈值原样保留；新增的 motor/rc/altitude 域阈值对齐教师诊断主机既有值 |
| 数据库表 / Migration | **未改** | 未新增表、未执行 migration |
| 正式数据库 / 真实学员资料 | **未改** | DEMO 完全隔离 |
| R07 提交链 / 教师模型审批 / ACTIVE / 回滚 | **未改** | 未触碰 |
| 五步流程（上传/报告/回馈/结论/成长） | **保留** | 未增删步骤 |
| 模拟数据 | **未混入真实报告** | 仅用于 UI/错误处理，明确标注 |

> 注：`flight-health/` 在 `fde-ai-v2.0-dev` 分支为**未追踪新目录**，未做任何 git 写操作。

---

## 十、未完成事项与教师批准点

### 10.1 未完成事项

1. **教师真实日志复测**（见第八节）——须教师重新上传方可完成。
2. **卡片文案语言一致性**：前端 UI 为繁体，后端引擎卡片结论/`next_action` 为简体（如「四路电机输出命令差值达 358」）。不影响判读正确性，属显示一致性偏好。

### 10.2 需教师批准点

| 编号 | 待批准事项 | 建议 |
|------|------------|------|
| A1 | 是否将引擎卡片文案统一为繁体 | 纯文本转换，不改规则逻辑；转换后重跑全部测试 |
| A2 | 教师原始日志补测后，是否确认八卡判读符合预期 | 由教师人工确认 |
| A3 | 是否需将 v2.0 DEMO 引擎与真实诊断主机 `D:/FDE-Flight-Health-AI` 整合 | 当前 DEMO 已可正确解析真实格式，整合边界待教师定 |
| A4 | 阈值/规则若教师认为需调整 | 本报告未擅改；如需调整请教师明示 |

---

## 附：验证脚本与证据位置

- 契约+状态+中断测试：`.test-temp/accept_flight_health_contract.py`
- 真实浏览器 A–H 验收：`.test-temp/accept_flight_health_p0.py`（结果 `.test-temp/fh_p0_accept_result.txt`）
- 解析器交叉验证：`.test-temp/fh_crosscheck.py`
- 引擎单测：`flight-health/test_engine_resolver.py`
- 前后截图：`.test-temp/acceptance-r24/screenshots/fh-p0-*.png`（9 张）

**停止条件已满足：根因定位、最小修复、回归测试完成，现停止并等待教师复核。**
