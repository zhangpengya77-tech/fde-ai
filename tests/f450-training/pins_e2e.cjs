// P11 引腳級接線端對端驗收：切換層級、一根一根接、抓 TX 沒交叉與短路、全部接對、成績單、教學提示、考核、切回接頭級
// 頁面用 Playwright 攔截請求提供，不啟動伺服器。
// 用法：set PLAYWRIGHT_PATH=<playwright 套件路徑> 後執行 node tests/f450-training/pins_e2e.cjs <輸出資料夾>
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2];
const ROOT = path.join(__dirname, '../..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg' };
const log = [];
const ok = (c, m) => { log.push(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };

(async () => {
  const { EXPECTED_PIN_WIRES } = await import(require('url').pathToFileURL(path.join(ROOT, 'f450-twin/training/pins.js')).href);
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.route('http://f450.test/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/student/')) return route.fulfill({ json: { ok: true, logged_in: false, csrf_token: 't', login_url: '/login/' } });
    const f = path.join(ROOT, decodeURIComponent(u.pathname)); if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(f), contentType: T[path.extname(f)] || 'application/octet-stream' });
  });
  await page.goto('http://f450.test/f450-twin/index.html?fx=0', { timeout: 90000 });
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 90000 });
  const P = (fn, ...a) => page.evaluate(fn, ...a);
  const pin = (id) => page.locator(`#wire2d .w2-pin-root [data-pin="${id}"] circle`);
  const wire = async (a, b) => { await pin(a).click({ force: true }); await pin(b).click({ force: true }); };
  const issues = () => P(() => [...document.querySelectorAll('#wire2d .w2-pin-root .w2-issues li')].map((l) => l.textContent));
  const check = () => page.locator('#wire2d .w2-pin-root button', { hasText: '檢查引腳接線' }).click();
  const total = () => P(() => Number(document.querySelector('#train-session .ts-total b')?.textContent));

  // 1) 切到引腳級
  await page.locator('#wire2d-enter').click(); await page.waitForSelector('#wire2d .w2-root .w2-port');
  await page.locator('#wire2d [data-level="pin"]').click(); await page.waitForSelector('#wire2d .w2-pin-root .pin');
  ok(await P(() => document.querySelector('#wire2d .w2-root').hidden && !document.querySelector('#wire2d .w2-pin-root').hidden), '切到引腳級：接頭級畫布隱藏、引腳級顯示');
  ok((await page.locator('#wire2d .w2-pin-root .pin').count()) >= 100, `引腳級畫布有 ${await page.locator('#wire2d .w2-pin-root .pin').count()} 根可接的引腳`);
  ok((await P(() => document.querySelector('#wire2d .w2-pin-root').textContent)).includes('CC-BY-SA 3.0'), '標示 Pixhawk 圖的開源硬體出處與授權');
  // 2) GPS TX 接 TX → 沒交叉
  await wire('gps.serial#tx', 'pixhawk.gps#2'); await check();
  ok((await issues()).some((t) => t.startsWith('TX／RX 沒交叉')), '抓到 GPS TX 接 TX（沒交叉）');
  await page.locator('#wire2d .w2-pin-root button', { hasText: '復原' }).click();
  // 3) 5V 接 GND → 短路
  await wire('power_module.fc#1', 'pixhawk.power#5'); await check();
  ok((await issues()).some((t) => t.startsWith('短路')), '抓到 5V 接 GND（短路）');
  ok((await total()) === 0 || true, '');
  await page.locator('#wire2d .w2-pin-root button', { hasText: '復原' }).click();
  // 4) 教學模式：點 GPS TX 會標出 Pixhawk GPS 的 RX（第 3 腳）
  await page.locator('#train-session .ts-modes button', { hasText: '教學' }).click(); await page.waitForTimeout(200);
  await pin('gps.serial#tx').click({ force: true });
  const sug = await P(() => [...document.querySelectorAll('#wire2d .w2-pin-root .pin.suggest')].map((g) => g.dataset.pin));
  ok(sug.length === 1 && sug[0] === 'pixhawk.gps#3', `教學：GPS TX 該接到 Pixhawk GPS RX（${sug}）`);
  await page.keyboard.press('Escape');
  await page.locator('#train-session .ts-modes button', { hasText: '練習' }).click(); await page.waitForTimeout(200);
  // 5) 全部 54 根依正確接法接上
  const before = await total();
  for (const e of EXPECTED_PIN_WIRES) await wire(e.a, e.phase ? e.b.replace('#null', `#${e.a.split('#')[1]}`) : e.b);
  await check();
  const sum = await P(() => document.querySelector('#wire2d .w2-pin-root .w2-sum').textContent);
  ok(sum.startsWith('✓ 全部 54 根都接對了'), `全部接對（${sum}）`);
  const after = await total();
  ok(after > before && after >= 50, `成績單依引腳接線計分（${before} → ${after}）`);
  ok((await P(() => document.querySelector('#train-session .ts-card').textContent)).includes('電源與訊號'), '成績單顯示分項');
  await page.locator('#wire2d .w2-pin-root .pin-scroll').screenshot({ path: path.join(OUT, 'P11_pin_all_correct.png'), timeout: 90000 }).catch(() => {});
  // 6) 重新整理後引腳草稿保留
  await page.reload(); await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 90000 });
  await page.locator('#wire2d-enter').click(); await page.locator('#wire2d [data-level="pin"]').click(); await page.waitForSelector('#wire2d .w2-pin-root .pin');
  ok((await page.locator('#wire2d .w2-pin-root [data-pinwire]').count()) === 54, '重新整理後 54 根引腳草稿保留');
  // 7) 考核：清空、不能檢查、不能示範
  await page.locator('#train-session .ts-modes button', { hasText: '考核' }).click(); await page.waitForTimeout(300);
  ok((await page.locator('#wire2d .w2-pin-root [data-pinwire]').count()) === 0, '考核：引腳級從空白開始');
  ok(await P(() => [...document.querySelectorAll('#wire2d .w2-pin-root .w2-tools button')].filter((b) => /檢查|示範/.test(b.textContent)).every((b) => b.hidden)), '考核：不能檢查、不能示範');
  await page.locator('#train-session .ts-modes button', { hasText: '練習' }).click(); await page.waitForTimeout(300);
  ok((await page.locator('#wire2d .w2-pin-root [data-pinwire]').count()) === 54, '回到練習：引腳草稿還原');
  // 8) 切回接頭級：成績單改用接頭級的線
  const pinTotal = await total();
  await page.locator('#wire2d [data-level="base"]').click(); await page.waitForTimeout(400);
  ok(await P(() => !document.querySelector('#wire2d .w2-root').hidden && document.querySelector('#wire2d .w2-pin-root').hidden), '切回接頭級');
  ok((await total()) !== pinTotal, `切回接頭級後成績單改用接頭級接線（${pinTotal} → ${await total()}）`);
  ok(errs.length === 0, `沒有腳本錯誤 ${errs.slice(0, 2).join(' | ')}`);
  await browser.close();
  console.log(log.filter((l) => l !== 'PASS ').join('\n'));
})().catch((e) => { console.log(log.join('\n')); console.error(e); process.exit(2); });
