import { spawn } from 'node:child_process';
import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.P5J5_DIAG_PORT ?? '4195');
const runId = `chrome-layer-${crypto.randomUUID().replaceAll('-', '')}`;
const runDir = join(root, '.p5j5-chrome-diagnosis', runId);
const logPath = join(runDir, 'layers.jsonl');
const resultPath = join(runDir, 'result.json');
const viteCli = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const result = { runId, port, layers: [], failure: null, vitePid: null, browserPid: null };

await mkdir(runDir, { recursive: true });
async function log(type, detail = {}) {
  const row = { at: new Date().toISOString(), type, ...detail };
  await appendFile(logPath, `${JSON.stringify(row)}\n`);
}
async function layer(id, timeoutMs, fn) {
  const started = Date.now();
  await log('layer-start', { id, timeoutMs });
  try {
    const value = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${id} timeout`)), timeoutMs)),
    ]);
    result.layers.push({ id, status: 'PASS', durationMs: Date.now() - started });
    await log('layer-pass', { id, durationMs: Date.now() - started });
    return value;
  } catch (error) {
    result.layers.push({ id, status: 'FAIL', durationMs: Date.now() - started, error: String(error) });
    result.failure = { id, error: String(error) };
    await log('layer-fail', { id, durationMs: Date.now() - started, error: String(error) });
    throw error;
  }
}

let vite;
let browser;
try {
  vite = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  result.vitePid = vite.pid;
  vite.stdout.on('data', (b) => log('vite-stdout', { text: String(b).slice(0, 2048) }));
  vite.stderr.on('data', (b) => log('vite-stderr', { text: String(b).slice(0, 2048) }));
  await layer('C0', 15_000, async () => {
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return; } catch {} await new Promise(r => setTimeout(r, 500)); }
    throw new Error('Vite HTTP readiness failed');
  });
  browser = await layer('C1', 20_000, () => chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] }));
  // Browser instances from Playwright's Browser API intentionally do not
  // expose a process handle. The run still records the launch layer and its
  // owned Browser object is closed in finally.
  result.browserPid = null;
  const page = await browser.newPage();
  page.on('console', m => log('console', { level: m.type(), text: m.text().slice(0, 2048) }));
  page.on('pageerror', e => log('pageerror', { text: String(e) }));
  page.on('requestfailed', r => log('requestfailed', { url: r.url(), failure: r.failure()?.errorText }));
  await layer('C2', 8_000, () => page.goto('about:blank'));
  await layer('C3', 8_000, () => page.goto('data:text/html,<title>static</title><main>ok</main>'));
  await layer('C4', 20_000, () => page.goto(`http://127.0.0.1:${port}/?mode=exam&exam=0`, { waitUntil: 'domcontentloaded' }));
  await layer('C5', 15_000, () => page.waitForSelector('[data-rea-canvas]'));
  await layer('C6', 15_000, () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  await layer('C7', 20_000, async () => {
    const qualitySelect = page.locator('[data-rea-quality-select]');
    await log('quality-control-state', {
      visibleBeforeOpen: await qualitySelect.isVisible(),
      disabled: await qualitySelect.isDisabled(),
    });
    if (!await qualitySelect.isVisible()) {
      await page.locator('.rea-settings summary').click();
      await qualitySelect.waitFor({ state: 'visible' });
    }
    for (const quality of ['low', 'medium', 'high', 'low']) {
      await qualitySelect.selectOption(quality);
      await log('quality-after-select', {
        requested: quality,
        selector: await page.locator('[data-rea-quality-select]').inputValue(),
        canvasQuality: await page.locator('[data-rea-canvas]').getAttribute('data-rea-quality'),
        canvasPixelRatio: await page.locator('[data-rea-canvas]').getAttribute('data-rea-pixel-ratio'),
        canvasShadows: await page.locator('[data-rea-canvas]').getAttribute('data-rea-shadows'),
      });
      // The canvas attribute is written only after ExamScene applies the
      // renderer budget. Waiting on the real DOM avoids a cross-realm
      // waitForFunction argument ambiguity in this ESM diagnostic runner.
      await page.waitForSelector(`[data-rea-canvas][data-rea-quality="${quality}"]`);
      const applied = await page.evaluate(() => {
        // This is an ESM JavaScript runner, not TypeScript: keep DOM lookups
        // plain JavaScript so the evaluated source is valid in Chrome.
        const selector = document.querySelector('[data-rea-quality-select]');
        const canvas = document.querySelector('[data-rea-canvas]');
        return {
          selector: selector?.value ?? null,
          quality: canvas?.dataset.reaQuality ?? null,
          pixelRatio: canvas?.dataset.reaPixelRatio ?? null,
          shadows: canvas?.dataset.reaShadows ?? null,
          shadowMapSize: canvas?.dataset.reaShadowMapSize ?? null,
        };
      });
      if (applied.selector !== quality || applied.quality !== quality) {
        throw new Error(`quality control chain mismatch: ${JSON.stringify(applied)}`);
      }
      await log('quality-applied', { requested: quality, applied });
    }
  });
  await layer('C8', 15_000, async () => { await page.reload({ waitUntil: 'domcontentloaded' }); if (await page.locator('[data-rea-quality-select]').inputValue() !== 'low') throw new Error('quality preference did not persist'); });
  await layer('C9', 8_000, () => page.close());
} catch (error) {
  await log('diagnosis-stop', { error: String(error) });
} finally {
  let browserClose = 'not-started'; let viteClose = 'not-started';
  if (browser) { try { await browser.close(); browserClose = 'closed'; } catch (e) { browserClose = String(e); } }
  if (vite && !vite.killed) { vite.kill(); viteClose = 'SIGTERM-sent'; }
  result.teardown = { browserClose, viteClose };
  await writeFile(resultPath, JSON.stringify(result, null, 2));
  console.log(`P5J5_CHROME_LAYER_RESULT=${resultPath}`);
  process.exitCode = result.failure ? 1 : 0;
}
