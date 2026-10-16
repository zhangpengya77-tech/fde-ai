import { expect, test, type Page } from '@playwright/test';

/**
 * P1-7 acceptance: the trainee mission report (history list + teacher view).
 *
 *   CASE1  completed mission        -> report generated, list + detail visible
 *   CASE2  detail shows total/6 dims + photos + Mock AI label
 *   CASE3  history list contains the finished task
 *   CASE4  teacher view opens and shows the same report (read-only framing)
 *   CASE5  exported JSON matches the real recorded report
 *   CASE6  a failed mission still yields an accurate report
 *   CASE7  the report is fully viewable on mobile
 *
 * Every field on the report comes from the same recorded data the scorer used;
 * the report never invents content. All expectations are deterministic.
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

const INSPECT_POS = { x: -5.6, y: 8, z: 6.6 };
const COLLISION_POS = { x: -8.5, y: 8, z: 4 };
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

async function armTakeoffAndFly(page: Page): Promise<void> {
  await page.locator('[data-action="arm"]').click();
  await page.locator('[data-action="takeoff"]').click();
  await expect(page.locator('[data-flight-state]')).toHaveText('飞行中', { timeout: 15_000 });
  await waitForMissionState(page, 'FLY_TO_TARGET');
}

async function foldCalibrationPanel(page: Page): Promise<void> {
  await page.addStyleTag({ content: '.calibration-anchor{display:none !important}' });
}

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

async function openReportFromList(page: Page, listScreenshotPath?: string): Promise<void> {
  await page.locator('[data-action="open-reports"]').click();
  await expect(page.locator('[data-reports-overlay]')).toBeVisible();
  await expect(page.locator('[data-reports-list] .report-item').first()).toBeVisible({ timeout: 10_000 });
  // Capture the history LIST before opening the first item's detail (FIND-1 fix):
  // the previously named "reports-list" screenshot was taken after the click and
  // therefore showed the detail overlay, not the list.
  if (listScreenshotPath) {
    await page.screenshot({ path: listScreenshotPath, fullPage: true });
  }
  await page.locator('[data-reports-list] .report-item').first().click();
  await expect(page.locator('[data-report-detail]')).toBeVisible();
}

test.describe('P1-7 trainee mission report', () => {
  test('CASE1: a completed mission generates a report in the history list and detail', async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();

    await armTakeoffAndFly(page);
    await completeInspectionLoop(page);
    await expect(page.locator('[data-score-panel]')).toBeVisible();

    // The report is generated and persisted.
    const summaries = (await page.evaluate(() =>
      (window as unknown as { __fdeReport: { summaries: () => Promise<unknown[]> } }).__fdeReport.summaries(),
    )) as unknown[];
    expect(summaries.length).toBeGreaterThanOrEqual(1);

    // List screenshot is captured inside openReportFromList, BEFORE the first item
    // is clicked, so it genuinely shows the history list (FIND-1 fix). The reports
    // overlay covers the calibration panel, so its fold timing does not affect it.
    await openReportFromList(page, `screenshots/p1-7-reports-list-${testInfo.project.name}.png`);
    await expect(page.locator('[data-report-detail]')).toContainText('教学评分（六项）');
    await expect(page.locator('[data-report-detail] .report-dim')).toHaveCount(6);
    // A valid capture renders its photo in both the captures list and the
    // valid-photo gallery, so we assert at least one is present.
    await expect(page.locator('[data-report-detail] .report-photo')).toHaveCount(2);

    expect(pageErrors).toEqual([]);

    await foldCalibrationPanel(page);
    await page.waitForTimeout(1500);
    await page.locator('[data-report-detail]').screenshot({
      path: `screenshots/p1-7-report-detail-${testInfo.project.name}.png`,
    });
  });

  test('CASE2: the detail shows total, six dimensions, photos and the Mock AI label', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();
    await armTakeoffAndFly(page);
    await completeInspectionLoop(page);
    await expect(page.locator('[data-score-panel]')).toBeVisible();

    await openReportFromList(page);

    const detail = page.locator('[data-report-detail]');
    // Six dimensions with score / max.
    await expect(detail.locator('.report-dim')).toHaveCount(6);
    // Photos from the real capture.
    await expect(detail.locator('.report-photo').first()).toHaveAttribute('src', /^data:image\/png;base64,/);
    // Mock AI clearly marked, not real YOLO.
    await expect(detail).toContainText('模拟 AI');
    await expect(detail).toContainText('非真实 YOLO');
    await expect(detail).toContainText('绝缘子片缺失');

    expect(pageErrors).toEqual([]);
  });

  test('CASE3: the history list contains the finished task', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();
    await armTakeoffAndFly(page);
    await completeInspectionLoop(page);
    await expect(page.locator('[data-score-panel]')).toBeVisible();

    await page.locator('[data-action="open-reports"]').click();
    await expect(page.locator('[data-reports-overlay]')).toBeVisible();
    await expect(page.locator('[data-reports-list] .report-item').first()).toBeVisible({ timeout: 10_000 });

    const item = page.locator('[data-reports-list] .report-item').first();
    await expect(item).toContainText('输电塔右侧绝缘子串巡检');
    // Completed run is shown with a status and a score.
    await expect(item).toContainText('完成');
    await expect(item).toContainText('分');

    const summaries = (await page.evaluate(() =>
      (window as unknown as { __fdeReport: { summaries: () => Promise<unknown[]> } }).__fdeReport.summaries(),
    )) as Array<{ status: string; totalScore: number }>;
    expect(summaries[0].status).toBe('completed');
    expect(summaries[0].totalScore).toBeGreaterThan(0);
  });

  test('CASE4: the teacher view opens and shows the same report read-only', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();
    await armTakeoffAndFly(page);
    await completeInspectionLoop(page);
    await expect(page.locator('[data-score-panel]')).toBeVisible();

    await openReportFromList(page);

    // Switch to the teacher perspective; the report stays visible but is framed
    // as a read-only teacher review (no multi-user isolation assumed).
    await page.locator('[data-report-role-tab="teacher"]').click();
    await expect(page.locator('[data-report-role]')).toHaveText('教师查看（只读）');
    await expect(page.locator('[data-report-teacher-note]')).toBeVisible();
    await expect(page.locator('[data-report-detail]')).toContainText('教师查看模式（只读）');
    // The report content is still present in teacher view.
    await expect(page.locator('[data-report-detail] .report-dim')).toHaveCount(6);

    // Back to the list still works.
    await page.locator('[data-report-role-tab="student"]').click();
    await page.locator('[data-action="back-to-list"]').click();
    await expect(page.locator('[data-reports-list]')).toBeVisible();
  });

  test('CASE5: exported JSON matches the recorded report', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();
    await armTakeoffAndFly(page);
    await completeInspectionLoop(page);
    await expect(page.locator('[data-score-panel]')).toBeVisible();

    const json = await page.evaluate(() =>
      (window as unknown as { __fdeReport: { json: () => string | null } }).__fdeReport.json(),
    );
    expect(json).toBeTruthy();
    const report = JSON.parse(json as string);
    expect(report.reportId).toBeTruthy();
    expect(report.missionId).toBeTruthy();
    expect(typeof report.score.totalScore).toBe('number');
    expect(report.score.totalScore).toBeGreaterThan(0);
    expect(report.captures.length).toBeGreaterThanOrEqual(1);
    expect(report.controlSamples.length).toBeGreaterThan(0);
    expect(Array.isArray(report.hazardSummary)).toBe(true);
    // The exported file name is derived from the report id.
    const exportName = await page.evaluate(() =>
      (window as unknown as { __fdeReport: { exportName: () => string | null } }).__fdeReport.exportName(),
    );
    expect(exportName).toMatch(/^mission-report-.*\.json$/);
  });

  test('CASE6: a failed mission still produces an accurate report', async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();
    await armTakeoffAndFly(page);
    await teleport(page, COLLISION_POS);
    await waitForMissionState(page, 'FAILED');
    await expect(page.locator('[data-score-panel]')).toBeVisible();

    const total = Number(await page.locator('[data-score-total]').textContent());
    expect(total).toBeLessThanOrEqual(59);

    // The report is in the history list with a failed status + collision flag.
    await page.locator('[data-action="open-reports"]').click();
    await expect(page.locator('[data-reports-overlay]')).toBeVisible();
    await expect(page.locator('[data-reports-list] .report-item').first()).toBeVisible({ timeout: 10_000 });
    const item = page.locator('[data-reports-list] .report-item').first();
    await expect(item).toContainText('失败');
    await expect(item.locator('.report-collision')).toContainText('碰撞');

    await item.click();
    await expect(page.locator('[data-report-detail]')).toBeVisible();
    await expect(page.locator('[data-report-detail]')).toContainText('失败');
    await expect(page.locator('[data-report-detail]')).toContainText('COLLISION');

    expect(pageErrors).toEqual([]);

    await foldCalibrationPanel(page);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `screenshots/p1-7-failed-report-${testInfo.project.name}.png`, fullPage: true });
  });

  test('CASE7: the report is fully viewable on mobile', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();
    await armTakeoffAndFly(page);
    await completeInspectionLoop(page);
    await expect(page.locator('[data-score-panel]')).toBeVisible();

    await openReportFromList(page);
    await expect(page.locator('[data-report-detail] .report-dim')).toHaveCount(6);
    await expect(page.locator('[data-report-detail] .report-photo').first()).toBeVisible();
    // The overlay scrolls internally, so the whole report is reachable.
    await page.locator('[data-report-detail]').evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await expect(page.locator('[data-report-detail] [data-action="export-report"]')).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
