# FDE-AI-UAS 2.0｜P1 五阶段学习工作台——最终验收报告

> 验收日期：2026-10-12　模式：交付验收（不新增功能、不批准 P2、不修改受保护模块）
> 验收依据：教师《P1 最终验收指令》8 项 + Step 5 交付 A–H 复查
> 结论速览：P1 范围内功能全部实现；自动化 18/18、DEMO 真实资料 47/47；回归 654+32 项中 3 个失败皆为 P0 期既有问题（证据充分）；受保护项目改动全部为 0；iPhone 真机验收 PENDING。**条件式符合进入下一阶段条件**（详见 F）。

---

## A. P1 验收结果

### A1. 自动化测试（本日复跑，证据已持久化）

| 套件 | 结果 | 证据档案 |
|---|---|---|
| P1 新套件 `learning.tests.test_student_learning_path` | **18/18 PASS** | 本日 `p1_reg_batch2.log`（Ran 87 tests … OK，含本 18 项） |
| 后端回归 `manage.py test learning`（分 5 批，避免单回合触发清理防护） | **Ran 654 项：652 PASS / 2 FAIL**（2 失败皆 P0 期既有，见 D） | `demo/runtime/logs/p1_reg_batch1.log`（129）、`p1_reg_batch2.log`（87）、`p1_reg_batch3.log`（160）、`p1_reg_batch4a.log`（161）、`p1_reg_batch4b.log`（117） |
| 前端 `node --test src/*.test.cjs` | **32 项：31 PASS / 1 FAIL**（P0 期 RISK-07，见 D） | `demo/runtime/logs/p1_reg_frontend.log` |

分批合计：129 + 87 + 160 + 161 + 117 = **654**，与指令数字一致。

### A2. DEMO 真实资料验收（本日复跑 47/47 PASS，非宣告、有持久化证据）

- 证据：`demo/runtime/logs/p1_demo_verification_47.log`（47 项逐项 PASS/FAIL 明细）+ 工作台 HTML 存档 `p1_learning_path_demo.html`。
- 执行方式：重启 DEMO（`start_demo.ps1`，:8110 Django + :8111 Live，埠绑 192.168.1.114）→ 以真实账号 `demo.student01@fde-demo.local` 登录 → 跑 `demo/tools/verify_p1_learning_path.py`（47 项检查）→ 完毕执行 `stop_demo.ps1` 干净停止。
- 关键真实结果：工作台经 **:8111 代理与 :8110 直连双路径 HTTP 200**；五阶段标题与「學 → 練 → 做 → 測 → 證」路径字串存在；R01–R08 全部呈现；进度为**真实 DEMO 资料「已提交 1/8、教师已複核 0/8」**（非假 100%）；F450 数位孪生以「待接入」呈现且**未被 `<a>` 包裹、不存在假孪生网址**；8 个规划中专项（3D 列印／航线规划／三维建模／巡检与产业 SOP／无人车＋四面悬停／起降／八字）呈现且无假连结；教师回馈区在真实尚无回馈时明确显示「目前尚无教师回馈」；5 个既有安全入口（/platform/、/downloads/、/live/、/flight-health/、prop-scan）可连结；学员课程总览与导航有工作台入口；R07 成长纪录页、M1–M4 辨识页、成长日志页均 200（冻结保护未受影响）。

### A3. 保护面验证（ Instruction 第 2 项）

代码层证据（git + mtime 双印证）：
- `views.py` 相对 HEAD 为 **1816 insertions / 0 deletions**——纯附加，无任何既有函数被改写（0 删除即无删除行，R07／M1–M4／教师后台／飞行健康／下载中心相关视图逻辑全部原样）。
- `urls.py` 相对 HEAD 的差异中，P1 仅 **+2 条路由**；其余新增路由（vision-center、golden-sets、R07 model upload、prop-scan 等）为 P0 期未提交内容，非本轮。
- 41 个已追踪修改档中，**仅 4 个 mtime 为 2026-10-12**（base.html、student_dashboard.html、urls.py、views.py——即 P1 编辑的 4 档）；其余 37 个 mtime 为 2026-10-01～10-11，属 P0 期既存未提交修改，本日零改动。
- `find src live_backend student_portal -newermt 2026-10-12`：本日改动档仅 P1 的 7 个（3 新＋4 改）；**src/（AI 助教前端）与 live_backend/（Live Coach 后端）今日 0 档改动**。
- 教师后台、下载中心、飞行健康、MP12：无本日改动（mtime 证据）；其回归测试（batch3 教师 160 项、batch1 公共页）全数通过。

### A4. 测试性质区分（Instruction 第 4 项）

