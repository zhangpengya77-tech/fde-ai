// P7 班級成果展示與簡報播放模式：桌面 1440 全頁、16:9 簡報模式、iPhone 390×844 模擬。
// 以 Chrome DevTools Protocol 登入教師帳號後開啟 /teacher/class-showcase/，
// 截圖並驗證版面、簡報切頁（←／→／Esc）、匿名化與 16:9 舞台比例。
// 注意：此為 Chrome 設備模擬（含手機視窗尺寸），非真實 iPhone Safari 驗收。
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = Number(process.env.FDE_SHOT_CDP_PORT || 9339);
const USER_DATA = process.env.FDE_SHOT_PROFILE || 'D:\\AI_Cache\\temp\\chrome-p7-showcase';
const BASE = process.env.FDE_SHOT_BASE || 'http://192.168.1.114:8112';
const PREFIX = process.env.FDE_SHOT_PREFIX || 'p7_showcase';
const OUT_DIR = process.env.FDE_SHOT_OUT_DIR || 'D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs';
const OUT_DESKTOP_FULL = path.join(OUT_DIR, `${PREFIX}_desktop_full.png`);
const OUT_SLIDE_COVER = path.join(OUT_DIR, `${PREFIX}_slide_cover_16x9.png`);
const OUT_SLIDE_OUTCOMES = path.join(OUT_DIR, `${PREFIX}_slide_outcomes_16x9.png`);
const OUT_MOBILE_TOP = path.join(OUT_DIR, `${PREFIX}_iphone390x844.png`);
const OUT_MOBILE_FULL = path.join(OUT_DIR, `${PREFIX}_iphone390_full.png`);
const OUT_MOBILE_SLIDE = path.join(OUT_DIR, `${PREFIX}_iphone390_slide.png`);

const SHOWCASE_PATH = process.env.FDE_SHOT_SHOWCASE_PATH || '/teacher/class-showcase/';
const TEACHER_EMAIL = process.env.FDE_SHOT_TEACHER_EMAIL || 'demo.teacher@fde-demo.local';

// Git Bash（MSYS）會把「以 / 開頭」的環境變數值轉成 Windows 磁碟路徑，導致導航失敗。
// 這裡直接安全停止，避免靜默截錯頁面。
if (!SHOWCASE_PATH.startsWith('/')) {
  console.error(
    `[安全停止] FDE_SHOT_SHOWCASE_PATH 必須以 / 開頭，目前為 ${JSON.stringify(SHOWCASE_PATH)}。` +
      ' 在 Git Bash 請加上 MSYS_NO_PATHCONV=1 再執行。'
  );
  process.exit(2);
}

