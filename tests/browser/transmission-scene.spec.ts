import { expect, test, type Page } from '@playwright/test';

/**
 * P1-4 acceptance: transmission-line inspection scene + real SafetyDistanceEngine.
 *
 * Deterministic browser checks via two test seams exposed by createApp:
 *   - window.__fdeTeleport({x,y,z})      -> jump the F450 to a known pose
 *   - window.__fdeInspection              -> { layout, evaluate(pos), lastResult }
 * No production behaviour depends on these seams.
 */

type InspectionResult = {
  distanceToTarget: number;
  distanceToTower: number;
  distanceToWire: number;
  insideInspectionZone: boolean;
  safetyState: 'SAFE' | 'WARNING' | 'DANGER' | 'COLLISION';
};

async function teleport(page: Page, position: { x: number; y: number; z: number }): Promise<void> {
  await page.evaluate((pos) => {
    (window as unknown as { __fdeTeleport: (p: unknown) => void }).__fdeTeleport(pos);
  }, position);
}

async function lastResult(page: Page): Promise<InspectionResult> {
  return page.evaluate(
    () =>
      (window as unknown as { __fdeInspection: { lastResult: InspectionResult } }).__fdeInspection.lastResult,
  ) as Promise<InspectionResult>;
}

async function evaluateAt(
  page: Page,
  position: { x: number; y: number; z: number },
): Promise<InspectionResult> {
  return page.evaluate((pos) => {
    return (
      window as unknown as { __fdeInspection: { evaluate: (p: unknown) => InspectionResult } }
    ).__fdeInspection.evaluate(pos);
  }, position) as Promise<InspectionResult>;
}

/** Teleport, then let the camera lerp follow the drone for a stable screenshot. */
async function teleportAndSettle(page: Page, position: { x: number; y: number; z: number }, settleMs = 3000): Promise<void> {
  await teleport(page, position);
  // Give the render loop a few frames to recompute + the camera time to catch up.
  await page.waitForTimeout(settleMs);
}

/** Fold the large calibration panel so the 3D scene is un-obscured in captures. */
async function foldCalibrationPanel(page: Page): Promise<void> {
  await page.addStyleTag({ content: '.calibration-anchor{display:none !important}' });
}

async function canvasHasVisiblePixels(page: Page): Promise<boolean> {
  const canvas = page.locator('canvas[data-scene="training"]');
  return canvas.evaluate((element) => {
    const source = element as HTMLCanvasElement;
    const sample = document.createElement('canvas');
    sample.width = 16;
    sample.height = 16;
    const context = sample.getContext('2d');
    if (!context) return false;
    context.drawImage(source, 0, 0, sample.width, sample.height);
    return context.getImageData(0, 0, sample.width, sample.height).data.some((value, index) => index % 4 !== 3 && value > 8);
  });
}

