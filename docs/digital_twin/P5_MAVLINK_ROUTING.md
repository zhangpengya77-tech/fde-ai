# P5 MAVLink 受控路由

## 拓扑

```text
ArduCopter SITL (sysid 251)
  serial0 udpclient:127.0.0.1:8210  -> FDE-DT Gateway（telemetry_v2）
  serial1 udpclient:<显式受控 Windows NAT host>:14560 -> QGC 专用 UDP link
  serial2 udpclient:127.0.0.1:8211  -> 保留，不供 QGC 使用
```

QGC **不得**监听或竞争 Gateway 的 8210。Gateway 的 `validate_endpoint` 仍只允许 `127.0.0.1:8210–8219`；新 `validate_qgc_output_endpoint` 是独立约束：必须显式配置、必须完全匹配许可 host、且 host 仅可为 loopback 或私有 IP。公网位址、未配置 host 与非许可私网位址均拒绝。

## 本轮真实路由证据

Windows 临时 UDP 14560 收到来自 `172.18.218.22:48408` 的 5 个 MAVLink v2 帧：magic `253`、message id `0` (HEARTBEAT)、system id `251`、component id `1`。测试由短暂 SITL 实例完成后正常停止；这证明 serial1 扇出路径，不代表 QGC GUI 已连接。

## 启用条件

仅在同一受控 Windows/WSL2 主机上测试时，显式设置：

```bash
FDE_DT_QGC_HOST=172.18.208.1
FDE_DT_QGC_PORT=14560
```

QGC 的 UDP link 还必须人工确认不会向 LAN/公网开放；本轮未更改 Windows Firewall。禁止把真实飞控或任意 LAN MAVLink 端点填入这些变量。
