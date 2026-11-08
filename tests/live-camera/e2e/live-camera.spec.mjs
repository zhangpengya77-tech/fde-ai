// 即時鏡頭檢測端對端測試：Chrome 假鏡頭（--use-fake-device-for-media-stream＋--use-file-for-fake-video-capture）
// 餵固定影片 → 驗證綠／紅／灰框、答案文字、不問不講話、發問才回答、知識庫只呼叫一次，並記錄實測 FPS。
import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FPS_LOG = resolve(fileURLToPath(new URL('../../../test-results/live-camera/fps.jsonl', import.meta.url)));

/** 測試前置：知識庫指向本機模擬伺服器、記錄朗讀內容、可選擇強制 WASM。 */
async function prepare(page, { backend } = {}) {
  await page.addInitScript((forced) => {
    Object.defineProperty(window, 'FdeRagConfig', {
      configurable: true,
      set(v) { this.__ragc = Object.freeze({ ...v, RAG_API_MODE: 'local', RAG_API_BASE_URL: location.origin }); },
      get() { return this.__ragc; },
    });
    window.__spoken = [];
    speechSynthesis.speak = (u) => { if (u.text.trim()) window.__spoken.push(u.text); };
    try { if (forced) localStorage.setItem('fde-live-backend', forced); } catch { /* 略過 */ }
  }, backend || '');
}

async function openLive(page, mode = 'ok') {
  await page.request.get(`/__mode?m=${mode}`);
  await page.goto('/index.html');
  await page.locator('a[href="./eagle"]').first().click();
  await expect(page.locator('#inspection')).toBeVisible();
  await page.locator('[data-prop-tab="live"]').click();
  await expect(page.locator('[data-prop-pane="image"]')).toBeHidden();
  await page.locator('[data-live="start"]').click();
}

const panel = (page) => page.evaluate(() => {
  const q = (n) => document.querySelector(`[data-live="${n}"]`);
  const c = window.FdePropLive.controller.state;
  return {
    headline: q('headline').textContent, tone: q('answer').dataset.tone, lines: [...q('lines').children].map((li) => li.textContent),
    error: q('error').hidden ? '' : q('error').textContent, signature: c.stableInfo ? c.stableInfo.signature : '',
    colors: (c.lastJudgement ? c.lastJudgement.boxes : []).map((b) => b.color), backend: c.backend,
    results: c.results || 0, inferMs: c.inferMs || 0, spoken: window.__spoken.length,
  };
});

async function waitStable(page, predicate, timeout = 120_000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    last = await panel(page);
    if (predicate(last)) return last;
    await page.waitForTimeout(250);
  }
  throw new Error(`等待逾時，最後狀態：${JSON.stringify(last)}`);
}

/** 記錄實測 FPS：取 10 秒內的結果數，加上 Worker 單次推論平均耗時。 */
async function recordFps(page, label) {
  const a = await panel(page);
  const t0 = Date.now();
  await page.waitForTimeout(10_000);
  const b = await panel(page);
  const seconds = (Date.now() - t0) / 1000;
  const row = { label, backend: b.backend, loopFps: +((b.results - a.results) / seconds).toFixed(2), inferMs: Math.round(b.inferMs), at: new Date().toISOString() };
  mkdirSync(resolve(FPS_LOG, '..'), { recursive: true });
  appendFileSync(FPS_LOG, `${JSON.stringify(row)}\n`);
  test.info().annotations.push({ type: 'fps', description: JSON.stringify(row) });
  return row;
}

test.describe('四支都正確 @correct', () => {
  test('全綠框＋「目前四支槳都已換到正確位置。」，不問不講話；記錄 WebGPU FPS', async ({ page }) => {
    await prepare(page);
    await openLive(page);
    const p = await waitStable(page, (x) => x.signature === 'CORRECT');
    expect(p.tone).toBe('green');
    expect(p.headline).toBe('目前四支槳都已換到正確位置。');
    expect(p.spoken).toBe(0);
    const fps = await recordFps(page, 'correct-default');
    expect(fps.loopFps).toBeGreaterThan(0);
    const after = await panel(page);
    expect(after.colors.every((c) => c === 'green')).toBe(true);
    expect(after.spoken).toBe(0);
  });

  test('強制 WASM 後備：結果相同；記錄 WASM FPS', async ({ page }) => {
    await prepare(page, { backend: 'wasm' });
    await openLive(page);
    const p = await waitStable(page, (x) => x.signature === 'CORRECT');
    expect(p.backend).toBe('wasm');
    await recordFps(page, 'correct-wasm');
  });
});

test.describe('四支全反 @reversed', () => {
  test('全紅框＋逐位置說明＋鏡像提醒', async ({ page }) => {
    await prepare(page);
    await openLive(page);
    const p = await waitStable(page, (x) => x.signature.startsWith('WRONG'));
    expect(p.tone).toBe('red');
    expect(p.headline).toBe('有槳裝錯了，請依下方說明更換。');
    expect(p.lines).toContain('左上應為 CW，目前是 CCW，請依正確方向更換。');
    expect(p.lines.at(-1)).toMatch(/鏡像/);
    await page.waitForTimeout(1000);
    expect((await panel(page)).colors.every((c) => c === 'red')).toBe(true);
  });
});

test.describe('信心不足 @uncertain', () => {
  test('灰框＋「我無法判斷，請找線下老師確認。」，絕不出現綠色', async ({ page }) => {
    await prepare(page);
    await openLive(page);
    const p = await waitStable(page, (x) => x.signature === 'UNCERTAIN');
    expect(p.tone).toBe('gray');
    expect(p.headline).toBe('我無法判斷，請找線下老師確認。');
    for (let i = 0; i < 8; i++) {
      const x = await panel(page);
      expect(x.tone).not.toBe('green');
      expect(x.colors).not.toContain('green');
      await page.waitForTimeout(500);
    }
  });
});

