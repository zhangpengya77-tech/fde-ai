# FDE-AI LINE 官方帳號：六宮格與歡迎訊息設置說明（V4.1 預覽）

## 1. 圖文選單規格（已對照 LINE 官方文件）

來源：LINE Developers「Messaging API reference」→ Upload rich menu image → Requirements for rich menu image，以及 Rich menu object（`https://developers.line.biz/en/reference/messaging-api/#upload-rich-menu-image-requirements`），2026-11-18 讀取。

| 官方規格 | 本圖 |
|---|---|
| 格式：JPEG 或 PNG | PNG |
| 寬度：800～2500 像素 | 2500 |
| 高度：250 像素以上 | 1686 |
| 寬高比（寬÷高）：1.45 以上 | 1.483 |
| 檔案大小：最大 1 MB | 約 0.46 MB |
| 點擊區域：最多 20 個 | 6 個 |
| 選單列文字（chatBarText）：最多 14 字 | 「FDE-AI 服務選單」11 字 |

檔案：
- `fde-ai-rich-menu-2500x1686.png`：上傳用圖片
- `rich-menu.html`：圖片原始檔（改文字後用瀏覽器以 2500×1686 截圖，再壓成 1 MB 以下）
- `rich-menu.json`：點擊區域與動作（Messaging API 格式）

設計：FDE-AI 官網既有品牌色（深藍 `#07111f`、青色 `#00c2ff`、綠色 `#35e6a8`），不使用黃色高亮；六個圖示全部自行繪製，**不使用任何第三方品牌圖片**，也沒有使用 AIDC 的名稱、圖示、配色或圖片，只參考三列兩行的結構。字型 Noto Sans CJK TC（SIL Open Font License）。

## 2. 在 LINE Official Account Manager 設定（不需要寫程式）

1. 登入 LINE Official Account Manager → 主頁 → **圖文選單** → 建立。
2. 版型選「大型」的 **6 格（3×2）**。
3. 上傳 `fde-ai-rich-menu-2500x1686.png`。
4. 依下表設定每一格的動作：

| 格 | 類型 | 內容 |
|---|---|---|
| A（左上）關於 FDE-AI | 連結 | `https://zhangpengya77-tech.github.io/fde-ai/v2/about` |
| B（中上）發起人簡介 | 連結 | 佔位：`https://zhangpengya77-tech.github.io/fde-ai/v2/about`（內容確認後改 `/v2/founder/`） |
| C（右上）課程專區 | 連結 | 佔位：`https://zhangpengya77-tech.github.io/fde-ai/v2/`（批准後改 `/v2/programs`） |
| D（左下）學員成果 | 連結 | `https://www.youtube.com/channel/UCqKMXztPAsc2K6crQlKxzLg` |
| E（中下）課程報名 | 文字 | 我想報名／詢問 FDE-AI 課程 |
| F（右下）考照與預約 | 文字 | 我想詢問考照培訓、私教、考前訓練或場地使用 |

5. 選單列文字填「FDE-AI 服務選單」，預設顯示選單。
6. 用 iPhone 與 Android 各一支手機加好友，逐格點擊確認。LINE 內的連結會在 LINE 內建瀏覽器開啟。

（若改用 Messaging API 設定，直接使用 `rich-menu.json`。）

## 3. 歡迎訊息（加入好友時發送）

在 LINE Official Account Manager → 主頁 → **加入好友的歡迎訊息** 貼上：

```text
歡迎加入「FDE-AI 無人載具實訓平台」！

我們提供無人機組裝、飛控、AI 應用與考照相關的實訓課程資訊。

▶ 一分鐘認識 FDE-AI（點連結觀看影片）
https://zhangpengya77-tech.github.io/fde-ai/v2/about

🌐 FDE-AI 官方網站
https://zhangpengya77-tech.github.io/fde-ai/v2/

📞 聯絡電話：0901-189-740

想了解課程，請點下方選單「課程報名」，或直接在這裡留言，老師會回覆你。
```

- 影片寫「點連結觀看」，**不宣稱**開啟 LINE 就會自動播放。
- 沒有「官方認證」、保證開課、保證考取等字句。
- 電話是否放在歡迎訊息裡，待你確認公開範圍後再決定；若改成只顯示官方帳號，刪掉電話那一行即可。
- 服務時間待提供，提供後可加在電話後面。
