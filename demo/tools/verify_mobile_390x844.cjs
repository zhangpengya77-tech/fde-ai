// Phase 5｜學員／教師手機版 390×844 自動化驗收（Chrome 裝置模擬）
//
// ⚠️ 本工具為 Chrome 裝置模擬，**不等於**真實 iPhone Safari 驗收；
//    真機驗收一律標 PENDING_MANUAL，須教師以實機另行回填（七站三十二項）。
//
// 走 8111 同源代理（與真實手機相同路徑），不使用 8110 直連。
// 密碼不寫死，沿用憑證載器（env 或 ~/.fde-demo-credentials/）。
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = Number(process.env.FDE_P5_CDP_PORT || 9341);
const USER_DATA = process.env.FDE_P5_PROFILE || 'D:\\AI_Cache\\temp\\chrome-p5-mobile';
const BASE = process.env.FDE_P5_BASE || 'http://192.168.1.114:8111';
const STUDENT_EMAIL = 'demo.student01@fde-demo.local';
const TEACHER_EMAIL = 'demo.teacher@fde-demo.local';
const OUT_DIR = 'D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs';

function loadPassword() {
  const envPw = (process.env.FDE_DEMO_STUDENT_PASSWORD || '').trim();
  if (envPw) return envPw;
  const candidates = [
    process.env.FDE_DEMO_CREDENTIALS_FILE,
    path.join(os.homedir(), '.fde-demo-credentials', 'demo.shared.password.txt'),
    path.join(os.homedir(), '.fde-demo-credentials', 'demo.student01.password.txt'),
  ].filter(Boolean);
  for (const p of candidates) {
    let lines;
    try { lines = fs.readFileSync(p, 'utf8').split(/\r?\n/); } catch (e) { continue; }
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

const PASSWORD = loadPassword();
if (!PASSWORD) {
  console.error('[安全停止] 無法取得 DEMO 密碼：請設定 FDE_DEMO_STUDENT_PASSWORD 或提供 ~/.fde-demo-credentials/demo.shared.password.txt');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RESULTS = [];
function check(name, ok, detail = '') {
  RESULTS.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (detail ? ' | ' + detail : ''));
}

// iPhone 7 邏輯解析度 375×667；390×844 為近年機型，取較嚴者做無溢出驗證
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (e) { /* 首次不存在 */ }

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
      width: VIEWPORT.width, height: VIEWPORT.height,
      deviceScaleFactor: VIEWPORT.deviceScaleFactor, mobile: VIEWPORT.mobile,
    });

    const goto = async (url) => {
      await send('Page.navigate', { url });
      for (let i = 0; i < 40; i++) {
        await sleep(250);
        const ready = await evaluate('document.readyState');
        if (ready === 'complete') break;
      }
      await sleep(400);
    };

    // 無水平溢出 + 標題 + 截圖名
    const auditPage = async (label, shotName) => {
      const overflow = await evaluate(
        '({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})'
      );
      const title = await evaluate('document.title || ""');
      const h1 = await evaluate('document.querySelector("h1,h2")?.textContent?.trim() || ""');
      check(`${label}｜無水平溢出（scrollWidth == clientWidth）`,
        overflow && overflow.sw <= overflow.cw + 1,
        `scrollWidth=${overflow?.sw} clientWidth=${overflow?.cw}`);
      check(`${label}｜頁面可辨識（title/h1）`, Boolean((title && title.trim()) || (h1 && h1.trim())),
        `title=${JSON.stringify((title || '').slice(0, 40))} h1=${JSON.stringify((h1 || '').slice(0, 30))}`);
      if (shotName) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        if (shot.result?.data) {
          fs.writeFileSync(path.join(OUT_DIR, shotName), Buffer.from(shot.result.data, 'base64'));
        }
      }
    };

    // ---------- 第 1 站：登入頁 ----------
    await goto(BASE + '/login/');
    const hasForm = await evaluate(
      '!!(document.querySelector(\'form input[name="username"]\') && document.querySelector(\'form input[name="password"]\'))'
    );
    check('第1站 登入頁｜帳密欄位存在於 390×844', hasForm,
      'title=' + JSON.stringify(await evaluate('document.title')));
    await auditPage('第1站 登入頁', 'p5_mobile_01_login.png');

    // ---------- 登入 ----------
    const loginOk = await evaluate(`(async () => {
      const form = document.querySelector('form');
      if (!form) return 'no-form';
      const u = form.querySelector('input[name="username"]');
      const p = form.querySelector('input[name="password"]');
      if (!u || !p) return 'no-fields';
      u.value = ${JSON.stringify(STUDENT_EMAIL)};
      p.value = ${JSON.stringify(PASSWORD)};
      const csrf = form.querySelector('[name="csrfmiddlewaretoken"]');
      const body = new URLSearchParams();
      body.set('username', ${JSON.stringify(STUDENT_EMAIL)});
      body.set('password', ${JSON.stringify(PASSWORD)});
      if (csrf) body.set('csrfmiddlewaretoken', csrf.value);
      const res = await fetch(form.action || location.pathname, {
        method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      return 'status:' + res.status + ' url:' + res.url.replace(${JSON.stringify(BASE)}, '');
    })()`);
    check('學員登入（390×844 真實表單提交）', /status:(2|3)/.test(String(loginOk)), String(loginOk).slice(0, 90));

    // ---------- 確認已登入（標題不應再是登入頁） ----------
    await goto(BASE + '/student/');
    const dashTitle = await evaluate('document.title || ""');
    check('登入後可取用學員儀表板（非登入頁）', !/學員登入/.test(dashTitle),
      'title=' + JSON.stringify(dashTitle));

    // 由儀表板解析課程連結，取得真實 enrollment_id
    const courseHref = await evaluate(
      '(document.querySelector(\'a[href*="/student/courses/"]\') || {}).href || ""'
    );

    // ---------- 後續站點 ----------
    const stations = [
      ['第2站 學員儀表板', '/student/', 'p5_mobile_02_dashboard.png'],
      ['第3站 五階段學習路徑', '/student/learning-path/', 'p5_mobile_03_learning_path.png'],
      ['第4站 成長紀錄', '/student/growth/', 'p5_mobile_04_growth.png'],
    ];
    if (courseHref) {
      stations.push(['第5站 課程工作台', courseHref.replace(BASE, ''), 'p5_mobile_05_course.png']);
    }
    stations.push(
      ['第6站 F450 十二任務', '/platform/f450', 'p5_mobile_06_f450.png'],
      ['第7站 AI Live Coach', '/live/', 'p5_mobile_07_live.png'],
      ['第8站 下載中心', '/downloads/', 'p5_mobile_08_downloads.png'],
    );
    for (const [label, url, shot] of stations) {
      await goto(BASE + url);
      await auditPage(label, shot);
    }

    // ---------- /platform/f450 必須由設計回傳 SPA 殼（路徑即區塊），不得 404 ----------
    await goto(BASE + '/platform/f450');
    const f450Title = await evaluate('document.title || ""');
    const f450Overflow = await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1');
    check('F450 十二任務入口回傳 SPA 殼且不 404、不溢出（路徑即區塊設計）',
      /FDE-AI/.test(f450Title) && f450Overflow,
      'title=' + JSON.stringify(f450Title.slice(0, 40)) + ' 無溢出=' + f450Overflow);

    // ---------- 學員不可見教師後台（正確同源路徑為 /teacher/） ----------
    await goto(BASE + '/teacher/');
    const teacherUrl = await evaluate('location.pathname + (location.search || "")');
    const teacherBody = await evaluate('document.body ? document.body.innerText.slice(0, 200) : ""');
    check('學員不可存取教師後台（重導登入或 403，不出現教師管理內容）',
      !/教師管理後台|班級學習成果|結訓審核/.test(String(teacherBody)),
      'path=' + JSON.stringify(teacherUrl) + ' body=' + JSON.stringify(String(teacherBody).slice(0, 50)));

    // ---------- 控制台錯誤 ----------
    const realErrors = consoleErrors.filter((e) => e && !/favicon|ERR_INTERNET_DISCONNECTED/i.test(e));
    check('全程無未預期 JS 錯誤', realErrors.length === 0,
      realErrors.length ? realErrors.slice(0, 3).join(' ‖ ').slice(0, 180) : '0 errors');

    const summary = {
      generated_at: new Date().toISOString(),
      base: BASE, viewport: VIEWPORT,
      note: 'Chrome 裝置模擬，非真實 iPhone Safari；真機驗收 PENDING_MANUAL',
      results: RESULTS,
      pass: RESULTS.filter((r) => r.ok).length,
      fail: RESULTS.filter((r) => !r.ok).length,
      total: RESULTS.length,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'p5_mobile_390x844.json'), JSON.stringify(summary, null, 2));
  } finally {
    try { chrome.kill(); } catch (e) { /* ignore */ }
  }

  console.log('');
  console.log('='.repeat(78));
  const pass = RESULTS.filter((r) => r.ok).length;
  const fail = RESULTS.filter((r) => !r.ok).length;
  console.log(`彙總：PASS=${pass} / FAIL=${fail} / 共 ${RESULTS.length}`);
  console.log('⚠️ Chrome 390×844 裝置模擬 ≠ 真實 iPhone Safari；真機七站三十二項仍為 PENDING_MANUAL');
  if (fail) {
    console.log('\n失敗項目：');
    for (const r of RESULTS) { if (!r.ok) console.log('  - ' + r.name + ' :: ' + r.detail); }
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(3); });
