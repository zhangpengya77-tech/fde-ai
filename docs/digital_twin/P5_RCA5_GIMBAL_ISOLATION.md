# P5-I-RCA-5：Gimbal Camera SIGSEGV 精細隔離

日期：2026-11-11。此為隔離、非特權的 Gazebo 退出診斷；未啟動 SITL、Gateway 或真實飛控，未 ARM、起飛、Mission、AUTO 或 RTL。

## 固定輸入與保護

- 官方資源：`/home/fde/fde_p5i_rca_isolated/resources-f116b03552d0-complete`。
- upstream commit：`f116b03552d05c8d0b0bed5ed67033a1183121d1`。
- `iris_runway.sdf` SHA-256：`35369d7a179e5eb3a190fbb0747b06c49c4a61fb382ff5a45ef48b168ad47b4a`。
- 原始 `/mnt/e/FDE-Gazebo/src/ardupilot_gazebo` 不在 resource path；其既有 dirty 0-byte world 與 dirty model 均未寫入。
- 每次證據位於 `/home/fde/fde_p5i_rca5_runs/rca5-*/`，包含 `result.json`、`gazebo.log`、測試 world 與必要的模型 overlay。

## 單變數矩陣

所有變體使用完整 Iris world、相同 plugin binaries，並保留 `yaw_joint`、`roll_joint`、`pitch_joint`。G1--G5 僅於 run-local `gimbal_small_3d/model.sdf` overlay 變更。

| 組別 | 變更 | Camera sensor | CameraZoom | GstCamera | 三軸 joint |
| --- | --- | --- | --- | --- | --- |
| G0 | 完整 Iris | 有 | 有 | 有 | 有 |
| G1 | 僅移除 GstCameraPlugin | 有 | 有 | 無 | 有 |
| G2 | 僅移除 CameraZoomPlugin | 有 | 無 | 有 | 有 |
| G3 | 同時移除兩 camera plugin | 有 | 無 | 無 | 有 |
| G4 | 僅停用 GStreamer output | NOT_TESTABLE：無已核實的官方單一配置鍵 | - | - | - |
| G5 | 僅移除 camera sensor（巢狀 plugins 因 SDF 結構同步消失） | 無 | 無 | 無 | 有 |
| G6 | plugin lifecycle 順序 | NOT_TESTABLE：無安全、官方可控 API | - | - | - |

## 退出結果

`-11` 是 SIGSEGV，絕不視為正常終止；`0` 為正常退出。每次獨立 process group 啟動、觀測四秒後傳送指定訊號，均沒有 forced kill。

| 組別 | SIGINT | SIGTERM | 結論 |
| --- | ---: | ---: | --- |
| G0 | -11（3/3） | -11（5/5） | 完整 camera 路徑重現 |
| G1 | -11（3/3） | -11（6/6） | 單獨停用 Gst 不足以排除 |
| G2 | -11（1/1） | -11（1/1） | 單獨停用 CameraZoom 不足以排除（初步） |
| G3 | -11（3/3） | -11（3/3） | 同時停用兩 plugin 仍重現 |
| G4 | NOT_TESTABLE | NOT_TESTABLE | 未執行 |
| G5 | 0（3/3） | 0（3/3） | 僅移除 camera sensor 即正常退出 |
| G6 | NOT_TESTABLE | NOT_TESTABLE | 未執行 |

G5 run IDs：SIGINT `2cadf0477c08`、`d06024db62a8`、`c2ce73273014`；SIGTERM `69b7193e14c5`、`33487d55bf09`、`596f236832bb`。

## 實際載入與關節圖證據

- G0 log 顯示 `GstCameraPlugin: attached to sensor [camera]`、串流 `127.0.0.1:5600`、`gz-rendering-ogre2` 載入及 CameraZoom warning。
- G1 留存 sensor 與 CameraZoom，Gst 未 attached；G2 留存 sensor 與 Gst attached、移除 CameraZoom；G3 留存 sensor、移除兩 plugin。
- G5 overlay 沒有 camera sensor/兩 plugin，三個 joint 仍存在；log 仍有 `iris_with_gimbal` 的 gimbal command topics。
- 實際 resource path 僅含 run-local overlay（如有）及固定 30-object 隔離 resources，不含 E 槽 source worktree。

## 結論與 RCA-6 判定

結論為 **STRONGLY_SUPPORTED_HYPOTHESIS**：在 Gazebo Harmonic 8.15.0 與本機 plugin binary 組合下，camera sensor 的建立/析構生命周期是受控退出 SIGSEGV 的必要條件；單獨 GstCameraPlugin、CameraZoomPlugin 或二者共同存在不是必要條件。這不是 `CONFIRMED_ROOT_CAUSE`：沒有 stack trace/core，未能定位到 Gazebo sensor、Ogre2、GStreamer plugin 或 camera teardown 的特定程式行。

**RCA-6 READY（僅隔離診斷修復策略）**：可評估使用不含 camera sensor、但保留完整雲台關節圖的 headless world 作為受控退出測試輸入。這不是正式產品修復，亦不表示 GStreamer 與事故無關；任何第三方 plugin 改動、重編譯或系統 core-dump 設定需另行授權。

## 回歸與清理

- `python3 -m pytest tests/test_rca5_runner.py tests/test_rca4_runner.py -q`：8 PASS。
- `python3 -m pytest -q`：48 PASS。
- 前端 Vitest/Vite：本輪未修改前端、未重跑；歷史結果不可當作本輪結果。
- 收尾時 8200、8201、8210、9002、5760 均未監聽，無本輪 Gazebo/SITL/Gateway 殘留。未碰觸未歸屬的 Python 程序。
