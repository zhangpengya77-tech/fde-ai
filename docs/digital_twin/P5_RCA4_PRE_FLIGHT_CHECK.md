# P5-I-RCA-4 靜態預檢

日期：2026-11-11。未啟動 Gazebo、SITL、Gateway。

## 測試專用環境設計

每一個 RCA-4 子程序應擁有獨立 `run_id` 和新建工作副本，並僅在子程序環境設定：

```text
GZ_SIM_RESOURCE_PATH=/home/fde/fde_p5i_rca_isolated/resources-f116b03552d0-complete
GZ_SIM_SYSTEM_PLUGIN_PATH=/mnt/e/FDE-Gazebo/build/ardupilot_gazebo:<Gazebo-Harmonic-system-plugin-directory>
```

不改 Windows/WSL 全域環境，也不讀取 `/mnt/e/FDE-Gazebo/src/ardupilot_gazebo/worlds/iris_runway.sdf` 或 dirty `models/iris_with_standoffs/model.sdf`。由於 plugin binaries 沒有 RPATH/RUNPATH，系統 loader 預設庫目錄是 ABI 的唯一已確認來源；未來若需要 `LD_LIBRARY_PATH`，只能在測試子程序中明確、最小化設定。

## 六組預檢

| 組別 | 輸入 / 所需插件 | 端口 | 預期觀測 | 判定 |
| --- | --- | --- | --- | --- |
| A | 新建最小空 SDF；僅 Gazebo built-in | 無 | SIGINT/SIGTERM 退出碼、PID/pgid | READY |
| B | 完整隔離 Iris world；ArduPilot/Camera/Gst plugins | 無 | 插件載入、退出碼、stderr | READY WITH RISK：三項 binary 為 PARTIALLY_VERIFIED |
| C | 由完整副本新建 camera/GStreamer 移除副本；不載入 Camera/Gst | 無 | 與 B 的退出差異 | READY，前提是保留 world 其餘內容與 manifest |
| D | 移除 rendering/Ogre2 | 無 | 可比退出行為 | NOT_TESTABLE：目前沒有不破壞 sensors system 的技術上可比拆分方案 |
| E | B + SITL | SITL/MAVLink 專用端口 | SITL 斷線順序和 Gazebo 退出 | READY WITH RISK：僅在 B 先完成且乾淨後 |
| F | E + Gateway | 8200/8201/8210/9002/5760（以實際綁定為準） | Gateway 是否影響退出 | READY WITH RISK：僅在 E 先完成且所有端口可精確歸屬後 |

## 執行前阻斷條件

- 任一隔離 resource manifest 與 Git object SHA 不一致。
- 原始 E 槽 world/model 被改寫，或啟動器有回退解析到其路徑。
- 任一必要 port 已由無法歸屬的程序監聽。
- 需要改動 ARming、sensor health、token、Origin、RC watchdog 或第三方插件源碼。

## RCA-4 授權判定

可安全提出 A、B、C 的非特權最小退出實驗；E/F 必須按 B/E 分階段執行。因現在 RCA-3D 的指令明確禁止啟動任何仿真，本文件不是啟動授權。需要使用者對 RCA-4 實驗另行批准。

