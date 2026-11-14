// P5 端到端測試（開發用）：備份上傳 → 教師批准的調參寫入 → 第二份備份 → 差異報告 → AI 調參助教 → 教師 PASS → 任務卡 → CSV 匯出。
// 用法：node results_e2e.cjs <base_url> <sessions.json> <mock_port> <screenshot_prefix>
const fs = require('fs');
const net = require('net');
const { chromium } = require('playwright');

const [baseUrl, sessionsFile, mockPort, shotPrefix] = process.argv.slice(2);
const sessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));

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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1500 }, acceptDownloads: true });
  await context.addCookies([{ name: 'sessionid', value: sessionId, domain: new URL(baseUrl).hostname, path: '/' }]);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    // 雲端測試環境沒有設定 RAG 上游，AI 端點回 503 是預期結果，不算前端錯誤。
    if (m.type() === 'error' && !m.text().includes('503')) errors.push(m.text());
  });
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'e2e 覆核' : undefined));
  if (withSerial) {
    let socket;
    await page.exposeFunction('__bridgeOpen', () => new Promise((resolve) => {
      socket = net.connect(Number(mockPort), '127.0.0.1', resolve);
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

const waitText = (page, selector, text, timeout = 15000) => page.waitForFunction(
  ([s, t]) => document.querySelector(s) && document.querySelector(s).textContent.includes(t), [selector, text], { timeout },
);

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const student = await openPage(browser, sessions.student, errors, true);
  const teacher = await openPage(browser, sessions.teacher, errors, false);

  await waitText(student, '#gcsTaskCard', '上傳備份');
  const initialTasks = await student.$$eval('#gcsTaskCard li', (lis) => lis.map((li) => li.dataset.ok));
  check('task card starts with nothing done', initialTasks.every((v) => v === 'false'), JSON.stringify(initialTasks));

  await student.check('input[value="real"]');
  await student.click('#gcsConnect');
  await student.waitForFunction(() => document.getElementById('gcsHeartbeat').dataset.state === 'ok', null, { timeout: 10000 });
  await student.click('#gcsParamRead');
  await waitText(student, '#gcsParamProgress', '完成', 30000);
  await student.click('#gcsBackupUpload');
  await waitText(student, '#gcsResultMessage', '已上傳');
  await waitText(student, '#gcsBackupList', '400 個參數');
  check('first backup uploaded', true);

  await student.fill('#gcsParamSearch', 'ATC_RAT_RLL_P');
  await student.click('#gcsParamBody tr:first-child .gcs-link');
  check('AI tutor shows teacher explanation', (await student.textContent('#gcsAiPurpose')).includes('Roll'), await student.textContent('#gcsAiRange'));
  await student.click('#gcsAiAsk');
  await student.waitForFunction(() => !document.getElementById('gcsAiAnswer').textContent.includes('思考中'), null, { timeout: 15000 });
  const aiText = await student.textContent('#gcsAiAnswer');
  check('AI tutor answers or explains it is unavailable', aiText.startsWith('AI 建議') || aiText.startsWith('AI 助教目前無法回答'), aiText);
  check('AI panel has no apply/write button', (await student.$$('#gcs-ai button')).length === 1);

  // 教師批准的寫入
  await student.click('#gcsParamBody tr:first-child button:has-text("申請修改")');
  await student.fill('#gcsWriteNew', '0.15');
  await student.check('#gcsWriteAck');
  await student.click('#gcsWriteSubmit');
  await waitText(student, '#gcsRequestList', '待教師批准');
  await teacher.reload();
  await teacher.waitForSelector('#gcsRequestList button:has-text("批准")');
  await teacher.click('#gcsRequestList button:has-text("批准")');
  await student.waitForSelector('#gcsRequestList button:has-text("寫入飛控")', { timeout: 10000 });
  await student.click('#gcsRequestList button:has-text("寫入飛控")');
  await student.check('#gcsApplyAck');
  await student.waitForFunction(() => !document.getElementById('gcsApplyGo').disabled, null, { timeout: 3000 });
  await student.click('#gcsApplyGo');
  await waitText(student, '#gcsRequestList', '已寫入並讀回確認');

  // 第二份備份與差異報告
  await student.click('#gcsParamRead');
  await waitText(student, '#gcsParamProgress', '完成', 30000);
  await student.waitForFunction(() => !document.getElementById('gcsBackupUpload').disabled, null, { timeout: 5000 });
  await student.click('#gcsBackupUpload');
  await student.waitForFunction(() => document.querySelectorAll('#gcsBackupList li').length === 2, null, { timeout: 10000 });
  await student.click('#gcsBackupList li:first-child button:has-text("差異報告")');
  await waitText(student, '#gcsDiffTitle', '變更 1');
  const diffRows = await student.$$eval('#gcsDiffBody tr', (trs) => trs.map((tr) => Array.from(tr.cells, (c) => c.textContent)));
  check('diff report shows exactly the approved change', JSON.stringify(diffRows) === JSON.stringify([['ATC_RAT_RLL_P', '0.135', '0.15']]), JSON.stringify(diffRows));

  // 教師覆核
  await teacher.reload();
  await teacher.waitForSelector('#gcsRequestList button:has-text("PASS")');
  await teacher.click('#gcsRequestList button:has-text("PASS")');
  await waitText(teacher, '#gcsRequestList', '教師覆核 PASS');
  await teacher.waitForSelector('#gcsBackupList li:first-child button:has-text("PASS")');
  await teacher.click('#gcsBackupList li:first-child button:has-text("PASS")');
  await waitText(teacher, '#gcsBackupList', 'e2e 覆核');
  check('teacher reviewed write and backup', true);

  await student.waitForFunction(() => Array.from(document.querySelectorAll('#gcsTaskCard li')).every((li) => li.dataset.ok === 'true'), null, { timeout: 10000 });
  check('task card all done from server records', true);
  await student.screenshot({ path: `${shotPrefix}_student.png`, fullPage: true });

  const [download] = await Promise.all([teacher.waitForEvent('download'), teacher.click('#gcsExport')]);
  const csv = fs.readFileSync(await download.path(), 'utf8');
  check('teacher CSV export contains student results', csv.includes(sessions.student_id) && csv.includes('ATC_RAT_RLL_P') && csv.includes('PASS') && !csv.includes('@example.com'),
    `${download.suggestedFilename()} ${csv.split('\n').length - 1} 行`);
  await teacher.screenshot({ path: `${shotPrefix}_teacher.png`, fullPage: true });

  check('no browser console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => { console.error('FAIL e2e crashed:', e); process.exit(1); });
