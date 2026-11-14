// P3 端到端測試（開發用）：學員與教師兩個瀏覽器，跑完「申請 → 教師批准 → 寫入 → 讀回 → 紀錄」。
// 第二段把 USB 接到「已解鎖」的模擬飛控，確認寫入按鈕無法使用、PARAM_SET 不會送出。
// 用法：node param_write_e2e.cjs <base_url> <sessions.json> <disarmed_port> <armed_port> <screenshot_prefix>
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

  // A. 已上鎖的飛控：完整流程
  await connectAndRead(student);
  check('allowlisted parameter offers 申請修改', await student.isVisible('#gcsParamBody tr:first-child button:has-text("申請修改")'));
  await requestChange(student, 0.5);
  check('out-of-range value cannot be submitted', await student.isDisabled('#gcsWriteSubmit'), await student.textContent('#gcsWriteMessage'));
  await requestChange(student, 0.15);
  check('valid request can be submitted', !(await student.isDisabled('#gcsWriteSubmit')));
  await student.click('#gcsWriteSubmit');
  await student.waitForFunction(() => document.getElementById('gcsRequestList').textContent.includes('待教師批准'), null, { timeout: 10000 });
  check('student sees pending request without a write button', !(await student.isVisible('#gcsRequestList button:has-text("寫入飛控")')));

  await teacherApproves(teacher);
  check('teacher approved the request', (await teacher.textContent('#gcsRequestList')).includes('已批准'));

  await student.waitForSelector('#gcsRequestList button:has-text("寫入飛控")', { timeout: 10000 });
  await student.click('#gcsRequestList button:has-text("寫入飛控")');
  check('apply button disabled before re-acknowledging safety', await student.isDisabled('#gcsApplyGo'));
  await student.check('#gcsApplyAck');
  await student.waitForFunction(() => !document.getElementById('gcsApplyGo').disabled, null, { timeout: 3000 });
  const checklist = await student.$$eval('#gcsChecklist li', (lis) => lis.map((li) => li.textContent));
  check('all write checks pass', checklist.every((t) => t.startsWith('✔')), checklist.join(' | '));
  await student.screenshot({ path: `${shotPrefix}_checklist.png`, fullPage: true });
  await student.click('#gcsApplyGo');
  await student.waitForFunction(() => /讀回|失敗/.test(document.getElementById('gcsApplyMessage').textContent) && !document.getElementById('gcsApplyMessage').textContent.includes('等待'), null, { timeout: 10000 });
  check('write confirmed by readback', (await student.textContent('#gcsApplyMessage')).includes('寫入成功'), await student.textContent('#gcsApplyMessage'));
  await student.waitForFunction(() => document.getElementById('gcsRequestList').textContent.includes('已寫入並讀回確認'), null, { timeout: 10000 });
  const row = await student.$$eval('#gcsParamBody tr:first-child td', (tds) => tds.map((td) => td.textContent));
  check('table shows original and new current value', row[1] === '0.135' && row[2] === '0.15', JSON.stringify(row));
  await student.screenshot({ path: `${shotPrefix}_applied.png`, fullPage: true });

  // B. 已解鎖的飛控：寫入必須被擋下
  await student.click('#gcsDisconnect');
  await student.waitForFunction(() => document.getElementById('gcsHeartbeat').dataset.state === 'disconnected');
  targetPort = Number(armedPort);
  await connectAndRead(student);
  check('armed vehicle reported as armed', (await student.textContent('[data-key="armed"]')).includes('ARMED'));
  await requestChange(student, 0.15);
  await student.click('#gcsWriteSubmit');
  await teacherApproves(teacher);
  await student.waitForSelector('#gcsRequestList button:has-text("寫入飛控")', { timeout: 10000 });
  await student.click('#gcsRequestList button:has-text("寫入飛控")');
  await student.check('#gcsApplyAck');
  await student.waitForTimeout(800);
  const armedChecklist = await student.$$eval('#gcsChecklist li', (lis) => lis.map((li) => li.textContent));
  check('armed: disarmed check fails and write button stays disabled',
    armedChecklist[0].startsWith('✘') && (await student.isDisabled('#gcsApplyGo')), armedChecklist[0]);
  await student.screenshot({ path: `${shotPrefix}_armed_blocked.png`, fullPage: true });

  check('no browser console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => { console.error('FAIL e2e crashed:', e); process.exit(1); });