test.describe('換槳流程：錯 → 對 @fix', () => {
  test('發問才回答、知識庫只呼叫一次、修正後顯示「你已經換到正確的了」', async ({ page }) => {
    await prepare(page);
    const rag0 = (await (await page.request.get('/__ragcount')).json()).count;
    await openLive(page);
    const wrong = await waitStable(page, (x) => x.signature.startsWith('WRONG'));
    expect(wrong.spoken).toBe(0);
    await page.locator('[data-live="question"]').fill('我這樣裝對嗎？');
    await page.locator('[data-live="ask"]').click();
    await expect(page.locator('[data-live="replyRag"]')).toContainText('知識庫補充');
    await expect(page.locator('[data-live="replyRule"]')).toHaveText(/^不對。/);
    await page.locator('[data-live="question"]').fill('那要怎麼換？');
    await page.locator('[data-live="ask"]').click();
    await page.waitForTimeout(800);
    const fixed = await waitStable(page, (x) => x.headline === '你已經換到正確的了。');
    expect(fixed.tone).toBe('green');
    await page.locator('[data-live="question"]').fill('現在對了嗎？');
    await page.locator('[data-live="ask"]').click();
    await expect(page.locator('[data-live="replyRule"]')).toHaveText('對，你已經換到正確的了。');
    const rag = (await (await page.request.get('/__ragcount')).json()).count - rag0;
    expect(rag).toBe(1);
    expect(await page.evaluate(() => window.__spoken.length)).toBe(3);
  });
});

test.describe('模型閘門 @correct', () => {
  for (const [mode, text] of [
    ['none', '老師尚未啟用槳葉辨識模型，請稍後再試或找老師確認。'],
    ['fb', '模型類別不符合（只接受 CW、CCW），已停止載入。'],
    ['badsha', '模型檔案核對失敗，已停止載入，請找老師確認。'],
  ]) {
    test(`模型情境 ${mode}：顯示提示並停止`, async ({ page }) => {
      await prepare(page);
      await openLive(page, mode);
      await expect(page.locator('[data-live="error"]')).toHaveText(text);
      expect(await page.evaluate(() => window.FdePropLive.controller.state.running)).toBe(false);
    });
  }
});

// 2026-11-08 iPhone 實測回報：畫面停在「還在判斷中」、切換鏡頭就停止。以下模擬三種手機狀況。
test.describe('手機狀況（iPhone 回報） @correct', () => {
  test('WebGPU 推論失敗：自動改用 WASM，仍能判出結果，不會卡在「還在判斷中」', async ({ page }) => {
    await prepare(page);
    await page.addInitScript(() => { try { localStorage.setItem('fde-live-test-fail-webgpu', '1'); } catch { /* 略過 */ } });
    await openLive(page);
    const p = await waitStable(page, (x) => x.signature === 'CORRECT');
    expect(p.backend).toBe('wasm');
    expect(p.headline).toBe('目前四支槳都已換到正確位置。');
  });

  test('瀏覽器不支援直接擷取影片畫面：改用畫布擷取，仍能判出結果', async ({ page }) => {
    await prepare(page);
    await page.addInitScript(() => {
      const original = window.createImageBitmap.bind(window);
      window.createImageBitmap = (source, ...rest) => (source instanceof HTMLVideoElement ? Promise.reject(new Error('unsupported')) : original(source, ...rest));
    });
    await openLive(page);
    await waitStable(page, (x) => x.signature === 'CORRECT');
    expect(await page.evaluate(() => window.FdePropLive.controller.state.useCanvasGrab)).toBe(true);
  });

  test('指定的鏡頭打不開：退回預設後置鏡頭並繼續，不整個停止', async ({ page }) => {
    await prepare(page);
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) => (c && c.video && c.video.deviceId
        ? Promise.reject(Object.assign(new Error('over'), { name: 'OverconstrainedError' })) : original(c));
    });
    await openLive(page);
    await waitStable(page, (x) => x.signature === 'CORRECT');
    await page.locator('[data-live="camera"]').selectOption('0');
    await expect(page.locator('[data-live="status"]')).toHaveText('指定的鏡頭無法開啟，已改用預設後置鏡頭。');
    expect(await page.evaluate(() => window.FdePropLive.controller.state.running)).toBe(true);
    await expect(page.locator('[data-live="error"]')).toBeHidden();
    await waitStable(page, (x) => x.signature === 'CORRECT');
  });

  test('一直沒有辨識結果：15 秒後停止並說明原因（不會永遠停在「還在判斷中」）', async ({ page }) => {
    await prepare(page, { backend: 'wasm' });
    await page.addInitScript(() => {
      // 模擬推論完全沒有回應：攔下送往 Worker 的畫面
      const OriginalWorker = window.Worker;
      window.Worker = function (url, opts) {
        const w = new OriginalWorker(url, opts);
        const post = w.postMessage.bind(w);
        w.postMessage = (m, t) => { if (m && m.type === 'frame') { m.bitmap.close(); return undefined; } return post(m, t); };
        return w;
      };
    });
    await openLive(page);
    await expect(page.locator('[data-live="error"]')).toContainText('辨識沒有回應', { timeout: 60_000 });
    expect(await page.evaluate(() => window.FdePropLive.controller.state.running)).toBe(false);
    expect(await page.locator('[data-live="headline"]').textContent()).toBe('');
  });
});
