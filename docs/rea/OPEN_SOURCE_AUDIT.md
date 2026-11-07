# 開源與授權稽核（2026-11-07）

| 專案 | 授權 | 最後更新 | 內容 | 是否使用 |
|---|---|---|---|---|
| drone.sean.cat/simulator（Sean Wei） | 未公開原始碼 | — | 線上服務 | **只做公開行為研究**，未複製程式、圖檔、3D 資產 |
| 搜尋 Sean 原作者公開倉庫 | — | — | GitHub 以名稱、網域搜尋皆找不到對應倉庫 | 判定**未公開** |
| tamago797/Drone-Simulator- | **無 LICENSE** | 2026-06-01 | 單一 index.html，台灣專業基本級模擬 | **不得複製**（無授權），未使用 |
| m72900024/LOS-Flight-Simulator | MIT | 2026-06-13 | Three.js LOS 訓練器，含台灣基本級關卡 | 可合法參考，但本次**未引用程式碼**（自行實作，避免混入不同物理語意） |
| fxty2006/DroneExamSimulator、senntouki05-bot/drone-exam-simulator | 無 LICENSE | 2025–2026 | 考照模擬 | 未使用 |
| vroby65/DroneCommander | MIT | 2026-11-06 | Three.js 無人機 | 未使用 |
| geophree/web-gamepad、aboodedc/VGamepadWeb | MIT | 2023／2026 | 網頁手把 | 未使用（沿用 FDE 既有手機連線） |

## 本專案實際使用的第三方元件
| 元件 | 授權 | 用途 | 來源 |
|---|---|---|---|
| three（r180） | MIT | 3D 場景 | 既有依賴，未新增 |
| MediaPipe Tasks Vision（hand_landmarker） | Apache-2.0 | 既有手勢連線 | 既有，未修改 |
| Vite／TypeScript／Vitest／Playwright | MIT／Apache-2.0 | 建置與測試 | 既有開發依賴 |

**本次沒有新增任何第三方依賴。** `src/rea/` 全部程式為本專案自行撰寫。

## 技術選型結論
GitHub Pages 只能放靜態檔，最適合：TypeScript + Three.js（WebGL）+ Gamepad API，全部在瀏覽器端計算，與參考站同一技術方向，也與 FDE 既有模擬器相同，可直接重用既有輸入層。
