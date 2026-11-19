// 青少年無人機科學實驗室：單頁應用主程式（雜湊路由，不需要後端）
import { UNITS, LABS, LEVELS } from './data/units.js';
import * as store from './core/store.js';
import { ask, reviewAdvice, nextStep } from './core/assistant.js';
import { InputHub, loadMap, saveMap, DEFAULT_MAP } from './core/input.js';
import { mountWidget } from './widgets.js';

const app = document.getElementById('app');
const input = new InputHub(); input.attach();
let cleanup = null;   // 目前畫面的卸載函式（3D 場景要釋放）

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const LAB_LOADERS = {
  teardown: () => import('./labs/teardown.js'), attitude: () => import('./labs/attitude.js'), battery: () => import('./labs/battery.js'),
  motor: () => import('./labs/motor.js'), f450: () => import('./labs/f450.js'), sensor: () => import('./labs/sensor.js')
};

// ---------- 共用 ----------
function who() {
  const m = store.me();
  document.getElementById('who').innerHTML = m
    ? `<span class="pill">${esc(m.cls)}・${esc(m.nick)}</span><button class="link" id="logout">登出</button>`
    : '<button class="btn small" id="loginBtn">學員登入</button>';
  document.getElementById('logout')?.addEventListener('click', () => { store.logout(); who(); route(); });
  document.getElementById('loginBtn')?.addEventListener('click', () => loginDialog());
}
function loginDialog(after) {
  const d = document.getElementById('dlg');
  d.innerHTML = `<form method="dialog" class="card login"><h3>學員登入</h3>
    <p class="small muted">只需要「暱稱」和老師給的「班級代碼」。請不要輸入真實姓名、電話或學號。</p>
    <label class="pair">暱稱 <input name="n" maxlength="12" required autocomplete="off" placeholder="例：小鷹"></label>
    <label class="pair">班級代碼 <input name="c" maxlength="16" required autocomplete="off" placeholder="例：FDE-A1"></label>
    <p class="small muted">紀錄存在這台裝置的瀏覽器；換裝置請用「我的學習 → 下載學習報告」交給老師。</p>
    <p class="err small" id="lg-err"></p>
    <div class="sc-row"><button class="btn" value="ok">開始學習</button><button class="btn ghost" value="cancel" formnovalidate>先逛逛</button></div></form>`;
  d.showModal();
  d.querySelector('form').onsubmit = e => {
    if (e.submitter?.value === 'cancel') return;
    try { store.login(e.target.n.value, e.target.c.value); who(); after?.(); }
    catch (err) { e.preventDefault(); d.querySelector('#lg-err').textContent = err.message; }
  };
}
function requireLogin(fn) { if (store.me()) fn(); else loginDialog(fn); }
function crumbs(list) { return `<nav class="crumbs">${list.map(([t, h]) => h ? `<a href="${h}">${esc(t)}</a>` : `<span>${esc(t)}</span>`).join('<i>／</i>')}</nav>`; }
function progressBadge(u) { const p = store.unitProgress(u.id); return `<span class="prog"><i style="width:${p.pct}%"></i></span><small>${p.done}/${p.total}</small>`; }

