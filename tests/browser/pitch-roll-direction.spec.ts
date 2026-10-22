import { expect, test, type Page } from '@playwright/test';

/**
 * 症狀 C 的端到端迴歸（browser 級）：
 *   教師回報「前推時機體橫向移動，右打時機體前後移動」。
 *   輸入層 source 已由真機數據確認（roll←a0、pitch←a1，沒有互換），
 *   所以問題在「映射之後」：飛控把指令旋轉到世界座標時的航向矩陣。
 *
 * 這裡不看內部物件，只看畫面上 HUD 的 X / Z 數字 —— 也就是教師看到的東西。
 * 假手柄走的是與真機完全相同的路徑（mapping='' → device-profile）。
 */

const PAD_ID = 'Radiomaster Pocket Joystick (Vendor: 1209 Product: 4f54)';
const REST_AXES = [0.015, 0, -1, -0.006, 0, 0, 0, 0];

async function installFakeRemote(page: Page): Promise<void> {
  await page.addInitScript(
    ({ id, axes }) => {
      const fake = {
        id,
        index: 0,
        connected: true,
        mapping: '',
        axes: [...axes],
        buttons: Array.from({ length: 24 }, () => ({ value: 0, pressed: false })),
      };
      (window as unknown as { __fakeGamepads: unknown[] }).__fakeGamepads = [fake];
      const impl = function (): unknown[] {
        return (window as unknown as { __fakeGamepads: unknown[] }).__fakeGamepads;
      };
      try {
        (Navigator.prototype as unknown as { getGamepads: unknown }).getGamepads = impl;
      } catch {
        Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: impl });
      }
    },
    { id: PAD_ID, axes: REST_AXES },
  );
}

/** 推某一軸（其餘回到靜止）；axis = -1 表示全部回中。 */
async function pushAxis(page: Page, axis: number, value: number): Promise<void> {
  await page.evaluate(
    ({ axis, value, rest }) => {
      const pad = (window as unknown as { __fakeGamepads: Array<{ axes: number[] }> }).__fakeGamepads[0];
      for (let i = 0; i < pad.axes.length; i += 1) pad.axes[i] = rest[i];
      if (axis >= 0) pad.axes[axis] = value;
    },
    { axis, value, rest: REST_AXES },
  );
}

interface Pose {
  x: number;
  z: number;
  heading: number;
}

async function readPose(page: Page): Promise<Pose> {
  return page.evaluate(() => {
    const x = document.querySelector('[data-position-x]');
    const z = document.querySelector('[data-position-z]');
    const heading = document.querySelector('[data-heading]');
    return {
      x: Number(x?.textContent ?? NaN),
      z: Number(z?.textContent ?? NaN),
      heading: Number((heading?.textContent ?? '0').replace('°', '')),
    };
  });
}

/** 解鎖 + 起飛 + 等定高，並把油門放在中間（定高）。 */
async function takeOff(page: Page): Promise<void> {
  await page.click('[data-action="arm"]');
  await page.click('[data-action="takeoff"]');
  await expect(page.locator('[data-flight-state]')).toHaveText('飛行中', { timeout: 15_000 });
  await pushAxis(page, 2, 0); // 油門 0.5 → 定高
  await page.waitForTimeout(600);
}

