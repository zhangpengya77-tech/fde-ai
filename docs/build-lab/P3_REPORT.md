# 組裝實訓室｜P3 5 吋 FPV 報告

日期：2026-11-19　分支：`feat/build-lab-r2`　版本：R2.1-P3　網址：`/f450-twin/build-lab/?model=fpv5-225`（頁首「機型」可切換）

## 狀態

| 項目 | 狀態 |
|---|---|
| 機型註冊表 `data/models.js`：F450 與 5 吋共用同一套引擎與畫面，頁首下拉切換；存檔依機型分開 | PASS |
| 5 吋零件 24 件（底板、四機臂、2207×4、4 合 1 電調、電容、XT60、F7 飛控、ELRS、數位圖傳、攝影機、鋁柱、上板、天線、電池、5 吋槳×4） | PASS（尺寸通用件 **待確認**；外形為程式簡化，不模仿 CAD） |
| Betaflight 馬達編號與旋向（與 ArduPilot 分開建表）：M1 右後 CW、M2 右前 CCW、M3 左後 CCW、M4 左前 CW（槳向內） | PASS（依 Betaflight 原始碼 `mixerQuadX` 與官方 Motors 分頁文件；**PENDING_MANUAL**） |
| 板卡配置檔 `betaflight-f7-3030-generic.js`（8P 排線、UART1／2 焊盤、HD 6P；線序依廠牌 **待確認**） | PASS |
| 接線 12 步：電機三相→電調 M1～M4、XT60、電容、8P 排線、ELRS（UART 交叉）、數位圖傳 6P、攝影機、天線（通電前）、最後接電池 | PASS（**PENDING_MANUAL**） |
| 新增規則：TX／RX 未交叉、電容反接、電壓超出零件規格（串數 × 4.2V）、天線未接、各機型自己的整機必要項目 | PASS |
| 5 吋錯誤案例 8 個：照 ArduPilot 編號焊電機、XT60 反接、電容反接、TX／RX 未交叉、6S 接 4S 圖傳、槳葉反裝、天線未接、接收機未接 | PASS |
| Betaflight 設定檢查報告（模擬）：Mixer QUADX、yaw_motors_reversed OFF、motor_pwm_protocol DSHOT600、UART2 Serial RX、serialrx_provider CRSF、osd_displayport_device MSP、vcd_video_system HD＋檢查清單；**不寫入飛控** | PASS（名稱依 Betaflight 4.5.2 `settings.c`；韌體版本 **待確認**） |
| 3D 場景依機型大小自動縮放（零件盤、視角） | PASS |

## 測試

- 單元測試 `node --test tests/*.test.js`：**35／35 通過**（新增 10 項 5 吋測試）。
- 無頭瀏覽器：5 吋完整流程（裝槳時擋接線→拆槳→故意把右後電機焊到 M2 被擋並說明 Betaflight 編號→12 步完成→Betaflight 報告 7 列→錯誤案例 8 個→裝槳完成→重新整理恢復 12 條線）；F450 兩套腳本回歸測試同樣通過；**主控台 0 錯誤**；手機寬度無水平溢出。

## 待確認／待人工

- 選定真實機架、飛控、4 合 1 電調、圖傳、接收機型號後，換成官方尺寸與焊盤／線序（目前是通用教學堆疊）。
- 電調支援的協定（DShot 等）、圖傳電壓範圍、Betaflight 實際韌體版本。
- 所有接線與設定內容須教師或有實機經驗者覆核才可標 PASS。
- 手機實機觸控未實測。

## 未改動

只動 `f450-twin/build-lab/` 與 `docs/build-lab/`；正式站、舊版數位孿生、後端、學員資料都沒動；未 push／merge／deploy；網站入口仍關閉。