- **自动化／沙箱层级（本报告全部数字属此层）**：Django 测试（测试 DB、`force_login`）、Node 测试、DEMO HTTP 层 47 项、headless Chrome iPhone 390×844 截图。
- **真实 iPhone Safari 人工测试：未进行（PENDING）**。本报告手机排版「水平溢出 0px」为 headless Chrome 390×844 模拟结果，**不得视为真机通过**（见 E）。

---

## B. 实际修改档案与程序范围（Instruction 第 1 项：区分本轮 vs 原有未提交变更）

### B1. 重要澄清：views.py 的「1816 行」不是 P1 修改量

| 档案 | 相对 HEAD 总差异 | 其中 P1 本轮 | 其中 P0 期既存未提交（原样保留） |
|---|---|---|---|
| `student_portal/learning/views.py` | +1816 / **−0** | **+247 行**（3186–3432 行：设计注释 6 行＋`LEARNING_PATH_STAGES` 常数＋`student_learning_path_entry`／`_learning_path_entry_urls`／`student_learning_path` 3 函数，EOF 纯附加） | +1569 行（P0 视觉模型中心／Golden Set 等工作，10-08～10-11 累积） |
| `student_portal/learning/urls.py` | 多条新增 | **+2 条**（`student/learning-path/`、`student/courses/<int:enrollment_id>/learning-path/`） | vision-center／golden-sets／R07 model upload／prop-scan 等路由（P0 期） |
| `student_portal/learning/templates/learning/base.html` | 1 行替换 | **+1 行**（学员导航插入「五阶段学习工作台」，插在「学习平台」与「我的学习成长日志」之间；该档 P0 期未修改，整档 diff 即 P1） | — |
| `student_portal/learning/templates/learning/student_dashboard.html` | 1 行替换 | **+1 行**（课程列第一个动作加工作台按钮） | 同一行内的「AI 目标检测」按钮为 P0 期既存未提交修改，原样保留 |

`views.py` diff 对 HEAD **0 deletions**——证明未删除／改写任何既有代码；P0 期 1569 行未提交修改完整保留。

### B2. 本日实际触碰档案清单（共 7 个，mtime = 2026-10-12）

新增（3 个产品档，未追踪）：
- `student_portal/learning/templates/learning/student_learning_path.html`（139 行）——工作台页面
- `student_portal/learning/static/learning/learning-path.css`（51 行）——`lp-*` 类别，沿用既有色码，`@media (max-width:680px)` 单栏
- `student_portal/learning/tests/test_student_learning_path.py`（223 行）——18 个测试

修改（4 个，皆附加式）：
- `views.py`（+247 行，EOF 附加）、`urls.py`（+2 路由）、`base.html`（+1 行）、`student_dashboard.html`（+1 行）

验收工具（2 个 P1 轮建立，位于 git 未追踪的 `demo/` 内）：
- `demo/tools/verify_p1_learning_path.py`（216 行，47 项检查）、`demo/tools/p1_screenshot.cjs`（137 行，CDP 截图）

### B3. 明确未动（0 改动）

models.py／任何 migration／资料库／R07 提交流程／M1–M4 前端与规则／教师后台／下载中心／飞行健康／MP12 内部／src/（AI 助教前端）／live_backend/（Live Coach 后端）／Cloudflare／Gateway／正式资料／v1.5C。

### B4. 入口路由清单（P1 新增 2 条，其余为既有）

| 路由 | 类型 | 说明 |
|---|---|---|
| `/student/learning-path/` | **P1 新增** | 单一在学课程自动 302 重导至该课程工作台；无课程回课程总览 |
| `/student/courses/<id>/learning-path/` | **P1 新增** | 工作台本体（须登录、仅本人 enrollment） |
| 学员导航「五阶段学习工作台」→ `/student/learning-path/` | P1 新增入口 | base.html 既有导航结构内插入，未新增侧栏 |
| 课程总览每列课程「五阶段学习工作台」按钮 | P1 新增入口 | student_dashboard.html 既有动作区第一个 |
| 工作台内既有入口（唯读连结）：`/platform/`、`/downloads/`、`/live/`（含 MP12 调参面板 TASK_07）、`/student/courses/<id>/prop-scan/`（M1–M4）、`/flight-health/`、R01–R08 成长纪录详情 | 既有路由 | 全部经 URL 白名单 `_learning_path_entry_urls` 输出，未创造任何新功能或假网址 |

---

## C. 已通过的功能

以下均有自动化测试与 DEMO 真实资料双重覆盖（18/18 + 47/47）：

