# FDE-AI-UAS 2.0 Final Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan one bounded vertical slice at a time.

**Goal:** 在保留 P1-P9、I1-I5 与所有既有 dirty成果的前提下，完成可教学、可验收、可交付但尚未正式部署的 FDE-AI-UAS 2.0。

**Architecture:** 继续复用现有 Django 学习平台、Starlette Live Backend、RAG、Vision Center、Growth Record、Teacher Review 与外部模块接口。禁止重建第二套系统；外部模块保持独立且默认停用。每一阶段先写或确认失败测试，再做最小修改，并将自动化、真实 HTTP、真实模型和真实设备证据分开报告。

**Tech Stack:** Windows 11、Django 5.2、Starlette/Uvicorn、SQLite、Vanilla JavaScript、Node test、Python unittest。

**Spec:** 教师 2026-10-14《Codex 正式接棒與全系統開發完工總指令》及 `docs/handoff/` 十份交接文件。

## Global Constraints

- 开发主路径固定为 `D:\FDE-AI-UAS-v2.0`，分支 `fde-ai-v2.0-dev`，HEAD 基线 `e5c0442`。
- 当前所有既有修改均为 `EXTERNAL_DIRTY_STATE_DO_NOT_TOUCH`；禁止 `reset`、`clean`、`stash`、强制 checkout 或覆盖。
- v1.5C、正式 DB、Cloudflare、正式 Gateway、YOLO/R07/教师模型仓库、Flight Health、F450 十二任务核心、MP12 与外部独立项目均为保护区。
- 未经教师逐项批准，不执行 migration、正式服务重启、正式数据库写入、commit、push、merge、deploy。
- 自动化 PASS 不等于真实模型 PASS；Chrome 模拟不等于 iPhone 真机 PASS。
- 正式交付前保持外部模块默认 `DISABLED`。

## 接棒与备份基线

| 项目 | 真实状态 |
|---|---|
| `CODEX_HANDOFF_READY` | 已由 `docs/handoff/HANDOFF_ACCEPTANCE.md` 标记，Codex 已读取全部十份交接文件 |
| Branch / HEAD | `fde-ai-v2.0-dev` / `e5c044244475d18930f32e26696d2cf9cf43dfa6` |
| Working tree | DIRTY；约 345 条逐文件状态，含 43 个 tracked 修改及大量 untracked 成果 |
| Stash | 1 笔旧 v1.5 stash，禁止 apply/pop/drop |
| 本机完整快照 | `D:\FDE-AI-UAS-v2.0-backups\20261014-0715-codex-takeover` |
| 快照结果 | 24,281 files，1.559 GiB，FAILED=0 |
| 校验 | 9 个关键代码/DB SHA-256 源与备份全匹配；正式与 DEMO SQLite 源/备份 `integrity_check=ok` |
| v1.5C | 独立仓库 HEAD `c7a0b25`，但实际存在既有 dirty state；一律只读保护 |

结论：`BACKUP_VERIFIED`（本机快照级别）。该结论不等于异地备份、正式数据库备份或正式恢复演练已完成。

## 全系统真实现况

| 范围 | 状态 | 证据与限制 |
|---|---|---|
| 学员登录、课程、五阶段工作台 | COMPLETE / PENDING_MANUAL | P1、I2-I4 自动化与 HTTP 有证据；真实 iPhone 仍待教师验收 |
| 学习纪录、任务提交、R01-R08、学习进度 | COMPLETE | P2-P9 报告与 Django 路由/测试存在 |
| F450 十二任务与证据/教师审核 | COMPLETE / PENDING_MANUAL | 核心与测试存在；真实课堂操作待验，核心为保护区 |
| AI Live Coach | COMPLETE / PENDING_MANUAL | camera/ask/subtitle/TTS 链与测试存在；真实手机麦克风/相机待验 |
| RAG | COMPLETE / PENDING_MANUAL | 8111 同源代理与 8770 服务接口存在；正式真实问答待验 |
| YOLO Vision DEMO | PARTIAL | DEMO 模拟链可用；模拟结果必须显著标示，不能当作真实 YOLO |
| YOLO 真实模型推论 | BLOCKED | `:8765` 未验证，缺可信真实 `best.pt`、Golden Set 与安全 Runner 真实验收 |
| R07 模型提交与教师模型仓库 | COMPLETE（保护区） | 现有提交、Review、Candidate、ACTIVE/ARCHIVED/Rollback 复用；不得重写 |
| 学员静态图片辨识 | IMPLEMENTED / NEEDS_REGRESSION | 磁盘实际已有 `student_prop_scan` 路由、模板、测试与同源 Vision client，交接矩阵已过时；需重新回归与真实浏览器确认 |
| 教师后台、班级/学生/报告/CSV | COMPLETE / PENDING_MANUAL | P3-P9 自动化证据存在；教师课堂流程待验 |
| Download Center | COMPLETE / NEEDS_REGRESSION | Live manifest/API/页面存在，需复跑当前工作树测试 |
| `/platform/`、`/student/`、`/teacher/`、`/live/`、`/downloads/`、`/flight-health/` | COMPLETE / NEEDS_REGRESSION | I4/I5 有基准；当前 `main.py` 后续又改动，需重跑路由及降级测试 |
| MP_GROUND_STATION | INTERFACE_ONLY | 独立系统，默认停用，缺教师提供的真实 URL/认证/契约 |
| HQGC_ASSESSMENT | INTERFACE_ONLY | 独立系统，默认停用，缺真实接口资料 |
| F450_DIGITAL_TWIN | INTERFACE_ONLY | 独立系统，工作台仅状态卡，禁止重建或搬移 |
| Flight Health | COMPLETE / PROTECTED | 只记录、最后整合，不修改核心 |
| 安全 I5 | COMPLETE / RESIDUAL_RISKS | R1/R2/R3/R7/R9 已完成；R4/R5/R6/R8 尚需有界评估 |
| 正式部署 | PRODUCTION_RELEASE_PENDING | 未获授权，不执行 |

