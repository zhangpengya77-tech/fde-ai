# Pixhawk 2.4.8 接線與校正

本文件提供 Pixhawk 2.4.8 飛控在 F450 上的基礎接線與校正說明。

## 飛控方向

Pixhawk 2.4.8 安裝時，飛控外殼上的箭頭方向應朝向機頭。若因機架限制無法朝前，必須在 Mission Planner 中設定正確的 AHRS Orientation。

## 常見接線

- 電源模組接 Pixhawk POWER 端口。
- GPS / 指南針接 GPS / I2C 相關端口，依模組線材而定。
- 接收機接 RC IN。
- 四個電調訊號線接 MAIN OUT 1 到 MAIN OUT 4。
- USB 線可接電腦進行 Mission Planner 設定。

## 基本校正

在 Mission Planner 中通常需要完成：

- Frame Type 機架類型設定，F450 為四軸 X 型。
- 加速度計校正。
- 指南針校正。
- 遙控器校正。
- 電調校正。
- 飛行模式設定。
- FailSafe 失控保護設定。

## 馬達測試

馬達測試前必須拆下槳葉。若馬達序號或方向不正確，不能安裝槳葉起飛，應先調整電調訊號線順序或馬達三相線。

