// P9-C 教師操作驗收（9 步）：以 Chrome DevTools Protocol 走完實際教師的一條龍流程。
//
// 步驟：1 登入 → 2 選擇班級 → 3 查看待複核成果 → 4 查看結訓審核清單 →
//       5 查看班級成果報告 → 6 匯出兩種 CSV → 7 開啟成果展示 →
//       8 使用匿名簡報 → 9 退出展示與登出
//
// 重要：本腳本為 **Chrome 裝置模擬**（headless=new + Emulation.setDeviceMetricsOverride），
// 並非真實 iPhone Safari。兩者於報告中分開陳述；真機驗收一律標 PENDING。
//
// 驗收庫：demo\runtime\db\p42_verify.sqlite3（:8112），與 DEMO（8110／8111）
// 及正式服務（8022）完全隔離。
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = Number(process.env.FDE_P9_CDP_PORT || 9350);
const USER_DATA = process.env.FDE_P9_PROFILE || 'D:\\AI_Cache\\temp\\chrome-p9-teacher';
const BASE = process.env.FDE_P9_BASE || 'http://192.168.1.114:8112';
const OUT_DIR = process.env.FDE_P9_OUT_DIR || 'D:\\FDE-AI-UAS-v2.0\\demo\\runtime\\logs';

// 教師 A：擁有 P42-A-2026（3 名學員）與 P42-C-2026（0 名學員），不含 P42-B-2026。
const TEACHER_A = process.env.FDE_P9_TEACHER || 'p42.teacher.a@fde-demo.local';
const COHORT_A = 'P42-A-2026';
const COHORT_EMPTY = 'P42-C-2026';
const COHORT_FORBIDDEN = 'P42-B-2026'; // 屬於教師 B，教師 A 不得檢視。

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

    const evaluate = async (expr, awaitPromise = false) => {
      const r = await send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise,
      });
      if (r.result && r.result.exceptionDetails) {
        return { __error: r.result.exceptionDetails.text };
      }
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    const setViewport = async (width, height, mobile) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: !!mobile,
      });
      await sleep(400);
    };
    const pressKey = async (key, code, vk) => {
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
      });
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
      });
      await sleep(350);
    };
    const pathNow = async () => await evaluate('location.pathname');
    const waitPath = async (expect, tries = 25) => {
      for (let i = 0; i < tries; i++) {
        await sleep(400);
        if ((await pathNow()) === expect) return true;
      }
      return false;
    };
    const goto = async (url, expectPath) => {
      await send('Page.navigate', { url });
      if (!expectPath) {
        await sleep(1200);
        return true;
      }
      return await waitPath(expectPath);
    };

    await send('Page.enable');
    await send('Network.enable');
    await setViewport(1440, 900, false);

    // ══════════════ 步驟 1：教師登入 ══════════════
    await send('Page.navigate', { url: `${BASE}/teacher/login/` });
    await sleep(2200);
    const loginRes = await evaluate(`(() => {
      const form = document.querySelector('form[method="post"]');
      if (!form) return 'no-form';
      const u = form.querySelector('[name="username"]');
      const p = form.querySelector('[name="password"]');
      if (!u || !p) return 'no-fields';
      u.value = ${JSON.stringify(TEACHER_A)};
      p.value = ${JSON.stringify(TEACHER_PASSWORD)};
      form.submit();
      return 'submitted';
    })()`);
    record('1-1 教師登入表單可送出', loginRes === 'submitted', `result=${loginRes}`);
    const landed = await waitPath('/teacher/');
    record('1-2 登入後抵達教師後台', landed, `path=${await pathNow()}`);
    const dash = await evaluate(`(() => {
      const t = document.body.innerText;
      return {
        p3: t.indexOf('班級學習成果總覽') !== -1,
        p5: t.indexOf('班級成果報告') !== -1,
        p6: t.indexOf('結訓審核清單') !== -1,
        p7: t.indexOf('班級成果展示中心') !== -1,
      };
    })()`);
    record(
      '1-3 後台同時提供 P3／P5／P6／P7 四個教師入口',
      !!dash && dash.p3 && dash.p5 && dash.p6 && dash.p7,
      `p3=${dash && dash.p3} p5=${dash && dash.p5} p6=${dash && dash.p6} p7=${dash && dash.p7}`
    );

    // ══════════════ 步驟 2：選擇班級 ══════════════
    await goto(`${BASE}/teacher/class-outcomes/`, '/teacher/class-outcomes/');
    const cohortOpts = await evaluate(`(() => {
      const s = document.querySelector('select[name="cohort"]');
      if (!s) return null;
      return Array.from(s.options).map((o) => o.value);
    })()`);
    const optList = Array.isArray(cohortOpts) ? cohortOpts : [];
    record(
      '2-1 班級選單可列出教師可檢視的班級',
      optList.includes(COHORT_A) && optList.includes(COHORT_EMPTY),
      `options=${JSON.stringify(optList)}`
    );
    record(
      '2-2 班級選單不含未授權班級（跨班級隔離）',
      !optList.includes(COHORT_FORBIDDEN),
      `forbidden=${COHORT_FORBIDDEN} present=${optList.includes(COHORT_FORBIDDEN)}`
    );
    const selected = await evaluate(`(() => {
      const s = document.querySelector('select[name="cohort"]');
      if (!s) return 'no-select';
      const opt = Array.from(s.options).find((o) => o.value === ${JSON.stringify(COHORT_A)});
      if (!opt) return 'no-option';
      s.value = ${JSON.stringify(COHORT_A)};
      s.form.submit();
      return 'submitted';
    })()`);
    await sleep(1600);
    const afterSelect = await evaluate(`(() => ({
      path: location.pathname,
      query: location.search,
      showsCohort: document.body.innerText.indexOf(${JSON.stringify(COHORT_A)}) !== -1,
      selected: (() => { const s = document.querySelector('select[name="cohort"]'); return s ? s.value : null; })(),
    }))()`);
    record(
      '2-3 可切換至指定班級且選單狀態保留',
      selected === 'submitted' && afterSelect && afterSelect.showsCohort && afterSelect.selected === COHORT_A,
      `selected=${afterSelect && afterSelect.selected} query=${afterSelect && afterSelect.query}`
    );

    // ══════════════ 步驟 3：查看待複核成果 ══════════════
    const outcomes = await evaluate(`(() => {
      const t = document.body.innerText;
      const stats = Array.from(document.querySelectorAll('.tco-stat')).map((e) => ({
        num: (e.querySelector('.tco-stat-num') || {}).textContent || '',
        label: (e.querySelector('.tco-stat-label') || {}).textContent || '',
      }));
      const labels = stats.map((s) => s.label);
      const numeric = stats.filter((s) => /^\\d+$/.test(s.num.trim())).length;
      return {
        heading: t.indexOf('班級學習成果') !== -1,
        pendingBlock: t.indexOf('待複核') !== -1,
        statCount: stats.length,
        numeric,
        labels,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`);
    record(
      '3-1 待複核成果區塊存在',
      !!outcomes && outcomes.heading && outcomes.pendingBlock,
      `heading=${outcomes && outcomes.heading} pending=${outcomes && outcomes.pendingBlock}`
    );
    const wantLabels = ['班級學員（人）', '待複核成果（筆）', '尚未提交（人）', '已完成八項（人）'];
    const gotLabels = (outcomes && outcomes.labels) || [];
    record(
      '3-2 待複核成果以四項統計數字呈現（學員／待複核／尚未提交／已完成八項）',
      !!outcomes && outcomes.statCount >= 4 && outcomes.numeric === outcomes.statCount
        && wantLabels.every((l) => gotLabels.includes(l)),
      `stats=${outcomes && outcomes.statCount} numeric=${outcomes && outcomes.numeric} labels=${JSON.stringify(gotLabels)}`
    );

    // ══════════════ 步驟 4：查看結訓審核清單 ══════════════
    await goto(`${BASE}/teacher/review-checklist/?cohort=${COHORT_A}`, '/teacher/review-checklist/');
    const checklist = await evaluate(`(() => {
      const t = document.body.innerText;
      const links = Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));
      return {
        heading: t.indexOf('結訓審核清單') !== -1,
        noFakePass: t.indexOf('不自動判定學員合格') !== -1,
        noLicence: t.indexOf('不核發任何證照') !== -1,
        toExistingReview: links.some((h) => h && (h.indexOf('/teacher/growth-reviews/') !== -1
          || h.indexOf('/teacher/enrollments/') !== -1 || h.indexOf('/teacher/reviews/') !== -1)),
        hasCsv: links.some((h) => h && h.indexOf('/export/') !== -1),
      };
    })()`);
    record(
      '4-1 結訓審核清單載入且載明不自動判定結訓',
      !!checklist && checklist.heading && checklist.noFakePass && checklist.noLicence,
      `heading=${checklist && checklist.heading} noFakePass=${checklist && checklist.noFakePass}`
    );
    record(
      '4-2 待處理項目指向既有教師審核頁（未建第二套複核流程）',
      !!checklist && checklist.toExistingReview,
      `toExistingReview=${checklist && checklist.toExistingReview}`
    );

    // ══════════════ 步驟 5：查看班級成果報告 ══════════════
    await goto(`${BASE}/teacher/class-report/?cohort=${COHORT_A}`, '/teacher/class-report/');
    const report = await evaluate(`(() => {
      const t = document.body.innerText;
      return {
        heading: t.indexOf('班級結訓成果報告') !== -1,
        noFake: t.indexOf('不產生任何假成績') !== -1,
        notEqual: t.indexOf('不等於') !== -1,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`);
    record(
      '5-1 班級成果報告載入並載明不產生假資料',
      !!report && report.heading && report.noFake,
      `heading=${report && report.heading} noFake=${report && report.noFake}`
    );
    record(
      '5-2 報告載明「已提交」不等於「通過」',
      !!report && report.notEqual,
      `notEqual=${report && report.notEqual}`
    );

    // ══════════════ 步驟 6：匯出兩種 CSV ══════════════
    const csv = await evaluate(
      `(async () => {
        const out = {};
        const grab = async (url) => {
          const res = await fetch(url, { credentials: 'same-origin' });
          const buf = new Uint8Array(await res.arrayBuffer());
          const head = Array.from(buf.slice(0, 3)).map((b) => b.toString(16).padStart(2, '0')).join('');
          let text = '';
          try { text = new TextDecoder('utf-8').decode(buf); } catch (e) { text = ''; }
          const firstLine = (text.split(/\\r?\\n/)[0] || '');
          return {
            status: res.status,
            ct: res.headers.get('content-type') || '',
            cd: res.headers.get('content-disposition') || '',
            bom: head === 'efbbbf',
            firstLine,
            lines: text.split(/\\r?\\n/).filter((l) => l.length).length,
            hasEmail: /@fde-demo\\.local|@fde-p42\\.local/.test(text),
            hasSecret: /password|token|csrf|secret/i.test(text),
          };
        };
        out.summary = await grab(${JSON.stringify(`${BASE}/teacher/class-report/export/summary/${COHORT_A}/`)});
        out.records = await grab(${JSON.stringify(`${BASE}/teacher/class-report/export/records/${COHORT_A}/`)});
        return out;
      })()`,
      true
    );
    const s = csv && csv.summary;
    const r2 = csv && csv.records;
    record(
      '6-1 班級統計摘要 CSV 可下載（200 + text/csv + UTF-8 BOM）',
      !!s && s.status === 200 && /csv/i.test(s.ct) && s.bom === true,
      `status=${s && s.status} ct=${s && s.ct} bom=${s && s.bom} lines=${s && s.lines}`
    );
    record(
      '6-2 學員成果明細 CSV 可下載（200 + text/csv + UTF-8 BOM）',
      !!r2 && r2.status === 200 && /csv/i.test(r2.ct) && r2.bom === true,
      `status=${r2 && r2.status} ct=${r2 && r2.ct} bom=${r2 && r2.bom} lines=${r2 && r2.lines}`
    );
    record(
      '6-3 兩份 CSV 皆不匯出 Email 與密碼／Token',
      !!s && !!r2 && !s.hasEmail && !r2.hasEmail && !s.hasSecret && !r2.hasSecret,
      `summary(email=${s && s.hasEmail},secret=${s && s.hasSecret}) records(email=${r2 && r2.hasEmail},secret=${r2 && r2.hasSecret})`
    );
    record(
      '6-4 兩份 CSV 具備資料列（非空檔）',
      !!s && !!r2 && s.lines >= 2 && r2.lines >= 2,
      `summaryLines=${s && s.lines} recordsLines=${r2 && r2.lines}`
    );

    // ══════════════ 步驟 7：開啟成果展示 ══════════════
    await goto(`${BASE}/teacher/class-showcase/${COHORT_A}/`, `/teacher/class-showcase/${COHORT_A}/`);
    const showcase = await evaluate(`(() => {
      const t = document.body.innerText;
      return {
        loaded: t.indexOf('班級成果展示') !== -1,
        anon: t.indexOf('匿名化展示') !== -1,
        slides: document.querySelectorAll('.sc-slide').length,
        hasDownload: /\\/download\\//.test(document.body.innerHTML),
        hasMedia: /\\/media\\//.test(document.body.innerHTML),
        startBtn: !!document.getElementById('showcase-start'),
      };
    })()`);
    record(
      '7-1 成果展示頁載入且預設匿名',
      !!showcase && showcase.loaded && showcase.anon,
      `loaded=${showcase && showcase.loaded} anon=${showcase && showcase.anon}`
    );
    record(
      '7-2 展示頁具備簡報頁面與開始按鈕',
      !!showcase && showcase.slides >= 7 && showcase.startBtn,
      `slides=${showcase && showcase.slides} start=${showcase && showcase.startBtn}`
    );
    record(
      '7-3 匿名模式不輸出證據連結、不使用公開 /media/',
      !!showcase && !showcase.hasDownload && !showcase.hasMedia,
      `download=${showcase && showcase.hasDownload} media=${showcase && showcase.hasMedia}`
    );

    // ══════════════ 步驟 8：使用匿名簡報 ══════════════
    await evaluate(`(() => { const b = document.getElementById('showcase-start'); if (b) b.click(); return true; })()`);
    await sleep(900);
    const pres = await evaluate(`(() => {
      const slide = document.querySelector('.sc-slide.is-active');
      return {
        presenting: document.body.classList.contains('sc-presenting'),
        first: slide ? slide.getAttribute('data-slide') : null,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`);
    record(
      '8-1 匿名簡報模式可進入',
      !!pres && pres.presenting === true,
      `presenting=${pres && pres.presenting} slide=${pres && pres.first}`
    );
    await pressKey('ArrowRight', 'ArrowRight', 39);
    const afterNext = await evaluate(`(() => { const s = document.querySelector('.sc-slide.is-active'); return s ? s.getAttribute('data-slide') : null; })()`);
    record(
      '8-2 鍵盤可切換下一頁',
      !!afterNext && afterNext !== (pres && pres.first),
      `from=${pres && pres.first} to=${afterNext}`
    );
    await pressKey('ArrowLeft', 'ArrowLeft', 37);
    const afterPrev = await evaluate(`(() => { const s = document.querySelector('.sc-slide.is-active'); return s ? s.getAttribute('data-slide') : null; })()`);
    record(
      '8-3 鍵盤可切換上一頁',
      afterPrev === (pres && pres.first),
      `back=${afterPrev}`
    );
    const anonDuringPres = await evaluate(`(() => ({
      hasDownload: /\\/download\\//.test(document.body.innerHTML),
      hasMedia: /\\/media\\//.test(document.body.innerHTML),
      names: Array.from(document.querySelectorAll('.sc-slide.is-active')).map((e) => e.innerText).join(' '),
    }))()`);
    record(
      '8-4 簡報進行中仍維持匿名（無證據連結）',
      !!anonDuringPres && !anonDuringPres.hasDownload && !anonDuringPres.hasMedia,
      `download=${anonDuringPres && anonDuringPres.hasDownload} media=${anonDuringPres && anonDuringPres.hasMedia}`
    );
    record(
      '8-5 簡報模式無橫向溢出',
      !!pres && pres.overflowX <= 0,
      `overflowX=${pres && pres.overflowX}px`
    );

    // ══════════════ 步驟 9：退出展示與登出 ══════════════
    await pressKey('Escape', 'Escape', 27);
    await sleep(500);
    const exited = await evaluate(`(() => ({
      presenting: document.body.classList.contains('sc-presenting'),
      chip: document.body.innerText.indexOf('匿名化展示') !== -1,
    }))()`);
    record(
      '9-1 Esc 可退出簡報並回到一般檢視',
      !!exited && exited.presenting === false,
      `presenting=${exited && exited.presenting}`
    );
    const logoutRes = await evaluate(`(() => {
      const forms = Array.from(document.querySelectorAll('form[action*="logout"]'));
      if (!forms.length) return 'no-form';
      forms[0].submit();
      return 'submitted';
    })()`);
    await sleep(1800);
    const afterLogout = await pathNow();
    record(
      '9-2 可正常登出（離開教師後台）',
      logoutRes === 'submitted' && afterLogout !== '/teacher/',
      `result=${logoutRes} path=${afterLogout}`
    );
    await goto(`${BASE}/teacher/class-report/`, null);
    await sleep(1200);
    const guarded = await evaluate(`(() => ({ path: location.pathname, search: location.search }))()`);
    record(
      '9-3 登出後受保護頁面不再可直接檢視',
      !!guarded && guarded.path !== '/teacher/class-report/',
      `path=${guarded && guarded.path}${guarded && guarded.search}`
    );

    // ══════════════ 補充：手機尺寸（Chrome 模擬，非真實 Safari） ══════════════
    await send('Page.navigate', { url: `${BASE}/teacher/login/` });
    await sleep(1500);
    await evaluate(`(() => {
      const form = document.querySelector('form[method="post"]');
      if (!form) return 'no-form';
      form.querySelector('[name="username"]').value = ${JSON.stringify(TEACHER_A)};
      form.querySelector('[name="password"]').value = ${JSON.stringify(TEACHER_PASSWORD)};
      form.submit();
      return 'submitted';
    })()`);
    await waitPath('/teacher/');
    await setViewport(390, 844, true);
    const mobileChecks = [
      ['/teacher/class-outcomes/', '待複核'],
      ['/teacher/review-checklist/', '結訓審核清單'],
      ['/teacher/class-report/', '班級結訓成果報告'],
      [`/teacher/class-showcase/${COHORT_A}/`, '班級成果展示'],
    ];
    let mobileOverflow = 0;
    for (const [p, marker] of mobileChecks) {
      await send('Page.navigate', { url: `${BASE}${p}` });
      await sleep(1500);
      const st = await evaluate(`(() => ({
        marker: document.body.innerText.indexOf(${JSON.stringify(marker)}) !== -1,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }))()`);
      const over = st ? st.overflowX : 9999;
      if (over > 0) mobileOverflow++;
      record(
        `補充-手機390×844 ${p} 可讀且不橫向溢出`,
        !!st && st.marker === true && over <= 0,
        `marker=${st && st.marker} overflowX=${over}px`
      );
    }
    record(
      '補充-手機尺寸四頁皆無橫向溢出',
      mobileOverflow === 0,
      `overflowPages=${mobileOverflow}`
    );

    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    console.log('');
    console.log(`==== P9-C 教師操作驗收（Chrome 模擬）：${passed} 項通過 / ${failed.length} 項失敗 / 共 ${results.length} 項 ====`);
    failed.forEach((f) => console.log(`FAIL 詳列：${f.name} | ${f.detail}`));
    console.log('注意：本結果為 Chrome 裝置模擬，非真實 iPhone Safari；真機驗收 PENDING。');
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
