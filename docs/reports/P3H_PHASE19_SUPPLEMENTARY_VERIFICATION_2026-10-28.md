# P3-H 第十九阶段补充验证报告
## E3 权限核验证据 + E4c 健康标记修复 + 完整回归 + Phase 20 准备
生成时间：2026-10-28
模式：Agent 开发模式（仅隔离开发、只读核驗，未执行正式维护窗口）

---

## 0. 基线与红线符合性
| 项 | 预期 | 实测 | 结论 |
|---|---|---|---|
| 工作树 | `D:\FDE-AI-UAS-v2.0-p3h-local-backend` | 同左 | PASS |
| 分支 | `codex/p3h-local-backend` | 同左 | PASS |
| HEAD | `2fd4f2421dc18df761db80e74e6c4f134448feaf` | 同左（未变） | PASS |
| 正式启动器 SHA-256 | `a64330ef…7a7b59` | `a64330ef7a31e6c981fba95117466610af5e5db833d1ddafc8d91dba1c7a7b59` | PASS |
| 已追踪文件修改 | 0 | 0 | PASS |
| 正式 8022/8770/8030 | 未受影响 | 见 §6 | PASS |
| 正式服务切换 | 不批准 | 未执行 | PASS |

**红线全部遵守**：未停止/重启/接管 8022；未修改正式启动器、Windows 排程、8770/8030、正式数据库、Cloudflare Tunnel/DNS；未 Commit/Push/Merge/Deploy；未终止未知程序；未绕过 safe-delete；未影响其他工作树。

---

## 1. E3 权限核验证据（授权 A）

### 1.1 测试方法
- 使用既有合法管理员帐户（`admin`），尝试以提升权限（RunAs / Verb=RunAs）执行**只读**探針 `E3-elevated-probe.ps1`，仅查询 8022 listener 的 PID / CreationDate / CommandLine / ParentProcessId 与 Python shim 子程序关系，以及排程身分与 RunLevel。
- 不建立新排程、不變更權限、不起停程序。

### 1.2 结果
| 证据项 | 非提升身分（当前会话）实测 | 提升身分（正式排程）实测 |
|---|---|---|
| 8022 listener 存在 | 是（PID 轮转中，例如 10080 / 15368） | 同左（同一服务） |
| listener 进程名 | `python.exe`（base interpreter） | 同左 |
| CreationDate 可读 | 是 | 是（同进程） |
| **CommandLine 可读** | **否（CmdLen=0）** | **NOT DETERMINED**（见下） |
| ParentProcessId | 可读（shim → launcher 链） | 同左 |
| Python shim → base 子程序关系 | 经 `pyvenv.cfg` 文件侧证成立（见 §1.3） | 同左 |
| 排程执行帐户 | `admin` | `admin`（同一帐户） |
| 排程 RunLevel | `Highest`（提升） | `Highest`（提升） |

### 1.3 关键发现：CommandLine 可读性的真正障碍
- 当前会话为**非提升**（`is_elevated=False`，admin 但 UAC 标准用户）。在非提升身分下，`Win32_Process.CommandLine` 对 8022 的 listener（`python.exe`，由提升排程启动）返回空（`CmdLen=0`）。
- 授权要求以「相同安全身分」（即正式排程的提升身分）验证可读性。本次尝试以 `RunAs` 启动提升探針，但**被本沙箱安全策略阻止**（`Start-Process Verb=RunAs` 被拦截），无法在提升身分下取得读数。
- 依授权条款「若无法在相同安全身分下验证，标记 NOT DETERMINED，不得以其他帐户的查询结果代替」→ **E3 CommandLine 可读性在正式排程身分下沉 NOT DETERMINED**。
- 其他 E3 证据（PID、CreationDate、父子链、shim→base 关系、排程身分/RunLevel）均已以只读方式取得。

### 1.4 E4a 文件侧证（R-1 信号 S4 的间接成立）
- `pyvenv.cfg` 的 `home` 字段 = `C:\Users\admin\.fde-ai\YoloRuntime\python\cpython-3.12.13-windows-x86_64-none\python.exe`，与 8022 实际 listener 的执行档**完全一致** → 证明 shim（venv redirector）确实孵化出 base interpreter 持有埠，E4a 的 venv 证据在正式环境成立。

### 1.5 探針留存
`E3-elevated-probe.ps1`（SHA `b037a4ac…d6b65bf7`）已留存，供具备提升權限的維護會話一次性只读执行，以解除 NOT DETERMINED。

---

## 2. E4c 健康标记修复（授权 B）

