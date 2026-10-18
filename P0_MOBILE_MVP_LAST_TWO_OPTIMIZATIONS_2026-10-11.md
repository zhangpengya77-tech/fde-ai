# FDE-AI-UAS 2.0｜手機 MVP 最後兩項優化 — 完成報告

日期：2026-10-11
專案：D:\FDE-AI-UAS-v2.0（分支 fde-ai-v2.0-dev）
測試網址：http://192.168.1.114:8111/eagle

---

## 一、M1～M4 手機排版修復

### 根因
`src/styles.css` 的 `.motor-check-grid` 為桌面雙欄：
```css
grid-template-columns: repeat(2, minmax(260px, 1fr));
```
在 iPhone 390px 寬度下，兩欄最小需求 520px → **水平溢出，M2/M4 被推到畫面外**。
而 `@media (max-width: 768px)` 與 `(max-width: 680px)` **都沒有覆寫此規則**
（實測 grep 無任何 `.motor-check` 命中）。

### 修復
在 `@media (max-width: 680px)` 內新增手機版規則：
- `.motor-check-grid` → `grid-template-columns: minmax(0, 1fr)`（單欄垂直）
- `.motor-check` → `min-height: 0`、縮小 padding（避免單欄卡片過高）
- `.motor-check-head strong` → 字級 26px → 22px
- `.inspection-summary-panel` → `overflow-x: visible`（原本 `auto` 會產生橫向捲動）
- `.inspection-final-result` / `.inspection-assistant` / `.demo-simulation-badge`
  → `width/max-width: 100%`、`overflow-wrap: anywhere`（自適應手機寬度）

**桌面版未受影響**（規則只在 ≤680px 斷點內）。

---

## 二、AI 語音回答

沿用既有「F450 AI 助教」文字回答，在回答區新增兩個按鈕，使用**瀏覽器原生
SpeechSynthesis API**（無付費 TTS、無新後端服務）：

| 檔案 | 變更 |
|---|---|
| `src/app.js` | `renderInspectionSpeechControls()` 渲染「🔊 播放語音」/「■ 停止播放」；<br>`speakInspectionAnswer()` 朗讀目前回答（`lang=zh-TW`、`rate=0.95`，呼叫前先 `cancel()` 避免疊音）；<br>`stopInspectionAnswer()` 停止播放；<br>事件委託監聽 `[data-speak-inspection]` / `[data-stop-inspection]`；<br>檢測按鈕開頭呼叫 `stopInspectionAnswer()`（新一次檢測停止上一段語音） |
| `src/styles.css` | `.inspection-speech` 按鈕排版；`.speech-unsupported` 不支援提示樣式 |

**需求對應**：
1. ✅ 點擊「播放語音」朗讀目前 AI 回答
2. ✅ 優先 zh-TW（`voiceAssistant.locale = 'zh-TW'`）
3. ✅ iPhone Safari 相容（由使用者點擊同步觸發 `speak()`，保留手勢授權）
4. ✅ 必須由使用者點擊觸發
5. ✅ 可停止播放
6. ✅ 新一次檢測停止上一段語音
7. ✅ 不支援時顯示「此瀏覽器不支援語音朗讀，文字回答仍可正常閱讀。」
8. ✅ 無新增付費 TTS／後端服務

---

## 三、DEMO 模擬結果保留

- 「DEMO 模擬結果」標籤保留並置頂顯示。
- **未**把模擬 CHECK 改成假 PASS：M1–M3 仍為 `CHECK`（`INSUFFICIENT_DATA`），
  M4 為 `PASS`（DEMO 模擬單一偵測框，class `CW_F` / conf `0.76`）。
- 未載入任何真實 `best.pt`。

---

## 四、驗收結果（Chrome CDP，iPhone 尺寸 390×844 + 桌面 1440×900）

| 驗收項 | 實測數據 | 結果 |
|---|---|---|
| **A. M1～M4 完整顯示** | `columns: 287.333px`（單欄）；4 張卡片 `left` 全為 51、`top` 遞增 2311→2555→2798→3042；`sameLeft=true`、`stacked=true`；四張卡片皆含 DETECTED/EXPECTED/BLADE FACE/CONFIDENCE | **PASS** |
| **B. 無水平溢出** | `documentElement.scrollWidth 390 == innerWidth 390`；`horizOverflow=false`；越界元素 `[]` | **PASS** |
| **C. AI 文字回答** | 正常回傳繁體中文修正建議 | **PASS** |
| **D. 播放語音** | 點擊後實測攔截到 `speak({lang:"zh-TW", rate:0.95, text:"檢測結果：M1…"})` | **PASS** |
| **E. 停止播放** | `cancel` 計數 1→2、`speaking=false`、`pending=false` | **PASS** |
| **F. DEMO 流程不受影響** | `prop-check` 200 / `rag/ask` 200；`demo_label=true`；`console_errors=[]` | **PASS** |
| 附加：新檢測停止語音 | 再點檢測後 `cancel` 計數 → 3 | **PASS** |
| 附加：桌面版保持原樣 | 1440px 下 `columns: "466px 466px"`（雙欄） | **PASS** |

**前端測試回歸**：`platform-integration` / `rag-client` / `mobile-p0-entry` /
`homepage-portal-entry` **全數通過**。

驗收性質：**AUTOMATED PASS**
**iPhone 真機：PENDING**（等待教師手機確認）

截圖：
- `eagle_mobile_single_col.png`（手機 M1–M4 單欄）
- `eagle_mobile_speech.png`（手機語音按鈕）
- `eagle_desktop_layout.png`（桌面雙欄未變）

---

## 五、修改檔案清單

| 檔案 | 變更 |
|---|---|
| `src/styles.css` | 680px 斷點新增手機單欄排版；新增 `.inspection-speech` 等樣式 |
| `src/app.js` | 語音控制項渲染與朗讀／停止邏輯；事件委託；新檢測停止語音 |
| `index.html` / `404.html` | 版本號 → `1.2.3-mobile-speech` / `1.0.3-mobile-speech`（強制 Safari 刷新快取） |
| `src/platform-integration.test.cjs` | 版本號斷言同步 |

**未修改**：正式環境、`:8022` / `:8765` / `:8770`、v1.5C、Cloudflare、
R07、模型倉庫、教師後台、DEMO 帳密。未 commit / push / merge / deploy。

---

## 六、手機驗收網址

**http://192.168.1.114:8111/eagle**

> 教師首次開啟若見舊畫面請下拉重新整理（Safari 快取）；
> 版本號已更新為 `1.2.3-mobile-speech` 強制刷新。
