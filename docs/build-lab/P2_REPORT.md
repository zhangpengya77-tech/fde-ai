# 組裝實訓室｜P2 F450＋Pixhawk 2.4.8 接線報告

日期：2026-11-19　分支：`feat/build-lab-r2`　版本：R2.1-P2

## 狀態

| 項目 | 狀態 |
|---|---|
| 板卡配置檔 `data/boards/pixhawk-248-generic.js`（接口、類型、引腳；克隆版不假設一致） | PASS（引腳來源 PX4 Pixhawk 1 引腳表；克隆版是否相同：**待確認**） |
| 接線步驟 21 步 `data/f450-wiring.js`（電調電源→電源模組→飛控電源→MAIN OUT→三相→RC IN→GPS／I2C→TELEM1→蜂鳴器→安全開關→最後接電池） | PASS（內容 **PENDING_MANUAL**，須教師覆核） |
| 確定性接線規則 `core/wiring-rules.js`（極性、介面類型、接口用途、ESC 順序、電調↔電機、主電池不可接飛控、接口重複、飛控方向、槳葉旋向、整機檢查） | PASS（單元測試） |
| 接線模式畫面：俯視 2D＋Pixhawk 接口放大圖、編號熱點、白話說明、進度 n／21、線色極性圖例、返回 3D、撤銷上一條線 | PASS（無頭瀏覽器） |
| 每步校驗：接錯不會接上並顯示原因與正確做法；考試模式只說「接錯了（已記錄）」 | PASS |
| 3D 線束預覽（已接好的線畫在 3D 機體上） | PASS |
| 接線前條件：其他零件裝好、**槳葉必須拆下**；槳葉要等接線完成才能裝 | PASS |
| 錯誤案例教學 8 個：正負極反接、GPS 插錯口、ESC 信號順序錯、飛控方向錯、槳葉反裝、接收機未連接、焊點錯誤、主電池直接接 POWER | PASS（每個都由規則引擎實際判定；只在虛擬環境展示） |
| ArduPilot 參數模擬設定報告（8 個參數＋上線前檢查清單，可下載文字檔；**不寫入飛控**） | PASS（參數名稱與數值依 ArduPilot 原始碼 Copter-4.6.3 核對；實際韌體版本 **待確認**） |
| 組裝＋接線進度一起本機儲存、重新整理恢復、匯出／載入 | PASS |
| 完成畫面加入接線統計 | PASS |

## 參數依據（ArduPilot Copter-4.6.3 原始碼 @Param／@Values，2026-11-19 讀取）

| 參數 | 值 | 原始碼 |
|---|---|---|
| FRAME_CLASS | 1 Quad | `ArduCopter/Parameters.cpp` |
| FRAME_TYPE | 1 X | `ArduCopter/Parameters.cpp` |
| MOT_PWM_TYPE | 0 Normal | `libraries/AP_Motors/AP_MotorsMulticopter.cpp` |
| BATT_MONITOR | 4 Analog Voltage and Current | `libraries/AP_BattMonitor/AP_BattMonitor_Params.cpp` |
| GPS1_TYPE | 1 AUTO（4.6 起由 GPS_TYPE 改名） | `libraries/AP_GPS/AP_GPS.cpp` |
| SERIAL1_PROTOCOL | 2 MAVLink2（預設） | `libraries/AP_SerialManager/AP_SerialManager.cpp` |
| BRD_SAFETY_DEFLT | 1 Enabled | `libraries/AP_BoardConfig/AP_BoardConfig.cpp` |
| AHRS_ORIENTATION | 0 None | `libraries/AP_AHRS/AP_AHRS.cpp` |

## 測試

- 單元測試 `node --test tests/*.test.js`：**25／25 通過**（P1 13 項＋P2 12 項：21 步正確答案、ESC 順序、極性、主電池接飛控、介面類型、焊點錯誤、接口重複、飛控方向、槳葉旋向、接線引擎撤銷與存檔竄改、拆槳條件、8 個錯誤案例、參數報告）。
- 無頭瀏覽器（Playwright＋SwiftShader）：裝槳時擋下接線 → 拆槳後進入接線 → 故意反接被擋並說明 → 21 步全部接完 → 設定報告 8 列 → 錯誤案例 8 個 → 回 3D 裝槳完成 → 完成畫面含接線統計 → 重新整理後 21 條線恢復；P1 冒煙測試同時通過；**主控台 0 錯誤**；手機寬度無水平溢出。

## 未完成／待人工

- 接線內容、參數、引腳：PENDING_MANUAL（教師或有實機經驗者覆核後才可標 PASS）。
- Pixhawk 2.4.8 克隆版廠商與引腳、電調是否有 BEC、接收機輸出 PPM 或 SBUS、ArduPilot 實際韌體版本：待確認。
- 接口在板上的實際位置：示意圖只是放大排列，依克隆版而異。
- 手機實機觸控接線：未實測。

## 未改動

只新增／修改 `f450-twin/build-lab/` 與 `docs/build-lab/`；正式站、舊版數位孿生、後端、Gateway、Worker、學員資料都沒動；未 push／merge／deploy；網站入口仍關閉。
