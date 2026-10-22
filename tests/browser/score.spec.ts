import { expect, test, type Page } from '@playwright/test';

/**
 * P1-6 acceptance: the teaching score panel on real recorded data.
 *
 *   CASE1  complete inspection       -> score auto-generated, total + 6 dimensions
 *   CASE2  a DANGER episode occurred -> flight-safety points deducted
 *   CASE3  a COLLISION occurs        -> FAIL grade / hard total cap
 *   CASE4  bad photo then good one   -> photo quality scored on the FINAL valid
 *                                       shot, the failed attempt kept on record
 *   CASE5  mission not completed     -> no high score / PASS
 *
 * Scores come only from recorded telemetry via the ScoringEngine; the panel
 * never computes numbers itself. No assertions are weakened and nothing is
 * randomised - every expectation below is deterministic.
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

/** Inside the inspection zone, clear of the tower and both sagging wires. */
const INSPECT_POS = { x: -5.6, y: 8, z: 6.6 };
/** 2 m from tower T1 -> DANGER (used for the safety-deduction case). */
const DANGER_POS = { x: -11, y: 8, z: 4 };
/** 0.5 m from tower T1 -> COLLISION (used for the hard-cap case). */
const COLLISION_POS = { x: -8.5, y: 8, z: 4 };
/** Overhead the home point, inside the return arrival radius. */
const HOME_OVERHEAD = { x: 0.3, y: 8, z: 0.3 };

async function teleport(page: Page, position: { x: number; y: number; z: number }): Promise<void> {
  await page.evaluate((pos) => {
    (window as unknown as { __fdeTeleport: (p: unknown) => void }).__fdeTeleport(pos);
  }, position);
}

async function missionState(page: Page): Promise<MissionStateName> {
  return page.evaluate(
    () => (window as unknown as { __fdeMission: { state: () => MissionStateName } }).__fdeMission.state(),
  ) as Promise<MissionStateName>;
}

async function waitForMissionState(page: Page, expected: MissionStateName, timeout = 20_000): Promise<void> {
  await expect
    .poll(() => missionState(page), { timeout, message: `mission should reach ${expected}` })
    .toBe(expected);
}

async function captureMission(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __fdeMission: { capture: () => Promise<void> } }).__fdeMission.capture(),
  );
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

async function armTakeoffAndFly(page: Page): Promise<void> {
  await page.locator('[data-action="arm"]').click();
  await page.locator('[data-action="takeoff"]').click();
  await expect(page.locator('[data-flight-state]')).toHaveText('飛行中', { timeout: 15_000 });
  await waitForMissionState(page, 'FLY_TO_TARGET');
}

async function foldCalibrationPanel(page: Page): Promise<void> {
  await page.addStyleTag({ content: '.calibration-anchor{display:none !important}' });
}

async function scoreTotal(page: Page): Promise<number> {
  const text = await page.locator('[data-score-total]').textContent();
  return Number(text);
}

async function dimensionValue(page: Page, key: string): Promise<string> {
  return (await page.locator(`[data-score-dimension="${key}"] [data-score-value]`).textContent()) ?? '';
}

/** Complete the inspection at INSPECT_POS and fly the full loop to COMPLETE. */
async function completeInspectionLoop(page: Page): Promise<void> {
  await teleport(page, INSPECT_POS);
  await waitForMissionState(page, 'AIM_CAMERA');
  await aimAtTarget(page);
  await captureMission(page);
  await waitForMissionState(page, 'INSPECTION_COMPLETE');
  await page.locator('[data-action="rtl"]').click();
  await waitForMissionState(page, 'RETURN');
  await teleport(page, HOME_OVERHEAD);
  await waitForMissionState(page, 'LAND');
  await waitForMissionState(page, 'COMPLETE');
}

