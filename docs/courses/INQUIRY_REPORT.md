# 課程諮詢：寄信＋獨立資料庫＋教師後台（2026-11-18）

依使用者決定：諮詢資料採「寄信＋獨立資料庫」，並以**教師後台為主要查看處**；寄信只是輔助。

## 流程

1. 訪客在官網「課程專區」或課程詳情頁填寫諮詢表單，欄位如下：
   - 稱呼、聯絡方式（手機或 Email）、課程、班別、問題（選填）；
   - 必須勾選同意個資告知。
2. 表單送到 `POST /api/public/course-inquiry/`，由教師電腦上的 Django 處理。
   - 在 GitHub Pages 上，表單改送到固定入口 `fde-ai-v2.fde-ai-gateway.workers.dev`。
   - 用一般表單格式送出，不需要跨網站預檢，也不帶 Cookie。
3. Django 存進**獨立資料庫**，正式站位置是 `D:\FDE-AI-Runtime\v2-integration\db\inquiries.sqlite3`。
   - 不寫入學員系統的 `integration.sqlite3`；資料庫路由確保兩邊互不寫入，測試也驗證過。
4. 寄一封通知信給老師（輔助）。
   - 收件人設定在 `FDE_COURSE_INQUIRY_NOTIFY_EMAILS`；沒設定時寄到寄件帳號本身。
   - 寄不出去不影響保存，後台會標「通知信未寄出」。
5. 老師到**教師後台 → 課程諮詢**（`/teacher/course-inquiries/`）查看。
   - 教師總覽最上方有「🔔 N 筆新諮詢」通知。

## 教師後台「課程諮詢」頁

- **統計**：未讀新諮詢、近 7 天、保存中的總數；各課程、各班別、近 8 週長條圖。
- **列表**：
  - 時間、稱呼、聯絡方式、課程、班別、問題、狀態；
  - 未讀以黃色標示 🔔 新；
  - 可單筆「標示已讀／改回未讀」，或「全部標示為已讀」，並記錄由誰、何時標示；
  - 可切換「只看未讀」。
- **權限**：只有教師帳號（is_staff）能開；學員看到 403，未登入會轉到登入頁。所有教師都看得到全部諮詢（不分班級）。

## 個資與防濫用

- **只收必要欄位**；不存原始 IP，只存加鹽雜湊（用來限流）。
- **保存 180 天後自動刪除**：有人送出或開啟後台時清理。個資告知也寫明此期限。
- **防機器人**：
  - 隱藏陷阱欄位；
  - 填寫少於 3 秒直接丟棄（回應假裝成功）；
  - 來源網站檢查：只接受固定入口、GitHub Pages、快速通道與本機。
- **限流**：同一來源 10 分鐘最多 3 筆；全站每小時最多 60 筆；網頁上 30 秒內不能重送。
- **教師電腦關機時**：表單顯示「教學主機目前離線」，並引導改用 LINE 或電話，不會遺失訪客輸入的內容。

> 限制：經過 Cloudflare 固定入口時，入口會把 Origin 改寫成快速通道網址（Django 的 CSRF 檢查需要），所以「來源網站檢查」只對直接連線有效。經過入口的請求主要靠陷阱欄位、填寫時間和限流保護。

## 修改清單

- 新增 Django app `student_portal/inquiries/`：
  - 資料模型、資料庫路由、API 與教師頁、模板、未讀數模板標籤、第一個 migration、13 項測試。
- `student_portal/config/settings.py`：
  - 加入 app、`DATABASES['inquiries']`（獨立 SQLite）、`DATABASE_ROUTERS`、通知信與來源設定。
- `student_portal/config/urls.py`：加入 inquiries 網址。
- `learning/templates/learning/teacher_dashboard.html`：最上方加「課程諮詢」入口與未讀通知。這是唯一碰到既有教師後台的地方，只加了一個區塊。
- `src/programs.js`：表單改為正式送出（成功、離線、限流、錯誤訊息），並更新個資告知。
- `cloudflare/v2-fixed-entry/src/index.js`：課程諮詢 API 開放給 GitHub Pages 跨網站讀取結果；離線時回 503，同樣帶跨網站許可。

## 測試

- Django `inquiries`：13/13 通過，涵蓋：
  - 存進獨立資料庫、學員資料庫沒有這張表；
  - 寄信、沒設定收件人也照樣保存；
  - 來源檢查、欄位驗證、陷阱欄位、填太快、限流；
  - 只接受 POST、180 天自動刪除、課程清單與官網資料一致；
  - 教師統計與未讀、標示已讀、教師總覽通知、學員與訪客不能開。
- Cloudflare 固定入口：16/16 通過，含諮詢跨網站與離線兩種情況。
- 課程專區瀏覽器測試：86/86 通過，含表單實際送出的內容、成功訊息、180 天告知、30 秒限流。

## 部署（需要 UAC 重啟 Django）

1. 正式站打備份標籤，再快轉到新版本。
2. `python docs\courses\inquiry_manage.py migrate`：只在新的 `inquiries.sqlite3` 建立資料表，不動學員資料庫。
3. 用系統管理員身分執行 `D:\FDE-AI-Runtime\v2-integration\services\restart_django_clean.ps1`，讓新的設定和 app 生效（需要你按 UAC）。
4. 發佈 Cloudflare 固定入口；GitHub Pages 推送表單程式。
5. `python docs\courses\inquiry_manage.py verify` 檢查。

## 回退

1. `git reset --keep` 回到備份標籤。
2. 重啟 Django。
3. Worker 重新發佈前一版。

`inquiries.sqlite3` 留著也不影響任何功能，要刪除時直接刪掉這個檔案即可。
