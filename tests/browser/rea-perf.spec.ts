import { expect, test } from '@playwright/test';

/**
 * LOW／MEDIUM／HIGH 畫質效能實測（只在 REA_PERF=1 時執行，平常測試會略過）。
 * 方法：看示範飛行（8 字，WEB LITE 引擎）期間，用 requestAnimationFrame 實際計數 10 秒，
 * 求平均 FPS、1% 低幀（最慢 1% 幀間隔換算）與最長單幀時間；結果寫到 D 槽 JSON。
 * 這是本機實測數字，不同硬體結果不同。
 */
declare const process: {
  env: Record<string, string | undefined>;
  getBuiltinModule?: (name: string) => unknown;
};

const enabled = process.env.REA_PERF === '1';
const out = process.env.REA_PERF_OUT ?? 'D:/FDE-CC-Takeover/runs/perf-quality.json';
const results: Record<string, unknown> = {};

test.describe('畫質效能實測', () => {
  test.skip(!enabled, '只在 REA_PERF=1 時執行');
  test.setTimeout(120_000);

  for (const quality of ['low', 'medium', 'high'] as const) {
    test(`${quality} 畫質：示範飛行 10 秒 FPS`, async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop-chrome', '只量桌機');
      await page.addInitScript((q) => {
        localStorage.setItem('fde-rea-exam-prefs-v1', JSON.stringify({ engine: 'web_lite', subjectId: 'figure-eight', airframeId: 'quad-800g', quality: q }));
      }, quality);
      await page.goto('/?mode=exam&exam=0');
      await page.locator('[data-rea-demo]').click();
      // 等起飛後再量，避開載入與倒數
      await page.waitForTimeout(5_000);
      const m = await page.evaluate(() => new Promise<{ frames: number; avgFps: number; low1Fps: number; maxFrameMs: number }>((resolve) => {
        const gaps: number[] = [];
        let last = performance.now();
        const start = last;
        const tick = (t: number) => {
          gaps.push(t - last); last = t;
          if (t - start < 10_000) requestAnimationFrame(tick);
          else {
            const sorted = [...gaps].sort((a, b) => b - a);
            const worst = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 100)));
            const avgWorst = worst.reduce((a, b) => a + b, 0) / worst.length;
            resolve({ frames: gaps.length, avgFps: gaps.length / ((t - start) / 1000), low1Fps: 1000 / avgWorst, maxFrameMs: sorted[0] });
          }
        };
        requestAnimationFrame(tick);
      }));
      const applied = await page.locator('[data-rea-quality-select]').inputValue();
      results[quality] = { ...m, appliedQuality: applied, measuredAt: new Date().toISOString() };
      console.log(`[效能] ${quality}：平均 ${m.avgFps.toFixed(1)} FPS、1% 低幀 ${m.low1Fps.toFixed(1)} FPS、最長單幀 ${m.maxFrameMs.toFixed(1)} ms`);
      expect(m.frames).toBeGreaterThan(0);
      const fs = process.getBuiltinModule?.('fs') as { writeFileSync: (p: string, d: string) => void } | undefined;
      fs?.writeFileSync(out, JSON.stringify(results, null, 2));
    });
  }
});
