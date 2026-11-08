// Playwright 用的本機測試伺服器（只在測試時啟動，不連正式後端）：
//   - 同源提供專案靜態檔（index.html、src/…）
//   - 模擬 /api/v1/vision/prop-live/model 與 model.onnx（回傳 PROP_LIVE_ONNX 指定的 ONNX）
//   - 模擬 /api/rag/ask（記錄呼叫次數），/__ragcount 查詢、/__mode?m=ok|none|fb|badsha 切換模型情境
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PORT = Number(process.env.PROP_LIVE_PORT || 8030);
const ONNX = process.env.PROP_LIVE_ONNX;
if (!ONNX || !existsSync(ONNX)) {
  console.error('請設定 PROP_LIVE_ONNX 指向 best.onnx');
  process.exit(1);
}
const MODEL = readFileSync(ONNX);
const SHA = createHash('sha256').update(MODEL).digest('hex');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
let mode = 'ok';
const ragQuestions = [];

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  if (path === '/__mode') { mode = url.searchParams.get('m') || 'ok'; return json(res, 200, { mode }); }
  if (path === '/__ragcount') return json(res, 200, { count: ragQuestions.length, questions: ragQuestions });
  if (path === '/api/rag/ask' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      ragQuestions.push(JSON.parse(body || '{}').question || '');
      json(res, 200, { answer: '（模擬知識庫）對角線兩支槳同旋向，才能互相抵消反扭力；更換前先斷電拔電池。', source_type: 'rag' });
    });
    return undefined;
  }
  if (path === '/api/v1/vision/prop-live/model.onnx') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    return res.end(MODEL);
  }
  if (path === '/api/v1/vision/prop-live/model') {
    if (mode === 'none') return json(res, 404, { error: { code: 'no_active_model', message: 'x' } });
    return json(res, 200, {
      model_id: 'PROP_V7_TEST', model_version: 'v7', onnx_bytes: MODEL.length, dynamic_input: true, default_imgsz: 640,
      class_names: mode === 'fb' ? ['CW_F', 'CW_B', 'CCW_F', 'CCW_B'] : ['CW', 'CCW'],
      onnx_sha256: mode === 'badsha' ? '0'.repeat(64) : SHA,
      onnx_url: '/api/v1/vision/prop-live/model.onnx',
    });
  }
  // 靜態檔（防止跳出專案目錄）
  const file = normalize(join(ROOT, decodeURIComponent(path === '/' ? '/index.html' : path)));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream' });
  return res.end(readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`mock server ready on ${PORT}`));
