import { expect, test } from '@playwright/test';
// 線上驗收：3D 畫面滑鼠滾輪縮放（頁面不捲動）、雙擊重設
declare const process: { env: Record<string, string | undefined> };
const base = process.env.REA_LIVE_URL ?? 'https://zhangpengya77-tech.github.io/fde-ai/v2/sim/app/';
test(`滾輪縮放：${base}`, async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', '滑鼠滾輪只在桌機驗證');
  await page.goto(base + '?mode=exam&exam=0');
  const canvas = page.locator('[data-rea-canvas]');
  const stage = page.locator('[data-rea-stage]');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const y0 = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => Number(await stage.getAttribute('data-rea-view-zoom'))).toBeGreaterThan(1.3);
  expect(await page.evaluate(() => window.scrollY)).toBe(y0);
  await canvas.dblclick();
  await expect.poll(async () => Number(await stage.getAttribute('data-rea-view-zoom'))).toBe(1);
});
