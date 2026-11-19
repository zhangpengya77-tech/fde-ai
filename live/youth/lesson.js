// V1.2 單課頁：四步線性推進（訓練任務 → 三維演示 → 考核標準 → 訓練技巧 → 本課完成）
// 版面對標參考影片的單課頁：左「本課學習路徑」＋中間標題／3D 演示／時間軸／播放列＋右「當前動作」「觀察與站位」。
// 手機直式：同樣區塊依原順序上下堆疊；學習路徑改成 4 格橫向步驟條；底部固定「上一步／下一步」。
// 只對標版面與流程，不使用參考產品的品牌、圖片、模型與教材。
import * as store from './core/store.js';

const STEPS = store.LESSON_STEPS;            // ['task','demo','criteria','tips']
const SHORT = { task: '任務', demo: '演示', criteria: '標準', tips: '技巧' };
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const isTouch = () => matchMedia('(pointer:coarse)').matches;
const teach = () => document.body.classList.contains('teach');

/**
 * 顯示單課頁。deps：{ app, esc, units, aiPanel, bindAi, loginDialog, setCleanup }
 */
export async function viewLesson(spec, stepArg, deps) {
  const { app, esc } = deps;
  const L = store.lesson(spec.unitId);
  const idxOf = s => STEPS.indexOf(s);
  // 沒指定步驟：回到上次的位置；指定了未到的步驟：鎖住，回到目前可到的步驟（教師全屏授課例外）
  let step = stepArg || L.step;
  if (step !== 'done' && idxOf(step) < 0) step = L.step;
  if (!teach()) {
    if (step === 'done' && !L.done) step = L.step;
    if (step !== 'done' && idxOf(step) > L.reached) step = STEPS[L.reached];
  }
  if (location.hash !== `#/unit/${spec.unitId}/${step}`) history.replaceState(null, '', `#/unit/${spec.unitId}/${step}`);
  L.step = step === 'done' ? L.step : step; store.saveLessonState();
  document.body.classList.add('lesson-mode');

  const i = idxOf(step);
  const sub = step === 'done' ? null : spec.steps[step];
  const m = store.me();
  const unitDoneLab = !!m?.units?.[spec.unitId]?.steps?.lab;

  // ---------- 外框 ----------
  app.innerHTML = `
  <header class="ls-top">
    <a class="ls-back" href="#/courses" aria-label="返回課程中心">←<span> 返回</span></a>
    <span class="logo sm">FDE</span>
    <div class="ls-title"><b>${esc(spec.code)} ${esc(spec.title)}</b><small>課程中心 / ${esc(spec.title)} / ${esc(spec.subtitle)}</small></div>
    <span class="ls-kind">${esc(spec.kind)}</span>
    <button class="ls-icon" id="ls-user" title="${m ? esc(m.cls + '・' + m.nick) : '學員登入'}" aria-label="${m ? '學員：' + esc(m.nick) : '學員登入'}">${m ? '👤' : '🔑'}</button>
    <button class="btn small ls-teach" id="ls-teach" aria-pressed="${teach()}">${teach() ? '結束授課' : '全屏授課'}</button>
  </header>
  <div class="ls-tools"><button class="btn ghost small" id="ls-restart">↺ 重新開始</button><button class="btn ghost small" id="ls-full">⛶ 全屏實驗</button><a class="btn small" href="#/courses">← 返回</a></div>
  <div class="ls ${step === 'demo' ? 'has-right' : ''}">
    <aside class="ls-path" aria-label="本課學習路徑">
      <p class="ls-path-h">本課學習路徑</p>
      <ol class="ls-steps">${STEPS.map((s, k) => {
        const st = spec.steps[s]; const done = k < L.reached || (k === L.reached && L.done) || (L.done);
        const cur = s === step, locked = k > L.reached && !teach();
        return `<li class="${cur ? 'cur' : ''} ${done && !cur ? 'done' : ''} ${locked ? 'locked' : ''}">${locked ? `<span class="ls-step" aria-disabled="true"><b>0${k + 1}</b><span><em>${st.title}</em><small>${st.sub}</small></span><i>🔒</i><u>${SHORT[s]}</u></span>` : `<a class="ls-step" href="#/unit/${spec.unitId}/${s}"><b>0${k + 1}</b><span><em>${st.title}</em><small>${st.sub}</small></span><i>${done && !cur ? '✓' : ''}</i><u>${SHORT[s]}</u></a>`}</li>`;
      }).join('')}</ol>
      <span class="ls-pageno-m">${step === 'done' ? '完成' : `0${i + 1} / 04`}</span>
      ${summaryCard(spec, 'ls-sum-d')}
    </aside>
    <section class="ls-main" id="ls-main"></section>
    ${step === 'demo' ? '<aside class="ls-right" id="ls-right"></aside>' : ''}
    ${summaryCard(spec, 'ls-sum-m')}
  </div>
  <p class="ls-review">${spec.reviewedBy ? '' : '教材審稿中・'}所有 3D 實驗與足球訓練皆為教學模擬，實機操作請依老師指導。</p>
  ${step === 'done' ? '' : `<nav class="ls-nav" aria-label="上一步與下一步">
    <button class="btn ghost" id="ls-prev" ${i === 0 ? 'disabled' : ''}>上一步</button>
    <span class="ls-why" id="ls-why" aria-live="polite"></span>
    <button class="btn" id="ls-next">${step === 'tips' ? '本課完成 ✓' : '下一步 →'}</button>
  </nav>`}
  <button class="ls-ai-fab" id="ls-ai-fab" aria-label="開啟 AI 學習助教">助教</button>
  <div class="ls-sheet" id="ls-sheet" hidden><div class="ls-sheet-in card"><button class="ls-sheet-x" id="ls-sheet-x" aria-label="關閉">×</button>${deps.aiPanel(deps.unit)}</div></div>`;
  deps.bindAi();

  const $ = s => app.querySelector(s);
  const main = $('#ls-main');
  const head = (eyebrow, title, headline) => `<div class="ls-head"><p class="ls-eyebrow">${eyebrow} <span>/ ${title}</span></p><span class="ls-pageno">0${i + 1} / 04</span><h1>${esc(headline)}</h1></div>`;

  // 頂部按鈕
  $('#ls-user').onclick = () => { if (!m) deps.loginDialog(() => viewLesson(spec, step, deps)); else location.hash = '#/me'; };
  $('#ls-teach').onclick = async () => {
    const on = !teach(); document.body.classList.toggle('teach', on);
    try { sessionStorage.setItem('fde-youth-teach', on ? '1' : '0'); } catch { /* 略 */ }
    try { if (on) { await document.documentElement.requestFullscreen?.(); await screen.orientation?.lock?.('landscape'); } else if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* 部分瀏覽器不支援，忽略 */ }
    viewLesson(spec, step, deps);
  };
  $('#ls-restart').onclick = () => { if (confirm('重新開始本課？會清除本課的步驟進度（測驗最高分保留）。')) { Object.assign(L, { step: 'task', reached: 0, cards: [], demoDone: false, demoT: 0, done: false, quiz: { ...L.quiz, last: null } }); store.saveLessonState(); location.hash = `#/unit/${spec.unitId}/task`; } };
  $('#ls-full').onclick = async () => { const el = $('#ls-stage') || main; try { await el.requestFullscreen?.(); await screen.orientation?.lock?.('landscape'); } catch { /* 忽略 */ } };
  const sheet = $('#ls-sheet');
  $('#ls-ai-fab').onclick = () => { sheet.hidden = false; };
  $('#ls-sheet-x').onclick = () => { sheet.hidden = true; };
  sheet.onclick = e => { if (e.target === sheet) sheet.hidden = true; };

  // 下一步可否按
  const refreshNav = () => {
    const nx = $('#ls-next'); if (!nx) return;
    const ok = teach() || store.stepComplete(L, step, spec);
    nx.disabled = !ok; nx.setAttribute('aria-disabled', String(!ok));
    $('#ls-why').textContent = ok ? '' : store.stepBlockReason(L, step, spec);
  };
  if ($('#ls-prev')) $('#ls-prev').onclick = () => { location.hash = `#/unit/${spec.unitId}/${STEPS[i - 1]}`; };
  if ($('#ls-next')) $('#ls-next').onclick = () => {
    if (!teach() && !store.stepComplete(L, step, spec)) return refreshNav();
    if (step === 'tips') {
      L.done = true; L.reached = 3; store.saveLessonState();
      ['read', 'widget'].forEach(s => store.markStep(spec.unitId, s));
      if (L.practiceDone || unitDoneLab) { store.markStep(spec.unitId, 'task'); store.markStep(spec.unitId, 'lab'); }
      location.hash = `#/unit/${spec.unitId}/done`; return;
    }
    L.reached = Math.max(L.reached, i + 1); L.step = STEPS[i + 1]; store.saveLessonState();
    if (step === 'task') store.markStep(spec.unitId, 'read');
    if (step === 'demo') store.markStep(spec.unitId, 'widget');
    location.hash = `#/unit/${spec.unitId}/${STEPS[i + 1]}`;
  };

  // ---------- 01 訓練任務：目標＋知識卡（一次一張、左右翻頁、小圓點）----------
  if (step === 'task') {
    // 回到本課時，從「還沒翻過的第一張」開始；全部翻過就從第一張開始
    let c = sub.cards.findIndex((_, n) => !L.cards.includes(n)); if (c < 0) c = 0;
    main.innerHTML = `${head(sub.eyebrow, sub.title, sub.headline)}
      <ol class="ls-obj">${sub.objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ol>
      <div class="ls-cards" id="ls-cards" aria-roledescription="輪播" aria-label="知識卡">
        <button class="ls-cnav" id="ls-cprev" aria-label="上一張">‹</button>
        <article class="ls-card" id="ls-card" aria-live="polite"></article>
        <button class="ls-cnav" id="ls-cnext" aria-label="下一張">›</button>
      </div>
      <div class="ls-dots" id="ls-dots"></div>`;
    const show = () => {
      const k = sub.cards[c];
      if (!L.cards.includes(c)) { L.cards.push(c); store.saveLessonState(); }
      $('#ls-card').innerHTML = `<small>知識卡 ${c + 1} / ${sub.cards.length}</small><h3>${esc(k.h)}</h3><p>${esc(k.p)}</p>`;
      $('#ls-dots').innerHTML = sub.cards.map((_, n) => `<button class="${n === c ? 'on' : ''} ${L.cards.includes(n) ? 'seen' : ''}" data-n="${n}" aria-label="第 ${n + 1} 張"></button>`).join('');
      $('#ls-cprev').disabled = c === 0; $('#ls-cnext').disabled = c === sub.cards.length - 1;
      refreshNav();
    };
    $('#ls-cprev').onclick = () => { c = Math.max(0, c - 1); show(); };
    $('#ls-cnext').onclick = () => { c = Math.min(sub.cards.length - 1, c + 1); show(); };
    $('#ls-dots').onclick = e => { const b = e.target.closest('button'); if (b) { c = +b.dataset.n; show(); } };
    // 左右滑動翻頁（手機）
    let sx = null; const cardsEl = $('#ls-cards');
    cardsEl.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    cardsEl.addEventListener('touchend', e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) { c = Math.max(0, Math.min(sub.cards.length - 1, c + (dx < 0 ? 1 : -1))); show(); } sx = null; });
    show();
  }

  // ---------- 02 三維演示：3D＋階段時間軸＋播放列；右側兩卡隨階段更新 ----------
  if (step === 'demo') {
    const D = sub;
    main.innerHTML = `${head(D.eyebrow, D.title, D.headline)}
      <div class="ls-stage card" id="ls-stage">
        <div class="ls-views" role="tablist">${D.views.map(([k, n]) => `<button data-v="${k}" class="${k === 'three' ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div class="ls-hud"><small>${esc(D.hudLabel || '相對起飛面高度')}</small><b id="ls-hud">—</b></div>
        <div class="ls-3d" id="ls-3d"></div>
        <p class="ls-tip">${(isTouch() ? D.tipsTouch : D.tips).map(esc).join('<br>')}</p>
        <div class="ls-overlay">
          <div class="ls-phases" id="ls-phases">${D.phases.map((p, k) => `<button data-k="${k}"><b>0${k + 1}</b> ${esc(p.label)}</button>`).join('')}</div>
          <div class="ls-play"><button class="btn" id="ls-pp">▶ 播放演示</button><button class="btn ghost" id="ls-rp" aria-label="重播">↺</button><input type="range" id="ls-sc" min="0" max="${D.durationSec}" step="0.1" value="${L.demoT}" aria-label="演示進度"><span id="ls-tm">0:00 / ${fmt(D.durationSec)}</span><button class="btn ghost" id="ls-sp" aria-label="播放速度">1×</button></div>
        </div>
      </div>`;
    $('#ls-right').innerHTML = `
      <div class="card ls-act"><p class="ls-cap">當前動作</p><h2 id="ls-an"></h2><p id="ls-ad"></p><span class="ls-status" id="ls-as"></span><p class="ls-timer"><span id="ls-at"></span></p></div>
      <div class="card ls-obs"><p class="ls-cap">觀察與站位</p>
        <dl>${D.observe.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        <ul class="ls-legend">${D.observe.legend.map(([c, t]) => `<li><i class="lg-${c}"></i>${esc(t)}</li>`).join('')}</ul>
        <p class="ls-cap">達標範圍</p><ul class="ls-pass">${D.observe.pass.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>`;
    let scene = null;
    try {
      if (D.scene === 'u09-hover') { const mod = await import('./labs/scene-u09.js'); scene = mod.createU09Scene($('#ls-3d'), D); }
      else if (['u01-parts', 'u02-safety', 'u04-motor', 'u05-battery'].includes(D.scene)) { const mod = await import('./labs/scenes-r1.js'); scene = mod.createScene(D.scene, $('#ls-3d'), D); }
      else { const mod = await import('./labs/scenes-r2.js'); scene = mod.createScene(D.scene, $('#ls-3d'), D); }
    }
    catch (e) { $('#ls-3d').innerHTML = `<p class="state over">3D 載入失敗：${esc(e.message)}</p>`; }
    let t = Math.min(L.demoT || 0, D.durationSec), playing = false, speed = 1, raf = 0, last = 0, saveAcc = 0;
    const SPEEDS = [1, 2, 4, 6];
    const paint = () => {
      const s = scene ? scene.setTime(t) : {};
      const phaseNo = D.phases.reduce((a, p, k) => t >= p.t ? k : a, 0);
      s.phase ??= phaseNo;
      const ph = D.phases[s.phase], a = ph.action, el = t - ph.t;
      $('#ls-hud').textContent = s.hud ?? `${(s.y ?? 0).toFixed(2)} m`;
      $('#ls-tm').textContent = `${fmt(t)} / ${fmt(D.durationSec)}`; $('#ls-sc').value = t;
      app.querySelectorAll('#ls-phases button').forEach((b, k) => { b.classList.toggle('on', k === s.phase); b.classList.toggle('past', k < s.phase); });
      $('#ls-an').textContent = a.name; $('#ls-ad').textContent = a.desc; $('#ls-as').textContent = a.status;
      $('#ls-at').textContent = `${fmt(Math.max(0, Math.min(el, a.target)))} / ${fmt(a.target)}`;
    };
    const setPlaying = p => { playing = p; $('#ls-pp').textContent = p ? '❚❚ 暫停演示' : (t >= D.durationSec ? '▶ 再看一次' : '▶ 播放演示'); };
    const tick = now => {
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      if (playing) {
        t += dt * speed; saveAcc += dt;
        if (t >= D.durationSec) { t = D.durationSec; setPlaying(false); if (!L.demoDone) { L.demoDone = true; refreshNav(); } }
        if (saveAcc > 1 || !playing) { L.demoT = t; store.saveLessonState(); saveAcc = 0; }
        paint();
      }
      raf = requestAnimationFrame(tick);
    };
    $('#ls-pp').onclick = () => { if (t >= D.durationSec) t = 0; setPlaying(!playing); last = performance.now(); };
    $('#ls-rp').onclick = () => { t = 0; L.demoT = 0; setPlaying(true); paint(); };
    $('#ls-sp').onclick = () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; $('#ls-sp').textContent = `${speed}×`; };
    $('#ls-sc').oninput = e => { t = +e.target.value; L.demoT = t; store.saveLessonState(); paint(); };
    $('#ls-phases').onclick = e => { const b = e.target.closest('button'); if (!b) return; t = D.phases[+b.dataset.k].t; L.demoT = t; store.saveLessonState(); paint(); };
    app.querySelectorAll('.ls-views button').forEach(b => b.onclick = () => {
      scene?.setView(b.dataset.v);
      app.querySelectorAll('.ls-views button').forEach(x => x.classList.toggle('on', x === b || (b.dataset.v === 'reset' && x.dataset.v === 'three')));
    });
    paint(); refreshNav(); last = performance.now(); raf = requestAnimationFrame(tick);
    deps.setCleanup(() => { cancelAnimationFrame(raf); L.demoT = t; store.saveLessonState(); scene?.dispose(); });
  }

  // ---------- 03 考核標準：達標數據＋隨堂測驗（題庫抽 5 題）----------
  if (step === 'criteria') {
    const C = sub;
    const pickQuiz = () => {
      const idx = C.quiz.map((_, k) => k);
      for (let k = idx.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [idx[k], idx[j]] = [idx[j], idx[k]]; }
      return idx.slice(0, C.quizPick).sort((a, b) => a - b);
    };
    let picked = L.quiz.picked || pickQuiz(); L.quiz.picked = picked; store.saveLessonState();
    const render = (result) => {
      main.innerHTML = `${head(C.eyebrow, C.title, C.headline)}
        <div class="ls-big">${C.items.map(it => `<div class="card"><b>${esc(it.big)}<small> ${esc(it.small)}</small></b><span>${esc(it.label)}</span></div>`).join('')}</div>
        <div class="card ls-rules"><p class="ls-cap">完整動作要求</p><ol>${C.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ol><p class="ls-judge">${esc(C.judge)}</p></div>
        <div class="card ls-quiz"><p class="ls-cap">隨堂測驗（${picked.length} 題，60 分通過，可重做）${L.quiz.best != null ? `　最高分 ${L.quiz.best}・已作答 ${L.quiz.attempts} 次` : ''}</p>
          <form id="ls-qz">${picked.map((qi, n) => { const q = C.quiz[qi]; return `<fieldset class="${result ? (result.wrong.includes(n) ? 'bad' : 'good') : ''}"><legend>${n + 1}. ${esc(q.q)}</legend>${q.options.map((o, j) => `<label class="opt"><input type="radio" name="q${n}" value="${j}" ${result && result.ans[n] === j ? 'checked' : ''} ${result ? 'disabled' : ''}> ${esc(o)}</label>`).join('')}${result && result.wrong.includes(n) ? `<p class="small ls-exp">${esc(q.explain)}</p>` : ''}</fieldset>`; }).join('')}
          ${result ? `<div class="ls-score ${result.pct >= 60 ? 'ok' : 'bad'}"><b>${result.pct} 分</b> ${result.pct >= 60 ? '通過！可以按「下一步」。' : '未達 60 分，看完解析後可以重做。'}</div><button type="button" class="btn ghost" id="ls-redo">重新作答（換題）</button>` : '<button class="btn">交卷</button>'}</form></div>`;
      if (result) { $('#ls-redo').onclick = () => { picked = pickQuiz(); L.quiz.picked = picked; store.saveLessonState(); render(null); }; }
      else $('#ls-qz').onsubmit = e => {
        e.preventDefault();
        const ans = picked.map((_, n) => { const r = e.target.querySelector(`input[name=q${n}]:checked`); return r ? +r.value : -1; });
        if (ans.includes(-1)) { $('#ls-why').textContent = '還有題目沒作答'; return; }
        const wrong = ans.map((a, n) => a === C.quiz[picked[n]].answer ? -1 : n).filter(n => n >= 0);
        const pct = Math.round((picked.length - wrong.length) / picked.length * 100);
        L.quiz.attempts++; L.quiz.last = pct; L.quiz.best = Math.max(L.quiz.best ?? 0, pct); store.saveLessonState();
        if (m) store.saveQuiz(spec.unitId, picked.length - wrong.length, picked.length, wrong);
        render({ ans, wrong, pct }); refreshNav();
      };
    };
    render(null); refreshNav();
  }

  // ---------- 04 訓練技巧：技巧＋常見錯誤＋開始實作 ----------
  if (step === 'tips') {
    const T = sub; const practiced = L.practiceDone || unitDoneLab;
    if (practiced && !L.practiceDone) { L.practiceDone = true; store.saveLessonState(); }
    main.innerHTML = `${head(T.eyebrow, T.title, T.headline)}
      <div class="ls-tipgrid">${T.tips.map((tp, k) => `<div class="card"><span class="ls-num">0${k + 1}</span><h3>${esc(tp.h)}</h3><p>${esc(tp.p)}</p></div>`).join('')}</div>
      <div class="card ls-mis"><p class="ls-cap">常見錯誤</p><ul>${T.mistakes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="card ls-prac"><div><p class="ls-cap">實作任務</p><p>${esc(T.practice.task)}</p>${practiced ? '<p class="state ok">實作已完成 ✓</p>' : ''}</div><a class="btn" href="${T.practice.href}">${esc(T.practice.label)} →</a></div>`;
    refreshNav();
  }

  // ---------- 本課完成頁 ----------
  if (step === 'done') {
    const nu = deps.units.find(u => u.id === spec.next);
    main.innerHTML = `<div class="ls-head"><p class="ls-eyebrow">COMPLETE <span>/ 本課完成</span></p><h1>恭喜完成 ${esc(spec.code)} ${esc(spec.title)}</h1></div>
      <div class="ls-big"><div class="card"><b>${L.quiz.best ?? '—'}<small> 分</small></b><span>測驗最高分（${L.quiz.attempts} 次）</span></div><div class="card"><b>${(L.practiceDone || unitDoneLab) ? '完成' : '未做'}</b><span>實作任務</span></div></div>
      ${summaryCard(spec, 'ls-sum-done')}
      ${m ? '' : '<p class="state">目前未登入：進度只存在這台裝置的訪客紀錄。登入後新的成績才會出現在「我的學習」。</p>'}
      ${nu ? `<a class="btn ls-nextunit" href="#/unit/${nu.id}">下一課：${esc(nu.code)} ${esc(nu.title)} →</a>` : ''}
      <p><a href="#/unit/${spec.unitId}/task">回看本課</a></p>`;
  }
}

function summaryCard(spec, cls) {
  return `<div class="ls-sum ${cls}"><b>${spec.summary.motto}</b>${spec.summary.lines.map(l => `<span>${l}</span>`).join('')}</div>`;
}
