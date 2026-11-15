// P12／P13 零件組裝接線工作台端對端驗收：
// 預設分頁、「＋ 配件」彈出零件欄、拖入與＋加入、平移縮放、拖曳與旋轉、刪除、復原、點引腳接線、
// 短路上電「砰」、全部接對上電通過、成績單、匯出匯入、深淺色、考核、草稿保留、手機寬度
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
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
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
  const act = (n) => page.locator(`${R} [data-act="${n}"]`);
  const parts = () => P((r) => [...document.querySelectorAll(`${r} .bench-part`)].map((g) => g.dataset.part), R);
  const wireCount = () => page.locator(`${R} [data-wire]`).count();
  const pin = (id) => page.locator(`${R} [data-pin="${id}"] circle.pin-dot`);
  const wire = async (a, b) => { await pin(a).click({ force: true }); await pin(b).click({ force: true }); };
  const total = () => P(() => Number(document.querySelector('#train-session .ts-total b')?.textContent));
  const report = () => P((r) => document.querySelector(`${r} .bench-report`)?.textContent || '', R);
  const tf = (id) => P(([r, id]) => document.querySelector(`${r} .bench-part[data-part="${id}"]`)?.getAttribute('transform'), [R, id]);
  const palOpen = () => P((r) => !document.querySelector(`${r} .bench-palette`).hidden, R);
  const snap = (n) => page.locator(R).screenshot({ path: path.join(OUT, n), timeout: 90000 }).catch(() => {});

  // 1) 進入 2D 接線：預設就是工作台，工作區空白，零件欄自動打開
  await page.locator('#wire2d-enter').click(); await page.waitForSelector(`${R} .bench-item`);
  ok(await P((r) => !document.querySelector(r).hidden && document.querySelector('#wire2d .w2-root').hidden, R), '預設進入零件組裝接線工作台');
  ok((await parts()).length === 0 && await palOpen(), '工作區一開始是空的，零件欄已打開');
  ok((await page.locator(`${R} .bench-item`).count()) === 16 && (await page.locator(`${R} .bench-item .bench-thumb`).count()) === 16, '零件欄 16 項，每項有零件圖');
  const txt = await P((r) => document.querySelector(r).textContent, R);
  ok(txt.includes('20A 電調') && txt.includes('2212 馬達') && !txt.includes('30A'), '電調標 20A、馬達標 2212');
  ok(txt.includes('CC-BY-SA 3.0'), '標示 Pixhawk 開源硬體授權');
  await snap('P13_bench_empty.png');
  // 2) ＋ 配件 可開關零件欄
  await act('parts').click(); ok(!(await palOpen()), '「＋ 配件」可關閉零件欄');
  await act('parts').click(); ok(await palOpen(), '「＋ 配件」可打開零件欄');
  // 3) 從零件欄拖入 Pixhawk
  const box = await page.locator(`${R} .bench-svg`).boundingBox();
  await page.locator(`${R} .bench-item[data-part="pixhawk"]`).dragTo(page.locator(`${R} .bench-svg`), { targetPosition: { x: box.width * 0.6, y: box.height / 2 } });
  ok((await parts()).includes('pixhawk'), '從零件欄拖入 Pixhawk');
  ok(await P((r) => document.querySelector(`${r} .bench-item[data-part="pixhawk"]`).classList.contains('placed'), R), '零件欄標示 Pixhawk 已放入');
  // 4) ＋ 加入 GPS，拖曳移動、旋轉、復原
  await page.locator(`${R} .bench-item[data-part="gps"] button`).click();
  ok((await parts()).includes('gps'), '按 ＋ 加入 GPS');
  await act('parts').click();   // 收起零件欄，免得蓋住零件
  const tf0 = await tf('gps');
  const g = await page.locator(`${R} .bench-part[data-part="gps"] .bench-selbox`).boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + 20); await page.mouse.down(); await page.mouse.move(g.x + g.width / 2 + 90, g.y + 60, { steps: 5 }); await page.mouse.up();
  const tf1 = await tf('gps');
  ok(tf0 !== tf1, `拖曳零件會移動（${tf0} → ${tf1}）`);
  await act('rotate').click();
  ok((await tf('gps')).includes('rotate(90'), '選取後可旋轉 90°');
  await act('undo').click(); await act('undo').click();
  ok((await tf('gps')) === tf0, '「↶」可一步一步復原（旋轉、移動）');
  // 5) 平移與縮放
  const w0 = await P((r) => document.querySelector(`${r} .bench-world`).getAttribute('transform'), R);
  await page.mouse.move(box.x + box.width - 160, box.y + box.height - 120); await page.mouse.down(); await page.mouse.move(box.x + box.width - 60, box.y + box.height - 170, { steps: 5 }); await page.mouse.up();
  ok(w0 !== await P((r) => document.querySelector(`${r} .bench-world`).getAttribute('transform'), R), '拖曳空白處可平移工作區');
  const z0 = await P((r) => document.querySelector(`${r} .bench-zoom`).textContent, R);
  await act('zoom-in').click();
  ok(z0 !== await P((r) => document.querySelector(`${r} .bench-zoom`).textContent, R), '右下角可放大縮小');
  // 6) 刪除：選取 GPS → 🗑 → 回到零件欄
  await act('fit').click();
  await page.locator(`${R} .bench-part[data-part="gps"] .bench-selbox`).click({ force: true });
  await act('delete').click();
  ok(!(await parts()).includes('gps'), '刪除零件後回到零件欄');
  // 7) 放入電源模組與電池，接出短路 → 上電「砰」
  await act('parts').click();
  for (const id of ['power_module', 'battery']) await page.locator(`${R} .bench-item[data-part="${id}"] button`).click();
  await act('parts').click();
  await wire('battery.xt60#+', 'power_module.in#+'); await wire('battery.xt60#-', 'power_module.in#-');
  await wire('power_module.fc#1', 'pixhawk.power#5');
  ok((await wireCount()) === 3, '點引腳接出 3 根線');
  await act('power').click();
  ok((await page.locator(`${R} .bench-boom`).count()) === 1 && (await report()).includes('砰'), '短路上電：出現爆炸「砰！」與說明');
  await snap('P13_bench_bang.png');
  await page.locator(`${R} [data-wire]`).last().locator('.hit').click({ force: true });
  await act('delete').click();
  ok((await wireCount()) === 2, '選取導線後可刪除');
  // 8) 完整接線示例把零件放好，再照正確接法接滿 54 根 → 檢查、上電通過、成績單
  await act('demo').click(); await page.waitForFunction((r) => /示例完成/.test(document.querySelector(`${r} .w2-status`).textContent), R, { timeout: 60000 });
  ok((await parts()).length === 16, '完整接線示例會放好 16 個零件');
  await act('demo').click();
  const before = await total();
  for (const e of EXPECTED_PIN_WIRES) {
    const b = e.phase ? e.b.replace('#null', `#${e.a.split('#')[1]}`) : e.b;
    if (await page.locator(`${R} [data-pin="${e.a}"].used`).count() && await page.locator(`${R} [data-pin="${b}"].used`).count()) continue;   // 電池那兩根已接
    await wire(e.a, b);
  }
  await act('check').click();
  ok((await report()).includes('全部 54 根都接對了'), '54 根全部接對');
  await act('power').click();
  ok((await report()).includes('上電測試通過') && (await page.locator(`${R} .bench-boom`).count()) === 0, '全部接對：上電測試通過、不爆炸');
  const after = await total();
  ok(after > before && after >= 50, `成績單依工作台接線計分（${before} → ${after}）`);
  await snap('P13_bench_all_ok.png');
  // 9) 匯出、清除、匯入
  await act('file').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), act('export').click()]);
  const file = path.join(OUT, 'P13_export.json'); await dl.saveAs(file);
  ok(JSON.parse(fs.readFileSync(file, 'utf8')).wires.length === 54, '匯出接線檔（54 根）');
  await act('file').click(); await act('clear').click();
  ok((await parts()).length === 0, '清除全部');
  await page.locator(`${R} input[type=file]`).setInputFiles(file);
  await page.waitForFunction((r) => document.querySelectorAll(`${r} [data-wire]`).length === 54, R, { timeout: 10000 }).catch(() => {});
  ok((await wireCount()) === 54 && (await parts()).length === 16, '匯入接線檔還原 16 個零件、54 根線');
  // 10) 深淺色切換
  await act('theme').click();
  ok(await P((r) => document.querySelector(r).classList.contains('bench-dark'), R), '可切深色');
  await snap('P13_bench_dark.png');
  await act('theme').click();
  ok(await P((r) => !document.querySelector(r).classList.contains('bench-dark'), R), '可切回淺色');
  // 11) 重新整理後草稿保留、仍在工作台分頁
  await page.reload(); await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 90000 });
  await page.locator('#wire2d-enter').click(); await page.waitForSelector(`${R} .bench-part`);
  ok((await wireCount()) === 54 && (await parts()).length === 16, '重新整理後零件與 54 根線保留');
  // 12) 考核：空白開始、不能檢查／示例／上電／檔案；回到練習還原
  await page.locator('#train-session .ts-modes button', { hasText: '考核' }).click(); await page.waitForTimeout(300);
  ok((await parts()).length === 0 && (await wireCount()) === 0, '考核：工作台從空白開始');
  ok(await P((r) => ['check', 'demo', 'power', 'file'].every((a) => document.querySelector(`${r} [data-act="${a}"]`).hidden), R), '考核：不能檢查、示例、上電、匯入');
  await page.locator('#train-session .ts-modes button', { hasText: '練習' }).click(); await page.waitForTimeout(300);
  ok((await wireCount()) === 54, '回到練習：草稿還原');
  // 13) 切到接頭級再切回
  await page.locator('#wire2d [data-level="base"]').click(); await page.waitForSelector('#wire2d .w2-root .w2-port');
  await page.locator('#wire2d [data-level="pin"]').click(); await page.waitForTimeout(200);
  ok(await P((r) => !document.querySelector(r).hidden, R), '接頭級與工作台可來回切換');
  // 14) 手機寬度
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
  ok(await P(() => document.documentElement.scrollWidth <= 400), '手機寬度沒有橫向捲動');
  await act('parts').click(); await page.waitForTimeout(200);
  await page.locator(R).screenshot({ path: path.join(OUT, 'P13_bench_mobile_palette.png') }).catch(() => {});
  await act('parts').click();
  await snap('P13_bench_mobile.png');
  ok(errs.length === 0, `沒有腳本錯誤 ${errs.slice(0, 2).join(' | ')}`);
  await browser.close();
  console.log(log.join('\n'));
})().catch((e) => { console.log(log.join('\n')); console.error(e); process.exit(2); });
