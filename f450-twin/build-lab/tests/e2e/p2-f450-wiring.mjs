// P2 冒煙測試：拆槳限制 → 接線 21 步（含一次反接）→ 錯誤案例 → 設定報告 → 裝槳完成
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BL_PLAYWRIGHT || 'D:/FDE-AI-UAS-v2.0-live-camera/node_modules/playwright');
const { F450_WIRING } = await import(new URL('../../data/f450-wiring.js', import.meta.url).href);
const OUT = process.argv[2];
const PAGE_URL = (process.env.BL_BASE || 'http://127.0.0.1:8095') + '/f450-twin/build-lab/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(PAGE_URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#bl-loading[hidden]', { state: 'attached', timeout: 30000 });
const r = {};
await page.click('#bl-all');
await page.waitForTimeout(900);
await page.click('#bl-done button[value="close"]');
await page.click('#bl-wiring');
r.propsToast = await page.textContent('#bl-toast');
for (const n of [1, 2, 3, 4]) {
  await page.click(`.bl-card[data-part="prop_m${n}"]`);
  await page.click('#bl-remove');
}
await page.click('#bl-wiring');
r.panelVisible = await page.isVisible('#bl-wpanel');
r.step1 = await page.textContent('#bl-wstep');
await page.screenshot({ path: `${OUT}/p2-01-wiring-start.png` });
// 故意反接
await page.click('[data-point="pdb.fr-"]');
r.reversed = await page.textContent('#bl-wresult');
await page.screenshot({ path: `${OUT}/p2-02-reversed.png` });
// 正確接完 21 步（第 10 步截圖）
for (const [i, s] of F450_WIRING.steps.entries()) {
  const id = s.kind === 'polarity' ? s.expect.red : s.expect;
  await page.click(`[data-point="${id}"]`);
  if (i === 9) await page.screenshot({ path: `${OUT}/p2-03-wiring-mid.png` });
}
r.final = await page.textContent('#bl-wstep');
r.toastDone = await page.textContent('#bl-toast');
r.reportEnabled = await page.isEnabled('#bl-report');
await page.screenshot({ path: `${OUT}/p2-04-wiring-done.png` });
await page.click('#bl-report');
r.reportRows = await page.locator('#bl-report-body tbody tr').count();
await page.screenshot({ path: `${OUT}/p2-05-report.png` });
await page.click('#bl-report-dlg button[value="close"]');
await page.click('#bl-cases');
r.cases = await page.locator('.bl-case').count();
await page.screenshot({ path: `${OUT}/p2-06-cases.png` });
await page.click('#bl-cases-dlg button[value="close"]');
await page.click('#bl-wback');
for (let i = 0; i < 4; i++) { await page.click('#bl-next'); await page.waitForTimeout(150); }
await page.waitForTimeout(1500);
r.doneText = (await page.textContent('#bl-done-body')).replace(/\s+/g, ' ').trim();
await page.click('#bl-done button[value="close"]');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/p2-07-3d-wires.png` });
// 重新整理後接線進度恢復
await page.reload();
await page.waitForSelector('#bl-loading[hidden]', { state: 'attached', timeout: 30000 });
r.savedWiring = await page.evaluate(() => JSON.parse(localStorage.getItem('fde-build-lab:f450-pixhawk248')).wiring.done.length);
// 手機版接線
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await phone.goto(PAGE_URL);
await phone.waitForSelector('#bl-loading[hidden]', { state: 'attached', timeout: 30000 });
await phone.evaluate(() => { localStorage.clear(); });
r.phoneOverflow = await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth);
r.logs = logs;
console.log(JSON.stringify(r, null, 2));
await browser.close();
// 驗收條件：不符合就以結束碼 1 回報失敗
process.exitCode = (/21／21/.test(r.final) && r.reportRows === 8 && r.cases === 8 && r.savedWiring === 21 && /正負極接反/.test(r.reversed) && /拆槳/.test(r.propsToast) && !r.phoneOverflow) && !r.logs.length ? 0 : 1;