1. **五阶段学习工作台**：學→練→做→測→證路径、「目前阶段」（跟随 `PhaseProgress` 真实状态；本期全完成时明确显示「本期五阶段皆已完成」）、五个阶段区块（锚点 `stage-learn`…`stage-certify`）。
2. **真实进度**：成长纪录 R01–R08 真实状态卡、真实计数（DEMO：1/8 提交、0/8 複核）、任务进度卡；**无任何假资料**（测试以正则与真实 DB 断言保证）。
3. **教师回馈区**：有真实 `teacher_note`／`teacher_score`／`GrowthRecordReview` 才显示（DEMO 实测 88.00 分格式渲染正确）；无资料时明确显示「目前尚无教师回馈」。
4. **诚实呈现未接入模组**：F450 数位孪生＝「待接入」徽章＋简介＋接入状态，**不可点、无假网址**（正则在测试中断言）；8 个规划中专项＝「规划中」徽章、无连结。
5. **既有安全入口接入**：学习平台、下载中心、Live 教练（含 MP12 调参面板）、M1–M4 手机桨叶辨识、飞行健康、成长日志——按钮与连结均指向既有路由，操作流程不变。
6. **入口动线**：导航连结、课程总览按钮、单课程自动重导、非本人 enrollment 404、未登录重导登录——皆有测试与 DEMO 验证。
7. **手机排版（沙箱层级）**：headless Chrome 390×844 水平溢出 **0px**，单栏布局生效（真机待验，见 E）。
8. **冻结保护面**：R07 上传路由位址与 POST-only 闸门未变（路由等值断言＋非对应方向 302 阻挡）、M1–M4 页 200、成长日志 200、教师后台回归 160 项全过、src/ 与 live_backend/ 本日 0 改动。

---

## D. 未通过的测试与风险（Instruction 第 3 项：已知问题清单）

三个失败**全部为 P0 期既存问题**，本日复跑确认、基线证据充分；**不得宣告零回归**——正确表述为：P1 造成 0 个新失败，且这 3 项的成因文件本日零改动（mtime 证据）。

### D1. 已知问题 1（后端）

- **测试名称**：`learning.tests.test_auth.StudentRegistrationTests.test_platform_hero_action_opens_student_growth_portal`（批次 1/129）
- **失败原因**：`test_auth.py:104` 断言 hero 动作标签为 `"label: '我的學習日誌'"`；而工作树 `src/platform-browser.js` 已将该标签改为 `'我的成長日誌'`（P0 期未提交改名）。
- **基准证据**：本日复跑 `p1_reg_batch1.log` 同样失败；`src/platform-browser.js` mtime = 2026-10-08、`test_auth.py` 本日零改动（mtime＋`find` 双证据）；该失败在 P1 开发前既已存在（P0 期间同一测试独立执行纪录亦为失败）。
- **影响范围**：仅「测试期望字串 vs 产品文案」不一致；平台 hero 按钮实际导向 `/student/growth/` 正常运作；不影响 P1 工作台、学员登录与任何受保护流程。
- **处置建议**（待教师核准，本轮未动）：下一轮统一文案——或更新测试断言、或将标签改回，二选一由教师决定。

### D2. 已知问题 2（后端）

- **测试名称**：`learning.tests.test_vision_flywheel_framework.VisionFlywheelFrameworkTests.test_teacher_sees_only_authorized_models_with_four_status_dimensions`（批次 4a/161）
- **失败原因**：教师模型仓库列表页（`teacher_vision_model_list`）缺少「訓練用途」状态维度标签（模板内 grep 计数 = 0），测试四维度断言语 fails。
- **基准证据**：本日复跑 `p1_reg_batch4a.log`；失败页模板 `teacher_vision_model_list.html` 与测试档皆为 **P0 期未追踪档**（`git status` 显示 `??`，mtime 早于本日），本日零改动。
- **影响范围**：仅教师端视觉模型仓库列表页缺一个状态维度列；不涉及学员端与 P1；不影响 R07／M1–M4／下载中心／飞行健康。
- **处置建议**（待教师核准）：随 P0 视觉模型中心收尾时补「訓練用途」维度列或调整测试；属 P0 遗留，不建议在 P2 前单独处理。

### D3. 已知问题 3（前端，P0 期 RISK-07）