test.describe('P1-6 teaching score panel', () => {
  test('CASE1: a completed inspection auto-generates the score panel', async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();

    await armTakeoffAndFly(page);
    await teleport(page, INSPECT_POS);
    await waitForMissionState(page, 'AIM_CAMERA');

    // No score before the mission is over.
    await expect(page.locator('[data-score-panel]')).toBeHidden();

    await aimAtTarget(page);
    await captureMission(page);
    await waitForMissionState(page, 'INSPECTION_COMPLETE');
    await expect(page.locator('[data-score-panel]')).toBeHidden();

    await page.locator('[data-action="rtl"]').click();
    await waitForMissionState(page, 'RETURN');
    await teleport(page, HOME_OVERHEAD);
    await waitForMissionState(page, 'LAND');
    await waitForMissionState(page, 'COMPLETE');

    // The score panel appears with the total, grade and all six dimensions.
    await expect(page.locator('[data-score-panel]')).toBeVisible();
    await expect(page.locator('[data-mission-step]')).toHaveText('任務完成');

    const total = await scoreTotal(page);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(100);
    await expect(page.locator('[data-score-grade]')).toHaveText(/EXCELLENT|PASS|NEEDS_PRACTICE|FAIL/);

    await expect(page.locator('[data-score-dimension]')).toHaveCount(6);
    expect(await dimensionValue(page, 'mission-completion')).toBe('25 / 25');
    expect(await dimensionValue(page, 'photo-quality')).toBe('15 / 15');
    // The zone pose is a WARNING pose, so safety can never be full marks here.
    const safety = await dimensionValue(page, 'flight-safety');
    expect(safety).toMatch(/^\d+(\.\d+)? \/ 25$/);
    expect(Number(safety.split(' / ')[0])).toBeLessThan(25);
    expect(Number(safety.split(' / ')[0])).toBeGreaterThan(0);
    for (const key of ['inspection-position', 'flight-efficiency', 'control-stability']) {
      await expect(page.locator(`[data-score-dimension="${key}"] [data-score-reason]`)).not.toBeEmpty();
    }

    // 1-3 deterministic teaching suggestions, none empty.
    const suggestions = page.locator('[data-score-suggestion-list] li');
    await expect(suggestions.first()).not.toBeEmpty();
    expect(await suggestions.count()).toBeGreaterThanOrEqual(1);
    expect(await suggestions.count()).toBeLessThanOrEqual(3);

    expect(pageErrors).toEqual([]);

    // Screenshot A: the score overview after a completed mission.
    await foldCalibrationPanel(page);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `screenshots/p1-6-score-overview-${testInfo.project.name}.png`, fullPage: true });

    // Screenshot B: the six-dimension detail (panel close-up).
    await page.locator('[data-score-panel]').screenshot({
      path: `screenshots/p1-6-score-detail-${testInfo.project.name}.png`,
    });
  });

  test('CASE2: a DANGER episode deducts flight-safety points', async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();

    await armTakeoffAndFly(page);

    // Deliberate dangerous approach: 2 m from tower T1 for ~3 seconds.
    await teleport(page, DANGER_POS);
    await expect(page.locator('[data-safety-status]')).toHaveText('危險', { timeout: 8000 });
    await page.waitForTimeout(3000);

    await completeInspectionLoop(page);
    await expect(page.locator('[data-score-panel]')).toBeVisible();

    const safety = await dimensionValue(page, 'flight-safety');
    const safetyScore = Number(safety.split(' / ')[0]);
    // 25 - 4 (episode) - 1.5 (3 s) - warnings => clearly below full marks.
    expect(safetyScore).toBeLessThan(20);
    expect(safetyScore).toBeGreaterThan(0);
    await expect(page.locator('[data-score-dimension="flight-safety"] [data-score-reason]')).toContainText('DANGER');
    await expect(page.locator('[data-score-dimension="flight-safety"]')).toHaveAttribute('data-score-status', /CHECK|POOR/);
    // The safety-first suggestion is present for a dangerous approach.
    await expect(page.locator('[data-score-suggestion-list]')).toContainText('減速');

    expect(pageErrors).toEqual([]);

    // Screenshot C: the DANGER deduction case.
    await foldCalibrationPanel(page);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `screenshots/p1-6-score-warning-${testInfo.project.name}.png`, fullPage: true });
  });

  test('CASE3: a COLLISION fails the mission and caps the total', async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();

    await armTakeoffAndFly(page);
    await teleport(page, COLLISION_POS);
    await waitForMissionState(page, 'FAILED');
    await expect(page.locator('[data-safety-status]')).toHaveClass(/safety-collision/);

    // The score panel is generated even for a failed mission.
    await expect(page.locator('[data-score-panel]')).toBeVisible();
    const total = await scoreTotal(page);
    expect(total).toBeLessThanOrEqual(59); // hard safety cap
    expect(total).toBeLessThan(90); // never "90+ despite a collision"
    await expect(page.locator('[data-score-grade]')).toContainText('FAIL');

    expect(await dimensionValue(page, 'mission-completion')).toBe('0 / 25');
    expect(await dimensionValue(page, 'flight-safety')).toBe('0 / 25');
    await expect(page.locator('[data-score-dimension="flight-safety"] [data-score-reason]')).toContainText('碰撞');
    await expect(page.locator('[data-score-issues]')).toContainText('碰撞');
    await expect(page.locator('[data-score-suggestion-list]')).toContainText('碰撞');

    expect(pageErrors).toEqual([]);

    // Screenshot D: the COLLISION / FAIL case.
    await foldCalibrationPanel(page);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `screenshots/p1-6-score-collision-${testInfo.project.name}.png`, fullPage: true });
  });

  test('CASE4: a retried photo is scored on the final valid shot, failed attempt kept', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();

    await armTakeoffAndFly(page);
    await teleport(page, INSPECT_POS);
    await waitForMissionState(page, 'AIM_CAMERA');

    // First shot mis-aimed -> rejected; second shot good -> valid.
    await aimAtTarget(page);
    await setGimbalPitch(page, 20);
    await captureMission(page);
    expect(await missionState(page)).toBe('AIM_CAMERA');
    await expect(page.locator('[data-photo-result]')).toHaveText('照片不合格');

    await aimAtTarget(page);
    await captureMission(page);
    await waitForMissionState(page, 'INSPECTION_COMPLETE');

    // Finish the loop so the score is generated.
    await page.locator('[data-action="rtl"]').click();
    await waitForMissionState(page, 'RETURN');
    await teleport(page, HOME_OVERHEAD);
    await waitForMissionState(page, 'LAND');
    await waitForMissionState(page, 'COMPLETE');

    await expect(page.locator('[data-score-panel]')).toBeVisible();
    // 15 - 1.5 (one failed attempt before the valid final shot).
    expect(await dimensionValue(page, 'photo-quality')).toBe('13.5 / 15');
    const reason = await page.locator('[data-score-dimension="photo-quality"] [data-score-reason]').textContent();
    expect(reason).toContain('共拍攝 2 次');
    expect(reason).toContain('不合格');

    expect(pageErrors).toEqual([]);
  });

  test('CASE5: an unfinished mission cannot earn a high score', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();

    await armTakeoffAndFly(page);
    await teleport(page, INSPECT_POS);
    await waitForMissionState(page, 'AIM_CAMERA');

    // The trainee gives up and lands without any photo.
    await page.locator('[data-action="land"]').click();
    await expect(page.locator('[data-flight-state]')).toHaveText('已解鎖', { timeout: 15_000 });

    // Scoring still happens for an unfinished run - and it cannot pass.
    await expect(page.locator('[data-score-panel]')).toBeVisible();
    const total = await scoreTotal(page);
    expect(total).toBeLessThan(70);
    await expect(page.locator('[data-score-grade]')).toHaveText(/NEEDS_PRACTICE|FAIL/);

    // 4 of the 8 steps to inspection completion => 25 * 4/8 = 12.5.
    expect(await dimensionValue(page, 'mission-completion')).toBe('12.5 / 25');
    await expect(page.locator('[data-score-dimension="mission-completion"] [data-score-reason]')).toContainText('未完成');
    await expect(page.locator('[data-score-suggestion-list]')).toContainText('未拍攝巡檢照片');

    expect(pageErrors).toEqual([]);
  });
});
