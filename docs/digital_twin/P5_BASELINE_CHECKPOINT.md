# P5 基线检查点（2026-11-10）

## 隔离范围

- Physics Pro：`D:\FDE-REA-Exam-Sim`，`feat/physics-pro`，HEAD `569122efc3b8893865bfdbf44ac159940112a084`。
- Gateway：`D:\FDE-DT\fde-flight-twin-gateway`，`feat/fde-dt-gateway`，HEAD `53df6c51f828250111f7018f0d572499caaeed51`。
- 正式考照与 P0 worktree 只读；没有修改、暂存、提交、推送、合并或部署。

两份隔离工作树在 P5 开始前均已有未提交成果。P5 仅以最小追加文件/差异继续，不能以本文件将既有改动归属为 P5。

## 运行时事实

- `FDE-DT-Ubuntu` 可启动：WSL2 IP `172.18.218.22`，主机 NAT gateway `172.18.208.1`，`gz 8.15.0`、ArduCopter SITL binary 均存在。
- `Ubuntu` 与 `Ubuntu-24.04` 的 `ext4.vhdx` 路径当前丢失，不能作为 P5 环境修复目标。
- 先前可用的 `ardupilot_gazebo` Iris world/plugin 目前不在 `FDE-DT-Ubuntu` 可访问路径；本轮不重新安装。

## 回退

不设置 `FDE_DT_QGC_HOST` 即保持原来的 `serial1=127.0.0.1:(serial0+10)`；WEB LITE 不依赖 Gateway、QGC 或 Gazebo。
