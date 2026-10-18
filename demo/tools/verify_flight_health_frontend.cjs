// Phase 6｜Flight Health AI 前端驗收（唯讀自動化）
//
// 目的：在不啟動教師診斷主機（:8040）的前提下，驗證飛行健康 AI 前端的
//      降級行為、DEMO 隔離、學員視圖安全與五階段流程可達性。
//
// ⚠️ 本工具**不修改** flight-health/ 任何檔案，僅以唯讀方式提供靜態服務；
//    **不連線**任何飛行健康後端。真實飛行日誌分析屬教師實機操作，PENDING_MANUAL。
//
// 驗收點：
//   A1 頁面可載入且標題正確
//   A2 後端離線時顯示「離線」橫幅（資訊提示，非阻塞）
//   A2b CASE4：無日誌時「開始分析」按鈕停用（唯一硬性擋下條件）
//   A2c 核心修復：離線 + 已選日誌 → 按鈕可點（不再因「模型未綁定 / 離線」阻塞）
//   A2d 診斷引擎標籤顯示「系統標準規則」（無教師模型時的正式可用引擎）
//   A2e 無阻塞技術提示：不得出現「未綁定 / 才能繼續 / 請先啟用診斷」字樣
//   A3 離線**不自動進入** DEMO（停在階段 ①）——嚴格隔離規定
//   A4 手動點擊「體驗 DEMO」才進入階段 ②，四大健康卡渲染
//   A5 DEMO 頂部橫幅顯示；退出 DEMO 回到階段 ①
//   A6 學員報告 DOM **不含** RCOU/EKF/ATT/VIBE/PID 等原始工程欄位
//   A7 階段 ③ 提交飛手回饋 → 階段 ④ 關聯四區塊與八項結論渲染
//   A8 教師專業抽屜預設關閉，僅手動觸發才開啟
//   A9 階段 ⑤ 成長記錄卡渲染且含教師複核狀態
//   A10 390×844 無水平溢出
//   A11 全程 0 JS 錯誤
const { execFile } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = Number(process.env.FDE_FH_CDP_PORT || 9342);
const USER_DATA = process.env.FDE_FH_PROFILE || 'D:\\AI_Cache\\temp\\chrome-p6-flight-health';
const HTTP_PORT = Number(process.env.FDE_FH_HTTP_PORT || 8199);
const ROOT = process.env.FDE_FH_ROOT || 'D:\\FDE-AI-UAS-v2.0\\flight-health';
const OUT_DIR = 'D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs';
const URL = `http://127.0.0.1:${HTTP_PORT}/index.html`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RESULTS = [];
function check(name, ok, detail = '') {
  RESULTS.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (detail ? ' | ' + detail : ''));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const fp = path.normalize(path.join(ROOT, rel === '/' ? 'index.html' : rel));
  if (!fp.startsWith(path.normalize(ROOT))) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  });
});

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (e) { /* 首次不存在 */ }
  await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r));
  console.log(`[static] serving ${ROOT} at http://127.0.0.1:${HTTP_PORT}/`);

  const chrome = execFile(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${USER_DATA}`,
    '--window-size=430,900', 'about:blank',
  ], () => {});

  try {
    let wsUrl = null;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try {
        const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
        const page = targets.find((t) => t.type === 'page');
        if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
      } catch (e) { /* retry */ }
    }
    if (!wsUrl) throw new Error('CDP target not found');

    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    const send = (method, params = {}) => new Promise((resolve) => {
      const mid = ++id; pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
    await new Promise((r) => ws.addEventListener('open', r));

    const consoleErrors = [];
    await send('Runtime.enable');
    await send('Log.enable');
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrors.push(String(m.params.args?.[0]?.value || m.params.args?.[0]?.description || ''));
      }
      if (m.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(String(m.params.exceptionDetails?.text || 'exception'));
      }
    });

    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r.result?.result?.value;
    };

    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    });

    await send('Page.navigate', { url: URL });
    for (let i = 0; i < 40; i++) {
      await sleep(300);
      const ready = await evaluate('document.readyState');
      if (ready === 'complete') break;
    }
    await sleep(1200); // 等待 checkServiceConnection 探針失敗並渲染橫幅

    // A1 標題
    const title = await evaluate('document.title');
    check('A1｜頁面可載入且標題正確', title === '飛行健康 AI 分析 | FDE-AI-UAS', `title="${title}"`);

    // A2 離線橫幅（資訊提示，非阻塞）
    const bannerText = await evaluate('(document.getElementById("service-status-banner")||{}).textContent || ""');
    check('A2｜後端離線顯示「離線」橫幅而非「已連接」',
      /離線/.test(bannerText) && !/已連接/.test(bannerText), bannerText.trim().slice(0, 60));

    // A2b CASE4：無日誌時「開始分析」按鈕停用（唯一硬性擋下條件）
    const analyzeDisabledNoFile = await evaluate('(document.getElementById("start-analyze-btn")||{}).disabled');
    check('A2b｜無日誌時按鈕停用（CASE4）', analyzeDisabledNoFile === true, `disabled=${analyzeDisabledNoFile}`);

    // A2c 核心修復：離線 + 已選日誌 → 按鈕可點（不再因「模型未綁定 / 離線」阻塞學員）
    await evaluate('handleFile(new File([new Uint8Array([65,66,67,68])], "FLIGHT0001.BIN", {type:"application/octet-stream"}))');
    await sleep(300);
    const analyzeEnabledWithFile = await evaluate('!(document.getElementById("start-analyze-btn")||{}).disabled');
    check('A2c｜離線 + 已選日誌時按鈕可點（修復核心：不阻塞學員）', analyzeEnabledWithFile === true, `enabled=${analyzeEnabledWithFile}`);

    // A2d 診斷引擎標籤：預設「系統標準規則」（無教師模型時的正式可用引擎）
    const engineLabel = await evaluate('(document.getElementById("flight-health-engine-status")||{}).textContent || ""');
    check('A2d｜診斷引擎標籤顯示「系統標準規則」', /系統標準規則/.test(engineLabel), engineLabel.trim());

    // A2e 無阻塞技術提示：不得出現「才能繼續 / 未綁定 / 請先啟用診斷」等字樣
    const noBlockText = await evaluate('!/(才能繼續|未綁定|請先啟用診斷|教師診斷主模型未綁定)/.test(document.body.textContent)');
    check('A2e｜無「模型未綁定 / 才能繼續」等阻塞技術提示', noBlockText === true);

    // A3 不自動進 DEMO
    const stageBefore = await evaluate('AppState.currentStage');
    check('A3｜離線不自動進入 DEMO（停在階段 ①）', stageBefore === 1, `currentStage=${stageBefore}`);

    // A4 手動進入 DEMO
    await evaluate('enterDemoMode()');
    await sleep(400);
    const stageAfter = await evaluate('AppState.currentStage');
    const cards = await evaluate(
      '["propulsion-card","battery-card","gps-card","stability-card"].map(i=>((document.getElementById(i)||{}).textContent||"").trim()).filter(t=>t.length>10).length');
    check('A4｜手動點擊後進入階段 ②', stageAfter === 2, `currentStage=${stageAfter}`);
    check('A4b｜階段 ② 四大健康卡全部渲染', cards === 4, `rendered=${cards}/4`);
    const demoBanner = await evaluate('!document.getElementById("demo-top-banner").classList.contains("hidden")');
    check('A5｜DEMO 橫幅顯示（與真實分析明確區隔）', demoBanner === true);

    // A6 學員視圖安全：DOM 不得出現原始工程欄位
    const stage2Text = await evaluate('document.getElementById("stage-2").textContent');
    const leaked = ['RCOU', 'EKF', 'VIBE', 'ATT', 'PID', 'RCIN'].filter((k) => stage2Text.includes(k));
    check('A6｜學員報告不含原始工程欄位（RCOU/EKF/VIBE/ATT/PID/RCIN）', leaked.length === 0,
      leaked.length ? '洩漏: ' + leaked.join(',') : 'stage-2 DOM 無原始欄位');

    // A7 階段 ③ → ④
    await evaluate('goToStage(3)');
    await evaluate('document.getElementById("submit-feedback-btn").click()');
    await sleep(300);
    const stage4 = await evaluate('AppState.currentStage');
    const corr = await evaluate('(document.getElementById("correlator-four-blocks").textContent||"").length');
    const concl = await evaluate('(document.getElementById("conclusion-eight-fields").textContent||"").length');
    check('A7｜提交飛手回饋後進入階段 ④', stage4 === 4, `currentStage=${stage4}`);
    check('A7b｜關聯四區塊與八項結論渲染', corr > 100 && concl > 100, `corr=${corr} concl=${concl}`);

    // A8 教師抽屜預設關閉
    const closed = await evaluate('!document.getElementById("drawer-backdrop").classList.contains("open")');
    check('A8a｜教師專業抽屜預設關閉', closed === true);
    await evaluate('openDrawer("動力健康")');
    await sleep(200);
    const opened = await evaluate('document.getElementById("drawer-backdrop").classList.contains("open")');
    const drawerHasRuleTrace = await evaluate('/Rule Trace|規則/.test(document.getElementById("drawer-content-body").textContent)');
    check('A8b｜手動觸發後開啟且含規則證據鏈', opened === true && drawerHasRuleTrace === true);
    await evaluate('closeDrawer()');

    // A9 階段 ⑤ 成長卡
    await evaluate('goToStage(5)');
    await sleep(300);
    const growth = await evaluate('(document.getElementById("growth-card-preview-area").textContent||"").trim()');
    check('A9｜階段 ⑤ 成長記錄卡渲染且含教師複核狀態',
      growth.includes('飛行健康成長記錄') && /教師復核|教官已確認|待教師/.test(growth), growth.slice(0, 40));

    // A5b 退出 DEMO
    await evaluate('exitDemoMode()');
    await sleep(300);
    const back = await evaluate('AppState.currentStage');
    check('A5b｜退出 DEMO 回到階段 ①', back === 1, `currentStage=${back}`);

    // A10 390×844 無溢出（登入前）
    const ov = await evaluate('({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})');
    check('A10｜390×844 無水平溢出（scrollWidth == clientWidth）', ov && ov.sw <= ov.cw + 1,
      `scrollWidth=${ov && ov.sw} clientWidth=${ov && ov.cw}`);

    // A11 JS 錯誤
    check('A11｜全程 0 JS 錯誤', consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.slice(0, 3).join(' ; ') : 'no errors');

    const pass = RESULTS.filter((r) => r.ok).length;
    const fail = RESULTS.length - pass;
    const report = {
      generated_at: new Date().toISOString(),
      target: URL,
      viewport: '390x844 (Chrome device emulation; 非真實 iPhone Safari)',
      note: '唯讀靜態服務；未連線飛行健康後端；未修改 flight-health/ 任何檔案。真實日誌分析 PENDING_MANUAL。',
      pass, fail, results: RESULTS,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'p6_flight_health_frontend.json'), JSON.stringify(report, null, 2));
    console.log(`\n=== Flight Health 前端驗收：${pass} PASS / ${fail} FAIL ===`);
  } finally {
    try { chrome.kill(); } catch (e) { /* noop */ }
    server.close();
  }
  process.exit(RESULTS.some((r) => !r.ok) ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
