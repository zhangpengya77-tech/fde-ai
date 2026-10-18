// Flight Health 真實日誌驗收（P0 資料契約查證）
//
// 目的：用「教師 9/29 真實 DataFlash 日誌」端到端跑一次學員端八卡，
//       並把「實際渲染到 DOM 的文字」讀回來，檢查是否仍有 undefined / 空白 / 資料缺失。
//
// 與 fh_real_screenshot.cjs 的關鍵差異：
//   * 本腳本只使用真實日誌 log_452_2026-9-29-20-38-08.bin，
//     絕不使用 gen_sample_bin.py 產生的自製樣本（教師明文禁止以樣本冒充真實日誌驗收）。
//   * 讀回的是 DOM 實際文字，而非只看 AppState，能真正抓到 undefined。
//
// 用法：node demo/tools/fh_real_929_verify.cjs [--base http://127.0.0.1:8040] [--out <dir>]
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9349;
const USER_DATA = 'D:\\AI_Cache\\temp\\chrome-fh-929';
const REAL_BIN = 'D:\\FDE-Flight-Health-AI\\sample_logs\\ardupilot\\log_452_2026-9-29-20-38-08.bin';
const EXPECTED_SHA256 = 'e5ef768b6033a72b2acc523e7ea3e490f4b647f8cc7df2c849f79acc5a2a9d7a';

