import { expect, test, type Page } from '@playwright/test';

/**
 * P1-5 acceptance: the full inspection mission loop on real telemetry.
 *
 *   arm -> takeoff -> fly into the inspection zone -> aim the gimbal ->
 *   capture (a deliberately bad shot is REJECTED and retried) ->
 *   valid photo -> mock AI defect detection -> return home -> land -> complete.
 *
 * Deterministic via the createApp test seams:
 *   - window.__fdeTeleport({x,y,z})      -> jump the F450 to a known pose
 *   - window.__fdeGimbal                  -> { setPitch/setYaw/aimAtTarget/... }
 *   - window.__fdeMission                 -> { state(), capture(), photoResult(), aiResult() }
 * No production behaviour depends on these seams.
 */

type MissionStateName =
  | 'IDLE'
  | 'READY'
  | 'TAKEOFF'
  | 'FLY_TO_TARGET'
  | 'POSITION_FOR_INSPECTION'
  | 'AIM_CAMERA'
  | 'CAPTURE'
  | 'VALIDATE_PHOTO'
  | 'AI_INSPECTION'
  | 'INSPECTION_COMPLETE'
  | 'RETURN'
  | 'LAND'
  | 'COMPLETE'
  | 'FAILED';

type PhotoResult = {
  valid: boolean;
  targetVisible: boolean;
  coverageRatio: number;
  distanceToTarget: number;
  angleErrorDeg: number;
  reasons: string[];
};

type AiResult = {
  defectDetected: boolean;
  defectType: string | null;
  confidence: number;
  source: string;
};

/** Inside the inspection zone, clear of the tower and both sagging wires. */
const INSPECT_POS = { x: -5.6, y: 8, z: 6.6 };
/** A pose that contacts tower T1 (0.5 m from the mast) -> COLLISION. */
const COLLISION_POS = { x: -8.5, y: 8, z: 4 };

async function teleport(page: Page, position: { x: number; y: number; z: number }): Promise<void> {
  await page.evaluate((pos) => {
    (window as unknown as { __fdeTeleport: (p: unknown) => void }).__fdeTeleport(pos);
  }, position);
}

async function missionState(page: Page): Promise<MissionStateName> {
  return page.evaluate(
    () =>
      (window as unknown as { __fdeMission: { state: () => MissionStateName } }).__fdeMission.state(),
  ) as Promise<MissionStateName>;
}

async function waitForMissionState(page: Page, expected: MissionStateName, timeout = 15_000): Promise<void> {
  await expect
    .poll(() => missionState(page), { timeout, message: `mission should reach ${expected}` })
    .toBe(expected);
}

async function captureMission(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      (window as unknown as { __fdeMission: { capture: () => Promise<void> } }).__fdeMission.capture(),
  );
}

async function photoResult(page: Page): Promise<PhotoResult> {
  return page.evaluate(
    () =>
      (window as unknown as { __fdeMission: { photoResult: () => PhotoResult } }).__fdeMission.photoResult(),
  ) as Promise<PhotoResult>;
}

async function aiResult(page: Page): Promise<AiResult> {
  return page.evaluate(
    () =>
      (window as unknown as { __fdeMission: { aiResult: () => AiResult } }).__fdeMission.aiResult(),
  ) as Promise<AiResult>;
}

async function aimAtTarget(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __fdeGimbal: { aimAtTarget: () => void } }).__fdeGimbal.aimAtTarget();
  });
}

async function setGimbalPitch(page: Page, deg: number): Promise<void> {
  await page.evaluate((value) => {
    (window as unknown as { __fdeGimbal: { setPitch: (d: number) => void } }).__fdeGimbal.setPitch(value);
  }, deg);
}

/** Arm, take off, and wait until the mission is at the fly-to-target step. */
async function armTakeoffAndFly(page: Page): Promise<void> {
  await page.locator('[data-action="arm"]').click();
  await page.locator('[data-action="takeoff"]').click();
  // Wait for the climb to FINISH (mode "飛行中"): teleporting while still
  // "taking-off" would be pulled back to the takeoff target altitude.
  await expect(page.locator('[data-flight-state]')).toHaveText('飛行中', { timeout: 15_000 });
  await waitForMissionState(page, 'FLY_TO_TARGET');
}

/** Fold the large calibration panel so the scene is un-obscured in captures. */
async function foldCalibrationPanel(page: Page): Promise<void> {
  await page.addStyleTag({ content: '.calibration-anchor{display:none !important}' });
}

