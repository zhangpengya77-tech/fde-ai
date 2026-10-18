// I3-C 學生操作體驗 — Chrome 渲染與手機 390×844 驗收（CDP）
//
// 對應 2026-10-13 教師 I3 指令第四、六節：
//   五階段導航一致性、功能入口不重複、四態顯示、返回工作台路徑、
//   手機 390×844 排版、教師與學員權限區隔。
//
// 註：本工具為 Chrome 裝置模擬，**不等於**真實 iPhone Safari 驗收；
//     真機驗收一律標 PENDING，須教師以實機另行確認。
//
// 使用：FDE_I3_BASE=http://192.168.1.114:8115 node demo/tools/i3_framework_check.cjs
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = process.env.FDE_I3_CDP_PORT || '9338';
const USER_DATA = process.env.FDE_I3_PROFILE || 'D:\\AI_Cache\\temp\\chrome-i3-framework';
const BASE = (process.env.FDE_I3_BASE || 'http://192.168.1.114:8115').replace(/\/$/, '');
const OUT_MOBILE = 'D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs\\i3_workbench_iphone390x844.png';
const OUT_DESKTOP = 'D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs\\i3_workbench_desktop.png';

const STUDENT_EMAIL = 'p42-a-0001@fde-p42.local';
const FOUR_STATES = ['已可使用', '尚未接入', '服務暫時不可用', '權限不足'];

