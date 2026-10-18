// I2 五階段教學平台框架 — Chrome 渲染與手機 390×844 驗收（CDP）
//
// 對應 2026-10-13 教師 I2 指令第三、四、五節：
//   I2-A 五階段入口：學／練／做／測／證皆能連到既有入口（不新增第二套功能）
//   I2-B 統一模組狀態：預設三模組皆「尚未接入」且不可點（四態不互冒）
//   I2-C 操作體驗：可返回工作台、手機 390×844 排版正常、R01–R08 呈現一致
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
const CDP_PORT = 9336;
const USER_DATA = 'D:\\AI_Cache\\temp\\chrome-i2-framework';
const BASE = 'http://192.168.1.114:8112';
const OUT_MOBILE = 'D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs\\i2_workbench_iphone390x844.png';

const STUDENT_EMAIL = 'p42-a-0001@fde-p42.local';

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
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) {
        const ex = r.result.exceptionDetails;
        const desc =
          (ex.exception && (ex.exception.description || ex.exception.value)) || ex.text || 'unknown';
        console.log('  [JS EXC] ' + String(desc).split('\n')[0]);
        return undefined;
      }
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    // 輪詢等待條件成立（取代固定 sleep，避免 Django dev server 較慢時誤判）
    const waitFor = async (expr, timeout = 25000) => {
      const deadline = Date.now() + timeout;
      for (;;) {
        const v = await evaluate(expr);
        if (v) return v;
        if (Date.now() > deadline) return null;
        await sleep(300);
      }
    };

    // --- 登入 ---
    // 註（2026-10-16 修正）：base.html 在「已登入」狀態會多渲染一個登出 POST 表單
    // （<form method="post" action="/logout/">），因此不可用 `form[method="post"]` 取登入表單；
    // 且必須先清 cookie，否則 profile 殘留 session 會讓工具誤抓登出表單而靜默不送出登入。
    await send('Network.enable');
    await send('Network.clearBrowserCookies');
    await send('Network.clearBrowserCache');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Page.enable');
    await send('Page.navigate', { url: `${BASE}/login/` });
    await sleep(2000);
    await waitFor("document.querySelector('form input[name=\"username\"]') ? 1 : 0", 15000);
    // 送登入：明確檢查表單欄位存在、回報送出結果，並在未登入時重試一次
    const doLogin = async () => {
      const submitResult = await evaluate(`(() => {
        const all = Array.from(document.querySelectorAll('form'));
        const form = all.find(f => f.querySelector('[name="username"]')) || null;
        if (!form) return 'no-login-form total-forms=' + all.length + ' posts=' +
          all.filter(f => (f.getAttribute('method') || '').toLowerCase() === 'post').length;
        const u = form.querySelector('[name="username"]');
        const p = form.querySelector('[name="password"]');
        if (!u || !p) return 'missing-fields u=' + !!u + ' p=' + !!p;
        u.value = ${JSON.stringify(STUDENT_EMAIL)};
        p.value = ${JSON.stringify(STUDENT_PASSWORD)};
        form.submit();
        return 'submitted';
      })()`);
      console.log('  [login] submit=' + submitResult + ' at=' + (await evaluate('location.pathname')));
      await sleep(3000);
      await waitFor("location.pathname !== '/login/' ? 1 : 0", 15000);
      return await evaluate('location.pathname');
    };
    let afterLogin = await doLogin();
    if (/login/.test(afterLogin || '')) {
      console.log('  [login] 首次未登入（path=' + afterLogin + '），清 cookie 後重試一次');
      await send('Network.clearBrowserCookies');
      await send('Page.navigate', { url: `${BASE}/login/` });
      await sleep(2500);
      afterLogin = await doLogin();
    }
    console.log('  [login] 登入後 path=' + afterLogin);

    // --- 工作台 ---
    await send('Page.navigate', { url: `${BASE}/student/learning-path/` });
    await waitFor("document.readyState === 'complete' && document.getElementById('stage-certify') ? 1 : 0");
    const landing = await evaluate('location.pathname');
    check('登入後可進入五階段工作台', /learning-path/.test(landing || ''), 'path=' + landing);

    // I2-A：五階段錨點
    const anchors = await evaluate(`(() => {
      return ['learn','practice','build','assess','certify']
        .filter(k => document.getElementById('stage-' + k)).length;
    })()`);
    check('五階段錨點齊備', anchors === 5, 'found=' + anchors);

    // I2-A：各階段既有入口
    const stageEntries = await evaluate(`(() => {
      const out = {};
      for (const k of ['learn','practice','build','assess','certify']) {
        const el = document.getElementById('stage-' + k);
        out[k] = el ? el.innerText : '';
      }
      return out;
    })()`);
    check('[學] 有 AI 助教（RAG 知識庫問答）', /AI 助教（RAG 知識庫問答）/.test(stageEntries.learn || ''));
    check('[練] 有模擬器練習與 AI 助教', /模擬器練習/.test(stageEntries.practice || '') && /AI 助教（練習即時問答）/.test(stageEntries.practice || ''));
    check('[做] 有 F450 十二任務實訓', /F450 十二任務實訓/.test(stageEntries.build || ''));
    check('[做] 有 F450 數位孿生（預留）', /F450 數位孿生/.test(stageEntries.build || ''));
    check('[測] 有 M1–M4 與飛行健康 AI', /M1–M4/.test(stageEntries.assess || '') && /飛行健康 AI/.test(stageEntries.assess || ''));
    check('[測] 有 MP／HQGC 預留模組', /MP 地面站/.test(stageEntries.assess || '') && /HQGC 考核/.test(stageEntries.assess || ''));
    check('[證] 有成長日誌總覽入口', /我的學習成長日誌（R01–R08 總覽）/.test(stageEntries.certify || ''));

    // I2-B：預設三模組皆「尚未接入」，且不得誤標其他三態
    const badgeText = await evaluate(`(() => {
      return Array.from(document.querySelectorAll('.lp-badge')).map(e => e.textContent.trim());
    })()`);
    const notIntegrated = (badgeText || []).filter((t) => t === '尚未接入').length;
    check('預設三模組皆標示「尚未接入」', notIntegrated === 3, 'count=' + notIntegrated + ' badges=' + JSON.stringify(badgeText));
    check('預設不得出現「已可使用」', !(badgeText || []).includes('已可使用'));
    check('預設不得出現「服務暫時不可用」', !(badgeText || []).includes('服務暫時不可用'));
    check('預設不得出現「權限不足」', !(badgeText || []).includes('權限不足'));

    // 預留模組不可點
    const reservedLinked = await evaluate(`(() => {
      const names = ['F450 數位孿生','MP 地面站（預留）','HQGC 考核（預留）'];
      return names.filter(n => Array.from(document.querySelectorAll('a')).some(a => a.textContent.includes(n)));
    })()`);
    check('預留模組不可點擊', Array.isArray(reservedLinked) && reservedLinked.length === 0, JSON.stringify(reservedLinked));

    // F450 十二任務入口指向 /platform/f450
    const twelveHref = await evaluate(`(() => {
      const el = document.getElementById('stage-build');
      if (!el) return null;
      const li = Array.from(el.querySelectorAll('li.lp-entry')).find(x => /F450 十二任務實訓/.test(x.textContent));
      if (!li) return null;
      const a = li.querySelector('a[href]');
      return a ? a.getAttribute('href') : null;
    })()`);
    check('F450 十二任務入口指向既有 /platform/f450', twelveHref === '/platform/f450', 'href=' + twelveHref);

    // 全頁不得有假連結
    const fakeHref = await evaluate(`(() => {
      return Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href'))
        .filter(h => /孿生|twin|ground-station|hqgc/i.test(h));
    })()`);
    check('全頁不存在指向孿生／MP／HQGC 的假連結', Array.isArray(fakeHref) && fakeHref.length === 0, JSON.stringify(fakeHref));

    // I2-C：可返回工作台（平台頁共用導覽）
    await send('Page.navigate', { url: `${BASE}/platform/f450` });
    await waitFor("document.readyState === 'complete' && document.querySelector('#moduleNav') ? 1 : 0");
    const platformOk = await evaluate('document.readyState');
    const platformLen = await evaluate('document.body ? document.body.innerHTML.length : 0');
    check('F450 十二任務 /platform/f450 可開啟（原有功能未被破壞）',
      platformOk === 'complete' && platformLen > 500, 'readyState=' + platformOk + ' bodyLen=' + platformLen);
    // I2-C（教師 2026-10-15 最終裁決）：平台頁五階段主導航＝左側 #moduleNav（學→練→做→測→證），
    // 帳號列／Django topbar 的重複「五階段學習工作台」連結已移除；工作台頁面與路由保留（首頁課程卡進入）。
    const stageNav = await evaluate(`(() => {
      const nav = document.querySelector('#moduleNav');
      if (!nav) return { ok: false, reason: 'no-moduleNav' };
      const labels = Array.from(nav.querySelectorAll('a > span')).map((s) => s.textContent.trim());
      const links = Array.from(nav.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));
      const five = ['學', '練', '做', '測', '證'];
      const wanted = ['./courses', './simulator', './f450', './eagle', '/student/growth/'];
      return {
        ok: five.every((l) => labels.includes(l)) && !labels.includes('作') && wanted.every((h) => links.includes(h)),
        labels: labels,
        links: links
      };
    })()`);
    check('平台頁左側 #moduleNav 為唯一五階段主導航（學→練→做→測→證，證→真實成長日誌）',
      stageNav.ok === true, JSON.stringify(stageNav).slice(0, 240));

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
    await waitFor("document.readyState === 'complete' && document.querySelectorAll('[data-stage-section]').length === 5 ? 1 : 0");
    await sleep(800);
    const overflowX = await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    check('手機 390×844 無水平溢出', overflowX <= 0, 'overflowX=' + overflowX + 'px');
    // 教師 2026-10-15 整合原則第 4 點「一次只顯示一個階段」：
    // 五個階段區塊全部在 DOM 中，同一時間只有「當前階段」可見（其餘帶 hidden）。
    const mobileStages = await evaluate(`(() => {
      const all = Array.from(document.querySelectorAll('[data-stage-section]'));
      return {
        total: all.length,
        visible: all.filter(e => e.getBoundingClientRect().width > 0).length,
        keys: all.map(e => e.getAttribute('data-stage-section'))
      };
    })()`);
    check('手機 390×844 五階段區塊齊備（學/練/做/測/證）',
      mobileStages.total === 5 &&
        ['learn', 'practice', 'build', 'assess', 'certify'].every((k) => (mobileStages.keys || []).includes(k)),
      'total=' + mobileStages.total + ' keys=' + JSON.stringify(mobileStages.keys));
    check('手機 390×844 一次只顯示一個階段', mobileStages.visible === 1, 'visible stages=' + mobileStages.visible);
    const mobileEntries = await evaluate(`(() => {
      const all = Array.from(document.querySelectorAll('li.lp-entry'));
      return {
        total: all.length,
        visible: all.filter(e => e.getBoundingClientRect().width > 0).length
      };
    })()`);
    check('手機 390×844 入口列表齊備且當前階段可見', mobileEntries.total >= 8 && mobileEntries.visible >= 1,
      'total entries=' + mobileEntries.total + ' visible=' + mobileEntries.visible);

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
    '\n==== I2 Chrome 驗收：' + (RESULTS.length - failed.length) + ' 項通過 / ' + failed.length + ' 項失敗 / 共 ' + RESULTS.length + ' 項 ===='
  );
  console.log('（Chrome 裝置模擬；真實 iPhone Safari 驗收：PENDING）');
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
