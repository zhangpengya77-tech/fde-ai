// v1.3 全部 12 課新版單課頁測試：電腦版依序走完 U01–U12（自然解鎖），iPhone 13 走 v1.3 新改的 7 課
// 除錯：環境變數 ONLY=3 只跑單一課
// 用法（專案根目錄）：node tests/youth/lesson-all.mjs [截圖資料夾]　自帶只讀靜態伺服器 127.0.0.1:8276
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.BL_PLAYWRIGHT || 'D:/FDE-AI-UAS-v2.0-live-camera/node_modules/playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(process.argv[2] || 'D:/FDE-AI-Youth-Reference/v13');
fs.mkdirSync(OUT, { recursive: true });
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const srv = http.createServer((q, r) => { let f = path.normalize(path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname))); if (!f.startsWith(root)) return r.writeHead(403).end(); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); if (!fs.existsSync(f)) return r.writeHead(404).end(); r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise(o => srv.listen(8276, '127.0.0.1', o));
const BASE = 'http://127.0.0.1:8276/live/youth/';
const specs = {};
const nn = id => String(id).padStart(2, '0');
for (let id = 1; id <= 12; id++) specs[id] = (await import(new URL(`../../live/youth/data/lessons/u${nn(id)}.js`, import.meta.url).href)).default;
const results = []; const errs = [];
const check = (n, ok, d = '') => { results.push({ n, ok: !!ok, d }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '　' + d : ''}`); };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const watch = (p, n) => { p.on('pageerror', e => errs.push(`${n} pageerror: ${e.message}`)); p.on('console', m => { if (m.type() === 'error') errs.push(`${n}: ${m.text()}`); }); };

// 走完一課四步；shots 時每步截圖
async function walk(p, id, name, shots) {
  const S = specs[id];
  await p.goto(`${BASE}#/unit/${id}`); await p.waitForSelector('.ls-card');
  check(`${name} U${nn(id)}：從 01 開始、下一步鎖住`, p.url().endsWith(`#/unit/${id}/task`) && await p.locator('#ls-next').isDisabled());
  check(`${name} U${nn(id)}：知識卡 ≥4、題庫 8 題、每題有解析`, S.steps.task.cards.length >= 4 && S.steps.criteria.quiz.length === 8 && S.steps.criteria.quiz.every(q => q.explain));
  if (shots) await p.screenshot({ path: path.join(OUT, `${name}_u${nn(id)}_1task.png`) });
  for (let k = 0; k < 10 && !(await p.locator('#ls-cnext').isDisabled()); k++) await p.click('#ls-cnext');
  await p.click('#ls-next'); await p.waitForSelector('#ls-3d canvas', { timeout: 20000 });
  let ok = 0;
  for (const [k, ph] of S.steps.demo.phases.entries()) { await p.click(`#ls-phases button[data-k="${k}"]`); await p.waitForTimeout(250); if ((await p.textContent('#ls-an')) === ph.action.name && (await p.textContent('#ls-hud')).trim() !== '—') ok++; }
  check(`${name} U${nn(id)}：演示 5 階段動作卡與 HUD 更新`, ok === 5, `${ok}/5，HUD「${await p.textContent('#ls-hud')}」`);
  await p.click('#ls-phases button[data-k="2"]'); await p.waitForTimeout(500); await p.evaluate(() => scrollTo(0, 0));
  if (shots) await p.screenshot({ path: path.join(OUT, `${name}_u${nn(id)}_2demo.png`) });
  for (let k = 0; k < 3; k++) await p.click('#ls-sp');
  await p.fill('#ls-sc', String(S.steps.demo.durationSec - 3)); await p.dispatchEvent('#ls-sc', 'input'); await p.click('#ls-pp');
  await p.waitForFunction(() => !document.querySelector('#ls-next').disabled, null, { timeout: 15000 }).catch(() => {});
  await p.click('#ls-next'); await p.waitForSelector('#ls-qz');
  const legends = await p.locator('#ls-qz legend').allTextContents();
  for (const [n, lg] of legends.entries()) { const q = S.steps.criteria.quiz.find(x => lg.endsWith(x.q)); await p.check(`input[name=q${n}][value="${q.answer}"]`); }
  await p.click('#ls-qz button'); await p.waitForSelector('.ls-score');
  check(`${name} U${nn(id)}：測驗 5 題全對`, (await p.textContent('.ls-score b')).includes('100'));
  if (shots) { await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: path.join(OUT, `${name}_u${nn(id)}_3criteria.png`) }); }
  await p.click('#ls-next'); await p.waitForSelector('.ls-prac');
  check(`${name} U${nn(id)}：訓練技巧有開始實作連結`, !!(await p.getAttribute('.ls-prac a', 'href')));
  if (shots) await p.screenshot({ path: path.join(OUT, `${name}_u${nn(id)}_4tips.png`) });
  await p.click('#ls-next'); await p.waitForSelector('.ls-sum-done');
  check(`${name} U${nn(id)}：完成頁下一課正確`, S.next ? (await p.getAttribute('.ls-nextunit', 'href')) === `#/unit/${S.next}` : (await p.locator('.ls-nextunit').count()) === 0);
  check(`${name} U${nn(id)}：手機無水平捲動`, !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
}

