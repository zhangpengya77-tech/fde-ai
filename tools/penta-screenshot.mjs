// 第三輪科目 E 截圖固化（Round 3 交付證據）。
// 用法：node tools/penta-screenshot.mjs
// 輸出：D:/FDE-REA-Review/evidence/P0-ROUND3-SUBJECT-E-2026-10-25/
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'D:/FDE-REA-Review/evidence/P0-ROUND3-SUBJECT-E-2026-10-25';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: [
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});

async function shot(url, file, { waitMs = 2600, drag } = {}) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('#app canvas', { timeout: 15_000 });
  await page.waitForTimeout(waitMs);
  if (drag) {
    await page.mouse.move(800, 500);
    await page.mouse.down();
    await page.mouse.move(800 + drag[0], 500 + drag[1], { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log(`saved ${file} (pageerrors: ${errors.length})`);
  await page.close();
}

await shot('http://127.0.0.1:4173/?mode=penta', 'penta-preview-default.png');
await shot('http://127.0.0.1:4173/?mode=penta', 'penta-preview-orbit.png', { drag: [-320, 60] });
await shot('http://127.0.0.1:4173/?mode=exam', 'exam-mode-regression.png');

await browser.close();
console.log('ALL-SHOTS-DONE');