// ---------- 首頁 ----------
function viewHome() {
  const m = store.me(); const nx = nextStep(store.unitProgress);
  const doneUnits = UNITS.filter(u => store.unitProgress(u.id).done === 5).length;
  app.innerHTML = `
  <section class="hero">
    <div><p class="eyebrow">FDE-AI Youth Drone STEM Lab</p><h1>青少年無人機科學實驗室</h1>
      <p>從「為什麼飛得起來」到「親手組裝、寫程式、上場踢無人機足球」。12 個單元、6 個 3D 實驗、足球專項訓練，用看、用動手、用挑戰學科學。</p>
      <div class="sc-row"><a class="btn" href="#/unit/1">從第 1 單元開始</a><a class="btn ghost" href="#/soccer">進入足球訓練場</a></div></div>
    <div class="hero-art" aria-hidden="true">${heroSvg()}</div>
  </section>
  <section class="stats"><div><b>12</b><small>課程單元</small></div><div><b>6</b><small>3D 科學實驗</small></div><div><b>6</b><small>足球訓練任務</small></div><div><b>${m ? doneUnits : '—'}</b><small>${m ? '我已完成單元' : '登入後記錄進度'}</small></div></section>
  ${m ? `<section class="card next"><b>下一步</b><span>${esc(nx.text)}</span>${nx.unit ? `<a class="btn small" href="#/unit/${nx.unit.id}">繼續</a>` : ''}</section>` : ''}
  <section class="grid6">
    ${[['#/courses', '課程介紹與分類', '12 單元依年級分成三級，從認識無人機到 STEM 專題。', '📘'],
       ['#/unit/2', '互動知識課堂', '每單元：知識講解 → 互動動畫 → 學生操作 → 3D 實驗 → 測驗 → 紀錄。', '💡'],
       ['#/labs', '3D 科學實驗室', '拆解、姿態、電池、無刷電機、F450 組裝、感測器六大實驗。', '🧪'],
       ['#/soccer', '無人機足球訓練', '3D 球場、戰術編排、六種任務，支援 USB 遙控器與虛擬搖桿。', '⚽'],
       ['#/me', '我的學習進度', '單元進度、測驗成績、實驗與足球訓練紀錄、學習報告。', '📈'],
       ['#/teacher', '教師專區', '建立班級、指派單元、匯入學生報告、查看成績與批改專題。', '🧑‍🏫']]
      .map(([h, t, d, i]) => `<a class="tile" href="${h}"><span class="ico">${i}</span><b>${t}</b><small>${d}</small></a>`).join('')}
  </section>`;
}
function heroSvg() {
  return `<svg viewBox="0 0 320 220"><defs><linearGradient id="hg" x1="0" x2="1"><stop offset="0" stop-color="#5aa8ff"/><stop offset="1" stop-color="#2f6bf0"/></linearGradient></defs>
  <circle cx="250" cy="60" r="38" fill="#cfe3ff"/><g transform="translate(160 120)"><g stroke="#20365c" stroke-width="8" stroke-linecap="round"><line x1="-80" y1="-36" x2="80" y2="36"/><line x1="80" y1="-36" x2="-80" y2="36"/></g>
  ${[[-80, -36], [80, -36], [-80, 36], [80, 36]].map(([x, y]) => `<ellipse cx="${x}" cy="${y - 10}" rx="42" ry="7" fill="#9cc8ff" opacity=".7"/><circle cx="${x}" cy="${y}" r="10" fill="#ff4d6d"/>`).join('')}
  <rect x="-32" y="-18" width="64" height="36" rx="10" fill="url(#hg)"/><circle cx="0" cy="0" r="7" fill="#fff"/></g>
  <g fill="#ffffff" opacity=".9"><circle cx="40" cy="40" r="3"/><circle cx="70" cy="190" r="2"/><circle cx="290" cy="170" r="3"/></g></svg>`;
}

// ---------- 課程中心 ----------
function viewCourses(level = 'all') {
  const list = UNITS.filter(u => level === 'all' || u.level === level);
  app.innerHTML = `${crumbs([['首頁', '#/'], ['課程中心']])}
  <h2>課程中心</h2>
  <div class="filters">${[['all', '全部'], ...Object.entries(LEVELS)].map(([k, n]) => `<a class="chip ${k === level ? 'on' : ''}" href="#/courses/${k}">${n}</a>`).join('')}</div>
  <div class="cards">${list.map(u => `
    <a class="ucard" href="#/unit/${u.id}">
      <div class="cover" style="--c:${u.color}"><span>${u.code}</span><b>${esc(u.title)}</b></div>
      <div class="body"><small>${LEVELS[u.level]}・${u.minutes} 分鐘</small><p>${esc(u.goal)}</p><div class="row">${progressBadge(u)}<span class="btn small">開始學習</span></div></div>
    </a>`).join('')}</div>`;
}

