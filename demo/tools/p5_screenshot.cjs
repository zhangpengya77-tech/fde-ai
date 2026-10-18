// P5 班級結訓成果報告：桌面 1440 全頁、iPhone 390×844 模擬、A4 列印預覽 — 經由 Chrome DevTools Protocol
// 以 DEMO 教師帳號登入後開啟 /teacher/class-report/ 並截圖、檢查版面與列印媒體。
// 注意：此為 Chrome 設備模擬（含 print media emulation），非真實 iPhone Safari 驗收，
//       亦非伺服器端 PDF 產生器。
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = Number(process.env.FDE_SHOT_CDP_PORT || 9336);
const USER_DATA = process.env.FDE_SHOT_PROFILE || 'D:\\AI_Cache\\temp\\chrome-p5-report';
const BASE = process.env.FDE_SHOT_BASE || 'http://192.168.1.114:8110';
const PREFIX = process.env.FDE_SHOT_PREFIX || 'p5_class_report';
const OUT_DIR = process.env.FDE_SHOT_OUT_DIR || 'D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs';
const OUT_DESKTOP_FULL = path.join(OUT_DIR, `${PREFIX}_desktop_full.png`);
const OUT_MOBILE_FULL = path.join(OUT_DIR, `${PREFIX}_iphone390_full.png`);
const OUT_MOBILE_TOP = path.join(OUT_DIR, `${PREFIX}_iphone390x844.png`);
const OUT_A4_PRINT = path.join(OUT_DIR, `${PREFIX}_a4_print_preview.png`);

