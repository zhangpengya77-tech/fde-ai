# 即時鏡頭檢測：測試說明

## 一、測試種類

| 指令 | 內容 | 需要什麼 |
|---|---|---|
| `npm run test:node` | 既有前端測試，加上判定、穩定化、問答、圖片流程、串接檢查（`node --test`） | 只要 Node |
| `npm run test:unit` | vitest：隨機輸入不變式（判定 2,000 組、穩定化 500 段、問答）與 Worker 解碼 | `npm install` |
| `npm run test:e2e` | Playwright：Chrome 假鏡頭播放固定影片，驗證綠／紅／灰框、答案文字、問答、模型閘門，並記錄 FPS | `npm install`、系統已安裝 Chrome、下面兩個環境變數 |
| 後端 | `cd live_backend`，接著執行 `PYTHONPATH=".;tests" python -m unittest test_prop_live_model` | 正式站同版本的 Python |

## 二、端對端測試的環境變數

模型和測試畫面屬於教學資料，不放進 repo，執行前要先指定路徑。

```powershell
$env:PROP_LIVE_ONNX = "<ACTIVE 模型轉出的 best.onnx>"
$env:PROP_LIVE_FRAMES = "<測試畫面資料夾>"
npm run test:e2e
```

- `PROP_LIVE_FRAMES` 資料夾內需要三張 1280×720 的畫面：
  - `frame_IMG_8415.jpg`：四支正確
  - `frame_IMG_8258.jpg`：四支全反
  - `frame_IMG_8173.jpg`：信心不足
- 這三張來自 `D:\AI\F450_CW_CCW_V6_training\dataset_final\images\test`，以等比縮放加補邊做成 1280×720。
- 測試開始時，`global-setup.mjs` 會把畫面組成 Chrome 假鏡頭用的 `.mjpeg`，放在 `test-results/live-camera/fixtures/`。
- 測試只連本機的 `mock-server.mjs`（埠號 8030），不會連到正式後端，也不會連到正式知識庫。
- 實測 FPS 會寫入 `test-results/live-camera/fps.jsonl`。

## 三、注意

- 8030 埠被占用時，請先關掉占用的程序再執行。
- 無頭 Chrome 量到的 FPS 只能代表這台電腦的內顯，不代表手機；手機請依 `docs/live-camera/HTTPS_LOCAL_TEST.md` 實機測試。