// ---------- 單元頁（左章節／中內容／右助教）----------
const STEPS = [['read', '知識講解'], ['widget', '互動操作'], ['lab', '3D 實驗'], ['quiz', '隨堂測驗'], ['record', '學習紀錄']];
async function viewUnit(id, step = 'read') {
  const u = UNITS.find(x => x.id === +id); if (!u) return viewNotFound();
  const idx = UNITS.indexOf(u);
  app.innerHTML = `${crumbs([['首頁', '#/'], ['課程中心', '#/courses'], [`${u.code} ${u.title}`]])}
  <div class="unit">
    <aside class="card unav"><p class="eyebrow">本課學習路徑</p>
      ${STEPS.map(([k, n], i) => `<a class="ustep ${k === step ? 'on' : ''}" href="#/unit/${u.id}/${k}"><b>0${i + 1}</b><span>${n}</span>${k !== 'record' && store.me()?.units?.[u.id]?.steps?.[k] ? '<i>✓</i>' : ''}</a>`).join('')}
      <div class="tipbox"><b>學習目標</b><p>${esc(u.goal)}</p></div>
    </aside>
    <section class="card ucontent" id="uc"></section>
    <aside class="card uai">${aiPanel(u)}</aside>
  </div>
  <div class="unit-pager">${idx > 0 ? `<a href="#/unit/${UNITS[idx - 1].id}">← ${UNITS[idx - 1].title}</a>` : '<span></span>'}${idx < UNITS.length - 1 ? `<a href="#/unit/${UNITS[idx + 1].id}">${UNITS[idx + 1].title} →</a>` : ''}</div>`;
  bindAi(u);
  const uc = document.getElementById('uc');
  const i = STEPS.findIndex(s => s[0] === step);
  const head = `<div class="uc-head"><div><p class="eyebrow">${u.code}・${LEVELS[u.level]}</p><h2>${esc(u.title)}</h2></div><span class="pageno">0${i + 1} / 05</span></div>`;
  const nextBtn = i < 4 ? `<a class="btn" href="#/unit/${u.id}/${STEPS[i + 1][0]}">下一步：${STEPS[i + 1][1]} →</a>` : '';
  if (step === 'read') {
    uc.innerHTML = `${head}<div class="sections">${u.sections.map((s, k) => `<article><span>${k + 1}</span><h3>${esc(s.h)}</h3><p>${esc(s.p)}</p></article>`).join('')}</div>${nextBtn}`;
    store.markStep(u.id, 'read');
  } else if (step === 'widget') {
    uc.innerHTML = `${head}<h3>互動操作</h3><p class="muted">${esc(u.task)}</p><div class="widget" id="wg"></div><p class="state" id="wg-st"></p>${nextBtn}`;
    mountWidget(u.widget, document.getElementById('wg'), {
      done: () => { store.markStep(u.id, 'widget'); if (['coding', 'project'].includes(u.lab)) { store.markStep(u.id, 'task'); store.markStep(u.id, 'lab'); } const s = document.getElementById('wg-st'); if (s) { s.className = 'state ok'; s.textContent = '完成！已記錄。'; } },
      project: p => store.saveProject({ unitId: u.id, ...p })
    });
  } else if (step === 'lab') {
    if (u.lab === 'soccer') {
      uc.innerHTML = `${head}<h3>3D 實驗：足球訓練場</h3><p>${esc(u.task)}</p><p class="muted small">這個單元的實驗在「無人機足球訓練場」進行，完成任務後會自動記錄到本單元。</p><a class="btn" href="#/soccer/${u.id === 9 ? 'hover' : u.id === 8 ? 'free' : 'ring'}?unit=${u.id}">進入足球訓練場</a> ${nextBtn}`;
    } else if (['coding', 'project'].includes(u.lab)) {
      uc.innerHTML = `${head}<h3>實作</h3><p>本單元的實作就是「互動操作」頁的${u.lab === 'coding' ? '方塊程式模擬' : '專題紀錄表'}，完成後自動記錄。</p><a class="btn" href="#/unit/${u.id}/widget">前往互動操作</a> ${nextBtn}`;
    } else {
      const L = LABS.find(x => x.id === u.lab);
      uc.innerHTML = `${head}<h3>${esc(L.name)}</h3><p class="muted">${esc(u.task)}</p><a class="btn" href="#/lab/${L.id}?unit=${u.id}">開啟實驗（全版面）</a> ${nextBtn}`;
    }
  } else if (step === 'quiz') {
    renderQuiz(u, uc, head);
  } else {
    const m = store.me(); const p = store.unitProgress(u.id); const ur = m?.units?.[u.id];
    uc.innerHTML = `${head}<h3>學習紀錄</h3>${m ? `<div class="kpis"><div><small>完成步驟</small><b>${p.done}/5</b></div><div><small>測驗最高分</small><b>${p.best ?? '—'}</b></div><div><small>測驗次數</small><b>${ur?.attempts ?? 0}</b></div></div>
      <ul class="small">${['read', 'widget', 'task', 'lab', 'quiz'].map(k => `<li>${({ read: '知識講解', widget: '互動操作', task: '實驗任務', lab: '3D 實驗完成', quiz: '測驗及格（≥60）' })[k]}：${ur?.steps?.[k] ? '✓ ' + new Date(ur.steps[k]).toLocaleString('zh-TW') : '尚未完成'}</li>`).join('')}</ul>` : '<p>登入後才會保存學習紀錄。</p><button class="btn" id="lg">學員登入</button>'}`;
    document.getElementById('lg')?.addEventListener('click', () => loginDialog(route));
  }
}
function renderQuiz(u, uc, head) {
  uc.innerHTML = `${head}<h3>隨堂測驗（${u.quiz.length} 題，60 分及格）</h3><form id="qz">${u.quiz.map((q, i) => `<fieldset><legend>${i + 1}. ${esc(q.q)}</legend>${q.options.map((o, j) => `<label class="opt"><input type="radio" name="q${i}" value="${j}"> ${esc(o)}</label>`).join('')}</fieldset>`).join('')}<button class="btn">交卷</button></form><div id="qr"></div>`;
  document.getElementById('qz').onsubmit = e => {
    e.preventDefault();
    const ans = u.quiz.map((_, i) => { const r = e.target.querySelector(`input[name=q${i}]:checked`); return r ? +r.value : -1; });
    if (ans.includes(-1)) { document.getElementById('qr').innerHTML = '<p class="state over">還有題目沒作答。</p>'; return; }
    const wrong = ans.map((a, i) => a === u.quiz[i].answer ? -1 : i).filter(i => i >= 0);
    const score = u.quiz.length - wrong.length;
    const pct = store.me() ? store.saveQuiz(u.id, score, u.quiz.length, wrong) : Math.round(score / u.quiz.length * 100);
    e.target.querySelectorAll('fieldset').forEach((f, i) => f.classList.add(wrong.includes(i) ? 'bad' : 'good'));
    document.getElementById('qr').innerHTML = `<div class="card result"><b class="${pct >= 60 ? 'ok' : 'bad'}">${pct} 分</b><p>${pct >= 60 ? '及格！' : '未達 60 分，再複習一下。'}${store.me() ? '' : '（未登入，成績不會保存）'}</p><pre class="advice">${esc(reviewAdvice(u, wrong))}</pre><p class="small muted">以上解析來自教師審核的題目解析（規則式回饋）。</p><button class="btn ghost" id="again">重新作答</button></div>`;
    document.getElementById('again').onclick = () => renderQuiz(u, uc, head);
  };
}

