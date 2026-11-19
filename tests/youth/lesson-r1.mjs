// R1 四課（U01、U02、U04、U05）新版單課頁測試＋依序解鎖與飛行安全前置條件
// 用法（專案根目錄）：node tests/youth/lesson-r1.mjs [截圖資料夾]　自帶只讀靜態伺服器 127.0.0.1:8275
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.BL_PLAYWRIGHT || 'D:/FDE-AI-UAS-v2.0-live-camera/node_modules/playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(process.argv[2] || 'D:/FDE-AI-Youth-Reference/r1');
fs.mkdirSync(OUT, { recursive: true });
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const srv = http.createServer((q, r) => { let f = path.normalize(path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname))); if (!f.startsWith(root)) return r.writeHead(403).end(); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); if (!fs.existsSync(f)) return r.writeHead(404).end(); r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise(o => srv.listen(8275, '127.0.0.1', o));
const BASE = 'http://127.0.0.1:8275/live/youth/';
const specs = {};
for (const id of [1, 2, 4, 5]) specs[id] = (await import(new URL(`../../live/youth/data/lessons/u0${id}.js`, import.meta.url).href)).default;
const results = []; const errs = [];
const check = (n, ok, d = '') => { results.push({ n, ok: !!ok, d }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '　' + d : ''}`); };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const watch = (p, n) => { p.on('pageerror', e => errs.push(`${n} pageerror: ${e.message}`)); p.on('console', m => { if (m.type() === 'error') errs.push(`${n}: ${m.text()}`); }); };

// 走完一課四步；shots 時每步截圖
async function walk(p, id, name, shots) {
  const S = specs[id];
  await p.goto(`${BASE}#/unit/${id}`); await p.waitForSelector('.ls-card');
  check(`${name} U0${id}：從 01 開始、下一步鎖住`, p.url().endsWith(`#/unit/${id}/task`) && await p.locator('#ls-next').isDisabled());
  check(`${name} U0${id}：知識卡 ≥4、題庫 8 題、每題有解析`, S.steps.task.cards.length >= 4 && S.steps.criteria.quiz.length === 8 && S.steps.criteria.quiz.every(q => q.explain));
  if (shots) await p.screenshot({ path: path.join(OUT, `${name}_u0${id}_1task.png`) });
  for (let k = 0; k < 10 && !(await p.locator('#ls-cnext').isDisabled()); k++) await p.click('#ls-cnext');
  await p.click('#ls-next'); await p.waitForSelector('#ls-3d canvas', { timeout: 20000 });
  let ok = 0;
  for (const [k, ph] of S.steps.demo.phases.entries()) { await p.click(`#ls-phases button[data-k="${k}"]`); await p.waitForTimeout(250); if ((await p.textContent('#ls-an')) === ph.action.name && (await p.textContent('#ls-hud')).trim() !== '—') ok++; }
  check(`${name} U0${id}：演示 5 階段動作卡與 HUD 更新`, ok === 5, `${ok}/5，HUD「${await p.textContent('#ls-hud')}」`);
  await p.click('#ls-phases button[data-k="2"]'); await p.waitForTimeout(500); await p.evaluate(() => scrollTo(0, 0));
  if (shots) await p.screenshot({ path: path.join(OUT, `${name}_u0${id}_2demo.png`) });
  for (let k = 0; k < 3; k++) await p.click('#ls-sp');
  await p.fill('#ls-sc', String(S.steps.demo.durationSec - 3)); await p.dispatchEvent('#ls-sc', 'input'); await p.click('#ls-pp');
  await p.waitForFunction(() => !document.querySelector('#ls-next').disabled, null, { timeout: 15000 }).catch(() => {});
  await p.click('#ls-next'); await p.waitForSelector('#ls-qz');
  const legends = await p.locator('#ls-qz legend').allTextContents();
  for (const [n, lg] of legends.entries()) { const q = S.steps.criteria.quiz.find(x => lg.endsWith(x.q)); await p.check(`input[name=q${n}][value="${q.answer}"]`); }
  await p.click('#ls-qz button'); await p.waitForSelector('.ls-score');
  check(`${name} U0${id}：測驗 5 題全對`, (await p.textContent('.ls-score b')).includes('100'));
  if (shots) { await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: path.join(OUT, `${name}_u0${id}_3criteria.png`) }); }
  await p.click('#ls-next'); await p.waitForSelector('.ls-prac');
  check(`${name} U0${id}：訓練技巧有開始實作連結`, !!(await p.getAttribute('.ls-prac a', 'href')));
  if (shots) await p.screenshot({ path: path.join(OUT, `${name}_u0${id}_4tips.png`) });
  await p.click('#ls-next'); await p.waitForSelector('.ls-nextunit');
  check(`${name} U0${id}：完成頁下一課為 U0${S.next}`, (await p.getAttribute('.ls-nextunit', 'href')) === `#/unit/${S.next}`);
  check(`${name} U0${id}：手機無水平捲動`, !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
}