// 安全規範：密碼不寫死在程式碼（依序：環境變數 → 憑證檔 → 家目錄憑證）。
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
  console.error('[安全停止] 無法取得教師密碼：請設定 FDE_DEMO_TEACHER_PASSWORD，或提供憑證檔。');
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

    const navigateTo = async (targetPath) => {
      const url = `${BASE}${targetPath}`;
      const same = async () => (await evaluate('location.pathname')) === targetPath;
      for (let attempt = 0; attempt < 4; attempt++) {
        await send('Page.navigate', { url });
        for (let i = 0; i < 12; i++) {
          await sleep(400);
          if (await same()) return true;
        }
        await evaluate(`(() => { location.assign(${JSON.stringify(url)}); return location.pathname; })()`);
        for (let i = 0; i < 12; i++) {
          await sleep(400);
          if (await same()) return true;
        }
      }
      return false;
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

    const shootViewport = async (outPath) => {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      if (shot.result && shot.result.data) {
        fs.writeFileSync(outPath, Buffer.from(shot.result.data, 'base64'));
        return true;
      }
      return false;
    };

    const pressKey = async (key, code, vk) => {
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code,
        windowsVirtualKeyCode: vk,
        nativeVirtualKeyCode: vk,
      });
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        windowsVirtualKeyCode: vk,
        nativeVirtualKeyCode: vk,
      });
      await sleep(300);
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
    record('教師登入表單可送出', loginRes === 'submitted', `result=${loginRes}`);
    let landed = false;
    for (let i = 0; i < 25; i++) {
      await sleep(400);
      if ((await evaluate('location.pathname')) === '/teacher/') {
        landed = true;
        break;
      }
    }
    record('教師登入後抵達教師後台', landed, `path=${await evaluate('location.pathname')}`);
    await send('Page.bringToFront');

    // --- 桌面 1440：一般檢視 ---
    const navigated = await navigateTo(SHOWCASE_PATH);
    record('已抵達班級成果展示頁', navigated, `path=${await evaluate('location.pathname')}`);
    await sleep(700);

    const desktop = await evaluate(`(() => {
      const de = document.documentElement;
      const slides = Array.from(document.querySelectorAll('.sc-slide')).map((s) => s.getAttribute('data-slide'));
      const statCards = Array.from(document.querySelectorAll('#slide-outcomes .sc-stat-num')).map((n) => n.textContent.trim());
      const bodyText = document.body.innerText;
      return {
        url: location.pathname,
        h1: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : '',
        slideCount: slides.length,
        slides,
        overflowX: de.scrollWidth - de.clientWidth,
        statCardCount: statCards.length,
        startBtn: !!document.getElementById('showcase-start'),
        controlsHidden: (() => { const c = document.getElementById('sc-controls'); return c ? c.hasAttribute('hidden') : null; })(),
        anonChip: bodyText.indexOf('匿名化展示（預設）') !== -1,
        namedChip: bodyText.indexOf('具名展示') !== -1,
        hasSerialLabel: bodyText.indexOf('學員 01') !== -1,
        hasMediaUrl: /\\/media\\//.test(document.body.innerHTML),
        hasDownloadLink: /\\/download\\//.test(document.body.innerHTML),
        certClaim: /民航局證照|考照合格率|結訓通過率/.test(bodyText),
        hasCaaDisclaimer: bodyText.indexOf('非民航局專業操作證') !== -1,
        stages: Array.from(document.querySelectorAll('#slide-stages tbody tr td[data-label="階段"]')).map((td) => td.textContent.trim().split('｜')[0]),
        slotRows: document.querySelectorAll('#slide-slots tbody tr').length,
        workCards: document.querySelectorAll('#slide-works .sc-work').length,
      };
    })()`);
    record('桌面可開啟班級成果展示頁', desktop && desktop.url === SHOWCASE_PATH, `url=${desktop && desktop.url} h1=${desktop && desktop.h1}`);
    record('桌面 1440 無橫向溢出', desktop && desktop.overflowX <= 0, `overflowX=${desktop && desktop.overflowX}px`);
    record('七頁投影片齊備且順序正確', !!desktop && desktop.slideCount === 7 && JSON.stringify(desktop.slides) === JSON.stringify(['cover', 'outcomes', 'stages', 'slots', 'works', 'feedback', 'closing']), `slides=${desktop && JSON.stringify(desktop.slides)}`);
    record('班級成果統計卡 6 張', desktop && desktop.statCardCount === 6, `cards=${desktop && desktop.statCardCount}`);
    record('五階段順序為 學→練→做→測→證', !!desktop && JSON.stringify(desktop.stages) === JSON.stringify(['學', '練', '做', '測', '證']), `stages=${desktop && JSON.stringify(desktop.stages)}`);
    record('R01–R08 表格 8 列', desktop && desktop.slotRows === 8, `rows=${desktop && desktop.slotRows}`);
    record('學員作品卡有資料', desktop && desktop.workCards > 0, `cards=${desktop && desktop.workCards}`);
    record('預設為匿名化展示', desktop && desktop.anonChip && desktop.hasSerialLabel, `anon=${desktop && desktop.anonChip} serial=${desktop && desktop.hasSerialLabel}`);
    record('匿名化時未載入任何證據下載連結', desktop && !desktop.hasDownloadLink, `download=${desktop && desktop.hasDownloadLink}`);
    record('未使用公開 /media/ 網址', desktop && !desktop.hasMediaUrl, `media=${desktop && desktop.hasMediaUrl}`);
    record('未宣稱民航局證照或考照合格率', desktop && !desktop.certClaim, `claim=${desktop && desktop.certClaim}`);
    record('已載明「證」階段非民航局專業操作證', desktop && desktop.hasCaaDisclaimer, `disclaimer=${desktop && desktop.hasCaaDisclaimer}`);
    const deskH = await shootFull(OUT_DESKTOP_FULL, 1440);
    console.log('desktop full screenshot:', OUT_DESKTOP_FULL, 'height=', deskH);

    // --- 16:9 簡報播放模式 ---
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(400);
    await evaluate(`(() => { const b = document.getElementById('showcase-start'); if (b) b.click(); return true; })()`);
    await sleep(900);
    const presenting = await evaluate(`(() => {
      const slide = document.querySelector('.sc-slide.is-active');
      const rect = slide ? slide.getBoundingClientRect() : null;
      const controls = document.getElementById('sc-controls');
      return {
        bodyClass: document.body.classList.contains('sc-presenting'),
        activeSlide: slide ? slide.getAttribute('data-slide') : null,
        width: rect ? Math.round(rect.width) : 0,
        height: rect ? Math.round(rect.height) : 0,
        ratio: rect && rect.height ? rect.width / rect.height : 0,
        controlsVisible: controls ? !controls.hasAttribute('hidden') : false,
        current: (document.getElementById('sc-current') || {}).textContent,
      };
    })()`);
    record('點擊「開始展示」進入簡報模式', presenting && presenting.bodyClass === true, `bodyClass=${presenting && presenting.bodyClass}`);
    record('簡報模式起於封面頁', presenting && presenting.activeSlide === 'cover', `active=${presenting && presenting.activeSlide}`);
    record('16:9 投影舞台比例正確', !!presenting && Math.abs(presenting.ratio - 16 / 9) < 0.05, `ratio=${presenting && presenting.ratio.toFixed(4)} (${presenting && presenting.width}×${presenting && presenting.height})`);
    record('簡報模式顯示控制列', presenting && presenting.controlsVisible === true, `controls=${presenting && presenting.controlsVisible}`);
    record('進度指示起於第 1 頁', presenting && String(presenting.current).trim() === '1', `current=${presenting && presenting.current}`);
    await shootViewport(OUT_SLIDE_COVER);
    console.log('slide cover screenshot:', OUT_SLIDE_COVER);

    // 鍵盤：→ 下一頁
    await pressKey('ArrowRight', 'ArrowRight', 39);
    const afterRight = await evaluate(`(() => ({
      active: (document.querySelector('.sc-slide.is-active') || {}).getAttribute ? document.querySelector('.sc-slide.is-active').getAttribute('data-slide') : null,
      current: (document.getElementById('sc-current') || {}).textContent,
    }))()`);
    record('鍵盤 → 切換至下一頁（班級成果）', afterRight && afterRight.active === 'outcomes', `active=${afterRight && afterRight.active} current=${afterRight && afterRight.current}`);
    await shootViewport(OUT_SLIDE_OUTCOMES);
    console.log('slide outcomes screenshot:', OUT_SLIDE_OUTCOMES);

    // 鍵盤：→ 再下一頁，再 ← 返回
    await pressKey('ArrowRight', 'ArrowRight', 39);
    const afterTwo = await evaluate(`document.querySelector('.sc-slide.is-active').getAttribute('data-slide')`);
    await pressKey('ArrowLeft', 'ArrowLeft', 37);
    const afterLeft = await evaluate(`(() => ({
      active: document.querySelector('.sc-slide.is-active').getAttribute('data-slide'),
      current: (document.getElementById('sc-current') || {}).textContent,
    }))()`);
    record('鍵盤 → 可連續前進', afterTwo === 'stages', `active=${afterTwo}`);
    record('鍵盤 ← 可返回上一頁', afterLeft && afterLeft.active === 'outcomes', `active=${afterLeft && afterLeft.active} current=${afterLeft && afterLeft.current}`);

    // 鍵盤：End 到末頁、Home 回首頁
    await pressKey('End', 'End', 35);
    const atEnd = await evaluate(`document.querySelector('.sc-slide.is-active').getAttribute('data-slide')`);
    await pressKey('Home', 'Home', 36);
    const atHome = await evaluate(`document.querySelector('.sc-slide.is-active').getAttribute('data-slide')`);
    record('End 跳到末頁（結語）', atEnd === 'closing', `active=${atEnd}`);
    record('Home 回到首頁（封面）', atHome === 'cover', `active=${atHome}`);

    // 上一頁／下一頁按鈕
    await evaluate(`(() => { document.getElementById('sc-next').click(); return true; })()`);
    await sleep(300);
    const btnNext = await evaluate(`document.querySelector('.sc-slide.is-active').getAttribute('data-slide')`);
    await evaluate(`(() => { document.getElementById('sc-prev').click(); return true; })()`);
    await sleep(300);
    const btnPrev = await evaluate(`document.querySelector('.sc-slide.is-active').getAttribute('data-slide')`);
    record('「下一頁」按鈕可用', btnNext === 'outcomes', `active=${btnNext}`);
    record('「上一頁」按鈕可用', btnPrev === 'cover', `active=${btnPrev}`);

    // 鍵盤：Esc 退出展示
    await pressKey('Escape', 'Escape', 27);
    const afterEsc = await evaluate(`(() => ({
      bodyClass: document.body.classList.contains('sc-presenting'),
      controlsHidden: (() => { const c = document.getElementById('sc-controls'); return c ? c.hasAttribute('hidden') : null; })(),
    }))()`);
    record('Esc 退出簡報模式', afterEsc && afterEsc.bodyClass === false, `bodyClass=${afterEsc && afterEsc.bodyClass}`);
    record('退出後隱藏控制列', afterEsc && afterEsc.controlsHidden === true, `hidden=${afterEsc && afterEsc.controlsHidden}`);

    // --- iPhone 390×844 模擬（一般檢視） ---
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(700);
    const mobile = await evaluate(`(() => {
      const de = document.documentElement;
      const td = document.querySelector('#slide-stages td[data-label="階段"]');
      const controls = Array.from(document.querySelectorAll('.sc-toolbar-row .button, .sc-toolbar-row select'));
      const small = controls.filter((el) => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 44)
        .map((el) => (el.id || el.className || el.tagName) + '=' + Math.round(el.getBoundingClientRect().height));
      return {
        overflowX: de.scrollWidth - de.clientWidth,
        tableDisplay: (() => { const t = document.querySelector('#slide-stages table'); return t ? getComputedStyle(t).display : null; })(),
        trDisplay: (() => { const t = document.querySelector('#slide-stages tbody tr'); return t ? getComputedStyle(t).display : null; })(),
        tdDisplay: td ? getComputedStyle(td).display : null,
        tdLabel: td ? getComputedStyle(td, '::before').content : null,
        tooSmall: small,
        workColumns: (() => {
          const w = document.querySelector('#slide-works .sc-works');
          return w ? getComputedStyle(w).gridTemplateColumns.split(' ').length : 0;
        })(),
      };
    })()`);
    record('手機 390 無橫向溢出', mobile && mobile.overflowX <= 0, `overflowX=${mobile && mobile.overflowX}px`);
    record('手機表格已轉為卡片式（非 table-row）', mobile && mobile.trDisplay !== 'table-row' && mobile.tdDisplay !== 'table-cell', `tr=${mobile && mobile.trDisplay} td=${mobile && mobile.tdDisplay}`);
    record('手機表格卡片顯示欄位標籤', !!mobile && String(mobile.tdLabel).indexOf('階段') !== -1, `content=${mobile && mobile.tdLabel}`);
    record('手機工具列控件皆達 44px 觸控高度', mobile && mobile.tooSmall.length === 0, `tooSmall=${mobile && JSON.stringify(mobile.tooSmall)}`);
    record('手機學員作品為單欄', mobile && mobile.workColumns === 1, `columns=${mobile && mobile.workColumns}`);
    const mobileH = await shootFull(OUT_MOBILE_FULL, 390);
    console.log('mobile full screenshot:', OUT_MOBILE_FULL, 'height=', mobileH);
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(400);
    await shootViewport(OUT_MOBILE_TOP);
    console.log('mobile viewport screenshot:', OUT_MOBILE_TOP);

    // --- 手機簡報模式 ---
    await evaluate(`(() => { const b = document.getElementById('showcase-start'); if (b) b.click(); return true; })()`);
    await sleep(900);
    const mobileSlide = await evaluate(`(() => {
      const slide = document.querySelector('.sc-slide.is-active');
      const rect = slide ? slide.getBoundingClientRect() : null;
      const de = document.documentElement;
      return {
        bodyClass: document.body.classList.contains('sc-presenting'),
        active: slide ? slide.getAttribute('data-slide') : null,
        width: rect ? Math.round(rect.width) : 0,
        height: rect ? Math.round(rect.height) : 0,
        overflowX: de.scrollWidth - de.clientWidth,
      };
    })()`);
    record('手機可進入簡報模式', mobileSlide && mobileSlide.bodyClass === true, `bodyClass=${mobileSlide && mobileSlide.bodyClass}`);
    record('手機簡報填滿螢幕（非 16:9 letterbox）', !!mobileSlide && mobileSlide.width >= 380 && mobileSlide.height >= 800, `${mobileSlide && mobileSlide.width}×${mobileSlide && mobileSlide.height}`);
    record('手機簡報無橫向溢出', mobileSlide && mobileSlide.overflowX <= 0, `overflowX=${mobileSlide && mobileSlide.overflowX}px`);
    await shootViewport(OUT_MOBILE_SLIDE);
    console.log('mobile slide screenshot:', OUT_MOBILE_SLIDE);
    await pressKey('Escape', 'Escape', 27);

    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    console.log('');
    console.log(`==== P7 班級成果展示截圖結果：${passed} 項通過 / ${failed.length} 項失敗 / 共 ${results.length} 項 ====`);
    failed.forEach((f) => console.log(`FAIL 詳列：${f.name} | ${f.detail}`));
    process.exitCode = failed.length ? 1 : 0;
  } catch (error) {
    console.error('ERROR', error && error.message ? error.message : error);
    process.exitCode = 3;
  } finally {
    try {
      chrome.kill();
    } catch (e) {
      /* ignore */
    }
  }
}

main();