const argv = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const BASE = argOf('--base', 'http://127.0.0.1:8040');
const API_OVERRIDE = argOf('--api', '');
const OUT = argOf('--out', 'D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 學員端八卡：DOM id（與 index.html 一致）＋ 卡片標題
const CARD_DOM = [
  ['propulsion-card', '01 动力健康'],
  ['battery-card', '02 电池健康'],
  ['gps-card', '03 定位健康'],
  ['stability-card', '04 姿态稳定'],
  ['rc-signal-card', '05 遥控信号'],
  ['flight-mode-card', '06 飞行模式'],
  ['altitude-card', '07 高度控制'],
  ['sensors-card', '08 传感器'],
];

function sha256File(file) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function main() {
  const report = { startedAt: new Date().toISOString(), base: BASE, realBin: REAL_BIN };

  // 0) 檔案身分核對：確認跑的是教師 9/29 真實日誌
  if (!fs.existsSync(REAL_BIN)) {
    report.fatal = `真實日誌不存在：${REAL_BIN}`;
    console.error(JSON.stringify(report, null, 2));
    process.exit(2);
  }
  const sha = sha256File(REAL_BIN);
  report.realBinBytes = fs.statSync(REAL_BIN).size;
  report.realBinSha256 = sha;
  report.realBinSha256MatchesRecord = sha === EXPECTED_SHA256;
  console.log(`[log] ${REAL_BIN}`);
  console.log(`[log] bytes=${report.realBinBytes} sha256=${sha} match=${report.realBinSha256MatchesRecord}`);

  fs.mkdirSync(OUT, { recursive: true });

  const chrome = execFile(
    CHROME,
    [
      '--headless=new', '--disable-gpu', '--no-sandbox',
      `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${USER_DATA}`,
      '--window-size=430,1400', 'about:blank',
    ],
    () => {}
  );

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
    let id = 0; const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    const send = (method, params = {}) =>
      new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });
    await new Promise((r) => ws.addEventListener('open', r));
    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
      return r.result?.result?.value;
    };
    const screenshot = async (file) => {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
      console.log('[shot] wrote ' + file);
    };

    await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 1400, deviceScaleFactor: 2, mobile: true });
    await send('Page.enable');
    await send('Page.navigate', { url: `${BASE}/index.html` });
    for (let i = 0; i < 40; i++) { await sleep(300); if ((await evaluate('document.readyState')) === 'complete') break; }
    await sleep(1500);

    // 可選：把前端 API 指向另一台後端（用於核對「沙箱引擎 vs 教師正式引擎」同一份真實日誌的差異）
    if (API_OVERRIDE) {
      await evaluate(
        'window.FLIGHT_HEALTH_CONFIG.API_BASE_LOCAL = ' + JSON.stringify(API_OVERRIDE)
      );
      report.apiOverride = API_OVERRIDE;
      console.log('[page] API override ->', API_OVERRIDE);
    }

    report.pageBanner = String(await evaluate('(document.getElementById("service-status-banner")||{}).textContent||""')).trim();
    report.engineLabel = String(await evaluate('(document.getElementById("flight-health-engine-status")||{}).textContent||""')).trim();
    console.log('[page] banner=', report.pageBanner.slice(0, 50));
    console.log('[page] engine=', report.engineLabel);

    // 注入真實 9/29 .bin（檔名保持真實檔名，供溯源）
    const binB64 = fs.readFileSync(REAL_BIN).toString('base64');
    await evaluate(`(function(){
      const bin = Uint8Array.from(atob(${JSON.stringify(binB64)}), c=>c.charCodeAt(0));
      const f = new File([bin], "log_452_2026-9-29-20-38-08.bin", {type:"application/octet-stream"});
      handleFile(f);
    })()`);
    await sleep(500);
    report.startButtonDisabled = await evaluate('(document.getElementById("start-analyze-btn")||{}).disabled');
    console.log('[page] start button disabled =', report.startButtonDisabled);

    // 真實分析
    await evaluate('startAnalysis()');
    for (let i = 0; i < 90; i++) { await sleep(400); if ((await evaluate('AppState.currentStage')) === 2) break; }
    await sleep(1200);

    report.stage = await evaluate('AppState.currentStage');
    const sv = await evaluate('((AppState.diagnosisData||{}).student_view)||null');
    report.studentView = sv
      ? {
          overall_status: sv.overall_status,
          display_status: sv.display_status,
          main_finding: sv.main_finding,
          source_file: sv.source_file,
          parsed_message_count: sv.parsed_message_count,
          engine_display: sv.engine_display,
          cardCount: (sv.health_cards || []).length,
          cards: (sv.health_cards || []).map((c) => ({
            card_id: c.card_id, title: c.title, status: c.status,
            display_status: c.display_status, main_finding: c.main_finding,
            next_action: c.next_action, rule_id: c.rule_id,
            missing_reason: c.missing_reason || null,
          })),
        }
      : null;

    // 讀回 DOM 實際渲染文字（抓 undefined / 空白 / 資料缺失）
    report.domCards = [];
    for (const [domId, expectTitle] of CARD_DOM) {
      const rawJson = await evaluate(
        'JSON.stringify((function(){var el=document.getElementById(' +
          JSON.stringify(domId) +
          ');if(!el) return null;return {html: el.innerHTML, text: el.textContent};})())'
      );
      const raw = rawJson ? JSON.parse(rawJson) : null;
      const text = raw && raw.text ? String(raw.text).replace(/\s+/g, ' ').trim() : "";
      report.domCards.push({
        domId,
        expectTitle,
        rendered: !!raw && raw.html.trim().length > 0,
        text,
        hasUndefined: /undefined/i.test(text),
        hasMissingData: /数据缺失|數據缺失/.test(text),
        empty: text.length === 0,
      });
    }

    report.overallHasUndefined = report.domCards.some((c) => c.hasUndefined);
    report.emptyCardCount = report.domCards.filter((c) => c.empty).length;
    report.missingDataCardCount = report.domCards.filter((c) => c.hasMissingData).length;

    await screenshot(path.join(OUT, 'fh_929_real_report.png'));

    console.log('\n=== 學員端八卡（DOM 實際渲染） ===');
    for (const c of report.domCards) {
      console.log(`  ${c.domId.padEnd(18)} rendered=${c.rendered} undefined=${c.hasUndefined} missing=${c.hasMissingData}`);
      console.log(`      ${c.text.slice(0, 110)}`);
    }
    console.log('\n=== 後端 student_view 八卡 ===');
    for (const c of (report.studentView?.cards || [])) {
      console.log(`  ${String(c.card_id).padEnd(14)} ${String(c.status).padEnd(8)} ${c.display_status} | ${String(c.main_finding).slice(0, 60)}`);
    }
    console.log(`\n[summary] overall=${report.studentView?.overall_status} | cards=${report.studentView?.cardCount} | undefined=${report.overallHasUndefined} | empty=${report.emptyCardCount} | missingData=${report.missingDataCardCount}`);

    const jsonPath = path.join(OUT, 'fh_929_real_verify.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log('[report] wrote ' + jsonPath);

    console.log('DONE');
  } finally {
    try { chrome.kill(); } catch (e) {}
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
