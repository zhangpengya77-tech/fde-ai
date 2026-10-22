import { expect, test, type Page } from '@playwright/test';

/**
 * M1 真機除錯閉環（browser 級）：
 *  - 生效 profile 必須「看得見」：檔名 / savedAtMs / 來源 / 對應，全部在畫面上；
 *  - 即時通道必須顯示 原始值 / 對應功能 / 反向 / 歸一化值；
 *  - 引導式標定以「實際推動的軸」為準，同軸報錯，儲存後立即生效；
 *  - IndexedDB 舊檔不得蓋過更新的擷取檔；手動儲存永遠優先；
 *  - 「清除本機標定並重新載入」真的刪掉本機檔並重跑導入鏈。
 *
 * 這些測試用 test double 重現 RadioMaster Pocket 的真實軸佈局
 * （2026-10-22 軸向探針實測：axis0=右左右, axis1=右上下(上=+1),
 *  axis2=左上下(油門,靜止=-1), axis3=左左右；mapping='' 非標準）。
 * 2026-10-22 真機實測 axis1 推上為正，歷史紀錄 -1 已不適用（pitch 不再反轉）。
 * 真機驗收仍以教師現場推桿為準（見 PENDING_DEVICE_TEST）。
 */

const PAD_ID = 'Radiomaster Pocket Joystick (Vendor: 1209 Product: 4f54)';
const BUNDLED_FILE = 'rc-profile-latest.json';
const BUNDLED_SAVED_AT = 1_792_630_304_022;
/** 探測實測靜止值：右搖桿左右微偏 +0.015、左油門在底部 -1、左偏航微偏 -0.006。 */
const REST_AXES = [0.015, 0, -1, -0.006, 0, 0, 0, 0];
/**
 * 實測標定的 min/max 是 ±0.984 左右，且死區會把 0.995 重新標到 1，
 * 所以「推滿」顯示 +1.00 而不是 +0.98。斷言只要求「接近滿舵且為正」。
 */
const POSITIVE_NEAR_FULL = /^\+0\.(8\d|9\d)$|^\+1\.00$/;

async function installFakeRemote(page: Page): Promise<void> {
  await page.addInitScript(
    ({ id, axes }) => {
      const fake = {
        id,
        index: 0,
        connected: true,
        mapping: '', // 非標準對應：與真機一致，強制走 device-profile 路徑
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
        Object.defineProperty(Navigator.prototype, 'getGamepads', {
          configurable: true,
          writable: true,
          value: impl,
        });
      }
    },
    { id: PAD_ID, axes: REST_AXES },
  );
}

/** 把假遙控器某一軸推到指定值（其餘回到靜止）。 */
async function pushAxis(page: Page, axis: number, value: number): Promise<void> {
  await page.evaluate(
    ({ axis, value, rest }) => {
      const pads = (window as unknown as { __fakeGamepads: Array<{ axes: number[] }> }).__fakeGamepads;
      const pad = pads[0];
      for (let i = 0; i < pad.axes.length; i += 1) pad.axes[i] = rest[i];
      pad.axes[axis] = value;
    },
    { axis, value, rest: REST_AXES },
  );
}

/** 直接把一把「舊標定」寫進 IndexedDB（模擬教師瀏覽器裡的殘留檔）。 */
async function seedStaleProfile(page: Page, savedAtMs: number, label: string): Promise<void> {
  await page.evaluate(
    async ({ id, savedAtMs, label }) => {
      const profile = {
        id,
        label,
        type: 'gamepad',
        mode: 'custom',
        // 08-20 axesswap 的錯誤映射：roll/pitch 的 source 互換。
        axes: {
          roll: { source: 1, kind: 'bipolar', calibration: { min: -1, center: 0, max: 1, reverse: true, deadzone: 0, expo: 0 } },
          pitch: { source: 0, kind: 'bipolar', calibration: { min: -1, center: 0, max: 1, reverse: false, deadzone: 0, expo: 0 } },
          yaw: { source: 2, kind: 'bipolar', calibration: { min: -1, center: 0, max: 1, reverse: false, deadzone: 0, expo: 0 } },
          throttle: { source: 3, kind: 'unipolar', calibration: { min: -1, center: -1, max: 1, reverse: false, deadzone: 0, expo: 0 } },
        },
        gimbal: null,
        armButton: null,
        unsupported: false,
      };
      const doc = { schema: 'fde.device-profile/1', profile, savedAtMs };
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('fde-power-inspection', 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('device-profiles')) db.createObjectStore('device-profiles');
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('device-profiles', 'readwrite');
          tx.objectStore('device-profiles').put(doc, `fde.device-profile/${id}`);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    },
    { id: PAD_ID, savedAtMs, label },
  );
}

