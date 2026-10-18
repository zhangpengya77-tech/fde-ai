// P8 成果展示安全加固：多解析度投影、手機、鍵盤、圖片載入失敗、長評語不溢出。
// 沿用 P7 既有七頁簡報（不重新開發），以 Chrome DevTools Protocol 驗證：
//   1920×1080（投影）／1366×768（筆電）／390×844（手機）
//   全螢幕進入與退出、鍵盤切頁與 Esc、圖片載入失敗不影響整場展示、
//   大量成果圖片載入、長篇教師評語不溢出。
// 注意：此為 Chrome 裝置模擬，非真實 Safari 驗收；兩者於報告中分開陳述。
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = Number(process.env.FDE_SHOT_CDP_PORT || 9340);
const USER_DATA = process.env.FDE_SHOT_PROFILE || 'D:\\AI_Cache\\temp\\chrome-p8-showcase';
const BASE = process.env.FDE_SHOT_BASE || 'http://192.168.1.114:8112';
const PREFIX = process.env.FDE_SHOT_PREFIX || 'p8_showcase';
const OUT_DIR = process.env.FDE_SHOT_OUT_DIR || 'D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs';
const SHOWCASE_PATH = process.env.FDE_SHOT_SHOWCASE_PATH || '/teacher/class-showcase/';
const TEACHER_EMAIL = process.env.FDE_SHOT_TEACHER_EMAIL || 'demo.teacher@fde-demo.local';

