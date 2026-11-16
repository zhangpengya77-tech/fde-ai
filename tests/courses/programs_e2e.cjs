// FDE-AI 五大職業實訓課程｜瀏覽器端對端驗收
// 用 Playwright 攔截請求，把專案根目錄當成 /platform/ 提供（比照 Django：HTML 注入 <base href="/platform/">、無副檔名路徑回首頁），不啟動伺服器。
// 驗收：導航順序、首頁專區 3+2、總覽、五門課程詳情、每日課表、選課計算器 32 種組合、諮詢表單（示範模式不送出）、
//       既有頁面仍正常、手機單列無橫向捲動、減少動態效果、沒有腳本錯誤。
// 用法：set PLAYWRIGHT_PATH=<playwright 路徑> 後執行 node tests/courses/programs_e2e.cjs <截圖資料夾>
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '../..');
const OUT = process.argv[2];
const P = require(path.join(ROOT, 'src/data/vocational-programs.js'));
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp4': 'video/mp4' };
const log = [];
const ok = (c, m) => { log.push(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const posted = [];

async function serve(ctx) {
  await ctx.route('http://fde.test/**', (route) => {
    const req = route.request(), u = new URL(req.url());
    if (req.method() !== 'GET') { posted.push(`${req.method()} ${u.pathname}`); return route.fulfill({ status: 405, body: '' }); }
    let p = decodeURIComponent(u.pathname);
    if (p.startsWith('/platform/')) {
      const rest = p.slice('/platform/'.length);
      const file = path.join(ROOT, rest);
      if (rest && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ body: fs.readFileSync(file), contentType: T[path.extname(file)] || 'application/octet-stream' });
      if (path.extname(rest)) return route.fulfill({ status: 404, body: '' });
      const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace('<head>', '<head>\n    <base href="/platform/">');
      return route.fulfill({ body: html, contentType: 'text/html' });
    }
    const file = path.join(ROOT, p);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ body: fs.readFileSync(file), contentType: T[path.extname(file)] || 'application/octet-stream' });
    return route.fulfill({ status: 404, body: '' });
  });
  await ctx.route(/fonts\.googleapis|fonts\.gstatic/, (r) => r.abort());
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await serve(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const go = async (p) => { await page.goto(`http://fde.test/platform/${p}`); await page.waitForSelector('#moduleNav a'); await page.waitForTimeout(250); };
  const visible = (sel) => page.locator(sel).isVisible();

  // 1) 導航順序：首頁／一分鐘認識／課程開設／學練做測證／原有項目
  await go('');
  const nav = await page.$$eval('#moduleNav .nav-title', (n) => n.map((x) => x.textContent.trim()));
  ok(nav.slice(0, 3).join('|') === '首頁|一分鐘認識 FDE-AI|課程開設', `導航前三項：${nav.slice(0, 3).join('、')}`);
  ok(nav.slice(3, 8).length === 5 && nav.includes('教師復核中心') && nav.includes('歷屆學員成果'), `原有導航項目保留（共 ${nav.length} 項）`);
  ok(await page.$$eval('#mobileNavList .nav-title', (n) => n.length) === nav.length, '手機抽屜導航同步');

  // 2) 首頁專區
  ok(await visible('#programs-home') && await visible('#home'), '首頁同時顯示 hero 與課程專區');
  const homeTxt = await page.locator('#programsHome').textContent();
  ok(homeTxt.includes(P.home.title) && homeTxt.includes('學、練、做、測、證'), '專區標題與文案');
  ok(await page.locator('#programsHome .pg-card').count() === 5, '五張課程卡片');
  const rows = await page.$$eval('#programsHome .pg-card', (c) => c.map((x) => Math.round(x.getBoundingClientRect().top)));
  ok(rows[0] === rows[1] && rows[1] === rows[2] && rows[3] === rows[4] && rows[3] > rows[0], `桌面 3+2 排列（${rows.join(',')}）`);
  const card = await page.locator('#programsHome .pg-card').first().innerText();
  ok(['32 小時', '適合對象', '結訓成果', '發展方向', '了解課程'].every((t) => card.includes(t)) && await page.locator('#programsHome .pg-card').first().locator('svg').count() > 0, '卡片含主視覺、時數、對象、標籤、成果、發展、了解課程');
  ok(homeTxt.includes('5 人即可開班'), '種子教師卡片標示 5 人即可開班');
  if (OUT) await page.locator('#programs-home').screenshot({ path: path.join(OUT, 'C1_home_programs_desktop.png') });

  // 3) 由導航進課程開設總覽（站內切換，不重新載入）
  await page.locator('#moduleNav a[data-route="programs"]').click(); await page.waitForTimeout(300);
  ok(page.url().endsWith('/platform/programs') && await visible('#programs') && !(await visible('#home')), '導航「課程開設」→ /platform/programs');
  ok(await page.locator('#moduleNav a[data-route="programs"][aria-current="page"]').count() === 1, '導航「課程開設」標示目前頁');
  const ov = await page.locator('#programsRoot').innerText();
  ok(['09:00–12:00', '13:00–17:00', '午休', '周末班', '常日班', '5 天（最後一天 4 小時', '23 天（最後一天 6 小時', '46 天（最後一天 5 小時'].every((t) => ov.includes(t)), '總覽：上課制度與五門課時數天數表');
  if (OUT) await page.screenshot({ path: path.join(OUT, 'C2_programs_overview.png'), fullPage: false });

  // 4) 五門詳情
  for (const p of P.programs) {
    await go(p.slug);
    const t = await page.locator('#programsRoot').innerText();
    ok(await page.locator('#programsRoot').getAttribute('data-view') === p.id && t.includes(p.title), `詳情 ${p.slug}：直接開網址可顯示`);
    const need = ['適合對象', '設備', '軟體與平台', '學習成果', '發展方向', '開班形式', '課程諮詢'];
    ok(need.every((x) => t.includes(x)), `詳情 ${p.slug}：各區塊齊全`);
    ok(await page.locator('#programsRoot .pg-stage').count() >= 5 && await page.locator('#programsRoot .pg-stage .pg-art').count() >= 5, `詳情 ${p.slug}：階段大綱與每階段圖片（${await page.locator('#programsRoot .pg-stage').count()} 個）`);
    if (p.daily) {
      const rowsN = await page.locator('#programsRoot .pg-daily tbody tr').count();
      ok(rowsN === p.daily.length, `詳情 ${p.slug}：每日內容 ${rowsN} 天`);
      const last = await page.locator('#programsRoot .pg-daily tbody tr').last().textContent();
      ok(last.includes(`09:00–${P.dayEndTime(p.schedule.lastDayHours)}`), `詳情 ${p.slug}：最後一天 ${p.schedule.lastDayHours} 小時、${P.dayEndTime(p.schedule.lastDayHours)} 下課`);
    }
    if (OUT) await page.screenshot({ path: path.join(OUT, `C3_detail_${p.slug}.png`) });
  }
  // 特定內容
  await go('seed-teacher'); { const t = await page.locator('#programsRoot').innerText(); ok(t.includes('5 人即可開班') && t.includes('依實際合作單位公告') && t.includes('不以一般課堂模擬完全取代'), '種子教師：5 人開班、實習待公告、實習不得取代'); }
  await go('maintenance-engineer'); { const t = await page.locator('#programsRoot').innerText(); ok(t.includes('950 mm') && t.includes('須經當事人同意') && t.includes('無人船') && t.includes('沒有單列無人船實訓日'), '裝調檢修：大型機專題、同意聲明、無人船擴展說明'); }
  await go('rd-engineer'); { const t = await page.locator('#programsRoot').innerText(); ok(t.includes('第 13–18 天') && t.includes('42 小時') && t.includes('無人船開發改為測繪建模'), '研發工程師：SITL／ROS 2 六天 42 小時、測繪取代無人船'); }

  // 5) 選課計算器：所有 32 種組合
  await go('pro-pilot');
  const boxes = page.locator('[data-calc-mod]');
  ok(await boxes.count() === 5, '計算器 5 個模組');
  let bad = 0;
  for (let mask = 0; mask < 32; mask++) {
    for (let i = 0; i < 5; i++) { const want = !!(mask & (1 << i)); if ((await boxes.nth(i).isChecked()) !== want) await boxes.nth(i).setChecked(want); }
    const n = [0, 1, 2, 3, 4].filter((i) => mask & (1 << i)).length, r = P.pilotPlan(n);
    const total = await page.locator('[data-calc-total]').textContent(), days = await page.locator('[data-calc-days]').textContent(), ext = await page.locator('[data-calc-ext]').textContent();
    if (total !== `${r.totalHours} 小時` || !days.startsWith(`${r.days} 天（最後一天 ${r.lastDayHours} 小時`) || (r.extensionHours ? !ext.includes(`${r.extensionHours} 小時`) : ext !== '無')) bad++;
  }
  ok(bad === 0, `計算器 32 種組合畫面結果全部正確（錯 ${bad}）`);
  for (let i = 0; i < 5; i++) await boxes.nth(i).setChecked(i < 2);
  ok((await page.locator('[data-calc]').innerText()).includes('預設不含綜合考核'), '選 1～2 個模組提示「預設不含綜合考核，依實際公告」');
  ok((await page.locator('#programsRoot').innerText()).includes('依法須具備的操作資格') && (await page.locator('#programsRoot').innerText()).includes('依主管機關公告'), '職業飛手：崗位與資格分開，資格依主管機關公告');
  if (OUT) await page.locator('[data-calc]').screenshot({ path: path.join(OUT, 'C4_calculator.png') });

  // 6) 諮詢表單：前端驗證、示範模式不送出任何請求
  const form = page.locator('[data-consult-form]');
  await form.locator('button[type="submit"]').click();
  ok((await form.locator('[data-consult-msg]').textContent()).includes('請填寫稱呼'), '表單：空白送出顯示錯誤');
  await form.locator('input[name="name"]').fill('測試'); await form.locator('input[name="contact"]').fill('0912345678'); await form.locator('input[name="consent"]').check();
  ok(await form.locator('select[name="course"]').inputValue() === 'pilot', '表單：詳情頁預選目前課程');
  const before = posted.length;
  await form.locator('button[type="submit"]').click();
  ok((await form.locator('[data-consult-msg]').textContent()).includes('示範模式') && posted.length === before, '表單：通過驗證後顯示示範模式，沒有送出任何請求');
  await form.locator('button[type="submit"]').click();
  ok((await form.locator('[data-consult-msg]').textContent()).includes('30 秒'), '表單：30 秒內重送被限流');

  // 7) 既有頁面仍正常
  for (const [p, sel] of [['about', '#about'], ['courses', '#learn'], ['simulator', '#practice'], ['f450', '#build'], ['eagle', '#inspection'], ['results', '#cohorts'], ['teacher', '#teacher'], ['tasks', '#missions']]) {
    await go(p);
    ok(await visible(sel) && !(await visible('#programs')) && !(await visible('#programs-home')), `既有頁面 /platform/${p} 正常，課程區塊不出現`);
  }
  ok(await page.locator('.portal-entry-links a[href="/login/"]').count() === 1 && await page.locator('.portal-entry-links a[href="/register/"]').count() === 1 && await page.locator('.portal-entry-links a[href="/teacher/login/"]').count() === 1, '登入、註冊、教師登入入口保留');

  // 8) 手機：單列、無橫向捲動
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); await serve(m);
  const mp = await m.newPage(); mp.on('pageerror', (e) => errs.push(String(e)));
  for (const p of ['', 'programs', ...P.programs.map((x) => x.slug)]) {
    await mp.goto(`http://fde.test/platform/${p}`); await mp.waitForTimeout(300);
    const w = await mp.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(w[0] <= w[1] + 1, `手機 /platform/${p || ''}：無橫向捲動（${w[0]}/${w[1]}）`);
  }
  await mp.goto('http://fde.test/platform/'); await mp.waitForTimeout(300);
  const xs = await mp.$$eval('#programsHome .pg-card', (c) => c.map((x) => Math.round(x.getBoundingClientRect().left)));
  ok(new Set(xs).size === 1, '手機：首頁卡片單列');
  if (OUT) { await mp.locator('#programs-home').screenshot({ path: path.join(OUT, 'C5_home_programs_mobile.png') }); await mp.goto('http://fde.test/platform/pro-pilot'); await mp.waitForTimeout(300); await mp.screenshot({ path: path.join(OUT, 'C6_pilot_mobile.png'), fullPage: false }); }

  // 9) 減少動態效果
  const r = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); await serve(r);
  const rp = await r.newPage(); await rp.goto('http://fde.test/platform/'); await rp.waitForTimeout(300);
  ok(await rp.$eval('#programsHome .pa-spin', (e) => getComputedStyle(e).animationName) === 'none', '減少動態效果時示意圖動畫關閉');

  // 10) 首頁圖片預算：課程專區不載入點陣圖
  ok(await page.evaluate(() => true) && (await (async () => { const pg = await ctx.newPage(); const imgs = []; pg.on('request', (q) => { if (q.resourceType() === 'image' && /programs|f450-twin\/img/.test(q.url())) imgs.push(q.url()); }); await pg.goto('http://fde.test/platform/'); await pg.waitForTimeout(500); await pg.close(); return imgs.length === 0; })()), '首頁課程專區不額外下載點陣圖（原創 SVG）');

  ok(errs.length === 0, `沒有腳本錯誤${errs.length ? '：' + errs.slice(0, 3).join(' | ') : ''}`);
  console.log(log.join('\n')); console.log(`${log.filter((l) => l.startsWith('PASS')).length}/${log.length} 通過`);
  await browser.close();
})().catch((e) => { console.log(log.join('\n')); console.error(String(e).slice(0, 400)); process.exit(1); });
