// 3D 主畫面全螢幕驗收：原生全螢幕（按鈕／Esc 離開）與「鋪滿整頁」備援（iPhone 等不支援元素全螢幕時）
// 頁面用 Playwright 攔截請求提供（WebKit 不能用 file:// 載模組），不啟動伺服器。
// 用法：set PLAYWRIGHT_PATH=<playwright 套件路徑> 後執行 node tests/f450-training/fullscreen_e2e.cjs <輸出資料夾>
const { chromium, webkit, devices } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2];
const ROOT = path.join(__dirname, '../..');
const HOST = 'http://f450.test';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg' };
const log = [];
const ok = (c, m) => { log.push(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };

async function open(browserType, launch, ctxOpts) {
  const browser = await browserType.launch(launch);
  const page = await (await browser.newContext(ctxOpts)).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.route(`${HOST}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/student/')) return route.fulfill({ json: { ok: true, logged_in: false, csrf_token: 't', login_url: '/login/' } });
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(path.join(ROOT, 'f450-twin')) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
  });
  await page.goto(`${HOST}/f450-twin/index.html`, { timeout: 120000 });
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 120000 });
  return { browser, page, errs };
}
const state = (page) => page.evaluate(() => {
  const v = document.getElementById('viewer'), c = v.querySelector('canvas'), b = document.getElementById('toggle-full');
  return { native: document.fullscreenElement === v, pseudo: v.classList.contains('pseudo-full'), vw: Math.round(v.getBoundingClientRect().width), vh: Math.round(v.getBoundingClientRect().height),
    cw: c.width, iw: innerWidth, ih: innerHeight, btn: b.textContent, on: b.classList.contains('on'), scroll: getComputedStyle(document.documentElement).overflow };
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const runs = [
    ['Chrome 桌面', chromium, { channel: 'chrome' }, { viewport: { width: 1440, height: 900 } }],
    ['Edge 桌面', chromium, { channel: 'msedge' }, { viewport: { width: 1440, height: 900 } }],
    ['Chrome 手機（Pixel 7）', chromium, { channel: 'chrome' }, devices['Pixel 7']],
    ['WebKit iPhone 13', webkit, {}, (({ defaultBrowserType, ...o }) => o)(devices['iPhone 13'])],
  ];
  for (const [name, type, launch, ctx] of runs) {
    let b;
    try {
      const { browser, page, errs } = await open(type, launch, ctx); b = browser;
      const before = await state(page);
      ok(before.btn.includes('全螢幕') && !before.on, `${name}: 有「⛶ 全螢幕」按鈕`);
      // 1) 正常路徑：按鈕進入
      await page.locator('#toggle-full').click(); await page.waitForTimeout(700);
      let s = await state(page);
      ok((s.native || s.pseudo) && s.vw >= s.iw - 2 && s.vh >= s.ih - 2, `${name}: 進入全螢幕，3D 畫面鋪滿（${s.native ? '原生' : '鋪滿整頁'}，${s.vw}×${s.vh}）`);
      ok(s.btn.includes('離開') && s.on, `${name}: 按鈕變成「✕ 離開全螢幕」`);
      ok(s.cw > before.cw || s.vw > before.vw, `${name}: 3D 畫布跟著放大（${before.vw} → ${s.vw}）`);
      if (name === 'Chrome 桌面') await page.screenshot({ path: path.join(OUT, 'P10_fullscreen_desktop.png'), timeout: 60000 }).catch(() => {});
      // 離開：按 Esc（原生全螢幕在部分無頭瀏覽器無法用模擬按鍵離開，就改按按鈕）
      await page.keyboard.press('Escape'); await page.waitForTimeout(500);
      s = await state(page);
      if (s.native || s.pseudo) { await page.locator('#toggle-full').click(); await page.waitForTimeout(500); s = await state(page); }
      ok(!s.native && !s.pseudo && s.btn.includes('全螢幕') && !s.on, `${name}: 離開後回到原畫面`);
      ok(Math.abs(s.vw - before.vw) <= 2 && Math.abs(s.vh - before.vh) <= 2, `${name}: 3D 畫面回到原尺寸（${s.vw}×${s.vh}）`);
      // 2) 備援路徑：模擬不支援元素全螢幕（iPhone Safari 的情況）→ 鋪滿整頁 → Esc 離開
      await page.evaluate(() => { document.getElementById('viewer').requestFullscreen = () => Promise.reject(new Error('不支援')); });
      await page.locator('#toggle-full').click(); await page.waitForTimeout(500);
      s = await state(page);
      ok(s.pseudo && s.vw >= s.iw - 2 && s.vh >= s.ih - 2 && s.scroll === 'hidden', `${name}: 備援「鋪滿整頁」並鎖住背景捲動`);
      if (name === 'WebKit iPhone 13') await page.screenshot({ path: path.join(OUT, 'P10_fullscreen_iphone.png'), timeout: 60000 }).catch(() => {});
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      s = await state(page);
      ok(!s.pseudo && s.scroll !== 'hidden' && !s.on, `${name}: 鋪滿整頁時按 Esc 回到原畫面`);
      // 3) 全螢幕中其他按鈕仍可用
      await page.locator('#toggle-full').click(); await page.waitForTimeout(300);
      await page.locator('[data-view="top"]').click(); await page.waitForTimeout(200);
      ok(await page.evaluate(() => document.querySelector('[data-view="top"]').classList.contains('on')), `${name}: 全螢幕中視角按鈕可用`);
      await page.locator('#toggle-full').click();
      ok(errs.length === 0, `${name}: 沒有腳本錯誤 ${errs.slice(0, 2).join(' | ')}`);
    } catch (e) {
      ok(false, `${name}: ${String(e.message).split(String.fromCharCode(10))[0]}`);
    }
    if (b) await b.close();
  }
  console.log(log.join('\n'));
})();
