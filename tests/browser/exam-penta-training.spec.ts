import { expect, test, type Page } from '@playwright/test';

/**
 * 科目 E 教學練習（第四輪）瀏覽器專項測試 — `?mode=penta`。
 *
 * 驗收重點（架構師指令 C3）：
 *  - READY → TAKEOFF → ENTER_ROUTE → SEGMENT_1..5 → COMPLETE 真實閉環；
 *  - PAUSED／RESUMED／RESTARTED／ABORTED；
 *  - 高度偏差與航線偏離提示（畫面 chips＋提示文字＋amber 視覺）；
 *  - 教學練習記錄（結果浮層僅稱「教學練習記錄」，無官方評等）；
 *  - **瀏覽器真實飛機位置資料驅動狀態變化**（真實鍵盤飛行冒煙，
 *    不使用腳本位姿）；腳本位姿縫（__pentaTestHook.setScriptedPose）
 *    僅用於確定性走完整條五邊，不代表放過「真實資料驅動」這一項；
 *  - 桌面與手機（兩個 Playwright project 各跑一遍）。
 *
 * 截圖：全部來自真實運行畫面，輸出到 .playwright-output/penta-training-shots/。
 */

/** 五邊航路點（教學假設，級距 I；y = 操作高度 20m）。 */
const W = {
  w0: { x: 0, z: 0 },
  w1: { x: -10, z: -22 },
  w2: { x: 10, z: -22 },
  w3: { x: 10, z: -6 },
  w4: { x: -10, z: -6 },
};
const ALT = 20;

interface HookSegment {
  legIndex: number;
  label: string;
  startedAtT: number;
  endedAtT: number | null;
  maxAltitudeDeviationM: number;
  maxRouteDeviationM: number;
  reached: boolean;
}
interface HookState {
  phase: string;
  paused: boolean;
  segments: HookSegment[];
  reachedWaypoints: number[];
  restartCount: number;
  maxAltitudeDeviationM: number;
  maxRouteDeviationM: number;
  startedAtT: number | null;
  endedAtT: number | null;
  abortReason: string | null;
  transitions: Array<{ t: number; event: string; from: string | null; to: string; detail?: string }>;
}

const getState = (page: Page): Promise<HookState> =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __pentaTestHook: { getTrainingState(): HookState };
        }
      ).__pentaTestHook.getTrainingState(),
  );

/** 腳本位姿（測試縫）：直接驅動機體位姿與狀態機（飛控凍結）。 */
const setPose = (page: Page, x: number, y: number, z: number): Promise<void> =>
  page.evaluate(
    ([px, py, pz]) => {
      (
        window as unknown as {
          __pentaTestHook: { setScriptedPose(x: number, y: number, z: number): void };
        }
      ).__pentaTestHook.setScriptedPose(px, py, pz);
    },
    [x, y, z],
  );

const clearPose = (page: Page): Promise<void> =>
  page.evaluate(() => {
    (window as unknown as { __pentaTestHook: { clearScriptedPose(): void } }).__pentaTestHook.clearScriptedPose();
  });

const isScripted = (page: Page): Promise<boolean> =>
  page.evaluate(
    () =>
      (window as unknown as { __pentaTestHook: { isScriptedPose(): boolean } }).__pentaTestHook.isScriptedPose(),
  );

/** 等待測試鉤子掛載且渲染迴圈已跑過數幀。 */
const waitHook = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    const h = (
      window as unknown as { __pentaTestHook?: { getFrames(): number } }
    ).__pentaTestHook;
    return !!h && h.getFrames() > 3;
  });
};

const phaseChip = (page: Page) => page.locator('[data-penta-training-state]');

/** 每航段最短練習時間 minSegmentTimeS=1.0s；等待 1.5s 確保可推進下一段。 */
const SEGMENT_WAIT_MS = 1500;

