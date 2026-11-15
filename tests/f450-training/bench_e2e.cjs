// P12 零件組裝接線工作台端對端驗收：
// 從零件欄拖入、＋加入、平移縮放、拖曳與旋轉零件、刪除、點引腳接線、短路上電「砰」、全部接對上電通過、成績單、考核、草稿保留
// 頁面用 Playwright 攔截請求提供，不啟動伺服器。
// 用法：set PLAYWRIGHT_PATH=<playwright 套件路徑> 後執行 node tests/f450-training/bench_e2e.cjs <輸出資料夾>
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
  const R = '#wire2d .w2-pin-root';
  const btn = (t) => page.locator(`${R} .bench-tools button`, { hasText: t });
  const parts = () => P((r) => [...document.querySelectorAll(`${r} .bench-part`)].map((g) => g.dataset.part), R);
  const wireCount = () => page.locator(`${R} [data-wire]`).count();
  const pin = (id) => page.locator(`${R} [data-pin="${id}"] circle`);
  const wire = async (a, b) => { await pin(a).click({ force: true }); await pin(b).click({ force: true }); };
  const total = () => P(() => Number(document.querySelector('#train-session .ts-total b')?.textContent));
  const report = () => P((r) => document.querySelector(`${r} .bench-report`)?.textContent || '', R);
  const snap = (n) => page.locator(`${R}`).screenshot({ path: path.join(OUT, n), timeout: 90000 }).catch(() => {});

  // 1) 進入工作台：一開始是空的，左邊零件欄 16 項
  await P(() => localStorage.removeItem('f450twin-bench-v1'));
  await page.locator('#wire2d-enter').click(); await page.waitForSelector('#wire2d .w2-root .w2-port');
  await page.locator('#wire2d [data-level="pin"]').click(); await page.waitForSelector(`${R} .bench-item`);
  ok((await page.locator(`${R} .bench-item`).count()) === 16, '零件欄有 16 項零件');
  ok((await parts()).length === 0, '工作區一開始是空的（零件要自己拖進來）');
  const txt = await P((r) => document.querySelector(r).textContent, R);
  ok(txt.includes('20A 電調') && txt.includes('2212 馬達') && !txt.includes('30A'), '電調標 20A、馬達標 2212');
  ok(txt.includes('CC-BY-SA 3.0'), '標示 Pixhawk 開源硬體授權');
  // 2) 從零件欄拖入 Pixhawk（HTML 拖放）
  const box = await page.locator(`${R} .bench-svg`).boundingBox();
  await page.locator(`${R} .bench-item[data-part="pixhawk"]`).dragTo(page.locator(`${R} .bench-svg`), { targetPosition: { x: box.width / 2, y: box.height / 2 } });
  ok((await parts()).includes('pixhawk'), '從零件欄拖入 Pixhawk');
  ok(await P((r) => document.querySelector(`${r} .bench-item[data-part="pixhawk"]`).classList.contains('placed'), R), '零件欄標示 Pixhawk 已放入');
  // 3) 用 ＋ 加入 GPS，拖曳移動、旋轉
  await page.locator(`${R} .bench-item[data-part="gps"] button`).click();
  ok((await parts()).includes('gps'), '按 ＋ 加入 GPS');
  const tf0 = await P((r) => document.querySelector(`${r} .bench-part[data-part="gps"]`).getAttribute('transform'), R);
  const g = await page.locator(`${R} .bench-part[data-part="gps"] > rect`).first().boundingBox();
  await page.mouse.move(g.x + 20, g.y + 20); await page.mouse.down(); await page.mouse.move(g.x + 120, g.y + 60, { steps: 5 }); await page.mouse.up();
  const tf1 = await P((r) => document.querySelector(`${r} .bench-part[data-part="gps"]`).getAttribute('transform'), R);
  ok(tf0 !== tf1, `拖曳零件會移動（${tf0} → ${tf1}）`);
  await btn('旋轉').click();
  ok((await P((r) => document.querySelector(`${r} .bench-part[data-part="gps"]`).getAttribute('transform'), R)).includes('rotate(90'), '選取後可旋轉 90°');
  // 4) 平移與縮放
  const w0 = await P((r) => document.querySelector(`${r} .bench-world`).getAttribute('transform'), R);
  await page.mouse.move(box.x + 30, box.y + box.height - 30); await page.mouse.down(); await page.mouse.move(box.x + 130, box.y + box.height - 80, { steps: 5 }); await page.mouse.up();
  const w1 = await P((r) => document.querySelector(`${r} .bench-world`).getAttribute('transform'), R);
  ok(w0 !== w1, '拖曳空白處可平移工作區');
  const z0 = await P((r) => document.querySelector(`${r} .bench-zoom`).textContent, R);
  await btn('＋').click();
  ok(z0 !== await P((r) => document.querySelector(`${r} .bench-zoom`).textContent, R), '可放大縮小');
  // 5) 刪除：選取 GPS → 🗑 → 回到零件欄
  await page.locator(`${R} .bench-part[data-part="gps"] > rect`).first().click({ force: true });
  await btn('刪除').click();
  ok(!(await parts()).includes('gps'), '刪除零件後回到零件欄');
  // 6) 放入電源模組與電池，接出短路 → 上電「砰」
  for (const id of ['power_module', 'battery']) await page.locator(`${R} .bench-item[data-part="${id}"] button`).click();
  await btn('適配').click();
  await wire('battery.xt60#+', 'power_module.in#+'); await wire('battery.xt60#-', 'power_module.in#-');
  await wire('power_module.fc#1', 'pixhawk.power#5');
  ok((await wireCount()) === 3, '點引腳接出 3 根線');
  await btn('上電測試').click();
  ok((await page.locator(`${R} .bench-boom`).count()) === 1 && (await report()).includes('砰'), '短路上電：出現爆炸「砰！」與說明');
  await snap('P12_bench_bang.png');
  // 7) 選取那根短路線刪掉
  await page.locator(`${R} [data-wire]`).last().locator('.hit').click({ force: true });
  await btn('刪除').click();
  ok((await wireCount()) === 2, '選取導線後可刪除');
  // 8) 放入其他全部零件並照正確接法接滿 54 根 → 上電通過、成績單計分
  for (const id of await P((r) => [...document.querySelectorAll(`${r} .bench-item:not(.placed)`)].map((i) => i.dataset.part), R)) await page.locator(`${R} .bench-item[data-part="${id}"] button`).click();
  ok((await parts()).length === 16, '16 個零件都放進工作區');
  await btn('清除全部').click();   // 清掉後用示範把零件放到標準位置
  await btn('完整示範').click(); await page.waitForFunction((r) => /示範完成/.test(document.querySelector(`${r} .w2-status`).textContent), R, { timeout: 60000 });
  await btn('清除示範').click();
  const before = await total();
  for (const e of EXPECTED_PIN_WIRES) await wire(e.a, e.phase ? e.b.replace('#null', `#${e.a.split('#')[1]}`) : e.b);
  await btn('檢查接線').click();
  ok((await report()).includes('全部 54 根都接對了'), '54 根全部接對');
  await btn('上電測試').click();
  ok((await report()).includes('上電測試通過') && (await page.locator(`${R} .bench-boom`).count()) === 0, '全部接對：上電測試通過、不爆炸');
  const after = await total();
  ok(after > before && after >= 50, `成績單依工作台接線計分（${before} → ${after}）`);
  await snap('P12_bench_all_ok.png');
  // 9) 重新整理後草稿保留
  await page.reload(); await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 90000 });
  await page.locator('#wire2d-enter').click(); await page.locator('#wire2d [data-level="pin"]').click(); await page.waitForSelector(`${R} .bench-part`);
  ok((await wireCount()) === 54 && (await parts()).length === 16, '重新整理後零件與 54 根線保留');
  // 10) 考核：空白開始、不能檢查／示範／上電；回到練習還原
  await page.locator('#train-session .ts-modes button', { hasText: '考核' }).click(); await page.waitForTimeout(300);
  ok((await parts()).length === 0 && (await wireCount()) === 0, '考核：工作台從空白開始');
  ok(await P((r) => [...document.querySelectorAll(`${r} .bench-tools button`)].filter((b) => /檢查|示範|上電/.test(b.textContent)).every((b) => b.hidden), R), '考核：不能檢查、示範、上電');
  await page.locator('#train-session .ts-modes button', { hasText: '練習' }).click(); await page.waitForTimeout(300);
  ok((await wireCount()) === 54, '回到練習：草稿還原');
  // 11) 手機寬度：零件欄移到上方
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  ok(await P(() => document.documentElement.scrollWidth <= 400), '手機寬度沒有橫向捲動');
  await snap('P12_bench_mobile.png');
  ok(errs.length === 0, `沒有腳本錯誤 ${errs.slice(0, 2).join(' | ')}`);
  await browser.close();
  console.log(log.join('\n'));
})().catch((e) => { console.log(log.join('\n')); console.error(e); process.exit(2); });
