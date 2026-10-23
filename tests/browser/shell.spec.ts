import { expect, test } from '@playwright/test';

test('opens the Chinese training simulator with a rendered Three.js scene', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'FDE 無人機電力巡檢數位孿生訓練系統' })).toBeVisible();
  await expect(page.locator('[data-app-status="ready"]')).toBeVisible();

  const canvas = page.locator('canvas[data-scene="training"]');
  await expect(canvas).toBeVisible();

  const hasVisiblePixels = await canvas.evaluate((element) => {
    const source = element as HTMLCanvasElement;
    const sample = document.createElement('canvas');
    sample.width = 16;
    sample.height = 16;
    const context = sample.getContext('2d');
    if (!context) return false;
    context.drawImage(source, 0, 0, sample.width, sample.height);
    return context.getImageData(0, 0, sample.width, sample.height).data.some((value, index) => index % 4 !== 3 && value > 8);
  });

  expect(hasVisiblePixels).toBe(true);
  expect(pageErrors).toEqual([]);

  // P1-2 evidence uses its own filename so the P1-1 screenshots stay intact.
  await page.screenshot({
    path: `.playwright-output/shots/p1-2-shell-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
