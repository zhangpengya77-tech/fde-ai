# 教师 AI 视觉模型中心 · 四场景切换式介面交付报告

- **日期**：2026-10-16
- **环境**：DEMO 隔离环境（Django `:8110` / Live 统一入口 `:8111`，绑 `192.168.1.114`）
- **页面**：`/teacher/vision-center/`（教师主画面）
- **状态**：浏览器自动化验收 **10/10 PASS**；既有回归 **34/34 PASS**；**未 commit / push / deploy**，等教师查看

---

## 一、四场景实际浏览器截图（7 张，全部有效非空白）

目录：`demo/screenshots/vision-center-acceptance/`

| 截图 | 内容 | 尺寸 |
|---|---|---|
| `vc-scene1-desktop.png` | 场景①学员模型（预设唯一可见） | 1418×802 |
| `vc-scene2-desktop.png` | 场景②图片验证（真实推论结果画面） | 1418×802 |
| `vc-scene2-after-import.png` | 场景②（导入模型后自动带入） | 1418×802 |
| `vc-scene3-desktop.png` | 场景③正式模型（ACTIVE hero） | 1418×802 |
| `vc-scene4-desktop.png` | 场景④下一轮资料飞轮（A/B/C 三区） | 1418×802 |
| `vc-scene1-mobile.png` | 场景①手机版 | 390×844 |
| `vc-scene2-mobile.png` | 场景②手机版（一次只显示一个场景） | 390×844 |

> 截图有效性说明：本会话模型不支持直接目视图像，已改以脚本断言（DOM 状态断言全 PASS）＋ PNG 文件头尺寸校验（1418×802 / 390×844，21–75KB 非空白）双重确认。建议教师自行打开截图目视复核。

## 二、修改文件清单（未触碰任何受保护核心）

| 文件 | 动作 | 说明 |
|---|---|---|
| `student_portal/learning/templates/learning/teacher_vision_center.html` | 新建 + 8 处增强 | 四场景介面主体（712 行）于前轮新建；本轮仅加 8 处服务端渲染 `active` class（4 张 nav 卡 + 4 个 scene 区块），确保 JS 未执行时不空白 |
| `.test-temp/accept_vision_center_ui.py` | 新建 | 浏览器验收脚本（CDP 自动化：登录 / 场景切换 / 真实照片推论 / 导入重定向 / 手机模拟 / 工程信息折叠 / 启用回复按钮 / CSRF） |

**未改动**（受保护核心原样保留）：`views.py`（`scene` 参数早已为 int，天然支持服务端渲染）、`live_backend/`、R07 提交链、YOLO 与 `best.pt`、ACTIVE 启用与回滚机制、正式 DB / 正式埠 `:8022` / F450 十二任务 / Flight Health AI。

## 三、四场景操作测试结果（10/10 PASS，真实浏览器自动化）

验收方式：Chrome `--headless=new` + CDP 9222，以教师账号 `demo.teacher@fde-demo.local` 真实登录 `:8111`，逐步操作并断言。明细报告：`demo/runtime/logs/vision_center_ui_acceptance.json`。

| # | 要点 | 结果 | 关键证据 |
|---|---|---|---|
| 0 | DEMO 教师登录 | PASS | 以教师身分进入视觉模型中心 |
| 1 | 预设只有场景①可见 | PASS | activeScene=1，可见场景数=1（不堆叠） |
| 2 | 四个场景可切换且不堆叠 | PASS | →2/3/4/1 每次 active=n 且可见数恒=1 |
| 3 | 场景③正确显示 ACTIVE 正式模型 | PASS | hero：PROP_v0.pt / accv2 / 启用时间 2026-10-15 19:07:42 |
| 4 | 场景④三区渲染且标示「尚未接通」 | PASS | A.教师认可的模型 / B.值得再训练的图片 / C.下一轮资料准备状态 |
| 5 | 场景②图片验证（真实推论） | PASS | 真实上传照片 → 诚实回报「需要检查 / 模型未侦测到任何目标」，**未伪造通过** |
| 6 | 点「开始图片验证」自动进场景②并带入模型 | PASS | 导入后 URL `?task=PROP_DIRECTION&scene=2&model=PROP_20261016_DEMO-A_v1` |
| 7 | 手机模拟一次只显示一个场景 | PASS | 390×844，scene1/2 可见数均=1 |
| 8 | 工程信息收进进阶管理（预设关闭） | PASS | 3 个折叠区块全部默认关闭，含系统运作方式表格 |
| 9 | 启用／回复按钮与 CSRF intact | PASS | 场景③启用=True、回复=True、CSRF token=True |

## 四、尚未完成的真实后端功能（诚实清单）

1. **场景④「汇出下一轮训练包」尚未接通**：Django 端无对应 client 函数，页面已如实标示「尚未接通」（off 状态），不冒充已完成。
2. **RAG `:8770` 未就绪**：服务在听但 `/api/rag/ask` 回 503，属整合问题，非本次四场景介面范围。
3. **真实 YOLO `:8765` 未启动**：当前图片验证走 Live 内真实 ultralytics 推论（诚实回报 NO_DETECTION），`:8765` 独立推理服务未启。
4. **场景⑤直接深链**：属 v2.0 既有已知限制（`main.py` 仅 `/` 与 `/eagle` 做 SPA fallback），不在本次教师端介面改动范围。

## 五、既有测试回归

- `learning.tests.test_teacher_vision_center_page`：**34/34 PASS**（146.7s，OK，测试库 `.test-temp/regress_vc.sqlite3` 完全隔离，未触碰正式库）
- 本轮改动仅限模板档 8 处渲染增强，未触碰后端逻辑，无回归风险。

---

**收尾声明**：未执行任何 commit / push / deploy；未重启正式服务；未修改正式 DB。四场景介面已就绪，等教师查看新版画面后决定后续动作。