test.describe('P1-4 transmission-line inspection scene', () => {
  test('CASE1: scene exposes F450, towers, sagging wires, target and obstacle', async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();
    await expect(page.locator('[data-scene="transmission"]')).toBeVisible();
    await expect(page.locator('[data-drone-ready="true"]')).toHaveAttribute('data-drone-source', 'programmatic');

    // Scene composition data written by createApp.
    await expect(page.locator('[data-scene="transmission"]')).toHaveAttribute('data-tower-count', '2');
    await expect(page.locator('[data-scene="transmission"]')).toHaveAttribute('data-wire-count', '2');
    await expect(page.locator('[data-scene="transmission"]')).toHaveAttribute('data-target-set', 'true');

    // Underlying geometry, straight from the engine's layout.
    const layout = await page.evaluate(
      () =>
        (window as unknown as { __fdeInspection: { layout: Record<string, unknown> } }).__fdeInspection.layout,
    );
    const towers = layout.towers as Array<{ id: string; height: number }>;
    const wires = layout.wires as Array<{ id: string; sag: number; from: { y: number }; to: { y: number } }>;
    const wireSamples = layout.wireSamples as Array<Array<{ x: number; y: number; z: number }>>;
    const obstacles = layout.obstacles as Array<{ id: string }>;
    const target = layout.target as { defectType: string; label: string };

    expect(towers.length).toBeGreaterThanOrEqual(2);
    expect(wires.length).toBeGreaterThanOrEqual(2);
    expect(obstacles.length).toBeGreaterThanOrEqual(1);
    expect(target.defectType).toBe('MISSING_INSULATOR_DISC');
    for (const wire of wires) {
      expect(wire.sag).toBeGreaterThan(0);
    }

    // Every wire is actually rendered as a sampled sagging poly-line below its chord.
    for (const samples of wireSamples) {
      expect(samples.length).toBeGreaterThan(2);
      const straightMidY = (samples[0].y + samples[samples.length - 1].y) / 2;
      const lowest = Math.min(...samples.map((s) => s.y));
      expect(lowest).toBeLessThan(straightMidY - 1);
    }

    // Canvas really renders.
    await expect(page.locator('canvas[data-scene="training"]')).toBeVisible();
    expect(await canvasHasVisiblePixels(page)).toBe(true);

    // Mission panel shows the inspection target.
    await expect(page.locator('[data-inspection-target]')).toContainText('絕緣子');

    expect(pageErrors).toEqual([]);

    // Screenshot A: F450 + two towers + sagging wires panorama.
    await foldCalibrationPanel(page);
    await teleportAndSettle(page, { x: 0, y: 7, z: 0 }, 2500);
    await page.screenshot({ path: `screenshots/p1-4-panorama-${testInfo.project.name}.png`, fullPage: true });
  });

  test('CASE2: parked far from every hazard is SAFE', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-app-status="ready"]')).toBeVisible();
    await expect(page.locator('[data-drone-ready="true"]')).toHaveAttribute('data-drone-source', 'programmatic');

    // Pure geometry: a far pose classifies SAFE.
    const far = await evaluateAt(page, { x: 40, y: 25, z: 25 });
    expect(far.safetyState).toBe('SAFE');
    expect(far.insideInspectionZone).toBe(false);

    // Live teleport reflects SAFE in the HUD.
    await teleport(page, { x: 40, y: 25, z: 25 });
    await expect(page.locator('[data-safety-status]')).toHaveText('安全', { timeout: 8000 });
    const result = await lastResult(page);
    expect(result.safetyState).toBe('SAFE');
    expect(result.distanceToTarget).toBeGreaterThan(10);

    expect(pageErrors).toEqual([]);
  });

  test('CASE3: near tower and near wire escalate to WARNING/DANGER', async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-drone-ready="true"]')).toHaveAttribute('data-drone-source', 'programmatic');

    // Near tower 1 (west side, away from target) -> DANGER from the tower only.
    const nearTower = await evaluateAt(page, { x: -11, y: 8, z: 4 });
    expect(['WARNING', 'DANGER']).toContain(nearTower.safetyState);
    expect(nearTower.safetyState).not.toBe('SAFE');
    await teleport(page, { x: -11, y: 8, z: 4 });
    await expect(page.locator('[data-safety-status]')).toHaveText(/警告|危險/, { timeout: 8000 });

    // Near the conductor -> WARNING from the wire.
    const nearWire = await evaluateAt(page, { x: 0, y: 11, z: 4 });
    expect(['WARNING', 'DANGER']).toContain(nearWire.safetyState);
    await teleport(page, { x: 0, y: 11, z: 4 });
    await expect(page.locator('[data-safety-status]')).toHaveText(/警告|危險/, { timeout: 8000 });

    const wireResult = await lastResult(page);
    expect(wireResult.distanceToWire).toBeLessThan(5);

    expect(pageErrors).toEqual([]);

    // Screenshot C: a WARNING/DANGER safety-warning view (3D + coloured HUD).
    await foldCalibrationPanel(page);
    await teleportAndSettle(page, { x: 0, y: 11, z: 4 }, 2500);
    await page.screenshot({ path: `screenshots/p1-4-warning-${testInfo.project.name}.png`, fullPage: true });
  });

  test('CASE4: entering the inspection zone is recognised', async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('[data-drone-ready="true"]')).toHaveAttribute('data-drone-source', 'programmatic');

    // Zone boundary: at target is inside, far away is outside.
    const target = await page.evaluate(
      () =>
        (
          window as unknown as { __fdeInspection: { layout: { target: { position: { x: number; y: number; z: number } } } } }
        ).__fdeInspection.layout.target.position,
    );
    const atTarget = await evaluateAt(page, target);
    expect(atTarget.insideInspectionZone).toBe(true);
    expect(atTarget.distanceToTarget).toBeLessThan(0.001);
    const farZone = await evaluateAt(page, { x: target.x + 6, y: target.y, z: target.z });
    expect(farZone.insideInspectionZone).toBe(false);

    // Live teleport inside the zone flips the HUD indicator.
    await teleport(page, { x: target.x + 2, y: target.y, z: target.z });
    await expect(page.locator('[data-inspection-zone]')).toHaveText('已進入', { timeout: 8000 });
    const result = await lastResult(page);
    expect(result.insideInspectionZone).toBe(true);
    await expect(page.locator('[data-distance-target]')).toContainText('m');

    expect(pageErrors).toEqual([]);

    // Screenshot B: F450 inside the inspection zone.
    await foldCalibrationPanel(page);
    await teleportAndSettle(page, { x: target.x + 2, y: target.y, z: target.z }, 2500);
    await page.screenshot({ path: `screenshots/p1-4-inzone-${testInfo.project.name}.png`, fullPage: true });
  });
});
