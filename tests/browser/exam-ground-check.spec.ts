import { expect, test, type Page } from '@playwright/test';

/**
 * S4-3 整合 — 科目 A／G（飛行前／後 360 度檢查）瀏覽器端到端測試。
 *
 * 驗證地面檢查面板：選科 A／G → 依官方逆時針順序點擊繞行航站（機頭→左側→
 * 機尾→右側）→ 逐項勾選附件3 檢查表（A 另含系統知識與搖桿／開關）→ 成績單
 * A／G 列出現且依完成度評 S/U。順時針繞行 → U。
 */

async function openExam(page: Page): Promise<void> {
  await page.goto('/?mode=exam-legacy');
  await expect(page.locator('#app canvas[data-engine]')).toBeVisible({ timeout: 10_000 });
}

async function clickAll(page: Page, selector: string): Promise<void> {
  const buttons = page.locator(selector);
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    await buttons.nth(i).click();
  }
}

async function walkCCW(page: Page): Promise<void> {
  for (const station of ['nose', 'left', 'tail', 'right']) {
    await page.locator(`button[data-station="${station}"]`).click();
  }
}

test('科目 A：逆時針繞行＋完整勾選 → 成績單 A 列評 S', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await openExam(page);

  // 選科目 A → 地面檢查面板出現。
  await page.getByRole('button', { name: /^A / }).click();
  await expect(page.getByText('飛行前／後 360 度檢查').first()).toBeVisible();

  // 逆時針繞行四站。
  await walkCCW(page);

  // 附件3 飛行前欄 10 項全「是」＋系統知識 9 項＋搖桿開關 6 項。
  await clickAll(page, 'button[data-check][data-value="yes"]');
  await clickAll(page, 'button[data-flag^="knowledge:"][data-value="yes"]');
  await clickAll(page, 'button[data-flag^="controller:"][data-value="yes"]');

  // 成績單：A 列（飛行前檢查）評 S。
  await page.keyboard.press('Enter');
  await expect(page.getByText('術科測驗報告表').first()).toBeVisible({ timeout: 5_000 });
  const aRow = page.locator('tr', { hasText: '飛行前檢查' }).first();
  await expect(aRow).toContainText('S');
  await expect(aRow).toContainText('自動判定');

  expect(errors).toEqual([]);
});

test('科目 G：飛行後逆時針繞行＋完整勾選 → 成績單 G 列評 S', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await openExam(page);

  await page.getByRole('button', { name: /^G / }).click();
  await expect(page.getByText('飛行前／後 360 度檢查').first()).toBeVisible();

  await walkCCW(page);
  await clickAll(page, 'button[data-check][data-value="yes"]');

  await page.keyboard.press('Enter');
  await expect(page.getByText('術科測驗報告表').first()).toBeVisible({ timeout: 5_000 });
  const gRow = page.locator('tr', { hasText: '飛行後檢查' }).first();
  await expect(gRow).toContainText('S');
  await expect(gRow).toContainText('自動判定');

  expect(errors).toEqual([]);
});

test('科目 A：順時針繞行（方向錯誤）→ 成績單 A 列評 U', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await openExam(page);

  await page.getByRole('button', { name: /^A / }).click();
  await expect(page.getByText('飛行前／後 360 度檢查').first()).toBeVisible();

  // 順時針：機頭→右側→機尾→左側（官方要求逆時針）。
  for (const station of ['nose', 'right', 'tail', 'left']) {
    await page.locator(`button[data-station="${station}"]`).click();
  }
  await clickAll(page, 'button[data-check][data-value="yes"]');
  await clickAll(page, 'button[data-flag^="knowledge:"][data-value="yes"]');
  await clickAll(page, 'button[data-flag^="controller:"][data-value="yes"]');

  await page.keyboard.press('Enter');
  await expect(page.getByText('術科測驗報告表').first()).toBeVisible({ timeout: 5_000 });
  const aRow = page.locator('tr', { hasText: '飛行前檢查' }).first();
  await expect(aRow).toContainText('U');

  expect(errors).toEqual([]);
});

test('未進行飛行前檢查 → 成績單 A 列評 N', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await openExam(page);

  // 不選 A、不做地面檢查，直接產生成績單。
  await page.keyboard.press('Enter');
  await expect(page.getByText('術科測驗報告表').first()).toBeVisible({ timeout: 5_000 });
  const aRow = page.locator('tr', { hasText: '飛行前檢查' }).first();
  await expect(aRow).toContainText('N');

  expect(errors).toEqual([]);
});
