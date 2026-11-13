# P5-I-RCA-4 受控 Gazebo 退出實驗證據

> RCA-5 後續：在不移除 gimbal 模型或其三軸 joint graph 的條件下，只有移除 camera sensor 的 G5 變體於兩種訊號各 3/3 正常退出；單獨或同時移除 camera plugins 都未消除 `-11`。詳見 `P5_RCA5_GIMBAL_ISOLATION.md`；此結果沒有改寫本檔的 RCA-4 原始證據。

日期：2026-11-11。所有實驗使用非特權 WSL 使用者、獨立 `run_id` 與 `/home/fde/fde_p5i_rca_runs/<run_id>/` 日誌。未 ARM、未起飛、未建立 Mission、未連接真實飛控。

## 實際資源與程序邊界

- world/model：`/home/fde/fde_p5i_rca_isolated/resources-f116b03552d0-complete` 的固定 30-object manifest。
- 完整 Iris world SHA-256：`35369d7a179e5eb3a190fbb0747b06c49c4a61fb382ff5a45ef48b168ad47b4a`。
- E/F 僅使用 `/home/fde/ardupilot/build/sitl/bin/arducopter --model JSON --slave 0 --sim-address 127.0.0.1`；沒有 ARM 指令。
- `GZ_SIM_RESOURCE_PATH` 僅使用隔離 models，以及 C 的測試副本 overlay；未包含 E 槽 source worktree。
- `GZ_SIM_SYSTEM_PLUGIN_PATH`：`/mnt/e/FDE-Gazebo/build/ardupilot_gazebo:/usr/lib/x86_64-linux-gnu/gz-sim-8/plugins`。

## 實驗矩陣

| 組別 | SIGINT | SIGTERM | 結論 |
| --- | ---: | ---: | --- |
| A 空場景 | 0 | 0 | Gazebo 本體與受控 process-group 停止：PASS |
| B 完整隔離 Iris，無 SITL | -11 | -11 | 兩種訊號均重現 SIGSEGV |
| C 移除 `gimbal_small_3d` include 與 `gimbal_joint` 的測試副本 | 0 | 0 | 正常初始化並正常退出；仍有缺失 gimbal controller 的警告 |
| D 移除 Ogre2/rendering | NOT_TESTABLE | NOT_TESTABLE | 未找到可比較且不破壞 sensors system 的安全配置 |
| E 完整 Iris + SITL | Gazebo -11；SITL -2 | Gazebo -11；SITL 0 | SITL 不是必要條件 |
| F 完整 Iris + SITL + Gateway | Gazebo -11；SITL -2；Gateway -2 | Gazebo -11；SITL 0；Gateway -15 | Gateway 不是必要條件 |

每筆完整 `result.json`、`gazebo.log` 以及 E/F 的 `sitl.log`、`gateway.log` 均位於對應 `/home/fde/fde_p5i_rca_runs/rca4-*/` 目錄。舊 C run (`465…`、`e38…`、`583…`、`22f…`) 是變體資源解析或 SDF graph 製作錯誤，已保留但明確排除於比較結論。

## 診斷結論與限制

`STRONGLY_SUPPORTED_HYPOTHESIS`：完整 Iris 的 gimbal camera/GStreamer 裝配路徑（包含其相關 model/plugin 生命周期）是此次受控退出 SIGSEGV 的必要條件。依據是 A 正常、B 在兩訊號下 -11、C 在兩訊號下 0、E/F 仍為 -11。

這不是 `CONFIRMED_ROOT_CAUSE`：C 同時移除了 gimbal include 與關聯 joint，且日誌仍顯示三個缺失 gimbal controller 警告；未取得 core 或 stack trace，且 `gdb` 在環境中不可用。因此不能將故障歸因為單獨的 GstCameraPlugin、Ogre2 或某一行第三方程式碼。

## 清理與回歸

- 每次 child 以自身 process group 精確停止；無強制 kill。
- 最終 8200、8201、8210、9002、5760 沒有監聽；沒有 Gazebo/SITL/Gateway 殘留程序。
- Gateway 全量 pytest：45 PASS。
- 本輪未執行前端測試；先前前端 859 PASS 僅為歷史基線。