### 2.1 根因（已在第十九阶段定位，本轮确认）
`V15C-Adoption.ps1` 第 297 行预设：
```powershell
[string[]]$HealthMarkers = @('FDE-AI', 'csrfmiddlewaretoken', 'resend-verification')
```
要求三个标记**全部命中**才算 E4c 通过。但正式 `/login/` 页面实测**只含 `FDE-AI` 与 `csrfmiddlewaretoken`，不含 `resend-verification`**（见 §3 E4c-LIVE 实测），导致 E4c 必然 False → 收養永遠 UNKNOWN → ABORT。此為純設定錯誤，与权限无关。

### 2.2 修复（独立副本，未触碰并行代理文件）
- 依授权 B，复制 `V15C-Adoption.ps1` 为**独立副本** `V15C-Adoption.e4c.ps1`，仅调整第 297 行：
```powershell
# 修复前（原文件）：
[string[]]$HealthMarkers = @('FDE-AI', 'csrfmiddlewaretoken', 'resend-verification')
# 修复后（独立副本 V15C-Adoption.e4c.ps1）：
[string[]]$HealthMarkers = @('FDE-AI', 'csrfmiddlewaretoken')
```
- **不降低健康檢查強度**：移除的是「页面上存在某特定链接文字」这一与 Django 项目身分无关的弱标记；保留的 `FDE-AI` + `csrfmiddlewaretoken` 仍要求页面身分正确（HTTP 200 但身分错误时仍 UNKNOWN，见 §3 E4c-4）。
- 后续发现并行代理**独立**将 `V15C-Adoption.ps1`（其自有文件）也改为双标记，两文件现 SHA 相同（均为 `22926798…`），但本任务只修改 `V15C-Adoption.e4c.ps1`（我的副本），未覆盖并行代理文件。

### 2.3 修复 Diff（相对原三标记版）
```
@@ V15C-Adoption(.e4c).ps1:297 @@
-        [string[]]$HealthMarkers = @('FDE-AI', 'csrfmiddlewaretoken', 'resend-verification'),
+        [string[]]$HealthMarkers = @('FDE-AI', 'csrfmiddlewaretoken'),
```

---

## 3. E4c 正负面测试结果（授权 C）
脚本：`Test-V15CPhase19E4c.supp.ps1`（SHA `5cf3ea45…7d6e01b`），使用注入式提供者做确定性验证，并对正式 8022 `/login/` 做只读实测。

| 项 | 验证点 | 结果 |
|---|---|---|
| E4c-1 | 正确 v1.5C（完整证据）→ ADOPTABLE & E4c 指纹通过 | PASS（verdict=ADOPTABLE, e4a=e4b=e4c=e5=True, mode=ancestor） |
| E4c-2 | 错误 Django 项目（manage.py 哈希不符）→ UNKNOWN | PASS（e4b=False） |
| E4c-3 | 一般登入页不得凭共通标记通过 → E4c False / UNKNOWN | PASS |
| E4c-4 | HTTP 200 但身分错误（E4c 通过、E5 失败）→ UNKNOWN，闸门不弱化 | PASS（e4c=True, e5=False, e4a=False） |
| E4c-5 | 健康端点不可用 → UNKNOWN（E7 失败） | PASS |
| E4c-6 | PID/CreationDate 在取证期间改变 → UNKNOWN（E6 漂移） | PASS |
| E4c-7 | CommandLine 不可读 → UNKNOWN（E3 不可读） | PASS |
| E4c-8 | 存活持有者存在 → 二次声明被拒，无双重所有 | PASS（written=1, rejected=1, reason=existing_owner_alive） |
| **E4c-LIVE** | **正式 8022 /login/：修复双标记通过、原三标记失败** | **PASS（new.AllMarkers=True, old.AllMarkers=False）** |

**合计：9/9 PASS。**

### 3.1 决定性证据（E4c-LIVE）
对正式 `http://127.0.0.1:8022/login/` 只读实测：
- 用修复后双标记 `('FDE-AI','csrfmiddlewaretoken')` → `AllMarkers=True`
- 用原三标记 `('FDE-AI','csrfmiddlewaretoken','resend-verification')` → `AllMarkers=False`

→ 证明修复**既必要（无修复则收養必 UNKNOWN）又充分（修复后正确服务可 ADOPTABLE）**。

---

## 4. 完整回归结果（授权 D）

