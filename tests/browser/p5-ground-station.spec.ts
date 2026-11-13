import { expect, test } from '@playwright/test';

test.describe('P5 網頁地面站訓練入口', () => {
  test('以獨立路由顯示四航點訓練，未連線時不允許上傳', async ({ page }) => {
    await page.goto('/?mode=gcs');

    await expect(page.getByRole('heading', { name: '地面站訓練' })).toBeVisible();
    await expect(page.locator('[data-gcs-waypoint]')).toHaveCount(4);
    await expect(page.locator('[data-gcs-upload]')).toBeDisabled();
    await expect(page.locator('[data-gcs-connection]')).toContainText('未連線');
  });
});
