# P5-I Gateway 生命週期診斷

## RCA-6 前置阻斷（2026-11-11）

新增 `p5i_rca6_flight.py` 以受控父程序管理 G5 Gazebo、Gateway 及其 session-owned SITL；它会记录 HTTP/WS、DELETE、退出码和端口。实际运行未进入 Gateway 启动：Windows E: 与 WSL `/mnt/e` 不可用，plugin directory 缺失，前置检查拒绝启动。没有新 Gateway 生命周期结论，也没有覆盖 RCA-5 证据。

日期：2026-11-11；範圍是 localhost-only Gazebo/SITL，未連接任何真實設備。

## #3 HTTP 8200 退出根因

Gateway stdout 只含正常啟動行，stderr 為空，沒有 Python traceback、MAVLink timeout 或 WebSocket exception。#3 由 Windows `Start-Process → wsl.exe → bash` 啟動；其父 shell/WSL 生命週期不受本次驗收程序控制。現有證據支持「外層啟動器回收」為根因，**不是已證實的 Gateway 內部崩潰**。

## 最小修復

新增 Gateway 隔離工具 `scripts/p5i_cold_start.py`：同一 WSL Python 父程序明確擁有 `gz sim` 與 `python -m fde_twin.server` 子程序，記錄 PID、readiness、提前退出碼與各自 log。子程序使用獨立 process group；清理時僅向該组送 TERM，避免廣泛匹配其他 `gz`/Python 進程。

定向測試：`tests/test_cold_start_runner.py` + `tests/test_gazebo_backend.py`，10 PASS。

## 首次受控結果

运行器 #1：Gazebo PID 18、Gateway PID 19、`ready=true`，兩者在 cleanup 前均未退出。Gateway session 正常到 GPS Fix 6，gyro/accel=true，正常 DELETE session 成功。這證明 8200/8201 的啟動與 session 保持可用；不是五次驗收完成。

後續外層停止時曾看到 WSL PID 快速復用為 shell，故清理只能依實時 command line 與端口狀態判斷，不能依歷史 PID。

## 未完成

- 五次完整獨立冷啟動：1/5 已完成，4/5 未執行。
- WebSocket 看門狗長連線、Chrome 專項：NOT RUN。
- IMU 預解鎖可重複性：未達門檻。
- Mission AUTO/RTL：BLOCKED / NOT RUN。

## RCA-4 Gateway 排除結果

F 組實驗在完整 Iris + SITL + Gateway 之下，Gazebo 在 SIGINT 與 SIGTERM 都是 `-11`；Gateway 自身按 SIGINT 為 `-2`、SIGTERM 為 `-15`。B 已在沒有 Gateway 時重現同一 Gazebo 結果，故目前證據不支持 Gateway 是 SIGSEGV 必要條件。端口與程序均在每組後釋放。
