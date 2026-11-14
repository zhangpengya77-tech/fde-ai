// P7 跨瀏覽器、手機觸控與效能驗收（file:// 載入，不啟動伺服器）
// 用本機安裝的 Chrome、Edge（實際 GPU），以及手機模擬（觸控事件、手機 UA、窄螢幕）。
// 用法：set PLAYWRIGHT_PATH=<playwright 套件路徑> 後執行 node tests/f450-training/p7_cross_e2e.cjs <輸出資料夾>
// 結果另存 <輸出資料夾>/p7_metrics.json，供報告引用。
const { chromium, devices } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2];
const URL = require('url').pathToFileURL(path.join(__dirname, '../../f450-twin/index.html')).href;
const log = [];
const metrics = {};
const ok = (c, m) => { log.push(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const snap = async (fn) => { try { await fn(); } catch (e) { log.push(`SKIP 截圖逾時：${String(e.message).split(String.fromCharCode(10))[0]}`); } };
const GPU_ARGS = ['--allow-file-access-from-files', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

// 量畫面每秒幾格（requestAnimationFrame 次數）
const fps = (page, ms = 3000) => page.evaluate((dur) => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < dur) requestAnimationFrame(f); else res(Math.round((n * 1000) / (performance.now() - t0))); }; requestAnimationFrame(f); }), ms);
const renderer = (page) => page.evaluate(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return 'no-webgl'; const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });

