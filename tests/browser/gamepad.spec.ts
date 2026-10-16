import { expect, test } from '@playwright/test';

/**
 * P1-3d - real controller input, browser level.
 *
 * These tests inject a *test double* for the Gamepad API so the training app's
 * entire radio path (GamepadInputAdapter -> PilotInputPipeline -> SimpleFlightController)
 * can be exercised without physical hardware. The injected pad is intentionally
 * generic: the flight core still never learns which brand produced the numbers.
 *
 * IMPORTANT: the simulated gamepad is NOT a claim of real-hardware acceptance.
 * Real RadioMaster EdgeTX / RadioLink AT9S / DJI FPV RC3 / CRSF-ELRS devices
 * must be validated on hardware (see the PENDING_DEVICE_TEST block at the
 * bottom). The 250 ms lost-link -> hover safety contract itself is covered
 * exhaustively by the unit suite (pilot-input-pipeline.test.ts); the browser
 * verifies the real-world trigger for it - a dropped controller link - which
 * produces the same hold-throttle / hover outcome.
 */

const FAKE_PAD_ID = 'FDE Training Gamepad (Vendor: 0xFDE0)';

/** Installs a controllable fake Gamepad API. Must run before the app evaluates. */
async function installFakeGamepad(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript((id: string) => {
    const fake = {
      id,
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, () => ({ value: 0, pressed: false })),
    };
    (window as unknown as { __fakeGamepads: unknown[] }).__fakeGamepads = [fake];
    const impl = function (): unknown[] {
      return (window as unknown as { __fakeGamepads: unknown[] }).__fakeGamepads;
    };
    try {
      (Navigator.prototype as unknown as { getGamepads: unknown }).getGamepads = impl;
    } catch {
      Object.defineProperty(Navigator.prototype, 'getGamepads', {
        configurable: true,
        writable: true,
        value: impl,
      });
    }
  }, FAKE_PAD_ID);
}

const readPositionX = (): number => {
  const el = document.querySelector('[data-position-x]');
  return el ? Number(el.textContent ?? '0') : 0;
};

const altitudeNumber = (): number => {
  const el = document.querySelector('[data-altitude]');
  const value = el?.getAttribute('data-value');
  return value ? Number(value) : Number(el?.textContent ?? '0');
};

const waitForAltitudeAbove = (
  page: import('@playwright/test').Page,
  min: number,
  timeout: number,
) =>
  page.waitForFunction(
    (threshold: number) => {
      const el = document.querySelector('[data-altitude]');
      const value = el?.getAttribute('data-value');
      const n = value ? Number(value) : Number(el?.textContent ?? '0');
      return n > threshold;
    },
    min,
    { timeout },
  );

test.describe('P1-3 pilot input: simulated USB gamepad', () => {
  test('connects a simulated gamepad and flies the F450 through RC channels', async ({ page }) => {
    await installFakeGamepad(page);
    await page.goto('/');

    const inputSource = page.locator('[data-input-source]');
    await expect(inputSource).toHaveText(/遥控器/, { timeout: 15_000 });

    // Raw RC data must reach the live channel monitor through the whole pipeline.
    const channelOne = page.locator('[data-channel-raw="0"]');
    await page.evaluate(() => {
      const pads = (window as unknown as { __fakeGamepads: Array<{ axes: number[] }> }).__fakeGamepads;
      pads[0].axes[0] = 0.6;
    });
    await expect(channelOne).toHaveText('0.600', { timeout: 5_000 });

    // Arm and take off, then let the controller (not the keyboard) fly the drone.
    await page.locator('[data-action="arm"]').click();
    await page.locator('[data-action="takeoff"]').click();
    // Wait until the F450 has actually reached the hover altitude and is 'flying'
    // (roll only steers in the flying state).
    await waitForAltitudeAbove(page, 2.9, 20_000);

    // A sustained roll deflection from the gamepad must move the aircraft.
    const startX = await page.evaluate(readPositionX);
    await page.evaluate(() => {
      const pads = (window as unknown as { __fakeGamepads: Array<{ axes: number[] }> }).__fakeGamepads;
      pads[0].axes[0] = 0.6;
    });
    await page.waitForFunction(
      (arg: number[]) => {
        const prev = arg[0];
        const el = document.querySelector('[data-position-x]');
        return el ? Math.abs(Number(el.textContent ?? '0') - prev) > 0.2 : false;
      },
      [startX],
      { timeout: 15_000 },
    );

    const movedX = await page.evaluate(readPositionX);
    expect(Math.abs(movedX - startX)).toBeGreaterThan(0.2);
  });

  test('falls back to keyboard and holds hover when the controller link is lost', async ({ page }) => {
    await installFakeGamepad(page);
    await page.goto('/');

    const inputSource = page.locator('[data-input-source]');
    await expect(inputSource).toHaveText(/遥控器/, { timeout: 15_000 });

    await page.locator('[data-action="arm"]').click();
    await page.locator('[data-action="takeoff"]').click();
    // Reach a stable hover before the link is pulled, otherwise the climb is
    // still in progress and the lost-link test would measure the wrong state.
    await waitForAltitudeAbove(page, 2.9, 20_000);

    // Lose the link: remove the gamepad from the API surface entirely.
    await page.evaluate(() => {
      (window as unknown as { __fakeGamepads: unknown[] }).__fakeGamepads = [];
    });

    // The app must drop back to the keyboard source.
    await expect(inputSource).toHaveText('键盘', { timeout: 8_000 });

    // A lost link is a safety event: the aircraft must hover and hold altitude,
    // never snap the throttle to zero and drop.
    await expect(page.locator('[data-flight-mode]')).toHaveText('悬停', { timeout: 8_000 });
    await page.waitForTimeout(3_000);
    const altitudeAfter = await page.evaluate(altitudeNumber);
    expect(altitudeAfter).toBeGreaterThan(2.5);
  });
});

test.describe('PENDING_DEVICE_TEST: real USB hardware acceptance', () => {
  test.fixme(
    'RadioMaster EdgeTX / RadioLink AT9S / DJI FPV RC3 / CRSF-ELRS must be validated on real hardware',
    async () => {
      // The simulated Gamepad API above is a TEST DOUBLE. It proves the wiring,
      // calibration wizard and lost-link fallback, but it is NOT proof that a real
      // RadioMaster EdgeTX stick, RadioLink AT9S simulator dongle, DJI FPV Remote
      // Controller 3 or a CRSF/ELRS receiver bridge flies the F450 correctly.
      //
      // Acceptance procedure (manual, on hardware):
      //   1. Plug the device; confirm the calibration panel shows "已连接".
      //   2. Run the wizard once: capture Min/Center/Max for Roll/Pitch/Yaw/Throttle,
      //      set reverse on the throttle axis if needed, then Save.
      //   3. Fly the teaching scenario with the device only (no keyboard).
      //   4. Verify: arm, takeoff, fly to the tower, hold safe distance, aim gimbal,
      //      capture, judge, land, and that scoring/save works end to end.
      //   5. Unplug mid-flight and confirm the aircraft hovers and holds altitude.
      //
      // Until every supported device passes step 1-5, this item stays
      // PENDING_DEVICE_TEST and must NOT be claimed as PASS.
    },
  );
});
