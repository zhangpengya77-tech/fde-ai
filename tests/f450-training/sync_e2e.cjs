// P4 2D／3D 同步端對端驗收（file:// 載入，不啟動伺服器）
// 用法：set PLAYWRIGHT_PATH=<playwright 套件路徑> 後執行 node tests/f450-training/sync_e2e.cjs <截圖輸出資料夾>
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('path');
const OUT = process.argv[2];
const URL = require('url').pathToFileURL(path.join(__dirname, '../../f450-twin/index.html')).href;
const log = [];
const snap = async (fn) => { try { await fn(); } catch (e) { log.push(`SKIP 截圖逾時（只影響報告用截圖，不影響功能檢查）：${String(e.message).split(String.fromCharCode(10))[0]}`); } };
const ok = (c, m) => { log.push(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };

(async () => {
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(`${URL}?fx=0&syncDebug=1&practiceDebug=1`, { timeout: 150000 });
  await page.waitForFunction(() => !document.getElementById('loading') && window.__f450Sync, null, { timeout: 150000 });
  const P = (fn, ...a) => page.evaluate(fn, ...a);
  const shot = async (sel, file) => { await P((q) => document.querySelector(q).scrollIntoView({ block: 'start' }), sel); await page.waitForTimeout(500); const r = await P((q) => { const b = document.querySelector(q).getBoundingClientRect(); return { x: b.x, y: Math.max(0, b.y), width: b.width, height: Math.min(b.height, innerHeight - Math.max(0, b.y)) }; }, sel); await snap(() => page.screenshot({ path: `${OUT}/${file}`, clip: r, timeout: 90000 })); };
  const S = () => P(() => ({ hot: window.__f450Sync.hot(), lines: window.__f450Sync.lines(), pulses: window.__f450Sync.pulses(), cap: window.__f450Sync.caption() }));
  const port = (id) => page.locator(`#wire2d [data-port="${id}"] circle`);
  const connect = async (a, b) => { await port(a).click({ force: true }); await port(b).click({ force: true }); await page.waitForTimeout(400); };
  await page.waitForTimeout(800);

  // 0) 3D 接線圖模式的高亮，不會被打開 2D 清掉
  await page.locator('[data-mode="wiring"]').first().click();
  await page.locator('#wiring-table tbody tr').first().click();
  const before = (await S()).hot.length;
  await page.locator('#wire2d-enter').click(); await page.waitForSelector('#wire2d .w2-port');
  ok(before > 0 && (await S()).hot.length === before, `打開 2D 不會清掉 3D 接線圖的高亮（${before} 個）`);
  await page.locator('[data-mode="explode"]').first().click();
  await page.locator('#wire2d .w2-tools button', { hasText: '全部清除' }).click().catch(() => {});

  // 1) 2D 連一條線（連完自動選取）→ 3D 兩端發光、畫出線與光點
  await connect('esc_fr.signal', 'pixhawk.main_out_1');
  await page.waitForFunction(() => window.__f450Sync.pulses() === 3, null, { timeout: 8000 }).catch(() => {});
  let s = await S();
  ok(s.hot.some((n) => n.startsWith('ESC FR')) && s.hot.some((n) => n.startsWith('Pixhawk 248')), `2D 選線 → 3D 高亮 ESC 右前與 Pixhawk [${s.hot.join(', ')}]`);
  ok(s.lines === 1 && s.pulses === 3, `2D 選線 → 3D 畫出 1 條線與 3 個光點（${s.lines}／${s.pulses}）`);
  ok(s.cap.startsWith('2D 選取'), `3D 說明條：${s.cap}`);
  await shot('#viewer', 'P4_3d_from_2d_wire.png');

  // 2) 2D 點元件框：3D 模型沒有的零件要說清楚
  await page.locator('#wire2d [data-comp="safety_switch"] rect').click({ force: true }); await page.waitForTimeout(400);
  s = await S();
  ok(s.hot.length === 0 && s.cap.includes('3D 模型沒有：安全開關'), `點安全開關 → 3D 說明沒有這個零件 [${s.cap}]`);
  await page.locator('#wire2d [data-comp="gps"] rect').click({ force: true }); await page.waitForTimeout(800);
  s = await S();
  ok(s.hot.some((n) => n.startsWith('GPS M8N')) && s.lines === 0, `點 GPS 元件 → 3D 高亮 GPS，沒有線`);
  // 點畫布空白 → 取消，3D 也清除
  await page.locator('#wire2d svg.w2-svg').click({ position: { x: 5, y: 5 }, force: true });
  s = await S();
  ok(s.hot.length === 0 && s.cap === '', '2D 取消選取 → 3D 高亮與說明清除');

  // 3) 3D → 2D：零件清單選 ESC → 2D 框出四顆 ESC
  await page.locator('#part-list .part[data-key="esc"]').click();
  const framed = await P(() => [...document.querySelectorAll('#wire2d .w2-comp.focus3d')].map((g) => g.dataset.comp).sort());
  ok(JSON.stringify(framed) === JSON.stringify(['esc_fl', 'esc_fr', 'esc_rl', 'esc_rr']), `零件清單選 ESC → 2D 框出 ${framed.join(',')}`);
  ok((await P(() => document.querySelector('#wire2d .w2-status').textContent)).startsWith('3D 選取'), '2D 狀態列顯示 3D 選取');
  // 3D 直接點 Pixhawk
  await P(() => document.getElementById('viewer').scrollIntoView({ block: 'start' })); await page.waitForTimeout(500);
  const xy = await P(() => window.__f450Sync.screenOf('pixhawk'));
  await page.mouse.click(xy[0], xy[1]);
  const framed2 = await P(() => [...document.querySelectorAll('#wire2d .w2-comp.focus3d')].map((g) => g.dataset.comp));
  ok(framed2.length === 1 && framed2[0] === 'pixhawk', `3D 點 Pixhawk → 2D 只框出 Pixhawk [${framed2}]`);
  await shot('#wire2d .w2-scroll', 'P4_2d_from_3d.png');

  // 4) 在 3D 顯示我的接線：接 3 條（1 對 2 錯）→ 檢查 → 3D 畫出，綠紅分明
  await connect('receiver.sbus', 'pixhawk.rc_in');
  await connect('esc_rl.signal', 'pixhawk.main_out_4');          // 錯：左後應接 MAIN OUT 2
  await connect('safety_switch.conn', 'pixhawk.switch');           // 3D 沒有安全開關：不畫
  await page.locator('#wire2d button', { hasText: '檢查接線' }).click();
  await page.locator('#w2-show3d').check();
  await page.waitForTimeout(1200);
  s = await S();
  ok(s.lines === 3, `勾選後 3D 畫出 3 條可顯示的線（共 4 條，安全開關那條 3D 沒有零件）：${s.lines}`);
  await shot('#viewer', 'P4_3d_my_wires.png');
  await page.locator('#w2-show3d').uncheck();
  ok((await S()).lines <= 1, '取消勾選 → 只剩目前選取的線');

  // 5) 組裝練習中：還沒裝的零件，說明「尚未組裝」
  await page.locator('#practice-enter').click(); await page.waitForTimeout(500);
  await page.locator('#wire2d [data-comp="esc_fr"] rect').click({ force: true }); await page.waitForTimeout(400);
  s = await S();
  ok(s.cap.includes('尚未組裝'), `組裝練習中選 ESC 右前 → ${s.cap}`);
  await page.locator('#strip-practice .pr-tray button', { hasText: '下中心板' }).click();
  ok((await P(() => window.__f450Practice.screen('bottom_plate').status)) === 'held', '同步不影響組裝練習的拿取');
  await page.locator('[data-mode="explode"]').first().click({ force: true }); await page.waitForTimeout(600);
  s = await S();
  ok(!s.cap.includes('看不到') && s.cap.startsWith('2D 選取'), `切回爆炸結構後說明條更新、不留過時的「看不到」[${s.cap}]`);
  ok(s.hot.some((n) => n.startsWith('ESC FR')), '切換模式後 2D 選取的零件仍然發光');

  // 6) 其他模式仍正常
  for (const m of ['whole', 'assembly', 'wiring', 'size', 'explode']) {
    await page.locator(`[data-mode="${m}"]`).first().click(); await page.waitForTimeout(300);
    ok(await P((mm) => !document.getElementById(`strip-${mm}`).hidden, m), `3D ${m} 模式正常`);
  }
  ok(errs.length === 0, `沒有腳本錯誤 ${errs.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(log.join('\n'));
})().catch((e) => { console.log(log.join('\n')); console.error(e); process.exit(2); });