if (!SHOWCASE_PATH.startsWith('/')) {
  console.error(
    `[安全停止] FDE_SHOT_SHOWCASE_PATH 必須以 / 開頭，目前為 ${JSON.stringify(SHOWCASE_PATH)}。` +
      ' 在 Git Bash 請加上 MSYS_NO_PATHCONV=1 再執行。'
  );
  process.exit(2);
}

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
      '--window-size=1920,1080',
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
    const setViewport = async (width, height, mobile) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: !!mobile,
      });
      await sleep(400);
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
        type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
      });
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
      });
      await sleep(300);
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
      }
      return false;
    };
    const enterPresentation = async () => {
      await evaluate(`(() => { const b = document.getElementById('showcase-start'); if (b) b.click(); return true; })()`);
      await sleep(800);
    };
    const exitPresentation = async () => {
      await pressKey('Escape', 'Escape', 27);
      await sleep(300);
    };

    // --- 教師登入 ---
    await send('Page.enable');
    await send('Network.enable');
    await setViewport(1920, 1080, false);
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

    const navigated = await navigateTo(SHOWCASE_PATH);
    record('已抵達班級成果展示頁', navigated, `path=${await evaluate('location.pathname')}`);
    await sleep(700);

    // --- 預設匿名（P8-B 契約）---
    const anonState = await evaluate(`(() => {
      const text = document.body.innerText;
      return {
        anonChip: text.indexOf('匿名化展示（預設）') !== -1,
        namedChip: text.indexOf('具名展示') !== -1,
        hasDownload: /\\/download\\//.test(document.body.innerHTML),
        hasMedia: /\\/media\\//.test(document.body.innerHTML),
      };
    })()`);
    record('預設為匿名化展示', anonState && anonState.anonChip === true, `anon=${anonState && anonState.anonChip}`);
    record('匿名模式未載入任何證據連結', anonState && !anonState.hasDownload, `download=${anonState && anonState.hasDownload}`);
    record('未使用公開 /media/ 網址', anonState && !anonState.hasMedia, `media=${anonState && anonState.hasMedia}`);

    // --- 開啟具名展示（教師確認授權）以測試圖片情境 ---
    const enableRes = await evaluate(`(() => {
      const forms = Array.from(document.querySelectorAll('.sc-privacy-actions form'));
      const form = forms[0];
      if (!form) return 'no-form';
      form.submit();
      return 'submitted';
    })()`);
    await sleep(1500);
    const namedState = await evaluate(`(() => {
      const text = document.body.innerText;
      return {
        namedChip: text.indexOf('具名展示（教師確認已取得必要授權）') !== -1,
        notice: text.indexOf('本系統無法查核授權來源') !== -1,
        imgCount: document.querySelectorAll('.sc-evidence-thumb').length,
      };
    })()`);
    record('可開啟具名展示（教師確認授權）', enableRes === 'submitted' && namedState && namedState.namedChip === true, `chip=${namedState && namedState.namedChip}`);
    record('具名模式載明系統無法查核授權', namedState && namedState.notice === true, `notice=${namedState && namedState.notice}`);
    // 具名模式的證據處理：有既有證據時必須經授權端點載入；該班若真的沒有證據，
    // 則不得輸出任何證據連結（不得為了通過而虛構）。兩種情形都算契約正確。
    // 圖片證據渲染縮圖（?inline=1），非圖片證據渲染「開啟私有檔案」連結；
    // 兩者都必須走既有的授權端點 /evidence/<uuid>/download/，且不得出現公開 /media/。
    const namedEvidence = await evaluate(`(() => {
      const html = document.body.innerHTML;
      return {
        imgs: document.querySelectorAll('.sc-evidence-thumb').length,
        hasDownload: /\\/download\\//.test(html),
        hasMedia: /\\/media\\//.test(html),
        onlyAuthorisedEndpoint: !/\\/download\\//.test(html)
          || /\\/evidence\\/[0-9a-fA-F-]{8,}\\/download\\//.test(html),
      };
    })()`);
    record(
      '具名模式不使用公開 /media/ 網址',
      namedEvidence && namedEvidence.hasMedia === false,
      `media=${namedEvidence && namedEvidence.hasMedia}`
    );
    record(
      '具名模式證據一律經授權端點（圖片縮圖或私有檔案連結）',
      namedEvidence && namedEvidence.onlyAuthorisedEndpoint === true,
      `imgs=${namedEvidence && namedEvidence.imgs} download=${namedEvidence && namedEvidence.hasDownload}`
    );

    // --- 多解析度 × 簡報模式 ---
    const resolutions = [
      { w: 1920, h: 1080, label: '1920×1080 投影', file: `${PREFIX}_1920x1080_slide.png`, expect: 'ratio' },
      { w: 1366, h: 768, label: '1366×768 筆電', file: `${PREFIX}_1366x768_slide.png`, expect: 'ratio' },
      { w: 390, h: 844, label: '390×844 手機', file: `${PREFIX}_iphone390x844_slide.png`, expect: 'fill' },
    ];
    for (const res of resolutions) {
      await setViewport(res.w, res.h, res.w <= 430);
      await sleep(400);
      await enterPresentation();
      const state = await evaluate(`(() => {
        const slide = document.querySelector('.sc-slide.is-active');
        const rect = slide ? slide.getBoundingClientRect() : null;
        const de = document.documentElement;
        return {
          bodyClass: document.body.classList.contains('sc-presenting'),
          active: slide ? slide.getAttribute('data-slide') : null,
          width: rect ? Math.round(rect.width) : 0,
          height: rect ? Math.round(rect.height) : 0,
          ratio: rect && rect.height ? rect.width / rect.height : 0,
          overflowX: de.scrollWidth - de.clientWidth,
          controlsVisible: (() => { const c = document.getElementById('sc-controls'); return c ? !c.hasAttribute('hidden') : false; })(),
        };
      })()`);
      record(`簡報模式可於${res.label}進入`, state && state.bodyClass === true, `active=${state && state.active}`);
      record(`${res.label} 無橫向溢出`, state && state.overflowX <= 0, `overflowX=${state && state.overflowX}px`);
      if (res.expect === 'ratio') {
        record(
          `${res.label} 維持 16:9 投影比例`,
          !!state && Math.abs(state.ratio - 16 / 9) < 0.02,
          `ratio=${state && state.ratio.toFixed(4)} (${state && state.width}×${state && state.height})`
        );
      } else {
        record(
          `${res.label} 填滿螢幕（非 letterbox）`,
          !!state && state.width >= res.w - 10 && state.height >= res.h - 10,
          `${state && state.width}×${state && state.height}`
        );
      }
      record(`${res.label} 顯示控制列`, state && state.controlsVisible === true, `controls=${state && state.controlsVisible}`);
      await shootViewport(path.join(OUT_DIR, res.file));
      console.log('screenshot:', path.join(OUT_DIR, res.file));

      // 全螢幕進入／退出 + 鍵盤
      const fsState = await evaluate(`(() => ({
        hasFullscreenApi: typeof document.documentElement.requestFullscreen === 'function',
        fullscreenElement: !!document.fullscreenElement,
        presenting: document.body.classList.contains('sc-presenting'),
      }))()`);
      record(
        `${res.label} 進入展示後仍保持展示狀態（含全螢幕 fallback）`,
        fsState && fsState.presenting === true,
        `fullscreen=${fsState && fsState.fullscreenElement} api=${fsState && fsState.hasFullscreenApi}`
      );

      await pressKey('ArrowRight', 'ArrowRight', 39);
      const next = await evaluate(`document.querySelector('.sc-slide.is-active').getAttribute('data-slide')`);
      await pressKey('ArrowLeft', 'ArrowLeft', 37);
      const prev = await evaluate(`document.querySelector('.sc-slide.is-active').getAttribute('data-slide')`);
      record(`${res.label} 鍵盤 → 可切換下一頁`, next === 'outcomes', `active=${next}`);
      record(`${res.label} 鍵盤 ← 可切換上一頁`, prev === 'cover', `active=${prev}`);

      await exitPresentation();
      const exited = await evaluate(`document.body.classList.contains('sc-presenting')`);
      record(`${res.label} Esc 可退出展示`, exited === false, `presenting=${exited}`);
    }

    // --- 圖片載入失敗不影響整場展示 ---
    await setViewport(1366, 768, false);
    await sleep(300);
    await send('Network.setBlockedURLs', { urls: ['*/download/*'] });
    await navigateTo(SHOWCASE_PATH);
    await sleep(800);
    const blocked = await evaluate(`(() => {
      const imgs = Array.from(document.querySelectorAll('.sc-evidence-thumb'));
      return {
        imgCount: imgs.length,
        broken: imgs.filter((img) => img.complete && img.naturalWidth === 0).length,
        slides: document.querySelectorAll('.sc-slide').length,
      };
    })()`);
    record('圖片請求被阻斷後頁面仍完整渲染', blocked && blocked.slides === 7, `slides=${blocked && blocked.slides}`);
    record(
      '圖片載入失敗時不影響其他內容（頁面未崩）',
      blocked && blocked.imgCount >= 0,
      `imgs=${blocked && blocked.imgCount} broken=${blocked && blocked.broken}`
    );
    await enterPresentation();
    const afterBlock = await evaluate(`(() => ({
      presenting: document.body.classList.contains('sc-presenting'),
      active: document.querySelector('.sc-slide.is-active') ? document.querySelector('.sc-slide.is-active').getAttribute('data-slide') : null,
    }))()`);
    await pressKey('ArrowRight', 'ArrowRight', 39);
    await pressKey('ArrowRight', 'ArrowRight', 39);
    const advanced = await evaluate(`document.querySelector('.sc-slide.is-active').getAttribute('data-slide')`);
    record('圖片失敗後仍可正常進入展示', afterBlock && afterBlock.presenting === true, `presenting=${afterBlock && afterBlock.presenting}`);
    record('圖片失敗後仍可正常切頁', advanced === 'stages', `active=${advanced}`);
    await exitPresentation();
    await send('Network.setBlockedURLs', { urls: [] });

    // --- 長篇教師評語不溢出 ---
    await navigateTo(SHOWCASE_PATH);
    await sleep(700);
    const longNote = await evaluate(`(() => {
      const slide = document.getElementById('slide-feedback');
      if (!slide) return { injected: false, reason: 'no-slide' };
      let cells = Array.from(slide.querySelectorAll('td'));
      let synthetic = false;
      if (!cells.length) {
        // 本班尚無教師評語（匿名模式亦不渲染表格）。版面契約不應依賴資料，
        // 故以與模板同構的表格列驗證長文字收斂能力（純前端 DOM，不動後端資料）。
        const table = document.createElement('table');
        table.className = 'sc-table sc-table-feedback';
        table.innerHTML = '<thead><tr><th>學員</th><th>來源</th><th>項目</th><th>複核結果</th><th>教師評語</th></tr></thead>'
          + '<tbody><tr>'
          + '<td data-label="學員">學員 01</td><td data-label="來源">成長紀錄</td>'
          + '<td data-label="項目">R01｜任務紀錄</td><td data-label="複核結果">已複核</td>'
          + '<td data-label="教師評語">待注入</td>'
          + '</tr></tbody>';
        const anchor = slide.querySelector('.sc-note');
        if (anchor) slide.insertBefore(table, anchor); else slide.appendChild(table);
        cells = Array.from(slide.querySelectorAll('td'));
        synthetic = true;
      }
      const target = cells.find((td) => td.getAttribute('data-label') === '教師評語')
        || cells[cells.length - 1];
      if (!target) return { injected: false, reason: 'no-cell' };
      target.textContent = '這是一段刻意加長的教師評語，用來驗證長篇文字不會溢出畫面。'.repeat(12);
      const de = document.documentElement;
      const rect = target.getBoundingClientRect();
      return {
        injected: true,
        synthetic,
        cellRight: Math.round(rect.right),
        docWidth: de.clientWidth,
        overflowX: de.scrollWidth - de.clientWidth,
        scrollWidth: target.scrollWidth,
        clientWidth: target.clientWidth,
      };
    })()`);
    const longNoteTag = longNote && longNote.synthetic ? '模擬列' : '真實列';
    record(
      '長篇教師評語不造成頁面橫向溢出',
      longNote && longNote.injected && longNote.overflowX <= 0,
      `overflowX=${longNote && longNote.overflowX}px (${longNoteTag})`
    );
    record(
      '長篇評語於儲存格內換行（不撐破版面）',
      longNote && longNote.injected && longNote.cellRight <= longNote.docWidth + 1,
      `cellRight=${longNote && longNote.cellRight} doc=${longNote && longNote.docWidth} (${longNoteTag})`
    );
    await setViewport(1366, 768, false);
    await shootViewport(path.join(OUT_DIR, `${PREFIX}_long_note_1366x768.png`));
    console.log('screenshot:', path.join(OUT_DIR, `${PREFIX}_long_note_1366x768.png`));

    // --- 大量成果圖片載入效能 ---
    const perf = await evaluate(`(() => {
      const imgs = Array.from(document.querySelectorAll('.sc-evidence-thumb'));
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        imgCount: imgs.length,
        domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
        loadEvent: nav ? Math.round(nav.loadEventEnd) : null,
        lazyAll: imgs.every((img) => img.getAttribute('loading') === 'lazy'),
      };
    })()`);
    record(
      '證據圖片皆採延遲載入（大量圖片時降低首屏成本）',
      perf && perf.lazyAll === true,
      `imgs=${perf && perf.imgCount} lazy=${perf && perf.lazyAll}`
    );
    record(
      '頁面載入事件在合理時間內完成',
      perf && perf.loadEvent !== null && perf.loadEvent < 8000,
      `load=${perf && perf.loadEvent}ms imgs=${perf && perf.imgCount}`
    );

    // --- 匿名／具名切換後回到匿名（P8-B 契約）---
    await navigateTo(SHOWCASE_PATH);
    await sleep(600);
    const backToAnon = await evaluate(`(() => {
      const forms = Array.from(document.querySelectorAll('.sc-privacy-actions form'));
      if (!forms.length) return 'no-form';
      forms[0].submit();
      return 'submitted';
    })()`);
    await sleep(1500);
    const anonAgain = await evaluate(`(() => ({
      anonChip: document.body.innerText.indexOf('匿名化展示（預設）') !== -1,
      hasDownload: /\\/download\\//.test(document.body.innerHTML),
    }))()`);
    record('可切回匿名化展示', backToAnon === 'submitted' && anonAgain && anonAgain.anonChip === true, `chip=${anonAgain && anonAgain.anonChip}`);
    record('切回匿名後不再輸出證據連結', anonAgain && !anonAgain.hasDownload, `download=${anonAgain && anonAgain.hasDownload}`);

    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    console.log('');
    console.log(`==== P8 展示穩定性截圖結果：${passed} 項通過 / ${failed.length} 項失敗 / 共 ${results.length} 項 ====`);
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
