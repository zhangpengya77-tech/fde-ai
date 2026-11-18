# 組裝實訓室｜授權清單（ASSET_LICENSES）

查核日：2026-11-19。授權依各倉庫 LICENSE 原文（經 GitHub API 讀取）。

| 來源 | 版本／更新 | 授權 | 可重用部分 | 本案用法 | 狀態 |
|---|---|---|---|---|---|
| three.js（已內建於 `f450-twin/vendor/three`） | r181 | MIT（已讀 LICENSE） | 全部 | 3D 引擎，只讀共用 | OK |
| React Three Fiber（pmndrs/react-three-fiber） | master 2026-10-21 | MIT | 全部 | 僅方案 B 使用 | OK（待選方案） |
| drei（pmndrs/drei） | master 2026-11-17 | MIT | 全部 | 僅方案 B 使用 | OK（待選方案） |
| open-fpv-sim（hugowis/open-fpv-sim） | main 2026-11-18 | **GPL-3.0**（已讀 LICENSE 開頭） | 程式碼若併入會使 FDE-AI 需以 GPL 釋出 | **只參考概念**（零件資料檔附來源紀錄的做法、5" 機型資料欄位），**不複製任何程式碼或資料檔** | 只參考 |
| ArduPilot wiki（ArduPilot/ardupilot_wiki） | master 2026-11-18 | **CC BY-SA 3.0**（已讀 LICENSE） | 文字／圖片可引用但需署名且衍生作品需同授權 | 只引用「事實」（馬達編號、接口用途）並附連結；**不整段搬文字、不放其圖片** | 只引用事實 |
| ArduPilot 韌體（ArduPilot/ardupilot） | master 2026-11-18 | GPL-3.0 | — | 只讀官方說明對照，不使用程式碼 | 只參考 |
| Betaflight 韌體（betaflight/betaflight） | master 2026-11-17 | GPL-3.0 | — | 只讀說明對照，不使用程式碼 | 只參考 |
| Betaflight 文件站（betaflight/betaflight.com） | master 2026-11-18 | **GitHub 未標示授權** | 不明 | 只引用事實並附連結 | PENDING_MANUAL |
| PX4 開源硬體 FMUv2.4.6 引腳（既有 `pins.js` 已引用） | — | CC BY-SA 3.0（既有註解） | 引腳事實 | P2 板卡配置檔可引用事實並署名 | 沿用，P2 再核對 |
| lumipaddrones 工具 | — | GitHub 查無此帳號／倉庫 | 不明 | 只當流程參考，不取用任何內容 | PENDING_MANUAL |
| 參考影片中的組裝工具 | — | 第三方，授權不明 | 無 | 只依畫面歸納流程；不反編譯、不抓取、不使用其名稱／圖示／配色／文案 | 只參考畫面 |
| REA（morluto/rea，npm `rea-agents` 6.9.0） | 2026-11-18 | MIT | 分析工具（不進入產品） | 尚未安裝（Node 版本不符） | BLOCKED |

## 3D 零件素材原則

- 簡單結構（板、臂、銅柱、螺絲、電機外形、XT60）以程式生成，屬自行設計。
- 複雜外形若需 CAD，只用授權明確可商用／教育使用的來源，並逐件登記於本表；目前**尚未引入任何外部模型**。
- 不使用 DJI 或其他商業素材，不放第三方 Logo；既有 `f450-twin/models/*.glb` 為本專案先前自建（沿用前於 P1 再確認其來源紀錄）。
