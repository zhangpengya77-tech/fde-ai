// V1.2 U09 單課頁測試：四步線性推進、鎖定、重新整理回到原步驟、無錯誤、手機無水平捲動、底部導航不擋內容；並輸出對照截圖
// 用法（專案根目錄）：node tests/youth/lesson-u09.mjs [截圖資料夾]　自帶只讀靜態伺服器 127.0.0.1:8274
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.BL_PLAYWRIGHT || 'D:/FDE-AI-UAS-v2.0-live-camera/node_modules/playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(process.argv[2] || 'D:/FDE-AI-Youth-Reference/u09');
fs.mkdirSync(OUT, { recursive: true });
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const srv = http.createServer((q, r) => { let f = path.normalize(path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname))); if (!f.startsWith(root)) return r.writeHead(403).end(); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); if (!fs.existsSync(f)) return r.writeHead(404).end(); r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise(o => srv.listen(8274, '127.0.0.1', o));
const BASE = 'http://127.0.0.1:8274/live/youth/';
const { default: spec } = await import(new URL('../../live/youth/data/lessons/u09.js', import.meta.url).href);
const results = []; const errs = [];
const check = (n, ok, d = '') => { results.push({ n, ok: !!ok, d }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '　' + d : ''}`); };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function run(name, ctxOpt, shots) {
  const ctx = await browser.newContext(ctxOpt); const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(`${name} pageerror: ${e.message}`)); p.on('console', m => { if (m.type() === 'error') errs.push(`${name}: ${m.text()}`); });
  const shot = async f => { if (shots) await p.screenshot({ path: path.join(OUT, `${name}_${f}.png`) }); };
  const overflow = () => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  const navCovers = () => p.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); const n = document.querySelector('.ls-nav'); if (!n) return false; const last = document.querySelector('.ls-review'); return last.getBoundingClientRect().bottom > n.getBoundingClientRect().top + 1; });
  await p.goto(BASE + '#/unit/9'); await p.waitForSelector('.ls-card');
  check(`${name}：進入 U09 從 01 訓練任務開始`, p.url().endsWith('#/unit/9/task'));
  check(`${name}：未翻完知識卡時「下一步」不可按`, await p.locator('#ls-next').isDisabled());
  check(`${name}：未到的步驟不能點（無連結）`, await p.locator('.ls-steps li.locked a').count() === 0 && await p.locator('.ls-steps li.locked').count() === 3);
  await p.goto(BASE + '#/unit/9/criteria'); await p.waitForSelector('.ls-card');
  check(`${name}：直接輸入未到步驟網址會被擋回`, p.url().endsWith('#/unit/9/task'));
  check(`${name}：手機無水平捲動（01）`, !(await overflow()));
  await shot('01_task');
  for (let k = 0; k < 10 && !(await p.locator('#ls-cnext').isDisabled()); k++) await p.click('#ls-cnext');
  check(`${name}：知識卡一次一張並全部翻閱`, (await p.textContent('#ls-card small')).includes(`${spec.steps.task.cards.length} / ${spec.steps.task.cards.length}`));
  check(`${name}：翻完後「下一步」可按`, !(await p.locator('#ls-next').isDisabled()));
  check(`${name}：底部導航不擋內容`, !(await navCovers()));
  await p.click('#ls-next'); await p.waitForSelector('#ls-3d canvas', { timeout: 20000 }); await p.waitForTimeout(800);
  check(`${name}：進入 02 三維演示`, p.url().endsWith('#/unit/9/demo'));
  check(`${name}：演示未看完時「下一步」不可按`, await p.locator('#ls-next').isDisabled());
  // 各階段：點時間軸分段 → 右側當前動作卡隨之更新
  let phaseOk = 0;
  for (const [k, ph] of spec.steps.demo.phases.entries()) {
    await p.click(`#ls-phases button[data-k="${k}"]`); await p.waitForTimeout(150);
    if ((await p.textContent('#ls-an')) === ph.action.name) phaseOk++;
    if (k === 2) { await p.click('#ls-phases button[data-k="2"]'); await p.fill('#ls-sc', '76'); await p.dispatchEvent('#ls-sc', 'input'); await p.waitForTimeout(400); await p.evaluate(() => window.scrollTo(0, 0)); await shot('02_demo_hover'); }
  }
  check(`${name}：時間軸 5 段點選後當前動作卡更新`, phaseOk === 5);
  const hud = await p.textContent('#ls-hud');
  await p.fill('#ls-sc', '76'); await p.dispatchEvent('#ls-sc', 'input'); await p.waitForTimeout(200);
  check(`${name}：懸停階段 HUD 高度在 1.35–1.65 m`, Math.abs(parseFloat(await p.textContent('#ls-hud')) - 1.5) <= 0.15, `${await p.textContent('#ls-hud')}（前一次 ${hud}）`);
  for (const v of ['top', 'side', 'nose', 'reset']) await p.click(`.ls-views button[data-v="${v}"]`);
  await p.click('.ls-views button[data-v="three"]');
  // 播放到結尾：倍速 6×，從 188 秒開始播
  for (let k = 0; k < 3; k++) await p.click('#ls-sp');
  check(`${name}：速度循環到 6×`, (await p.textContent('#ls-sp')) === '6×');
  await p.fill('#ls-sc', '188'); await p.dispatchEvent('#ls-sc', 'input'); await p.click('#ls-pp');
  await p.waitForFunction(() => !document.querySelector('#ls-next').disabled, null, { timeout: 15000 }).catch(() => {});
  check(`${name}：演示播到結尾後「下一步」可按`, !(await p.locator('#ls-next').isDisabled()));
  check(`${name}：手機無水平捲動（02）`, !(await overflow()));
  await p.click('#ls-phases button[data-k="1"]'); await p.fill('#ls-sc', '34'); await p.dispatchEvent('#ls-sc', 'input'); await p.waitForTimeout(300); await p.evaluate(() => window.scrollTo(0, 0)); await shot('02_demo_takeoff');
  // 重新整理：回到原步驟
  await p.reload(); await p.waitForSelector('#ls-3d canvas', { timeout: 20000 });
  check(`${name}：重新整理後回到 02 三維演示`, p.url().endsWith('#/unit/9/demo'));
  await p.click('#ls-next'); await p.waitForSelector('#ls-qz');
  check(`${name}：進入 03 考核標準，抽 5 題`, await p.locator('#ls-qz fieldset').count() === 5);
  check(`${name}：未交卷時「下一步」不可按`, await p.locator('#ls-next').isDisabled());
  await shot('03_criteria');
  // 依題目文字找答案作答
  const legends = await p.locator('#ls-qz legend').allTextContents();
  for (const [n, lg] of legends.entries()) { const q = spec.steps.criteria.quiz.find(x => lg.endsWith(x.q)); await p.check(`input[name=q${n}][value="${q.answer}"]`); }
  await p.click('#ls-qz button'); await p.waitForSelector('.ls-score');
  check(`${name}：測驗 100 分且「下一步」可按`, (await p.textContent('.ls-score b')).includes('100') && !(await p.locator('#ls-next').isDisabled()));
  await shot('03_criteria_result');
  await p.click('#ls-next'); await p.waitForSelector('.ls-tipgrid');
  check(`${name}：進入 04 訓練技巧，有開始實作`, (await p.textContent('.ls-prac')).includes('開始實作'));
  check(`${name}：底部導航不擋內容（04）`, !(await navCovers()));
  await p.evaluate(() => window.scrollTo(0, 0)); await shot('04_tips');
  await p.click('#ls-next'); await p.waitForSelector('.ls-nextunit');
  check(`${name}：本課完成頁有「下一課」大按鈕`, (await p.textContent('.ls-nextunit')).includes('下一課'));
  await shot('05_done');
  await p.click('.ls-steps li:nth-child(1) a');
  check(`${name}：完成後已完成步驟可回看`, p.url().endsWith('#/unit/9/task'));
  // 助教浮動按鈕
  await p.click('#ls-ai-fab'); await p.fill('#ai-q', '什麼是油門'); await p.click('#ai-form button');
  check(`${name}：助教底部面板可問答`, (await p.textContent('#ai-log')).includes('油門'));
  await shot('06_ai_sheet');
  await ctx.close();
}

