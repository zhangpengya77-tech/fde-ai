import { expect, test } from '@playwright/test';
// 線上驗收：WEB LITE 設定畫面與飛行中都不得顯示 PHYSICS PRO 故障注入按鈕（兩個網站各驗一次）
declare const process: { env: Record<string, string | undefined> };
const sites = [process.env.REA_LIVE_URL ?? 'https://zhangpengya77-tech.github.io/fde-ai/v2/sim/app/'];
for (const base of sites) {
  test(`故障注入按鈕隱藏：${base}`, async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('fde-rea-touch-tour-v1', '1'); } catch { /* 忽略 */ } });
    await page.goto(base + '?mode=exam&exam=0');
    await expect(page.locator('[data-rea-faults]')).toBeHidden({ timeout: 30_000 });
    await page.locator('[data-rea-start]').click();
    await page.waitForTimeout(1_500);
    await expect(page.locator('[data-rea-faults]')).toBeHidden();
  });
}
