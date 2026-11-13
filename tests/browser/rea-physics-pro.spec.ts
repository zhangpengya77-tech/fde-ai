import { expect, test } from '@playwright/test';

/**
 * PHYSICS PRO 真實 SITL 整合測試（需要本機已啟動 FDE-DT 服務，且環境變數 REA_PRO=1、REA_PRO_TOKEN=<金鑰>）。
 * 一般回歸測試會略過本檔（沒有 SITL 也能跑完其他測試）。
 */
// 專案沒有 @types/node，這裡只宣告用到的 process.env
declare const process: { env: Record<string, string | undefined> };
const enabled = process.env.REA_PRO === '1';
const TOKEN = process.env.REA_PRO_TOKEN ?? '';
const expectedSimulator = process.env.REA_PRO_GAZEBO === '1' ? 'gazebo_ardupilot_sitl' : 'ardupilot_sitl';

test.describe('PHYSICS PRO（ArduPilot SITL）', () => {
  test.skip(!enabled, '需要本機 FDE-DT 服務（設定 REA_PRO=1）');
  test.setTimeout(240_000);

  test('切換到 PHYSICS PRO → SITL 準備 → 解鎖 → 鍵盤升高 → 標示版本 → 重來時釋放', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', '本機只能同時一台 SITL，只在桌機專案跑');
    await page.addInitScript(([token]) => {
      Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, writable: true, value: () => [] });
      localStorage.setItem('fde-rea-exam-prefs-v1', JSON.stringify({ engine: 'physics_pro', proBase: 'http://127.0.0.1:8200', proToken: token, mode: 'position', subjectId: 'hover-small', airframeId: 'quad-800g' }));
    }, [TOKEN]);
    await page.goto('/?mode=exam&exam=0');
    await expect(page.locator('[data-rea-engine]')).toContainText('PHYSICS PRO');
    await page.locator('[data-rea-start]').click();
    await expect(page.locator('[data-rea-hint]')).toContainText(/SITL|連線/);
    // SITL 開機、GPS／EKF 收斂、解鎖：最多等 150 秒
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>('.rea-root')?.dataset.reaPhase), { timeout: 150_000, intervals: [1000] }).toMatch(/countdown|flying/);
    await expect(page.locator('[data-rea-engine]')).toContainText('Copter-4.7.2');
    await expect(page.locator('[data-rea-engine]')).toHaveAttribute('data-simulator-type', expectedSimulator);
    await page.waitForTimeout(3500); // 倒數
    await page.locator('[data-rea-canvas]').click({ force: true });
    await page.keyboard.down('r'); // 油門 0.75 → LOITER 爬升
    await expect.poll(() => page.evaluate(() => Number(document.querySelector<HTMLElement>('[data-rea-hud]')?.dataset.alt ?? 0)), { timeout: 30_000 }).toBeGreaterThan(1);
    // HUD 與 Three.js 飛機的高度都必須由同一筆 Gateway ENU 遙測而來，不能只更新文字。
    await expect.poll(() => page.evaluate(() => Number(document.querySelector<HTMLElement>('[data-rea-canvas]')?.dataset.reaDroneHeight ?? 0)), { timeout: 10_000 }).toBeGreaterThan(1);
    const [hudHeight, droneHeight] = await page.evaluate(() => [
      Number(document.querySelector<HTMLElement>('[data-rea-hud]')?.dataset.alt ?? 0),
      Number(document.querySelector<HTMLElement>('[data-rea-canvas]')?.dataset.reaDroneHeight ?? 0),
    ]);
    expect(Math.abs(hudHeight - droneHeight)).toBeLessThan(0.05);
    await page.keyboard.up('r');
    await expect(page.locator('[data-rea-faults]')).toBeVisible();
    await page.screenshot({ path: 'docs/rea/screenshots/physics-pro-flying.png' });
    // 重來：釋放 session（服務端應回到可再建立的狀態）
    await page.keyboard.press('Backspace');
    await expect.poll(async () => {
      const r = await page.request.post('http://127.0.0.1:8200/api/v1/sessions', { headers: { 'X-FDE-DT-Token': TOKEN } });
      const ok = r.status();
      if (ok === 201) {
        const id = (await r.json()).session_id;
        await page.request.delete(`http://127.0.0.1:8200/api/v1/sessions/${id}`, { headers: { 'X-FDE-DT-Token': TOKEN } });
      }
      return ok;
    }, { timeout: 20_000, intervals: [2000] }).toBe(201);
  });
});