// ---------- AI 助教 ----------
function aiPanel(u) {
  return `<p class="eyebrow">AI 學習助教</p><p class="small muted">規則式助教：答案來自本課教材知識庫，不連外部 AI，你輸入的文字不會送出。</p>
  <div class="ai-log" id="ai-log"><p class="bot">嗨！${u ? `這一課是「${esc(u.title)}」。` : ''}看不懂的名詞可以問我，例如「什麼是 Yaw」「3S 是幾伏」。</p></div>
  <form class="ai-form" id="ai-form"><input id="ai-q" maxlength="100" placeholder="輸入問題…" autocomplete="off"><button class="btn small">問</button></form>
  ${u ? `<div class="chips">${u.sections.map(s => `<button class="chip" data-q="${esc(s.h)}">${esc(s.h)}</button>`).join('')}</div>` : ''}`;
}
function bindAi() {
  const log = document.getElementById('ai-log'); const f = document.getElementById('ai-form'); if (!f) return;
  const send = q => {
    const r = ask(q);
    log.insertAdjacentHTML('beforeend', `<p class="me">${esc(q)}</p><p class="bot">${esc(r.answer)}${r.unit ? `<br><a href="#/unit/${r.unit}">→ 複習第 ${r.unit} 單元「${esc(r.unitTitle)}」</a>` : ''}</p>`);
    log.scrollTop = log.scrollHeight;
  };
  f.onsubmit = e => { e.preventDefault(); const q = f.querySelector('#ai-q').value.trim(); if (q) { send(q); f.reset(); } };
  document.querySelectorAll('.uai .chip, .aipage .chip').forEach(c => c.onclick = () => send(c.dataset.q));
}
function viewAi() {
  app.innerHTML = `${crumbs([['首頁', '#/'], ['AI 助教']])}<div class="card aipage">${aiPanel(null)}<div class="chips">${['什麼是 Yaw', '3S 是幾伏', '換相是什麼', '陀螺儀量什麼', '足球怎麼得分', '迴圈'].map(q => `<button class="chip" data-q="${q}">${q}</button>`).join('')}</div></div>`;
  bindAi();
}

