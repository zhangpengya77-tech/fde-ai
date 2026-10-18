// I1 外部模組接口層 + 五階段工作台入口驗收 — Chrome DevTools Protocol
//
// 目的（2026-10-13 教師總指令第八節測試 1、3、4、5、6、7、11）：
//   1. 工作台「做」階段：F450 3D 數位孿生顯示「待接入」且不可點（無假連結）。
//   2. 工作台「做」階段：F450 十二任務實訓為獨立入口，連往既有 /platform/f450。
//   3. 工作台「測」階段：MP 地面站（預留）／HQGC 考核（預留）顯示「待接入」且不可點。
//   4. /platform/f450 可正常開啟（F450 十二任務原有功能未被破壞）。
//   5. 手機 390×844：無水平溢出（scrollWidth == clientWidth），模組卡片可見。
//
// 註：本工具為 Chrome 裝置模擬，**不等於**真實 iPhone Safari 驗收；
//     真機驗收一律標 PENDING，須教師以實機另行確認。
//
// 使用：以 start_p42_verify.ps1 -Port 8112 -DbFile p42_verify.sqlite3 啟動隔離服務後執行。
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9335;
const USER_DATA = 'D:\\AI_Cache\\temp\\chrome-i1-external-modules';
const BASE = 'http://192.168.1.114:8112';
const OUT_MOBILE = 'D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs\\i1_workbench_iphone390x844.png';

const STUDENT_EMAIL = 'p42-a-0001@fde-p42.local';

// 安全規範：密碼不寫死在程式碼，沿用 demo 憑證載入器。
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
  console.error('[安全停止] 無法取得驗收學員密碼：請設定 FDE_DEMO_STUDENT_PASSWORD，或提供 ~/.fde-demo-credentials/demo.shared.password.txt。');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RESULTS = [];
function check(name, ok, detail = '') {
  RESULTS.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (detail ? ' | ' + detail : ''));
}

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

    // --- 登入 ---
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

    // --- 工作台 ---
    await send('Page.navigate', { url: `${BASE}/student/learning-path/` });
    await sleep(3500);
    const landing = await evaluate('location.pathname');
    check('登入後可進入五階段工作台', /learning-path/.test(landing || ''), 'path=' + landing);

    const buildSection = await evaluate(`(() => {
      const el = document.getElementById('stage-build');
      return el ? el.innerText : '';
    })()`);
    check('「做」階段含 F450 數位孿生（待接入）',
      /F450 數位孿生/.test(buildSection) && /待接入/.test(buildSection));
    check('「做」階段含 F450 十二任務實訓入口', /F450 十二任務實訓/.test(buildSection));

    const twelveHref = await evaluate(`(() => {
      const el = document.getElementById('stage-build');
      if (!el) return null;
      const li = Array.from(el.querySelectorAll('li.lp-entry'))
        .find(x => /F450 十二任務實訓/.test(x.textContent));
      if (!li) return null;
      const a = li.querySelector('a[href]');
      return a ? a.getAttribute('href') : null;
    })()`);
    check('F450 十二任務入口指向既有 /platform/f450', twelveHref === '/platform/f450', 'href=' + twelveHref);

    const twinLinked = await evaluate(`(() => {
      const el = document.getElementById('stage-build');
      if (!el) return false;
      return Array.from(el.querySelectorAll('a')).some(x => /F450 數位孿生/.test(x.textContent));
    })()`);
    check('F450 3D 數位孿生不可點擊（未被 <a> 包裹）', twinLinked === false);

    const assessSection = await evaluate(`(() => {
      const el = document.getElementById('stage-assess');
      return el ? el.innerText : '';
    })()`);
    check('「測」階段含 MP 地面站（預留）待接入',
      /MP 地面站/.test(assessSection) && /待接入/.test(assessSection));
    check('「測」階段含 HQGC 考核（預留）待接入',
      /HQGC 考核/.test(assessSection) && /待接入/.test(assessSection));

    const fakeHref = await evaluate(`(() => {
      const links = Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href'));
      return links.filter(h => /孿生|twin|ground-station|hqgc/i.test(h));
    })()`);
    check('全頁不存在指向孿生／MP／HQGC 的假連結',
      Array.isArray(fakeHref) && fakeHref.length === 0,
      JSON.stringify(fakeHref));

    // --- /platform/f450 原有功能 ---
    await send('Page.navigate', { url: `${BASE}/platform/f450` });
    await sleep(3000);
    const platformStatus = await evaluate('document.readyState');
    const platformTitle = await evaluate("document.title || ''");
    const platformBodyLen = await evaluate('document.body ? document.body.innerHTML.length : 0');
    check('F450 十二任務 /platform/f450 可開啟（原有功能未被破壞）',
      platformStatus === 'complete' && platformBodyLen > 500,
      'readyState=' + platformStatus + ' title=' + platformTitle + ' bodyLen=' + platformBodyLen);

    // --- 手機 390×844 ---
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
    check('手機 390×844 無水平溢出', overflowX <= 0, 'overflowX=' + overflowX + 'px');
    const mobileModulesVisible = await evaluate(`(() => {
      const els = Array.from(document.querySelectorAll('.lp-module'));
      return els.filter(e => e.getBoundingClientRect().width > 0).length;
    })()`);
    check('手機 390×844 模組卡片可見', mobileModulesVisible >= 3, 'visible modules=' + mobileModulesVisible);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.result && shot.result.data) {
      fs.writeFileSync(OUT_MOBILE, Buffer.from(shot.result.data, 'base64'));
      console.log('mobile screenshot:', OUT_MOBILE);
    }

    ws.close();
  } finally {
    chrome.kill();
  }

  const failed = RESULTS.filter((r) => !r.ok);
  console.log(
    '\n==== I1 外部模組 Chrome 驗收：' +
      (RESULTS.length - failed.length) + ' 項通過 / ' + failed.length + ' 項失敗 / 共 ' + RESULTS.length + ' 項 ===='
  );
  console.log('（Chrome 裝置模擬；真實 iPhone Safari 驗收：PENDING）');
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
