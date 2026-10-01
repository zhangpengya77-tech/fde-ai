# F450 AI 实训助教并入 v1.5C「作」板块计划

状态：PLAN_ONLY

当前保护：v1.5C READ ONLY。本计划不修改、不合并、不部署稳定版。

## 入口与 Route

正式平台保持「学、练、作、测、证」一级导航不变。在「作」下增加单一入口：

- 名称：F450 AI 实训助教
- 目标：F450 12 Task Map
- 建议 Route：/practice/f450-coach/
- Task Route：/practice/f450-coach/tasks/{task_id}

公开首页不展开 12 个 Task。Task Map、Task 详情和逐步训练均属于「作」的二级应用。

## 现有能力对应关系

| 正式平台既有能力 | v2.0 对应能力 | 整合原则 |
| --- | --- | --- |
| F450 Pixhawk 实作与 AI 助教 | 12 Task Map + Student Step UI | 保留入口语义，切换到统一任务地图 |
| Photo / Video Upload | Evidence Step | 复用上传能力并绑定 session/task/step |
| RAG | Ask AI Drawer | 由 Backend Session Context 调用 |
| Teacher Review | Teacher Gate | 复用权限，学生不得自批 |
| Growth Record 05 | PendingSyncGrowthRecordAdapter | 12 Task 映射为一个一级成长记录 |
| Flight Health | Task 12 integration reference | 仅调用既有入口，不改内部模块 |

## 数据与权限边界

- Live Session、TrainingProgress、Training Step Progress 继续是唯一训练状态来源。
- Task Map 的 x / 12 与 Growth Record 05 使用同一个 Backend progress。
- viewable 不代表 actionable 或 completable。
- Teacher Gate、Safety Gate、Evidence 和 Reflection 的 Backend 权威保持不变。
- v1.5C 不直接读取 v2.0 Dev Storage；正式同步前需定义认证、迁移与审计策略。

## 分阶段整合

1. 在独立 staging 环境验证 Route、身份、权限与返回入口。
2. 以 feature flag 暴露「作 → F450 AI 实训助教」。
3. 接通只读用户身份和课程上下文。
4. 接通 Teacher Review 与 Growth Record 05 的受控 adapter。
5. 完成 Desktop/iPhone/Android 真实浏览器验收。
6. 获得使用者明确的 merge/deploy 授权后才进入正式发布。

## Rollback Plan

- 「作」入口由 feature flag 控制，可立即回退到既有页面。
- 不迁移或删除既有 Photo/RAG/Teacher/Growth 数据。
- v2.0 Route 与服务保持独立，可撤销导航而不破坏稳定版。
- Growth Record 正式写入前使用 pending-sync/outbox；失败时停止同步，不回滚训练事实。
- Flight Health 保持独立，Task 12 只保存 reference。

## 明确非目标

- 本计划不写入 v1.5C。
- 不改变「学、练、测、证」。
- 不重建 Session、SOP、Teacher Review 或 Growth Record。
- 不包含 Production Deploy。
