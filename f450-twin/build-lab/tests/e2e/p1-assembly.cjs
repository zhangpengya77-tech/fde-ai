// 組裝實訓室無頭瀏覽器冒煙測試：載入、截圖、下一步安裝、拖放、撤銷、爆炸、手機版面
// 組裝實訓室瀏覽器測試（由 run-e2e.mjs 執行；截圖輸出到第一個參數指定的資料夾）
const { chromium } = require(process.env.BL_PLAYWRIGHT || 'D:/FDE-AI-UAS-v2.0-live-camera/node_modules/playwright');
const OUT = process.argv[2];
const PAGE_URL = (process.env.BL_BASE || 'http://127.0.0.1:8095') + '/f450-twin/build-lab/';
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(PAGE_URL);
  await page.waitForSelector('#bl-loading[hidden]', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/01-start.png` });
  const r = {};
  r.cards = await page.locator('.bl-card').count();
  r.thumbs = await page.locator('.bl-card img[src^="data:"]').count();
  // 下一步安裝 6 次
  for (let i = 0; i < 6; i++) { await page.click('#bl-next'); await page.waitForTimeout(150); }
  await page.waitForTimeout(800);
  r.afterNext = await page.textContent('#bl-step');
  await page.screenshot({ path: `${OUT}/02-next6.png` });
  // 順序錯誤：先選上板再按安裝此件
  await page.click('.bl-card[data-part="top_plate"]');
  await page.click('#bl-install');
  r.depToast = await page.textContent('#bl-toast');
  // 撤銷／重做
  await page.click('#bl-undo'); await page.waitForTimeout(100);
  r.afterUndo = await page.textContent('#bl-step');
  await page.click('#bl-redo'); await page.waitForTimeout(100);
  // 全部顯示 → 完成畫面
  await page.click('#bl-all');
  await page.waitForTimeout(1200);
  r.doneOpen = await page.locator('#bl-done[open]').count();
  r.doneText = (await page.textContent('#bl-done-body')).replace(/\s+/g, ' ').trim();
  await page.screenshot({ path: `${OUT}/03-complete.png` });
  await page.click('#bl-done button[value="close"]');
  await page.click('#bl-explode'); await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/04-exploded.png` });
  await page.click('#bl-explode');
  await page.click('[data-view="top"]'); await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/05-top.png` });
  // 拆解全部後拖放下中心板：拖到畫面中心（俯視中心就是安裝位置附近）
  await page.click('#bl-disasm'); await page.waitForTimeout(900);
  const card = await page.locator('.bl-card[data-part="bottom_plate"]').boundingBox();
  const view = await page.locator('#bl-viewer').boundingBox();
  await page.mouse.move(card.x + 30, card.y + 20);
  await page.mouse.down();
  await page.mouse.move(card.x + 80, card.y + 40, { steps: 5 });
  await page.mouse.move(view.x + view.width * 0.2, view.y + view.height * 0.2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  r.dropFarToast = await page.textContent('#bl-toast');
  // 俯視時畫面中心就是機體中心：重新拖到中心
  await page.click('[data-view="top"]'); await page.waitForTimeout(900);
  await page.mouse.move(card.x + 30, card.y + 20);
  await page.mouse.down();
  await page.mouse.move(card.x + 80, card.y + 40, { steps: 5 });
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  r.dropCenterToast = await page.textContent('#bl-toast');
  r.saved = await page.evaluate(() => localStorage.getItem('fde-build-lab:f450-pixhawk248')?.slice(0, 120));
  await page.screenshot({ path: `${OUT}/06-drop.png` });
  // 重新整理後恢復進度
  await page.reload();
  await page.waitForSelector('#bl-loading[hidden]', { state: 'attached', timeout: 30000 });
  r.afterReload = await page.textContent('#bl-step');
  // 手機
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.goto(PAGE_URL);
  await phone.waitForSelector('#bl-loading[hidden]', { state: 'attached', timeout: 30000 });
  await phone.waitForTimeout(800);
  r.phoneOverflow = await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  await phone.screenshot({ path: `${OUT}/07-phone.png` });
  await phone.click('#bl-open-lib'); await phone.waitForTimeout(400);
  await phone.screenshot({ path: `${OUT}/08-phone-lib.png` });
  r.logs = logs;
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
// 驗收條件：不符合就以結束碼 1 回報失敗
process.exitCode = (r.cards === 27 && r.thumbs === 27 && /位置不對/.test(r.dropFarToast) && /已安裝/.test(r.dropCenterToast) && /已裝 1 件/.test(r.afterReload) && !r.phoneOverflow && /要先裝好/.test(r.depToast) && r.doneOpen === 1) && !r.logs.length ? 0 : 1;

})().catch((e) => { console.error(e); process.exit(1); });
