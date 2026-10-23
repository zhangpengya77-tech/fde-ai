import { expect, test, type Page } from '@playwright/test';

/**
 * 考試模式 — 機體可見性、起飛／懸停／降落狀態鏈、版面（教師實測回報 2026-10-23）。
 *
 * 驗證方式不是「元素存在」，而是：
 *  - 由場景相機實際投影機體，確認機體在畫面內且像素尺寸可辨識；
 *  - 點擊「起飛」後由飛控狀態與高度變化確認機體真的上升；
 *  - 面板 boundingBox 兩兩不相交、場景中央區域不被覆蓋；
 *  - 三個解析度（1280×720／1366×768／1920×1080）各截起飛前／飛行中／成績單。
 */

const SHOT_DIR = '.playwright-output/exam-shots';

interface HookState {
  frames: number;
  step: string;
  status: string | null;
  cameraView: string;
  subject: string | null;
  flightState: string;
  altitude: number;
}

/**
 * 等待考試模組掛載完成。
 *
 * `src/main.ts` 以動態 `import()` 載入 exam-app，測試鉤子在該 chunk 執行後才安裝，
 * 可能晚於 `load` 事件。直接讀取會得到 undefined（TypeError），因此先等到鉤子出現。
 */
async function waitForHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>).__examTestHook),
    undefined,
    { timeout: 30_000 },
  );
}

async function state(page: Page): Promise<HookState> {
  await waitForHook(page);
  return page.evaluate(() => (window as unknown as { __examTestHook: { getState: () => HookState } }).__examTestHook.getState());
}

async function waitRendered(page: Page, minFrames = 5): Promise<void> {
  await waitForHook(page);
  await expect.poll(async () => (await state(page)).frames, { timeout: 30_000 }).toBeGreaterThan(minFrames);
}

async function droneScreen(page: Page): Promise<{ inView: boolean; x: number; y: number; sizePx: number; viewport: { w: number; h: number } }> {
  await waitForHook(page);
  return page.evaluate(() =>
    (window as unknown as { __examTestHook: { getDroneScreen: () => { inView: boolean; x: number; y: number; sizePx: number; viewport: { w: number; h: number } } } }).__examTestHook.getDroneScreen(),
  );
}

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

async function panelBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const ids = ['exam-topbar', 'exam-hud-host', 'exam-controls', 'exam-keyhint'];
    const out: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ id, x: r.x, y: r.y, w: r.width, h: r.height });
    }
    return out;
  });
}

