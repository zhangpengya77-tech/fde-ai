import { expect, test, type Page } from '@playwright/test';

/**
 * REA 考照模擬器瀏覽器整合測試。
 *
 * 注意：這裡的 USB 遙控器是 Gamepad API 的「測試替身」，用的是專案內建的
 * RadioMaster Pocket 真機標定檔（rc-profile-latest.json）。它證明「USB 遙控器 → 既有輸入管線
 * → 新飛行引擎」這條路是通的，但不能取代真實遙控器的人工驗收（見 USB_CONTROLLER_TEST.md）。
 */

const POCKET_ID = 'Radiomaster Pocket Joystick (Vendor: 1209 Product: 4f54)';

async function installFakePocket(page: Page): Promise<void> {
  await page.addInitScript((id: string) => {
    // 軸：0 roll、1 pitch、2 throttle（unipolar，-1 = 最低）、3 yaw；油門預設置中（約 0.5）
    const fake = { id, index: 0, connected: true, mapping: '', timestamp: performance.now(), axes: [0, 0, -0.025, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ value: 0, pressed: false })) };
    (window as unknown as { __pad: typeof fake }).__pad = fake;
    const impl = () => { fake.timestamp = performance.now(); return [fake]; };
    try { (Navigator.prototype as unknown as { getGamepads: unknown }).getGamepads = impl; }
    catch { Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, writable: true, value: impl }); }
  }, POCKET_ID);
}

const setAxis = (page: Page, i: number, v: number) =>
  page.evaluate(([i, v]) => { (window as unknown as { __pad: { axes: number[] } }).__pad.axes[i] = v; }, [i, v] as const);

const hud = (page: Page, key: 'alt' | 'x' | 'y' | 'heading') =>
  page.evaluate((k) => Number(document.querySelector<HTMLElement>('[data-rea-hud]')?.dataset[k] ?? 'NaN'), key);

