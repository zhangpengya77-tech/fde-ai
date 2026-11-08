# onnxruntime-web 1.20.1（即時鏡頭檢測用）

- 來源：npm 套件 `onnxruntime-web@1.20.1`（MIT 授權，Copyright (c) Microsoft Corporation）
- npm integrity：`sha512-TePF6XVpLL1rWVMIl5Y9ACBQcyCNFThZON/jgElNd9Txb73CIEGlklhYR3UEr1cp5r0rbGI6nDwwrs79g7WjoA==`
- 只取 `dist/` 內的三個檔案：
  - `ort.webgpu.min.js`：瀏覽器端推論主程式，支援 WebGPU 與 WASM 兩種運算方式
  - `ort-wasm-simd-threaded.jsep.mjs`：WASM 載入器
  - `ort-wasm-simd-threaded.jsep.wasm`：WASM 執行檔
- 用途：`src/prop-live/prop-live-worker.js` 在 Web Worker 內載入，畫面不上傳伺服器。
- 升級方式：改用新版號另建資料夾，並同步修改 `src/prop-live/prop-live.js` 的 `ORT_BASE`。