- **测试名称**：`根首頁提供桌面與手機下載中心入口`（`src/download-center-entry.test.cjs:8`）
- **失败原因**：正则 `/title:\s*'下載中心\s*\/\s*Download Center'/` 不匹配 `src/app.js`——app.js 内无该 title 字串；`index.html` 的 `<a href="/downloads/">下載中心</a>` 实际存在（已 grep 确认）。
- **基准证据**：本日复跑 `p1_reg_frontend.log`（# pass 31 / # fail 1）；该测试档为 P0 期未追踪档，本日零改动。
- **影响范围**：仅测试期望与产品现状不一致；**下载中心入口（含右上角位置）实际可用且未变**——属测试待更新，非功能缺陷。
- **处置建议**（待教师核准）：下一轮更新测试以匹配现行入口实作（或反向补齐 app.js title）。

### D4. 安全风险：DEMO 测试帐号密码写入档案（Instruction 第 5 项）

已全面扫描（版本库排除 .git、工作区记忆档、凭证目录）。发现位置：

| # | 位置 | 内容 | 写入时点 |
|---|---|---|---|
| 1 | `demo/tools/verify_p1_learning_path.py:26` | `STUDENT_PASSWORD = "[已移除：DEMO 共用密碼明文——值請查閱版本庫外 ~/.fde-demo-credentials/demo.shared.password.txt]"`（现行 shared 密码） | P1 轮（本 agent） |
| 2 | `demo/tools/p1_screenshot.cjs:87` | 同一密码字面值 | P1 轮（本 agent） |
| 3 | 工作区记忆 `.workbuddy-ai/memory/2026-10-12.md:132` | 现行 shared 密码 + student01 旧密码明文 | P1 轮（本 agent） |
| 4 | `demo/runtime/logs/DEMO_FINAL_ACCEPTANCE_REPORT.md:17` | 现行 shared 密码明文 | **P0 期（10-10）既有** |
| 5 | `demo/P0_LOGIN_CONSISTENCY_REPORT_2026-10-10.md`、`demo/runtime/logs/{monitor.log, start-run.txt, verify_growth_diag.py, verify_real_chrome.py, verify_session.py, _bgstart*.txt}` | 旧种子密码 `[已移除：舊 DEMO 種子密碼明文]`／`[已移除：舊 DEMO 種子密碼明文]`（已被 shared 密码覆盖失效） | **P0 期既有** |
| 6 | 工作区记忆 `.workbuddy-ai/memory/2026-10-10.md`、`MEMORY.md:82` | shared／student01 密码、旧种子密码 | **P0 期既有** |
| 7 | WorkBuddy 内部工具执行记录（`~/.workbuddy-ai/projects/.../tool-results/`） | 本会话调试登入时打印的候选密码 | 本会话（版本库外） |
| — | `C:\Users\admin\.fde-demo-credentials\*.password.txt` | 主凭证档（设计上的存放位置） | 既有机制，非外泄 |

**风险判定**：以上档案**均未进入 git**（demo/ 整体未追踪；.gitignore 已排除 `*password*.txt`，但 `.py/.cjs` 内的硬编码不在排除范围）、未 commit／push；当前风险为「若未来 `git add demo/` 或提交记忆档，密码将进入版本库」。

**处置建议**（Instruction 要求只回报与建议，**本轮未修改任何档案、未触碰任何帐号**，待教师核准）：
1. 将 `verify_p1_learning_path.py` 与 `p1_screenshot.cjs` 改为从 `~/.fde-demo-credentials/demo.shared.password.txt` 读取（或环境变量注入），移除硬编码字面值（每档约 1–2 行）。
2. 记忆档（2026-10-12.md 等 3 档）明文密码改为「指向凭证档」的说明文字。
3. 鉴于密码已落入多处副本，建议在完成 1–2 后**重置 DEMO shared 密码**（既有脚本 `reset_demo_shared_password.ps1`）——涉及帐号变更，须教师明确核准。
4. 上述清理完成前，不得对 `demo/` 或记忆档执行 `git add`／commit。

### D5. 环境风险（本日新发现，沙箱特性）

PowerShell 工具会话环境损坏：进程环境同时含 `Path`／`PATH`／`path` 三个键，导致 `Start-Process` 抛「Item has already been added」——本日首次重启 DEMO 连续失败即此因。已在会话内规范化环境变量后成功启动（**未修改任何脚本或系统配置**）。教师后续若遇同样错误，按同样方式处理即可。另：`start_demo.ps1` 在 `-NoBrowser` 分支会返回非零退出码（无害，服务实际全部 200）。

---

## E. iPhone 真机待验收事项（全部 PENDING，不得宣告通过）

本轮未进行真实 iPhone Safari 测试。以下项目须教师（或指定人员）以真机执行后回填：

