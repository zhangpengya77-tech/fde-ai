// 組裝實訓室｜瀏覽器測試一鍵執行
// 用法（在專案根目錄）：node tests/build-lab/e2e/run-e2e.mjs [截圖輸出資料夾]
// 會自己啟動一個只讀的本機靜態伺服器（預設 127.0.0.1:8095，可用 BL_PORT 改；避開正式站使用的埠），
// 依序執行各測試腳本，結束時關閉伺服器。不連任何正式服務。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');            // worktree 根目錄（含 f450-twin/）
const port = Number(process.env.BL_PORT || 8095);
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'build-lab-e2e'));
fs.mkdirSync(out, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.normalize(path.join(repoRoot, decodeURIComponent(url.pathname)));
  if (!file.startsWith(repoRoot)) { res.writeHead(403).end(); return; }   // 不允許跳出專案資料夾
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (req.method !== 'GET' || !fs.existsSync(file)) { res.writeHead(req.method === 'GET' ? 404 : 501).end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(port, '127.0.0.1', ok));

const scripts = ['p1-assembly.cjs', 'p2-f450-wiring.mjs', 'p3-fpv5-wiring.mjs', 'p4-exam-records.mjs', 'p5-mobile.mjs', 'p6-fps.mjs'];
const env = { ...process.env, BL_BASE: `http://127.0.0.1:${port}` };
let failed = 0;
for (const s of scripts) {
  const t0 = Date.now();
  // 用非同步 spawn：同步執行會卡住本程式，靜態伺服器就無法回應瀏覽器
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, s), out], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill(), 300000);
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  // 各腳本輸出 JSON；只要有 pageerror／主控台錯誤或結束碼非 0 就算失敗
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  const hasLogs = /"logs": \[\s*"/.test(text);
  const ok = r.status === 0 && !hasLogs;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}  (${((Date.now() - t0) / 1000).toFixed(1)} 秒)`);
  if (!ok) console.log(text.slice(-1500));
}
server.close();
console.log(`\n截圖：${out}\n結果：${scripts.length - failed}／${scripts.length} 通過`);
process.exit(failed ? 1 : 0);
