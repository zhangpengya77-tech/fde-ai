// 組裝實訓室｜「完整演示」測試：自動組裝→接線→裝槳全程播放、演示中不存檔不記錄、結束後還原原本進度、可中途停止
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BL_PLAYWRIGHT || 'D:/FDE-AI-UAS-v2.0-live-camera/node_modules/playwright');
const OUT = process.argv[2];
const BASE = (process.env.BL_BASE || 'http://127.0.0.1:8095') + '/f450-twin/build-lab/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const logs = [];
page.on('pageerror', (e) => logs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/api\/rag\/ask|501|Failed to load resource/.test(m.text())) logs.push(m.text()); });
const r = {};
await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#bl-loading[hidden]', { state: 'attached', timeout: 30000 });
// 學員自己先裝 2 件
await page.click('#bl-next'); await page.click('#bl-next');
await page.waitForTimeout(300);
r.before = await page.textContent('#bl-step');
// 1. 完整播放
await page.click('#bl-demo');
await page.waitForTimeout(500);
r.demoBtn = await page.textContent('#bl-demo');
r.startHint = await page.textContent('#bl-hint');
r.startStep = await page.textContent('#bl-step');
await page.waitForTimeout(9000);
r.midHint = await page.textContent('#bl-hint');
await page.screenshot({ path: `${OUT}/p7-01-demo-assembly.png` });
await page.waitForSelector('#bl-wpanel:not([hidden])', { timeout: 90000 });
await page.waitForTimeout(6000);
r.wiringStep = await page.textContent('#bl-wstep');
await page.screenshot({ path: `${OUT}/p7-02-demo-wiring.png` });
await page.waitForFunction(() => /演示完成/.test(document.getElementById('bl-hint').textContent), null, { timeout: 120000 });
r.doneStep = await page.textContent('#bl-step');
await page.screenshot({ path: `${OUT}/p7-03-demo-done.png` });
await page.waitForFunction(() => document.getElementById('bl-demo').textContent.includes('完整演示') && !document.body.classList.contains('bl-demo-running'), null, { timeout: 20000 });
await page.waitForTimeout(800);
r.after = await page.textContent('#bl-step');
r.doneDialog = await page.locator('#bl-done[open]').count();
r.records = await page.evaluate(() => (JSON.parse(localStorage.getItem('fde-build-lab:records') || '[]')).length);
r.savedInstalled = await page.evaluate(() => JSON.parse(localStorage.getItem('fde-build-lab:f450-pixhawk248')).installed.length);
// 2. 中途停止
await page.click('#bl-demo');
await page.waitForTimeout(4000);
await page.click('#bl-demo');
await page.waitForFunction(() => !document.body.classList.contains('bl-demo-running'), null, { timeout: 20000 });
await page.waitForTimeout(800);
r.afterStop = await page.textContent('#bl-step');
r.logs = logs;
console.log(JSON.stringify(r, null, 2));
await browser.close();
process.exitCode = /已裝 2 件/.test(r.before) && /停止演示/.test(r.demoBtn) && /演示/.test(r.startHint) && /已裝 0 件/.test(r.startStep)
  && /演示 \d+／27/.test(r.midHint) && /接線/.test(r.wiringStep) && /已裝 27 件/.test(r.doneStep)
  && /已裝 2 件/.test(r.after) && r.doneDialog === 0 && r.records === 0 && r.savedInstalled === 2 && /已裝 2 件/.test(r.afterStop) && !logs.length ? 0 : 1;