## 实际未完成项目与优先顺序

1. **P0 当前工作树基线回归**：确认后续修改没有破坏 I1-I5、learning、Live Backend 与 Node 前端；保留两项历史失败单独记录。
2. **P0 教学闭环验收**：真实 HTTP 完成学员登录、五阶段、任务提交、教师审核、成长记录与报告导出；仅修复会阻断课堂的非保护区问题。
3. **P0 AI 降级闭环**：验证 Live Coach、RAG、Vision 在服务在线/离线时的可解释状态；不得伪造真实模型结果。
4. **P1 手机体验**：完成桌面与 Chrome 390x844 自动化，产出 iPhone 7 站 32 项人工表；真机结果由教师回填。
5. **P1 安全收尾**：优先处理 R4 非必要埠限制与 R5 同步探测阻塞；R6/R8 以配置与回归测试约束。若需改 `external_modules.py`，先提交安全影响说明并等待批准。
6. **P1 交付文件核对**：启动 SOP、端口、环境变量、备份/恢复、监控、故障处理、部署与回滚、教师操作手册逐项与磁盘现实同步。
7. **PENDING/BLOCKED**：真实 YOLO、iPhone、Tunnel、外部模块与正式部署均需教师或外部资源，不能由自动测试替代。

## 预计修改文件（按有界阶段，非一次性全改）

| 阶段 | 允许候选文件 | 保护说明 |
|---|---|---|
| 基线与报告 | `docs/reports/FDE_2_0_FINAL_COMPLETION_PLAN.md`、后续验收报告 | 低风险 |
| 非保护区教学阻塞修复 | `index.html`、`src/*.js/css`、`live/*.js/css`、对应测试 | 只改测试证实的阻塞 |
| 跨服务非保护区修复 | `live_backend/app/main.py`、代理/降级相关测试 | 不改变正式端口与服务 |
| Django 非保护区 UX 修复 | 仅确认为非 R07/Vision/F450 核心的 view/template/test | 禁止 migration 与正式 DB |
| 安全 R4/R5 | `student_portal/learning/external_modules.py`、`config/settings.py`、对应测试 | **保护区影响，必须先取得教师批准** |
| 交付文件 | `docs/delivery/*.md`、`docs/reports/*.md` | 不写密码、Token、正式密钥 |

## 受保护区影响评估

- R07、Vision Registry、Golden Set、ACTIVE/Rollback、F450 十二任务、Flight Health、MP12 均不在默认修改范围。
- 真实 YOLO 需要可信模型、安全 Runner 与 Golden Set；资源不足时保持 `BLOCKED`，不修改安全闸。
- 安全 R4/R5 若无法只通过配置和外围适配完成，必须暂停并提交：修改原因、函数级范围、威胁模型、替代方案和回归清单。
- 所有数据库 schema/migration、正式 DB、外部独立项目与正式服务操作均需要新的教师批准。

## Review Focus

- 8111 同源代理的 Cookie/CSRF/302 在 iPhone HTTP 环境中必须保持可登录，不得因跨端口丢失会话。
- RAG/YOLO/外部模块离线时必须快速降级且保留核心页面，不得挂起 Safari。
- 学员不能跨课程、教师不能跨班级读取或导出数据，未授权必须 404/403 而不是空 200。
- DEMO 模拟推论、fixture 与真实模型结果必须在 UI/API/报告中可区分。
- CSV、上传文件、外部 URL、Host/Origin 与重导目标必须保持现有安全边界。