function loadDemoPassword() {
  const envPw = (process.env.FDE_DEMO_STUDENT_PASSWORD || '').trim();
  if (envPw) return envPw;
  const candidates = [
    process.env.FDE_DEMO_CREDENTIALS_FILE,
    path.join(os.homedir(), '.fde-demo-credentials', 'demo.shared.password.txt'),
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
  try {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  } catch (e) {
    /* ignore */
  }
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
    const screenshot = async (file) => {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      if (shot.result && shot.result.data) {
        fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
        return true;
      }
      return false;
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
    // 登入回應需完成導向後 Cookie 才會寫入；經 Live 代理（多一跳）時較慢，
    // 可用 FDE_I3_LOGIN_WAIT_MS 加長（預設 3000ms，不改變原有行為）。
    await sleep(Number(process.env.FDE_I3_LOGIN_WAIT_MS || 3000));

    await send('Page.navigate', { url: `${BASE}/student/learning-path/` });
    await sleep(3500);
    const landing = await evaluate('location.pathname');
    check('登入後可進入五階段工作台', /learning-path/.test(landing || ''), 'path=' + landing);

    // --- 五階段導航一致性 ---
    const anchors = await evaluate(
      `(() => ['learn','practice','build','assess','certify'].filter(k => document.getElementById('stage-' + k)).length)()`
    );
    check('五階段區塊錨點齊備', anchors === 5, 'found=' + anchors);
    const navAnchors = await evaluate(`(() => {
      const keys = ['learn','practice','build','assess','certify'];
      return keys.filter(k => Array.from(document.querySelectorAll('a[href]'))
        .some(a => a.getAttribute('href') === '#stage-' + k)).length;
    })()`);
    check('五階段導覽錨點與區塊一致', navAnchors === 5, 'nav=' + navAnchors);

    // --- 功能入口不重複 ---
    const dupEntries = await evaluate(`(() => {
      const seen = new Map();
      const dups = [];
      document.querySelectorAll('li.lp-entry').forEach(li => {
        const name = (li.querySelector('strong') || {}).textContent || '';
        const a = li.querySelector('a[href]');
        const href = a ? a.getAttribute('href') : '';
        const key = name.trim() + '|' + href;
        if (seen.has(key)) dups.push(key);
        seen.set(key, true);
      });
      return { total: seen.size, dups };
    })()`);
    check(
      '功能入口無重複（名稱＋目標）',
      dupEntries && dupEntries.dups.length === 0,
      'entries=' + (dupEntries ? dupEntries.total : '?') + ' dups=' + JSON.stringify(dupEntries ? dupEntries.dups : [])
    );

    // --- 四態顯示 ---
    const moduleBadges = await evaluate(`(() => {
      return Array.from(document.querySelectorAll('article.lp-module .lp-badge'))
        .map(e => e.textContent.trim());
    })()`);
    const allowed = FOUR_STATES;
    check(
      '外部模組徽章皆為四態之一',
      Array.isArray(moduleBadges) && moduleBadges.length === 3 && moduleBadges.every((t) => allowed.includes(t)),
      JSON.stringify(moduleBadges)
    );
    const reservedLinked = await evaluate(`(() => {
      const names = ['F450 數位孿生','MP 地面站（預留）','HQGC 考核（預留）'];
      return names.filter(n => Array.from(document.querySelectorAll('a')).some(a => a.textContent.includes(n)));
    })()`);
    check('預留模組不可點擊', Array.isArray(reservedLinked) && reservedLinked.length === 0, JSON.stringify(reservedLinked));

    // --- F450 十二任務入口 ---
    const twelveHref = await evaluate(`(() => {
      const el = document.getElementById('stage-build');
      if (!el) return null;
      const li = Array.from(el.querySelectorAll('li.lp-entry')).find(x => /F450 十二任務實訓/.test(x.textContent));
      if (!li) return null;
      const a = li.querySelector('a[href]');
      return a ? a.getAttribute('href') : null;
    })()`);
    check('F450 十二任務入口指向既有 /platform/f450', twelveHref === '/platform/f450', 'href=' + twelveHref);

    // --- 返回工作台路徑 ---
    await send('Page.navigate', { url: `${BASE}/platform/f450` });
    // 經 Live 代理時靜態資源較多、載入較慢；改為有界輪詢 readyState，
    // 逾時上限可用 FDE_I3_NAV_TIMEOUT_MS 調整（預設 15000ms）。
    const navTimeout = Number(process.env.FDE_I3_NAV_TIMEOUT_MS || 15000);
    const navDeadline = Date.now() + navTimeout;
    let platformOk = 'loading';
    while (Date.now() < navDeadline) {
      platformOk = await evaluate('document.readyState');
      if (platformOk === 'complete') break;
      await sleep(250);
    }
    const backLink = await evaluate(
      `(() => Array.from(document.querySelectorAll('a[href]')).some(a => a.getAttribute('href') === '/student/learning-path/'))()`
    );
    check('F450 十二任務頁可開啟', platformOk === 'complete', 'readyState=' + platformOk);
    check('平台頁提供返回工作台路徑', backLink === true);

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
    const mobileModules = await evaluate(
      `(() => Array.from(document.querySelectorAll('article.lp-module')).filter(e => e.getBoundingClientRect().width > 0).length)()`
    );
    check('手機 390×844 模組卡片可見', mobileModules >= 3, 'visible=' + mobileModules);
    const mobileEntries = await evaluate(
      `(() => Array.from(document.querySelectorAll('li.lp-entry')).filter(e => e.getBoundingClientRect().width > 0).length)()`
    );
    check('手機 390×844 入口列表可見', mobileEntries >= 8, 'visible=' + mobileEntries);
    const mobileNav = await evaluate(`(() => {
      const keys = ['learn','practice','build','assess','certify'];
      return keys.filter(k => {
        const a = Array.from(document.querySelectorAll('a[href]')).find(x => x.getAttribute('href') === '#stage-' + k);
        return a && a.getBoundingClientRect().width > 0;
      }).length;
    })()`);
    check('手機 390×844 五階段導覽可見', mobileNav === 5, 'visible=' + mobileNav);
    const tapTargets = await evaluate(`(() => {
      const nodes = Array.from(document.querySelectorAll('li.lp-entry a[href]'));
      const small = nodes.filter(a => a.getBoundingClientRect().height < 24).length;
      return { total: nodes.length, small };
    })()`);
    check(
      '手機入口連結可點擊高度合理（>=24px）',
      tapTargets && tapTargets.small === 0,
      'total=' + (tapTargets ? tapTargets.total : '?') + ' small=' + (tapTargets ? tapTargets.small : '?')
    );
    const mobileShot = await screenshot(OUT_MOBILE);
    check('手機截圖已產生', mobileShot, OUT_MOBILE);

    // --- 桌面截圖 ---
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Page.navigate', { url: `${BASE}/student/learning-path/` });
    await sleep(2500);
    const desktopShot = await screenshot(OUT_DESKTOP);
    check('桌面截圖已產生', desktopShot, OUT_DESKTOP);

    ws.close();
  } finally {
    chrome.kill();
  }

  const failed = RESULTS.filter((r) => !r.ok);
  console.log(
    '\n==== I3 Chrome 驗收：' + (RESULTS.length - failed.length) + ' 項通過 / ' + failed.length + ' 項失敗 / 共 ' + RESULTS.length + ' 項 ===='
  );
  console.log('（Chrome 裝置模擬；真實 iPhone Safari 驗收：PENDING）');
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