// ---------- 實驗室 ----------
function viewLabs() {
  app.innerHTML = `${crumbs([['首頁', '#/'], ['3D 科學實驗室']])}<h2>3D 科學實驗室</h2>
  <div class="cards">${LABS.map(L => { const r = store.me()?.labs?.[L.id]; return `<a class="lcard" href="#/lab/${L.id}"><div class="flask">⚗</div><b>${esc(L.name)}</b><small>${esc(L.desc)}</small><span class="row"><small>${r?.completed ? '✓ 已完成' : r ? `已操作 ${r.runs} 次` : '尚未開始'}</small><span class="btn small">開始實驗</span></span></a>`; }).join('')}
  <a class="lcard" href="#/soccer"><div class="flask">⚽</div><b>無人機足球 3D 訓練場</b><small>戰術編排、六種任務、USB 遙控器。</small><span class="row"><small></small><span class="btn small">進入</span></span></a></div>`;
}
async function viewLab(id, q) {
  const L = LABS.find(x => x.id === id); if (!L || !LAB_LOADERS[id]) return viewNotFound();
  const unitId = +(q.get('unit') || L.unit);
  app.innerHTML = `<div class="labbar"><div><b>⚗ ${esc(L.name)}</b><small>虛擬實驗室・互動演示</small></div><div class="sc-row"><button class="btn ghost small" id="lb-reset">↺ 重新開始</button><button class="btn ghost small" id="lb-full">⛶ 全螢幕</button><a class="btn small" href="#/unit/${unitId}/lab">← 返回課程</a></div></div><p class="state" id="lb-st"></p><div id="labhost" class="labhost"></div>`;
  const host = document.getElementById('labhost');
  const ctx = {
    input, log: (t, d) => { ctx._ops = (ctx._ops || 0) + 1; },
    task: () => store.markStep(unitId, 'task'),
    done: r => { store.markStep(unitId, 'lab'); store.saveLab(id, { ...r, ops: ctx._ops || 0 }); const s = document.getElementById('lb-st'); if (s) { s.className = 'state ok'; s.textContent = store.me() ? '實驗完成！已保存紀錄。' : '實驗完成！（未登入，紀錄不會保存）'; } }
  };
  try {
    const mod = await LAB_LOADERS[id]();
    cleanup = mod.mount(host, ctx);
  } catch (e) { host.innerHTML = `<div class="card"><p class="state over">實驗載入失敗：${esc(e.message)}</p><p class="small">請重新整理頁面；若仍失敗，可能是這台裝置不支援 WebGL（3D 繪圖），請改用電腦或較新的瀏覽器。</p></div>`; }
  document.getElementById('lb-reset').onclick = () => { ctx.onReset?.(); const s = document.getElementById('lb-st'); s.className = 'state'; s.textContent = ''; };
  document.getElementById('lb-full').onclick = () => (host.requestFullscreen?.() || host.webkitRequestFullscreen?.());
}

// ---------- 足球 ----------
async function viewSoccer(mode, q) {
  const unitId = +(q.get('unit') || 10);
  app.innerHTML = `<div class="labbar"><div><b>⚽ 無人機足球 3D 專項訓練</b><small>Drone Soccer 3D Training Lab・教學級模擬</small></div><div class="sc-row"><button class="btn ghost small" id="lb-full">⛶ 全螢幕</button><a class="btn small" href="#/unit/${unitId}/lab">← 返回課程</a></div></div><div id="labhost" class="labhost"></div>`;
  const host = document.getElementById('labhost');
  try {
    const mod = await import('./soccer/soccer.js');
    cleanup = mod.mount(host, {
      input, startMode: mode || 'free',
      saveRun: r => store.saveSoccer(r),
      done: r => { if (r.ok) { store.markStep(unitId, 'task'); store.markStep(unitId, 'lab'); } },
      openRc: () => rcDialog()
    });
  } catch (e) { host.innerHTML = `<div class="card"><p class="state over">訓練場載入失敗：${esc(e.message)}</p><p class="small">需要支援 WebGL 的瀏覽器。</p></div>`; }
  document.getElementById('lb-full').onclick = () => (host.requestFullscreen?.() || host.webkitRequestFullscreen?.());
}