async function smoke(page, name, { touch = false, cdp = null } = {}) {
  const P = (fn, ...a) => page.evaluate(fn, ...a);
  const m = {};
  // 1) 首屏：沿用頁面內建 ?perf=1（模型可用時間、下載量、記憶體、繪圖統計）
  await page.waitForFunction(() => document.title.startsWith('PERF'), null, { timeout: 120000 });
  const perf = Object.fromEntries((await page.title()).replace('PERF ', '').split(' ').map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)]));
  Object.assign(m, perf);
  m.renderer = await renderer(page);
  m.fps_explode = await fps(page);
  ok(perf.model_ready_ms > 0, `${name}: 3D 模型載入 ${perf.model_ready_ms} ms（${m.renderer}）`);
  // 2) 3D 組裝練習：拿起並拖曳下中心板（手機用真的觸控事件）
  await page.locator('#practice-enter').click(); await page.waitForTimeout(800);
  m.fps_practice = await fps(page);
  await page.locator('#strip-practice .pr-tray button', { hasText: '下中心板' }).first().click(); await page.waitForTimeout(300);
  const s = await P(() => window.__f450Practice.screen('bottom_plate'));
  const [x0, y0] = s.held, [x1, y1] = s.slots.bottom_plate;
  if (touch) {
    const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await tp('touchStart', x0, y0);
    for (let i = 1; i <= 8; i++) await tp('touchMove', x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8);
    await tp('touchEnd'); await page.waitForTimeout(200);
  } else {
    await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(200);
  }
  ok((await P(() => window.__f450Practice.screen('bottom_plate').status)) === 'installed', `${name}: 3D ${touch ? '觸控' : '滑鼠'}拖曳安裝下中心板`);
  // 3) 2D 接線：點兩個接口連線（手機用 tap）
  await page.locator('#wire2d-enter').click(); await page.waitForSelector('#wire2d .w2-port');
  const port = (id) => page.locator(`#wire2d [data-port="${id}"] circle`);
  const t0 = Date.now();
  if (touch) { await port('battery.xt60').tap({ force: true }); await port('power_module.in').tap({ force: true }); }
  else { await port('battery.xt60').click({ force: true }); await port('power_module.in').click({ force: true }); }
  m.wire_ms = Date.now() - t0;
  ok((await page.locator('#wire2d [data-wire]').count()) === 1, `${name}: 2D ${touch ? '觸控' : '滑鼠'}連線（${m.wire_ms} ms）`);
  // 4) 成績單即時更新、三模式切換
  ok(Number(await P(() => document.querySelector('#train-session .ts-total b')?.textContent)) > 0, `${name}: 成績單即時更新`);
  // 5) 原有五種模式
  for (const mode of ['whole', 'assembly', 'wiring', 'size', 'explode']) {
    await page.locator(`[data-mode="${mode}"]`).first().click({ force: true }); await page.waitForTimeout(250);
    if (!(await P((mm) => !document.getElementById(`strip-${mm}`).hidden, mode))) ok(false, `${name}: ${mode} 模式`);
  }
  ok(true, `${name}: 原有五種模式切換正常`);
  // 說明條不可擋住 3D 上方的視角按鈕（手機上按鈕會排兩行）
  await port('esc_fr.signal').click({ force: true }); await page.waitForTimeout(300);
  const overlap = await P(() => { const c = document.querySelector('#viewer .sync-cap'); if (!c || c.hidden) return 'no-cap'; const r = c.getBoundingClientRect(); return [...document.querySelectorAll('#viewer .viewbar button')].some((b) => { const q = b.getBoundingClientRect(); return !(q.right <= r.left || q.left >= r.right || q.bottom <= r.top || q.top >= r.bottom); }); });
  ok(overlap === false, `${name}: 3D 說明條不擋視角按鈕（${overlap}）`);
  await page.keyboard.press('Escape');
  m.heap_after_mb = await P(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1));
  m.no_hscroll = await P(() => document.documentElement.scrollWidth <= innerWidth + 1);
  ok(m.no_hscroll, `${name}: 頁面沒有橫向捲動`);
  return m;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const runs = [
    { name: 'Chrome 桌面', channel: 'chrome', ctx: { viewport: { width: 1440, height: 900 } } },
    { name: 'Edge 桌面', channel: 'msedge', ctx: { viewport: { width: 1440, height: 900 } } },
    { name: 'Chrome 手機（Pixel 7 模擬）', channel: 'chrome', touch: true, ctx: { ...devices['Pixel 7'] } },
    { name: 'Chrome 手機（iPhone 13 尺寸模擬，非 Safari）', channel: 'chrome', touch: true, ctx: { ...devices['iPhone 13'], defaultBrowserType: undefined } },
    { name: 'Chrome 手機（Pixel 7，CPU 減速 4 倍模擬中階手機）', channel: 'chrome', touch: true, throttle: 4, ctx: { ...devices['Pixel 7'] } },
  ];
  for (const r of runs) {
    let browser;
    try {
      browser = await chromium.launch({ channel: r.channel, headless: true, args: GPU_ARGS });
      const { defaultBrowserType, ...ctxOpts } = r.ctx;
      const context = await browser.newContext(ctxOpts);
      const page = await context.newPage();
      const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      page.on('dialog', (d) => d.accept());
      const cdp = r.touch ? await context.newCDPSession(page) : null;
      if (r.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: r.throttle });   // 模擬較慢的手機處理器
      await page.goto(`${URL}?perf=1&practiceDebug=1`, { timeout: 120000 });
      metrics[r.name] = await smoke(page, r.name, { touch: r.touch, cdp });
      metrics[r.name].low_power_mode = await page.evaluate(() => matchMedia('(pointer: coarse)').matches || innerWidth < 820);
      ok(errs.length === 0, `${r.name}: 沒有腳本錯誤 ${errs.slice(0, 2).join(' | ')}`);
      await page.locator('[data-mode="explode"]').first().click({ force: true });
      await snap(() => page.screenshot({ path: path.join(OUT, `P7_${r.name.replace(/[^\w一-龥]+/g, '_')}.png`), timeout: 60000 }));
      await browser.close();
    } catch (e) {
      ok(false, `${r.name}: 執行失敗 ${String(e.message).split(String.fromCharCode(10))[0]}`);
      if (browser) await browser.close();
    }
  }
  fs.writeFileSync(path.join(OUT, 'p7_metrics.json'), JSON.stringify(metrics, null, 2));
  console.log(log.join('\n'));
  console.log(JSON.stringify(metrics, null, 1));
})();
