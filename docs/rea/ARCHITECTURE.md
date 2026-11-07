# REA 考照模擬器架構

## 位置
- 原始碼：`FDE-Power-Inspection-Simulator`（工作樹 `D:\FDE-REA-Exam-Sim`，分支 `feat/rea-exam-simulator`，基於 `feature/pen-phone-input` 08b3f54）。
- 正式部署：建置產物複製到 FDE-AI 倉庫 `public-site/v2/sim/app/`，由 GitHub Actions 從分支 `codex/github-pages-public` 發布到 https://zhangpengya77-tech.github.io/fde-ai/v2/sim/app/?mode=exam&exam=0

## 模組
```
src/rea/
  courses.ts     考場幾何（I、I2）＋科目步驟（唯一真相來源）
  physics.ts     飛行物理：定位／姿態模式、慣性、阻力、升降、偏航、觸地與墜機；三種機型參數
  wind.ts        風向、風力、陣風、擺動（可重現的平滑雜訊）、安全宣告門檻
  runner.ts      科目進度追蹤＋逐段練習評等（頂尖／標準／擦邊／失敗）＋重大違失
  autopilot.ts   示範飛行：讀同一份步驟，輸出與真人同格式的搖桿指令
  session.ts     固定步長 120 Hz 物理迴圈＋20 Hz 錄製＋回放內插
  scene.ts       Three.js 考場（程式繪製）、機體（四軸／六軸、紅臂＝機頭）、軌跡、考生／飛機／俯視視角、陽光、風向袋
  track-view.ts  俯視軌跡圖（照時間／偏離航線／機頭偏差上色）
  app.ts         介面流程：選科目 → 選機型 → 設定 → 開始飛 → 評等／回放
```

## 資料流
```
USB 遙控器 ─┐
手機遙控器 ─┤
手勢       ─┼─► ExamInput（既有）→ PilotInputPipeline → 標準化指令
原子筆     ─┤        （標定檔、斷線 0.25 s 懸停：全部沿用既有實作）
鍵盤       ─┘
                     │
                     ▼ Mode 1 換軸（只對實體遙控器）
             FlightSession（120 Hz）
               physics.step ← wind.at(t)
               runner.update → 提示／逐段評等
               錄製 samples（20 Hz）
                     │
                     ▼
        ExamScene 3D 畫面 ＋ 評等表 ＋ 俯視軌跡 ＋ 回放（×1/×1.5/×3/×6）
```

## 入口路由（`src/main.ts`）
| URL | 內容 |
|---|---|
| `?mode=exam` | **新版 REA 考照模擬器（正式入口）** |
| `?mode=exam-legacy` | 舊版 F450 考照模擬器（歷史版本保留） |
| `?mode=penta` | 既有五邊教學預覽（未變動） |
| 其他 | 既有電力巡檢場景（未變動） |

## 設計決策
1. **步驟即規格**：示範、提示、評分讀同一份 `Step[]`，避免「示範飛的跟評分標準不一致」。
2. **輸入不重寫**：五種連線方式、標定檔、斷線保護全部沿用既有 `ExamInput`，只在引擎前加 Mode 1 換軸。手機與原子筆固定美國手，不換軸。
3. **物理自行實作且可測**：純函式 `step()`，單元測試涵蓋定位停住、姿態被風吹走、爬升、墜機、機型慣性、機頭朝內左右相反。
4. **免後端**：全部在瀏覽器計算，可放 GitHub Pages。手機遙控器沿用既有 simlink（需教學主機），未新增常駐後端。
5. **不宣稱官方**：所有評等標示為練習評等。
