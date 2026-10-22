import { expect, test } from '@playwright/test';

/**
 * S4-2 整合 — 科目 F（緊急處置程序）瀏覽器端到端測試。
 *
 * 驗證：應考科目列可選 F → 起飛 → 監評人員按 E 下達「緊急返航」（橫幅出現、
 * 觸發事件進入 session）→ 原地不回應 → 成績單 F 列出現且評 U（未飛回內圈降落）。
 * 這條路徑把 exam-app 的觸發按鍵／橫幅／session.triggerEmergency 全部走一遍。
 */

test('科目 F：選科 → 起飛 → 監評下達緊急返航 → 成績單 F 列評 U', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?mode=exam');
  const canvas = page.locator('#app canvas[data-engine]');
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  // 應考科目列：選 F。
  await page.getByRole('button', { name: /^F / }).click();

  // 起飛並穩定在 1.5m。
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(1500);

  // 監評人員下達「緊急返航」（KeyE）→ 橫幅出現。
  await page.keyboard.press('KeyE');
  await expect(page.getByText('緊急返航').first()).toBeVisible();

  // 原地懸停 4s 但不飛回內圈（模擬未完成處置）。
  await page.waitForTimeout(4500);

  // 產生成績單。
  await page.keyboard.press('Enter');
  await expect(page.getByText('術科測驗報告表').first()).toBeVisible({ timeout: 5_000 });

  // F 列（緊急處置程序）應評 U（未飛回較近一側內圈降落），且標記為模擬自動判定。
  const fRow = page.locator('tr', { hasText: '緊急處置程序' }).first();
  await expect(fRow).toContainText('U');
  await expect(fRow).toContainText('自動判定（監評人員觸發）');

  expect(errors).toEqual([]);
});

test('地面狀態按 E 不會下達緊急返航（顯示提示、不出橫幅）', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?mode=exam');
  const canvas = page.locator('#app canvas[data-engine]');
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  // 未起飛按 E → 提示「須在空中」。
  await page.keyboard.press('KeyE');
  await expect(page.getByText('須在空中才能下達緊急返航')).toBeVisible();

  expect(errors).toEqual([]);
});