// ---------- 遙控器設定（校準、通道映射、死區、即時輸入）----------
function rcDialog() {
  const d = document.getElementById('dlg'); const map = loadMap(); let cal = map.cal || {}; let capturing = false, raf;
  d.innerHTML = `<div class="card rc"><h3>遙控器設定</h3>
    <p class="small muted">支援瀏覽器 Gamepad API 可辨識的 USB 遙控器／手把（HID）。只控制網頁模擬器，<b>不會、也不可用來控制實體無人機</b>。</p>
    <p id="rc-st" class="state"></p>
    <div class="rc-axes" id="rc-axes"></div>
    <div class="rc-map">${['throttle', 'yaw', 'pitch', 'roll'].map(ch => `<label>${({ throttle: '油門', yaw: '偏航', pitch: '俯仰', roll: '橫滾' })[ch]} 軸 <select data-ch="${ch}">${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<option ${map[ch].axis === i ? 'selected' : ''}>${i}</option>`).join('')}</select> <label class="sw"><input type="checkbox" data-inv="${ch}" ${map[ch].invert ? 'checked' : ''}>反向</label></label>`).join('')}</div>
    <label class="rng">死區 <b id="rc-dz-v">${map.deadzone}</b><input type="range" id="rc-dz" min="0" max="0.3" step="0.01" value="${map.deadzone}"></label>
    <div class="sc-row"><button class="btn ghost small" id="rc-cal">開始校準（把搖桿繞滿圈）</button><button class="btn ghost small" id="rc-ctr">搖桿放中間後記錄中心</button><button class="btn ghost small" id="rc-def">恢復預設</button></div>
    <p class="small muted">緊急停止：按鈕 ${map.estopButton}（或鍵盤空白鍵、畫面紅色按鈕）。</p>
    <div class="sc-row"><button class="btn" id="rc-save">儲存</button><button class="btn ghost" id="rc-close">關閉</button></div></div>`;
  d.showModal();
  const tick = () => {
    const gp = input.rawPad(); const st = d.querySelector('#rc-st');
    if (!gp) { st.className = 'state over'; st.textContent = '未偵測到遙控器。請插上 USB 後「按任一按鈕或撥動搖桿」，瀏覽器才會回報。'; d.querySelector('#rc-axes').innerHTML = ''; }
    else {
      st.className = 'state ok'; st.textContent = `已連接：${gp.id.slice(0, 60)}（${gp.axes.length} 軸、${gp.buttons.length} 鍵）`;
      if (capturing) cal = input.calibrateCapture(cal);
      d.querySelector('#rc-axes').innerHTML = gp.axes.map((v, i) => `<div><span>軸 ${i}</span><i><b style="left:${(v + 1) * 50}%"></b></i><small>${v.toFixed(2)}</small></div>`).join('');
      const r = input.read(); d.querySelector('#rc-axes').insertAdjacentHTML('beforeend', `<p class="small">換算後：油門 ${r.throttle.toFixed(2)}、偏航 ${r.yaw.toFixed(2)}、俯仰 ${r.pitch.toFixed(2)}、橫滾 ${r.roll.toFixed(2)}</p>`);
    }
    if (d.open) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  d.querySelector('#rc-dz').oninput = e => { d.querySelector('#rc-dz-v').textContent = e.target.value; };
  d.querySelector('#rc-cal').onclick = e => { capturing = !capturing; e.target.textContent = capturing ? '結束校準' : '開始校準（把搖桿繞滿圈）'; };
  d.querySelector('#rc-ctr').onclick = () => { cal = input.calibrateCenter(cal); };
  d.querySelector('#rc-def').onclick = () => { saveMap(DEFAULT_MAP); input.map = loadMap(); d.close(); rcDialog(); };
  d.querySelector('#rc-close').onclick = () => d.close();
  d.querySelector('#rc-save').onclick = () => {
    const m = { ...map, deadzone: +d.querySelector('#rc-dz').value, cal };
    d.querySelectorAll('[data-ch]').forEach(s => { m[s.dataset.ch] = { axis: +s.value, invert: d.querySelector(`[data-inv="${s.dataset.ch}"]`).checked }; });
    saveMap(m); input.map = loadMap(); d.close();
  };
  d.addEventListener('close', () => cancelAnimationFrame(raf), { once: true });
}

// ---------- 我的學習 ----------
function viewMe() {
  const m = store.me();
  if (!m) { app.innerHTML = `${crumbs([['首頁', '#/'], ['我的學習']])}<div class="card"><p>登入後即可查看學習進度。</p><button class="btn" id="lg">學員登入</button></div>`; document.getElementById('lg').onclick = () => loginDialog(route); return; }
  const soccer = m.soccer.slice(-10).reverse();
  app.innerHTML = `${crumbs([['首頁', '#/'], ['我的學習']])}<h2>${esc(m.nick)} 的學習歷程 <small class="muted">班級 ${esc(m.cls)}</small></h2>
  <section class="card"><h3>單元進度</h3><table class="tbl"><tr><th>單元</th><th>進度</th><th>測驗最高分</th></tr>${UNITS.map(u => { const p = store.unitProgress(u.id); return `<tr><td><a href="#/unit/${u.id}">${u.code} ${esc(u.title)}</a></td><td>${progressBadge(u)}</td><td>${p.best ?? '—'}</td></tr>`; }).join('')}</table></section>
  <section class="card"><h3>實驗紀錄</h3><ul>${LABS.map(L => { const r = m.labs[L.id]; return `<li>${esc(L.name)}：${r ? `${r.completed ? '✓ 已完成' : '進行中'}（${r.runs} 次）` : '尚未開始'}</li>`; }).join('')}</ul></section>
  <section class="card"><h3>足球訓練紀錄（最近 10 次）</h3>${soccer.length ? `<table class="tbl"><tr><th>時間</th><th>任務</th><th>結果</th><th>用時</th><th>得分</th></tr>${soccer.map(s => `<tr><td>${new Date(s.t).toLocaleString('zh-TW')}</td><td>${esc(s.modeName)}</td><td>${s.ok ? '完成' : '未完成'}</td><td>${s.seconds} 秒</td><td>${s.score ?? 0}</td></tr>`).join('')}</table>` : '<p class="muted">還沒有紀錄。</p>'}</section>
  <section class="card"><h3>學習成果報告</h3><p class="small">下載後交給老師（只含暱稱與班級代碼）。</p><button class="btn" id="dl">下載學習報告（JSON）</button></section>`;
  document.getElementById('dl').onclick = () => {
    const blob = new Blob([JSON.stringify(store.exportReport(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `學習報告_${m.cls}_${m.nick}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}

