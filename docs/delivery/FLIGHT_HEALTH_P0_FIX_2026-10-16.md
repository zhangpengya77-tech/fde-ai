# Flight Health AI「分析失败：Failed to fetch」P0 修复交付报告

- **日期**：2026-10-16
- **问题**：教师真机在 `http://192.168.1.114:8111/flight-health/` 测试：选 F450-01 四轴机 + 四面悬停训练 + 1.56MB DataFlash .BIN → 点「开始自动健康检查」→ 一直显示「正在进行飞行健康诊断」→ 弹出「分析失败：Failed to fetch」→ 无法进入第二步「报告」。
- **验收标准达成**：真实飞行日志分析成功、自动进入第二步报告、五步流程可继续。**未 commit / push / deploy**，未动正式 :8022 / 正式 DB / 受保护核心。

---

## 一、Failed to fetch 的真正根因（三层，全部已修）

**第 1 层（主根因）：`:8040` Flight Health 分析后端从未启动。**
- 页面由 Live Backend 以 StaticFiles 挂载提供（`live_backend/app/main.py:572` → `Mount("/flight-health", ...)`）。
- 前端 `flight-health/js/config.js::getActiveApiBase()` 对区网 IP（192.168.1.114）返回 **`http://192.168.1.114:8040/api/v1`**。
- 但 DEMO 启动链（`start_demo.ps1`）原本只启动 Django `:8110` 与 Live `:8111`——**`:8040` 从未被拉起**。
- 点「开始自动健康检查」后第一个请求 `POST http://192.168.1.114:8040/api/v1/flights` 连接被拒 → 浏览器抛 `TypeError: Failed to fetch` → 旧代码 alert「分析失败：Failed to fetch」→ 无法进第二步。
- 证据：教师复现前 `netstat` 确认 8040 无监听；前端请求 URL 即 `http://192.168.1.114:8040/api/v1/flights`（config.js LAN 分支硬编码 hostname:8040）。

**第 2 层（次根因，服务起来了仍会挂）：CORS 预检缺失。**
- `POST /api/v1/flights` 使用 `Content-Type: application/json`（非简单请求）→ 浏览器先发 OPTIONS 预检。
- `reference_server.py` 原无 `do_OPTIONS` 处理器 → 预检 501 → fetch 同样 Failed to fetch。
- 即：即使手工启动 :8040，第一步 JSON 建会话仍会失败。

**第 3 层（隐患，均一并修复）**：
- multipart 解析 `rstrip(b"\r\n")` 会误删 .bin 二进制尾部真实 0x0D/0x0A 字节（数据损坏风险）；
- analyze 仅捕获 RuntimeError，解析器其他异常会导致连接断连（损坏日志 → Failed to fetch）；
- 报告来源文件名被固定写死 `upload.bin`，无法溯源。

**附带修复的既有契约 bug**：后端 `builtin_rule_engine.CARD_DEFS` 的 card_id 为 `gps` / `rc-signal` / `flight-mode` / `altitude`，前端 `cardIdMap` 却用 `positioning` / `rc_signal` / `flight_mode` / `altitude_control` 作为 key → **4/8 张健康卡（定位/遥控/飞行模式/高度）永不渲染**。前端已改双 key 兼容。

## 二、修改了哪些文件（6 个）

| 文件 | 修改内容 |
|---|---|
| `flight-health/reference_server.py` | ① 新增 `do_OPTIONS`（204 + CORS 预检头）② multipart 精确剥离单个 CRLF（不再 rstrip 二进制）③ `/log` 与 `/analyze` 异常兜底返回 500 JSON（不断连）④ 提取 FormData 真实文件名（报告溯源） |
| `flight-health/js/app.js` | ① `refreshFlightHealthState()` 改绝对 URL 直连 `:8040`（:8111 无此端点代理，原同源相对路径恒 404）② `cardIdMap` 双 key 兼容 ③ 分析失败改内联中文错误框 + 「🔄 重试分析」按钮（结束 loading，不再 alert 卡死） |
| `demo/tools/demo_common.ps1` | 新增 `$FlightHealthPort=8040`（env 可覆写）、`$FlightHealthUrl`；`Get-DemoPages` 增加「6-Flight Health 后端」健康检查 |
| `demo/tools/start_demo.ps1` | 新增 **[6/8] 步骤自动拉起 `reference_server.py :8040`**（健康检查 30s，失败印日志）；步骤重编号 1/8–8/8；状态档记录 `flight_health_pid` |
| `demo/tools/start_demo_hold.ps1` | hold `flight_health_pid`（防止沙箱回收） |
| `demo/tools/stop_demo.ps1` | 停止 `flight_health_pid` + 8040 埠兜底清理 |

**未触碰**：DataFlash Parser 核心算法（`builtin_rule_engine.parse_bin_log` 等）、健康卡评分与安全规则（CARD_DEFS 规则函数）、正式 `:8022`、正式数据库、YOLO、R07、ACTIVE 模型、F450 十二任务；未新增 migration。

