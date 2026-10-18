// P4 班級學習成果總覽 390×844 手機模擬＋桌面完整截圖 — 經由 Chrome DevTools Protocol
// 以 DEMO 教師帳號登入後開啟 /teacher/class-outcomes/ 並截圖、檢查版面。
// 注意：此為 Chrome 設備模擬，非真實 iPhone Safari 驗收。
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = Number(process.env.FDE_SHOT_CDP_PORT || 9334);
const USER_DATA = process.env.FDE_SHOT_PROFILE || 'D:\\AI_Cache\\temp\\chrome-p3-outcomes';
const BASE = process.env.FDE_SHOT_BASE || 'http://192.168.1.114:8110';
const PREFIX = process.env.FDE_SHOT_PREFIX || 'p3_class_outcomes';
const OUT_DESKTOP_FULL = `D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs\\${PREFIX}_desktop_full.png`;
const OUT_MOBILE_FULL = `D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs\\${PREFIX}_iphone390_full.png`;
const OUT_MOBILE_TOP = `D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs\\${PREFIX}_iphone390x844.png`;

const TEACHER_EMAIL = process.env.FDE_SHOT_TEACHER_EMAIL || 'demo.teacher@fde-demo.local';

// 安全規範：密碼不寫死在程式碼。
// 依序：(1) FDE_DEMO_TEACHER_PASSWORD (2) FDE_DEMO_CREDENTIALS_FILE
// (3) ~/.fde-demo-credentials/demo.shared.password.txt
function loadDemoPassword() {
  const envPw = (process.env.FDE_DEMO_TEACHER_PASSWORD || '').trim();
  if (envPw) return envPw;
  const candidates = [
    process.env.FDE_DEMO_CREDENTIALS_FILE,
    path.join(os.homedir(), '.fde-demo-credentials', 'demo.shared.password.txt'),
    path.join(os.homedir(), '.fde-demo-credentials', 'demo.teacher.password.txt'),
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
const TEACHER_PASSWORD = loadDemoPassword();
if (!TEACHER_PASSWORD) {
  console.error('[安全停止] 無法取得 DEMO 教師密碼：請設定 FDE_DEMO_TEACHER_PASSWORD，或提供 ~/.fde-demo-credentials/demo.shared.password.txt。');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTargets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  return res.json();
}

async function main() {
  // 每次以乾淨的 Chrome 使用者目錄啟動，避免上次執行的磁碟快取舊版 CSS 造成假陰性。
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
      '--no-proxy-server',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${USER_DATA}`,
      '--window-size=1440,900',
      'about:blank',
    ],
    () => {}
  );
  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} - ${name} | ${detail}`);
  };
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
    // 全頁截圖：先以 contentSize 高度重設 viewport，再截圖。
    const shootFull = async (outPath, width) => {
      const metrics = await send('Page.getLayoutMetrics');
      const height = Math.ceil((metrics.result && metrics.result.contentSize
        ? metrics.result.contentSize.height
        : 844));
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height: Math.max(height, 1),
        deviceScaleFactor: 1,
        mobile: width <= 430,
      });
      await sleep(400);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      if (shot.result && shot.result.data) {
        fs.writeFileSync(outPath, Buffer.from(shot.result.data, 'base64'));
        return height;
      }
      return 0;
    };

    // --- 教師登入 ---
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Page.enable');
    await send('Page.navigate', { url: `${BASE}/teacher/login/` });
    await sleep(2500);
    const loginRes = await evaluate(`(() => {
      const form = document.querySelector('form[method="post"]');
      if (!form) return 'no-form';
      const u = form.querySelector('[name="username"]');
      const p = form.querySelector('[name="password"]');
      if (!u || !p) return 'no-fields';
      u.value = ${JSON.stringify(TEACHER_EMAIL)};
      p.value = ${JSON.stringify(TEACHER_PASSWORD)};
      form.submit();
      return 'submitted';
    })()`);
    record('DEMO 教師登入表單可送出', loginRes === 'submitted', `result=${loginRes}`);
    await sleep(3000);

    // --- 桌面 1440：完整截圖 ---
    await send('Page.navigate', { url: `${BASE}/teacher/class-outcomes/` });
    await sleep(3500);
    const desktop = await evaluate(`(() => ({
      url: location.pathname,
      h1: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : '',
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      statCards: document.querySelectorAll('.tco-stat').length,
      statLabels: Array.from(document.querySelectorAll('.tco-stat-label')).map((el) => el.textContent.trim()),
      statNums: Array.from(document.querySelectorAll('.tco-stat-num')).map((el) => el.textContent.trim()),
      matrixRows: document.querySelectorAll('.tco-matrix tbody tr').length,
      progressRows: document.querySelectorAll('.tco-progress-item').length,
      pendingItems: document.querySelectorAll('.tco-pending-item').length,
      sortSelect: !!document.querySelector('.sort-bar select[name="sort"]'),
      sortOptionCount: document.querySelectorAll('.sort-bar select[name="sort"] option').length,
      filterSelectCount: document.querySelectorAll('.sort-bar select').length,
      progressFilterSelect: !!document.querySelector('.sort-bar select[name="s_state"]'),
      recordFilterSelect: !!document.querySelector('.sort-bar select[name="p_record"]'),
      typeFilterSelect: !!document.querySelector('.sort-bar select[name="p_type"]'),
      statusFilterSelect: !!document.querySelector('.sort-bar select[name="p_status"]'),
    }))()`);
    record('教師可開啟班級學習成果頁', desktop && desktop.url === '/teacher/class-outcomes/', `url=${desktop && desktop.url} h1=${desktop && desktop.h1}`);
    record('桌面 1440 無橫向溢出', desktop && desktop.overflowX <= 0, `overflowX=${desktop && desktop.overflowX}px`);
    record('P4 四張統計卡片齊全且數字非空', desktop && desktop.statCards === 4 && desktop.statNums.length === 4 && desktop.statNums.every((n) => n.length > 0), `cards=${desktop && desktop.statCards} labels=${desktop && JSON.stringify(desktop.statLabels)} nums=${desktop && JSON.stringify(desktop.statNums)}`);
    record('P4.1 排序選項四項齊全', desktop && desktop.sortOptionCount === 4, `options=${desktop && desktop.sortOptionCount}`);
    record('P4.1 篩選控制項齊備（紀錄／類型／狀態／進度）', !!(desktop && desktop.recordFilterSelect && desktop.typeFilterSelect && desktop.statusFilterSelect && desktop.progressFilterSelect), `selects=${desktop && desktop.filterSelectCount}`);
    record('P4 學員進度列表列數＝學員數', desktop && desktop.progressRows === desktop.matrixRows && desktop.progressRows > 0, `progress=${desktop && desktop.progressRows} matrix=${desktop && desktop.matrixRows} pending=${desktop && desktop.pendingItems}`);
    const deskH = await shootFull(OUT_DESKTOP_FULL, 1440);
    console.log('desktop full screenshot:', OUT_DESKTOP_FULL, 'height=', deskH);

    // --- iPhone Safari 390×844 模擬（全頁 + 首屏） ---
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
    await send('Page.navigate', { url: `${BASE}/teacher/class-outcomes/` });
    await sleep(3500);
    const mobile = await evaluate(`(() => {
      const de = document.documentElement;
      const offenders = [];
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > 391 || r.left < -1)) {
          offenders.push(el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0] + ' right=' + Math.round(r.right));
        }
      });
      const buttons = Array.from(document.querySelectorAll('.button, .sort-bar select'));
      const smallTargets = buttons.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.height < 44;
      }).length;
      const matrix = document.querySelector('.tco-matrix');
      return {
        url: location.pathname,
        clientWidth: de.clientWidth,
        overflowX: de.scrollWidth - de.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        offenders: offenders.slice(0, 8),
        offenderCount: offenders.length,
        statCards: document.querySelectorAll('.tco-stat').length,
        matrixTheadDisplay: matrix && matrix.querySelector('thead') ? getComputedStyle(matrix.querySelector('thead')).display : 'n/a',
        matrixTrDisplay: matrix && matrix.querySelector('tbody tr') ? getComputedStyle(matrix.querySelector('tbody tr')).display : 'n/a',
        controlCount: buttons.length,
        smallTargets,
        pendingHref: (document.querySelector('.tco-pending-item a[href]') || {}).getAttribute ? document.querySelector('.tco-pending-item a[href]').getAttribute('href') : '',
      };
    })()`);
    record('手機 390×844 無橫向溢出', mobile && mobile.overflowX <= 0, `clientWidth=${mobile && mobile.clientWidth} scrollWidth=${mobile && mobile.bodyScrollWidth} overflowX=${mobile && mobile.overflowX}px offenders=${mobile && mobile.offenderCount}`);
    record('手機 390×844 四張統計卡片仍可見', mobile && mobile.statCards === 4, `cards=${mobile && mobile.statCards}`);
    record('手機 390×844 矩陣表轉為學員卡片', mobile && mobile.matrixTheadDisplay === 'none' && mobile.matrixTrDisplay === 'grid', `thead.display=${mobile && mobile.matrixTheadDisplay} tr.display=${mobile && mobile.matrixTrDisplay}`);
    record('手機 390×844 控制項點按高度 ≥44px', mobile && mobile.smallTargets === 0, `controls=${mobile && mobile.controlCount} under44=${mobile && mobile.smallTargets}`);
    record('手機 390×844 待複核連結指向既有學員詳情頁', !!(mobile && mobile.pendingHref && /\/teacher\/enrollments\/\d+\//.test(mobile.pendingHref)), `href=${mobile && mobile.pendingHref}`);

    // 首屏 390×844（未拉伸前的視窗尺寸）
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(400);
    const top = await send('Page.captureScreenshot', { format: 'png' });
    if (top.result && top.result.data) {
      fs.writeFileSync(OUT_MOBILE_TOP, Buffer.from(top.result.data, 'base64'));
      console.log('mobile 390x844 viewport screenshot:', OUT_MOBILE_TOP);
    }
    const mobH = await shootFull(OUT_MOBILE_FULL, 390);
    console.log('mobile full screenshot:', OUT_MOBILE_FULL, 'height=', mobH);
    if (mobile && mobile.offenderCount > 0) console.log('overflow offenders:', JSON.stringify(mobile.offenders));

    ws.close();

    const failed = results.filter((r) => !r.ok).length;
    console.log(`==== P4 手機模擬結果：${results.length - failed} 項通過 / ${failed} 項失敗 / 共 ${results.length} 項 ====`);
    console.log('NOTE: Chrome 390x844 設備模擬；未視為真實 iPhone Safari 驗收。');
    if (failed > 0) process.exit(1);
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
