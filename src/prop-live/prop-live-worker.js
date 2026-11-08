/**
 * 即時鏡頭檢測 Web Worker：在瀏覽器端用 onnxruntime-web 執行 ACTIVE 槳葉模型（YOLO，輸出 [1, 4+類別數, N]）。
 * 優先使用 WebGPU，不支援或失敗時改用 WASM。畫面只在這裡處理，不會上傳伺服器。
 *
 * 訊息：
 *   主執行緒 → worker
 *     { type: 'init', ortBase, modelBytes: ArrayBuffer, classNames, preferWebGPU }
 *     { type: 'frame', id, bitmap: ImageBitmap, imgsz, candidateConfidence }
 *   worker → 主執行緒
 *     { type: 'ready', backend }               模型載入完成（backend = 'webgpu' 或 'wasm'）
 *     { type: 'result', id, detections, inferMs, width, height }
 *     { type: 'error', code, message }
 *
 * 前後處理與後端 ultralytics 一致：等比縮放＋灰色(114)補邊、RGB/255、NMS IoU 0.7。
 */
/* global ort, importScripts */
let session = null;
let inputName = '';
let classNames = [];
let backend = '';
let testFailWebgpu = false; // 測試專用：模擬 iPhone 上 WebGPU 推論失敗
const NMS_IOU = 0.7;

function post(message, transfer) {
  self.postMessage(message, transfer || []);
}

async function init({ ortBase, modelBytes, classNames: names, preferWebGPU, testFailWebgpu: failFlag }) {
  testFailWebgpu = Boolean(failFlag);
  importScripts(`${ortBase}ort.webgpu.min.js`);
  ort.env.wasm.wasmPaths = ortBase;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  classNames = names;
  const order = preferWebGPU && 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm'];
  let lastError = null;
  for (const ep of order) {
    try {
      session = await ort.InferenceSession.create(new Uint8Array(modelBytes), { executionProviders: [ep], graphOptimizationLevel: 'all' });
      backend = ep;
      break;
    } catch (error) {
      lastError = error;
      session = null;
    }
  }
  if (!session) throw lastError || new Error('session_failed');
  inputName = session.inputNames[0];
  post({ type: 'ready', backend });
}

/**
 * 與後端 ultralytics 相同的 letterbox（rect 模式）：等比縮放到長邊 imgsz，
 * 只補到 32 的倍數（例如 1280×720 → 640×384），補邊顏色 114。
 * 回傳 CHW Float32、輸入尺寸與還原座標用的比例、位移。
 */
const STRIDE = 32;
function letterbox(bitmap, imgsz) {
  const w = bitmap.width;
  const h = bitmap.height;
  const r = Math.min(imgsz / w, imgsz / h);
  const nw = Math.round(w * r);
  const nh = Math.round(h * r);
  const dw = ((imgsz - nw) % STRIDE) / 2;
  const dh = ((imgsz - nh) % STRIDE) / 2;
  const left = Math.round(dw - 0.1);
  const top = Math.round(dh - 0.1);
  const inW = nw + left + Math.round(dw + 0.1);
  const inH = nh + top + Math.round(dh + 0.1);
  const canvas = new OffscreenCanvas(inW, inH);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, inW, inH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(bitmap, left, top, nw, nh);
  const { data } = ctx.getImageData(0, 0, inW, inH);
  const plane = inW * inH;
  const input = new Float32Array(3 * plane);
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    input[i] = data[p] / 255;
    input[plane + i] = data[p + 1] / 255;
    input[2 * plane + i] = data[p + 2] / 255;
  }
  return { input, inW, inH, r, padX: left, padY: top, w, h };
}

function iou(a, b) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

/** 解碼 YOLO 輸出：[1, 4+nc, N]（cx, cy, w, h, 各類分數）→ 原圖座標的框；逐類別 NMS。 */
function decode(output, meta, candidateConfidence) {
  const [, channels, count] = output.dims;
  const nc = channels - 4;
  const d = output.data;
  const boxes = [];
  for (let i = 0; i < count; i++) {
    let best = 0;
    let cls = -1;
    for (let c = 0; c < nc; c++) {
      const score = d[(4 + c) * count + i];
      if (score > best) { best = score; cls = c; }
    }
    if (best < candidateConfidence) continue;
    const cx = d[i];
    const cy = d[count + i];
    const bw = d[2 * count + i];
    const bh = d[3 * count + i];
    const x1 = Math.max(0, Math.min(meta.w, (cx - bw / 2 - meta.padX) / meta.r));
    const y1 = Math.max(0, Math.min(meta.h, (cy - bh / 2 - meta.padY) / meta.r));
    const x2 = Math.max(0, Math.min(meta.w, (cx + bw / 2 - meta.padX) / meta.r));
    const y2 = Math.max(0, Math.min(meta.h, (cy + bh / 2 - meta.padY) / meta.r));
    boxes.push({ cls, confidence: best, bbox: [x1, y1, x2, y2] });
  }
  boxes.sort((a, b) => b.confidence - a.confidence);
  const kept = [];
  for (const box of boxes) {
    if (kept.every((k) => k.cls !== box.cls || iou(k.bbox, box.bbox) <= NMS_IOU)) kept.push(box);
    if (kept.length >= 300) break;
  }
  return kept.map((k) => ({ class: classNames[k.cls] ?? `class_${k.cls}`, confidence: k.confidence, bbox: k.bbox }));
}

async function frame({ id, bitmap, imgsz, candidateConfidence }) {
  const started = performance.now();
  if (testFailWebgpu && backend === 'webgpu') {
    bitmap.close();
    throw new Error('test_webgpu_failure');
  }
  const meta = letterbox(bitmap, imgsz);
  bitmap.close();
  const tensor = new ort.Tensor('float32', meta.input, [1, 3, meta.inH, meta.inW]);
  const outputs = await session.run({ [inputName]: tensor });
  const output = outputs[session.outputNames[0]];
  const detections = decode(output, meta, candidateConfidence);
  post({ type: 'result', id, detections, inferMs: performance.now() - started, width: meta.w, height: meta.h });
}

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    if (message.type === 'init') await init(message);
    else if (message.type === 'frame') {
      if (!session) {
        message.bitmap?.close?.();
        throw new Error('session_not_ready');
      }
      await frame(message);
    }
  } catch (error) {
    post({ type: 'error', code: message.type === 'init' ? 'model_load_failed' : 'inference_failed', message: String(error && error.message || error) });
  }
};