// ---------- 教師專區（本機版）----------
function viewTeacher(sel) {
  const d = store.teacherData(); const codes = Object.keys(d.classes); sel = sel && d.classes[sel] ? sel : codes[0];
  const c = sel ? d.classes[sel] : null;
  app.innerHTML = `${crumbs([['首頁', '#/'], ['教師專區']])}<h2>教師專區 <small class="muted">本機版</small></h2>
  <p class="state">目前為「本機版」：班級與學生報告只存在這台電腦的瀏覽器。正式接上 FDE-AI 教師後台（帳號、班級權限、伺服器保存）需要後端開發與授權，尚未完成。</p>
  <div class="unit two">
    <aside class="card"><h3>班級</h3><ul class="part-list">${codes.map(k => `<li class="${k === sel ? 'sel' : ''}"><a href="#/teacher/${k}">${esc(k)}・${esc(d.classes[k].name)}（${Object.keys(d.classes[k].students).length} 人）</a></li>`).join('') || '<li>尚無班級</li>'}</ul>
      <form id="tc-new" class="stack"><input name="c" maxlength="16" placeholder="班級代碼，例 FDE-A1" required><input name="n" maxlength="30" placeholder="班級名稱"><button class="btn small">建立班級</button></form></aside>
    <section class="card">${c ? `<h3>${esc(sel)}・${esc(c.name)}</h3>
      <h4>指派單元</h4><div class="chips">${UNITS.map(u => `<label class="chip"><input type="checkbox" data-u="${u.id}" ${c.assigned.includes(u.id) ? 'checked' : ''}> ${u.code}</label>`).join('')}</div>
      <h4>匯入學生學習報告</h4><input type="file" id="tc-file" accept="application/json,.json" multiple><p class="small" id="tc-msg"></p>
      <h4>學生成績</h4>${Object.keys(c.students).length ? `<div class="scroll"><table class="tbl"><tr><th>暱稱</th>${UNITS.map(u => `<th title="${esc(u.title)}">${u.code}</th>`).join('')}<th>實驗完成</th><th>足球完成</th><th>專題</th></tr>${Object.entries(c.students).map(([n, s]) => `<tr><td>${esc(n)}</td>${UNITS.map(u => { const x = s.units?.[u.id]; const done = x ? Object.keys(x.steps || {}).length : 0; return `<td class="${c.assigned.includes(u.id) && done < 5 ? 'warn' : ''}">${x?.best ?? '—'}<small>${done}/5</small></td>`; }).join('')}<td>${Object.values(s.labs || {}).filter(l => l.completed).length}/6</td><td>${(s.soccer || []).filter(r => r.ok).length}</td><td>${(s.projects || []).length ? `<button class="link" data-pj="${esc(n)}">批改（${s.projects.length}）</button>` : '—'}</td></tr>`).join('')}</table></div>` : '<p class="muted">尚未匯入報告。</p>'}
      <div class="sc-row"><button class="btn ghost small" id="tc-csv">匯出班級成績 CSV</button></div><div id="tc-pj"></div>` : '<p>先在左側建立班級。</p>'}</section>
  </div>`;
  document.getElementById('tc-new').onsubmit = e => { e.preventDefault(); try { store.teacherCreateClass(e.target.c.value, e.target.n.value); location.hash = `#/teacher/${e.target.c.value.toUpperCase()}`; } catch (err) { alert(err.message); } };
  if (!c) return;
  app.querySelectorAll('[data-u]').forEach(cb => cb.onchange = () => { const dd = store.teacherData(); const a = dd.classes[sel].assigned; const id = +cb.dataset.u; cb.checked ? a.push(id) : a.splice(a.indexOf(id), 1); store.teacherSave(dd); });
  document.getElementById('tc-file').onchange = async e => {
    const msg = []; for (const f of e.target.files) { try { const r = store.teacherImport(JSON.parse(await f.text()), sel); msg.push(`✓ ${r.nick}`); } catch (err) { msg.push(`✗ ${f.name}：${err.message}`); } }
    document.getElementById('tc-msg').textContent = msg.join('　'); setTimeout(() => viewTeacher(sel), 1200);
  };
  document.getElementById('tc-csv').onclick = () => {
    const rows = [['暱稱', ...UNITS.map(u => `${u.code}最高分`), '實驗完成數', '足球任務完成數']];
    for (const [n, s] of Object.entries(c.students)) rows.push([n, ...UNITS.map(u => s.units?.[u.id]?.best ?? ''), Object.values(s.labs || {}).filter(l => l.completed).length, (s.soccer || []).filter(r => r.ok).length]);
    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `班級成績_${sel}.csv`; a.click();
  };
  app.querySelectorAll('[data-pj]').forEach(b => b.onclick = () => {
    const s = store.teacherData().classes[sel].students[b.dataset.pj];
    document.getElementById('tc-pj').innerHTML = `<h4>${esc(b.dataset.pj)} 的專題</h4>${s.projects.map((p, i) => `<div class="card"><b>${esc(p.title)}</b><p class="small">假設：${esc(p.hypothesis)}</p><table class="tbl">${p.rows.map(r => `<tr><td>${esc(r.name)}</td>${r.vals.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table><p class="small">結論：${esc(p.conclusion)}</p><label class="pair">評分 <select data-g="${i}">${['', 'A 優秀', 'B 良好', 'C 待加強'].map(g => `<option ${p.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label></div>`).join('')}`;
    document.querySelectorAll('[data-g]').forEach(g => g.onchange = () => { const dd = store.teacherData(); dd.classes[sel].students[b.dataset.pj].projects[+g.dataset.g].grade = g.value; store.teacherSave(dd); });
  });
}

function viewNotFound() { app.innerHTML = `<div class="card"><h2>找不到這個頁面</h2><a class="btn" href="#/">回首頁</a></div>`; }

// ---------- 路由 ----------
function route() {
  try { cleanup?.(); } catch { /* 略 */ } cleanup = null;
  input.virtualActive = false; input.estop = false;
  const [path, qs] = location.hash.replace(/^#/, '').split('?');
  const q = new URLSearchParams(qs || ''); const p = path.split('/').filter(Boolean);
  document.querySelectorAll('.topnav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === `#/${p[0] || ''}`));
  window.scrollTo(0, 0);
  switch (p[0]) {
    case undefined: return viewHome();
    case 'courses': return viewCourses(p[1]);
    case 'unit': return viewUnit(p[1], p[2]);
    case 'labs': return viewLabs();
    case 'lab': return viewLab(p[1], q);
    case 'soccer': return viewSoccer(p[1], q);
    case 'me': return viewMe();
    case 'teacher': return viewTeacher(p[1]);
    case 'ai': return viewAi();
    case 'rc': viewHome(); return rcDialog();
    default: return viewNotFound();
  }
}
window.addEventListener('hashchange', route);
who(); route();