const REPORT_PATH = process.env.FDE_SHOT_REPORT_PATH || '/teacher/class-report/';
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
  fs.mkdirSync(OUT_DIR, { recursive: true });
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
    const shootFull = async (outPath, width) => {
      const metrics = await send('Page.getLayoutMetrics');
      const height = Math.ceil(
        metrics.result && metrics.result.contentSize ? metrics.result.contentSize.height : 844
      );
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

    // --- 桌面 1440：完整截圖與版面斷言 ---
    await send('Page.navigate', { url: `${BASE}${REPORT_PATH}` });
    await sleep(3500);
    const desktop = await evaluate(`(() => {
      const de = document.documentElement;
      const order = [];
      const marks = [
        ['basic', '.trp-basic'],
        ['stats', '.trp-stats'],
        ['stage', '#report-stage'],
        ['slots', '#report-slots'],
        ['students', '#report-students'],
        ['feedback', '#report-feedback'],
      ];
      marks.forEach(([k, sel]) => {
        const el = document.querySelector(sel);
        if (el) order.push({ key: k, top: Math.round(el.getBoundingClientRect().top + window.scrollY) });
      });
      const sorted = order.slice().sort((a, b) => a.top - b.top).map((o) => o.key);
      const btn = document.querySelector('#print-report');
      // 以 stub 取代 window.print，實際點擊按鈕驗證是否真的呼叫瀏覽器原生列印。
      let printCalls = 0;
      const realPrint = window.print;
      window.print = function () { printCalls += 1; };
      if (btn) btn.click();
      window.print = realPrint;
      const inlineScripts = Array.from(document.querySelectorAll('script:not([src])'))
        .map((s) => s.textContent).join('\\n');
      return {
        url: location.pathname,
        h1: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : '',
        overflowX: de.scrollWidth - de.clientWidth,
        order: sorted,
        orderCount: order.length,
        statCards: document.querySelectorAll('.trp-stat').length,
        stageRows: document.querySelectorAll('#report-stage tbody tr').length,
        slotRows: document.querySelectorAll('#report-slots tbody tr').length,
        studentBlocks: document.querySelectorAll('.trp-student').length,
        feedbackRows: document.querySelectorAll('#report-feedback tbody tr').length,
        hasPrintButton: !!btn,
        printCalls,
        scriptHasWindowPrint: /window\\.print\\(\\)/.test(inlineScripts),
        scriptHasServerPdf: /report\\.pdf|report_pdf|jsPDF|html2pdf/.test(inlineScripts),
        emptyStates: Array.from(document.querySelectorAll('.trp-empty')).length,
      };
    })()`);
    record('教師可開啟班級結訓成果報告頁', desktop && desktop.url === REPORT_PATH, `url=${desktop && desktop.url} h1=${desktop && desktop.h1}`);
    record('桌面 1440 無橫向溢出', desktop && desktop.overflowX <= 0, `overflowX=${desktop && desktop.overflowX}px`);
    record(
      '版面順序＝班級基本資料→成果摘要→五階段→R01–R08→學員列表→教師回饋',
      !!(
        desktop &&
        desktop.orderCount === 6 &&
        JSON.stringify(desktop.order) ===
          JSON.stringify(['basic', 'stats', 'stage', 'slots', 'students', 'feedback'])
      ),
      `order=${desktop && JSON.stringify(desktop.order)}`
    );
    record('班級成果摘要卡片齊全（8 張）', desktop && desktop.statCards === 8, `cards=${desktop && desktop.statCards}`);
    record('R01–R08 統計表 8 列', desktop && desktop.slotRows === 8, `rows=${desktop && desktop.slotRows}`);
    record('五階段概況表 5 列', desktop && desktop.stageRows === 5, `rows=${desktop && desktop.stageRows}`);
    record('有「列印報告」按鈕且點擊後真的呼叫瀏覽器原生列印', !!(desktop && desktop.hasPrintButton && desktop.printCalls >= 1 && desktop.scriptHasWindowPrint), `button=${desktop && desktop.hasPrintButton} printCalls=${desktop && desktop.printCalls} script=${desktop && desktop.scriptHasWindowPrint}`);
    record('未提供伺服器 PDF 產生器（無 jsPDF／html2pdf／report.pdf）', !(desktop && desktop.scriptHasServerPdf), `serverPdf=${desktop && desktop.scriptHasServerPdf}`);
    const deskH = await shootFull(OUT_DESKTOP_FULL, 1440);
    console.log('desktop full screenshot:', OUT_DESKTOP_FULL, 'height=', deskH);

    // --- A4 列印預覽（print media emulation + A4 直式 794×1123 CSS px）---
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    await send('Emulation.setDeviceMetricsOverride', {
      width: 794,
      height: 1123,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(600);
    const printView = await evaluate(`(() => {
      const de = document.documentElement;
      const hidden = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return 'absent';
        return getComputedStyle(el).display;
      };
      // 找出在 A4 寬度下右緣超出的元素（表格裁切風險）
      const offenders = [];
      document.querySelectorAll('table, .trp-stats, .trp-basic, .trp-student').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > 795) offenders.push(el.tagName.toLowerCase() + ' right=' + Math.round(r.right));
      });
      const tables = Array.from(document.querySelectorAll('table'));
      const theadGroup = tables.map((t) => {
        const th = t.querySelector('thead');
        return th ? getComputedStyle(th).display : 'n/a';
      });
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      return {
        overflowX: de.scrollWidth - de.clientWidth,
        topbarDisplay: hidden('.topbar'),
        footerDisplay: hidden('.footer'),
        screenOnlyDisplay: hidden('.trp-screen-only'),
        toolbarDisplay: hidden('.trp-toolbar'),
        buttonDisplay: hidden('.button'),
        offenders: offenders.slice(0, 6),
        offenderCount: offenders.length,
        theadGroup,
        bodyBg,
      };
    })()`);
    record('A4 列印預覽：無橫向溢出（重要表格不裁切）', printView && printView.overflowX <= 0 && printView.offenderCount === 0, `overflowX=${printView && printView.overflowX} offenders=${printView && printView.offenderCount} ${printView && JSON.stringify(printView.offenders)}`);
    record('A4 列印預覽：隱藏導覽列／頁尾／螢幕專用工具列', printView && printView.topbarDisplay === 'none' && printView.footerDisplay === 'none' && printView.screenOnlyDisplay === 'none', `topbar=${printView && printView.topbarDisplay} footer=${printView && printView.footerDisplay} screenOnly=${printView && printView.screenOnlyDisplay}`);
    record('A4 列印預覽：表頭換頁重複（table-header-group）', printView && printView.theadGroup.length > 0 && printView.theadGroup.every((d) => d === 'table-header-group'), `thead=${printView && JSON.stringify(printView.theadGroup)}`);
    const a4 = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    if (a4.result && a4.result.data) {
      fs.writeFileSync(OUT_A4_PRINT, Buffer.from(a4.result.data, 'base64'));
      console.log('A4 print preview screenshot:', OUT_A4_PRINT);
    }
    await send('Emulation.setEmulatedMedia', { media: '' });

    // --- iPhone Safari 390×844 模擬（全頁 + 首屏）---
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
    await send('Page.navigate', { url: `${BASE}${REPORT_PATH}` });
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
      // 只檢查「本報告頁自身」的控制項；base.html 共用導覽列（topbar）為全站既有元件，
      // 不在 P5 範圍內，另行單獨記錄其高度，不納入本頁通過條件。
      const controls = Array.from(
        document.querySelectorAll(
          '.trp-toolbar button, .trp-toolbar .button, .trp-toolbar select, .back-link, .trp-student .trp-screen-only a, .trp-evidence-item a'
        )
      );
      const measure = (el) => {
        const r = el.getBoundingClientRect();
        return el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0] + ' h=' + Math.round(r.height);
      };
      const smallList = controls
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.height > 0 && r.height < 44)
        .map(({ el }) => measure(el));
      const small = smallList.length;
      const sharedChrome = Array.from(document.querySelectorAll('.topbar button, .topbar a, .topbar .link-button'));
      const sharedChromeSmall = sharedChrome
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.height > 0 && r.height < 44)
        .map(({ el }) => measure(el));
      const t = document.querySelector('#report-slots');
      const tr = t && t.querySelector('tbody tr');
      return {
        url: location.pathname,
        clientWidth: de.clientWidth,
        overflowX: de.scrollWidth - de.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        offenders: offenders.slice(0, 8),
        offenderCount: offenders.length,
        statCards: document.querySelectorAll('.trp-stat').length,
        studentBlocks: document.querySelectorAll('.trp-student').length,
        tableTheadDisplay: t && t.querySelector('thead') ? getComputedStyle(t.querySelector('thead')).display : 'n/a',
        tableTrDisplay: tr ? getComputedStyle(tr).display : 'n/a',
        controlCount: controls.length,
        smallTargets: small,
        smallList,
        sharedChromeSmall,
        printButtonVisible: !!document.querySelector('#print-report'),
      };
    })()`);
    record('手機 390×844 無橫向溢出', mobile && mobile.overflowX <= 0, `clientWidth=${mobile && mobile.clientWidth} scrollWidth=${mobile && mobile.bodyScrollWidth} overflowX=${mobile && mobile.overflowX}px offenders=${mobile && mobile.offenderCount}`);
    record('手機 390×844 班級成果摘要卡片仍可見（8 張）', mobile && mobile.statCards === 8, `cards=${mobile && mobile.statCards}`);
    record('手機 390×844 學員成果列表以卡片呈現', mobile && mobile.studentBlocks > 0, `blocks=${mobile && mobile.studentBlocks}`);
    record('手機 390×844 報告頁自身控制項點按高度 ≥44px', mobile && mobile.smallTargets === 0, `controls=${mobile && mobile.controlCount} under44=${mobile && mobile.smallTargets} ${mobile && JSON.stringify(mobile.smallList)}`);
    console.log(
      `NOTE - 共用導覽列（base.html topbar，全站既有、非 P5 範圍）未達 44px 者：${mobile && JSON.stringify(mobile.sharedChromeSmall)}`
    );
    if (mobile && mobile.offenderCount > 0) console.log('overflow offenders:', JSON.stringify(mobile.offenders));

    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(400);
    const top = await send('Page.captureScreenshot', { format: 'png' });
    if (top.result && top.result.data) {
      fs.writeFileSync(OUT_MOBILE_TOP, Buffer.from(top.result.data, 'base64'));
      console.log('mobile 390x844 viewport screenshot:', OUT_MOBILE_TOP);
    }
    const mobH = await shootFull(OUT_MOBILE_FULL, 390);
    console.log('mobile full screenshot:', OUT_MOBILE_FULL, 'height=', mobH);

    ws.close();

    const failed = results.filter((r) => !r.ok).length;
    console.log(`==== P5 班級結訓成果報告截圖結果：${results.length - failed} 項通過 / ${failed} 項失敗 / 共 ${results.length} 項 ====`);
    console.log('NOTE: Chrome 390x844 設備模擬 + print media emulation；未視為真實 iPhone Safari 驗收，亦非伺服器 PDF。');
    if (failed > 0) process.exit(1);
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
