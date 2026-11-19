// 主網站課程專區入口功能開關測試：預設不顯示；?youth=1 預覽時才出現，且連到 /live/youth/
// 2026-11-20 入口已開啟（YOUTH_LAB_ENTRY = true）：預設與 ?youth=1 都應顯示入口
// 用法：node tests/youth/entry-flag.mjs（自帶 127.0.0.1:8273 靜態伺服器）
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BL_PLAYWRIGHT || 'D:/FDE-AI-UAS-v2.0-live-camera/node_modules/playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
const srv = http.createServer((q, r) => { let u = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (u === '/platform/programs') u = '/index.html'; else u = u.replace(/^\/platform\//, '/');   // 模擬正式站 /platform/ 前綴
  let f = path.normalize(path.join(root, u)); if (!f.startsWith(root)) return r.writeHead(403).end(); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); if (!fs.existsSync(f)) return r.writeHead(404).end(); r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise(o => srv.listen(8273, '127.0.0.1', o));
const b = await chromium.launch(); const p = await b.newPage();
let ok = true;
for (const [qs, want] of [['', 1], ['?youth=1', 1]]) {
  await p.goto(`http://127.0.0.1:8273/platform/programs${qs}`); await p.waitForTimeout(2500);
  const n = await p.locator('a[data-zone-link="youth"]').count();
  const zones = await p.locator('.pg-zone').count();
  const pass = n === want && zones >= 3;
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  網址 ${qs || '（預設）'}：青少年入口 ${n} 個（應為 ${want}）、專區卡片 ${zones} 張`);
  if (want) console.log(`      入口連結：${await p.getAttribute('a[data-zone-link="youth"]', 'href')}`);
}
await b.close(); srv.close(); process.exit(ok ? 0 : 1);
