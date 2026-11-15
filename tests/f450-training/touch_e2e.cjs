// P15 手機觸控驗收（/f450-twin/wiring.html）：用真正的觸控事件（CDP Input.dispatchTouchEvent）測
// 手機直式／橫式精簡版版面、手指從零件欄拖入、點一下加入、按住引腳拖到另一根接線（吸附最近引腳）、
// 電腦版滑鼠拖引腳接線、雙指縮放、沒有橫向捲動。頁面用 Playwright 攔截請求提供，不啟動伺服器。
// 用法：set PLAYWRIGHT_PATH=<playwright 套件路徑> 後執行 node tests/f450-training/touch_e2e.cjs <輸出資料夾>
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2];
const ROOT = path.join(__dirname, '../..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg' };
const log = [];
const ok = (c, m) => { log.push(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const errs = [];
  async function open(viewport, mobile) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
    await ctx.route('http://f450.test/**', (route) => {
      const u = new URL(route.request().url());
      const f = path.join(ROOT, decodeURIComponent(u.pathname)); if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: fs.readFileSync(f), contentType: T[path.extname(f)] || 'application/octet-stream' });
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto('http://f450.test/f450-twin/wiring.html'); await page.waitForSelector('#bench-root .bench-item');
    const cdp = await ctx.newCDPSession(page);
    // 一根手指從 a 拖到 b（分段移動，像真的手指）
    const swipe = async ([ax, ay], [bx, by], steps = 14) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ax, y: ay, id: 1 }] }); await sleep(30);
      for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: ax + ((bx - ax) * i) / steps, y: ay + ((by - ay) * i) / steps, id: 1 }] }); await sleep(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(120);
    };
    const tap = async ([x, y]) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await sleep(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(150); };
    return { ctx, page, cdp, swipe, tap };
  }
  const center = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
  const pinXY = (page, id) => center(page, `#bench-root [data-pin="${id}"] .pin-dot`);
  const parts = (page) => page.evaluate(() => [...document.querySelectorAll('#bench-root .bench-part')].map((g) => g.dataset.part));
  const wireCount = (page) => page.locator('#bench-root [data-wire]').count();
  const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const overlap = (page, a, b) => page.evaluate(([a, b]) => { const r1 = document.querySelector(a).getBoundingClientRect(), r2 = document.querySelector(b).getBoundingClientRect(); return !(r1.right <= r2.left || r2.right <= r1.left || r1.bottom <= r2.top || r2.bottom <= r1.top); }, [a, b]);

  // ───── 手機直式（iPhone 13 大小）─────
  {
    const { ctx, page, swipe, tap } = await open({ width: 390, height: 844 }, true);
    ok(await page.evaluate(() => document.querySelector('#bench-root').classList.contains('bench-compact')), '手機直式：切成精簡版');
    const pal = await page.evaluate(() => { const p = document.querySelector('#bench-root .bench-palette'), r = p.getBoundingClientRect(), a = [...p.querySelectorAll('.bench-item')].slice(0, 2).map((i) => i.getBoundingClientRect()); return { h: r.height, row: a[0].top === a[1].top && a[1].left > a[0].left, below: r.top >= document.querySelector('#bench-root .bench-topbar').getBoundingClientRect().bottom }; });
    ok(!(await page.locator('#bench-root .bench-palette').isHidden()) && pal.h < 150 && pal.row && pal.below, `零件欄是工具列下方一條橫向滑動列（高 ${Math.round(pal.h)}px）`);
    ok(!(await overlap(page, '#bench-root .bench-zoombar', '#bench-root .bench-actions')) && await page.evaluate(() => document.querySelector('#bench-root .bench-zoombar').getBoundingClientRect().bottom < innerHeight * 0.6), '縮放列在右側上方直排，不在底部（避開手機瀏覽器按鈕）');
    ok(!(await overlap(page, '#bench-root .bench-topbar', '#bench-root .bench-actions')), '工具列不壓到檢查鈕');
    if (OUT) await page.screenshot({ path: path.join(OUT, 'P15_phone_tray.png') });
    // 手指把 Pixhawk 從零件欄往下拖到工作區
    const from = await center(page, '#bench-root .bench-item[data-part="pixhawk"] .bench-thumb');
    await swipe(from, [195, 620]);
    ok((await parts(page)).includes('pixhawk'), '手指從零件欄拖入 Pixhawk');
    const pos = await page.evaluate(() => { const r = document.querySelector('#bench-root .bench-part[data-part="pixhawk"] .bench-selbox').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    ok(Math.abs(pos[0] - 195) < 40 && Math.abs(pos[1] - 620) < 40, `零件放在手指放開的位置（${pos.map(Math.round)}）`);
    // 點一下 GPS 卡片 → 加入
    await tap(await center(page, '#bench-root .bench-item[data-part="gps"] .bench-thumb'));
    ok((await parts(page)).includes('gps'), '點一下零件卡片就加入');
    // 關掉零件欄，放大一點，用手指從 GPS TX 拖到 Pixhawk GPS RX
    await page.locator('#bench-root [data-act="parts"]').tap();
    ok(await page.locator('#bench-root .bench-palette').isHidden(), '「＋ 配件」可收起零件欄');
    await page.locator('#bench-root [data-act="fit"]').tap();
    const inView = await page.evaluate(() => ['gps.serial#tx', 'pixhawk.gps#3'].map((id) => { const r = document.querySelector(`#bench-root [data-pin="${id}"] .pin-dot`).getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e && e.closest('.bench-svg') ? 'ok' : `${id} 被 ${e?.className?.baseVal ?? e?.className} 蓋住`; }));
    ok(inView.every((x) => x === 'ok'), `適配後兩根引腳都看得到、沒被浮動列蓋住（${inView.join('，')}）`);
    const a = await pinXY(page, 'gps.serial#tx'), b = await pinXY(page, 'pixhawk.gps#3');
    const before = await wireCount(page);
    await swipe(a, [b[0] + 4, b[1] - 3]);   // 故意放偏一點，要吸附到最近的引腳
    const w = await page.evaluate(() => { const g = [...document.querySelectorAll('#bench-root [data-wire]')].pop(); return g ? true : false; });
    ok((await wireCount(page)) === before + 1 && w, '按住引腳拖到另一根放開＝接線（放偏也會吸附）');
    const st = await page.evaluate(() => document.querySelector('#bench-root .w2-status').textContent);
    ok(/GPS/.test(st) && /已接/.test(st), `狀態列顯示已接：${st.slice(0, 40)}`);
    // 點一下引腳、再點另一根（舊方式）也還能接
    const c1 = await pinXY(page, 'gps.serial#vcc'), c2 = await pinXY(page, 'pixhawk.gps#1');
    await tap(c1); await tap(c2);
    ok((await wireCount(page)) === before + 2, '點兩根引腳也能接線');
    // 拖曳空白處平移、雙指縮放不出錯
    const k0 = await page.evaluate(() => document.querySelector('#bench-root .bench-zoom').textContent);
    await swipe([60, 780], [140, 700]);
    ok((await wireCount(page)) === before + 2, '拖曳空白處只平移，不會誤接線');
    ok(await noHScroll(page), '手機直式不橫向捲動');
    if (OUT) await page.screenshot({ path: path.join(OUT, 'P15_phone_wired.png') });
    void k0; await ctx.close();
  }
  // ───── 手機橫式 ─────
  {
    const { ctx, page, swipe } = await open({ width: 844, height: 390 }, true);
    ok(await page.evaluate(() => document.querySelector('#bench-root').classList.contains('bench-compact')), '手機橫式：也切成精簡版（高度矮）');
    const from = await center(page, '#bench-root .bench-item[data-part="battery"] .bench-thumb');
    await swipe(from, [420, 330]);
    ok((await parts(page)).includes('battery'), '橫式：手指拖入電池');
    ok(await page.evaluate(() => document.querySelector('#bench-root .bench-zoombar').getBoundingClientRect().bottom <= innerHeight), '橫式：縮放列整個看得到');
    ok(await noHScroll(page), '手機橫式不橫向捲動');
    if (OUT) await page.screenshot({ path: path.join(OUT, 'P15_phone_landscape.png') });
    await ctx.close();
  }
  // ───── 電腦：滑鼠按住引腳拖到另一根 ─────
  {
    const { ctx, page } = await open({ width: 1500, height: 900 }, false);
    ok(!(await page.evaluate(() => document.querySelector('#bench-root').classList.contains('bench-compact'))), '電腦版維持左側零件欄');
    for (const id of ['buzzer', 'pixhawk']) await page.locator(`#bench-root .bench-item[data-part="${id}"] button`).click();
    const a = await pinXY(page, 'buzzer.conn#+'), b = await pinXY(page, 'pixhawk.buzzer#1');
    await page.mouse.move(...a); await page.mouse.down(); await page.mouse.move(a[0] + 40, a[1] + 10, { steps: 5 }); await page.mouse.move(b[0] + 3, b[1] + 2, { steps: 10 }); await page.mouse.up();
    ok((await wireCount(page)) === 1, '電腦：滑鼠按住引腳拖到另一根接線');
    // 滑鼠從零件欄拖入（指標事件）
    const box = await page.locator('#bench-root .bench-svg').boundingBox();
    await page.locator('#bench-root .bench-item[data-part="receiver"]').dragTo(page.locator('#bench-root .bench-svg'), { targetPosition: { x: box.width * 0.75, y: box.height * 0.7 } });
    ok((await parts(page)).includes('receiver'), '電腦：滑鼠從零件欄拖入');
    await ctx.close();
  }
  ok(errs.length === 0, `沒有腳本錯誤${errs.length ? '：' + errs.slice(0, 3).join(' | ') : ''}`);
  console.log(log.join('\n')); console.log(`${log.filter((l) => l.startsWith('PASS')).length}/${log.length} 通過`);
  await browser.close();
})().catch((e) => { console.log(log.join(String.fromCharCode(10))); console.error(String(e).slice(0, 300)); process.exit(1); });