test('penta training bar mounts with disclaimers and idle chips', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?mode=penta');
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await waitHook(page);

  // 兩處固定免責（頂欄與訓練列）皆持續顯示。
  await expect(page.locator('[data-penta-disclaimer]')).toHaveText('非官方測驗，僅供練習');
  await expect(page.locator('[data-penta-training-disclaimer]')).toHaveText('非官方測驗，僅供練習');

  // 初始 chips：READY、無航段、目標高度 20m、其餘為「—」。
  await expect(phaseChip(page)).toHaveText('訓練狀態：準備');
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'READY');
  await expect(page.locator('[data-penta-training-segment]')).toHaveText('目前航段：—');
  await expect(page.locator('[data-penta-training-target-alt]')).toHaveText('目標高度 20.0 m');
  await expect(page.locator('[data-penta-training-actual-alt]')).toHaveText('實際高度 —');
  await expect(page.locator('[data-penta-training-alt-dev]')).toHaveText('高度偏差 —');
  await expect(page.locator('[data-penta-training-route-dev]')).toHaveText('偏離教學航線 —');
  await expect(page.locator('[data-penta-training-hint]')).toBeHidden();

  // 按鈕啟用態：僅「開始練習」可用。
  await expect(page.locator('[data-penta-training-begin]')).toBeEnabled();
  await expect(page.locator('[data-penta-training-pause]')).toBeDisabled();
  await expect(page.locator('[data-penta-training-resume]')).toBeDisabled();
  await expect(page.locator('[data-penta-training-restart]')).toBeDisabled();
  await expect(page.locator('[data-penta-training-abort]')).toBeDisabled();

  // 無評分元素（不得出現官方成績單／評等）。
  await expect(page.getByText('術科測驗報告表')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /重新測驗/ })).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('training bar and buttons stay inside viewport (desktop + mobile)', async ({ page }, testInfo) => {
  await page.goto('/?mode=penta');
  await waitHook(page);

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  // 訓練列不超出視口寬度（flex-wrap 換行）。
  const bar = page.locator('[data-penta-training-bar]');
  await expect(bar).toBeVisible();
  const barBox = await bar.boundingBox();
  expect(barBox).not.toBeNull();
  expect(barBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(barBox!.x).toBeGreaterThanOrEqual(0);

  // 五個按鈕皆完整在視口內（手機版靠換行排列，不得被裁切）。
  for (const key of ['begin', 'pause', 'resume', 'restart', 'abort']) {
    const btn = page.locator(`[data-penta-training-${key}]`);
    const box = await btn.boundingBox();
    expect(box, `按鈕 ${key} 應有佈局盒`).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
    expect(box!.height).toBeGreaterThan(8);
  }

  // 免責橫幅與 chips 也在視口內。
  for (const sel of ['[data-penta-training-disclaimer]', '[data-penta-training-state]', '[data-penta-training-target-alt]']) {
    const box = await page.locator(sel).first().boundingBox();
    expect(box, `${sel} 應有佈局盒`).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  }

  // 初始畫面截圖（真實運行畫面）。
  await page.screenshot({
    path: `.playwright-output/penta-training-shots/${testInfo.project.name}-01-initial.png`,
  });
});

test('scripted five-leg loop drives state machine READY→COMPLETE with practice record', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?mode=penta');
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await waitHook(page);

  // 點「開始練習」（真實 UI 按鈕）：READY → TAKEOFF，飛控起飛目標 20m。
  await page.locator('[data-penta-training-begin]').click();
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'TAKEOFF');
  await expect(phaseChip(page)).toHaveText('訓練狀態：起飛');
  // 演示應停止（訓練優先）。
  await expect(page.locator('[data-penta-play]')).toHaveText('▶ 播放航線演示');

  // 起飛到達 20m（起飛完成容差 0.5m）→ ENTER_ROUTE。
  await setPose(page, W.w0.x, ALT, W.w0.z);
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'ENTER_ROUTE');
  await expect(page.locator('[data-penta-training-segment]')).toHaveText('目前航段：起飛進入（非五邊）');

  // 到 W1 → SEGMENT_1（第一邊）。
  await setPose(page, W.w1.x, ALT, W.w1.z);
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'SEGMENT_1');
  await expect(page.locator('[data-penta-training-segment]')).toHaveText('目前航段：第一邊');
  await expect(page.locator('[data-penta-training-actual-alt]')).toHaveText('實際高度 20.0 m');
  await expect(page.locator('[data-penta-training-alt-dev]')).toHaveText('高度偏差 0.0 m');

  // 飛行訓練中截圖（機體在 W1、第一邊高亮、已達航點標記）。
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `.playwright-output/penta-training-shots/${testInfo.project.name}-02-flying-segment-1.png`,
  });

  // 其餘四邊：每段停留 ≥ minSegmentTimeS(1.0s) 後推進（防抄捷徑）。
  const legs: Array<[{ x: number; z: number }, string]> = [
    [W.w2, 'SEGMENT_2'],
    [W.w3, 'SEGMENT_3'],
    [W.w4, 'SEGMENT_4'],
    [W.w1, 'SEGMENT_5'],
  ];
  for (const [wp, phase] of legs) {
    await page.waitForTimeout(SEGMENT_WAIT_MS);
    await setPose(page, wp.x, ALT, wp.z);
    await expect(phaseChip(page)).toHaveAttribute('data-phase', phase);
  }

  // 第五邊終點 W0 → COMPLETE。
  await page.waitForTimeout(SEGMENT_WAIT_MS);
  await setPose(page, W.w0.x, ALT, W.w0.z);
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'COMPLETE');
  await expect(phaseChip(page)).toHaveText('訓練狀態：完成');

  // ---- 狀態機斷言（瀏覽器內真實狀態）----
  const st = await getState(page);
  expect(st.phase).toBe('COMPLETE');
  expect(st.segments.map((s) => s.legIndex)).toEqual([0, 1, 2, 3, 4]);
  expect(st.segments.every((s) => s.reached)).toBe(true);
  expect(st.segments.map((s) => s.label)).toEqual(['第一邊', '第二邊', '第三邊', '第四邊', '第五邊']);
  expect(st.reachedWaypoints).toEqual([1, 2, 3, 4, 0]);
  expect(st.endedAtT).not.toBeNull();
  expect(st.maxAltitudeDeviationM).toBeLessThanOrEqual(0.5);
  // 轉換日誌：begin→enter→5×segment→complete。
  expect(st.transitions.map((t) => t.event)).toEqual([
    'begin',
    'enter',
    'segment',
    'segment',
    'segment',
    'segment',
    'segment',
    'complete',
  ]);

  // ---- 教學練習記錄浮層（非官方成績）----
  const overlay = page.locator('[data-penta-training-result]');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute('data-result-state', 'complete');
  await expect(overlay).toContainText('教學練習記錄（非官方成績）');
  await expect(overlay).toContainText('非官方測驗，僅供練習');
  await expect(overlay).toContainText('已完成五邊練習');
  await expect(overlay).toContainText('不進入附錄5 成績單');
  // 五段全部「已到達」。
  await expect(page.locator('[data-penta-result-segment]')).toHaveCount(5);
  await expect(page.locator('[data-penta-result-segment][data-reached="true"]')).toHaveCount(5);
  // 不得出現官方評等樣式。
  await expect(overlay).not.toContainText('評等');
  await expect(overlay).not.toContainText('S ·');
  await expect(overlay).not.toContainText('U ·');
  await expect(overlay).not.toContainText('N ·');

  // 完成後的教學結果截圖（真實運行畫面）。
  await page.screenshot({
    path: `.playwright-output/penta-training-shots/${testInfo.project.name}-07-complete-record.png`,
  });

  expect(errors).toEqual([]);
});

