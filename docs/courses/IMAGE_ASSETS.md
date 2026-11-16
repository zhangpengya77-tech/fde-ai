# 圖片資源與授權清單（五大職業實訓課程）

- 日期：2026-11-17
- 原則：只用 FDE-AI 自有或教師已同意公開的素材；不使用 DJI、NVIDIA 等品牌宣傳圖，也不用講師個人照片。
- **原創示意圖**由 `src/programs-art.js` 用程式繪製 SVG，頁面標示「示意圖」，**不是**真實教學設備照片。
- **實拍**照片是教師提供的 F450 真機照片（教師 2026-11-06 同意公開），頁面標示「實拍」。
- 效能：首頁課程專區全用內嵌 SVG，**不下載任何點陣圖**（首頁圖片預算 0 KB）。實拍照片只在詳情頁出現，並使用 `loading=lazy`。
- 尚未完成：每門課的「真實場景照片」（巡檢、植保、高空清洗、測繪、編隊、工廠、課堂等）需要老師提供有授權的照片，見待確認清單。

## A. 原創 SVG 示意圖（39 種場景）

| 場景代號 | 來源 | 授權 | 用在哪裡 | 檔案 |
|---|---|---|---|---|
| license | 原創（程式繪製） | FDE-AI 自有 | 無人機證照考取專班（主視覺／卡片封面） | src/programs-art.js |
| seed | 原創（程式繪製） | FDE-AI 自有 | FDE-AI 無人載具種子教師專案（主視覺／卡片封面） | src/programs-art.js |
| pilot | 原創（程式繪製） | FDE-AI 自有 | 專業無人機職業飛手專案（主視覺／卡片封面） | src/programs-art.js |
| rd | 原創（程式繪製） | FDE-AI 自有 | 無人載具軟硬體研發工程師專案（主視覺／卡片封面） | src/programs-art.js |
| mro | 原創（程式繪製） | FDE-AI 自有 | 無人載具裝調檢修與測試工程師專案（主視覺／卡片封面） | src/programs-art.js |
| rules | 原創（程式繪製） | FDE-AI 自有 | 無人機證照考取專班｜法規、安全與考照流程 | src/programs-art.js |
| simulator | 原創（程式繪製） | FDE-AI 自有 | 無人機證照考取專班｜模擬器與基礎操控<br>FDE-AI 無人載具種子教師專案｜無人載具基礎與飛行 | src/programs-art.js |
| hover | 原創（程式繪製） | FDE-AI 自有 | （備用） | src/programs-art.js |
| route | 原創（程式繪製） | FDE-AI 自有 | 無人機證照考取專班｜術科路線強化 | src/programs-art.js |
| checklist | 原創（程式繪製） | FDE-AI 自有 | 無人機證照考取專班｜模擬考核與弱項強化 | src/programs-art.js |
| f450 | 原創（程式繪製） | FDE-AI 自有 | （備用） | src/programs-art.js |
| cad | 原創（程式繪製） | FDE-AI 自有 | FDE-AI 無人載具種子教師專案｜3D 建模與列印<br>無人載具軟硬體研發工程師專案｜第9–12天 結構設計與數位製造 | src/programs-art.js |
| ai | 原創（程式繪製） | FDE-AI 自有 | FDE-AI 無人載具種子教師專案｜AI 視覺目標檢測<br>無人載具軟硬體研發工程師專案｜第40–46天 AI 視覺與綜合工程專案 | src/programs-art.js |
| industry | 原創（程式繪製） | FDE-AI 自有 | FDE-AI 無人載具種子教師專案｜產業應用與數位實訓平台 | src/programs-art.js |
| classroom | 原創（程式繪製） | FDE-AI 自有 | FDE-AI 無人載具種子教師專案｜教案設計與教學能力 | src/programs-art.js |
| factory | 原創（程式繪製） | FDE-AI 自有 | FDE-AI 無人載具種子教師專案｜無人機工廠產業實習 | src/programs-art.js |
| assistant | 原創（程式繪製） | FDE-AI 自有 | FDE-AI 無人載具種子教師專案｜真實課程助教實習 | src/programs-art.js |
| exam | 原創（程式繪製） | FDE-AI 自有 | FDE-AI 無人載具種子教師專案｜最終技術與教學考核<br>無人載具裝調檢修與測試工程師專案｜綜合考核 | src/programs-art.js |
| mission | 原創（程式繪製） | FDE-AI 自有 | 專業無人機職業飛手專案｜共同基礎 | src/programs-art.js |
| inspection | 原創（程式繪製） | FDE-AI 自有 | 專業無人機職業飛手專案｜模組 A | src/programs-art.js |
| agri | 原創（程式繪製） | FDE-AI 自有 | 專業無人機職業飛手專案｜模組 B | src/programs-art.js |
| clean | 原創（程式繪製） | FDE-AI 自有 | 專業無人機職業飛手專案｜模組 C | src/programs-art.js |
| mapping | 原創（程式繪製） | FDE-AI 自有 | 專業無人機職業飛手專案｜模組 D<br>無人載具軟硬體研發工程師專案｜第38–39天 無人機測繪建模 | src/programs-art.js |
| formation | 原創（程式繪製） | FDE-AI 自有 | 專業無人機職業飛手專案｜模組 E | src/programs-art.js |
| pcb | 原創（程式繪製） | FDE-AI 自有 | 無人載具軟硬體研發工程師專案｜第1–8天 電路與 PCB 開發 | src/programs-art.js |
| sitl | 原創（程式繪製） | FDE-AI 自有 | 無人載具軟硬體研發工程師專案｜第13–18天 AI 輔助開發、SITL 與 ROS 2 | src/programs-art.js |
| gcs | 原創（程式繪製） | FDE-AI 自有 | 無人載具軟硬體研發工程師專案｜第19–23天 QGC 二次開發 | src/programs-art.js |
| vtol | 原創（程式繪製） | FDE-AI 自有 | 無人載具軟硬體研發工程師專案｜第24–34天 開源飛控與多機型驗證 | src/programs-art.js |
| fixedwing | 原創（程式繪製） | FDE-AI 自有 | 無人載具裝調檢修與測試工程師專案｜固定翼與 VTOL | src/programs-art.js |
| rover | 原創（程式繪製） | FDE-AI 自有 | 無人載具軟硬體研發工程師專案｜第35–37天 無人車系統整合<br>無人載具裝調檢修與測試工程師專案｜無人車 | src/programs-art.js |
| tools | 原創（程式繪製） | FDE-AI 自有 | 無人載具裝調檢修與測試工程師專案｜F450 多旋翼裝調檢修 | src/programs-art.js |
| wiring | 原創（程式繪製） | FDE-AI 自有 | （備用） | src/programs-art.js |
| fc | 原創（程式繪製） | FDE-AI 自有 | （備用） | src/programs-art.js |
| diagnose | 原創（程式繪製） | FDE-AI 自有 | （備用） | src/programs-art.js |
| repair | 原創（程式繪製） | FDE-AI 自有 | （備用） | src/programs-art.js |
| health | 原創（程式繪製） | FDE-AI 自有 | （備用） | src/programs-art.js |
| qc | 原創（程式繪製） | FDE-AI 自有 | 無人載具裝調檢修與測試工程師專案｜品質檢測 | src/programs-art.js |
| large | 原創（程式繪製） | FDE-AI 自有 | 無人載具裝調檢修與測試工程師專案｜大型考照機專題 | src/programs-art.js |
| gimbal | 原創（程式繪製） | FDE-AI 自有 | （備用） | src/programs-art.js |

## B. 實拍照片（教師提供）

| 檔案 | 來源 | 授權 | 用在哪裡 |
|---|---|---|---|
| /f450-twin/img/photo-view-iso.jpg | 教師提供 F450 真機照片 | 教師 2026-11-06 同意公開於本平台 | 無人機證照考取專班｜實機基礎飛行 |
| /f450-twin/img/photo-wiring.jpg | 教師提供 F450 真機照片 | 教師 2026-11-06 同意公開於本平台 | FDE-AI 無人載具種子教師專案｜F450 裝調檢修 |
