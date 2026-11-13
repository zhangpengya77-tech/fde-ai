# P5-I Gazebo SIGSEGV 診斷

## RCA-6 狀態（2026-11-11）

G5（只移除 camera sensor、保留云台 joint graph）已作為 RCA-6 的唯一隔離 flight candidate。但 Windows E: 與 WSL `/mnt/e` 在啟動前已不可用，既有 ArduPilot Gazebo plugin directory 無法核驗；運行器因此在建立任何子程序前安全阻斷。此環境阻斷沒有改變 RCA-5 的 `STRONGLY_SUPPORTED_HYPOTHESIS`，也沒有把 G5 視為完整 camera 修復。詳見 [P5_RCA6_HEADLESS_FLIGHT_ACCEPTANCE.md](P5_RCA6_HEADLESS_FLIGHT_ACCEPTANCE.md)。

## RCA-5 精細隔離更新（2026-11-11）

在完整 Iris 與完整三軸 gimbal joint graph 下，G1（只去 Gst）、G2（只去 CameraZoom）及 G3（兩者都去）仍以 `-11` 退出；G5 僅移除 camera sensor，SIGINT 與 SIGTERM 均 3/3 正常退出。結論保持 `STRONGLY_SUPPORTED_HYPOTHESIS`：camera sensor lifecycle 是必要條件，並非已證實的單一 plugin 根因。完整工件矩陣見 [P5_RCA5_GIMBAL_ISOLATION.md](P5_RCA5_GIMBAL_ISOLATION.md)。

## RCA-3C 資源隔離狀態（2026-11-11）

SIGSEGV 根因維持 `ROOT_CAUSE_UNCONFIRMED`。本輪沒有啟動 Gazebo；只建立可追溯實驗輸入。固定 commit world/model 資源已隔離，原始 0-byte world 與 dirty model 未作為測試輸入。

依賴相關性已確認：Camera/GStreamer 由 `gimbal_small_3d` 與 `gimbal_small_2d` 的 camera sensor 及 `GstCameraPlugin` 提供；Ogre2 由 world 的 `gz-sim-sensors-system` 設定提供。這是來源定位，不是 SIGSEGV 的因果證明。

完整物件清單、雜湊與本機 plugin binary 狀態見 [P5_ISOLATED_RESOURCE_MANIFEST.md](P5_ISOLATED_RESOURCE_MANIFEST.md)。

RCA-3D 已將三項 plugin 由 `UNVERIFIED_BINARY` 縮小為 `PARTIALLY_VERIFIED`：ELF、Build-ID、CMake source/ABI 與 loader 解析均一致，惟完整 build log 與執行時析構穩定性仍未證明。SIGSEGV 根因仍未確認。

## RCA-4 結果（2026-11-11）

空場景在 SIGINT/SIGTERM 均以 0 結束；完整隔離 Iris 在兩訊號、無 SITL / 有 SITL / 有 SITL+Gateway 的六次可比較實驗均為 Gazebo `-11`。移除 gimbal camera 裝配與其關聯 joint 的有效 C 變體，在兩訊號均為 0。證據級別是 `STRONGLY_SUPPORTED_HYPOTHESIS`：gimbal camera/GStreamer 裝配路徑或其關聯生命周期是必要條件；不是單一元件的已證實根因。詳細工件見 [P5_RCA4_RUNTIME_EVIDENCE.md](P5_RCA4_RUNTIME_EVIDENCE.md)。

