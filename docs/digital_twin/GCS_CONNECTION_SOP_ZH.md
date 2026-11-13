# 地面站連線 SITL 標準作業程序（QGC／Mission Planner／HyperQGC）

> 2026-11-13 於教師電腦實測通過。只連本機模擬飛控（SITL），**不連真實飛機**。

## 0. 安全檢查（每次都要做）
1. **拔掉所有 USB 飛控**（Pixhawk、Cube 等）。數傳電台、藍牙序列埠也不要讓地面站自動連。
2. 確認沒有實體飛控：PowerShell 執行
   ```powershell
   Get-CimInstance Win32_SerialPort | Select DeviceID,Description
   ```
   只應看到「透過藍牙連結的標準序列」之類，不應有 Pixhawk／STM32／CP210／CH340。
3. 地面站的**自動連線必須全部關閉**（第 2 節已設定好；換電腦要重做）。
4. 一次只開**一個**地面站：SITL 的 TCP 5760 同一時間只接受一個連線。

## 1. 啟動 SITL
在 PowerShell 執行（約 5 秒就緒，最長執行 1 小時後自動結束）：
```powershell
wsl -d FDE-DT-Ubuntu -u fde -- bash /mnt/d/FDE-CC-Takeover/scripts/gcs_sitl.sh run
```
- 這個視窗不要關；關掉視窗 SITL 就停止。
- 確認身分（另開視窗）：
  ```powershell
  python D:\FDE-CC-Takeover\scripts\check_heartbeat.py 127.0.0.1
  ```
  應顯示 `sysid=251 ... autopilot=MAV_AUTOPILOT_ARDUPILOTMEGA`。
- 停止：
  ```powershell
  wsl -d FDE-DT-Ubuntu -u fde -- bash /mnt/d/FDE-CC-Takeover/scripts/gcs_sitl.sh stop
  ```

## 2. 地面站設定（已在本機設定好）
| 地面站 | 設定檔 | 自動連線 | SITL 連線 |
|---|---|---|---|
| QGC 5.1.5（`D:\QGC-Official\App\bin\QGroundControl.exe`） | `%APPDATA%\QGroundControl\QGroundControl.ini` | `[AutoConnect]` 全部 false | `FDE-SITL-127.0.0.1-5760`（TCP，自動連） |
| Mission Planner 1.3.83 | `文件\Mission Planner\config.xml` | 不會自動連（要按「連接」） | 手動 TCP |
| HyperQGC（HQGC） | `%APPDATA%\HQ UAV Science and Innovation Center\HQGroundControl.ini` | `[AutoConnect]` 全部 false；COM4 連結自動連已關 | `FDE-SITL-127.0.0.1-5760`（TCP，自動連） |

原始設定備份：`D:\FDE-CC-Takeover\backup\gcs-config-20261112\`。

## 3. 連線步驟
### QGC 5.1.5
1. 啟動 SITL（第 1 節）。
2. 開 QGC → 自動連上，左上顯示「Ready／Stabilize」，飛機在新竹（24.80, 120.97）。
3. 結束：右上關閉。

### Mission Planner
1. 啟動 SITL。
2. 右上連線埠下拉選 **TCP**（或直接輸入 TCP），鮑率不用管 → 按「连接」。
3. remote host 輸入 `127.0.0.1` → OK；remote Port 輸入 `5760` → OK。
4. 標題列顯示 `ArduCopter V4.7.2`，右上顯示 `TCP5760-251-QUADROTOR`。
5. 結束：按「断开连接」再關程式。

### HyperQGC（HQGC）
1. 啟動 SITL。
2. 開 HQGC → 自動連上，左上顯示「准备好／自稳模式（Stabilize）」。
3. 若跳「新版本可用」按「好的」關掉（不要下載）。
4. 結束：關閉時會問「與飛行器的連接仍然有效，確定退出？」→ 按確認。

## 4. 疑難排解
| 現象 | 原因／處理 |
|---|---|
| 連不上 127.0.0.1:5760 | SITL 沒啟動或已結束（1 小時上限）→ 重跑第 1 節 |
| 第二個地面站連不上 | 前一個還連著 → 先斷線或關掉前一個 |
| SYSID 顯示 1 不是 251 | ArduCopter 4.7 參數名為 `MAV_SYSID`（不是 `SYSID_THISMAV`），腳本已處理 |
| 地面站一開就連到 COM 埠 | 自動連線被改回 → 依第 2 節檢查 `[AutoConnect]`，或用備份還原 |

## 5. 禁止事項
- 不連真實飛機；不降低飛控安全限制（不改 ARMING_CHECK）。
- 不在 SITL 以外的連線上解鎖或上傳任務。