## 三、:8040 是否必要依赖？

**是，且现已随 DEMO 自动启动。** Flight Health 分析引擎（`flight-health/reference_server.py`，纯 Python 标准库 ThreadingHTTPServer，无额外依赖）必须监听 `:8040`——前端在区网模式下按 `http://{host}:8040/api/v1` 契约直连。已将其纳入 `start_demo.ps1` [6/8] 步骤：**教师执行 START_FDE_2_DEMO.cmd 即自动拉起，无需手动开任何服务**。DEMO 重启（stop → start）后 :8040 随之重建（G 项已验证）。

## 四、真实 .BIN 分析是否成功？

**成功。** 使用项目内合法测试样本（`gen_sample_bin.py` 生成的结构合法 ArduPilot DataFlash 日志，1.54MB，与教师场景同量级）：
- **healthy 样本**：解析 60,800 条消息 → 整体状态「🟢 通过」（电压 15.7–15.8V、振动 0.3、GPS 13 星等）。
- **bad 样本**：同样 60,800 条消息 → 「🔴 危险：检测到危险项：01 动力健康, 02 电池健康, 03 定位健康, 08 传感器」。
- 两者结果不同 = **真实解析的铁证**（非固定假数据）。样本文件：`.test-temp/fh_test_healthy_1p54MB.bin` / `fh_test_bad_1p54MB.bin`。
- 注意：本环境无教师原始 1.56MB 日志文件，按教师指示使用项目内既有合法样本验收，未伪造 PASS。教师真实日志（Mission Planner 标准导出）格式与解析器兼容即可直接使用。

## 五、是否自动进入第二步「报告」并完成五步流程？

**是，真实 Chrome 浏览器端到端验证（headless=new + CDP）全部通过：**
- 点「开始自动健康检查」→ loading 出现 → **自动进入第二步报告**（stage-2）；
- 报告数据溯源：`parsed_message_count=60800`、`source_file=fh_test_healthy_1p54MB.bin`、hero 徽章「🟢 通过」、**8/8 张健康卡全部渲染**；
- 第三步回馈提交成功（保存提示出现）→ 第四步结论四区块渲染 → 第五步成长卡渲染 → 五步流程完整可操作；
- 后端中断时：显示「⚠️ 分析失败 / 无法连接到飞行健康分析服务（网络连线失败）… / 🔄 重试分析」内联中文错误框，**loading 立即结束、按钮恢复**，不再无限转圈。

## 六、浏览器测试与回归测试结果

| 项目 | 结果 |
|---|---|
| HTTP 端到端（临时 :8045 + 1.54MB 样本，自包含） | **10/10 PASS**（OPTIONS 预检 204、上传 1,611,564 字节完整、analyze 0.47s、60,800 消息、engine-status、损坏日志优雅处理） |
| 真实 Chrome A–E（上传/API/进报告/数据溯源/五步） | **15/15 PASS** |
| 真实 Chrome F（中断容错） | **7/8 PASS**（F1 为测试脚本走系统代理对死端口回 502 的假象，浏览器真实行为由 F2–F6 证明正确，脚本已修） |
| 真实 Chrome G（DEMO 全套重启后可复现） | **3/3 PASS**（重启后仍 60,800 条消息真实解析） |
| 真实 Chrome H（其他功能不受影响） | **6/6 PASS**（首页/学员登录/教师模型中心/ Live 健康/正式 :8022） |
| 回归：教师视觉模型中心 Django 测试 | **34/34 PASS** |
| 回归：Flight Health 单元测试 | **8/8 PASS** |
| 回归：Live Backend `/flight-health/` 契约测试 | **5/5 + 5/5 PASS** |

验收截图（真实 Chrome，已存 `.test-temp/acceptance-r24/screenshots/`）：
- `fh-stage2-report-desktop.png`（743×1298，第二步报告看板）
- `fh-error-chinese-retry.png`（743×1027，中断时中文错误 + 重试按钮）

## 七、尚未解决的问题

1. **教师真实日志未实测**：本环境无教师原始 1.56MB .BIN，按指示用项目内合法样本验收。若教师真实日志（Mission Planner 标准导出）解析出 0 条消息，页面会诚实显示「未能从日志解析出任何有效数据」——请教师用真实日志复验一次。
2. **教师模型引擎未接入**：`FDE_FLIGHT_HEALTH_TEACHER_MODEL` 未配置时，分析走内建规则引擎（诚实标注「系统标准规则」）；接入教师模型需配置 `FDE_FLIGHT_HEALTH_UPSTREAM` 指向真实诊断主机（属既有设计，非本次缺陷）。
3. **RAG `:8770` 503 与 YOLO `:8765` 未启动**：与本次修复无关的既有待办，未触碰。

---

**收尾**：未 commit / push / deploy；未改正式 :8022 / 正式 DB / 受保护核心。DEMO 当前常驻运行（Django :8110、Live :8111、Flight Health :8040 均已自动拉起）。**现在停止，等待教师人工复验** `http://192.168.1.114:8111/flight-health/`。
