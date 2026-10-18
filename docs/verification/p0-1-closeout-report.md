# P0-1 Closeout Report — Student Live Coach Final（F450 Main-12）

**日期**：2026-10-06
**阶段**：FDE-AI-UAS 2.0 / 【F450 Main-12 Final】P0-1 收尾
**依据**：现场检查结果（只读）+ 用户收尾指令（禁止继续扩展测试）

---

## 一、主链路状态

Main Pipeline：**AUTOMATED PASS**

P0-1 十一阶段已在 `live/` + `live_backend/` 闭环（现场逐项核对磁盘真实代码）：

| # | 阶段 | 状态 | 证据 |
|---|------|------|------|
| 1 | Camera | ✅ | `openCameraWithFallback` / `#cameraPreview` / `captureFrame`（live.js:298, 1508） |
| 2 | Voice → Transcript | ✅ | `handleVoiceTranscript`（live.js:555）→ voice 接线（:1417） |
| 3 | Transcript → Session Context | ✅ | `submitStudentQuestion`→`ensureSession`→`askLiveCoach`→`coach_ask.answer`→`sessions.training_state`（coach_ask.py:61-62） |
| 4 | Vision Decision | ✅ | `questionRequiresVision`（:562）/ `shouldTriggerVision`（:756）/ `coach_ask.classify`（:36-43） |
| 5 | ONE FRAME | ✅ | `isCameraFrameReady`（:1491）+ 单次 `captureFrame`（:1508），仅 visual 触发 |
| 6 | Vision Facts | ✅ | `coach_ask._answer_unstyled`→`vision_adapter.detect`（:90）→ detections→`_context_prompt`（:46-59） |
| 7 | SOP / RAG Context | ✅ | `training_state` 内联 SOP 上下文 + `rag_adapter.query`（:113） |
| 8 | General AI | ✅ | `general_ai_provider.generate`（默认 `gpt-5.6-luna`）→ RAG 兜底（:96-138） |
| 9 | Subtitle（文本） | ✅ | `#latestAiAnswer`（index.html:79, live.js:1520） |
| 10 | Auto TTS | ✅ | `deliverAiAnswer`（:1517）+ `createSpeechReply`，`autoSpeak` 默认 true |
| 11 | IDLE | ✅ | `interaction` 状态机 + `reset()`（:1540 `handsFreeVoice.resumeAfterAnswer`） |

---

## 二、验收判定

| 项目 | 值 |
|------|----|
| Main Pipeline | **AUTOMATED PASS** |
| Business Blocking Gap | **NONE** |
| REAL DEVICE | **PENDING**（iPhone Safari 实机验收待做，按 FDE-Safe-Dev 两级制不得伪造） |
| Test Debt | **G1 / G2 / G3 / G4**（均 NON-BLOCKING） |

---

## 三、Non-blocking Test Debt（定义为 TEST DEBT / NON-BLOCKING，本轮不开发）

- **G1** — 前端 `questionRequiresVision` / `shouldTriggerVision`（live.js:562 / :756）无专测。
- **G2** — 前端 `askLiveCoach` payload 形状 / `step_id` 透传无专测。
- **G3** — 11 阶段单条 E2E 自动测试缺失（现有 `test_coach_ask` 为分项覆盖，`test_build_coach_e2e` 只走 Progress 不碰 ask 链路）。
- **G4** — `traditional-chinese-ui.test.cjs` 含 1 个 stale 失败（断言繁中「暫停語音」，页面用简中「开始 AI 陪做」），为测试本身过期。

> 上述四项为测试债，**非业务阻断缺陷**。按 MVP / Minimal Change / Vertical Slice / Lowest Token Usage 原则，本轮**不新增测试、不修改业务代码、不扩展 E2E、不重构 Ask Pipeline**。

---

## 四、锁定决策（本轮）

- **step_id**：当前 session 已由 `sessions.training_state` 恢复 Current Step；本轮**不修改** `live.js` / `main.py` 做显式 `step_id` 透传，除非真实运行后证明 Task/Step Context 错位。
- **SopEngine**：保持现状，**不重新接入 Ask Pipeline**。继续 General AI First；Session / SOP / RAG 仅作 Context / Enhancement；不建立第二套 Answer Authority。
- **字幕 Overlay**：本轮**不新增**。当前 AI Answer Text + Auto TTS 已够 MVP；仅当真实 iPhone 验收证明文字位置不可用，才进入后续 UI Bug Fix。
- **auto-observation**：**不并入、不扩展**。`Student Ask Vision` 继续严格 ONE FRAME。

---

## 五、保护范围（本轮无越界）

| 项 | 状态 |
|----|------|
| Business Code Modified | **NO** |
| v1.5C | **UNTOUCHED** |
| Flight Health | **UNTOUCHED** |
| MP-12 | **UNTOUCHED** |
| Vision Model Center | **UNTOUCHED**（维持 AUTOMATED PASS / REAL DEVICE PENDING / 冻结） |
| Commit | **NOT PERFORMED** |
| Push | **NOT PERFORMED** |
| Merge | **NOT PERFORMED** |
| Deploy | **NOT PERFORMED** |

---

**本轮状态锁定完成。不继续补测试，不开始新功能，等待下一条 Scope 指令。**
