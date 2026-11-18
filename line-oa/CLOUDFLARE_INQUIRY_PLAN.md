# 課程報名資料：Cloudflare 方案 A 實作與部署說明

- 決定日期：2026-11-18（教官選擇方案 A）
- 程式：`cloudflare/course-inquiry/`（獨立 Worker，不修改既有固定入口 Worker）
- 狀態：**程式與測試完成；尚未部署**（需要你登入 Cloudflare）

## 1. 架構

```text
官網表單（GitHub Pages）──POST──→ Cloudflare Worker /api/inquiry
                                   │  只接受官網來源（CORS）
                                   │  隱藏欄位、至少 3 秒填寫時間、每 IP 每小時 5 筆、每日 200 筆上限
                                   │  選用：Cloudflare Turnstile 防機器人
                                   ↓
                              Cloudflare D1（只存必要欄位；IP 只存加鹽雜湊）
                                   ↓
              /admin 後台 ← Cloudflare Access 登入 ＋ Email 白名單；每次查看與修改寫入操作紀錄
                                   ↓
                     每日排程刪除超過 180 天的資料
```

- **不依賴教師電腦**，24 小時都能收件。
- **與學員資料庫完全分開**：獨立的 D1 資料庫，不碰 `student_portal`。
- 通知信只寫「有新諮詢＋後台連結」，**信裡不放個資**。

## 2. 測試結果（雲端）

| 測試 | 結果 |
|---|---|
| Worker 單元測試（D1 以同一份 `schema.sql` 的真實 SQL 執行）：資料存取、欄位規則與官網一致、課程代號與名稱和官網資料一致、拒絕其他網站、機器人陷阱、填寫太快、限流、Turnstile、180 天刪除、Access 驗證（錯的 Email、錯的 AUD、過期、偽造簽章都被拒）、後台修改需同源並寫入操作紀錄 | **9／9 PASS** |
| 官網表單（live 模式）→ 本機執行的 Worker → 資料庫：真的送出並存入，欄位對應正確（含未成年與代理人同意） | **4／4 PASS** |
| 官網預覽（示範模式）回歸：桌面、iPhone、Android | 60／60 PASS |

執行：`node --test 'cloudflare/course-inquiry/test/*.test.mjs'`

## 3. 部署步驟（需要你登入 Cloudflare，約 20 分鐘）

1. **建立資料庫**
   ```bash
   npx wrangler d1 create fde-ai-course-inquiry
   npx wrangler d1 execute fde-ai-course-inquiry --remote --file=cloudflare/course-inquiry/schema.sql
   ```
2. 把 `wrangler.example.jsonc` 複製成 `wrangler.jsonc`，填入 `database_id`。
3. **設定祕密**：`npx wrangler secret put IP_SALT`（輸入一串隨機文字）。
4. **部署**：`npx wrangler deploy`，記下網址，例如 `https://fde-ai-course-inquiry.xxx.workers.dev`。
5. **保護後台**：Cloudflare Zero Trust → Access → 新增 Self-hosted 應用程式，網址填 `…workers.dev/admin*`，政策只允許 `zhangpengya77@gmail.com`；把應用程式的 AUD 標籤和團隊網域填進 `wrangler.jsonc` 的 `ACCESS_AUD`、`ACCESS_TEAM_DOMAIN`，再部署一次。
6. **測試**：用手機送一筆測試資料，登入 `/admin` 確認看得到，改一次處理狀態。
7. **接上官網**：把 `contact-config.js` 的 `inquiryUrl` 填成 `…workers.dev/api/inquiry`、`inquiryMode` 改成 `'live'`（屬於正式部署，要你批准）。

選用：
- **Turnstile**：在 Cloudflare 建立 Turnstile 站點，`wrangler secret put TURNSTILE_SECRET`，官網表單再加上 Turnstile 元件（需要另外改表單，屆時再做）。
- **通知信**：需要在 Cloudflare 有自己的網域並啟用 Email Routing；沒有網域時，先靠後台查看。

## 4. 對現有課程諮詢表單的影響（重要）

這個分支裡，官網表單**已經不再送到教師電腦**（`/api/public/course-inquiry/`），只會送到 Cloudflare Worker；Worker 沒有設定網址前，表單只做示範、不收資料。

所以上線順序必須是：**先完成第 3 節部署並測試 → 再把官網預覽合併上線**。如果先合併官網，現有表單會停止收件。

教師電腦裡既有的諮詢資料不會被搬移或刪除；是否匯出、何時停用舊後端，請你決定。