test('pause freezes practice and resume continues (PAUSED/RESUMED)', async ({ page }, testInfo) => {
  await page.goto('/?mode=penta');
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await waitHook(page);

  await page.locator('[data-penta-training-begin]').click();
  await setPose(page, W.w0.x, ALT, W.w0.z);
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'ENTER_ROUTE');
  await setPose(page, W.w1.x, ALT, W.w1.z);
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'SEGMENT_1');
  // 在第一邊停留超過 minSegmentTimeS，確保恢復當帧即可滿足推進條件。
  await page.waitForTimeout(SEGMENT_WAIT_MS);

  // 暫停：chip 顯示「（已暫停）」、按鈕切換為「恢復」可用。
  await page.locator('[data-penta-training-pause]').click();
  await expect(phaseChip(page)).toHaveText('訓練狀態：第一邊（已暫停）');
  await expect(phaseChip(page)).toHaveAttribute('data-paused', 'true');
  await expect(page.locator('[data-penta-training-resume]')).toBeEnabled();
  await expect(page.locator('[data-penta-training-pause]')).toBeDisabled();

  // 暫停截圖（真實運行畫面）。
  await page.screenshot({
    path: `.playwright-output/penta-training-shots/${testInfo.project.name}-05-paused.png`,
  });

  // 暫停中即使把機體放到終點，狀態也不得推進（練習計時凍結）。
  await setPose(page, W.w2.x, ALT, W.w2.z);
  await page.waitForTimeout(700);
  expect((await getState(page)).phase).toBe('SEGMENT_1');

  // 恢復 → 下一帧即推進到 SEGMENT_2。
  await page.locator('[data-penta-training-resume]').click();
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'SEGMENT_2');
  await expect(phaseChip(page)).toHaveAttribute('data-paused', 'false');

  // 恢復後截圖（真實運行畫面）。
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `.playwright-output/penta-training-shots/${testInfo.project.name}-06-resumed.png`,
  });

  // 轉換日誌含 pause／resume 事件。
  const st = await getState(page);
  expect(st.transitions.map((t) => t.event)).toContain('pause');
  expect(st.transitions.map((t) => t.event)).toContain('resume');
});

