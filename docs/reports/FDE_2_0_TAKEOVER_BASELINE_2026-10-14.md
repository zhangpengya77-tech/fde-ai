# FDE-AI-UAS 2.0 Codex Takeover Baseline

日期：2026-10-14

## Git 与备份

- Branch：`fde-ai-v2.0-dev`
- HEAD：`e5c044244475d18930f32e26696d2cf9cf43dfa6`
- Working tree：`DIRTY`，全部接棒前既有业务修改继续按 `EXTERNAL_DIRTY_STATE_DO_NOT_TOUCH` 保护。
- 本机快照：`D:\FDE-AI-UAS-v2.0-backups\20261014-0715-codex-takeover`
- 快照结果：24,281 files，1.559 GiB，复制失败 0。
- 校验：9 个关键代码/DB SHA-256 匹配；正式与 DEMO SQLite 源/备份 `integrity_check=ok`。
- 结论：`BACKUP_VERIFIED`（本机快照级别，不代表异地备份或正式恢复演练）。

## 本轮重跑结果

| 范围 | 结果 | 判定 |
|---|---:|---|
| I5 安全脚本 | 39 PASS / 0 FAIL | PASS |
| I5 路由核对 | 33 / 33 | PASS |
| 外部模块 Django 单元 | 63 / 63 | PASS |
| Live Backend Python | 315 / 315 | PASS |
| Django learning 六批 | 871 total；843 pass；26 skip；2 fail | 历史失败维持，无新增回归 |
| Node 前端全套 | 188 total；183 pass；5 fail（单项复跑后 1 项已通过） | 4 项契约冲突待处理 |

## Django 两项历史失败

1. `learning.tests.test_auth.StudentRegistrationTests.test_platform_hero_action_opens_student_growth_portal`
   - 测试要求 `我的學習日誌`，当前磁盘产品文案为 `我的成長日誌`。
   - 与 `docs/handoff/TEST_BASELINE.md` 记录一致。
2. `learning.tests.test_vision_flywheel_framework.VisionFlywheelFrameworkTests.test_teacher_sees_only_authorized_models_with_four_status_dimensions`
   - 测试要求教师模型中心显示 `訓練用途`。
   - 与交接记录一致；该页面属于 Vision 保护范围，不为绿灯擅自修改。

## Node 前端待裁定项

单项复跑确认 `live/student-live-real-interaction.test.cjs` 已 8/8 PASS。其余 4 项：

1. `live/ai-visual-voice-ui-repair.test.cjs`
   - 旧断言要求简体 `开启语音助教`，当前页面使用繁体 `開始詢問 AI`。
2. `live/traditional-chinese-ui.test.cjs`
   - 要求页面存在 `暫停語音`，当前交互已改为单一开始按钮，暂停逻辑未以该静态文案出现。
3. `live/classroom-validation-ux.test.cjs`
   - 旧断言要求步骤卡位于对话卡之前；当前页面先显示相机/AI 对话，再把步骤与完成操作收进 `更多方式`。
4. `src/download-center-entry.test.cjs`
   - 页面已有桌面与手机 `/downloads/` 入口，但测试仍要求 `src/app.js` 内存在旧的导航对象字面量。

这些冲突目前不判定为产品缺陷，也不通过随意改文案或改测试制造 PASS。Phase 2 的真实 HTTP/浏览器验收将决定有效产品契约。

## 环境隔离证据

- Django 测试使用 `demo/runtime/db/i4_e2e.sqlite3` 派生的测试数据库。
- 正式 `student_portal/db.sqlite3` 未作为测试数据库。
- 测试开始前 8022、8030、8765、8770、8110、8111 均无监听；本阶段未重启正式服务。
- 未执行 migration、commit、push、merge、deploy。

## Phase 1 结论

`BASELINE_CAPTURED_WITH_KNOWN_FAILURES`

后续只允许针对真实 HTTP 教学闭环发现的阻塞做最小修复。真实 iPhone、真实 YOLO、正式 Tunnel 与生产发布继续分别标记 `MANUAL_ACCEPTANCE_PENDING`、`BLOCKED` 或 `PRODUCTION_RELEASE_PENDING`。
