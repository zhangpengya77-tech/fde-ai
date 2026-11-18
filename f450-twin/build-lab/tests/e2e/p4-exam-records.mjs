// P4 冒煙測試：AI 講解（本機無知識庫→顯示內建說明）、考試流程與計分、本機紀錄與 CSV 匯出
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BL_PLAYWRIGHT || 'D:/FDE-AI-UAS-v2.0-live-camera/node_modules/playwright');
const { F450_WIRING } = await import(new URL('../../data/f450-wiring.js', import.meta.url).href);
const { F450_MODEL } = await import(new URL('../../data/f450-pixhawk248.js', import.meta.url).href);
const OUT = process.argv[2];
const PAGE_URL = (process.env.BL_BASE || 'http://127.0.0.1:8095') + '/f450-twin/build-lab/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' && !/api\/rag\/ask|501|Failed to load resource/.test(m.text())) logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
page.on('dialog', (d) => d.accept());   // 確認「開始考試」
await page.goto(PAGE_URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#bl-loading[hidden]', { state: 'attached', timeout: 30000 });
const r = {};
// 1. 學習模式：教學卡與 AI 講解（本機預覽沒有知識庫 → 內建說明）
await page.click('.bl-card[data-part="power_module"]');
r.teachLines = await page.locator('.bl-teach li').count();
await page.click('text=🤖 AI 講解這個零件');
await page.waitForFunction(() => !document.querySelector('.bl-info .bl-ai')?.textContent.includes('正在整理'), null, { timeout: 30000 });
r.aiPart = (await page.textContent('.bl-info .bl-ai')).slice(0, 40);
await page.screenshot({ path: `${OUT}/p4-01-teach-ai.png` });
// 2. 進入考試（會確認並清空）
await page.click('#bl-next');
await page.click('[data-mode="exam"]');
r.examStep = await page.textContent('#bl-step');
await page.waitForTimeout(1200);
r.timer = await page.textContent('#bl-timer');
r.nextDisabled = await page.isDisabled('#bl-next');
await page.click('.bl-card[data-part="power_module"]');
r.examNoAi = await page.locator('text=🤖 AI 講解這個零件').count();
await page.click('#bl-install');   // 順序錯誤（底板還沒裝）→ 扣分
r.examErrToast = await page.textContent('#bl-toast');
// 依順序安裝（槳除外）
for (const id of F450_MODEL.order.filter((x) => !x.startsWith('prop_'))) {
  await page.click(`.bl-card[data-part="${id}"]`);
  await page.click('#bl-install');
}
await page.click('#bl-wiring');
await page.click('[data-point="pdb.fr-"]');   // 反接（危險）→ 扣 8 分
r.examWireMsg = await page.textContent('#bl-wresult');
r.examWireAiBtn = await page.locator('#bl-wresult .bl-ai-btn').count();
for (const s of F450_WIRING.steps) await page.click(`[data-point="${s.kind === 'polarity' ? s.expect.red : s.expect}"]`);
await page.click('#bl-wback');
for (const n of [1, 2, 3, 4]) { await page.click(`.bl-card[data-part="prop_m${n}"]`); await page.click('#bl-install'); }
await page.waitForSelector('#bl-done[open]', { timeout: 10000 });
r.doneTitle = await page.textContent('#bl-done h2');
r.score = (await page.textContent('.bl-score')).replace(/\s+/g, ' ');
await page.screenshot({ path: `${OUT}/p4-02-exam-result.png` });
// 3. 紀錄與匯出
await page.click('#bl-done-records');
r.recordRows = await page.locator('#bl-rec-body tbody tr').count();
await page.screenshot({ path: `${OUT}/p4-03-records.png` });
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bl-rec-csv')]);
const csvPath = `${OUT}/records.csv`;
await dl.saveAs(csvPath);
r.csvHead = fs.readFileSync(csvPath, 'utf8').split('\r\n').slice(0, 2);
// 重新整理不會重複寫紀錄
await page.reload();
await page.waitForSelector('#bl-loading[hidden]', { state: 'attached', timeout: 30000 });
r.recordsAfterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('fde-build-lab:records')).length);
r.logs = logs;
console.log(JSON.stringify(r, null, 2));
await browser.close();
// 驗收條件：不符合就以結束碼 1 回報失敗
process.exitCode = (/90 分/.test(r.score) && r.recordRows === 1 && r.recordsAfterReload === 1 && r.examNoAi === 0 && r.examWireAiBtn === 0 && r.nextDisabled && /內建說明|AI 講解/.test(r.aiPart) && /考試結果/.test(r.doneTitle)) && !r.logs.length ? 0 : 1;