test('restart resets to READY, clears records and counts (RESTARTED)', async ({ page }) => {
  await page.goto('/?mode=penta');
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await waitHook(page);

  await page.locator('[data-penta-training-begin]').click();
  await setPose(page, W.w0.x, ALT, W.w0.z);
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'ENTER_ROUTE');
  await setPose(page, W.w1.x, ALT, W.w1.z);
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'SEGMENT_1');

  // 清除腳本位姿後按「重新開始」：回 READY、紀錄清空、restartCount=1。
  await clearPose(page);
  await page.locator('[data-penta-training-restart]').click();
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'READY');

  const st = await getState(page);
  expect(st.phase).toBe('READY');
  expect(st.restartCount).toBe(1);
  expect(st.segments).toEqual([]);
  expect(st.reachedWaypoints).toEqual([]);
  expect(st.transitions.map((t) => t.event)).toEqual(['restart']);
  expect(st.transitions[0].detail).toBe('RESTARTED');

  // READY 時演示恢復播放（真實相機／演示行為不受訓練影響）。
  await expect(page.locator('[data-penta-play]')).toHaveText('⏸ 暫停演示');

  // 重新開始後可再次開始練習（閉環可重入）。
  await page.locator('[data-penta-training-begin]').click();
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'TAKEOFF');
});

test('abort ends practice with reason and allows restart (ABORTED)', async ({ page }) => {
  await page.goto('/?mode=penta');
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await waitHook(page);

  await page.locator('[data-penta-training-begin]').click();
  await setPose(page, W.w0.x, ALT, W.w0.z);
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'ENTER_ROUTE');
  await setPose(page, W.w1.x, ALT, W.w1.z);
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'SEGMENT_1');

  // 中止（真實 UI 按鈕）。
  await page.locator('[data-penta-training-abort]').click();
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'ABORTED');
  await expect(phaseChip(page)).toHaveText('訓練狀態：已中止');

  const overlay = page.locator('[data-penta-training-result]');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute('data-result-state', 'aborted');
  await expect(overlay).toContainText('教學練習記錄（非官方成績）');
  await expect(overlay).toContainText('已中止（使用者中止練習）');

  // 關閉浮層後仍可重新開始（按鈕列在浮層外，不受遮擋）。
  await page.locator('[data-penta-training-result-close]').click();
  await expect(overlay).toBeHidden();
  await page.locator('[data-penta-training-restart]').click();
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'READY');
  const st = await getState(page);
  expect(st.abortReason).toBeNull(); // 重新開始後中止原因清空
  expect(st.restartCount).toBe(1);
});

