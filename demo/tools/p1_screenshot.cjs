// P1 工作台 iPhone Safari 視窗（390×844）截圖 — 經由 Chrome DevTools Protocol
// 以 DEMO 學員帳號登入後開啟五階段學習工作台並截圖。
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9333;
const USER_DATA = 'D:\\AI_Cache\\temp\\chrome-p1-workbench';
const BASE = 'http://192.168.1.114:8110';
const OUT_DESKTOP = 'D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs\\p1_workbench_desktop.png';
const OUT_MOBILE = 'D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs\\p1_workbench_iphone390x844.png';

const STUDENT_EMAIL = 'demo.student01@fde-demo.local';

// 安全規範（2026-10-13 指令）：密碼不寫死在程式碼。
// 依序：(1) FDE_DEMO_STUDENT_PASSWORD (2) FDE_DEMO_CREDENTIALS_FILE
// (3) ~/.fde-demo-credentials/demo.shared.password.txt
// 憑證檔格式依 reset_demo_shared_password.py 約定：
//   「---- 以下為密碼，複製這一行 ----」的下一行非空、非 ---- 者即密碼。
function loadDemoPassword() {
  const envPw = (process.env.FDE_DEMO_STUDENT_PASSWORD || '').trim();
  if (envPw) return envPw;
  const candidates = [
    process.env.FDE_DEMO_CREDENTIALS_FILE,
    path.join(os.homedir(), '.fde-demo-credentials', 'demo.shared.password.txt'),
    path.join(os.homedir(), '.fde-demo-credentials', 'demo.student01.password.txt'),
  ].filter(Boolean);
  for (const p of candidates) {
    let lines;
    try {
      lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    } catch (e) {
      continue;
    }
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('以下為密碼') && lines[i].includes('----')) {
        for (let n = i + 1; n < lines.length; n++) {
          const t = lines[n].trim();
          if (t && !t.startsWith('----')) return t;
        }
      }
    }
  }
  return null;
}
const STUDENT_PASSWORD = loadDemoPassword();
if (!STUDENT_PASSWORD) {
  console.error('[安全停止] 無法取得 DEMO 學員密碼：請設定 FDE_DEMO_STUDENT_PASSWORD，或提供 ~/.fde-demo-credentials/demo.shared.password.txt。');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTargets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  return res.json();
}

async function main() {
  const chrome = execFile(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${USER_DATA}`,
      '--window-size=1440,900',
      'about:blank',
    ],
    () => {}
  );
  try {
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try {
        const targets = await getTargets();
        const page = targets.find((t) => t.type === 'page');
        if (page) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch (e) {
        /* retry */
      }
    }
    if (!wsUrl) throw new Error('CDP target not found');
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const mid = ++id;
        pending.set(mid, resolve);
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    await new Promise((r) => ws.addEventListener('open', r));

    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      return r.result && r.result.result ? r.result.result.value : undefined;
    };

    // --- 桌面尺寸：登入並開啟工作台 ---
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Page.enable');
    await send('Page.navigate', { url: `${BASE}/login/` });
    await sleep(2500);
    await evaluate(`(() => {
      const form = document.querySelector('form[method="post"]');
      if (!form) return 'no-form';
      form.querySelector('[name="username"]').value = ${JSON.stringify(STUDENT_EMAIL)};
      form.querySelector('[name="password"]').value = ${JSON.stringify(STUDENT_PASSWORD)};
      form.submit();
      return 'submitted';
    })()`);
    await sleep(3000);
    await send('Page.navigate', { url: `${BASE}/student/learning-path/` });
    await sleep(3500);
    const url1 = await evaluate('location.pathname');
    const h1 = await evaluate("document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : ''");
    console.log('after-login landing:', url1, '| h1:', h1);
    const shot1 = await send('Page.captureScreenshot', { format: 'png' });
    if (shot1.result && shot1.result.data) {
      fs.writeFileSync(OUT_DESKTOP, Buffer.from(shot1.result.data, 'base64'));
      console.log('desktop screenshot:', OUT_DESKTOP);
    } else {
      console.log('desktop screenshot FAILED:', JSON.stringify(shot1).slice(0, 200));
    }

    // --- iPhone Safari 390×844 ---
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setUserAgentOverride', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    await send('Page.navigate', { url: `${BASE}/student/learning-path/` });
    await sleep(3500);
    const overflowX = await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    console.log('mobile horizontal overflow px:', overflowX);
    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    if (shot2.result && shot2.result.data) {
      fs.writeFileSync(OUT_MOBILE, Buffer.from(shot2.result.data, 'base64'));
      console.log('mobile screenshot:', OUT_MOBILE);
    } else {
      console.log('mobile screenshot FAILED:', JSON.stringify(shot2).slice(0, 200));
    }
    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
