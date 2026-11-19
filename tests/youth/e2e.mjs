// 青少年實驗室｜端到端瀏覽器測試（學生完整流程＋教師＋遙控器模擬＋手機版面＋效能）
// 用法（專案根目錄）：node tests/youth/e2e.mjs [截圖資料夾]
// 自帶只讀靜態伺服器 127.0.0.1:8271（避開正式站埠）；不連任何正式服務。
// 注意：USB 遙控器以「注入假的 navigator.getGamepads」模擬，屬 AUTOMATED（模擬）測試，不是實體設備驗證。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BL_PLAYWRIGHT || 'D:/FDE-AI-UAS-v2.0-live-camera/node_modules/playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(process.argv[2] || 'D:/FDE-AI-Youth-Reference/e2e');
fs.mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.YL_PORT || 8271);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let f = path.normalize(path.join(root, decodeURIComponent(u.pathname)));
  if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(ok => server.listen(PORT, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${PORT}/live/youth/`;

const results = []; const logs = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '　' + detail : ''}`); };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const watch = p => { p.on('pageerror', e => logs.push(`pageerror: ${e.message}`)); p.on('console', m => { if (m.type() === 'error') logs.push(m.text()); }); };
const { UNITS } = await import(new URL('../../live/youth/data/units.js', import.meta.url).href);

