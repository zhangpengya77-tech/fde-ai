# FDE-GCS Web 1.0 開源授權審計（P0）

- 審計日期：2026-11-13
- 審計環境：雲端容器，可連 GitHub raw 原文；**無法存取本機 D:\ / E:\**
- 判定標記：`OK`（可依條件使用）／`CAUTION`（可用但有限制）／`AVOID`（第一版不採用）／`PENDING_MANUAL`（授權不明或需人工確認）

## 1. 逐項核對結果

| # | 專案 | 授權（依 LICENSE 原文） | 原文來源 | 判定 | FDE-GCS 用法 |
|---|---|---|---|---|---|
| 1 | QGroundControl | Apache 2.0 **或** GPL v3 雙授權，二擇一；README 註明走 Apache 2.0 需商業 Qt 授權 | https://raw.githubusercontent.com/mavlink/qgroundcontrol/master/.github/COPYING.md | `OK`（只作參考） | **只參考操作流程**，不複製程式碼、圖示、文案、商標。QGC 是 Qt／C++ 桌面程式，不假設能編成網頁版 |
| 2 | MAVLink（訊息定義＋產生器） | 產生器是 (L)GPL v3；**產生器輸出的程式碼依例外條款改為 MIT** | https://raw.githubusercontent.com/mavlink/mavlink/master/COPYING | `OK` | 用 mavgen 從 `common.xml`／`ardupilotmega.xml` 產生 TypeScript 編解碼器，產出物按 MIT 授權，附上 MIT 聲明 |
| 3 | pymavlink | 同上（產生器 LGPL v3，產出物 MIT 例外） | https://raw.githubusercontent.com/ArduPilot/pymavlink/master/COPYING | `OK` | 只在後端或 SITL Gateway 以 Python 套件形式**引用**（不修改、不靜態併入），符合 LGPL |
| 4 | ArduPilot | GPL v3 | https://raw.githubusercontent.com/ArduPilot/ardupilot/master/COPYING.txt | `OK`（獨立程序） | SITL 以獨立程序執行，經 MAVLink 通訊，不與網站程式碼連結 |
| 5 | ArduPilot 參數說明（apm.pdef.xml 等） | 由 ArduPilot 原始碼產生，原始碼為 GPL v3；說明文字本身的再散布條件**未見獨立聲明** | 同上 | `PENDING_MANUAL` | AI 調參助教的「參數中文說明」先由教師自行撰寫；直接轉載官方說明文字前需人工確認 |
| 6 | mavlink-router | Apache 2.0 | https://raw.githubusercontent.com/mavlink-router/mavlink-router/master/LICENSE | `OK` | SITL 單一擁有者分流的候選方案（Linux／WSL 執行），獨立程序 |
| 7 | ardupilot_gazebo | LGPL v3 | https://raw.githubusercontent.com/ArduPilot/ardupilot_gazebo/master/LICENSE.md | `OK`（獨立程序） | 屬於 Gazebo 接管案範圍，FDE-GCS 只透過 Gateway 讀取，不修改、不散布 |
| 8 | MAVProxy | GPL v3 | https://raw.githubusercontent.com/ArduPilot/MAVProxy/master/COPYING.txt | `CAUTION` | 只當本機開發工具使用，不併入網站 |
| 9 | node-mavlink（padcom） | LGPL v3 | https://raw.githubusercontent.com/padcom/node-mavlink/master/LICENSE | `AVOID` | 前端打包會把 LGPL 程式碼靜態併入 bundle，替換性義務難以滿足；改用第 2 項自行產生的 MIT 編解碼器 |
| 10 | mavlink-mappings（padcom） | LGPL v3 | https://raw.githubusercontent.com/padcom/mavlink-mappings/master/LICENSE | `AVOID` | 理由同上 |
| 11 | Leaflet（地圖） | BSD 2-Clause | https://raw.githubusercontent.com/Leaflet/Leaflet/main/LICENSE | `OK` | 航線規劃地圖；**本地打包同源載入**，不使用 CDN；保留版權聲明 |
| 12 | 地圖圖磚（OSM 等） | 依各圖磚服務條款，非程式授權 | — | `PENDING_MANUAL` | 第一版先用離線底圖或教師核准的圖磚來源；確認使用條款與署名要求後再接 |
| 13 | HyperQGC（南京超維）／阿木實驗室 | 本次未找到公開授權條款 | — | `PENDING_MANUAL` | **不複製任何內容**；只能由教師在本機實際操作後，以自己的話描述操作場景 |

## 2. 結論與規則

1. **前端 MAVLink 編解碼**：用 mavgen 自行產生 TypeScript 版（MIT 例外），不引入 LGPL 的 npm 套件。P1 要先驗證所用 pymavlink 版本的 mavgen 確實支援 TypeScript 輸出，並記錄版本號；不支援就改寫最小編解碼器，只涵蓋第一版需要的訊息。
2. **QGC／HyperQGC**：只參考「操作場景與功能流程」，我方產品名、圖示、配色、文案全部自行設計，不出現 QGroundControl、HQGC、HyperQGC 作為產品名稱。
3. **SITL、Gazebo、mavlink-router、MAVProxy** 都以獨立程序執行，透過網路協定通訊，不與網站程式碼連結或一起散布。
4. 每個實際進入 bundle 的第三方套件，都要在 P1 補一份 `THIRD_PARTY_NOTICES`，記錄名稱、版本、授權和來源網址。

## 3. 未完成項目（需本機或人工）

| 項目 | 狀態 | 原因 |
|---|---|---|
| 本機 QGC（D:\QGC-Official）版本與授權檔核對 | `PENDING_LOCAL` | 雲端無法存取 D 槽 |
| 本機 HyperQGC（E:\HQGC）授權條款 | `PENDING_MANUAL` | 無公開授權資料，需教師確認 |
| ArduPilot 參數說明文字的轉載條件 | `PENDING_MANUAL` | 見第 1 節第 5 項 |
| 地圖圖磚服務條款 | `PENDING_MANUAL` | 見第 1 節第 12 項 |