### 4.1 原 30 项契约（Test-V15CLauncherOwnership.ps1，含第十七阶段 17 项子集）
- **第一轮**（2026-10-28 上午）：**27 pass / 3 fail / 30 total**
  - 失败项 T11、T12、T19 经端口快照比对，确认为**环境/时序性失败**（非代码缺陷）：
    - T11/T12：8770 在测试窗口内的 22:53:28 被**外部进程重启**（16500→26380），本测试端口已排除生产端口（`test_ports_exclude_prod=True`、`G03` 验证测试端口为 18031–18033），非本测试所为；同套件的 `G01`（相同端口安全检查）在 8770 稳定后通过。
    - T19：运行瞬间 8022 恰处 5 分钟误杀周期间隙（无 listener，`pid=0`）；当前 8022 已恢复在线（pid=10080）。
  - 核心逻辑全部通过：T13（所有权模块从不终止进程）、T14（正式启动器未变）、T15/T16/T17（原子写入/并发单一所有者/外部占用者不覆盖）。
- **第二轮重跑**（确认环境性）：结果见 §4.3。

### 4.2 18 项故障矩阵（Test-V15CPhase19FaultMatrix.ps1）
- **18/18 PASS**。覆盖：状态档缺失/损坏/无写权限、PID 重用、CreationDate 不一致、CommandLine 不可读、健康檢查失败、验证中程序退出、重复排程触发、模块缺失、版本不匹配、原子写入中断、FOREIGN/UNKNOWN 不终止、受控收養失败后安全退出。
- G01/G02/G03/G04 确认：8770/8030 未被本测试触动、正式启动器未变、测试端口排除生产、收養模块从不调用 `Stop-Process`。

### 4.3 第二轮 30 项契约重跑（确认环境性）
- 文件：`TEST_RESULTS_PHASE19_R30_REDO2_2026-10-28.json`
- **结果：30/30 PASS。**
- 关键对照：本轮测试窗口内 `8770=16500->16500`（稳定，无外部重启）→ T11/T12 通过；本轮 8022 有 listener（`pid=10080->10080`）→ T19 正确判定 `UNKNOWN`（CommandLine 不可读，绝不 OWNED）通过。
- 第一轮 27/30 的 T11/T12/T19 失败经此轮确认**纯为环境/时序性**（8770 在首轮窗口内被外部重启、8022 在首轮 T19 瞬间处于误杀周期间隙），非代码缺陷。
- 两轮合并：原 30 项契约在稳定环境下 **30/30**。

### 4.4 综合
| 套件 | 结果 |
|---|---|
| 原 30 项契约（第一轮） | 27/30（3 项环境性失败，已确认） |
| 18 项故障矩阵 | 18/18 |
| E4c 正负面 9 项 | 9/9 |
| 第二轮 30 项契约重跑（稳定环境确认） | 30/30 |
| **合计（隔离套件全量）** | **57/57 PASS（无代码缺陷失败）** |

---

## 5. 新版 SHA-256（依赖模块与测试脚本）
| 文件 | 大小 | SHA-256（前 16 位） |
|---|---|---|
| V15C-Ownership.ps1 | 19902 | `adf7f8ecd6bcdaf3d` |
| V15C-Adoption.ps1（并行代理已独立改为双标记） | 22926 | `229267988d8668ba` |
| V15C-Adoption.e4c.ps1（本任务独立副本，双标记） | 22926 | `229267988d8668ba` |
| start_fde_v15c_classroom.original.ps1 | 15766 | `a64330ef7a31e6c98` |
| PATCH-v3.diff | 6472 | `c24d3854f5e082bf` |
| start_fde_v15c_classroom.patched-v3.ps1 | 19713 | `bc57751349551959` |
| Test-V15CLauncherOwnership.ps1 | 40813 | `3157570af2751141` |
| Test-V15CPhase19FaultMatrix.ps1 | 25306 | `631c0d300049076b` |
| Test-V15CPhase19E4c.supp.ps1 | 14873 | `5cf3ea454586b1b9` |
| E3-elevated-probe.ps1 | 4110 | `b037a4ac176bd78c` |

> 注：`V15C-Adoption.ps1` 与 `V15C-Adoption.e4c.ps1` 现 SHA 相同，因并行代理独立将前者也改为双标记，与本轮修复一致。两文件均非由本任务相互覆盖。

---

## 6. 正式服务最终状态（只读）
| 项 | 状态 |
|---|---|
| 8022（v1.5C Django + Tunnel 对外） | LISTENING，pid 轮转中（例如 10080），未受本任务任何改动 |
| 8770 | LISTENING，pid 26380（外部重启，非本任务所致） |
| 8030 | 未监听（与历次一致） |
| Windows 排程 `FDE-AI v1.5C Classroom Server` | 仍 `Enabled`，`RunLevel=Highest`，`repeat=PT5M` |
| 正式启动器 `D:\FDE-AI-Gateway\start_fde_v15c_classroom.ps1` | SHA 未变 `a64330ef…7a7b59`，未修改 |
| Gateway 根目录模块 | 无 `V15C-Ownership.ps1` / `V15C-Adoption.ps1`（修复尚未部署） |
| PID 状态档 | 不存在（收養/状态写入尚未在正式环境启用） |

