// P7 補測：WebKit（Safari 的引擎）——iPhone 13、iPad、桌面 Safari
// WebKit 不能用 file:// 載入 ES 模組，所以用 Playwright 攔截請求：頁面檔案從磁碟讀、成績 API 用模擬回應。不啟動伺服器。
// 限制：Playwright WebKit 沒有 Chrome 的低階觸控介面；iPhone 上的拖曳用「觸控型 Pointer 事件」（pointerType=touch）模擬。
// 用法：set PLAYWRIGHT_PATH=<playwright 套件路徑> 後執行 node tests/f450-training/webkit_e2e.cjs <輸出資料夾>
const { webkit, devices } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2];
const ROOT = path.join(__dirname, '../..');
const HOST = 'http://f450.test';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const log = [];
const metrics = {};
const ok = (c, m) => { log.push(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const snap = async (fn) => { try { await fn(); } catch (e) { log.push(`SKIP 截圖：${String(e.message).split(String.fromCharCode(10))[0]}`); } };

async function serve(page, posts) {
  await page.route(`${HOST}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/student/sim-practice/api/') {
      if (route.request().method() === 'GET') return route.fulfill({ json: { ok: true, logged_in: true, nickname: 'Safari 學員', csrf_token: 'tok', login_url: '/login/', records_url: '/student/sim-practice/' } });
      posts.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 201, json: { ok: true, records_url: '/student/sim-practice/' } });
    }
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(path.join(ROOT, 'f450-twin')) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
  });
}

// 觸控型 Pointer 事件拖曳（iPhone 上手指拖曳時瀏覽器送出的就是 pointerType=touch）
async function touchDrag(page, [x0, y0], [x1, y1]) {
  await page.evaluate(({ x0, y0, x1, y1 }) => {
    const canvas = document.querySelector('#viewer canvas');
    const fire = (type, x, y, target) => (target || document.elementFromPoint(x, y) || canvas).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
    fire('pointerdown', x0, y0, canvas);
    for (let i = 1; i <= 8; i++) fire('pointermove', x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8, canvas);
    fire('pointerup', x1, y1, canvas);
  }, { x0, y0, x1, y1 });
  await page.waitForTimeout(250);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  const runs = [
    { name: 'WebKit iPhone 13', ctx: devices['iPhone 13'], touch: true },
    { name: 'WebKit iPad（第 7 代）', ctx: devices['iPad (gen 7)'], touch: true },
    { name: 'WebKit 桌面 Safari', ctx: devices['Desktop Safari'], touch: false },
  ];
  for (const r of runs) {
    const { defaultBrowserType, ...opts } = r.ctx;
    const context = await browser.newContext(opts);
    const page = await context.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('dialog', (d) => d.accept());
    const posts = [];
    const m = {};
    try {
      await serve(page, posts);
      const t0 = Date.now();
      await page.goto(`${HOST}/f450-twin/index.html?practiceDebug=1`, { timeout: 120000 });
      // 1) 基本支援：importmap、WebGL、模型載入
      m.webgl = await page.evaluate(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); return gl ? (gl.getParameter(gl.VERSION) + ' / ' + gl.getParameter(gl.RENDERER)) : 'none'; });
      await page.waitForFunction(() => !document.getElementById('loading') || /WebGL|失敗/.test(document.getElementById('loading').textContent), null, { timeout: 120000 });
      const loadingText = await page.evaluate(() => document.getElementById('loading')?.textContent || '');
      m.model_ready_ms = Date.now() - t0;
      ok(!loadingText, `${r.name}: 3D 模型載入（${m.model_ready_ms} ms；${m.webgl}）${loadingText ? ' 訊息：' + loadingText.slice(0, 80) : ''}`);
      if (loadingText) throw new Error('模型沒有載入，後面跳過');
      ok(await page.evaluate(() => !!window.__f450Practice), `${r.name}: 實訓模組（ES 模組＋importmap）正常執行`);
      // 2) 3D 組裝練習：拖曳下中心板
      await page.locator('#practice-enter').click(); await page.waitForTimeout(800);
      await page.locator('#strip-practice .pr-tray button', { hasText: '下中心板' }).first().click(); await page.waitForTimeout(400);
      const s = await page.evaluate(() => window.__f450Practice.screen('bottom_plate'));
      if (r.touch) await touchDrag(page, s.held, s.slots.bottom_plate);
      else { await page.mouse.move(...s.held); await page.mouse.down(); await page.mouse.move(...s.slots.bottom_plate, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(250); }
      ok((await page.evaluate(() => window.__f450Practice.screen('bottom_plate').status)) === 'installed', `${r.name}: 3D ${r.touch ? '觸控型 Pointer 事件' : '滑鼠'}拖曳安裝下中心板`);
      // 3) 2D 接線：SVG 接口點選（手機用 tap）
      await page.locator('#wire2d-enter').click(); await page.waitForSelector('#wire2d .w2-port');
      const port = (id) => page.locator(`#wire2d [data-port="${id}"] circle`);
      if (r.touch) { await port('battery.xt60').tap({ force: true }); await port('power_module.in').tap({ force: true }); }
      else { await port('battery.xt60').click({ force: true }); await port('power_module.in').click({ force: true }); }
      ok((await page.locator('#wire2d [data-wire]').count()) === 1, `${r.name}: 2D ${r.touch ? '點按' : '滑鼠'}連線`);
      // SVG 接口選取時放大：Safari 不支援用 CSS 改 r，所以改用 transform 縮放；這裡量實際畫出來的大小
      await port('esc_fr.signal').click({ force: true });
      m.pending_scale = await page.evaluate(() => { const sel = document.querySelector('#wire2d .w2-port.pending circle').getBoundingClientRect().width; const idle = document.querySelector('#wire2d [data-port="esc_fl.signal"] circle').getBoundingClientRect().width; return Math.round((sel / idle) * 100) / 100; });   // 選取的接口與沒選的接口比大小
      ok(m.pending_scale > 1.2, `${r.name}: SVG 接口選取時放大（實際放大 ${m.pending_scale} 倍）`);
      await page.keyboard.press('Escape');
      // 4) 成績單與保存
      ok(Number(await page.evaluate(() => document.querySelector('#train-session .ts-total b')?.textContent)) > 0, `${r.name}: 成績單即時更新`);
      await page.waitForFunction(() => document.querySelector('#train-session .ts-save').textContent.includes('已登入'), null, { timeout: 10000 });
      await page.locator('#train-session .ts-save button').click();
      await page.waitForFunction(() => document.querySelector('#train-session .ts-save').textContent.includes('已存入'), null, { timeout: 10000 });
      ok(posts.length === 1 && posts[0].mode === 'f450', `${r.name}: 保存成績（fetch＋CSRF）`);
      // 5) 原有模式、版面
      for (const mode of ['whole', 'assembly', 'wiring', 'size', 'explode']) await page.locator(`[data-mode="${mode}"]`).first().click({ force: true });
      ok(await page.evaluate(() => !document.getElementById('strip-explode').hidden), `${r.name}: 原有五種模式切換`);
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${r.name}: 頁面沒有橫向捲動`);
      await snap(() => page.screenshot({ path: path.join(OUT, `P7_webkit_${r.name.replace(/[^\w]+/g, '_')}.png`), timeout: 60000 }));
      await page.evaluate(() => document.getElementById('wire2d').scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await snap(() => page.screenshot({ path: path.join(OUT, `P7_webkit_${r.name.replace(/[^\w]+/g, '_')}_2d.png`), timeout: 60000 }));
    } catch (e) {
      ok(false, `${r.name}: ${String(e.message).split(String.fromCharCode(10))[0]}`);
    }
    ok(errs.length === 0, `${r.name}: 沒有腳本錯誤 ${errs.slice(0, 3).join(' | ')}`);
    metrics[r.name] = m;
    await context.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'p7_webkit_metrics.json'), JSON.stringify(metrics, null, 2));
  console.log(log.join('\n'));
  console.log(JSON.stringify(metrics, null, 1));
})();
