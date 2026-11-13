# P5-I-RCA-3D Gazebo Plugin Binary Provenance

本文件只記錄靜態、非執行式檢查。沒有載入、執行或重編譯任何 `.so`。

## 建置來源證據

- 原始碼 Git HEAD 與要求 commit 相同：`f116b03552d05c8d0b0bed5ed67033a1183121d1`。
- `CMakeCache.txt`：`/mnt/e/FDE-Gazebo/build/ardupilot_gazebo/CMakeCache.txt`，64,037 bytes，SHA-256 `faf90bfc21e7a3962d4be002335498df9fd03008012466b59267f067f270cd40`。
- CMake source：`/mnt/e/FDE-Gazebo/src/ardupilot_gazebo`；build type：`RelWithDebInfo`；generator：`Unix Makefiles`；compiler：`/usr/bin/c++`；`gz-sim8_DIR=/usr/lib/x86_64-linux-gnu/cmake/gz-sim8`。
- 固定 commit 的源碼 Git objects：
  - `src/ArduPilotPlugin.cc` `0246604c…`，`include/ArduPilotPlugin.hh` `7f0770cf…`
  - `src/CameraZoomPlugin.cc` `99086de2…`，`include/CameraZoomPlugin.hh` `374d927d…`
  - `src/GstCameraPlugin.cc` `edc70426…`，`include/GstCameraPlugin.hh` `a9875a94…`
  - `CMakeLists.txt` `552a5d00…`

上述可證明 build 目錄指向同一 source tree 並配置了 Harmonic ABI；但沒有可核驗的完整 build log 或逐檔 compile command，因此不能把二進位與該 Git object 作出密碼學等級的一對一建置宣稱。

## Plugin 矩陣

| 插件 | 路徑／SHA-256 | ELF / Build-ID | 動態 ABI | 來源結論 |
| --- | --- | --- | --- | --- |
| ArduPilotPlugin | `/mnt/e/FDE-Gazebo/build/ardupilot_gazebo/libArduPilotPlugin.so`，9,787,200 bytes，`e144e2dc7ec576eefe029e0261f9f328d4dd0e8fc4268b9f5c514d1869108eeb` | x86-64，`4164cb1e…` | `libgz-sim8.so.8`、transport13、msgs10、sdformat14；`ldd` 無缺失 | `PARTIALLY_VERIFIED` |
| CameraZoomPlugin | `/mnt/e/FDE-Gazebo/build/ardupilot_gazebo/libCameraZoomPlugin.so`，6,456,336 bytes，`8a55f4575d47b56d7a200be4ff82b0651739fff9fc6d2b31f25a66eb71e02063` | x86-64，`07f464b0…` | `libgz-sim8.so.8`、`libgz-rendering8.so.8`；`ldd` 無缺失 | `PARTIALLY_VERIFIED` |
| GstCameraPlugin | `/mnt/e/FDE-Gazebo/build/ardupilot_gazebo/libGstCameraPlugin.so`，5,435,328 bytes，`6328c2cc5a3ef96be94675974c9f547061dd9f908a7755457267e37085d7a085` | x86-64，`48fd3a2d…` | `libgz-sim8.so.8`、`libgz-rendering8.so.8`、GStreamer、OpenCV；`ldd` 無缺失 | `PARTIALLY_VERIFIED` |

`PARTIALLY_VERIFIED` 的含義：檔案雜湊、ELF 架構、Build-ID、SONAME 需求、系統 loader 解析及 CMake source/ABI 設定均已核對；執行時穩定性、插件析構安全與完整可重現 build provenance 均未驗證。

## 風險

`dpkg-query` 沒有以所查 package 名稱找到安裝記錄，然而 ELF loader 可解析所需 Harmonic soname。這不表示 ABI 不相容，但表示 package-manager provenance 未完成，不能將它列為「完全驗證」。

