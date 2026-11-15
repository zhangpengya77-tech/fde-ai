// P5 教學／練習／考核與成績單端對端驗收（file:// 載入，不啟動伺服器）
// 用法：set PLAYWRIGHT_PATH=<playwright 套件路徑> 後執行 node tests/f450-training/modes_e2e.cjs <截圖輸出資料夾>
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('path');
const OUT = process.argv[2];
const URL = require('url').pathToFileURL(path.join(__dirname, '../../f450-twin/index.html')).href;
const log = [];
const snap = async (fn) => { try { await fn(); } catch (e) { log.push(`SKIP 截圖逾時（只影響報告用截圖，不影響功能檢查）：${String(e.message).split(String.fromCharCode(10))[0]}`); } };
const ok = (c, m) => { log.push(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };

(async () => {
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await page.addInitScript(() => { try { localStorage.setItem('f450twin-wire-level', 'base'); } catch { /* 無痕 */ } });   // P13：這組測試走接頭級分頁
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(`${URL}?fx=0&practiceDebug=1&mode=practice`, { timeout: 150000 });
  await page.waitForFunction(() => !document.getElementById('loading') && window.__f450Practice, null, { timeout: 150000 });
  await page.waitForTimeout(800);
  const P = (fn, ...a) => page.evaluate(fn, ...a);
  const total = () => P(() => document.querySelector('#train-session .ts-total b')?.textContent ?? null);
  const card = () => P(() => document.querySelector('#train-session .ts-card').textContent);
  const modeBtn = (zh) => page.locator('#train-session .ts-modes button', { hasText: zh });
  const port = (id) => page.locator(`#wire2d [data-port="${id}"] circle`);
  const connect = async (a, b) => { await port(a).click({ force: true }); await port(b).click({ force: true }); await page.waitForTimeout(200); };
  const tray = (zh) => page.locator('#strip-practice .pr-tray button', { hasText: zh }).first();
  async function drag(id) {
    const s = await P((i) => window.__f450Practice.screen(i), id);
    const [tx, ty] = s.slots[id];
    await page.mouse.move(s.held[0], s.held[1]); await page.mouse.down();
    await page.mouse.move((s.held[0] + tx) / 2, (s.held[1] + ty) / 2, { steps: 4 }); await page.mouse.move(tx, ty, { steps: 4 }); await page.mouse.up();
    await page.waitForTimeout(150);
  }
  const shot = async (sel, file) => { await P((q) => document.querySelector(q).scrollIntoView({ block: 'start' }), sel); await page.waitForTimeout(400); const r = await P((q) => { const b = document.querySelector(q).getBoundingClientRect(); return { x: b.x, y: Math.max(0, b.y), width: b.width, height: Math.min(b.height, innerHeight - Math.max(0, b.y)) }; }, sel); await snap(() => page.screenshot({ path: `${OUT}/${file}`, clip: r, timeout: 90000 })); };

  // 1) 預設練習模式，什麼都沒做是 0 分
  ok(await P(() => document.querySelector('#train-session .ts-modes button.on')?.textContent === '練習'), '預設是練習模式');
  ok((await total()) === '0', `一開始 0 分（${await total()}）`);
  ok((await card()).includes('試行分數，不計正式成績'), '成績單標示試行分數');
  ok(await P(() => getComputedStyle(document.querySelector('#train-session .ts-exam')).display === 'none'), '練習模式：看不到考核計時與交卷');
  ok(await P(() => getComputedStyle(document.querySelector('#viewer .sync-cap')).display === 'none'), '沒有同步內容時，3D 說明條隱藏');

  // 2) 練習：裝下中心板＋接一條對的線 → 分數即時增加
  await page.locator('#wire2d-enter').click(); await page.waitForSelector('#wire2d .w2-port');
  await tray('下中心板').click(); await drag('bottom_plate');
  await connect('battery.xt60', 'power_module.in');
  const t1 = Number(await total());
  ok(t1 > 0, `練習：裝一件、接一條後分數即時更新（${t1}）`);
  const practiceWires = await page.locator('#wire2d [data-wire]').count();

  // 3) 教學：建議下一件、標出正確接口、自動檢查
  await modeBtn('教學').click(); await page.waitForTimeout(300);
  ok((await P(() => document.querySelector('#strip-practice b').textContent)).includes('教學'), '3D 面板顯示教學模式');
  const sug = await P(() => document.querySelector('#strip-practice .pr-tray button.suggest')?.textContent);
  ok(sug && sug.startsWith('ESC'), `教學：零件盤建議下一件（${sug}）`);
  await port('esc_fr.signal').click({ force: true });
  const sugPorts = await P(() => [...document.querySelectorAll('#wire2d .w2-port.suggest')].map((p) => p.dataset.port));
  ok(sugPorts.length === 1 && sugPorts[0] === 'pixhawk.main_out_1', `教學：點 ESC 右前訊號線 → 標出 MAIN OUT 1（${sugPorts}）`);
  await page.keyboard.press('Escape');
  ok(await P(() => document.querySelector('#wire2d .w2-tools button.primary').hidden), '教學：不用按檢查，已自動檢查');
  ok(await P(() => !!document.querySelector('#wire2d .w2-issues.hint')), '教學：直接列出缺少的線');
  await shot('#wire2d', 'P5_teach_2d.png');

  // 4) 考核：清空重做、沒有提示、不能檢查、交卷後鎖定
  await modeBtn('考核').click(); await page.waitForTimeout(400);
  ok((await P(() => window.__f450Practice.report().installed)) === 0, '考核：3D 組裝從 0 開始');
  ok((await page.locator('#wire2d [data-wire]').count()) === 0, '考核：2D 從空白開始');
  ok((await card()).includes('考核進行中'), '考核：交卷前不顯示分數');
  ok(await P(() => document.querySelector('#wire2d .w2-tools button.primary').hidden), '考核：不能自行檢查');
  ok(await P(() => document.querySelector('#wire2d .w2-guide').hidden), '考核：不提供完整接線方式與示範');
  ok(await P(() => !document.querySelector('#strip-practice .pr-step.now')), '考核：零件盤不標下一步');
  await tray('機臂 右前').click();
  ok((await P(() => window.__f450Practice.message())) === '現在還不能裝這個零件（已記錄）', '考核：順序錯不說原因');
  await tray('下中心板').click(); await drag('bottom_plate');
  await connect('battery.xt60', 'power_module.in');            // 對
  await connect('esc_fr.signal', 'pixhawk.main_out_2');        // 錯
  await port('esc_rl.signal').click({ force: true });
  ok((await page.locator('#wire2d .w2-port.suggest').count()) === 0, '考核：不標出正確接口');
  await page.keyboard.press('Escape');
  await page.locator('#train-session button', { hasText: '交卷' }).click(); await page.waitForTimeout(400);
  const examTotal = await total();
  ok(examTotal !== null && Number(examTotal) > 0 && Number(examTotal) < 30, `交卷後顯示分數（${examTotal}）`);
  ok((await card()).includes('考核結果'), '成績單標示考核結果與用時');
  ok((await P(() => document.querySelectorAll('#train-session .ts-cat').length)) === 5, '5 個分項');
  ok((await card()).includes('失分'), '列出失分原因');
  await connect('receiver.sbus', 'pixhawk.rc_in');
  ok((await page.locator('#wire2d [data-wire]').count()) === 2, '交卷後 2D 不能再接線');
  ok(await P(() => [...document.querySelectorAll('#strip-practice .pr-tray button')].every((b) => b.disabled)), '交卷後 3D 零件盤鎖定');
  ok((await total()) === examTotal, '交卷後分數不再變動');
  await P(() => document.querySelectorAll('#train-session details').forEach((d) => (d.open = true)));
  await shot('#train-session', 'P5_exam_result.png');

  // 5) 回到練習：練習進度還原
  await modeBtn('練習').click(); await page.waitForTimeout(400);
  ok((await page.locator('#wire2d [data-wire]').count()) === practiceWires, `回到練習：2D 草稿還原（${practiceWires} 條）`);
  ok((await P(() => window.__f450Practice.report().installed)) === 1, '回到練習：3D 組裝進度還原');
  ok(Number(await total()) === t1, `回到練習：分數回到練習時的 ${t1}`);
  ok(await P(() => getComputedStyle(document.querySelector('#train-session .ts-exam')).display === 'none'), '回到練習：考核計時與交卷隱藏');
  await shot('#train-session', 'P5_practice_card.png');

  // 6) 原有 3D 模式仍正常
  for (const m of ['whole', 'assembly', 'wiring', 'size', 'explode']) {
    await page.locator(`[data-mode="${m}"]`).first().click({ force: true }); await page.waitForTimeout(300);
    ok(await P((mm) => !document.getElementById(`strip-${mm}`).hidden, m), `3D ${m} 模式正常`);
  }
  // 7) 手機版成績單
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
  ok(await P(() => document.documentElement.scrollWidth <= innerWidth + 1), '手機：沒有橫向捲動');
  await shot('#train-session', 'P5_mobile_card.png');
  ok(errs.length === 0, `沒有腳本錯誤 ${errs.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(log.join('\n'));
})().catch((e) => { console.log(log.join('\n')); console.error(e); process.exit(2); });
