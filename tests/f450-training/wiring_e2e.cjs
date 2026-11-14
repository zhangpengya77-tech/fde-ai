// P3 2D 接線練習端對端驗收：真的用滑鼠（與鍵盤）點接口連線（file:// 載入，不啟動伺服器）
// 用法：set PLAYWRIGHT_PATH=<playwright 套件路徑> 後執行 node tests/f450-training/wiring_e2e.cjs <截圖輸出資料夾>
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('path');
const OUT = process.argv[2];
const URL = require('url').pathToFileURL(path.join(__dirname, '../../f450-twin/index.html')).href;

const log = [];
(async () => {
  const { EXPECTED_WIRES } = await import(require('url').pathToFileURL(path.join(__dirname, '../../f450-twin/training/model.js')).href);
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ok = (c, m) => { log.push(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
  for (const [name, vp] of [['desk', { width: 1440, height: 1000 }], ['mob', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: name === 'mob' });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('dialog', (d) => d.accept());
    await page.goto(`${URL}?fx=0&lite=1`, { timeout: 150000 });
    await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 150000 });   // 等 3D 載完，避免軟體繪圖搶 CPU
    await page.locator('#wire2d-enter').click();
    await page.waitForSelector('#wire2d .w2-port');
    const P = (fn, ...a) => page.evaluate(fn, ...a);
    ok(await P(() => !document.getElementById('wire2d').hidden), `${name}: 按入口後顯示接線畫布`);
    ok((await page.locator('#wire2d .w2-port').count()) === 40, `${name}: 40 個接口`);
    ok((await page.locator('#wire2d .w2-comp').count()) === 16, `${name}: 16 個元件`);
    const port = (id) => page.locator(`#wire2d [data-port="${id}"] circle`);
    const tap = async (id) => { if (name === 'mob') await port(id).tap({ force: true }); else await port(id).click({ force: true }); };   // force：軟體繪圖時略過「穩定」等待
    const connect = async (a, b) => { await tap(a); await tap(b); };
    const check = async () => { await page.locator('#wire2d button', { hasText: '檢查接線' }).click(); return P(() => document.querySelector('#wire2d .w2-sum')?.textContent || ''); };

    if (name === 'desk') {
      // 1) 故意接錯：右前 ESC → MAIN OUT 2；XT60 → RC IN；ESC 電源紅黑對調
      await connect('esc_fr.signal', 'pixhawk.main_out_2');
      await connect('battery.xt60', 'pixhawk.rc_in');
      await connect('pdb.pad_fr', 'esc_fr.power');
      await page.locator('#wire2d button', { hasText: '紅黑對調' }).click();
      let sum = await check();
      const issues = await P(() => [...document.querySelectorAll('#wire2d .w2-issues li')].map((l) => l.textContent));
      ok(issues.some((t) => t.startsWith('接錯')), `${name}: 抓到接錯（MAIN OUT 2）`);
      ok(issues.some((t) => t.startsWith('接頭不合')), `${name}: 抓到接頭不合（XT60→RC IN）`);
      ok(issues.some((t) => t.startsWith('極性錯')), `${name}: 抓到極性錯`);
      ok(/缺線 \d+ 條/.test(sum), `${name}: 顯示缺線數 [${sum}]`);
      ok((await page.locator('#wire2d .w2-wire.bad').count()) === 3, `${name}: 3 條錯線標紅`);
      await page.locator('#wire2d button', { hasText: '顯示缺少' }).click();
      ok((await page.locator('#wire2d .w2-issues.hint li').count()) === 20, `${name}: 提示列出 20 條缺線`);
      await page.locator('#wire2d').screenshot({ path: `${OUT}/P3_wiring_errors.png`, timeout: 90000 });
      // 2) 刪除（選取線 → 刪除）、復原、全部清除
      await page.locator('#wire2d [data-wire]').first().dispatchEvent('click');
      await page.locator('#wire2d button', { hasText: '刪除這條線' }).click();
      ok((await page.locator('#wire2d [data-wire]').count()) === 2, `${name}: 刪除選取的線`);
      await page.locator('#wire2d button', { hasText: '復原' }).click();
      ok((await page.locator('#wire2d [data-wire]').count()) === 1, `${name}: 復原最後一條`);
      await page.locator('#wire2d button', { hasText: '全部清除' }).click();
      ok((await page.locator('#wire2d [data-wire]').count()) === 0, `${name}: 全部清除`);
      // 3) 鍵盤連一條（Tab 焦點 + Enter）
      await page.locator('#wire2d [data-port="receiver.sbus"]').focus(); await page.keyboard.press('Enter');
      await page.locator('#wire2d [data-port="pixhawk.rc_in"]').focus(); await page.keyboard.press('Enter');
      ok((await page.locator('#wire2d [data-wire]').count()) === 1, `${name}: 鍵盤連線`);
      // 4) 依正確接線全部接上（第一條已由鍵盤接好）
      for (const w of EXPECTED_WIRES) {
        if (w.from === 'receiver.sbus') continue;
        await connect(w.to, w.from);   // 反方向拉線也要算對
      }
      ok((await page.locator('#wire2d [data-wire]').count()) === 20, `${name}: 畫布上 20 條線`);
      sum = await check();
      ok(sum.startsWith('✓ 全部 20 條都接對了'), `${name}: 全部接對 [${sum}]`);
      ok((await page.locator('#wire2d .w2-wire.good').count()) === 20, `${name}: 20 條線標綠`);
      await page.locator('#wire2d').screenshot({ path: `${OUT}/P3_wiring_all_correct.png`, timeout: 90000 });
      // 5) 重新整理後草稿還在
      await page.reload({ timeout: 150000 }); await page.locator('#wire2d-enter').click(); await page.waitForSelector('#wire2d [data-wire]');
      ok((await page.locator('#wire2d [data-wire]').count()) === 20, `${name}: 重新整理後草稿保留`);
      // 6) 3D 模式仍正常
      await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 150000 });
      for (const m of ['whole', 'assembly', 'wiring', 'size', 'explode']) {
        await page.locator(`[data-mode="${m}"]`).first().click(); await page.waitForTimeout(300);
        ok(await P((mm) => !document.getElementById(`strip-${mm}`).hidden, m), `${name}: 3D ${m} 模式正常`);
      }
    } else {
      await connect('gps.serial', 'pixhawk.gps');
      ok((await page.locator('#wire2d [data-wire]').count()) === 1, `${name}: 手機觸控連線`);
      ok(await P(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: 頁面沒有橫向捲動（畫布在自己的捲動框內）`);
      await page.locator('#wire2d').screenshot({ path: `${OUT}/P3_wiring_mobile.png`, timeout: 90000 });
    }
    ok(errs.length === 0, `${name}: 沒有腳本錯誤 ${errs.slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(log.join('\n'));
})().catch((e) => { console.log(log.join(String.fromCharCode(10))); console.error(e); process.exit(2); });