try {
  // ---- 依序解鎖與安全前置（全新學員）----
  const g = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const gp = await g.newPage(); watch(gp, 'gate');
  await gp.goto(BASE + '#/courses'); await gp.waitForSelector('.ucard');
  check('全新學員：課程中心只有 U01 可點，其餘 11 課鎖住', await gp.locator('a.ucard').count() === 1 && await gp.locator('.ucard.locked').count() === 11);
  await gp.goto(BASE + '#/unit/4'); await gp.waitForSelector('.gate');
  check('全新學員：直接開 U04 顯示「尚未解鎖」', (await gp.textContent('.gate')).includes('尚未解鎖'));
  await gp.goto(BASE + '#/soccer'); await gp.waitForSelector('.gate');
  check('全新學員：足球訓練需先完成 U02', (await gp.textContent('.gate')).includes('飛行安全'));
  await gp.goto(BASE + '#/lab/battery'); await gp.waitForSelector('.gate');
  check('全新學員：操作實驗需先完成 U02', (await gp.textContent('.gate')).includes('飛行安全'));
  await gp.screenshot({ path: path.join(OUT, 'gate_lab.png') });
  // 依序走 U01 → U02，之後足球與實驗應解鎖；U03（舊版面）以種子資料標成完成後走 U04、U05
  await walk(gp, 1, 'desktop', true);
  await walk(gp, 2, 'desktop', true);
  await gp.goto(BASE + '#/soccer'); await gp.waitForSelector('#sc-stage canvas', { timeout: 20000 });
  check('完成 U02 後足球訓練場解鎖', true);
  await gp.evaluate(() => { const d = JSON.parse(localStorage.getItem('fde-youth-v1')); d.guestLessons[3] = { done: true }; localStorage.setItem('fde-youth-v1', JSON.stringify(d)); });
  await gp.goto(BASE + '#/courses'); await gp.reload(); await gp.waitForSelector('.ucard');
  await walk(gp, 4, 'desktop', true);
  await walk(gp, 5, 'desktop', true);
  await gp.goto(BASE + '#/courses'); await gp.waitForSelector('.ucard');
  check('完成 U01–U05 後 U06 解鎖、U07 仍鎖住', await gp.locator('a.ucard[href="#/unit/6"]').count() === 1 && await gp.locator('a.ucard[href="#/unit/7"]').count() === 0);
  await g.close();
  // ---- iPhone 13 直式：同樣四課 ----
  const m = await browser.newContext({ ...devices['iPhone 13'] });
  await m.addInitScript(() => { if (!localStorage.getItem('fde-youth-v1')) localStorage.setItem('fde-youth-v1', JSON.stringify({ current: null, learners: {}, order: 2, guestLessons: { 3: { done: true } } })); });
  const mp = await m.newPage(); watch(mp, 'iphone');
  for (const id of [1, 2, 4, 5]) await walk(mp, id, 'iphone13', true);
  await m.close();
} catch (e) { check('執行中斷', false, e.message); }
const real = errs.filter(e => !/favicon|Failed to load resource/.test(e));
check('瀏覽器無 JavaScript 錯誤', real.length === 0, real.slice(0, 3).join(' | '));
await browser.close(); srv.close();
const pass = results.filter(r => r.ok).length;
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ when: new Date().toISOString(), pass, total: results.length, results, errs: real }, null, 2));
console.log(`\n結果：${pass}／${results.length} 通過　截圖：${OUT}`);
process.exit(pass === results.length ? 0 : 1);