async function stageRect(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate(() => {
    const el = document.getElementById('exam-stage');
    const r = el!.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

function intersects(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

test.describe('考試模式 — 機體與起飛流程', () => {
  test('機體可見、起飛按鈕狀態正確、起飛→懸停→降落狀態同步', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/?mode=exam');
    await waitRendered(page);

    // 1) 起飛前：機體在場景中、畫面內、可辨識（考生視角）。
    const before = await droneScreen(page);
    expect(before.inView).toBe(true);
    expect(before.sizePx).toBeGreaterThan(20);

    // 2) 步驟條：未選科目 → ①；起飛按鈕停用。
    expect((await state(page)).step).toBe('select');
    await expect(page.locator('[data-step="select"][data-current="true"]')).toBeVisible();
    const takeoffBtn = page.getByRole('button', { name: /起飛/ });
    await expect(takeoffBtn).toBeDisabled();

    // 3) 未選科目按 T：不起飛，提示「請先選科目」。
    await page.keyboard.press('KeyT');
    await expect(page.getByText('請先選科目')).toBeVisible();
    expect((await state(page)).flightState).toBe('idle');

    // 4) 選科目 → ②起飛，按鈕啟用。
    await page.getByRole('button', { name: /^B / }).click();
    expect((await state(page)).step).toBe('takeoff');
    await expect(takeoffBtn).toBeEnabled();

    // 5) 點擊起飛 → 狀態轉入起飛中/飛行中，高度實際上升。
    await takeoffBtn.click();
    await page.waitForTimeout(300);
    const mid = await state(page);
    expect(['takingOff', 'flying']).toContain(mid.status);
    await page.waitForTimeout(2200);
    const flying = await state(page);
    expect(flying.flightState).toBe('flying');
    expect(flying.altitude).toBeGreaterThan(1.2);
    expect(flying.step).toBe('execute');
    await expect(page.locator('[data-step="execute"][data-current="true"]')).toBeVisible();

    // 6) 飛行中按鈕狀態：起飛停用、懸停／降落可用。
    await expect(takeoffBtn).toBeDisabled();
    const hoverBtn = page.getByRole('button', { name: '懸停' });
    const landBtn = page.getByRole('button', { name: /降落/ });
    await expect(hoverBtn).toBeEnabled();
    await expect(landBtn).toBeEnabled();

    // 7) 懸停：高度維持、狀態仍為飛行中。
    await hoverBtn.click();
    await page.waitForTimeout(1000);
    const hovered = await state(page);
    expect(Math.abs(hovered.altitude - flying.altitude)).toBeLessThan(0.15);

    // 8) 降落 → 回到地面、狀態已降落、⑤成績單。
    await landBtn.click();
    await page.waitForTimeout(4000);
    const landed = await state(page);
    expect(landed.flightState).toBe('landed');
    expect(landed.altitude).toBeLessThan(0.05);
    expect(landed.step).toBe('report');
    await expect(page.locator('[data-step="report"][data-current="true"]')).toBeVisible();
    await expect(page.getByText('按 Enter 看成績單，或選下一科')).toBeVisible();

    // 9) 落地後可再起飛（不需 Esc 重置）。
    await expect(takeoffBtn).toBeEnabled();

    // 10) 成績單：七項＋模擬判定標註。
    await page.keyboard.press('Enter');
    await expect(page.getByText('術科測驗報告表').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('模擬判定，非官方測驗結果').first()).toBeVisible();

    // 11) 視窗改變後場景與機體仍可見。
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(600);
    const resized = await droneScreen(page);
    expect(resized.inView).toBe(true);

    expect(errors).toEqual([]);
  });

  test('視角切換（V）：考生 → 追隨 → 俯視全景 → 考生，機體始終在畫面內', async ({ page }) => {
    await page.goto('/?mode=exam');
    await waitRendered(page);
    expect((await state(page)).cameraView).toBe('examinee');

    for (const expected of ['follow', 'overview', 'examinee']) {
      await page.keyboard.press('KeyV');
      await page.waitForTimeout(400);
      expect((await state(page)).cameraView).toBe(expected);
      const shot = await droneScreen(page);
      expect(shot.inView).toBe(true);
    }
  });
});

test.describe('考試模式 — 三解析度版面與截圖', () => {
  const VIEWPORTS = [
    { w: 1280, h: 720 },
    { w: 1366, h: 768 },
    { w: 1920, h: 1080 },
  ];

  for (const vp of VIEWPORTS) {
    test(`${vp.w}×${vp.h}：面板不重疊、中央淨空、機體可辨識，截三張圖`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-chrome', '僅桌面解析度驗證');
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));

      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto('/?mode=exam');
      await waitRendered(page);

      const shotPath = (name: string) => `${SHOT_DIR}/${vp.w}x${vp.h}-${name}.png`;

      // 起飛前
      await page.screenshot({ path: shotPath('before') });
      const boxes = await panelBoxes(page);
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          expect(
            intersects(boxes[i], boxes[j]),
            `面板重疊：${boxes[i].id} × ${boxes[j].id}`,
          ).toBe(false);
        }
      }
      // 場景中央（寬 40%、高 50%）不得被任何面板覆蓋。
      const stage = await stageRect(page);
      const center = { x: stage.x + stage.w * 0.3, y: stage.y + stage.h * 0.25, w: stage.w * 0.4, h: stage.h * 0.5 };
      for (const b of boxes) {
        expect(intersects(center, b), `中央區域被 ${b.id} 覆蓋`).toBe(false);
      }
      const beforeShot = await droneScreen(page);
      expect(beforeShot.inView).toBe(true);
      if (vp.w === 1280) expect(beforeShot.sizePx).toBeGreaterThan(20);

      // 飛行中
      await page.getByRole('button', { name: /^C / }).click();
      await page.getByRole('button', { name: /起飛/ }).click();
      await page.waitForTimeout(2400);
      await waitRendered(page);
      await page.screenshot({ path: shotPath('flying') });
      const flying = await state(page);
      expect(flying.altitude).toBeGreaterThan(1.2);
      expect((await droneScreen(page)).inView).toBe(true);

      // 成績單
      await page.keyboard.press('Enter');
      await expect(page.getByText('術科測驗報告表').first()).toBeVisible({ timeout: 5_000 });
      await page.screenshot({ path: shotPath('report') });

      expect(errors).toEqual([]);
    });
  }
});
