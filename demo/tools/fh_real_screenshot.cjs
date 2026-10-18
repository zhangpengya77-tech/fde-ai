// 真实截图：Flight Health 修复验证（端到端，连真实参考后端 :8040）
//
// 1) 启动参考后端（flight-health/reference_server.py）于 :8040（前端 config 对 localhost 即指向 :8040/api/v1）
// 2) 用真实生成的 ArduPilot DataFlash .bin 注入页面，调用 startAnalysis() 走真实分析
// 3) 截图：① 阶段 ① 选完日志后的「按钮可点 + 诊断引擎标签」② 阶段 ② 真实分析报告
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const PY = 'C:\\Users\\admin\\.workbuddy-ai\\binaries\\python\\versions\\3.13.12\\python.exe';
const FH_DIR = 'D:\\FDE-AI-UAS-v2.0\\flight-health';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9348;
const USER_DATA = 'D:\\AI_Cache\\temp\\chrome-fh-real';
const PORT = 8040;
const URL = `http://127.0.0.1:${PORT}/index.html`;
const OUT = 'D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitPort(p, host = '127.0.0.1', tries = 40) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      const s = net.connect(p, host);
      s.on('connect', () => { s.destroy(); resolve(); });
      s.on('error', () => { s.destroy(); if (++n > tries) reject(new Error('port timeout')); else setTimeout(tick, 300); });
    };
    tick();
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // 生成真实 .bin 样本
  await new Promise((res) => { const p = spawn(PY, ['gen_sample_bin.py'], { cwd: FH_DIR }); p.on('close', res); });

  // 启动参考后端
  const srv = spawn(PY, ['reference_server.py'], { cwd: FH_DIR, env: { ...process.env, FDE_FLIGHT_HEALTH_PORT: String(PORT) } });
  srv.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
  await waitPort(PORT);
  console.log('[backend] reference server up on :' + PORT);

  const chrome = execFile(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${USER_DATA}`,
    '--window-size=430,1100', 'about:blank',
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
    let id = 0; const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    const send = (method, params = {}) => new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });
    await new Promise((r) => ws.addEventListener('open', r));
    const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
    const screenshot = async (file) => {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
      console.log('[shot] wrote ' + file);
    };

    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Page.enable');
    await send('Page.navigate', { url: URL });
    for (let i = 0; i < 40; i++) { await sleep(300); if ((await evaluate('document.readyState')) === 'complete') break; }
    await sleep(1500); // 等待 online 探針 + 引擎狀態

    const banner = await evaluate('(document.getElementById("service-status-banner")||{}).textContent||""');
    const engine = await evaluate('(document.getElementById("flight-health-engine-status")||{}).textContent||""');
    console.log('[page] banner=', banner.trim().slice(0, 40), '| engine=', engine.trim());

    // 注入真实 .bin 并选文件
    const binB64 = fs.readFileSync(path.join(FH_DIR, 'sample_flight_healthy.bin')).toString('base64');
    await evaluate(`(function(){
      const bin = Uint8Array.from(atob(${JSON.stringify(binB64)}), c=>c.charCodeAt(0));
      const f = new File([bin], "FLIGHT0001.BIN", {type:"application/octet-stream"});
      handleFile(f);
    })()`);
    await sleep(500);
    const btnDisabled = await evaluate('(document.getElementById("start-analyze-btn")||{}).disabled');
    const fileLabel = await evaluate('(document.getElementById("selected-file-label")||{}).textContent||""');
    console.log('[page] after file select -> button disabled =', btnDisabled, '|', fileLabel.trim());
    await screenshot(path.join(OUT, 'fh_fix_stage1_enabled.png'));

    // 真实分析
    await evaluate('startAnalysis()');
    for (let i = 0; i < 60; i++) { await sleep(400); const st = await evaluate('AppState.currentStage'); if (st === 2) break; }
    await sleep(800);
    const st = await evaluate('AppState.currentStage');
    const overall = await evaluate('((AppState.diagnosisData&&AppState.diagnosisData.student_view)||{}).overall_status');
    const engineDisp = await evaluate('((AppState.diagnosisData&&AppState.diagnosisData.student_view)||{}).engine_display');
    const cards = await evaluate('((AppState.diagnosisData&&AppState.diagnosisData.student_view)||{}).health_cards');
    console.log('[page] stage=', st, '| overall=', overall, '| engine=', engineDisp);
    if (Array.isArray(cards)) console.log('[page] cards=', cards.map((c) => c.title + ':' + c.status).join(' | '));
    await screenshot(path.join(OUT, 'fh_fix_stage2_report.png'));

    console.log('DONE');
  } finally {
    try { chrome.kill(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
