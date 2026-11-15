// P14 獨立全螢幕「F450 接線模擬器」（/f450-twin/wiring.html）端對端驗收：
// 3D 頁導覽列有入口、全頁工作台、零件欄 16 項擬真縮圖、示例後自己接滿 54 根→檢查與上電通過、短路砰、選單與說明、手機寬度。
// 頁面用 Playwright 攔截請求提供，不啟動伺服器。
// 用法：set PLAYWRIGHT_PATH=<playwright 套件路徑> 後執行 node tests/f450-training/sim_e2e.cjs <輸出資料夾>
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
  const serve = async (ctx) => ctx.route('http://f450.test/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/student/')) return route.fulfill({ json: { ok: true, logged_in: false, csrf_token: 't', login_url: '/login/' } });
    const f = path.join(ROOT, decodeURIComponent(u.pathname)); if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(f), contentType: T[path.extname(f)] || 'application/octet-stream' });
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } }); await serve(ctx);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('dialog', (d) => d.accept());

  // 1) 3D 頁導覽列有「接線模擬器」入口
  await page.goto('http://f450.test/f450-twin/index.html?fx=0', { timeout: 90000 });
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 90000 });
  const link = page.locator('.modes a.sim-link');
  ok(await link.count() === 1 && (await link.getAttribute('href')) === './wiring.html' && (await link.textContent()).includes('接線模擬器'), '3D 頁導覽列有「接線模擬器」入口');
  await link.click(); await page.waitForURL(/wiring\.html/);

  // 2) 全頁工作台
  await page.waitForSelector('#bench-root .bench-item');
  const P = (fn, ...a) => page.evaluate(fn, ...a);
  const act = (n) => page.locator(`#bench-root [data-act="${n}"]`);
  ok(await P(() => { const r = document.querySelector('#bench-root .bench-stage').getBoundingClientRect(); return r.height > innerHeight * 0.85 && r.width >= innerWidth - 2; }), '工作區佔滿畫面（頁首以外）');
  ok(await P(() => document.querySelector('#bench-root').classList.contains('bench-full') && !!document.querySelector('#bench-root .bench-dock .w2-status')), '全頁模式：狀態列浮在工作區');
  ok((await page.locator('#bench-root .bench-item').count()) === 16 && (await page.locator('#bench-root .bench-item .bench-thumb').count()) === 16, '零件欄 16 項，每項有零件圖');
  ok(await P(() => ['esc_fr', 'motor_fr', 'gps', 'pdb', 'power_module'].every((id) => document.querySelector(`#bench-root .bench-item[data-part="${id}"] .bench-thumb`).querySelectorAll('path,rect,circle').length >= 15)), '零件圖為擬真細節（線材、接頭、焊盤）');
  ok(await P(() => !document.querySelector('#bench-root .bench-palette').hidden), '空白工作區自動打開零件欄');
  if (OUT) await page.screenshot({ path: path.join(OUT, 'P14_sim_empty.png') });

  // 3) 示例 → 清除示例 → 自己接滿 54 根 → 檢查、上電通過
  await act('demo').click(); await page.waitForFunction(() => /示例完成/.test(document.querySelector('#bench-root .w2-status').textContent), null, { timeout: 60000 });
  ok(await page.locator('#bench-root .bench-part').count() === 16, '完整接線示例放好 16 個零件');
  if (OUT) await page.screenshot({ path: path.join(OUT, 'P14_sim_demo.png') });
  await act('demo').click();
  const pin = (id) => page.locator(`#bench-root [data-pin="${id}"] circle`);
  const wire = async (a, b) => { await pin(a).click({ force: true }); await pin(b).click({ force: true }); };
  // 先接電池到電源模組，再把電源模組 6P 的 VCC 接到 POWER 的 GND（短路）→ 上電「砰」
  await wire('battery.xt60#+', 'power_module.in#+'); await wire('battery.xt60#-', 'power_module.in#-');
  await wire('power_module.fc#1', 'pixhawk.power#5');
  await act('power').click();
  ok(await page.locator('#bench-root .bench-boom').count() > 0, '短路上電會「砰」');
  await act('undo').click();
  ok(await page.locator('#bench-root [data-wire]').count() === 2, '復原可拿掉短路那根線');
  for (const e of EXPECTED_PIN_WIRES) {
    const b = e.phase ? e.b.replace('#null', `#${e.a.split('#')[1]}`) : e.b;
    if (await page.locator(`#bench-root [data-pin="${e.a}"].used`).count() && await page.locator(`#bench-root [data-pin="${b}"].used`).count()) continue;   // 電池那兩根已接
    await wire(e.a, b);
  }
  await act('check').click();
  const report = () => P(() => document.querySelector('#bench-root .bench-report').textContent);
  const rep = await report();
  ok(rep.includes('全部 54 根都接對了'), '自己接滿 54 根：檢查全對');
  await act('power').click();
  ok((await report()).includes('上電測試通過') && await page.locator('#bench-root .bench-boom').count() === 0, '上電測試通過');
  if (OUT) await page.screenshot({ path: path.join(OUT, 'P14_sim_all_ok.png') });

  // 4) 選單與說明
  await page.locator('#menu-btn').click();
  ok(await P(() => !document.getElementById('sim-menu').hidden && [...document.querySelectorAll('#sim-menu a')].some((a) => a.getAttribute('href') === './index.html')), '選單可打開，含回 3D 數位孿生');
  await page.locator('#info-open2').click();
  ok(await P(() => document.getElementById('sim-info').open && document.getElementById('sim-info').textContent.includes('CC-BY-SA 3.0')), '說明視窗含操作方式與資料來源授權');
  await page.locator('#sim-info button').click();
  // 5) 深色模式頁首跟著變
  await act('theme').click();
  ok(await P(() => getComputedStyle(document.querySelector('.sim-head')).backgroundColor !== 'rgb(255, 255, 255)'), '切深色時頁首一起變深');
  await act('theme').click();

  // 6) 手機寬度
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await serve(m);
  const mp = await m.newPage(); mp.on('pageerror', (e) => errs.push(String(e)));
  await mp.goto('http://f450.test/f450-twin/wiring.html'); await mp.waitForSelector('#bench-root .bench-item');
  ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '手機寬度不橫向捲動');
  ok(await mp.evaluate(() => { const t = document.querySelector('.bench-topbar').getBoundingClientRect(), a = document.querySelector('.bench-actions').getBoundingClientRect(); return t.right <= a.left + 1; }), '手機：工具列不壓到檢查鈕');
  if (OUT) await mp.screenshot({ path: path.join(OUT, 'P14_sim_mobile.png') });

  ok(errs.length === 0, `沒有腳本錯誤${errs.length ? '：' + errs.slice(0, 3).join(' | ') : ''}`);
  console.log(log.join('\n')); console.log(`${log.filter((l) => l.startsWith('PASS')).length}/${log.length} 通過`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
