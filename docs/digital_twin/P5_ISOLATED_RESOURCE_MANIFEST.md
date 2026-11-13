# P5-I-RCA-3C 隔離 Gazebo 資源清單

日期：2026-11-11。此文件只記錄診斷資源導出；本輪沒有啟動 Gazebo、SITL 或 Gateway。

## 來源與保護結果

- 官方來源 Git worktree（只讀）：`/mnt/e/FDE-Gazebo/src/ardupilot_gazebo`
- 固定 commit：`f116b03552d05c8d0b0bed5ed67033a1183121d1`
- 原始 worktree 狀態：僅既有 `M models/iris_with_standoffs/model.sdf` 與 `M worlds/iris_runway.sdf`；未寫入、未 checkout/restore。
- 原始 `worlds/iris_runway.sdf`：0 bytes，SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。它不是本次實驗輸入。
- 完整隔離根目錄：`/home/fde/fde_p5i_rca_isolated/resources-f116b03552d0-complete`
- 官方導出物件：30 個；每個檔案以 `git show <commit>:<path>` 的原始 stdout bytes 取得，以 `xb` + `fsync` 新建，重新讀取後逐位元組及 SHA-256 核對，然後設為 `0444`。
- 機器可讀官方檔案清單：同根目錄的唯讀 `MANIFEST.json`（SHA-256 `5d1760c2e9b50eb298e487fe8d672200a91cf6a244fbb0334f607d72ac60aa15`）。它是每個相對路徑、大小及 SHA-256 的完整權威表。
- 只讀依賴審計：`AUDIT.json`（SHA-256 `abc6e8afffdc4ce6491bbc75ebbb252b7c45b6a4f32771e261b3515b2217fdd3`）。

## 導出集合（均為固定 commit Git object）

| 來源目錄 | 檔案數 | 說明 |
| --- | ---: | --- |
| `worlds/iris_runway.sdf` | 1 | 3,572-byte 官方 world，SHA-256 `35369d7a179e5eb3a190fbb0747b06c49c4a61fb382ff5a45ef48b168ad47b4a` |
| `models/runway/` | 10 | `model.config`、SDF、airfield mesh、runway texture、Grass textures |
| `models/iris_with_gimbal/` | 2 | `model.config`、SDF |
| `models/iris_with_standoffs/` | 6 | `model.config`、SDF、機體/槳/碰撞 meshes |
| `models/gimbal_small_2d/` | 5 | 間接 `model://` 依賴；含 camera/GStreamer 宣告 |
| `models/gimbal_small_3d/` | 6 | 主 Gimbal camera 模型與 meshes |

`MANIFEST.json` 是上述 30 個物件逐檔大小與 SHA-256 的完整可審計清單；它不把本次新增的 `AUDIT.json` 計為官方 Git object。

## 依賴圖

```text
iris_runway.sdf
├─ model://runway
│  └─ mesh: model://runway/meshes/airfield.dae
└─ model://iris_with_gimbal
   ├─ model://iris_with_standoffs
   │  ├─ IMU: imu_sensor
   │  └─ iris/prop/collision meshes
   ├─ model://gimbal_small_3d
   │  ├─ camera sensor
   │  ├─ CameraZoomPlugin
   │  └─ GstCameraPlugin
   └─ model.config thumbnail reference: model://gimbal_small_2d
      ├─ camera sensor
      └─ GstCameraPlugin

world system plugins: physics, sensors (render_engine=ogre2), user-commands,
scene-broadcaster, imu, navsat.
iris model plugins: joint-state-publisher, lift-drag, apply-joint-force,
ArduPilotPlugin, joint-position-controller.
```

## 本機已編譯插件（只讀盤點，非 Git object）

| 插件 | 實際路徑 | 大小 | SHA-256 | 來源狀態 |
| --- | --- | ---: | --- | --- |
| ArduPilotPlugin | `/mnt/e/FDE-Gazebo/build/ardupilot_gazebo/libArduPilotPlugin.so` | 9,787,200 | `e144e2dc7ec576eefe029e0261f9f328d4dd0e8fc4268b9f5c514d1869108eeb` | `UNVERIFIED_BINARY`：ELF x86-64，BuildID `4164cb…`；需在日後以 build log 對照 |
| CameraZoomPlugin | `/mnt/e/FDE-Gazebo/build/ardupilot_gazebo/libCameraZoomPlugin.so` | 6,456,336 | `8a55f4575d47b56d7a200be4ff82b0651739fff9fc6d2b31f25a66eb71e02063` | `UNVERIFIED_BINARY`：ELF x86-64，BuildID `07f464…` |
| GstCameraPlugin | `/mnt/e/FDE-Gazebo/build/ardupilot_gazebo/libGstCameraPlugin.so` | 5,435,328 | `6328c2cc5a3ef96be94675974c9f547061dd9f908a7755457267e37085d7a085` | `UNVERIFIED_BINARY`：ELF x86-64，BuildID `48fd3a…` |

## 隔離解析規劃（本輪未執行）

未來 RCA-4 測試專用啟動器應在其子程序環境設定 `GZ_SIM_RESOURCE_PATH=/home/fde/fde_p5i_rca_isolated/resources-f116b03552d0-complete`，而非修改全域環境變數。系統 Gazebo plugins 仍須由已核對的專用 plugin 目錄顯式提供；因現有 `.so` 是本機編譯物，執行前仍需建立 build provenance（建置來源）證據。不得回退解析到 E 槽脏 worktree。

## RCA-3D 補充：二進位與 ABI 靜態檢查

三項 `.so` 均為 ELF 64-bit x86-64 shared object，且沒有 ELF `RPATH` 或 `RUNPATH`，因此未來測試必須顯式設定 plugin 搜尋目錄並依賴系統 loader 的已安裝 Harmonic ABI。`readelf` 顯示三者均需要 `libgz-sim8.so.8`；`CameraZoomPlugin`/`GstCameraPlugin` 另需要 `libgz-rendering8.so.8`；GStreamer camera 另需要 GStreamer 與 OpenCV。輔助 `ldd` 檢查沒有 `not found` 項目。完整原始輸出與來源評級見 [P5_PLUGIN_BINARY_PROVENANCE.md](P5_PLUGIN_BINARY_PROVENANCE.md)。

## RCA-4 使用記錄

RCA-4 每個 run 都重新驗證此 manifest 的 30 個 object，再以子程序環境指定本資源根目錄。完整 Iris 的受控退出仍可重現 SIGSEGV；有效的無 gimbal camera 測試副本可正常退出。這不改變 manifest 的官方來源地位，也不表示任何 E 槽 worktree 資源已被修復或替換。
