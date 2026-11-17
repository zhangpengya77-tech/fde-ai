/*
 * FDE-AI 五大職業實訓課程｜頁面（2026-11-17）
 * - 首頁專區（#programsHome）、課程總覽與五門課程詳情（#programsRoot）、職業飛手選課計算器、課程諮詢入口。
 * - 2026-11-18：總覽最上面加「專項課程專區」（FPV 競技／足球無人機／固定翼，開發中）；右上角「課程諮詢」閃亮提示（電話＋LINE 二維碼）。
 * - 內容全部來自 src/data/vocational-programs.js；每門課一張概念圖 assets/programs/<課程>.webp（Pexels 授權，見 assets/CREDITS.md）。
 * - 路由沿用平台既有 FdeRouter：/platform/programs（總覽）、/platform/<課程代號>（詳情）；app.js 切換頁面時會設定 body[data-route]。
 * - 課程諮詢表單送到 /api/public/course-inquiry/（教師電腦的 Django）：存在獨立資料庫、寄通知信給老師，教師後台「課程諮詢」查看；GitHub 頁面上改送到固定入口。
 */
(function () {
  'use strict';
  const D = window.FdePrograms;
  if (!D) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byRoute = Object.fromEntries(D.programs.map((p) => [`program-${p.slug}`, p]));
  const LINE_URL = 'https://line.me/ti/g/jnXbd7PKK8', PHONE = '0901-189-740';
  // GitHub Pages 靜態版（教師電腦關機也能看）：站內的靜態頁改用 Pages 上的相對路徑，需要教師電腦的功能改連固定入口
  const GATEWAY = 'https://fde-ai-v2.fde-ai-gateway.workers.dev';
  const ON_PAGES = /github\.io$/.test(location.hostname);
  const link = (href) => {
    if (!ON_PAGES || !href.startsWith('/')) return href;
    if (href.startsWith('/f450-twin/') || href.startsWith('/sim/')) return `.${href}`;
    if (href.startsWith('/live/airspace/')) return './airspace/';
    return GATEWAY + href;
  };

  const hoursLabel = (p) => p.hoursLabel || `${p.totalHours} 小時`;
  const chips = (list, cls = 'pg-chip') => list.map((t) => `<span class="${cls}">${esc(t)}</span>`).join('');
  const ul = (list) => `<ul class="pg-list">${list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
  // 課程概念圖（Pexels 授權，見 assets/CREDITS.md）：每門課一張，800×480 webp，延遲載入
  const IMG = (p) => `./assets/programs/${p.id}.webp`;
  const banner = (p, cls) => `<img class="${cls}" src="${IMG(p)}" alt="${esc(p.title)}概念圖" loading="lazy" decoding="async" width="800" height="480">`;
  const classLine = (p) => (p.minClass ? `${p.minClass} 人即可開班` : '依設備、場地、師資與安全條件開班');
  const infoLine = (p) => [p.id === 'pilot' ? '7～14 天（依選修）' : `${p.schedule.days} 天`, classLine(p), p.formats.filter((f) => /班$/.test(f)).join('／')].join(' · ');
  // 卡片上的階段清單（有階段的課程才列）：[{ label, hours, title, items }]
  function stagesOf(p) {
    if (p.stages) return p.stages.map((s, i) => ({ label: `階段 ${i + 1}`, hours: s.hours, title: s.title, items: s.items }));
    if (p.id === 'pilot') return [{ label: '共同基礎', hours: p.base.hours, title: '必修', items: p.base.items }, ...p.modules.map((m) => ({ label: `模組 ${m.code}`, hours: m.hours, title: m.title, items: m.items }))];
    if (p.blocks) return p.blocks.map((b, i) => ({ label: `階段 ${i + 1}`, hours: b.hours, title: `${b.title}（第 ${b.days[0]}–${b.days[1]} 天）`, items: b.items }));
    if (p.groups) return p.groups.map((g, i) => ({ label: `階段 ${i + 1}`, hours: p.daily.filter((d) => d.day >= g.days[0] && d.day <= g.days[1]).reduce((t, d) => t + d.hours, 0), title: `${g.title}（第 ${g.days[0]}${g.days[1] !== g.days[0] ? `–${g.days[1]}` : ''} 天）`, items: p.days.slice(g.days[0] - 1, g.days[1]).map((d) => d.title) }));
    return [];
  }

  // ───────── 課程卡片（首頁與總覽共用，統一版型） ─────────
  function card(p, opts = {}) {
    const stages = opts.stages ? stagesOf(p) : [];
    return `<article class="pg-card" data-program="${p.id}">
      <a class="pg-card-media" href="./${p.slug}" data-route="program-${p.slug}" tabindex="-1" aria-hidden="true">${banner(p, 'pg-card-img')}</a>
      <div class="pg-card-body">
        <p class="pg-card-no">COURSE 0${p.order}</p>
        <h3>${esc(p.title)}</h3>
        <p class="pg-card-hours"><b>${esc(hoursLabel(p))}</b></p>
        <p class="pg-card-info">${esc(infoLine(p))}</p>
        <p class="pg-card-tagline">${esc(p.tagline)}</p>
        <dl class="pg-card-meta">
          <dt>適合對象</dt><dd>${esc(p.audience.slice(0, 2).join('、'))}</dd>
          <dt>結訓成果</dt><dd>${esc(p.outcomes.slice(0, 3).join('、'))}</dd>
          <dt>發展方向</dt><dd>${esc(p.careers.slice(0, 3).join('、'))}</dd>
        </dl>
        ${stages.length ? `<ol class="pg-card-stages">${stages.map((s) => `<li><p class="pg-st-head"><span>${esc(s.label)}</span><b>${esc(s.title)}</b><em>${s.hours} 小時</em></p><p class="pg-st-items">${esc((s.items || []).join('、'))}</p></li>`).join('')}</ol>` : ''}
        <div class="pg-chips">${chips(p.tags.slice(0, 6))}</div>
        <a class="pg-btn" href="./${p.slug}" data-route="program-${p.slug}">了解課程 →</a>
      </div>
    </article>`;
  }

  function renderHome() {
    const box = document.getElementById('programsHome');
    if (!box || box.dataset.ready) return;
    box.dataset.ready = '1';
    box.innerHTML = `<div class="pg-head">
        <p class="eyebrow">Vocational Programs · 課程專區</p>
        <h2>${esc(D.home.title)}</h2>
        <p>${esc(D.home.intro)}</p>
      </div>
      <div class="pg-grid">${D.programs.map(card).join('')}</div>
      <p class="pg-more"><a class="pg-btn ghost" href="./programs" data-route="programs">前往課程專區與課程諮詢 →</a></p>`;
  }

  // ───────── 專項課程專區（2026-11-18）：FPV 競技、足球無人機、固定翼 ─────────
  // 放在課程專區最上面、與下方職訓課程分開；目前都是「開發中」，先不放課程內容。
  // 圖示是飛機概念造型的線條 SVG（currentColor），不使用外部圖片。
  const ZONE_ICONS = {
    // FPV 競速機：X 型機架、四個旋翼、機頭相機
    fpv: '<svg viewBox="0 0 64 64"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M20 20 44 44M44 20 20 44"/><circle cx="16" cy="16" r="9"/><circle cx="48" cy="16" r="9"/><circle cx="16" cy="48" r="9"/><circle cx="48" cy="48" r="9"/><rect x="26" y="25" width="12" height="14" rx="3"/><circle cx="32" cy="29" r="2.2" fill="currentColor"/></g><path d="M28 6h8l-4 5z" fill="currentColor"/></svg>',
    // 足球無人機：球形保護籠＋中央小飛機
    soccer: '<svg viewBox="0 0 64 64"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="32" cy="32" r="26"/><ellipse cx="32" cy="32" rx="26" ry="10"/><ellipse cx="32" cy="32" rx="10" ry="26"/><path d="M24 24 40 40M40 24 24 40"/><circle cx="24" cy="24" r="3.5"/><circle cx="40" cy="24" r="3.5"/><circle cx="24" cy="40" r="3.5"/><circle cx="40" cy="40" r="3.5"/></g></svg>',
    // 固定翼飛機：機身、主翼、尾翼
    fixedwing: '<svg viewBox="0 0 64 64"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"><path d="M32 6c2.5 0 3.5 4 3.5 9v10l22 10v5l-22-5v12l7 5v4l-10.5-3-10.5 3v-4l7-5V40l-22 5v-5l22-10V15c0-5 1-9 3.5-9z"/></g></svg>',
  };
  const SPECIAL_ZONES = [
    { id: 'fpv', title: 'FPV 競技課程專區', en: 'FPV RACING' },
    { id: 'soccer', title: '足球無人機課程專區', en: 'DRONE SOCCER' },
    { id: 'fixedwing', title: '固定翼飛機課程專區', en: 'FIXED-WING' },
  ];
  function specialZones() {
    return `<section class="pg-zones" aria-label="專項課程專區">
      <p class="pg-section-title"><span>專項課程專區</span><em>SPECIAL PROGRAMS</em></p>
      <div class="pg-zone-grid">${SPECIAL_ZONES.map((z) => `<article class="pg-zone" data-zone="${z.id}" aria-disabled="true">
          <span class="pg-zone-badge">開發中</span>
          <div class="pg-zone-icon" aria-hidden="true">${ZONE_ICONS[z.id]}</div>
          <p class="pg-zone-en">${z.en}</p>
          <h3>${esc(z.title)}</h3>
        </article>`).join('')}</div>
    </section>`;
  }

  // ───────── 右上角「課程諮詢」閃亮提示：電話＋LINE 二維碼（只在課程專區與課程詳情頁顯示） ─────────
  function mountConsultFab() {
    if (document.getElementById('pgFab')) return;
    const box = document.createElement('div');
    box.id = 'pgFab';
    box.className = 'pg-fab';
    box.innerHTML = `<button type="button" class="pg-fab-btn" aria-expanded="false" aria-controls="pgFabPanel">
        <span class="pg-fab-dot" aria-hidden="true"></span>課程諮詢</button>
      <div class="pg-fab-panel" id="pgFabPanel" hidden>
        <p class="pg-fab-title">課程諮詢</p>
        <a class="pg-fab-phone" href="tel:${PHONE.replace(/-/g, '')}">電話 ${PHONE}</a>
        <img class="pg-fab-qr" src="./assets/programs/line-qr.jpg" alt="FDE-AI LINE 二維碼" width="180" height="180" loading="lazy">
        <p class="pg-fab-hint">手機掃描加入 LINE 詢問</p>
        <a class="pg-fab-line" href="${LINE_URL}" target="_blank" rel="noopener">用 LINE 開啟</a>
        <a class="pg-fab-form" href="#pg-consult">填寫線上諮詢表單</a>
      </div>`;
    document.body.appendChild(box);
    const btn = box.querySelector('.pg-fab-btn'), panel = box.querySelector('.pg-fab-panel');
    const setOpen = (open) => { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); box.classList.toggle('open', open); };
    btn.addEventListener('click', () => setOpen(panel.hidden));
    // 點面板外面或按 Esc 收起
    document.addEventListener('click', (e) => { if (!box.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    box.querySelector('.pg-fab-form').addEventListener('click', () => setOpen(false));
  }

  // ───────── 課程總覽：最上面專項課程專區，下面五大職業實訓課程 ─────────
  function overview() {
    return `<div class="pg-head">
        <p class="eyebrow">Programs · 課程專區</p>
        <h2>課程專區</h2>
      </div>
      ${specialZones()}
      <p class="pg-section-title"><span>五大職業實訓課程</span><em>VOCATIONAL PROGRAMS</em></p>
      <div class="pg-list-cards">${D.programs.map((p) => card(p, { stages: true })).join('')}</div>
      ${consultForm()}
      ${legalNote()}`;
  }

  // ───────── 詳情頁 ─────────
  function stageBlock(st, i, extra = '') {
    return `<article class="pg-stage">
      <div><p class="pg-stage-no">${extra || `階段 ${i + 1}`}${st.hours ? `｜${st.hours} 小時` : ''}</p><h4>${esc(st.title)}</h4>${ul(st.items || [])}${st.note ? `<p class="pg-note">${esc(st.note)}</p>` : ''}${st.pending ? `<p class="pg-pending">${esc(st.pending)}</p>` : ''}${st.devStatus ? `<p class="pg-pending">${esc(st.devStatus)}</p>` : ''}</div>
    </article>`;
  }

  function dailyTable(p) {
    if (!p.daily) return '';
    const total = p.daily.length;
    return `<details class="pg-daily"${total <= 7 ? ' open' : ''}><summary>每日內容（共 ${total} 天，${p.daily.reduce((s, d) => s + d.hours, 0)} 小時）</summary>
      <div class="pg-table-wrap"><table class="pg-table"><thead><tr><th>天</th><th>時間</th><th>時數</th><th>內容</th></tr></thead><tbody>
      ${p.daily.map((d) => `<tr><td>D${d.day}</td><td>09:00–${D.dayEndTime(d.hours)}</td><td>${d.hours}</td><td>${d.parts.map((x) => `${esc(x.stage)}${d.parts.length > 1 ? `（${x.hours}h）` : ''}`).join('<br>')}</td></tr>`).join('')}
      </tbody></table></div></details>`;
  }

  function pilotCalculator(p) {
    return `<section class="pg-calc" aria-label="職業飛手選課計算器" data-calc>
      <h3>選課計算器</h3>
      <p>共同基礎 ${p.base.hours} 小時為必修；每個專業模組 ${D.PILOT.moduleHours} 小時；選 ${D.PILOT.examFrom} 個以上模組加 ${D.PILOT.examHours} 小時綜合考核。超過 ${D.PILOT.standardCap} 小時的部分列為「延伸訓練時數」。</p>
      <div class="pg-calc-mods">${p.modules.map((m) => `<label class="pg-calc-mod"><input type="checkbox" value="${m.code}" data-calc-mod><span><b>${m.code}</b> ${esc(m.title)}<small>${m.hours} 小時${m.devStatus ? '・開發中' : ''}</small></span></label>`).join('')}</div>
      <div class="pg-calc-out" aria-live="polite" data-calc-out></div>
    </section>`;
  }

  function calcRender(box, p) {
    const sel = [...box.querySelectorAll('[data-calc-mod]:checked')].map((x) => x.value);
    const r = D.pilotPlan(sel.length);
    const out = box.querySelector('[data-calc-out]');
    out.innerHTML = `<div class="pg-calc-sum">
        <div><span>已選模組</span><b data-calc-selected>${sel.length ? sel.join('、') : '尚未選擇'}</b></div>
        <div><span>總時數</span><b data-calc-total>${r.totalHours} 小時</b></div>
        <div><span>訓練日數</span><b data-calc-days>${r.days} 天（最後一天 ${r.lastDayHours} 小時，${D.dayEndTime(r.lastDayHours)} 下課）</b></div>
        <div><span>延伸訓練時數</span><b data-calc-ext>${r.extensionHours ? `${r.extensionHours} 小時（標準 ${r.standardHours}＋延伸 ${r.extensionHours}）` : '無'}</b></div>
      </div>
      <p class="pg-calc-formula">= 共同基礎 ${p.base.hours}${sel.length ? ` ＋ 模組 ${D.PILOT.moduleHours}×${sel.length}` : ''}${r.examHours ? ` ＋ 綜合考核 ${r.examHours}` : ''}</p>
      ${sel.length && sel.length < D.PILOT.examFrom ? `<p class="pg-pending">選 1～2 個模組預設不含綜合考核，${esc(D.PENDING)}。</p>` : ''}
      ${!sel.length ? '<p class="pg-note">請至少選 1 個專業模組（只上共同基礎的方案依實際公告）。</p>' : ''}`;
  }

  function detail(p) {
    let outline = '';
    if (p.stages) outline = p.stages.map((s, i) => stageBlock(s, i)).join('');
    if (p.id === 'pilot') outline = stageBlock(p.base, 0, '共同基礎（必修）') + p.modules.map((m) => stageBlock({ ...m, title: `模組 ${m.code}｜${m.title}` }, 0, '專業模組（選修）')).join('') + `<p class="pg-note">${esc(p.exam.note)}</p>`;
    if (p.blocks) outline = p.blocks.map((b) => stageBlock(b, 0, `第 ${b.days[0]}–${b.days[1]} 天`)).join('');
    if (p.groups) outline = p.groups.map((g) => stageBlock({ title: g.title, hours: p.daily.filter((d) => d.day >= g.days[0] && d.day <= g.days[1]).reduce((s, d) => s + d.hours, 0), items: p.days.slice(g.days[0] - 1, g.days[1]).map((d, k) => `D${g.days[0] + k}　${d.title}`), art: p.days[g.days[0] - 1].art, photo: p.days[g.days[0] - 1].photo }, 0, g.days[0] === g.days[1] ? `第 ${g.days[0]} 天` : `第 ${g.days[0]}–${g.days[1]} 天`)).join('');
    const idx = D.programs.indexOf(p), prev = D.programs[idx - 1], next = D.programs[idx + 1];
    return `<nav class="pg-crumb"><a href="./programs" data-route="programs">← 課程專區</a></nav>
      <header class="pg-hero">
        <div class="pg-hero-art">${banner(p, 'pg-hero-img')}</div>
        <div class="pg-hero-copy">
          <p class="eyebrow">COURSE 0${p.order} · ${esc(p.enTitle)}</p>
          <h2>${esc(p.title)}</h2>
          <p class="pg-lead">${esc(p.positioning)}</p>
          <div class="pg-facts">
            <div><span>總時數</span><b>${esc(hoursLabel(p))}</b></div>
            <div><span>上課日數</span><b>${esc(p.id === 'pilot' ? '7～14 天（依選修）' : `${p.schedule.days} 天`)}</b></div>
            <div><span>開班形式</span><b>${esc(p.formats.join('／'))}</b></div>
            <div><span>開班人數</span><b>${esc(classLine(p))}</b></div>
          </div>
          <div class="pg-chips">${chips(p.tags)}</div>
          <a class="pg-btn" href="#pg-consult" data-consult="${p.id}">課程諮詢</a>
        </div>
      </header>
      <section class="pg-sec"><h3>適合對象</h3>${ul(p.audience)}</section>
      ${p.id === 'pilot' ? pilotCalculator(p) : ''}
      <section class="pg-sec"><h3>${p.id === 'pilot' ? '課程模組' : '階段式大綱'}</h3>${p.mustKeep ? `<p class="pg-note">${esc(p.mustKeep)}</p>` : ''}<div class="pg-stages">${outline}</div></section>
      ${p.largeAircraft ? `<section class="pg-sec pg-box"><h3>${esc(p.largeAircraft.title)}</h3>${ul(p.largeAircraft.items)}<p class="pg-note">${esc(p.largeAircraft.note)}</p></section>` : ''}
      ${p.boatNote ? `<section class="pg-sec pg-box"><h3>擴展設備：無人船</h3><p>${esc(p.boatNote)}</p></section>` : ''}
      <section class="pg-sec">${dailyTable(p)}${p.id === 'pilot' ? '<p class="pg-note">實際上課日數依選修模組計算，見上方選課計算器。</p>' : ''}</section>
      <section class="pg-sec pg-two"><div><h3>設備</h3>${ul(p.equipment)}</div><div><h3>軟體與平台</h3>${ul(p.software)}</div></section>
      <section class="pg-sec pg-two"><div><h3>學習成果</h3>${ul(p.outcomes)}<p class="pg-note">結訓成果記錄在 FDE-AI 平台的作業、學習成長日誌、AI 測評與成果存證中。</p></div><div><h3>發展方向</h3>${p.id === 'pilot' ? `<p class="pg-sub">訓練後可應徵的崗位</p>${ul(p.careers)}<p class="pg-sub">依法須具備的操作資格</p><p class="pg-pending">${esc(p.qualificationNote)}</p>` : ul(p.careers)}</div></section>
      ${p.platformLinks ? `<section class="pg-sec"><h3>平台上的相關練習</h3><div class="pg-chips">${p.platformLinks.map((l) => `<a class="pg-chip link" href="${esc(link(l.href))}">${esc(l.label)}</a>`).join('')}</div></section>` : ''}
      ${p.notes?.length ? `<section class="pg-sec pg-box"><h3>注意事項</h3>${ul(p.notes)}</section>` : ''}
      ${consultForm(p.id)}
      <nav class="pg-pager">${prev ? `<a href="./${prev.slug}" data-route="program-${prev.slug}">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a href="./${next.slug}" data-route="program-${next.slug}">${esc(next.title)} →</a>` : ''}</nav>
      ${legalNote()}`;
  }

  // ───────── 課程諮詢：送到教師後台（獨立資料庫，保存 180 天） ─────────
  const INQUIRY_URL = ON_PAGES ? `${GATEWAY}/api/public/course-inquiry/` : '/api/public/course-inquiry/';
  function consultForm(selected = '') {
    return `<section class="pg-consult" id="pg-consult" aria-label="課程諮詢">
      <h3>課程諮詢</h3>
      <p class="pg-note">留下聯絡方式，老師會主動聯絡你；也可以直接<a href="${LINE_URL}" target="_blank" rel="noopener">加入 LINE 群組</a>或來電 <a href="tel:0901189740">${PHONE}</a>。</p>
      <form class="pg-form" novalidate data-consult-form>
        <label>稱呼 <input name="name" maxlength="30" autocomplete="name" required></label>
        <label>聯絡方式（手機或 Email）<input name="contact" maxlength="80" autocomplete="email" required></label>
        <label>有興趣的課程 <select name="course" required><option value="">請選擇</option>${D.programs.map((p) => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>
        <label>班別 <select name="format"><option>周末班</option><option>常日班</option><option>都可以／未定</option></select></label>
        <label class="pg-wide">想問的問題（選填）<textarea name="message" rows="3" maxlength="500"></textarea></label>
        <label class="pg-hp" aria-hidden="true">網站 <input name="website" tabindex="-1" autocomplete="off"></label>
        <input type="hidden" name="started_ms" value="${Date.now()}">
        <label class="pg-wide pg-consent"><input type="checkbox" name="consent" required> 我同意：FDE-AI 只用這些資料回覆本次課程諮詢，不另作他用；資料保存 180 天後自動刪除，也可以來電要求提前刪除。</label>
        <button class="pg-btn" type="submit">送出諮詢</button>
        <p class="pg-form-msg" role="status" aria-live="polite" data-consult-msg></p>
      </form>
    </section>`;
  }

  function bindConsult(scope) {
    scope.querySelectorAll('[data-consult-form]').forEach((form) => {
      let last = 0;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const msg = form.querySelector('[data-consult-msg]'), f = new FormData(form);
        if (f.get('website')) { msg.textContent = '已收到。'; return; }   // 機器人陷阱欄位：真人看不到
        if (Date.now() - last < 30000) { msg.textContent = '請稍候 30 秒再送出。'; return; }
        const name = String(f.get('name') || '').trim(), contact = String(f.get('contact') || '').trim();
        const okContact = /^09\d{2}-?\d{3}-?\d{3}$/.test(contact.replace(/\s/g, '')) || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact);
        const errs = [];
        if (!name) errs.push('請填寫稱呼');
        if (!okContact) errs.push('請填寫正確的手機（09 開頭）或 Email');
        if (!f.get('course')) errs.push('請選擇課程');
        if (!f.get('consent')) errs.push('請勾選同意個資告知');
        if (errs.length) { msg.textContent = errs.join('；'); msg.className = 'pg-form-msg bad'; return; }
        last = Date.now();
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true; msg.className = 'pg-form-msg'; msg.textContent = '送出中…';
        const fallback = `請改用 <a href="${LINE_URL}" target="_blank" rel="noopener">LINE 群組</a>或來電 ${PHONE} 聯繫老師。`;
        // 用一般表單格式送出（不需要跨網站預檢）；不帶 Cookie
        fetch(INQUIRY_URL, { method: 'POST', body: new URLSearchParams(f), credentials: 'omit' })
          .then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }))
          .then(({ status, data }) => {
            if (status === 200 && data.ok) { msg.className = 'pg-form-msg ok'; msg.textContent = '已送出！老師收到後會盡快和你聯絡。'; form.reset(); return; }
            msg.className = 'pg-form-msg bad';
            if (status === 503) msg.innerHTML = `教學主機目前離線，諮詢暫時無法送出。${fallback}`;
            else msg.innerHTML = `${esc(data.error || '送出失敗')}。${fallback}`;
            if (status !== 400) last = Date.now(); else last = 0;
          })
          .catch(() => { msg.className = 'pg-form-msg bad'; msg.innerHTML = `網路連線失敗，諮詢沒有送出。${fallback}`; last = 0; })
          .finally(() => { btn.disabled = false; });
      });
    });
    scope.querySelectorAll('[data-consult]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const sec = scope.querySelector('#pg-consult');
      sec?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      sec?.querySelector('input[name="name"]')?.focus({ preventScroll: true });
    }));
    scope.querySelectorAll('[data-calc]').forEach((box) => {
      const p = D.programs.find((x) => x.id === 'pilot');
      box.addEventListener('change', () => calcRender(box, p));
      calcRender(box, p);
    });
  }

  function legalNote() {
    return `<p class="pg-legal">課程內容為訓練規劃，實際開課日期、地點與設備以公告為準。課程不代表取得任何證照、資格或就業；相關資格與作業規範依主管機關公告。數位孿生、FDE-GCS 地面站、Gazebo 與多機編隊目前為開發中／規劃中。影像追蹤相關操作須經當事人同意。</p>`;
  }

  // ───────── 依路由顯示 ─────────
  let lastKey = '';
  function render() {
    renderHome();
    mountConsultFab();
    const key = document.body.dataset.route || '';
    const root = document.getElementById('programsRoot');
    if (!root || key === lastKey || !(key === 'programs' || byRoute[key])) return;
    lastKey = key;
    const p = byRoute[key];
    root.innerHTML = p ? detail(p) : overview();
    root.dataset.view = p ? p.id : 'overview';
    bindConsult(root);
    document.title = p ? `${p.title}｜FDE-AI 課程專區` : '課程專區｜FDE-AI 專項課程與五大職業實訓課程';
    if (window.scrollY > 0) window.scrollTo(0, 0);
  }

  new MutationObserver(render).observe(document.body, { attributes: true, attributeFilter: ['data-route'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
  window.FdeProgramsPage = { render };
})();
