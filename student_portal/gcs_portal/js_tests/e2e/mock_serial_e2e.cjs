// 端到端測試（開發用）：Chromium 打開 /gcs/，以假的 navigator.serial 把 USB 資料流接到 mock_vehicle.py（TCP）。
// 驗證：連線 → 心跳 → 遙測 → 參數下載（含補讀）→ 匯出 → 斷線；並截圖。
// 用法：node mock_serial_e2e.cjs <base_url> <sessionid> <mock_port> <screenshot_prefix>
const net = require('net');
const { chromium } = require('playwright');

const [baseUrl, sessionId, mockPort, shotPrefix] = process.argv.slice(2);

const FAKE_SERIAL = () => {
  let controller;
  const port = {
    readable: null,
    writable: null,
    async open() {
      this.readable = new ReadableStream({ start(c) { controller = c; } });
      this.writable = new WritableStream({ write(chunk) { window.__bridgeWrite(Array.from(chunk)); } });
      await window.__bridgeOpen();
    },
    async close() { await window.__bridgeClose(); },
    async forget() { window.__forgotten = true; },
  };
  window.__bridgePush = (bytes) => controller && controller.enqueue(Uint8Array.from(bytes));
  window.__bridgeEnd = () => controller && controller.close();
  Object.defineProperty(navigator, 'serial', {
    value: { requestPort: async () => port, addEventListener() {}, removeEventListener() {} },
  });
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addCookies([{ name: 'sessionid', value: sessionId, domain: new URL(baseUrl).hostname, path: '/' }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let socket;
  await page.exposeFunction('__bridgeOpen', () => new Promise((resolve) => {
    socket = net.connect(Number(mockPort), '127.0.0.1', resolve);
    socket.on('data', (d) => page.evaluate((b) => window.__bridgePush(b), Array.from(d)).catch(() => {}));
    socket.on('close', () => page.evaluate(() => window.__bridgeEnd()).catch(() => {}));
  }));
  await page.exposeFunction('__bridgeWrite', (bytes) => socket && socket.write(Buffer.from(bytes)));
  await page.exposeFunction('__bridgeClose', () => socket && socket.end());
  await page.addInitScript(FAKE_SERIAL);

  const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) process.exitCode = 1; };

  await page.goto(`${baseUrl}/gcs/`);
  await page.check('input[value="real"]');
  await page.click('#gcsConnect');
  await page.waitForFunction(() => document.getElementById('gcsHeartbeat').dataset.state === 'ok', null, { timeout: 10000 });
  check('heartbeat received', true, await page.textContent('#gcsIds'));
  await page.waitForFunction(() => document.querySelector('[data-key="attitude"]').textContent !== '—', null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('[data-key="firmware"]').textContent !== '—', null, { timeout: 10000 });
  const telemetry = await page.$$eval('[data-key]', (cells) => Object.fromEntries(cells.map((c) => [c.dataset.key, c.textContent])));
  check('telemetry from MAVLink', telemetry.mode === 'LOITER' && telemetry.firmware.startsWith('4.5.0') && telemetry.gps.includes('RTK'), JSON.stringify(telemetry));
  check('mode bar shows real read-only', (await page.textContent('#gcsModeLabel')).includes('唯讀'));

  await page.click('#gcsParamRead');
  await page.waitForFunction(() => /^(完成|未完整|失敗)/.test(document.getElementById('gcsParamProgress').textContent), null, { timeout: 30000 });
  const progress = await page.textContent('#gcsParamProgress');
  check('all parameters downloaded (with re-reads)', progress.startsWith('完成：共 400'), progress);
  await page.fill('#gcsParamSearch', 'ATC_RAT');
  const rows = await page.$$eval('#gcsParamBody tr', (trs) => trs.map((tr) => Array.from(tr.cells, (c) => c.textContent)));
  check('search filters parameters', rows.length === 2 && rows[0][0] === 'ATC_RAT_PIT_P' && rows[0][2] === '0.135', JSON.stringify(rows));
  await page.fill('#gcsParamSearch', '');
  await page.screenshot({ path: `${shotPrefix}_connected.png`, fullPage: true });

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#gcsParamExport')]);
  const text = require('fs').readFileSync(await download.path(), 'utf8');
  check('export file', /^# FDE-GCS 參數備份/.test(text) && text.includes('ATC_RAT_RLL_P,0.135') && text.trim().split('\n').length === 404, download.suggestedFilename());

  await page.click('#gcsDisconnect');
  await page.waitForFunction(() => document.getElementById('gcsHeartbeat').dataset.state === 'disconnected', null, { timeout: 5000 });
  check('disconnect forgets port permission', await page.evaluate(() => window.__forgotten === true));
  check('no browser console errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${shotPrefix}_disconnected.png`, fullPage: true });
  await browser.close();
})().catch((e) => { console.error('FAIL e2e crashed:', e); process.exit(1); });