test.describe('方向迴歸：推桿 → HUD 的 X / Z（症狀 C）', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeRemote(page);
    await page.goto('/');
    await expect(page.locator('[data-rc-hud-title]')).toContainText('遙控器已連接', { timeout: 20_000 });
  });

  test('航向 0°：右桿前推 → Z 變負、X 幾乎不動', async ({ page }) => {
    await takeOff(page);
    const before = await readPose(page);

    await pushAxis(page, 1, 0.984); // 右桿上推（axis1）
    await page.waitForTimeout(1_600);
    const after = await readPose(page);
    await pushAxis(page, -1, 0);

    const dx = after.x - before.x;
    const dz = after.z - before.z;
    console.log(`[heading 0] pitch → Δx=${dx.toFixed(2)} Δz=${dz.toFixed(2)}`);
    expect(dz).toBeLessThan(-2);
    expect(Math.abs(dx)).toBeLessThan(0.5);
  });

  test('航向 0°：右桿右打 → X 變正、Z 幾乎不動', async ({ page }) => {
    await takeOff(page);
    const before = await readPose(page);

    await pushAxis(page, 0, 0.984); // 右桿右打（axis0）
    await page.waitForTimeout(1_600);
    const after = await readPose(page);
    await pushAxis(page, -1, 0);

    const dx = after.x - before.x;
    const dz = after.z - before.z;
    console.log(`[heading 0] roll → Δx=${dx.toFixed(2)} Δz=${dz.toFixed(2)}`);
    expect(dx).toBeGreaterThan(2);
    expect(Math.abs(dz)).toBeLessThan(0.5);
  });

  test('航向約 90°：右桿前推仍然「往前」（沿機頭），不再橫移', async ({ page }) => {
    await takeOff(page);

    // 打偏航直到 HUD 的航向真的超過 60°（90°/s，但每台機器帧率不同，用讀值確認）。
    await pushAxis(page, 3, 0.984);
    await expect
      .poll(async () => (await readPose(page)).heading, { timeout: 15_000 })
      .toBeGreaterThan(60);
    await pushAxis(page, -1, 0);
    await page.waitForTimeout(1_500); // 等殘速衰減

    const before = await readPose(page);
    await pushAxis(page, 2, 0);
    await pushAxis(page, 1, 0.984);
    await page.waitForTimeout(1_600);
    const after = await readPose(page);
    await pushAxis(page, -1, 0);

    const dx = after.x - before.x;
    const dz = after.z - before.z;
    // 用實際航向投影：沿機頭分量必須是正的、橫向分量必須接近 0。
    const radians = (before.heading * Math.PI) / 180;
    const alongNose = dx * Math.sin(radians) + dz * -Math.cos(radians);
    const acrossNose = Math.abs(dx * -Math.cos(radians) + dz * Math.sin(radians));
    console.log(
      `[heading ${before.heading}°] pitch → Δx=${dx.toFixed(2)} Δz=${dz.toFixed(2)} 沿機頭=${alongNose.toFixed(2)} 橫向=${acrossNose.toFixed(2)}`,
    );
    expect(alongNose).toBeGreaterThan(2);
    expect(acrossNose).toBeLessThan(alongNose);
  });
});

test.describe('鏈路 HUD：raw → norm → cmd → 位移', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeRemote(page);
    await page.goto('/');
    await expect(page.locator('[data-rc-hud-title]')).toContainText('遙控器已連接', { timeout: 20_000 });
  });

  test('推 pitch 時四欄都有數字，且判定為鏈路正常', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 900, '鏈路 HUD 在窄版（手機）隱藏');
    await takeOff(page);

    await pushAxis(page, 1, 0.984);
    await page.waitForTimeout(1_200);

    const row = page.locator('[data-rc-chain-row="pitch"]');
    await expect(row.locator('[data-rc-chain-raw="pitch"]')).toHaveText(/^\+0\.9\d$/);
    await expect(row.locator('[data-rc-chain-norm="pitch"]')).toHaveText(/^\+?(0\.9\d|1\.00)$/);
    await expect(row.locator('[data-rc-chain-cmd="pitch"]')).toHaveText(/^\+?(0\.9\d|1\.00)$/);
    await expect(row.locator('[data-rc-chain-move="pitch"]')).toHaveText(/^前 \+/);
    await expect(row).toHaveAttribute('data-verdict', 'ok');
    await expect(page.locator('[data-rc-chain]')).toHaveAttribute('data-layer', 'ok');
    await expect(page.locator('[data-rc-chain-message]')).toContainText('鏈路正常');

    await pushAxis(page, -1, 0);
  });

  test('靜止時鏈路顯示 idle，不會誤報任何一層出錯', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 900, '鏈路 HUD 在窄版（手機）隱藏');
    await expect(page.locator('[data-rc-chain]')).toHaveAttribute('data-layer', 'idle');
    await expect(page.locator('[data-rc-chain-message]')).toContainText('靜止');
    await expect(page.locator('[data-rc-chain-row="pitch"]')).toHaveAttribute('data-verdict', 'idle');
  });
});
