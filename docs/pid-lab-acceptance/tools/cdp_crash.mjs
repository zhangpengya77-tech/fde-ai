// 以 Chrome DevTools Protocol 驅動無頭 Edge，在真實執行中的頁面上操作並截圖。
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://127.0.0.1:8191';
const OUT = process.argv[2];
const SAMPLES = 'D:\\FDE-AI-Runtime\\pidlab-samples';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
mkdirSync(OUT, { recursive: true });
const profile = join(process.argv[3], 'edge-profile');
const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--window-size=1440,1000', '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, seq = 0;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch (e) { /* 等待瀏覽器啟動 */ }
    await sleep(300);
  }
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
  });
}
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}
async function waitFor(cond, timeout = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await js(`return !!(${cond})`)) return; await sleep(500); }
  throw new Error('timeout waiting for ' + cond);
}
async function go(url) { const u = new URL(url); u.searchParams.set('t', String(Date.now())); url = u.toString(); await send('Page.navigate', { url }); await sleep(1500); await waitFor(`document.readyState === 'complete'`); await sleep(800); }
async function shot(name, full = true) {
  await sleep(700);
  const m = await js(`return {w: document.documentElement.scrollWidth, h: Math.min(document.documentElement.scrollHeight, 6000)}`);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, clip: full ? { x: 0, y: 0, width: m.w, height: m.h, scale: 1 } : undefined });
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'));
  console.log('saved', name, m);
}
async function setViewport(w, h, mobile) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile }); }
async function setRole(role) {
  await js(`localStorage.setItem('pidlab.devRole', JSON.stringify('${role}')); return 1`);
}
async function fillAircraft(eco, fields) {
  await js(`location.hash = 'aircraft'; return 1`); await sleep(500);
  await js(`document.querySelector('#aircraft-new').click(); document.querySelector('[data-eco="${eco}"]').click(); return 1`);
  await js(`const f = document.querySelector('#aircraft-form'); const v = ${JSON.stringify(fields)}; for (const k in v) { f.elements[k].value = v[k]; } return 1`);
}
async function submitAircraft() {
  const before = await js(`return document.querySelectorAll('#aircraft-list .list-item').length`);
  await js(`document.querySelector('#aircraft-form button[type=submit]').click(); return 1`);
  await waitFor(`document.querySelectorAll('#aircraft-list .list-item').length > ${before}`);
}
async function uploadFile(aircraftName, path, phase) {
  await js(`location.hash = 'upload'; return 1`); await sleep(600);
  await js(`const s = document.querySelector('#upload-aircraft'); for (const o of s.options) if (o.text.startsWith(${JSON.stringify(aircraftName)})) s.value = o.value; s.dispatchEvent(new Event('change')); document.querySelector('#upload-phase').value = '${phase}'; document.querySelector('#cond-battery').value = 'B-01'; document.querySelector('#cond-wind').value = '無風'; return 1`);
  const doc = await send('DOM.getDocument', {});
  const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#log-file' });
  await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path] });
  await js(`document.querySelector('#log-submit').click(); return 1`);
  await waitFor(`/分析完成|FAILED|失敗/.test(document.querySelector('#upload-status').textContent)`, 240000);
  return js(`return document.querySelector('#upload-status').textContent`);
}

try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await setViewport(1440, 1000);
  await go(BASE + '/pid-lab/#learn');
  await setRole('student:demo-student:dev-cohort');
  await fillAircraft('ardupilot', { name: 'F450-498', hardware_series: 'Pixhawk', ground_station: 'Mission Planner', firmware_version: '4.5.7', frame: 'F450' });
  await submitAircraft();
  console.log(await uploadFile('F450-498', 'D:/FDE-AI-Runtime/pidlab-samples/ardupilot/f450_log498_20261101_crash.bin', 'BASELINE'));
  await go(BASE + '/pid-lab/#health'); await waitFor(`document.querySelectorAll('.health-card').length === 8`);
  await shot('20_F450墜機日誌健康報告.png');
  await go(BASE + '/pid-lab/#advice'); await waitFor(`document.querySelectorAll('.suggestion').length > 0`);
  await shot('21_F450墜機日誌停止調參.png');
} catch (e) {
  console.error('FLOW ERROR', e.message); process.exitCode = 1;
} finally { try { ws.close(); } catch (_) {} edge.kill(); }
