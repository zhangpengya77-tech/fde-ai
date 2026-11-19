# 青少年實驗室：介面與程式架構

## 位置與路由
- 程式：`live/youth/`（沿用 Live 服務既有的 `/live` 靜態掛載，**不需改後端、不需重啟服務**）。
- 正式網址（部署後）：`/live/youth/`。規格建議的 `/youth/` 需要新增掛載或 Worker 轉址，屬部署變更，待授權（見 DEPLOYMENT_AND_ROLLBACK.md）。
- 頁內路由（雜湊）：`#/` 首頁｜`#/courses[/A|B|C]` 課程中心｜`#/unit/:id/(read|widget|lab|quiz|record)` 單元｜`#/labs`、`#/lab/:id` 實驗｜`#/soccer/:mode` 足球｜`#/me` 我的學習｜`#/teacher[/:班級]` 教師｜`#/ai` 助教｜`#/rc` 遙控器設定。

## 檔案
| 檔案 | 內容 |
|---|---|
| `index.html` | 頁首導覽、importmap（沿用 `/f450-twin/vendor/three` r181） |
| `app.js` | 路由、各頁面、登入、遙控器設定、教師頁 |
| `youth.css` | 科技藍＋白卡片；1100px／720px 兩段響應式 |
| `data/units.js` | 12 單元教材、測驗、6 個實驗清單 |
| `widgets.js` | 12 種單元互動元件 |
| `core/physics.js` | 純計算：電池、換相、足球機運動、穿門、PD 自穩 |
| `core/store.js` | 學習紀錄（本機）、報告匯出、教師匯入 |
| `core/assistant.js` | 規則式助教知識庫 |
| `core/input.js` | Gamepad API／鍵盤／虛擬搖桿 |
| `labs/*.js` | 六個實驗（three-kit.js 為共用 3D 工具與程式生成模型） |
| `soccer/soccer.js` | 足球 3D 訓練場 |

## 版面（對應參考影片）
- 單元頁三欄：左「本課學習路徑 01–05」、中內容（右上頁碼 0x/05）、右 AI 助教。
- 實驗頁：頂部條（標題＋重新開始／全螢幕／返回課程），下方三欄：左控制、中 3D、右說明與任務。
- 足球：上方模式分頁＋遙控器設定｜左球機名單 3 對 3、課堂預設、保存／讀取｜中 3D（視角鈕、比分計時、虛擬搖桿）｜右高度、速度、朝向、來源、任務｜底部演示路線與倍速。

## 設計原則
- 3D 模型全部程式生成，無外部模型、圖片、字型。
- 每個 3D 頁離開時釋放 WebGL 資源（`dispose`）。
- 物理以 1/60 秒細分計算，低幀率裝置判定一致。
