import { expect, test } from '@playwright/test';

test('flies the programmatic F450 with the keyboard and lands safely', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('[data-drone-ready="true"]')).toHaveAttribute('data-drone-source', 'programmatic');

  const armButton = page.getByRole('button', { name: '解鎖' });
  const takeoffButton = page.getByRole('button', { name: '起飛' });
  const hoverButton = page.getByRole('button', { name: '懸停' });
  const landButton = page.getByRole('button', { name: '降落' });

  await expect(armButton).toBeEnabled();
  await armButton.click();
  await expect(page.locator('[data-flight-state]')).toHaveText('已解鎖');

  await takeoffButton.click();
  await expect.poll(async () => Number(await page.locator('[data-altitude]').getAttribute('data-value')), {
    timeout: 8_000,
  }).toBeGreaterThan(2.5);
  await expect(page.locator('[data-flight-state]')).toHaveText('飛行中');

  const startZ = Number(await page.locator('[data-position-z]').getAttribute('data-value'));
  await page.keyboard.down('w');
  await page.waitForTimeout(700);
  await page.keyboard.up('w');
  const movedZ = Number(await page.locator('[data-position-z]').getAttribute('data-value'));
  expect(movedZ).toBeLessThan(startZ - 0.2);

  await hoverButton.click();
  await expect(page.locator('[data-flight-mode]')).toHaveText('懸停');

  await landButton.click();
  await expect.poll(async () => Number(await page.locator('[data-altitude]').getAttribute('data-value')), {
    timeout: 8_000,
  }).toBe(0);
  await expect(page.locator('[data-flight-state]')).toHaveText('已解鎖');

  expect(pageErrors).toEqual([]);
  await page.screenshot({
    path: `.playwright-output/shots/p1-2-flight-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
