# P5-H IMU／預解鎖診斷（進行中）

日期：2026-11-11。範圍僅限 `FDE-DT-Ubuntu` 的官方 Iris Gazebo 隔離實例；未連接真實飛控。

## 已觀察證據

| 冷啟動 | 觀察結果 | 結論 |
|---|---|---|
| 1 | GPS Fix 6／10 satellites、兩組 EKF IMU origin set；曾出現 `Arming motors`，之後 WebSocket 逾時安全回退為 `Disarming motors` | 不是 IMU 拒絕；會話未保持造成正常看門狗回退 |
| 2 | IMU0/IMU1 initialized、tilt/yaw alignment、GPS 偵測、Fix 6 後額外等待 16 秒；單次 arm 後收到 `PreArm: Gyros inconsistent` | 固定等待窗不足，該次不得進行任務 |
| 3 | Gateway 已取得 `SYS_STATUS`：gyro=true、accel=true，但 GPS 尚未收斂前 HTTP 8200 已退出 | 基礎設施失敗；不計為穩定成功 |

官方版本：Gazebo Harmonic 8.15.0；`ardupilot_gazebo` `f116b035`；ArduCopter Copter-4.7.2。Iris world 使用既有 `lock_step=1`、`no_time_sync=1` 配置，未修改。

## 根因判定

**已證實：** 原前端會在只取得位置與 GPS 後以固定時間請求解鎖，無法得知 `SYS_STATUS` 的 IMU 健康狀態。

**候選根因：** Gazebo 冷啟動早期的 IMU/EKF 收斂與實際模擬時鐘／RTF 波動。尚未完成五次獨立冷啟動，不能宣稱已定位為唯一根因。

**未採用：** 未關閉 `ARMING_CHECK`，未跳過 EKF/IMU/GPS 預解鎖條件，未修改物理參數。

## 最小安全修復

Gateway 由 `SYS_STATUS.onboard_control_sensors_health` 發佈 `sensor_health.gyro/accel`；Physics Pro 只有在 GPS Fix >= 3、陀螺儀健康且連續穩定 15 秒後才自動發出單次 arm 請求。健康未知或不健康均保持等待。

定向測試：Gateway 9 PASS；`rea-sitl-client` 10 PASS。完整回歸與五次冷啟動仍待執行。

P5-H 目前冷啟動成功率為 **0/3 可用於 Mission**（#1 因會話看門狗回退、#2 Gyros 預解鎖拒絕、#3 Gateway 生命週期中斷）。這不是飛控模型或正式功能的成功率。

## 安全停止條件

本機測試中若收到 `PreArm: Gyros inconsistent`，當次會話停止，不上傳 Mission、不切 AUTO。Gazebo 退出後不以歷史 PID 終止進程，必須重新核對命令列；本輪已觀察到 PID 12 被新 shell 復用。