test('altitude and route deviation hints appear beyond teaching tolerance', async ({ page }, testInfo) => {
  await page.goto('/?mode=penta');
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await waitHook(page);

  await page.locator('[data-penta-training-begin]').click();
  await setPose(page, W.w0.x, ALT, W.w0.z);
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'ENTER_ROUTE');
  // 進入段中點（W0→W1 線上）：無偏差、無提示。
  await setPose(page, -5, ALT, -11);
  await expect(page.locator('[data-penta-training-alt-dev]')).toHaveText('高度偏差 0.0 m');
  await expect(page.locator('[data-penta-training-route-dev]')).toHaveText('偏離教學航線 0.0 m');
  await expect(page.locator('[data-penta-training-hint]')).toBeHidden();

  // 高度偏差 +3.0m（超出教學容差 1.0m）：chip、提示文字、amber 視覺。
  await setPose(page, -5, ALT + 3, -11);
  await expect(page.locator('[data-penta-training-alt-dev]')).toHaveText('高度偏差 +3.0 m');
  await expect(page.locator('[data-penta-training-alt-dev]')).toHaveCSS('background-color', 'rgb(90, 67, 24)');
  await expect(page.locator('[data-penta-training-hint]')).toContainText('高度偏差 +3.0m');
  await expect(page.locator('[data-penta-training-hint]')).toBeVisible();

  // 高度偏差提示截圖（真實運行畫面）。
  await page.screenshot({
    path: `.playwright-output/penta-training-shots/${testInfo.project.name}-03-altitude-deviation.png`,
  });

  // 航線偏離（進入段外 3.3m，超出教學容差 2.0m）：chip、提示文字、amber 視覺。
  await setPose(page, 0, ALT, -8);
  await expect(page.locator('[data-penta-training-route-dev]')).toHaveText('偏離教學航線 3.3 m');
  await expect(page.locator('[data-penta-training-route-dev]')).toHaveCSS('background-color', 'rgb(90, 67, 24)');
  await expect(page.locator('[data-penta-training-hint]')).toContainText('偏離教學航線 3.3m');
  await expect(page.locator('[data-penta-training-alt-dev]')).toHaveText('高度偏差 0.0 m');

  // 航線偏離提示截圖（真實運行畫面；3D 偏離連線可見）。
  await page.screenshot({
    path: `.playwright-output/penta-training-shots/${testInfo.project.name}-04-route-deviation.png`,
  });

  // 偏差量測寫入狀態（教學量測，非評分）。
  const st = await getState(page);
  expect(st.maxAltitudeDeviationM).toBeGreaterThanOrEqual(3);
  expect(st.maxRouteDeviationM).toBeGreaterThan(2);
});

test('real keyboard flight drives the state machine (no scripted pose)', async ({ page }, testInfo) => {
  // 真實飛行冒煙以桌面 project 為主；手機版由腳本化閉環與佈局測試覆蓋
  // （手機模擬環境的實體鍵盤事件不可靠，不作為放行依據）。
  test.skip(testInfo.project.name !== 'desktop-chrome', '實機鍵盤飛行冒煙僅桌面 project 執行');

  await page.goto('/?mode=penta');
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await waitHook(page);

  // 確認為真實飛控模式（非腳本位姿）。
  expect(await isScripted(page)).toBe(false);

  // 真實起飛：飛控垂直趨近 20m（上限 2.5m/s，約 8–9s）。
  await page.locator('[data-penta-training-begin]').click();
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'TAKEOFF');
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'ENTER_ROUTE', { timeout: 30_000 });

  // 瀏覽器內真實飛控位置驅動了狀態轉換（非腳本注入）。
  const flight = await page.evaluate(
    () =>
      (
        window as unknown as {
          __pentaTestHook: { getFlight(): { state: string; x: number; y: number; z: number } };
        }
      ).__pentaTestHook.getFlight(),
  );
  expect(flight.state).toBe('flying');
  expect(flight.y).toBeGreaterThan(19.4);
  expect(flight.y).toBeLessThan(20.6);

  // 轉換日誌含 begin／enter（由真實取樣驅動）。
  const st = await getState(page);
  expect(st.transitions.map((t) => t.event)).toEqual(['begin', 'enter']);
  expect(st.startedAtT).not.toBeNull();

  // 真實鍵盤 W 前進（heading 0 → −Z）：位置由鍵盤經輸入管線驅動。
  await page.keyboard.down('w');
  await page.waitForTimeout(1200);
  await page.keyboard.up('w');
  const moved = await page.evaluate(
    () =>
      (
        window as unknown as {
          __pentaTestHook: { getFlight(): { x: number; y: number; z: number } };
        }
      ).__pentaTestHook.getFlight(),
  );
  expect(moved.z).toBeLessThan(-0.5);
  expect(moved.y).toBeGreaterThan(19.4); // 前進不掉高（定位模式自動定高）

  // 尚未到達 W1：仍在 ENTER_ROUTE。
  await expect(phaseChip(page)).toHaveAttribute('data-phase', 'ENTER_ROUTE');
});