try {
  // ===== 電腦版：學生完整流程 =====
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage(); watch(page);
  const t0 = Date.now();
  await page.goto(BASE); await page.waitForSelector('.hero');
  const loadMs = Date.now() - t0;
  check('首頁載入', true, `${loadMs} ms`);
  check('首頁 6 個入口（課程介紹／互動課堂／3D 實驗室／足球／進度／教師）', await page.locator('.grid6 .tile').count() === 6);
  check('首頁無「開發中」字樣', !(await page.textContent('body')).includes('開發中'));
  await page.screenshot({ path: path.join(OUT, '01_home.png') });

  await page.click('#loginBtn'); await page.fill('input[name=n]', '測試鷹'); await page.fill('input[name=c]', 'E2E-A1'); await page.click('button[value=ok]');
  check('學員登入（暱稱＋班級代碼）', (await page.textContent('#who')).includes('E2E-A1'));

  await page.goto(BASE + '#/courses'); await page.waitForSelector('.ucard');
  check('課程中心 12 單元', await page.locator('.ucard').count() === 12);
  await page.click('.filters a:nth-child(2)'); await page.waitForTimeout(200);
  check('年級篩選', (await page.locator('.ucard').count()) < 12);
  await page.screenshot({ path: path.join(OUT, '02_courses.png') });

  // 每個單元的知識講解都能打開且有 4 段內容
  let readOk = 0;
  // U09 已改用 V1.2 四步單課頁（知識卡一次一張），其他單元仍是 4 段講解
  for (const u of UNITS) { await page.goto(`${BASE}#/unit/${u.id}`); if (u.id === 9) { await page.waitForSelector('.ls-card'); readOk++; continue; } await page.waitForSelector('.sections article'); if (await page.locator('.sections article').count() === 4) readOk++; }
  check('12 單元知識講解皆可閱讀', readOk === 12, `${readOk}/12`);
  await page.goto(`${BASE}#/unit/5`); await page.waitForSelector('.sections'); await page.screenshot({ path: path.join(OUT, '03_unit5_read.png') });

  // 單元 5 互動操作：電池計算
  await page.goto(`${BASE}#/unit/5/widget`); await page.waitForSelector('#bc-v');
  await page.fill('#bc-v', '14.8'); await page.fill('#bc-c', '4400'); await page.fill('#bc-e', '65.1'); await page.click('#bc-k');
  check('互動操作：電池計算題完成', (await page.textContent('#wg-st')).includes('完成'));

  // 實驗 C 電池
  await page.goto(`${BASE}#/lab/battery?unit=5`); await page.waitForSelector('#b-V');
  for (const sp of ['1,1', '3,1', '4,1', '6,1', '4,2']) await page.click(`[data-sp="${sp}"]`);
  check('電池實驗：4S2P 電壓 14.80 V、容量 3000 mAh', (await page.textContent('#b-V')) === '14.80 V' && (await page.textContent('#b-C')) === '3000 mAh');
  await page.click('[data-v="4.2"]'); check('電池實驗：6S 以外 4.2 V 滿電無警告', (await page.getAttribute('#b-state', 'class')).includes('ok'));
  await page.fill('#b-v', '4.3'); await page.dispatchEvent('#b-v', 'input');
  check('電池實驗：過充示警', (await page.getAttribute('#b-state', 'class')).includes('over'));
  check('電池實驗：完成判定', (await page.textContent('#lb-st')).includes('完成'));
  await page.click('.tabs button[data-t="2"]'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(OUT, '04_battery_ions.png') });
  await page.click('.tabs button[data-t="1"]'); await page.screenshot({ path: path.join(OUT, '04_battery.png') });

  // 單元 5 測驗（全對）
  await page.goto(`${BASE}#/unit/5/quiz`); await page.waitForSelector('#qz');
  for (const [i, q] of UNITS[4].quiz.entries()) await page.check(`input[name=q${i}][value="${q.answer}"]`);
  await page.click('#qz button'); await page.waitForSelector('.result');
  check('測驗：全對 100 分並給解析', (await page.textContent('.result b')).includes('100'));
  await page.goto(`${BASE}#/unit/5/record`); await page.waitForSelector('.kpis');
  check('學習紀錄：單元 5 完成 5/5', (await page.textContent('.kpis')).includes('5/5'));

  // 3D 實驗：載入與操作
  for (const id of ['teardown', 'attitude', 'motor', 'sensor']) {
    await page.goto(`${BASE}#/lab/${id}`); await page.waitForSelector('#labhost canvas', { timeout: 20000 });
    await page.waitForTimeout(800);
    const px = await page.evaluate(() => { const c = document.querySelector('#labhost canvas'); return c.width * c.height; });
    check(`3D 實驗載入：${id}`, px > 10000);
    await page.screenshot({ path: path.join(OUT, `05_lab_${id}.png`) });
  }
  // 拆解：拖放組裝（以「點清單＋點畫面」方式）
  await page.goto(`${BASE}#/lab/teardown`); await page.waitForSelector('#ta-stage canvas');
  await page.click('#ta-build');
  for (let k = 0; k < 20; k++) { const li = page.locator('#ta-list li.todo').first(); if (!(await li.count())) break; await li.click(); await page.click('#ta-stage', { position: { x: 200, y: 200 } }); }
  check('實驗 A 拆解：拖放組裝完成', (await page.textContent('#lb-st')).includes('完成'));
  await page.click('#ta-learn'); await page.fill('#ta-exp', '100'); await page.dispatchEvent('#ta-exp', 'input'); await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, '05_lab_teardown_explode.png') });
  // 電機：六步換相
  await page.goto(`${BASE}#/lab/motor`); await page.waitForSelector('#m-next');
  for (let k = 0; k < 6; k++) await page.click('#m-next');
  check('實驗 D 電機：六步換相完成', (await page.textContent('#lb-st')).includes('完成'));
  // 姿態：保持水平任務
  await page.goto(`${BASE}#/lab/attitude`); await page.waitForSelector('#at-thr');
  await page.fill('#at-thr', '60'); await page.dispatchEvent('#at-thr', 'input'); await page.waitForTimeout(3600);
  check('實驗 B 姿態：任務 1 保持水平完成', (await page.locator('#at-tasks li.ok').count()) >= 1);
  // 感測器：傾斜→自穩回正
  await page.goto(`${BASE}#/lab/sensor`); await page.waitForSelector('#s-tilt');
  await page.fill('#s-tilt', '25'); await page.dispatchEvent('#s-tilt', 'input'); await page.waitForTimeout(200); await page.dispatchEvent('#s-tilt', 'change');
  await page.check('#s-stab'); await page.waitForTimeout(6000);
  check('實驗 F 感測器：自穩回正完成', (await page.textContent('#lb-st')).includes('完成'));
  // F450：電機編號檢核
  await page.goto(`${BASE}#/lab/f450`); await page.waitForSelector('#f-check');
  for (const [k, m, d] of [['FR', 'M1', 'CCW'], ['RL', 'M2', 'CCW'], ['FL', 'M3', 'CW'], ['RR', 'M4', 'CW']]) { await page.selectOption(`select[data-k="${k}"][data-f="m"]`, m); await page.selectOption(`select[data-k="${k}"][data-f="d"]`, d); }
  await page.click('#f-check');
  check('實驗 E F450：電機編號檢核完成', (await page.textContent('#lb-st')).includes('完成'));
  const blRes = await page.request.get(`http://127.0.0.1:${PORT}/f450-twin/build-lab/`);
  check('實驗 E：既有組裝實訓室網址可開', blRes.ok());

  // ===== 足球：穿越球門（鍵盤操作）=====
  await page.goto(`${BASE}#/soccer/ring?unit=10`); await page.waitForSelector('#sc-stage canvas', { timeout: 20000 });
  await page.click('#sc-start'); await page.waitForTimeout(300);
  await page.keyboard.down('w'); await page.waitForTimeout(1100); await page.keyboard.up('w');
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => document.querySelector('#sc-status')?.textContent.includes('完成'), null, { timeout: 15000 }).catch(() => {});
  await page.keyboard.up('ArrowUp'); await page.waitForTimeout(300);
  const ringStatus = await page.textContent('#sc-status');
  check('足球：鍵盤操作穿越球門並保存成績', ringStatus.includes('完成'), ringStatus);
  await page.screenshot({ path: path.join(OUT, '06_soccer_ring.png') });
  // 戰術預設與演示
  await page.click('[data-p="flank"]'); await page.click('#sc-demo'); await page.waitForTimeout(1500);
  check('足球：課堂預設戰術＋演示路線', (await page.textContent('#sc-demo-st')).includes('演示中'));
  await page.screenshot({ path: path.join(OUT, '06_soccer_tactic.png') });
  await page.click('#sc-demo');
  for (const v of ['top', 'side', 'pilot', 'follow', 'all']) await page.click(`#sc-views [data-v="${v}"]`);
  check('足球：五種視角切換', true);
  for (const m of ['free', 'hover', 'ring', 'attack', 'defend', 'timed']) { await page.click(`#sc-modes [data-m="${m}"]`); }
  check('足球：六種任務模式可切換', (await page.locator('#sc-modes button').count()) === 6);
  // 防守任務：讓紅隊得分機自己衝門，確認會判定失敗（判定邏輯有效）
  await page.click('#sc-modes [data-m="defend"]'); await page.click('#sc-start'); await page.waitForTimeout(12000);
  check('足球：防守任務判定（未攔截＝失敗）', (await page.textContent('#sc-status')).includes('未完成'));

  // ===== USB 遙控器（模擬注入）=====
  await page.evaluate(() => {
    const pad = { id: '模擬 USB 遙控器 (Vendor: 0000)', index: 0, connected: true, axes: [0, -1, 0, 0], buttons: Array.from({ length: 8 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = pad; navigator.getGamepads = () => [window.__pad];
    const e = new Event('gamepadconnected'); e.gamepad = pad; window.dispatchEvent(e);
  });
  await page.click('#sc-modes [data-m="free"]'); await page.click('#sc-start'); await page.waitForTimeout(1500);
  const src = await page.textContent('#sc-src'); const h = parseFloat(await page.textContent('#sc-h'));
  check('USB 遙控器（模擬）：辨識並以油門軸上升', src === 'USB 遙控器' && h > 1, `來源 ${src}、高度 ${h}`);
  await page.evaluate(() => { window.__pad.buttons[0].pressed = true; });
  await page.waitForTimeout(300);
  check('USB 遙控器（模擬）：緊急停止鍵', (await page.textContent('#sc-conn')).includes('緊急停止'));
  await page.evaluate(() => { window.__pad.buttons[0].pressed = false; window.__pad.connected = false; const e = new Event('gamepaddisconnected'); e.gamepad = window.__pad; window.dispatchEvent(e); });
  await page.waitForTimeout(300);
  check('USB 遙控器（模擬）：斷線提醒', (await page.textContent('#sc-conn')).includes('斷線'));
  await page.click('#sc-rc'); await page.waitForSelector('#rc-st');
  check('遙控器設定視窗（校準、通道、死區）', await page.locator('.rc-map select').count() === 4);
  await page.click('#rc-close');

  // ===== 我的學習＋下載報告 =====
  await page.goto(`${BASE}#/me`); await page.waitForSelector('#dl');
  check('我的學習：足球紀錄', (await page.textContent('body')).includes('穿越球門'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
  const repPath = path.join(OUT, 'report.json'); await dl.saveAs(repPath);
  const rep = JSON.parse(fs.readFileSync(repPath, 'utf8'));
  check('學習報告只含暱稱與班級代碼', rep.nick === '測試鷹' && rep.cls === 'E2E-A1' && !('email' in rep));
  await page.screenshot({ path: path.join(OUT, '07_me.png'), fullPage: true });

  // ===== 教師 =====
  const t = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); watch(t);
  await t.goto(BASE + '#/teacher'); await t.fill('#tc-new input[name=c]', 'E2E-A1'); await t.fill('#tc-new input[name=n]', '測試班'); await t.click('#tc-new button');
  await t.waitForSelector('#tc-file'); await t.setInputFiles('#tc-file', repPath); await t.waitForTimeout(1600);
  check('教師：匯入學生報告並顯示成績', (await t.textContent('.tbl')).includes('測試鷹'));
  await t.fill('#tc-new input[name=c]', 'OTHER'); await t.click('#tc-new button'); await t.waitForSelector('h3:has-text("OTHER")');
  await t.setInputFiles('#tc-file', repPath); await t.waitForTimeout(400);
  check('教師：跨班報告被拒絕', (await t.textContent('#tc-msg')).includes('不是目前選擇'));
  await t.screenshot({ path: path.join(OUT, '08_teacher.png') });

  // ===== 手機版面 =====
  const mp = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage(); watch(mp);
  const overflow = () => mp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  for (const [n, h] of [['home', ''], ['courses', '#/courses'], ['unit', '#/unit/3'], ['lab', '#/lab/battery'], ['soccer', '#/soccer'], ['teacher', '#/teacher']]) {
    await mp.goto(BASE + h); await mp.waitForTimeout(1200);
    check(`手機版面無水平溢出：${n}`, !(await overflow()));
    await mp.screenshot({ path: path.join(OUT, `09_mobile_${n}.png`) });
  }
  await mp.goto(BASE + '#/soccer'); await mp.waitForSelector('#st-l');
  check('手機：足球虛擬搖桿顯示', await mp.locator('#st-l').isVisible());
  // 觸控拖曳右搖桿往上推（前進），確認來源切換為虛擬搖桿
  await mp.click('#sc-start');
  const sb = await mp.locator('#st-l').boundingBox();
  await mp.dispatchEvent('#st-l', 'pointerdown', { pointerId: 7, clientX: sb.x + sb.width / 2, clientY: sb.y + sb.height / 2, bubbles: true });
  await mp.dispatchEvent('#st-l', 'pointermove', { pointerId: 7, clientX: sb.x + sb.width / 2, clientY: sb.y + 4, bubbles: true });
  await mp.waitForTimeout(1500);
  const vh = parseFloat(await mp.textContent('#sc-h'));
  await mp.dispatchEvent('#st-l', 'pointerup', { pointerId: 7, bubbles: true });
  check('手機：虛擬搖桿推油門上升', (await mp.textContent('#sc-src')) === '虛擬搖桿' && vh > 0.5, `高度 ${vh}`);
  const tab = await (await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true })).newPage(); watch(tab);
  await tab.goto(BASE + '#/soccer'); await tab.waitForTimeout(1500);
  check('平板版面無水平溢出：soccer', !(await tab.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  await tab.screenshot({ path: path.join(OUT, '10_tablet_soccer.png') });

  // ===== 效能（headless 軟體繪圖，只作相對參考）=====
  await page.goto(`${BASE}#/soccer`); await page.waitForSelector('#sc-stage canvas'); await page.waitForTimeout(1000);
  const fps = await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(n / 3); }; requestAnimationFrame(f); }));
  check('效能：足球場幀率（SwiftShader 軟體繪圖，非實機）', fps > 5, `${fps.toFixed(1)} fps`);
} catch (e) { check('執行中斷', false, e.message); }

const errs = logs.filter(l => !/favicon|Failed to load resource/.test(l));
check('瀏覽器無 JavaScript 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close(); server.close();
const pass = results.filter(r => r.ok).length;
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ when: new Date().toISOString(), pass, total: results.length, results, logs: errs }, null, 2));
console.log(`\n結果：${pass}／${results.length} 通過　截圖：${OUT}`);
process.exit(pass === results.length ? 0 : 1);
