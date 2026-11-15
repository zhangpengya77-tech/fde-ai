// P6 成績保存端對端驗收：不啟動伺服器，用 Playwright 攔截請求——頁面檔案從磁碟讀、成績 API 用模擬回應。
// 會把頁面實際送出的 JSON 存成 fixtures/f450_payload_*.json，Django 測試再拿同一份 JSON 打真的 API（前後端格式一致）。
// 用法：set PLAYWRIGHT_PATH=<playwright 套件路徑> 後執行 node tests/f450-training/records_e2e.cjs <截圖輸出資料夾>
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2];
const ROOT = path.join(__dirname, '../..');
const FIX = path.join(__dirname, 'fixtures');
const HOST = 'http://f450.test';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const log = [];
const snap = async (fn) => { try { await fn(); } catch (e) { log.push(`SKIP 截圖逾時（只影響報告用截圖，不影響功能檢查）：${String(e.message).split(String.fromCharCode(10))[0]}`); } };
const ok = (c, m) => { log.push(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };

async function openPage(browser, api) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await page.addInitScript(() => { try { localStorage.setItem('f450twin-wire-level', 'base'); } catch { /* 無痕 */ } });   // P13：這組測試走接頭級分頁
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.route(`${HOST}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/student/sim-practice/api/') return api(route);
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(path.join(ROOT, 'f450-twin')) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
  });
  await page.goto(`${HOST}/f450-twin/index.html?fx=0&practiceDebug=1&mode=practice`, { timeout: 150000 });
  await page.waitForFunction(() => !document.getElementById('loading') && window.__f450Practice, null, { timeout: 150000 });
  return { page, errs };
}
const P = (page, fn, ...a) => page.evaluate(fn, ...a);
const saveText = (page) => P(page, () => document.querySelector('#train-session .ts-save').textContent);

(async () => {
  fs.mkdirSync(FIX, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  // 1) 已登入：練習保存＋考核交卷自動保存
  const posts = [];
  const loggedIn = async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { ok: true, logged_in: true, nickname: '組裝學員', csrf_token: 'tok123', login_url: '/login/', records_url: '/student/sim-practice/' } });
    posts.push({ body: JSON.parse(req.postData()), csrf: req.headers()['x-csrftoken'] });
    return route.fulfill({ status: 201, json: { ok: true, id: posts.length, records_url: '/student/sim-practice/' } });
  };
  const { page, errs } = await openPage(browser, loggedIn);
  await page.waitForFunction(() => document.querySelector('#train-session .ts-save').textContent.includes('已登入'), null, { timeout: 10000 });
  ok((await saveText(page)).includes('已登入：組裝學員'), '顯示登入狀態');
  // 練習：裝一件、接一條，按保存
  const port = (id) => page.locator(`#wire2d [data-port="${id}"] circle`);
  await page.locator('#wire2d-enter').click(); await page.waitForSelector('#wire2d .w2-port');
  await page.locator('#strip-practice .pr-tray button', { hasText: '下中心板' }).first().click();
  const s = await P(page, () => window.__f450Practice.screen('bottom_plate'));
  await page.mouse.move(s.held[0], s.held[1]); await page.mouse.down(); await page.mouse.move(s.slots.bottom_plate[0], s.slots.bottom_plate[1], { steps: 6 }); await page.mouse.up();
  await port('battery.xt60').click({ force: true }); await port('power_module.in').click({ force: true });
  await port('esc_fr.signal').click({ force: true }); await port('pixhawk.main_out_2').click({ force: true });   // 一條錯的
  await page.locator('#train-session .ts-save button').click();
  await page.waitForFunction(() => document.querySelector('#train-session .ts-save').textContent.includes('已存入'), null, { timeout: 10000 });
  ok(posts.length === 1, '練習：按保存送出 1 筆');
  const p1 = posts[0];
  ok(p1.csrf === 'tok123', '帶上 CSRF token');
  ok(p1.body.mode === 'f450' && p1.body.summary.train_mode === 'practice', `mode=f450、train_mode=practice`);
  ok(p1.body.summary.categories.map((c) => c.id).join() === 'frame,motor_esc,fc,power_signal,safety', '5 個分項依序');
  ok(Math.abs(p1.body.score - p1.body.summary.categories.reduce((a, c) => a + c.score, 0)) <= 1, `總分等於分項相加（${p1.body.score}）`);
  ok(p1.body.summary.installed === 1 && p1.body.summary.wires_correct === 1 && p1.body.summary.errors === 1, `安裝 1、接對 1、錯誤 1（${JSON.stringify(p1.body.summary)}）`);
  ok(!('student' in p1.body) && !('cohort' in p1.body), '不送學員或班級');
  ok((await saveText(page)).includes('查看紀錄'), '保存後提供「查看紀錄」連結');
  fs.writeFileSync(path.join(FIX, 'f450_payload_practice.json'), JSON.stringify(p1.body, null, 2));
  // 考核：交卷自動保存
  await page.locator('#train-session .ts-modes button', { hasText: '考核' }).click(); await page.waitForTimeout(300);
  ok(await P(page, () => document.querySelector('#train-session .ts-save button').hidden), '考核中沒有手動保存按鈕');
  ok((await saveText(page)).includes('交卷後會自動保存'), '考核中說明交卷後自動保存');
  await port('receiver.sbus').click({ force: true }); await port('pixhawk.rc_in').click({ force: true });
  await page.locator('#train-session button', { hasText: '交卷' }).click();
  await page.waitForFunction(() => document.querySelector('#train-session .ts-save').textContent.includes('已存入'), null, { timeout: 10000 });
  ok(posts.length === 2 && posts[1].body.summary.train_mode === 'exam', '交卷後自動保存考核成績');
  ok(posts[1].body.duration_seconds >= 0 && posts[1].body.summary.wires_correct === 1, '考核：用時與接線數');
  fs.writeFileSync(path.join(FIX, 'f450_payload_exam.json'), JSON.stringify(posts[1].body, null, 2));
  await P(page, () => document.getElementById('train-session').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
  const r = await P(page, () => { const b = document.getElementById('train-session').getBoundingClientRect(); return { x: b.x, y: Math.max(0, b.y), width: b.width, height: Math.min(b.height, innerHeight - Math.max(0, b.y)) }; });
  await snap(() => page.screenshot({ path: `${OUT}/P6_saved_exam.png`, clip: r, timeout: 90000 }));
  ok(errs.length === 0, `沒有腳本錯誤 ${errs.slice(0, 2).join(' | ')}`);
  await page.context().close();

  // 2) 未登入：只顯示登入連結，不送資料
  let posted = 0;
  const anon = async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { ok: true, logged_in: false, nickname: '', csrf_token: 't', login_url: '/login/?next=/f450-twin/' } });
    posted++; return route.fulfill({ status: 401, json: { ok: false } });
  };
  const b = await openPage(browser, anon);
  await b.page.waitForFunction(() => document.querySelector('#train-session .ts-save').textContent.includes('登入'), null, { timeout: 10000 });
  ok((await saveText(b.page)).includes('登入學員帳號後可以保存成績'), '未登入：說明要登入');
  ok(await P(b.page, () => document.querySelector('#train-session .ts-save button').hidden), '未登入：沒有保存按鈕');
  ok(await P(b.page, () => document.querySelector('#train-session .ts-save a')?.getAttribute('href') === '/login/?next=/f450-twin/'), '未登入：提供登入連結');
  ok(posted === 0, '未登入：沒有送出任何成績');
  await b.page.context().close();

  // 3) 沒有後端（例如雲端靜態版）：說明不會保存
  const c = await openPage(browser, (route) => route.fulfill({ status: 404, body: 'not found' }));
  await c.page.waitForFunction(() => document.querySelector('#train-session .ts-save').textContent.includes('沒有連到教學主機'), null, { timeout: 10000 });
  ok(true, '沒有後端：說明成績不會保存');
  ok(await P(c.page, () => document.querySelector('#train-session .ts-save button').hidden), '沒有後端：沒有保存按鈕');
  await c.page.context().close();

  await browser.close();
  console.log(log.join('\n'));
})().catch((e) => { console.log(log.join('\n')); console.error(e); process.exit(2); });