1. iPhone Safari 开启工作台双路径：`http://192.168.1.114:8111/student/courses/<id>/learning-path/`（经 :8111 代理）与 `:8110` 直连——五阶段显示、目前阶段、真实计数。
2. 真实 DEMO 学员帐号登录／登出（密码自受限凭证档取得）。
3. 390×844 实际排版：单栏、无水平溢出、按钮可点区域（本报告 0px 溢出为 headless Chrome 模拟，真机待验）。
4. 导航「五阶段学习工作台」与课程总览按钮、单课程自动重导。
5. 工作台内既有入口真机可用：学习平台、下载中心、Live 教练（含 MP12 调参面板 TASK_07）、M1–M4 桨叶辨识（相机流程）、飞行健康、成长日志 R01–R08。
6. MP12 端到端调参与教师複核流程（Instruction 留待教师确认项）。
7. 未接入模组呈现：F450「待接入」与规划中徽章在真机显示正确、不可误点。

---

## F. 是否符合进入下一阶段的条件

**结论：条件式符合（Conditional）——P1 既定范围已全部达成且证据充分，但建议先完成下列三项再核准进入下一阶段。**

### F1. 已符合的条件

- P1 授权范围内功能全部实现，未越界（未碰 R07／M1–M4／DB／正式环境／独立模组内部／Cloudflare／Gateway）。
- 自动化：P1 新套件 18/18；DEMO 真实资料 47/47（证据持久化）。
- 回归：654 后端＋32 前端，3 个失败皆为 P0 期既有（D 节证据充分），**P1 造成 0 新失败**。
- 保护面：受保护项目改动全部为 0（见下方计数）；git 未提交修改完整保留（165 = 41 已追踪修改＋124 未追踪，HEAD `e5c0442` 未动、1 笔 stash 未动）；R07 清理 `--apply` 继续暂停（本轮 0 次执行）。
- 无假资料、无假网址；未接入模组诚实呈现。

### F2. 建议进入下一阶段前完成的事项

1. **iPhone 真机验收**（E 节 7 项）——P1 验收的最后一块。
2. **三个已知问题处置**（D1–D3）——均为 P0 期遗留，建议连同 P0 收尾或由教师指定轮次处理；不阻断 P2 功能开发，但应在版本库提交前解决（否则 CI／测试信号长期噪音）。
3. **DEMO 密码外泄处置**（D4）——按建议 1–2 清理硬编码与记忆档明文；是否重置 shared 密码由教师决定。**在完成前不得提交 demo/ 或记忆档。**

### F3. 教师核准事项（须明确指示）

- 是否核准上述 D4 建议 1–3（含密码重置）。
- D1–D3 的处置归属轮次。
- iPhone 真机验收的执行人与时程。

---

## 受保护项目修改计数（Instruction 要求全部为 0）

正式资料 **0**｜R07 **0**｜M1–M4 **0**｜独立模组（F450 数位孪生等）**0**｜Cloudflare／Gateway **0**｜教师后台 **0**｜下载中心 **0**｜飞行健康 **0**｜MP12 **0**｜AI 助教（src/／live_backend/）**0**｜资料库／migration **0**｜Commit **0**｜Push **0**｜Deploy **0**｜git reset／clean／强制 checkout **0**｜R07 清理 `--apply` **0**。

## Git 状态（Instruction 第 7 项：原有未提交修改全部保留）

- `git status`：165 项 = 41 已追踪修改（P0 期 37＋P1 附加的 views.py／urls.py／student_dashboard.html＋P1 新增修改的 base.html）＋124 未追踪（P0 期 120＋P1 的 3 个产品档＋`docs/reports/` 新目录）。
- HEAD 仍为 `e5c0442`，stash 1 笔未动；本轮 0 commit／0 push／0 clean／0 reset。
- 正式服务：Django :8022（HTTP 200）、RAG :8770 全程未触碰；DEMO :8110/:8111 已干净停止。

## 证据档案清单（持久化于 `demo/runtime/logs/`，该目录被 .gitignore 排除）

- `p1_reg_batch1.log`～`p1_reg_batch4b.log`、`p1_reg_frontend.log`——本日回归复跑原始输出
- `p1_demo_verification_47.log`——DEMO 47/47 逐项结果
- `p1_learning_path_demo.html`——工作台 HTML 存档（真实 DEMO 资料）
- `p1_workbench_desktop.png`、`p1_workbench_iphone390x844.png`——桌面 1440px 与 iPhone 390×844 截图

## 画面（工作台，真实 DEMO 资料）

- 桌面 1440px：`demo/runtime/logs/p1_workbench_desktop.png`
- iPhone 390×844：`demo/runtime/logs/p1_workbench_iphone390x844.png`

---

*本报告完成後停止，等待教师批准；未进入 P2、未修改资料库、未整合数位孪生、未变更任何受保护模组。*