try {
  await run('desktop', { viewport: { width: 1440, height: 900 } }, true);
  await run('iphone13', { ...devices['iPhone 13'] }, true);
  // 橫式全屏授課（教師模式：步驟不鎖）
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] }); const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(`landscape pageerror: ${e.message}`));
  await p.goto(BASE + '#/unit/9'); await p.waitForSelector('.ls-card');
  await p.click('#ls-teach'); await p.waitForTimeout(400);
  check('橫式：全屏授課開啟後步驟不鎖', await p.locator('.ls-steps li.locked').count() === 0);
  await p.evaluate(() => { location.hash = '#/unit/9/demo'; }); await p.waitForSelector('#ls-3d canvas', { timeout: 20000 }); await p.fill('#ls-sc', '76'); await p.dispatchEvent('#ls-sc', 'input'); await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, 'iphone13-landscape_02_demo_teach.png') });
  const h3d = await p.evaluate(() => document.querySelector('#ls-3d').getBoundingClientRect().height);
  check('橫式：3D 區佔滿大部分高度', h3d >= 200, `${Math.round(h3d)} px`);
  await p.click('#ls-next'); await p.waitForSelector('#ls-qz'); await p.screenshot({ path: path.join(OUT, 'iphone13-landscape_03_criteria_teach.png') });
  await ctx.close();
  // 手機 3D 區不超過畫面 45%
  const c2 = await browser.newContext({ ...devices['iPhone 13'] }); const p2 = await c2.newPage();
  await p2.goto(BASE + '#/unit/9'); await p2.click('#ls-teach'); await p2.click('.ls-steps li:nth-child(2) a'); await p2.waitForSelector('#ls-3d canvas', { timeout: 20000 });
  const r = await p2.evaluate(() => ({ h: document.querySelector('#ls-3d').getBoundingClientRect().height, vh: innerHeight }));
  check('手機：3D 區高度 ≤ 畫面 45%', r.h <= r.vh * 0.45 + 1, `${Math.round(r.h)}/${r.vh}`);
  await c2.close();
  // 課程以外頁面：手機主導航不被切掉
  const c3 = await browser.newContext({ ...devices['iPhone 13'] }); const p3 = await c3.newPage();
  await p3.goto(BASE + '#/courses'); await p3.waitForSelector('.ucard');
  const cut = await p3.evaluate(() => [...document.querySelectorAll('.topnav a')].some(a => { const r = a.getBoundingClientRect(); return r.right > innerWidth + 1 || a.scrollWidth > a.clientWidth + 1; }));
  check('手機：課程以外頁面主導航完整顯示', !cut);
  await p3.screenshot({ path: path.join(OUT, 'iphone13_courses_nav.png') });
  await c3.close();
} catch (e) { check('執行中斷', false, e.message); }
const real = errs.filter(e => !/favicon|Failed to load resource/.test(e));
check('瀏覽器無 JavaScript 錯誤', real.length === 0, real.slice(0, 3).join(' | '));
await browser.close(); srv.close();
const pass = results.filter(r => r.ok).length;
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ when: new Date().toISOString(), pass, total: results.length, results, errs: real }, null, 2));
console.log(`\n結果：${pass}／${results.length} 通過　截圖：${OUT}`);
process.exit(pass === results.length ? 0 : 1);
