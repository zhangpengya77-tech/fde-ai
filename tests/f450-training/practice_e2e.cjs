// P2 3D 組裝練習端對端驗收：真的用滑鼠拖曳每一件零件（file:// 載入，不啟動伺服器）
// 用法：set PLAYWRIGHT_PATH=<playwright 套件路徑> 後執行 node tests/f450-training/practice_e2e.cjs <截圖輸出資料夾>
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = process.argv[2];
const URL = require('url').pathToFileURL(require('path').join(__dirname, '../../f450-twin/index.html')).href;
const ORDER = ['bottom_plate', 'esc_fr', 'esc_fl', 'esc_rl', 'esc_rr', 'arm_fr', 'arm_fl', 'arm_rl', 'arm_rr', 'motor_fr', 'motor_fl', 'motor_rl', 'motor_rr',
  'top_plate', 'power_module', 'power_lead', 'battery_tray', 'leg_fr', 'leg_fl', 'leg_rl', 'leg_rr', 'pixhawk', 'receiver', 'gps', 'harness', 'battery',
  'prop_fr', 'prop_fl', 'prop_rl', 'prop_rr'];
(async () => {
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const log = [];
  const ok = (c, m) => { log.push(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
  for (const [name, vp] of [['desk', { width: 1440, height: 1000 }], ['mob', { width: 390, height: 844, isMobile: true, hasTouch: false }]]) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(`${URL}?mode=practice&practiceDebug=1&fx=0`);
    await page.waitForFunction(() => !document.getElementById('loading') && window.__f450Practice, null, { timeout: 150000 });
    await page.waitForTimeout(1500);
    const P = (fn, ...a) => page.evaluate(fn, ...a);
    ok(await P(() => !document.getElementById('strip-practice').hidden), `${name}: 練習面板顯示`);
    ok(await P(() => [...document.querySelectorAll('#viewer canvas')].length === 1), `${name}: 3D 畫布存在`);
    { const sl = await P(() => ['prop_fr','prop_fl','prop_rl','prop_rr'].map((i) => window.__f450Practice.screen(i).slots[i].map(Math.round).join(',')));
      ok(new Set(sl).size === 4, `${name}: 四個槳位在螢幕上位置不同 ${sl.join(' ')}`); }
    const trayBtn = (zh) => page.locator('#strip-practice .pr-tray button', { hasText: zh }).first();
    async function drag(id, slot) {
      const s = await P((i) => window.__f450Practice.screen(i), id);
      const [tx, ty] = s.slots[slot || id];
      await page.mouse.move(s.held[0], s.held[1]); await page.mouse.down();
      await page.mouse.move((s.held[0] + tx) / 2, (s.held[1] + ty) / 2, { steps: 4 });
      await page.mouse.move(tx, ty, { steps: 4 }); await page.mouse.up();
      await page.waitForTimeout(80);
    }
    // 1) 順序錯：先拿機臂
    await trayBtn('機臂 右前').click();
    ok((await P(() => window.__f450Practice.message())).startsWith('順序錯'), `${name}: 先拿機臂 → 順序錯提示`);
    if (name === 'desk') {
      // 2) 依序拖曳全部零件；Pixhawk 先故意不轉 → 方向錯 → 旋轉兩次修正；槳葉先試錯位置
      for (const id of ORDER) {
        const btnText = { bottom_plate: '下中心板', esc_fr: 'ESC 右前', esc_fl: 'ESC 左前', esc_rl: 'ESC 左後', esc_rr: 'ESC 右後', arm_fr: '機臂 右前', arm_fl: '機臂 左前', arm_rl: '機臂 左後', arm_rr: '機臂 右後',
          motor_fr: '馬達 右前', motor_fl: '馬達 左前', motor_rl: '馬達 左後', motor_rr: '馬達 右後', top_plate: '上中心板', power_module: '電源模組', power_lead: 'XT60', battery_tray: '電池托板',
          leg_fr: '腳架 右前', leg_fl: '腳架 左前', leg_rl: '腳架 左後', leg_rr: '腳架 右後', pixhawk: 'Pixhawk', receiver: 'R9DS', gps: 'GPS', harness: '線材', battery: '4S 電池' }[id];
        if (id.startsWith('prop_')) {
          await trayBtn(id === 'prop_fr' || id === 'prop_rl' ? '槳葉 CCW' : '槳葉 CW').click();
        } else await trayBtn(btnText).click();
        if (id === 'prop_fr') {   // 手上的是 CCW 槳，先拖到左前（CW 位置）
          await drag(id, 'prop_fl');
          { const mm = await P(() => window.__f450Practice.message()); ok(mm.startsWith('轉向錯'), `${name}: CCW 槳拖到 CW 位置 → 轉向錯 [${mm}] ${JSON.stringify(await P(() => window.__f450Practice.screen('prop_fr')))}`); }
        }
        if (id === 'pixhawk') {
          await drag(id);
          ok((await P(() => window.__f450Practice.screen('pixhawk').status)) === 'wrong_orientation', `${name}: Pixhawk 沒轉正就裝 → 方向錯`);
          await page.screenshot({ path: `${OUT}/P2_practice_wrong_orientation.png` });
          await page.locator('#strip-practice button', { hasText: '旋轉' }).click();
          await page.locator('#strip-practice button', { hasText: '旋轉' }).click();
          ok((await P(() => window.__f450Practice.screen('pixhawk').status)) === 'installed', `${name}: 旋轉 180° 後 Pixhawk 已安裝`);
          continue;
        }
        if (id === 'gps') {   // GPS 先轉正再拖
          await page.locator('#strip-practice button', { hasText: '旋轉' }).click();
          await page.locator('#strip-practice button', { hasText: '旋轉' }).click();
        }
        const cur = await P((i) => window.__f450Practice.screen(i), id);
        await drag(id, id.startsWith('prop_') ? Object.keys(cur.slots).find((k) => k === id) || Object.keys(cur.slots)[0] : id);
        const st = await P((i) => window.__f450Practice.screen(i).status, id);
        ok(st === "installed", `${name}: ${id} 拖曳後 ${st} ${st === "installed" ? "" : (await P(() => window.__f450Practice.message())) + JSON.stringify(cur)}`);
        { const vis = await P((i) => window.__f450Practice.visibleNodes(i), id); ok(vis > 0, `${name}: ${id} 安裝後看得到（${vis} 個節點）`); }
        if (id === 'motor_rr') await page.screenshot({ path: `${OUT}/P2_practice_midway.png` });
      }
      const rep = await P(() => window.__f450Practice.report());
      { const all = await P(() => window.__f450Practice.visibleAll()); ok(all === 59, `${name}: 組完後 59 個節點全部看得到（${all}）`); }
      ok(rep.complete, `${name}: 全部完成 ${rep.installed}/${rep.total}，錯誤 ${rep.errorCount} 次 ${JSON.stringify(rep.errors)}`);
      await page.screenshot({ path: `${OUT}/P2_practice_complete.png` });
      // 3) 切回其他模式，原有功能仍正常
      await page.locator('[data-mode="explode"]').first().click(); await page.waitForTimeout(1500);
      ok(await P(() => document.getElementById('strip-practice').hidden && !document.getElementById('strip-explode').hidden), `${name}: 切回爆炸結構`);
      await page.screenshot({ path: `${OUT}/P2_back_to_explode.png` });
      for (const m of ['whole', 'assembly', 'wiring', 'size']) {
        await page.locator(`[data-mode="${m}"]`).first().click(); await page.waitForTimeout(400);
        ok(await P((mm) => !document.getElementById(`strip-${mm}`).hidden, m), `${name}: 切到 ${m}`);
      }
      // 4) 重新開始
      await page.locator('#practice-enter').click(); await page.waitForTimeout(500);
      await page.locator('#strip-practice button', { hasText: '重新開始' }).click();
      ok((await P(() => window.__f450Practice.report())).installed === 0, `${name}: 重新開始後歸零`);
    } else {
      await trayBtn('下中心板').click();
      await drag('bottom_plate');
      ok((await P(() => window.__f450Practice.screen('bottom_plate').status)) === 'installed', `${name}: 手機版拖曳下中心板安裝`);
      await page.screenshot({ path: `${OUT}/P2_practice_mobile.png`, fullPage: false });
    }
    ok(errs.length === 0, `${name}: 沒有腳本錯誤 ${errs.slice(0, 3).join(' | ')}`);
    await page.close();
  }
  await browser.close();
  console.log(log.join('\n'));
})().catch((e) => { console.error(e); process.exit(2); });
