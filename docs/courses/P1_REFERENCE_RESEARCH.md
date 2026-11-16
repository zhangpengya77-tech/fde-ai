# P1 參考案例研究與設計方案（五大職業實訓課程）

- 日期：2026-11-17
- 原則：只參考設計與結構，原創重構；不複製任何程式碼、圖片或商標。授權不明的標 PENDING_MANUAL。

## 1. 指定的三個參考專案

存在與授權都用 GitHub API 查過（2026-11-17）。

| 專案 | 存在 | 授權 | 技術 | 可參考的地方 | 處理方式 |
|---|---|---|---|---|---|
| GetNextjsTemplates/eLearning-tailwind-nextjs-free | ✅ | MIT | Next.js、React、Tailwind | 課程卡片網格、首頁「課程分類 → 卡片 → 了解更多」的導覽順序 | 只參考版面結構；我們的平台不是 Next.js，不引入框架，也不複製程式碼 |
| glittercowboy/course-landing | ✅ | **沒有授權檔（PENDING_MANUAL）** | Next.js、Tailwind、Framer Motion | 單一課程落地頁的段落順序（主視覺 → 學什麼 → 大綱 → 常見問題 → 行動按鈕）；**內容用 JSON 驅動** | 只參考段落順序與「資料驅動」的概念；授權不明，完全不使用其程式碼與素材 |
| altnautica/ADOSMissionControl | ✅ | GPL-3.0（GitHub 顯示 NOASSERTION，LICENSE 檔是 GPLv3） | Next.js、Electron 地面站 | 深色科技風面板、遙測資訊卡、狀態標籤 | GPL 程式碼不能併入本平台；只參考「深色玻璃面板＋青藍資訊卡」的視覺語言 |

## 2. 其他常見的科技教育／職業訓練網站版型（一般設計慣例）

這部分只歸納常見做法，沒有引用任何網站的內容：

- **課程總覽**：卡片上一定看得到「時數、對象、成果、了解課程」，讓人一分鐘內比較。
- **課程詳情**：主視覺 → 關鍵數字（時數、天數、班別）→ 適合對象 → 分階段大綱（每段配圖）→ 每日課表（可收合）→ 設備與軟體 → 成果與出路 → 諮詢。
- **可選修課程**：用計算器即時顯示總時數，比文字說明清楚。
- **諮詢**：欄位少、清楚的個資告知、送出後明確告知下一步。

## 3. 設計方案（已實作）

- **不重建、不換框架**：沿用平台既有的靜態 HTML＋原生 JS＋`FdeRouter` 單頁路由。
  - Django 對 `/platform/` 底下任何沒有副檔名的網址都回首頁 HTML，並注入 `<base href="/platform/">`，所以新增頁面不必改後端。
- **網址**：
  - `/platform/programs`：課程總覽；
  - `/platform/drone-license`、`seed-teacher`、`pro-pilot`、`rd-engineer`、`maintenance-engineer`：五門課詳情。
- **資料驅動**：
  - 課程內容在 `src/data/vocational-programs.js`；
  - 導航附加項目在 `src/data/nav-config.js`（FDE-GCS 等專案新增導航時只改這個檔，不會互相衝突）。
- **視覺**：
  - 深海軍藍、青藍光效、透明玻璃卡片；
  - 原創 SVG 線框示意圖：無人機、電路、資料網格；
  - 輕量動畫：旋翼轉動、航線流動，系統要求減少動態效果時關閉。
- **效能**：
  - 首頁課程專區不下載點陣圖；
  - 詳情頁的實拍照片延遲載入；
  - 老舊教室電腦也能流暢開啟。
