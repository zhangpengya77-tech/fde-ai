import { expect, test } from '@playwright/test';

/**
 * 科目 E（高度保持五邊飛行）教學預覽（?mode=penta）冒煙測試。
 *
 * 驗證：獨立入口掛載（canvas）、免責與教學假設標示、官方三條件顯示、
 * 播放/暫停演示、無頁面錯誤，且**不出現評分/成績單元素**（第一階段不接評分）。
 */

test('penta preview mounts with disclaimers and no scoring UI', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?mode=penta');

  // 主 canvas 掛載（three.js 五邊場景）。
  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  // 免責橫幅（固定標示非官方）。
  await expect(page.locator('[data-penta-disclaimer]')).toHaveText('非官方測驗，僅供練習');

  // 配置合法性徽章：官方數值已載入。
  await expect(page.locator('[data-penta-status]')).toHaveAttribute('data-penta-status', 'config-ok');
  await expect(page.locator('[data-penta-status]')).toContainText('官方數值已載入');

  // 官方三條件（p165）與教學假設標示。
  await expect(page.getByText('第一邊及第五邊須穩定準確通過P3至P7之延伸線上方').first()).toBeVisible();
  await expect(page.getByText('教學假設（非官方）').first()).toBeVisible();
  await expect(page.getByText('操作高度 20 m（官方）').first()).toBeVisible();

  // 第一階段不接評分：不得出現成績單/評分相關元素。
  await expect(page.getByText('術科測驗報告表')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /重新測驗/ })).toHaveCount(0);

  // 播放/暫停切換。
  const play = page.locator('[data-penta-play]');
  await expect(play).toHaveText('⏸ 暫停演示');
  await play.click();
  await expect(play).toHaveText('▶ 播放航線演示');
  await play.click();
  await expect(play).toHaveText('⏸ 暫停演示');

  // 讓演示與渲染迴圈跑一陣（確認無執行期錯誤）。
  await page.waitForTimeout(1200);

  expect(errors).toEqual([]);
});

test('penta preview canvas actually renders (non-empty framebuffer)', async ({ page }) => {
  await page.goto('/?mode=penta');
  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800);

  // 統計整個 framebuffer 中「非背景色」像素比例，確認場景確有渲染。
  // （不以中心區域為準：演示動畫中機體位置會變，中心區域可能只有背景與
  //   半透明參考面；背景色 #0b1d2a。）
  const stats = await page.evaluate(() => {
    const c = document.querySelector('#app canvas') as HTMLCanvasElement | null;
    if (!c) return null;
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    if (!gl) return null;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4 * w * h);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let nonBg = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (Math.abs(px[i] - 11) > 8 || Math.abs(px[i + 1] - 29) > 8 || Math.abs(px[i + 2] - 42) > 8) nonBg += 1;
    }
    return { total: w * h, nonBg };
  });
  expect(stats).not.toBeNull();
  expect(stats!.nonBg).toBeGreaterThan(stats!.total * 0.01);

  // 截圖留存（實際場景證據由 #189 統一固化到 D 盤；此處至少確認可截）。
  const shot = await canvas.screenshot();
  expect(shot.byteLength).toBeGreaterThan(2000);
});