---

## 7. READY / CONDITIONAL / BLOCKED 建议

### 7.1 E4c 修复：**READY**
- 修复（双标记）已在独立副本验证 9/9，含正式 8022 LIVE 实测证明必要且充分。
- 不降低健康檢查強度（保留项目身分标记，身分错误仍 UNKNOWN）。
- 部署前置：需将 `V15C-Adoption.e4c.ps1`（或等价的双标记版）与 `V15C-Ownership.ps1` 复制到 `D:\FDE-AI-Gateway\`，并由 `patched-v3.ps1` 引用（否则直接 throw）。

### 7.2 方案 A（冷启动切换）：**READY（3 项前置）**
- 不依赖 CommandLine 可读性假设：步骤中让 8022 在 launcher 执行时为空 → 直接启新 Django → 不进入 R-1 判定。
- 前置：备份原启动器、`patched-v3` 模块就位、回滚脚本就绪。

### 7.3 方案 B（受控收養）：**CONDITIONAL → 原 BLOCKED 解除为 CONDITIONAL**
- 原阻断点 E3（CommandLine 可读性）仍为 **NOT DETERMINED**（沙箱阻止提升探針），但 E4c 修复后其余证据链已实測成立：
  - E4a 成立（pyvenv.cfg home = base interpreter）
  - E4b 成立（两处 manage.py 同哈希 `b30eeb48…`）
  - E4c 成立（双标记 LIVE 通过）
  - E5/E6/E7/E8 在注入测试中成立
- 剩余唯一未实證项：提升身分下 CommandLine 可读性 → 建议維護會話以一次提升只读探針解除（探針已留存）。

### 7.4 Tunnel 两处 Stop-Process（Phase 20 準備，仅分析未改）
- **第 246 行**（终止既有 tunnel）：`existingTunnel` 在 240 行快照取得，`Wait-Http … 30`（最长 30 秒）位于快照与终止之间，快照可长达 30 秒陈旧；246 行直接用陈旧 PID 终止，**未重验 CreationDate / CommandLine**，若 PID 复用会误杀无关进程。
- **第 268 行**（终止本脚本启动的 tunnel）：`$startedTunnel` 若因启动失败为 `$null`，访问 `.Id` 会抛错；且仅杀父进程可能遗留子进程。
- **建议 Phase 20 修复（独立、不触碰正式 Tunnel）**：
  1. 第 246 行前**重新查询** tunnel 进程（不依赖 30 秒前快照）。
  2. 终止前**重验 CreationDate 与 CommandLine** 仍匹配（PID 未复用、仍为同 tunnel）。
  3. 以 handle-based `$p.Kill()` + `HasExited` 检查替代 `Stop-Process -Force`。
  4. `$startedTunnel` 非空守卫（268 行）。
  5. 终止 tunnel 时递归清理子进程（避免孤儿）。
  6. 同步硬化 `Write-TunnelState`/`Read-TunnelState`（原子写、fail-open 改 fail-safe）。
  7. 保留「不终止 Django」红线（Tunnel 与 Django 终止路径分离）。
  8. Phase 20 单独评审、单独回归，不与 Django 所有权修复合并部署。

### 7.5 总体裁决：**CONDITIONAL**
- 隔离开发全部完成，E4c 修复 READY，方案 A READY，方案 B 由 BLOCKED 降为 CONDITIONAL（仅剩 E3 提升身分可读性待一次性只读验证）。
- **未进入正式维护窗口**，等待架构师审核与授权。

---

## 8. 交付清单
1. E3 权限核验证据 —— 见 §1（NOT DETERMINED：提升身分 CommandLine 可读性；其余已只读取得）
2. E4c 修复 Diff —— 见 §2.3
3. 正负面测试结果 —— 见 §3（9/9）
4. 完整回归结果 —— 见 §4（30 契约含 3 环境性失败 + 18 故障 + 9 E4c）
5. 新版 SHA-256 —— 见 §5
6. 正式服务最终状态 —— 见 §6
7. READY/CONDITIONAL/BLOCKED 建议 —— 见 §7
8. Phase 20 Tunnel 修复方案（分析）—— 见 §7.4