try {
  // ---- 電腦版：全新學員依序走完 12 課 ----
  const g = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const gp = await g.newPage(); watch(gp, 'desktop');
  for (let id = 1; id <= 12; id++) {
    await gp.goto(BASE + '#/courses'); await gp.waitForSelector('.ucard');
    check(`desktop：U${nn(id)} 在課程中心已解鎖`, await gp.locator(`a.ucard[href="#/unit/${id}"]`).count() === 1);
    await walk(gp, id, 'desktop', true);
  }
  await gp.goto(BASE + '#/courses'); await gp.waitForSelector('.ucard');
  check('desktop：12 課全部完成後都可點', await gp.locator('a.ucard').count() === 12);
  await g.close();
  // ---- iPhone 13 直式：v1.3 新改的 7 課（前一課以種子資料標成完成）----
  const m = await browser.newContext({ ...devices['iPhone 13'] });
  await m.addInitScript(() => { if (!localStorage.getItem('fde-youth-v1')) { const g = {}; for (let i = 1; i <= 12; i++) g[i] = { done: true }; localStorage.setItem('fde-youth-v1', JSON.stringify({ current: null, learners: {}, order: 2, guestLessons: g })); } });
  const mp = await m.newPage(); watch(mp, 'iphone');
  await mp.goto(BASE + '#/courses'); await mp.waitForSelector('.ucard');
  for (const id of [3, 6, 7, 8, 10, 11, 12]) {
    await mp.evaluate(i => { const d = JSON.parse(localStorage.getItem('fde-youth-v1')); d.guestLessons[i] = { step: 'task', reached: 0, cards: [], demoDone: false, demoT: 0, quiz: { best: null, attempts: 0, last: null }, practiceDone: false, done: false }; localStorage.setItem('fde-youth-v1', JSON.stringify(d)); }, id).catch(() => {});
    await walk(mp, id, 'iphone13', true);
  }
  await m.close();
} catch (e) { check('執行中斷', false, e.message); }
const real = errs.filter(e => !/favicon|Failed to load resource/.test(e));
check('瀏覽器無 JavaScript 錯誤', real.length === 0, real.slice(0, 3).join(' | '));
await browser.close(); srv.close();
const pass = results.filter(r => r.ok).length;
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ when: new Date().toISOString(), pass, total: results.length, results, errs: real }, null, 2));
console.log(`\n結果：${pass}／${results.length} 通過　截圖：${OUT}`);
process.exit(pass === results.length ? 0 : 1);
