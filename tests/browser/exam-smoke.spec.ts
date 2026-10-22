import { expect, test } from '@playwright/test';

/**
 * S2 整合 — 考試模式（?mode=exam）端到端冒煙測試。
 *
 * 驗證：考場場景掛載（canvas）、即時面板（HUD 小地圖）、操作提示、
 * 起飛→產生成績單（仿附錄5）→重新測驗 整條路徑可執行，且無頁面錯誤。
 */

test('exam mode mounts, runs, and produces a report', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?mode=exam');

  // 考場 canvas 已掛載（three.js 主場景，data-engine 標記）。
  const canvas = page.locator('#app canvas[data-engine]');
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  // 頂層免責聲明（非官方測驗）。
  await expect(page.getByText('非官方測驗').first()).toBeVisible();

  // 即時面板小地圖 canvas。
  await expect(page.locator('.exam-hud canvas')).toBeVisible();

  // 操作提示含起飛說明。
  await expect(page.getByText('起飛').first()).toBeVisible();

  // 讓主迴圈跑一陣（確認無執行期錯誤）。
  await page.waitForTimeout(800);

  // 起飛並飛行一會兒。
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(800);

  // 產生成績單（仿附錄5）。
  await page.keyboard.press('Enter');
  await expect(page.getByText('術科測驗報告表').first()).toBeVisible({ timeout: 5_000 });

  // 重大違失區塊應出現。
  await expect(page.getByText('重大違失').first()).toBeVisible();

  // 重新測驗：成績單隱藏。
  await page.getByRole('button', { name: '重新測驗' }).click();
  await expect(page.getByText('術科測驗報告表').first()).toBeHidden();

  expect(errors).toEqual([]);
});
