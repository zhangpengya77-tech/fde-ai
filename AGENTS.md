# FDE-AI-UAS Codex Development Rules

## 1. Project Principle

FDE-AI-UAS 是：

AI 驱动的无人载具人才培养与职业能力验证平台。

开发原则：

One Platform
Multiple Vehicles
One Mission Logic
One Data Layer
One Student Record

详细总体架构见：

docs/architecture/FDE-DEVELOPMENT-CHARTER.md

---

## 2. Highest Priority Rule

所有开发默认采用：

- MVP
- Minimal Change
- Vertical Slice
- Lowest Token Usage
- Finish One Thing First

如果一个需求：

可以修改 2 个文件，

不要修改 20 个文件。

如果：

30 行代码可以完成，

不要写 300 行。

---

## 3. Vertical Development

一次只完成一条完整功能链。

例如：

Student
→ Camera
→ Voice
→ General AI
→ Answer

如果本轮 Scope 是 Student Live Coach：

只能修改 Student Live Coach 必需代码。

禁止顺便开发：

- Teacher Backend
- Analytics
- AI Model Center
- MP-12
- Flight Health
- Data Flywheel 扩展
- Growth Record 扩展
- Hover
- ROI
- 其它未来功能

---

## 4. Scope Before Coding

每次开始开发前，只输出：

本轮目标：
一句话。

允许修改：
列出必要模块。

禁止修改：
列出保护模块。

验收标准：
3～5 条。

然后直接开发。

不要写长篇计划。

---

## 5. Do Not Expand Scope

没有用户明确要求：

禁止：

- 顺便新增功能
- 顺便重构
- 顺便改 UI
- 顺便改数据库
- 顺便增加 Analytics
- 顺便增加 Dashboard
- 顺便增加新 API
- 顺便新增 Provider
- 顺便建立第二套系统

完成当前需求后立即停止。

---

## 6. Protected Areas

### v1.5C

v1.5C 为稳定版本。

绝对只读。

禁止：

- modify
- delete
- rename
- reset
- clean
- stash
- migrate
- refactor

---

### Flight Health

除非用户明确指定：

禁止修改 Flight Health。

保持独立模块。

未来通过 API / Reference 集成。

---

### MP-12

MP-12 已有独立 Worktree。

除非用户明确要求：

禁止修改、Merge 或重新开发 MP-12。

---

### External Dirty Changes

发现已有未提交修改：

视为：

EXTERNAL_DIRTY_STATE_DO_NOT_TOUCH

禁止：

reset
clean
stash
覆盖
格式化
顺手修复

---

## 7. Existing Architecture First

已有：

Session
Teacher Review
Candidate Queue
Growth Record
Vision
RAG
General AI
Teacher Style

优先：

Reuse
Extend
Adapter

禁止：

Rewrite
Duplicate
V2 Copy

例如：

已有 Candidate Queue，

不要建立 Model Queue。

已有 Session，

不要建立 Session V2。

---

## 8. General AI

当前默认 General AI：

gpt-5.6-luna

原则：

最低成本优先。

禁止自动切换：

- Sol
- Astra
- 其它高成本模型

除非用户明确要求。

---

## 9. Student Live Coach

当前 Student Live Coach 最小原则：

Task
→ Camera Preview
→ AI Conversation
→ Complete

Student 首屏不得堆积：

- Debug
- Provider Status
- RAG 状态
- Vision Test Panel
- Hover Test Panel
- ROI Tool
- Developer Tool

这些只能进入 Teacher / DEV 区域。

---

## 10. Safety

AI 可以：

解释
提示
教学

AI 不可以：

自动安全放行。

以下继续需要教师确认：

- 首次上电
- 电源极性
- ESC
- Motor Test
- Propeller
- Arm / PreArm
- Failsafe
- RTL / AUTO 安全放行
- 飞前检查
- 真机起飞

---

## 11. Token Saving

开发时：

只读取本轮需要的文件。

禁止默认：

- 全仓库扫描
- 全仓库索引
- 大量 Search
- 全项目分析
- 大范围 Regression

优先：

小范围定位
→ 小范围修改
→ 小范围验证。

---

## 12. Testing

默认：

只验证本轮修改路径。

例如修改 Live Coach：

只跑相关：

- Camera
- Voice
- Ask
- General AI
- Student UI

除非用户明确要求：

不要自动跑全平台大型回归。

测试必须区分：

AUTOMATED PASS

与：

REAL DEVICE PASS

自动测试不能冒充真实 iPhone 验收。

---

## 13. Dependencies

未经用户批准禁止：

- pip install
- npm install
- Python upgrade
- Node upgrade
- SDK install
- API Provider change
- Firewall change
- Cloudflare production change

如确实需要：

先用中文说明：

为什么需要
改什么
风险
替代方案。

---

## 14. Code Comments

所有新增核心：

Class
Function
API
Adapter

必须加入简短繁體中文註解。

例如：

# 擷取目前 Camera 單幀畫面

# 呼叫 General AI 回答學生問題

不要写大量无意义注释。

---

## 15. Git

未经用户明确允许：

禁止：

Commit
Push
Merge
Deploy Production

---

## 16. End Rule

完成本轮 Scope：

立即停止。

只报告：

1. 修改文件
2. 完成功能
3. 本轮测试
4. 已知问题
5. Git Status

不要自行开始下一阶段。
