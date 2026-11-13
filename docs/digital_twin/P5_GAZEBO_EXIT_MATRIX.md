# P5-I Gazebo 退出對照矩陣

## RCA-6 G5 飛行驗收

**BLOCKED BEFORE PROCESS START**：G5 靜態退出矩陣仍是 0/0（各三次），但本輪無法存取既有 plugin directory，故沒有把它延伸宣稱為 SITL/Gateway flight PASS。五次冷啟動尚未開始。

## RCA-5 camera 細分矩陣（2026-11-11）

| 組別 | SIGINT | SIGTERM | 狀態 |
| --- | ---: | ---: | --- |
| G0 完整 Iris | -11（3/3） | -11（5/5） | 故障重現 |
| G1 去 GstCameraPlugin | -11（3/3） | -11（6/6） | 故障仍重現 |
| G2 去 CameraZoomPlugin | -11（1/1） | -11（1/1） | 初步故障重現 |
| G3 去兩 camera plugins | -11（3/3） | -11（3/3） | 故障仍重現 |
| G4 僅關 GStreamer output | NOT_TESTABLE | NOT_TESTABLE | 無安全單一設定鍵 |
| G5 去 camera sensor、留 joint graph | 0（3/3） | 0（3/3） | 正常退出 |
| G6 lifecycle order | NOT_TESTABLE | NOT_TESTABLE | 無官方安全控制 API |

此表的 PASS/FAIL 僅指實驗觀測，不是產品修復狀態。詳見 [P5_RCA5_GIMBAL_ISOLATION.md](P5_RCA5_GIMBAL_ISOLATION.md)。

## RCA-3C 實驗前置（2026-11-11）

| 組別 | 計畫輸入 | 狀態 | 原因 |
| --- | --- | --- | --- |
| A | 最小空 SDF 的獨立新副本 | READY（僅規劃） | 不依賴 Iris model；本輪未建立/啟動 |
| B | 完整隔離 Iris world | READY WITH RISK | 三項 `.so` 已有 ABI/source 靜態證據，但仍無完整 build log 與 runtime 穩定性證據 |
| C | 隔離 world 的 camera/GStreamer 移除副本 | READY（僅規劃） | 可由完整副本另建，不可改官方 baseline |
| D | 隔離 world 的 rendering 相關移除副本 | NOT_TESTABLE | 尚無安全拆分 `gz-sim-sensors-system` 與 Ogre2 的證據 |
| E | 隔離 world + SITL | READY WITH RISK | 僅在 B 完整清理後分階段執行 |
| F | 隔離 world + SITL + Gateway | READY WITH RISK | 僅在 E 完整清理後分階段執行 |

## RCA-4 實測更新

詳見 [P5_RCA4_RUNTIME_EVIDENCE.md](P5_RCA4_RUNTIME_EVIDENCE.md)。D 仍是 `NOT_TESTABLE`；其餘組別已按獨立 run_id 執行 SIGINT 與 SIGTERM。有效結果：A=`0/0`，B=`-11/-11`，C=`0/0`，E 的 Gazebo=`-11/-11`，F 的 Gazebo=`-11/-11`。舊 C 變體的資源優先序/SDF graph 錯誤工件未參與比較。
