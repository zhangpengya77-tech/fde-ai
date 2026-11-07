# USB 遙控器測試紀錄

## A. 自動化模擬測試（已執行，2026-11-07）
測試：`tests/browser/rea-exam.spec.ts`（Playwright，Desktop Chrome）
方法：以 Gamepad API **測試替身**模擬裝置 `Radiomaster Pocket Joystick (Vendor: 1209 Product: 4f54)`，
自動套用專案內建、先前**真機實測**的標定檔 `rc-profile-latest.json`（軸 0 roll、1 pitch、2 throttle unipolar、3 yaw）。

| 項目 | 結果 |
|---|---|
| 新入口自動辨識並使用該遙控器（HUD 顯示 Radiomaster） | ✅ PASS |
| 油門推高 → 新飛行引擎高度 > 1 m | ✅ PASS |
| 俯仰往前 → 往場地前方移動 > 0.5 m | ✅ PASS |
| 斷線（停止回報）→ 0.25 s 後改懸停，高度維持、不墜機 | ✅ PASS |
| 日本手（Mode 1）：原 pitch 軸改當油門 | ✅ PASS |

**這些是模擬測試，不等於真實硬體驗收。**

## B. 真實硬體驗收（尚未執行，需教師操作）
| 步驟 | 預期 | 結果 |
|---|---|---|
| RadioMaster Pocket 以 USB-C 資料線接電腦，選 USB Joystick (HID) | 系統辨識為遊戲控制器 | ☐ |
| 開 `…/sim/app/?mode=exam&exam=0`，動一下搖桿 | 左上「輸入：Radiomaster…」 | ☐ |
| 美國手：左手上推油門 | 起飛、上升 | ☐ |
| 右手前推 | 往場地前方飛 | ☐ |
| 右手左右 | 往左右平移 | ☐ |
| 左手左右 | 機頭左右轉 | ☐ |
| 設定改日本手：右手上推 | 起飛 | ☐ |
| 飛行中拔掉 USB | 自動懸停，不墜機 | ☐ |
| 完整飛一次四面停懸與 8 字 | 出現逐段評等 | ☐ |

通道映射、反向、死區、端點與中心校正：沿用既有「遙控器校正」流程（`?mode=` 巡檢場景的校正嚮導，與考照入口共用同一份標定儲存），本次未改動。
