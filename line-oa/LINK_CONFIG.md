# FDE-AI 官網連結配置清單（V4.1 階段一盤點）

- 盤點日期：2026-11-18
- 來源：GitHub `zhangpengya77-tech/fde-ai`，分支 `codex/github-pages-public` @ `56eec7c`（官網發布分支，只讀）
- 官網網址：`https://zhangpengya77-tech.github.io/fde-ai/v2/`（根目錄 `/fde-ai/` 會自動轉到 `/v2/`）
- 「連結有效」一欄：雲端環境的網路規則擋住 github.io、YouTube、LINE，**無法從雲端實際開啟**，請在手機或電腦上確認

| 項目 | 連結 | 出處 | 狀態 |
|---|---|---|---|
| 官網首頁 | `https://zhangpengya77-tech.github.io/fde-ai/v2/` | `public-site/index.html` 轉址 | 已存在；連結有效待本機確認 |
| 課程專區 | `https://zhangpengya77-tech.github.io/fde-ai/v2/programs` | `src/router.js`（`programs` 路由） | 已存在；**V4.1 規定課程專區預覽通過前，六宮格先用佔位** |
| 平台介紹（關於我們） | `https://zhangpengya77-tech.github.io/fde-ai/v2/about` | `index.html` `#about` 區塊 | 已存在，可直接複用 |
| 一分鐘平台介紹影片 | 「關於我們」頁內的影片（`v2/f450-twin/media/about-intro.mp4`）；首頁按鈕「一分鐘認識 FDE-AI」 | `index.html` | 已存在；歡迎訊息連到「關於我們」頁，由使用者自己點播 |
| 發起人履歷 | **官網上沒有** | 全站搜尋不到「張鵬亞」 | 預覽頁 `v2/founder/` 照錄教官先前提供的文字，**待確認** |
| 學員成果 YouTube | `https://www.youtube.com/channel/UCqKMXztPAsc2K6crQlKxzLg` | `src/platform.js`（歷屆成果 `youtubePlaylistUrl`） | 已存在；**學員與素材授權待確認** |
| 學習群組 LINE | `https://line.me/ti/g/jnXbd7PKK8` | `src/join-us.js`、`src/programs.js` | 已存在；「加入需審核」設定待確認 |
| 個人 LINE | **官網上沒有** | 全站唯一的 LINE 連結是上面的群組（網址 `/ti/g/` 是群組） | **待提供** |
| LINE 官方帳號 | — | 尚未註冊 | **待提供**（不得編造或用其他連結頂替） |
| 聯絡電話 | `tel:0901189740`（顯示 0901-189-740） | `src/join-us.js`、`src/programs.js` | 已存在；**公開顯示待你再次確認** |
| 服務時間 | — | 官網沒有 | **待提供** |
| 隱私權說明 | 預覽頁 `v2/privacy/` | 本次新增草稿 | **待確認** |

## 六宮格點擊區域（`rich-menu.json`）

| 格 | 名稱 | 目前動作（預覽） | 正式目標 | 切換條件 |
|---|---|---|---|---|
| 1 | 關於 FDE-AI | 開啟 `…/v2/about` | 同左 | 已可用 |
| 2 | 發起人簡介 | 開啟 `…/v2/about`（佔位） | `…/v2/founder/` | 發起人內容確認並發布後 |
| 3 | 課程專區 | 開啟 `…/v2/`（官網首頁，佔位） | `…/v2/programs` | 課程專區預覽通過並批准後 |
| 4 | 學員成果 | 開啟 YouTube 頻道 | 同左（或指定播放清單） | 學員與素材授權確認後再上線 |
| 5 | 課程報名 | 在聊天室送出「我想報名／詢問 FDE-AI 課程」 | 報名表單頁 | 報名資料儲存方案批准後 |
| 6 | 考照與預約 | 在聊天室送出「我想詢問考照培訓、私教、考前訓練或場地使用」 | 同左（只做諮詢） | — |

第 5、6 格先用「傳送訊息」，由老師在官方帳號聊天室回覆：不需要還不存在的頁面，也不會在儲存方案批准前收集資料。