test.describe('REA 考照模擬器', () => {
  test('入口顯示新科目系統，舊 F450 考照介面已被取代', async ({ page }) => {
    await page.goto('/?mode=exam&exam=0');
    await expect(page.locator('.rea-h1')).toContainText('臺灣無人機考照模擬器');
    for (const name of ['四面停懸', '8 字水平圓', '側飛前進、後退', '五邊飛行', '緊急返航', '矩形航線']) {
      await expect(page.locator('[data-rea-subjects]')).toContainText(name);
    }
    await expect(page.locator('[data-rea-pick="fpv-points"]')).toBeDisabled();
    await expect(page.locator('[data-rea-airframes] button')).toHaveCount(3);
    await expect(page.locator('[data-rea-canvas]')).toBeVisible();
    // 舊版 F450 考試 HUD 不應出現在正式入口
    await expect(page.locator('[data-exam-panel], .exam-panel')).toHaveCount(0);
  });

  test('五種連線方式的面板仍在', async ({ page }) => {
    await page.goto('/?mode=exam&exam=0');
    await expect(page.locator('.rea-links')).toContainText('鍵盤');
    for (const label of ['實體遙控器', '手勢', '原子筆', '手機遙控器']) await expect(page.locator('.rea-links')).toContainText(label);
    // 既有浮動連線面板（原系統實作）
    await expect(page.getByText('連線方式', { exact: false }).first()).toBeVisible();
  });

  test('看示範：8 字飛完出現練習評等與回放（加速 30 倍）', async ({ page }) => {
    await page.goto('/?mode=exam&exam=0&reaSpeed=30');
    await page.locator('[data-rea-pick="figure-eight"]').click();
    await page.locator('[data-rea-demo]').click();
    await expect(page.locator('[data-rea-result]')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.rea-grade')).toHaveText(/頂尖|標準/);
    await expect(page.locator('.rea-disclaimer')).toContainText('不是民航局官方評分');
    await expect(page.locator('.rea-table tbody tr')).not.toHaveCount(0);
    await page.locator('[data-rea-speed="6"]').click();
    await page.locator('[data-rea-play]').click();
    await expect(page.locator('[data-rea-time]')).not.toHaveText(/^00:00 \//, { timeout: 10_000 });
    await page.locator('[data-rea-coloring]').selectOption('cross');
  });

  test('鍵盤：R 升高、W 前進會改變高度與位置', async ({ page }) => {
    // 測試機若真的插著遙控器，實體遙控器優先會接管鍵盤；這裡明確模擬「沒有接任何遙控器」
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, writable: true, value: () => [] });
    });
    await page.goto('/?mode=exam&exam=0');
    await page.locator('[data-rea-pick="hover"]').click();
    await page.locator('[data-rea-mode]').click(); // 預設姿態 → 切到定位
    await expect(page.locator('[data-rea-mode]')).toHaveText('定位模式');
    await page.locator('[data-rea-start]').click();
    await page.waitForTimeout(3300); // 倒數 3 秒
    // 點 3D 畫面讓頁面取得鍵盤焦點（不用固定座標，手機版面捲動後才不會誤點到科目按鈕）
    await page.locator('[data-rea-canvas]').click({ force: true }); // 點中央（左上角疊著「← 仿真訓練」連結）
    await page.keyboard.down('r');
    await page.waitForTimeout(1500);
    await page.keyboard.up('r');
    expect(await hud(page, 'alt')).toBeGreaterThan(0.8);
    const y0 = await hud(page, 'y');
    await page.keyboard.down('w');
    await page.waitForTimeout(1200);
    await page.keyboard.up('w');
    expect(await hud(page, 'y')).toBeGreaterThan(y0 + 0.5);
  });

  test('模擬 USB 遙控器（RadioMaster Pocket 標定檔）：油門與俯仰實際控制新飛行引擎', async ({ page }) => {
    await installFakePocket(page);
    await page.goto('/?mode=exam&exam=0');
    await page.locator('[data-rea-pick="hover"]').click();
    await expect(page.locator('[data-rea-src]')).toContainText('Radiomaster', { timeout: 20_000 });
    await page.locator('[data-rea-start]').click();
    await page.waitForTimeout(3300);
    await setAxis(page, 2, 0.9); // 油門推高
    await page.waitForTimeout(1500);
    await setAxis(page, 2, -0.025); // 回中
    const alt = await hud(page, 'alt');
    expect(alt).toBeGreaterThan(1);
    await setAxis(page, 1, 0.8); // 俯仰往前（標定檔：axis1 推上為正）
    const y0 = await hud(page, 'y');
    await page.waitForTimeout(1500);
    await setAxis(page, 1, 0);
    expect(await hud(page, 'y')).toBeGreaterThan(y0 + 0.5);
    // 斷線：停止回報 → 0.25 秒後管線改送懸停指令，高度維持、不墜機
    await page.evaluate(() => { (Navigator.prototype as unknown as { getGamepads: unknown }).getGamepads = () => []; });
    await page.waitForTimeout(1500);
    expect(await hud(page, 'alt')).toBeGreaterThan(0.5);
  });

  test('日本手（Mode 1）：右手垂直軸變成油門', async ({ page }) => {
    await installFakePocket(page);
    await page.goto('/?mode=exam&exam=0');
    await page.locator('[data-rea-pick="hover"]').click();
    await page.locator('.rea-settings summary').click();
    await page.locator('[data-rea-stick-mode]').selectOption('mode1');
    await expect(page.locator('[data-rea-src]')).toContainText('Radiomaster', { timeout: 20_000 });
    await page.locator('[data-rea-start]').click();
    await page.waitForTimeout(3300);
    await setAxis(page, 1, 0.9); // 日本手：axis1（標定為 pitch）實際當油門
    await page.waitForTimeout(1500);
    await setAxis(page, 1, 0);
    expect(await hud(page, 'alt')).toBeGreaterThan(1);
  });

  test('飛行中與評等畫面都能直接換科目、換機型（2026-11-08 使用者回報點不了）', async ({ page }) => {
    await page.goto('/?mode=exam&exam=0&reaSpeed=30');
    await page.locator('[data-rea-pick="hover-small"]').click();
    await page.locator('[data-rea-start]').click();
    await page.waitForTimeout(500); // 倒數中
    await page.locator('[data-rea-pick="figure-eight"]').click();
    await expect(page.locator('[data-rea-title]')).toContainText('8 字水平圓');
    await expect(page.locator('[data-rea-pick="figure-eight"]')).toHaveClass(/on/);
    await expect(page.locator('[data-rea-start]')).toContainText('8 字水平圓');
    // 示範飛完進入評等畫面後換科目，評等面板關閉、回到準備狀態
    await page.locator('[data-rea-demo]').click();
    await expect(page.locator('[data-rea-result]')).toBeVisible({ timeout: 60_000 });
    await page.locator('[data-rea-pick="sideways"]').click();
    await expect(page.locator('[data-rea-result]')).toBeHidden();
    await expect(page.locator('[data-rea-title]')).toContainText('側飛');
    await page.locator('[data-rea-af="hexa-18kg"]').click();
    await expect(page.locator('[data-rea-af="hexa-18kg"]')).toHaveClass(/on/);
  });

  test('舊版 F450 考照模擬器仍可從 exam-legacy 開啟（歷史版本）', async ({ page }) => {
    await page.goto('/?mode=exam-legacy&exam=0');
    await expect(page.locator('.rea-h1')).toHaveCount(0);
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  });
});