async function restoreAllAxes(page: Page): Promise<void> {
  await page.evaluate((rest) => {
    const pads = (window as unknown as { __fakeGamepads: Array<{ axes: number[] }> }).__fakeGamepads;
    if (pads[0]) for (let i = 0; i < pads[0].axes.length; i += 1) pads[0].axes[i] = rest[i];
  }, REST_AXES);
}

test.describe('M1 RC profile visibility & guided calibration (simulated RadioMaster)', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeRemote(page);
  });

  test('shows the actually-loaded capture (file / savedAtMs / origin / mapping) on screen', async ({ page }) => {
    await page.goto('/');

    // dev server 沒有 /api/rc/latest-profile → 靜態回退檔生效。
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });
    await expect(page.locator('[data-active-file]')).toHaveText(BUNDLED_FILE);
    await expect(page.locator('[data-active-saved]')).toContainText(String(BUNDLED_SAVED_AT));
    await expect(page.locator('[data-active-device]')).toHaveText(PAD_ID);

    // 映射必須是 probe 驗證過的美國手 Mode 2（2026-10-22 起 pitch 不反轉）。
    const mapping = page.locator('[data-active-mapping]');
    await expect(mapping).toContainText('Roll←axis0');
    await expect(mapping).toContainText('Pitch←axis1');
    await expect(mapping).toContainText('Yaw←axis3');
    await expect(mapping).toContainText('Thr←axis2');
  });

  test('channel monitor shows raw value, mapped function, reverse and normalized value', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });

    // axis0 → Roll（不反向）
    await expect(page.locator('[data-channel-map="0"]')).toHaveText(/Roll/);
    await expect(page.locator('[data-channel-map="0"]')).not.toContainText('反');
    // axis1 → Pitch（2026-10-22 起不反向）
    await expect(page.locator('[data-channel-map="1"]')).toHaveText(/Pitch/);
    await expect(page.locator('[data-channel-map="1"]')).not.toContainText('反');
    // axis3 → Yaw
    await expect(page.locator('[data-channel-map="3"]')).toHaveText(/Yaw/);
    // axis4-7 未使用
    await expect(page.locator('[data-channel-map="4"]')).toHaveText('未使用');

    // 右搖桿上推（axis1 = +0.98）：Pitch 歸一化必須為 +0.98（前進）。
    await pushAxis(page, 1, 0.98);
    await expect(page.locator('[data-channel-raw="1"]')).toHaveText('0.980', { timeout: 5_000 });
    await expect(page.locator('[data-channel-norm="1"]')).toHaveText(POSITIVE_NEAR_FULL, { timeout: 5_000 });

    // 右搖桿右打（axis0 = +0.98）：Roll 歸一化 +0.98（右移）。
    await pushAxis(page, 0, 0.98);
    await expect(page.locator('[data-channel-raw="0"]')).toHaveText('0.980', { timeout: 5_000 });
    await expect(page.locator('[data-channel-norm="0"]')).toHaveText(POSITIVE_NEAR_FULL, { timeout: 5_000 });

    // 油門推頂（axis2 = +1）：Throttle 歸一化 1.00。
    await pushAxis(page, 2, 1);
    await expect(page.locator('[data-channel-norm="2"]')).toHaveText('+1.00', { timeout: 5_000 });
    await restoreAllAxes(page);
  });

  test('the flight HUD pins the active capture and the four live control values', async ({ page }) => {
    await page.goto('/');

    const hud = page.locator('[data-rc-hud]');
    await expect(hud).toHaveAttribute('data-state', 'live', { timeout: 15_000 });
    // 回答「我到底在飛哪一份」：來源 / 檔名 / savedAtMs / 四軸映射
    await expect(page.locator('[data-rc-hud-origin]')).toHaveText('靜態回退檔');
    await expect(page.locator('[data-rc-hud-file]')).toHaveText(BUNDLED_FILE);
    await expect(page.locator('[data-rc-hud-saved]')).toContainText('2026');
    const mapping = page.locator('[data-rc-hud-mapping]');
    await expect(mapping).toContainText('R←a0');
    await expect(mapping).toContainText('P←a1');
    await expect(mapping).toContainText('Y←a3');
    await expect(mapping).toContainText('T←a2');

    // 真機驗收的兩個關鍵動作：數字必須是「右桿上推 → Pitch +」「右桿右打 → Roll +」
    await pushAxis(page, 1, 0.98);
    await expect(page.locator('[data-rc-hud-value="pitch"]')).toHaveText(POSITIVE_NEAR_FULL, { timeout: 5_000 });

    await pushAxis(page, 0, 0.98);
    await expect(page.locator('[data-rc-hud-value="roll"]')).toHaveText(POSITIVE_NEAR_FULL, { timeout: 5_000 });
    await expect(page.locator('[data-rc-hud-value="pitch"]')).toHaveText('+0.00', { timeout: 5_000 });

    await pushAxis(page, 2, 1);
    await expect(page.locator('[data-rc-hud-value="throttle"]')).toHaveText('1.00', { timeout: 5_000 });
    await restoreAllAxes(page);
  });

  test('the flight HUD reports the preset draft when no capture is reachable', async ({ page }) => {
    await page.route('**/rc-profile-latest.json', (route) => route.abort());
    await page.route('**/api/rc/latest-profile', (route) => route.abort());
    await page.goto('/');

    await expect(page.locator('[data-rc-hud]')).toHaveAttribute('data-state', 'live', { timeout: 15_000 });
    await expect(page.locator('[data-rc-hud-origin]')).toHaveText('預設草稿（未實測）');
    await expect(page.locator('[data-rc-hud-file]')).toContainText('本機');
  });

  test('a stale stored profile never shadows a newer capture', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });

    // 寫入 08-20 的錯誤檔（savedAtMs 遠舊於內建擷取檔）→ 重載必須自動升級。
    await seedStaleProfile(page, 1, 'axesswap (錯誤)');
    await page.reload();
    await expect(page.locator('[data-active-file]')).toHaveText(BUNDLED_FILE, { timeout: 15_000 });
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退');
    // 升級後映射必須回到正確的美國手（不是 axesswap 的互換版）。
    await expect(page.locator('[data-active-mapping]')).toContainText('Pitch←axis1');
  });

  test('the calibration panel can be expanded into a readable overlay', async ({ page }) => {
    await page.goto('/');
    const panel = page.locator('[data-calibration-anchor]');
    const toggle = page.locator('[data-calibration-action="expand"]');
    await expect(panel).not.toHaveClass(/is-expanded/);
    await expect(toggle).toHaveText('放大面板');

    await toggle.click();
    await expect(panel).toHaveClass(/is-expanded/);
    await expect(toggle).toHaveText('縮小面板');

    await toggle.click();
    await expect(panel).not.toHaveClass(/is-expanded/);
  });

  test('warns loudly when the local profile disagrees with the newest capture', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });

    // 本機檔時間戳比擷取檔新（例如教師剛剛按過「保存標定」），映射卻是舊的。
    await seedStaleProfile(page, Date.now() + 60_000, 'local axesswap');
    await page.reload();

    await expect(page.locator('[data-active-origin]')).toContainText('IndexedDB', { timeout: 15_000 });
    await expect(page.locator('[data-active-origin]')).toContainText('映射不同');
    await expect(page.locator('[data-rc-hud-origin]')).toContainText('映射不同');
    // 本機檔仍然生效（時間戳優先），但畫面必須顯示它綁的是舊映射。
    await expect(page.locator('[data-active-mapping]')).toContainText('Pitch←axis0');
    await expect(page.locator('.calibration-hint')).toContainText('清除本機標定並重新載入');
  });

  test('a manual save always beats the bundled capture', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });

    await page.locator('[data-calibration-action="save"]').click();
    await expect(page.locator('[data-active-origin]')).toContainText('手動儲存');

    await page.reload();
    await expect(page.locator('[data-active-origin]')).toContainText('手動儲存', { timeout: 15_000 });

    // 清除本機標定 → 重新導入內建擷取檔。
    await page.locator('[data-calibration-action="clear"]').click();
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });
    await expect(page.locator('[data-active-file]')).toHaveText(BUNDLED_FILE);
  });

  test('guided calibration binds measured axes, rejects duplicates and applies immediately', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });

    // 先停在正確的靜止值再開始。
    await restoreAllAxes(page);

    // --- 第 1 步：右搖桿最上 → pitch ← axis1（不反向） ---------------------
    await page.locator('[data-guided-action="start"]').click();
    await expect(page.locator('[data-guided-step]')).toHaveText('第 1 / 4 步');
    // 2026-10-22 真機實測：右桿上推 axis1 為正（峰值 +0.984）。
    await pushAxis(page, 1, 0.98);
    await expect(page.locator('[data-guided-detection]')).toContainText('俯仰 Pitch ← axis1', { timeout: 5_000 });
    await expect(page.locator('[data-guided-detection]')).toContainText('reverse=false');
    await page.locator('[data-guided-action="confirm"]').click();

    // --- 第 2 步：故意再推 axis1 → 同軸錯誤，不許確認 ---------------------
    // 先把搖桿回中：基線被污染時偵測會失效（面板會拒絕開始並提示回中）。
    await restoreAllAxes(page);
    await expect(page.locator('[data-guided-step]')).toHaveText('第 2 / 4 步');
    await page.locator('[data-guided-action="start"]').click();
    await pushAxis(page, 1, -0.9);
    await expect(page.locator('[data-guided-error]')).toContainText('axis1', { timeout: 5_000 });
    await expect(page.locator('[data-guided-error]')).toContainText('已分配給');
    await expect(page.locator('[data-guided-action="confirm"]')).toBeHidden();

    // 重做，改推右搖桿最右 → roll ← axis0（不反向）
    await restoreAllAxes(page);
    await page.locator('[data-guided-action="retry"]').click();
    await page.locator('[data-guided-action="start"]').click();
    await pushAxis(page, 0, 0.984);
    await expect(page.locator('[data-guided-detection]')).toContainText('橫滾 Roll ← axis0', { timeout: 5_000 });
    await expect(page.locator('[data-guided-detection]')).toContainText('reverse=false');
    await page.locator('[data-guided-action="confirm"]').click();

    // --- 第 3 步：左搖桿最右 → yaw ← axis3 ---------------------------------
    await expect(page.locator('[data-guided-step]')).toHaveText('第 3 / 4 步');
    await restoreAllAxes(page);
    await page.locator('[data-guided-action="start"]').click();
    await pushAxis(page, 3, 0.98);
    await expect(page.locator('[data-guided-detection]')).toContainText('偏航 Yaw ← axis3', { timeout: 5_000 });
    await page.locator('[data-guided-action="confirm"]').click();

    // --- 第 4 步：左搖桿最上 → throttle ← axis2（單向）---------------------
    await expect(page.locator('[data-guided-step]')).toHaveText('第 4 / 4 步');
    await restoreAllAxes(page);
    await page.locator('[data-guided-action="start"]').click();
    await pushAxis(page, 2, 1);
    await expect(page.locator('[data-guided-detection]')).toContainText('油門 Throttle ← axis2', { timeout: 5_000 });
    await page.locator('[data-guided-action="confirm"]').click();

    // 完成 → 儲存並套用（不重整頁面）
    await expect(page.locator('[data-guided-step]')).toHaveText('四個功能已全部實測完成');
    await page.locator('[data-guided-action="save"]').click();
    await expect(page.locator('[data-active-origin]')).toContainText('引導式標定');
    await expect(page.locator('[data-active-mapping]')).toContainText('Pitch←axis1');
    await expect(page.locator('[data-active-mapping]')).toContainText('Roll←axis0');
    await expect(page.locator('[data-active-mapping]')).toContainText('Yaw←axis3');
    await expect(page.locator('[data-active-mapping]')).toContainText('Thr←axis2');
    await expect(page.locator('.calibration-hint')).toContainText('已套用引導標定');

    // 立即生效：歸一化值即時反映新 mapping（無需重整）。
    await pushAxis(page, 1, 0.98);
    await expect(page.locator('[data-channel-norm="1"]')).toHaveText(POSITIVE_NEAR_FULL, { timeout: 5_000 });
    await restoreAllAxes(page);

    // 重載後本機儲存的引導標定仍在（手動時間戳優先於內建擷取檔）。
    await page.reload();
    await expect(page.locator('[data-active-origin]')).toContainText('引導式標定', { timeout: 15_000 });
  });

  test('guided calibration refuses to arm while a self-centring stick is off centre', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });

    // 先把右搖桿推住不放，再按「開始這步」：基線會被污染，必須拒絕。
    await pushAxis(page, 1, -0.9);
    await page.locator('[data-guided-action="start"]').click();
    await expect(page.locator('.calibration-hint')).toContainText('尚未回中', { timeout: 5_000 });
    await expect(page.locator('.calibration-hint')).toContainText('axis1');
    // 沒有進入偵測狀態：偵測結果與確認按鈕都不出現。
    await expect(page.locator('[data-guided-detection]')).toBeHidden();
    await expect(page.locator('[data-guided-action="confirm"]')).toBeHidden();

    // 回中後即可正常開始。
    await restoreAllAxes(page);
    await page.locator('[data-guided-action="start"]').click();
    await expect(page.locator('.calibration-hint')).toContainText('偵測中');
  });

  test('stick axis quick test judges a correct binding and a wrong source', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });
    await restoreAllAxes(page);

    // --- 映射正確：右桿上推 → axis1，pitch 不反向 → 判 ok --------------
    await page.locator('[data-stick-probe="pitch"]').click();
    // 2026-10-22 真機實測：右桿上推 axis1 = +0.984。
    await pushAxis(page, 1, 0.98);
    await page.waitForTimeout(250);
    await restoreAllAxes(page);
    const pitchResult = page.locator('[data-stick-probe-result="pitch"]');
    await expect(pitchResult).toContainText('右桿上下 = axis1', { timeout: 5_000 });
    await expect(pitchResult).toContainText('推上為正');
    await expect(pitchResult).toContainText('pitch←a1');
    await expect(pitchResult).toContainText('正確');
    await expect(pitchResult).toHaveAttribute('data-verdict', 'ok');

    // --- source 綁錯：同一項測試卻去推 axis0 → 建議改 pitch←a0 -------------
    await restoreAllAxes(page);
    await page.locator('[data-stick-probe="pitch"]').click();
    await pushAxis(page, 0, -0.98);
    await page.waitForTimeout(250);
    await restoreAllAxes(page);
    await expect(pitchResult).toContainText('source 綁錯', { timeout: 5_000 });
    await expect(pitchResult).toContainText('建議改 pitch←a0');
    await expect(pitchResult).toHaveAttribute('data-verdict', 'wrong-source');

    // 只記錄，不改任何映射：面板上的 pitch 仍綁 axis1。
    await expect(page.locator('[data-active-mapping]')).toContainText('Pitch←axis1');
  });

  test('stick axis quick test shows the no-gamepad message without a controller', async ({ page }) => {
    // 這個測試不裝假遙控器：直接把 getGamepads 回空。
    await page.addInitScript(() => {
      const impl = function (): unknown[] {
        return [];
      };
      try {
        (Navigator.prototype as unknown as { getGamepads: unknown }).getGamepads = impl;
      } catch {
        Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, writable: true, value: impl });
      }
    });
    await page.goto('/');
    const hint = page.locator('[data-stick-probe-empty]');
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await expect(hint).toHaveText('未偵測到搖桿。USB：請選 USB Joystick (HID)；藍牙：瀏覽器無法讀取');
  });

  test('stick axis quick test reports insufficient (結論無效) below the 0.5 peak bar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });
    await restoreAllAxes(page);

    // 只輕推到 -0.4（峰值 0.4 < 0.5）：即便軸是對的，也只能判「結論無效」。
    await page.locator('[data-stick-probe="pitch"]').click();
    await pushAxis(page, 1, -0.4);
    await page.waitForTimeout(250);
    await restoreAllAxes(page);
    const pitchResult = page.locator('[data-stick-probe-result="pitch"]');
    await expect(pitchResult).toHaveAttribute('data-verdict', 'insufficient', { timeout: 5_000 });
    await expect(pitchResult).toContainText('結論無效');
    await expect(pitchResult).not.toContainText('正確');
  });

  test('raw axis recorder captures 10s, ranks axes and reveals the driven axis', async ({ page }) => {
    // 加速：把 >=9000ms 的計時器（10 秒錄製視窗）壓到 400ms，讓測試不必真的等 10 秒。
    await page.addInitScript(() => {
      const original = window.setTimeout.bind(window);
      (window as unknown as { setTimeout: unknown }).setTimeout = (
        fn: TimerHandler,
        ms?: number,
        ...rest: unknown[]
      ) => original(fn, typeof ms === 'number' && ms >= 9000 ? 400 : ms, ...(rest as []));
    });
    await page.goto('/');
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });
    await restoreAllAxes(page);

    await page.locator('[data-record-action="start"]').click();
    await expect(page.locator('[data-record-status]')).toContainText('畫圈');
    // 模擬「畫圈」：把 axis0（roll）來回推，其餘靜止。
    await pushAxis(page, 0, 0.7);
    await page.waitForTimeout(60);
    await pushAxis(page, 0, -0.7);
    await page.waitForTimeout(60);
    await restoreAllAxes(page);

    const results = page.locator('[data-record-results]');
    await expect(results).toContainText('axis0', { timeout: 5_000 });
    await expect(results).toContainText('變化');
    await expect(page.locator('[data-record-status]')).toContainText('錄製完成', { timeout: 5_000 });
    await expect(page.locator('[data-record-action="export"]')).toBeVisible();
  });

  test('recording suggestion applies only the channel that differs (verified roll stays untouched)', async ({ page }) => {
    // 加速錄製視窗，並把本機 pitch 綁成「綁錯的 axis0 / reverse=false」，
    // roll 維持已實測驗證的 axis0 / false。
    await page.addInitScript(() => {
      const original = window.setTimeout.bind(window);
      (window as unknown as { setTimeout: unknown }).setTimeout = (
        fn: TimerHandler,
        ms?: number,
        ...rest: unknown[]
      ) => original(fn, typeof ms === 'number' && ms >= 9000 ? 1800 : ms, ...(rest as []));
    });
    await page.goto('/');
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });
    await page.evaluate(async () => {
      const id = 'Radiomaster Pocket Joystick (Vendor: 1209 Product: 4f54)';
      const base = {
        id,
        label: 'wrong-pitch-only',
        type: 'gamepad',
        mode: 'custom',
        axes: {
          roll: { source: 0, kind: 'bipolar', calibration: { min: -1, center: 0, max: 1, reverse: false, deadzone: 0.05, expo: 0 } },
          // pitch 綁到 axis0 且不反向：與真機（上推 = axis1 負）不一致
          pitch: { source: 0, kind: 'bipolar', calibration: { min: -1, center: 0, max: 1, reverse: false, deadzone: 0.05, expo: 0 } },
          yaw: { source: 3, kind: 'bipolar', calibration: { min: -1, center: 0, max: 1, reverse: false, deadzone: 0.05, expo: 0 } },
          throttle: { source: 2, kind: 'unipolar', calibration: { min: -1, center: -1, max: 1, reverse: false, deadzone: 0.02, expo: 0 } },
        },
        gimbal: null,
        armButton: null,
        unsupported: false,
      };
      const doc = { schema: 'fde.device-profile/1', profile: base, savedAtMs: Date.now() };
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('fde-power-inspection', 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('device-profiles')) db.createObjectStore('device-profiles');
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('device-profiles', 'readwrite');
          tx.objectStore('device-profiles').put(doc, `fde.device-profile/${id}`);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    });
    await restoreAllAxes(page);
    await page.reload();
    await expect(page.locator('[data-active-origin]')).toContainText('本機', { timeout: 15_000 });
    await expect(page.locator('[data-source="pitch"]')).toHaveValue('0');
    await expect(page.locator('[data-source="roll"]')).toHaveValue('0');

    // 畫圈：上(axis1 負) → 右(axis0 正) → 下(axis1 正) → 左(axis0 負)
    await page.locator('[data-record-action="start"]').click();
    await pushAxis(page, 1, -0.98);
    await page.waitForTimeout(400);
    await pushAxis(page, 0, 0.98);
    await page.waitForTimeout(400);
    await pushAxis(page, 1, 0.98);
    await page.waitForTimeout(400);
    await pushAxis(page, 0, -0.98);
    await page.waitForTimeout(400);
    await restoreAllAxes(page);

    const suggestion = page.locator('[data-record-suggestion]');
    await expect(suggestion).toContainText('右桿上下 = axis1', { timeout: 8_000 });
    await expect(suggestion).toContainText('建議 pitch ← axis1（reverse=true）');
    await expect(suggestion).toContainText('右桿左右 = axis0');
    await expect(suggestion).toContainText('建議 roll ← axis0（reverse=false）');
    await expect(suggestion).toHaveAttribute('data-verdict', 'differs');

    // 套用前先確認 roll 仍是 axis0 / false
    await expect(page.locator('[data-source="roll"]')).toHaveValue('0');
    await page.locator('[data-record-action="apply"]').click();

    // 只有 pitch 被改寫；roll 完全沒被碰（仍是 axis0、reverse=false）
    await expect(page.locator('[data-source="pitch"]')).toHaveValue('1', { timeout: 5_000 });
    await expect(page.locator('[data-source="roll"]')).toHaveValue('0');
    await expect(page.locator('[data-active-mapping]')).toContainText('Pitch←axis1');
    await expect(page.locator('[data-active-mapping]')).toContainText('Roll←axis0');
    await expect(page.locator('[data-active-origin]')).toContainText('錄製建議套用', { timeout: 5_000 });
  });

  test('recording with a sub-0.7 peak yields no suggestion and no apply button', async ({ page }) => {
    // 錄製視窗壓到 1600ms（仍遠小於 10 秒），並讓推動持續 ~900ms 以累積足夠樣本。
    await page.addInitScript(() => {
      const original = window.setTimeout.bind(window);
      (window as unknown as { setTimeout: unknown }).setTimeout = (
        fn: TimerHandler,
        ms?: number,
        ...rest: unknown[]
      ) => original(fn, typeof ms === 'number' && ms >= 9000 ? 1600 : ms, ...(rest as []));
    });
    await page.goto('/');
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });
    await restoreAllAxes(page);

    // 只輕推 0.079（與真機右桿上下的實測峰值同級）：不得給出任何建議。
    await page.locator('[data-record-action="start"]').click();
    await pushAxis(page, 1, -0.079);
    await page.waitForTimeout(900);
    await restoreAllAxes(page);

    const suggestion = page.locator('[data-record-suggestion]');
    await expect(suggestion).toHaveAttribute('data-verdict', 'invalid', { timeout: 5_000 });
    await expect(suggestion).toContainText('請推到底重錄');
    await expect(page.locator('[data-record-action="apply"]')).toBeHidden();
    // 沒有任何映射被改動
    await expect(page.locator('[data-source="pitch"]')).toHaveValue('1');
    await expect(page.locator('[data-source="roll"]')).toHaveValue('0');
  });

  test('direction acceptance panel waits for flight state and can be exported', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });
    await restoreAllAxes(page);

    const rows = page.locator('[data-acceptance-rows] .acceptance-row');
    await expect(rows).toHaveCount(3);
    for (const key of ['pitch', 'roll', 'release']) {
      await expect(page.locator(`[data-acceptance-action="${key}"]`)).toBeVisible();
      await expect(page.locator(`[data-acceptance-result="${key}"]`)).toHaveAttribute('data-verdict', 'idle');
    }
    // 尚未解鎖/起飛：判定必須是「等待」並提示先起飛，而不是誤判失敗。
    await page.locator('[data-acceptance-action="pitch"]').click();
    await expect(page.locator('[data-acceptance-result="pitch"]')).toContainText('解鎖並起飛', { timeout: 5_000 });
    await expect(page.locator('[data-acceptance-result="pitch"]')).toHaveAttribute('data-verdict', 'pending');
    // 沒有任何結果可匯出時如實提示
    await page.locator('[data-acceptance-action="export"]').click();
    await expect(page.locator('.calibration-hint')).toContainText('尚無驗收結果');
  });

  test('center compensation prompt appears for a parked offset and only updates center', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });
    await restoreAllAxes(page);

    const prompt = page.locator('[data-drift-center]');
    await expect(prompt).toBeHidden();

    // 把 axis1（pitch 的來源）「停」在 +0.2：偏離 center 0.2 > 死區 0.05
    await pushAxis(page, 1, 0.2);
    await expect(prompt).toBeVisible({ timeout: 5_000 });
    await expect(prompt).toContainText('搖桿中心偏移');
    await expect(prompt).toContainText('校正中心');
    await expect(prompt).toContainText('source / reverse');

    await page.locator('[data-drift-action="center"]').click();
    // center 被更新（讀值 0.00 → 0.20），但 source 仍是 axis1、reverse 仍未勾選（false）
    await expect(page.locator('[data-cal="pitch"]')).toContainText('0.20', { timeout: 5_000 });
    await expect(page.locator('[data-source="pitch"]')).toHaveValue('1');
    await expect(page.locator('[data-reverse="pitch"]')).not.toBeChecked();
    await expect(prompt).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('.calibration-hint')).toContainText('只更新 center');
  });

  test('drift diagnosis lists the four functions and a deadzone self-check', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });
    await restoreAllAxes(page);

    const rows = page.locator('[data-drift-rows] .drift-row');
    await expect(rows).toHaveCount(4);
    for (const key of ['roll', 'pitch', 'yaw', 'throttle']) {
      await expect(page.locator(`[data-drift-rest="${key}"]`)).not.toBeEmpty();
      await expect(page.locator(`[data-drift-norm="${key}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-drift-note]')).toHaveAttribute('data-state', /ok|warn/, { timeout: 5_000 });
    await expect(page.locator('[data-drift-action="reset"]')).toBeVisible();
  });

  test('guided calibration will not lock a step until the peak reaches 0.7', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-active-origin]')).toContainText('靜態回退', { timeout: 15_000 });
    await restoreAllAxes(page);

    await page.locator('[data-guided-action="start"]').click();

    // 只推到 -0.5（>=0.3 偵測到，<0.7 鎖定門檻）：不鎖定，顯示目前峰值，沒有確認鍵。
    await pushAxis(page, 1, -0.5);
    await page.waitForTimeout(150);
    await expect(page.locator('[data-guided-peak]')).toBeVisible();
    await expect(page.locator('[data-guided-peak]')).toContainText('目前峰值');
    await expect(page.locator('[data-guided-peak]')).toContainText('需 ≥ 0.70');
    await expect(page.locator('[data-guided-action="confirm"]')).toBeHidden();

    // 推到底（>= 0.7）：鎖定，出現偵測文字與確認鍵。
    await pushAxis(page, 1, -0.98);
    await page.waitForTimeout(150);
    await expect(page.locator('[data-guided-detection]')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('[data-guided-action="confirm"]')).toBeVisible();
    await restoreAllAxes(page);
  });

  test('preset draft matches 美國手 Mode 2 when nothing is stored and no capture is reachable', async ({ page }) => {
    // 阻斷 /api 與靜態回退：只剩預設草稿時也必須是正確的四軸佈局。
    await page.route('**/rc-profile-latest.json', (route) => route.abort());
    await page.route('**/api/rc/latest-profile', (route) => route.abort());
    await page.goto('/');

    await expect(page.locator('[data-active-origin]')).toContainText('預設草稿', { timeout: 15_000 });
    const mapping = page.locator('[data-active-mapping]');
    await expect(mapping).toContainText('Roll←axis0');
    await expect(mapping).toContainText('Pitch←axis1');
    await expect(mapping).toContainText('Yaw←axis3');
    await expect(mapping).toContainText('Thr←axis2');
  });
});

test.describe('PENDING_DEVICE_TEST: real USB hardware acceptance', () => {
  test.fixme('真機（RadioMaster Pocket）驗收：教師現場推桿，畫面讀數核對', async () => {
    // 上面的測試是 test double（重現 probe 軸佈局），證明管線與顯示；
    // 真機验收必須由教師在模擬器畫面（http://192.168.1.114:8111/sim/）完成：
    //   1. 右桿前推 → 画面 Pitch=+1、機頭下壓/前進
    //   2. 右桿右打 → 画面 Roll=+1、右移/右側下沉
    //   3. 左桿右打 → 画面 Yaw=+1
    //   4. 左桿上推 → 画面 Throttle 上升
    //   5. 任一不符 → 引導式標定重跑，或直接翻該功能的 reverse 复选框
  });
});
