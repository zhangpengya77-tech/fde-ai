// 組裝實訓室｜手機（觸控）測試：抽屜、點選零件、下一步、接線模式點選焊盤、版面不水平溢出
// 注意：Playwright 無法模擬「手指拖曳零件」，觸控拖放需真機人工驗收（PENDING_MANUAL）。
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BL_PLAYWRIGHT || 'D:/FDE-AI-UAS-v2.0-live-camera/node_modules/playwright');
const { F450_MODEL } = await import(new URL('../../../f450-twin/build-lab/data/f450-pixhawk248.js', import.meta.url).href);
const OUT = process.argv[2];
const URL_ = (process.env.BL_BASE || 'http://127.0.0.1:8095') + '/f450-twin/build-lab/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/api\/rag\/ask|501|Failed to load resource/.test(m.text())) logs.push(m.text()); });
const tapEl = async (sel) => { const b = await page.locator(sel).first().boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const r = {};
await page.goto(URL_);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#bl-loading[hidden]', { state: 'attached', timeout: 30000 });
r.canvas = await page.evaluate(() => { const c = document.querySelector('#bl-viewer canvas'); return c ? [c.clientWidth, c.clientHeight] : null; });
r.overflowStart = await overflow();
await tapEl('#bl-open-lib');
await page.waitForTimeout(400);
r.libOpen = await page.evaluate(() => document.getElementById('bl-lib').classList.contains('open'));
await tapEl('.bl-card[data-part="bottom_plate"]');
await page.waitForTimeout(200);
r.selectedHasInstall = await page.isEnabled('#bl-install');
await tapEl('[data-close="bl-lib"]');
await page.waitForTimeout(400);
await tapEl('#bl-next');
await page.waitForTimeout(300);
r.afterNext = await page.textContent('#bl-step');
await page.screenshot({ path: `${OUT}/p5-01-phone.png` });
// 直接放入「除了槳以外都裝好」的進度，測試手機接線畫面
await page.evaluate((ids) => {
  localStorage.setItem('fde-build-lab:f450-pixhawk248', JSON.stringify({ kind: 'fde-build-lab-progress', schema: 1, modelId: 'f450-pixhawk248', mode: 'learn', installed: ids, errors: [] }));
}, F450_MODEL.order.filter((id) => !id.startsWith('prop_')));
await page.reload();
await page.waitForSelector('#bl-loading[hidden]', { state: 'attached', timeout: 30000 });
await page.evaluate(() => document.getElementById('bl-wiring').scrollIntoView());
await tapEl('#bl-wiring');
await page.waitForSelector('#bl-wpanel:not([hidden]) .bl-wsvg', { timeout: 10000 });
r.svgWidth = await page.evaluate(() => Math.round(document.querySelector('.bl-wsvg').getBoundingClientRect().width));
await tapEl('[data-point="pdb.fr+"]');
await page.waitForTimeout(200);
r.wireAfterTap = await page.textContent('#bl-wstep');
r.overflowWiring = await overflow();
await page.screenshot({ path: `${OUT}/p5-02-phone-wiring.png` });
r.logs = logs;
console.log(JSON.stringify(r, null, 2));
await browser.close();
const ok = r.canvas && r.canvas[0] > 0 && !r.overflowStart && r.libOpen && r.selectedHasInstall && /已裝 1 件/.test(r.afterNext)
  && r.svgWidth <= 390 && /接線 2／21/.test(r.wireAfterTap) && !r.overflowWiring && !logs.length;
process.exit(ok ? 0 : 1);