test.describe('P1-5 inspection mission loop', () => {
  test('CASE1: gimbal keyboard control and the capture gate', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();

    // I/K pitch, J/L yaw, C recentre - keys reserved from the flight mapping.
    await page.keyboard.press('i');
    await page.keyboard.press('i');
    await expect(page.locator('[data-gimbal-readout-pitch]')).toHaveText('8°');
    await page.keyboard.press('k');
    await expect(page.locator('[data-gimbal-readout-pitch]')).toHaveText('4°');
    await page.keyboard.press('j');
    await expect(page.locator('[data-gimbal-readout-yaw]')).toHaveText('-4°');
    await page.keyboard.press('l');
    await expect(page.locator('[data-gimbal-readout-yaw]')).toHaveText('0°');
    await page.keyboard.press('c');
    await expect(page.locator('[data-gimbal-readout-pitch]')).toHaveText('0°');

    // Capture is gated to the aiming step: pressing it on the ground is refused
    // with a teaching reason and leaves the mission untouched.
    await captureMission(page);
    expect(await missionState(page)).toBe('IDLE');
    await expect(page.locator('[data-photo-result]')).toHaveText('無法拍攝');
    await expect(page.locator('[data-photo-reasons]')).toHaveText('當前不在拍攝步驟。');

    expect(pageErrors).toEqual([]);
  });

  test('CASE2: a bad photo is rejected and retried; a good one reaches the AI', async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();
    await expect(page.locator('[data-drone-ready="true"]')).toHaveAttribute('data-drone-source', 'programmatic');

    await armTakeoffAndFly(page);
    await teleport(page, INSPECT_POS);
    await waitForMissionState(page, 'AIM_CAMERA');

    // The checklist reflects the real pose: inside the zone, at a safe distance.
    await expect(page.locator('[data-check-target]')).toHaveText('✓');
    await expect(page.locator('[data-check-safety]')).toHaveText('✓');
    await expect(page.locator('[data-inspection-zone]')).toHaveText('已進入');

    // --- Failed shot: gimbal pitched up 20 deg, far outside the 15 deg aim tollerance.
    await aimAtTarget(page);
    await setGimbalPitch(page, 20);
    await captureMission(page);

    const bad = await photoResult(page);
    expect(bad.valid).toBe(false);
    expect(bad.reasons.join()).toContain('雲台');
    // The retry loop returns to aiming - the trainee must reposition / re-aim.
    expect(await missionState(page)).toBe('AIM_CAMERA');
    await expect(page.locator('[data-photo-result]')).toHaveText('照片不合格');
    await expect(page.locator('[data-photo-reasons]')).toContainText('雲台');
    await expect(page.locator('[data-check-evidence]')).toHaveText('—');

    // --- Good shot: re-aim and shoot again - now it validates and runs the AI.
    await aimAtTarget(page);
    await captureMission(page);

    const good = await photoResult(page);
    expect(good.valid).toBe(true);
    expect(good.distanceToTarget).toBeGreaterThan(0.8);
    expect(good.distanceToTarget).toBeLessThan(5);
    expect(good.angleErrorDeg).toBeLessThanOrEqual(15);
    expect(good.coverageRatio).toBeGreaterThanOrEqual(0.05);
    expect(await missionState(page)).toBe('INSPECTION_COMPLETE');

    // The real RenderTarget capture is shown as a PNG preview. (The camera
    // panel is intentionally hidden on the <=920px mobile layout.)
    const preview = page.locator('[data-photo-preview]');
    if (testInfo.project.name === 'desktop-chrome') {
      await expect(preview).toBeVisible();
    }
    const previewSrc = await preview.getAttribute('src');
    expect(previewSrc?.startsWith('data:image/png;base64,')).toBe(true);
    expect((previewSrc ?? '').length).toBeGreaterThan(2000);

    // Mock AI (deterministic, labelled as simulated) finds the planted defect.
    const ai = await aiResult(page);
    expect(ai.defectDetected).toBe(true);
    expect(ai.defectType).toBe('MISSING_INSULATOR_DISC');
    expect(ai.source).toBe('mock');
    expect(ai.confidence).toBeGreaterThan(0.5);
    expect(ai.confidence).toBeLessThanOrEqual(0.99);
    await expect(page.locator('[data-photo-result]')).toHaveText('照片合格');
    await expect(page.locator('[data-ai-state]')).toHaveText('已檢測');
    await expect(page.locator('[data-ai-detail]')).toContainText('絕緣子片缺失');
    await expect(page.locator('[data-check-evidence]')).toHaveText('✓');

    expect(pageErrors).toEqual([]);

    // Screenshot A: a validated capture - photo preview, checklist all ticked.
    await expect(page.locator('[data-inspection-zone]')).toHaveText('已進入');
    await foldCalibrationPanel(page);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `screenshots/p1-5-capture-${testInfo.project.name}.png`, fullPage: true });
  });

  test('CASE3: the mission runs to completion and failure is real', async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();

    await armTakeoffAndFly(page);

    // A real collision aborts the mission regardless of the current step.
    await teleport(page, COLLISION_POS);
    await waitForMissionState(page, 'FAILED');
    await expect(page.locator('[data-mission-hint]')).toContainText('任務失敗');
    await expect(page.locator('[data-safety-status]')).toHaveClass(/safety-collision/);

    expect(pageErrors).toEqual([]);

    // Fresh run of the same page cannot resume a failed mission: disarm and start over.
    await page.reload();
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();
    await armTakeoffAndFly(page);
    await teleport(page, INSPECT_POS);
    await waitForMissionState(page, 'AIM_CAMERA');
    await aimAtTarget(page);
    await captureMission(page);
    await waitForMissionState(page, 'INSPECTION_COMPLETE');

    // The evidence checklist item is a mission artefact - it stays ticked.
    await expect(page.locator('[data-check-evidence]')).toHaveText('✓');

    // Return home only unlocks after the inspection completes.
    await page.locator('[data-action="rtl"]').click();
    await waitForMissionState(page, 'RETURN');

    // Arrive overhead the home point -> the mission asks for landing, which
    // drives the real flight controller down and completes the loop.
    await teleport(page, { x: 0.3, y: 8, z: 0.3 });
    await waitForMissionState(page, 'LAND');
    await waitForMissionState(page, 'COMPLETE');

    await expect(page.locator('[data-mission-step]')).toHaveText('任務完成');
    await expect(page.locator('[data-mission-progress]')).toHaveText('12 / 12');
    await expect(page.locator('[data-mission-state]')).toHaveText('完成');
    // Landed back at the home point, so the live-pose checks have reset.
    await expect(page.locator('[data-check-target]')).toHaveText('—');
    await expect(page.locator('[data-check-evidence]')).toHaveText('✓');

    expect(pageErrors).toEqual([]);

    // Screenshot B: the completed mission loop.
    await foldCalibrationPanel(page);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `screenshots/p1-5-complete-${testInfo.project.name}.png`, fullPage: true });
  });
});
