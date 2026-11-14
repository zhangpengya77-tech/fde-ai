// Web 1.1 端到端測試（開發用）：調低 26% → 申請還原（以目前值為基準是 +35%，一般申請會被擋）→ 教師批准 → 寫回原值。
// 也檢查教師頁面的待批准提醒。
// 用法：node revert_e2e.cjs <base_url> <sessions.json> <disarmed_port> <unused> <screenshot_prefix>
const fs = require('fs');
const net = require('net');
const { chromium } = require('playwright');

const [baseUrl, sessionsFile, disarmedPort, armedPort, shotPrefix] = process.argv.slice(2);
const sessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
let targetPort = Number(disarmedPort);

const FAKE_SERIAL = () => {
  let controller;
  const port = {
    async open() {
      this.readable = new ReadableStream({ start(c) { controller = c; } });
      this.writable = new WritableStream({ write(chunk) { window.__bridgeWrite(Array.from(chunk)); } });
      await window.__bridgeOpen();
    },
    async close() { await window.__bridgeClose(); },
    async forget() {},
  };
  window.__bridgePush = (bytes) => controller && controller.enqueue(Uint8Array.from(bytes));
  window.__bridgeEnd = () => { try { controller.close(); } catch (e) { /* closed */ } };
  Object.defineProperty(navigator, 'serial', { value: { requestPort: async () => port, addEventListener() {}, removeEventListener() {} } });
};

const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) process.exitCode = 1; };

async function openPage(browser, sessionId, errors, withSerial) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1300 } });
  await context.addCookies([{ name: 'sessionid', value: sessionId, domain: new URL(baseUrl).hostname, path: '/' }]);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  if (withSerial) {
    let socket;
    await page.exposeFunction('__bridgeOpen', () => new Promise((resolve) => {
      socket = net.connect(targetPort, '127.0.0.1', resolve);
      socket.on('data', (d) => page.evaluate((b) => window.__bridgePush(b), Array.from(d)).catch(() => {}));
      socket.on('close', () => page.evaluate(() => window.__bridgeEnd()).catch(() => {}));
    }));
    await page.exposeFunction('__bridgeWrite', (bytes) => socket && !socket.destroyed && socket.write(Buffer.from(bytes)));
    await page.exposeFunction('__bridgeClose', () => socket && socket.end());
    await page.addInitScript(FAKE_SERIAL);
  }
  await page.goto(`${baseUrl}/gcs/`);
  return page;
}

async function connectAndRead(page) {
  await page.check('input[value="real"]');
  await page.click('#gcsConnect');
  await page.waitForFunction(() => document.getElementById('gcsHeartbeat').dataset.state === 'ok', null, { timeout: 10000 });
  await page.click('#gcsParamRead');
  await page.waitForFunction(() => document.getElementById('gcsParamProgress').textContent.startsWith('完成'), null, { timeout: 30000 });
  await page.fill('#gcsParamSearch', 'ATC_RAT_RLL_P');
}

async function requestChange(page, value) {
  await page.click('#gcsParamBody tr:first-child button:has-text("申請修改")');
  await page.fill('#gcsWriteNew', String(value));
  await page.check('#gcsWriteAck');
}

async function teacherApproves(teacher) {
  await teacher.reload();
  await teacher.waitForSelector('#gcsRequestList button:has-text("批准")', { timeout: 10000 });
  await teacher.click('#gcsRequestList button:has-text("批准")');
  await teacher.waitForFunction(() => !Array.from(document.querySelectorAll('#gcsRequestList button')).some((b) => b.textContent === '批准'), null, { timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const student = await openPage(browser, sessions.student, errors, true);
  const teacher = await openPage(browser, sessions.teacher, errors, false);

  await connectAndRead(student);
  await requestChange(student, 0.1);
  await student.click('#gcsWriteSubmit');
  await student.waitForFunction(() => document.getElementById('gcsRequestList').textContent.includes('待教師批准'), null, { timeout: 10000 });

  await teacher.reload();
  await teacher.waitForFunction(() => document.title.startsWith('(1) '), null, { timeout: 10000 });
  check('teacher tab title shows pending count', (await teacher.title()).startsWith('(1) '), await teacher.title());
  check('teacher heading shows pending count', (await teacher.textContent('#gcsRequestTitle')).includes('待你批准 1 筆'));
  await teacherApproves(teacher);
  check('pending reminder clears after approval', !(await teacher.title()).startsWith('('), await teacher.title());

  async function applyApproved() {
    await student.waitForSelector('#gcsRequestList button:has-text("寫入飛控")', { timeout: 10000 });
    await student.click('#gcsRequestList button:has-text("寫入飛控")');
    await student.check('#gcsApplyAck');
    await student.waitForFunction(() => !document.getElementById('gcsApplyGo').disabled, null, { timeout: 3000 });
    await student.click('#gcsApplyGo');
    await student.waitForFunction(() => document.getElementById('gcsApplyMessage').textContent.includes('寫入成功'), null, { timeout: 10000 });
  }
  await applyApproved();
  await student.waitForSelector('#gcsRequestList button:has-text("申請還原")', { timeout: 10000 });
  check('applied write offers 申請還原', true);

  await requestChange(student, 0.135);
  check('normal request back to 0.135 is blocked by the 30% step limit', await student.isDisabled('#gcsWriteSubmit'), await student.textContent('#gcsWriteMessage'));
  await student.click('#gcsWriteClose');

  await student.click('#gcsRequestList button:has-text("申請還原")');
  await student.waitForFunction(() => document.getElementById('gcsRequestList').textContent.includes('【還原】'), null, { timeout: 10000 });
  check('revert request created and marked', true);
  check('revert button disappears once a revert exists', !(await student.isVisible('#gcsRequestList button:has-text("申請還原")')));

  await teacher.reload();
  await teacherApproves(teacher);
  await applyApproved();
  await student.waitForFunction(() => {
    const cells = document.querySelectorAll('#gcsParamBody tr:first-child td');
    return cells.length > 2 && cells[2].textContent === '0.135';
  }, null, { timeout: 10000 }).catch(() => {});
  const row = await student.$$eval('#gcsParamBody tr:first-child td', (tds) => tds.map((td) => td.textContent));
  check('vehicle value is back to the original', row[2] === '0.135', JSON.stringify(row));
  await student.screenshot({ path: `${shotPrefix}_revert.png`, fullPage: true });

  check('no browser console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => { console.error('FAIL e2e crashed:', e); process.exit(1); });
