import { test } from '@playwright/test';

/**
 * 產生驗收截圖（docs/rea/screenshots），作為測試證據；只拍照、不做斷言以外的判定。
 */
test('REA 驗收截圖', async ({ page }, info) => {
  const tag = info.project.name;
  const dir = 'docs/rea/screenshots';
  await page.goto('/?mode=exam&exam=0&reaSpeed=30');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/${tag}-1-setup.png` });
  await page.locator('[data-rea-pick="figure-eight"]').click();
  await page.locator('[data-rea-demo]').click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${dir}/${tag}-2-demo-flying.png` });
  await page.locator('[data-rea-result]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.screenshot({ path: `${dir}/${tag}-3-result.png` });
  await page.locator('[data-rea-close]').click();
  await page.locator('[data-rea-pick="rect-small"]').click();
  await page.locator('[data-rea-view]').click();
  await page.locator('[data-rea-view]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/${tag}-4-i2-top.png` });
});