## 执行阶段

### Phase 1：冻结真实基线

- [x] 保存当前 branch/HEAD/status、关键文件 SHA 与服务端口快照。
- [x] 使用隔离 DB 重跑 I5 39、路由 33、外部模块单元 63；I1 46 沿用教师确认基准，尚未重启 8112 独立验收服务。
- [x] 分批重跑 learning，确认仅有交接文件注明的两项历史失败。
- [x] 重跑 Live Backend 与 Node 前端测试，建立新的失败清单。
- [x] 将结果写入单独基线报告，未通过项不得写 COMPLETE。

Phase 1 证据：`docs/reports/FDE_2_0_TAKEOVER_BASELINE_2026-10-14.md`。

### Phase 2：教学闭环验收与最小修复

- [ ] 以 DEMO DB 启动 8110/8111，不触碰 8022/8030/8765/8770 正式服务。
- [ ] 验证学员登录→课程→五阶段→任务→Evidence→成长记录。
- [ ] 验证教师登录→班级→学生提交→Review→结果→CSV/文件下载。
- [ ] 对每个真实阻塞先补失败测试，再做最小修改并回归。
- [ ] 记录桌面真实 HTTP PASS 与人工浏览器待验项。

### Phase 3：AI 整合与降级

- [ ] 验证 Live Coach 在线、Provider 失败、RAG 在线/离线的输出与超时。
- [ ] 验证学员静态图片页选择、预览、上传、结果显示与错误提示。
- [ ] 验证 DEMO 模拟结果明确标示，不当作真实模型 PASS。
- [ ] 若无可信真实 `best.pt`/Golden Set/Runner，真实 YOLO 保持 BLOCKED 并列出唯一解锁条件。

### Phase 4：安全与稳定性

- [ ] 复核 I5 R4/R5/R6/R8 的现实影响与可复现测试。
- [ ] 对任何保护区修改先向教师提交评估并等待批准。
- [ ] 验证 DNS rebinding、IP pinning、fail-closed、Host 正规化、未授权零探测未退步。
- [ ] 执行跨服务降级与并发/超时检查。

### Phase 5：手机与教师人工验收准备

- [ ] 完成桌面与 390x844 自动化浏览器回归。
- [ ] 更新七站三十二项 iPhone Safari 验收表与 F450 十二任务步骤。
- [ ] 提供不含明文密码的账号/角色说明、教师入口与学员入口。
- [ ] 真机未执行前状态固定为 `MANUAL_ACCEPTANCE_PENDING`。

### Phase 6：正式交付准备

- [ ] 核对 `docs/delivery/01-12` 与当前代码、端口、配置一致。
- [ ] 完成 DEMO/正式环境分离、备份/恢复、监控、故障处理和回滚演练方案。
- [ ] 产出全系统完成清单、修改文件、测试、人工待验、风险限制及 Codex 开发记录。
- [ ] 不执行正式部署；状态保持 `PRODUCTION_RELEASE_PENDING`，等待教师批准。

## 测试与验收方式

- Python/Django：隔离测试 DB，按 `docs/handoff/TEST_BASELINE.md` 分批执行。
- Live Backend：`unittest` 定向与全套；不得写正式 store。
- 前端：Node `.test.cjs`、语法检查、真实 HTTP 页面与浏览器截图。
- 安全：I1-I5 脚本，所有外部网络目标用既有哨兵/模拟，不放宽判定。
- 手工：教师 Windows 与 iPhone Safari；明确区分 `AUTOMATED PASS`、`REAL HTTP PASS`、`REAL MODEL PASS`、`REAL DEVICE PASS`。

## 完工判准

仅当以下全部满足，才标记 `FDE_2_0_DEV_COMPLETE`：

1. 核定范围内学员/教师教学闭环可在 DEMO 端到端操作。
2. 基线回归无新增重大失败，两项历史失败单列且未通过破坏保护区来消除。
3. AI Live Coach/RAG/Vision 的真实能力与降级状态均有诚实证据；未完成真实 YOLO 时明确 BLOCKED。
4. I5 安全基线无退步，课堂阻塞级问题已解决或有教师接受的明确限制。
5. 交付与回滚文件和可恢复备份完整。
6. 需要教师/外部资源的项目明确标记 `MANUAL_ACCEPTANCE_PENDING` 或 `PRODUCTION_RELEASE_PENDING`。

本计划本身不授权 commit、push、merge、deploy、migration、正式 DB 写入、正式服务重启或保护区修改。
