# P5-I-RCA-3B 官方 Iris world 位元組溯源

日期：2026-11-11。未啟動 Gazebo、SITL 或 Gateway。

## 官方 baseline

| 欄位 | 已驗證值 |
|---|---|
| Git repo | `/mnt/e/FDE-Gazebo/src/ardupilot_gazebo` |
| commit | `f116b03552d05c8d0b0bed5ed67033a1183121d1` |
| Git object | `worlds/iris_runway.sdf` |
| size | 3572 bytes |
| SHA-256 | `35369d7a179e5eb3a190fbb0747b06c49c4a61fb382ff5a45ef48b168ad47b4a` |
| isolated baseline | `/home/fde/fde_p5i_rca_isolated/iris_runway_OFFICIAL_BASELINE.sdf` |
| permissions | `0444` |

導出使用 WSL Python `subprocess.run(..., stdout=PIPE, text=False)` 取得 Git 原始 stdout bytes；寫入使用 `xb`、flush 和 fsync。寫入後再讀取、核對 size/SHA，均完全一致。

## 原始工作樹保護

`/mnt/e/FDE-Gazebo/src/ardupilot_gazebo/worlds/iris_runway.sdf` 仍為未知修改的普通檔，size 0、SHA `e3b0…b855`、Git status `M`。本輪沒有 checkout、restore、覆蓋或寫入它。

## 依賴圖（只讀）

```text
iris_runway_OFFICIAL_BASELINE.sdf
 ├─ gz-sim-sensors-system → render_engine=ogre2
 ├─ model://runway
 └─ model://iris_with_gimbal
     ├─ ArduPilotPlugin
     ├─ iris_with_standoffs IMU
     └─ gimbal_small_3d
         └─ camera sensor → CameraZoomPlugin + GstCameraPlugin
```

Camera/GStreamer 是 `gimbal_small_3d/model.sdf` 的 camera sensor plugins，而不是 world 顶层元素；Ogre2 来自 world 的 Sensors system。

## RCA-4 规划状态

**READY FOR COPY PLANNING，NOT READY FOR EXECUTION。** 官方 baseline 已可信；但模型工作树中 `models/iris_with_standoffs/model.sdf` 也显示未提交修改，任何对照实验必须先从相同 Git object 建立完整、独立的 world/model 依赖副本，不能引用该脏工作树。
# RCA-3C 補充（2026-11-11）

已完成完整 world/model 位元組級隔離，不使用已被截斷的 E 槽 worktree world。新資源根目錄為 `/home/fde/fde_p5i_rca_isolated/resources-f116b03552d0-complete`，其中 30 個官方 Git object 皆來自 `f116b03552d05c8d0b0bed5ed67033a1183121d1`。逐檔大小與 SHA-256 見 [P5_ISOLATED_RESOURCE_MANIFEST.md](P5_ISOLATED_RESOURCE_MANIFEST.md) 所指向的唯讀 `MANIFEST.json`。

遞迴盤點發現 `iris_with_gimbal/model.config` 還引用 `model://gimbal_small_2d`；它已納入完整副本。`iris_with_standoffs/model.sdf` 的 working-tree 版本仍是既有 dirty 檔，未作為來源。完整依賴圖與本機 `.so` SHA 也已記入隔離資源清單。本輪未啟動任何仿真程序。

