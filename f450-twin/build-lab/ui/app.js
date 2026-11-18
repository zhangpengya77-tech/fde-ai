// 組裝實訓室｜頁面主程式：把組裝引擎（規則）、3D 場景（畫面）與介面（零件庫、操作列、步驟清單）接起來。
// 判斷能不能裝、裝對沒有，一律由 core/assembly-engine.js 決定；這裡只負責顯示與轉達操作。
import { BUILD_LAB_FLAGS } from '../build-lab-flags.js';
import { MODELS, CATEGORIES, pickModel } from '../data/models.js';
import { createAssemblyEngine, ERR } from '../core/assembly-engine.js';
import { saveLocal, loadLocal, clearLocal, exportFile, readFile } from '../core/storage.js';
// P2：接線
import { createWiringEngine, wiringPreconditions } from '../core/wiring-engine.js';
import { SEVERITY_ZH } from '../core/wiring-rules.js';
import { createWiringView } from './wiring-view.js';
// P4：計分、本機紀錄、AI 講解
import { computeScore } from '../core/scoring.js';
import { SCORING_RULES } from '../data/scoring-rules.js';
import { addRecord, listRecords, clearRecords, recordsToCsv } from '../core/records.js';
import { partQuestion, wiringErrorQuestion, askAI } from '../core/ai-explain.js';

const $ = (id) => document.getElementById(id);
/** 放進 innerHTML 的文字一律跳脫（紀錄、匯入檔都可能被改過） */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// P3：依網址 ?model= 選機型（f450-pixhawk248／fpv5-225），預設 F450
const MODEL_ID = pickModel(location.search);
const CFG = MODELS[MODEL_ID];
const model = CFG.model;
const engine = createAssemblyEngine(model, { mode: 'learn' });
const nameOf = (id) => engine.part(id)?.nameZh || id;
const MODE_ZH = { learn: '學習', free: '自由組裝', exam: '考試' };
const wiring = createWiringEngine(CFG.wiring, CFG.board, CFG.points, CFG.fits);
const isProp = (id) => engine.part(id)?.shape.type === 'prop';
/** 組裝＋接線一起存（本機），不含任何個資 */
// 這一回合（從開始／重置到完成）的資訊：開始時間、是否已寫入紀錄
let session = { startedAt: Date.now(), recorded: false };
const serializeAll = () => ({ ...engine.serialize(), wiring: wiring.serialize(), session: { ...session } });
/** 清空進度並開始新的一回合（重置、進入考試時使用） */
function resetAll(mode) {
  clearLocal(model.modelId);
  engine.restore({ kind: 'fde-build-lab-progress', modelId: model.modelId, mode, installed: [], errors: [] });
  wiring.reset();
  session = { startedAt: Date.now(), recorded: false };
  if ($('bl-wpanel')) $('bl-wpanel').hidden = true;
  afterChange('all');
}
const elapsedMs = () => Date.now() - session.startedAt;
const saveAll = () => saveLocal(model.modelId, serializeAll());

let scene = null;
let selected = null;
let category = 'all';
let keyword = '';
let thumbs = new Map();
let explode = false;
let hideInstalled = false;

// ───────── 提示訊息 ─────────
let toastTimer = 0;
function toast(text, kind = '') {
  const t = $('bl-toast');
  t.textContent = text;
  t.className = `bl-toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'bl-toast'; }, 2600);
}

/** 把引擎的錯誤結果轉成白話中文 */
function explain(result, id) {
  const exam = engine.mode === 'exam';
  switch (result.code) {
    case ERR.MISSING_DEPENDENCY:
      return exam ? `「${nameOf(id)}」現在還不能裝。` : `要先裝好：${result.missing.map(nameOf).join('、')}`;
    case ERR.POSITION:
      return exam ? '位置不對，再試一次。' : `位置不對（差約 ${Math.round(result.distance)} mm），請對準淺藍色虛影。`;
    case ERR.HAS_DEPENDENTS:
      return `要先拆下：${result.blockers.map(nameOf).join('、')}`;
    case ERR.ALREADY_INSTALLED: return '這個零件已經裝好了。';
    case ERR.NOT_INSTALLED: return '這個零件還沒安裝。';
    default: return '無法執行這個動作。';
  }
}

// ───────── 安裝／拆下（統一經過這裡，成功後更新畫面與自動儲存） ─────────
function afterChange(animateIds = []) {
  scene?.setInstalled(engine.installed, animateIds);
  updateWires3d();   // 拆掉零件時 3D 線束也跟著更新
  saveAll();
  render();
  if (engine.progress.done === engine.progress.total) showDone();
}
function tryInstall(id, placedPos) {
  // 槳葉最後裝：接線完成前不能裝槳
  if (isProp(id) && !wiring.complete && !engine.isInstalled(id)) {
    scene?.returnToTray(id);
    toast('槳葉要最後裝：請先按「接線模式」完成全部接線與檢查。接線、測試時一律不裝槳。', 'err');
    return { ok: false, code: 'WIRING_FIRST' };
  }
  const r = engine.install(id, placedPos);
  if (r.ok) {
    afterChange(placedPos ? [] : [id]);
    scene?.flash(id);
    const safety = engine.part(id).safety;
    toast(`已安裝：${nameOf(id)}${safety && engine.mode !== 'exam' ? `　⚠ ${safety}` : ''}`, 'ok');
  } else {
    scene?.returnToTray(id);
    toast(explain(r, id), 'err');
    render();
  }
  return r;
}
function tryUninstall(id) {
  const r = engine.uninstall(id);
  if (r.ok) { afterChange([id]); toast(`已拆下：${nameOf(id)}`); } else { toast(explain(r, id), 'err'); render(); }
}

// ───────── 選取零件 ─────────
function select(id, { focus = false } = {}) {
  selected = id;
  scene?.select(id);
  if (focus && id) scene?.focus(id);
  render();
}

// ───────── 畫面更新 ─────────
function statusOf(id) {
  if (engine.isInstalled(id)) return { cls: 'is-installed', text: '已安裝' };
  const c = engine.canInstall(id);
  if (c.ok) return { cls: '', text: '可以安裝' };
  return { cls: '', text: engine.mode === 'exam' ? '未安裝' : `需先裝 ${c.missing.length} 件` };
}

function renderLibrary() {
  const list = $('bl-list');
  const next = engine.mode === 'learn' ? engine.nextSuggested() : null;
  const kw = keyword.trim().toLowerCase();
  const visible = model.parts.filter((p) => (category === 'all' || p.category === category)
    && (!kw || `${p.nameZh} ${p.model}`.toLowerCase().includes(kw)));
  $('bl-lib-count').textContent = `（${engine.progress.done}／${engine.progress.total} 已安裝）`;
  list.replaceChildren();
  for (const cat of CATEGORIES.filter((c) => c.key !== 'all')) {
    const items = visible.filter((p) => p.category === cat.key);
    if (!items.length) continue;
    const head = document.createElement('div');
    head.className = 'bl-group-title';
    head.innerHTML = `<span>${cat.zh}</span><span>${items.length}</span>`;
    list.append(head);
    for (const p of items) {
      const st = statusOf(p.partId);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `bl-card ${st.cls}${p.partId === next ? ' is-next' : ''}${p.partId === selected ? ' is-selected' : ''}`;
      card.dataset.part = p.partId;
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;   // 不讓瀏覽器把縮圖當成「拖曳圖片」，否則會吃掉拖放事件
      if (thumbs.has(p.partId)) img.src = thumbs.get(p.partId);
      const txt = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = p.nameZh;
      const small = document.createElement('small');
      small.textContent = p.partId === next ? '下一個建議安裝' : st.text;
      txt.append(b, small);
      card.append(img, txt);
      list.append(card);
    }
  }
  if (!visible.length) list.textContent = '找不到符合的零件。';
}

function renderSteps() {
  const ol = $('bl-steplist');
  const next = engine.mode === 'exam' ? null : engine.nextSuggested();
  ol.replaceChildren(...model.order.map((id) => {
    const li = document.createElement('li');
    li.textContent = nameOf(id);
    li.dataset.part = id;
    if (engine.isInstalled(id)) li.className = 'done';
    else if (id === next) li.className = 'next';
    return li;
  }));
}

function renderInfo() {
  const box = $('bl-info');
  const p = selected && engine.part(selected);
  if (!p) { box.hidden = true; return; }
  box.hidden = false;
  const d = p.dimensionsMm;
  const src = p.source || {};
  box.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = p.nameZh;
  const desc = document.createElement('p');
  desc.textContent = engine.mode === 'exam' ? '' : p.desc;
  const dl = document.createElement('dl');
  const row = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); };
  row('型號', p.model);
  row('尺寸', `${d.x} × ${d.y} × ${d.z} mm`);
  row('狀態', engine.isInstalled(p.partId) ? '已安裝' : '未安裝');
  const badge = document.createElement('span');
  badge.className = 'bl-badge';
  badge.textContent = src.status || '待確認';
  const srcLine = document.createElement('p');
  srcLine.className = 'bl-muted';
  srcLine.append('資料來源：', badge, ` ${src.title || ''}`);
  box.append(h, desc, dl, srcLine);
  if (p.safety) {
    const s = document.createElement('p');
    s.className = 'bl-safety';
    s.textContent = `⚠ 安全提醒：${p.safety}`;
    box.append(s);
  }
  if (engine.mode === 'exam') return;   // 考試模式不提供教學卡與 AI
  // 教學卡：怎麼裝（由資料自動產生，不需要 AI）
  const teach = document.createElement('ol');
  teach.className = 'bl-teach';
  const deps = (p.dependsOn || []).map(nameOf);
  const lines = [
    deps.length ? `先確認這些零件已裝好：${deps.join('、')}。` : '這是第一個要裝的零件。',
    `在 3D 中把「${p.nameZh}」拖到淺藍色虛影的位置（誤差 ${model.snapToleranceMm} mm 以內才算對），或按「安裝此件」。`,
    p.shape.type === 'prop' ? '槳葉一定最後裝；裝之前要完成全部接線與檢查。' : '裝好後在右邊步驟清單會打勾。',
  ];
  teach.replaceChildren(...lines.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
  const th = document.createElement('h4');
  th.textContent = '怎麼裝';
  const aiBtn = document.createElement('button');
  aiBtn.type = 'button';
  aiBtn.textContent = '🤖 AI 講解這個零件';
  const aiOut = document.createElement('div');
  aiOut.className = 'bl-ai';
  aiBtn.addEventListener('click', () => explainWithAI(aiOut, partQuestion(model.nameZh, p), p.desc));
  box.append(th, teach, aiBtn, aiOut);
}

/** 呼叫 AI 講解；失敗時顯示內建說明。AI 只解釋，不改變任何判定。 */
async function explainWithAI(out, question, fallbackZh) {
  out.textContent = 'AI 正在整理說明…';
  const r = await askAI(question);
  out.replaceChildren();
  const tag = document.createElement('small');
  tag.textContent = r.ok ? 'AI 講解（FDE 知識庫，僅供參考；對錯以規則判定為準）' : '知識庫暫時無法回答，以下為內建說明：';
  const p = document.createElement('p');
  p.textContent = r.ok ? r.answer : fallbackZh;
  out.append(tag, p);
}

function renderHint() {
  const hint = $('bl-hint');
  if (engine.progress.done === engine.progress.total) { hint.textContent = '全部零件都裝好了。'; scene?.setGhost(null); return; }
  if (engine.mode === 'exam') { hint.textContent = '考試模式：不提供提示，請依正確順序完成組裝與接線。'; scene?.setGhost(null); return; }
  if (wiringPreconditions(engine).ok && !wiring.complete) { hint.textContent = '零件（槳葉除外）都裝好了。下一步：按下方「接線模式」開始接線；槳葉最後才裝。'; scene?.setGhost(null); return; }
  const target = selected && !engine.isInstalled(selected) ? selected : (engine.mode === 'learn' ? engine.nextSuggested() : null);
  scene?.setGhost(target);
  if (!target) { hint.textContent = '自由組裝：選一個零件，拖到淺藍色虛影位置。'; return; }
  const c = engine.canInstall(target);
  hint.textContent = c.ok
    ? `${engine.mode === 'learn' ? '下一步：' : ''}把「${nameOf(target)}」拖到淺藍色虛影位置，或按「下一步安裝」看示範。`
    : `「${nameOf(target)}」要先裝好：${c.missing.map(nameOf).join('、')}`;
}

function render() {
  const { done, total } = engine.progress;
  $('bl-step').textContent = `第 ${Math.min(done + 1, total)} 步／共 ${total} 步（已裝 ${done} 件）`;
  $('bl-bar').style.width = `${(done / total) * 100}%`;
  for (const b of document.querySelectorAll('[data-mode]')) {
    b.classList.toggle('on', b.dataset.mode === engine.mode);
    b.setAttribute('aria-selected', String(b.dataset.mode === engine.mode));
  }
  const exam = engine.mode === 'exam';
  $('bl-next').disabled = exam || !engine.nextSuggested();
  $('bl-all').disabled = exam || done === total;
  $('bl-prev').disabled = !done;
  $('bl-undo').disabled = !engine.canUndo;
  $('bl-redo').disabled = !engine.canRedo;
  $('bl-install').disabled = !selected || engine.isInstalled(selected);
  $('bl-remove').disabled = !selected || !engine.isInstalled(selected);
  $('bl-zoom').disabled = !selected;
  $('bl-disasm').disabled = !done;
  renderLibrary();
  renderSteps();
  renderInfo();
  renderHint();
}

// ───────── 完成畫面 ─────────
function showDone() {
  const dlg = $('bl-done');
  if (dlg.open) return;
  const errs = engine.errors;
  const byCode = {};
  for (const e of errs) byCode[e.code] = (byCode[e.code] || 0) + 1;
  const label = { [ERR.MISSING_DEPENDENCY]: '順序錯誤（前面零件未裝）', [ERR.POSITION]: '位置錯誤', [ERR.HAS_DEPENDENTS]: '拆卸順序錯誤' };
  const secs = Math.round(elapsedMs() / 1000);
  const result = computeScore({
    assemblyErrors: engine.errors, wiringErrors: wiring.errors,
    assemblyComplete: engine.progress.done === engine.progress.total, wiringComplete: wiring.complete,
  }, SCORING_RULES);
  if (!session.recorded) {
    addRecord({
      finishedAt: new Date().toISOString(), modelId: model.modelId, modelNameZh: model.nameZh, mode: engine.mode, modeZh: MODE_ZH[engine.mode],
      score: result.score, pass: result.pass, assemblyErrors: engine.errors.length, wiringErrors: wiring.errors.length,
      elapsedMs: elapsedMs(), rulesVersion: result.rulesVersion, reviewStatus: result.review.status, breakdown: result.breakdown,
      appVersion: BUILD_LAB_FLAGS.version,
    });
    session.recorded = true;
    saveAll();
  }
  const scoreRows = result.breakdown.map((x) => `<tr><td>${x.label}</td><td>${x.count} 次 × −${x.each}</td><td>−${x.total}</td></tr>`).join('') || '<tr><td colspan="3">沒有扣分</td></tr>';
  const rows = Object.entries(byCode).map(([k, n]) => `<tr><td>${esc(label[k] || k)}</td><td>${Number(n)} 次</td></tr>`).join('') || '<tr><td>沒有錯誤</td><td>—</td></tr>';
  dlg.querySelector('h2').textContent = engine.mode === 'exam' ? '考試結果（模擬成績）' : '組裝完成';
  $('bl-done-body').innerHTML = `
    <p class="bl-score ${result.pass ? 'pass' : 'fail'}">模擬成績 <b>${result.score}</b> 分｜${result.pass ? '及格（模擬）' : '未及格（模擬）'}｜${result.reasonZh}</p>
    <table><tbody>${scoreRows}</tbody></table>
    <p class="bl-muted">計分規則 ${result.rulesVersion}（${SCORING_RULES.status}，教師確認前僅供參考）；正式 PASS／NG 以教師覆核為準（狀態：待教師覆核）。</p>
    <p>模式：${MODE_ZH[engine.mode]}｜零件 ${engine.progress.total} 件全部安裝｜用時約 ${Math.floor(secs / 60)} 分 ${secs % 60} 秒</p>
    <table><tbody>${rows}</tbody></table>
    <p>接線：${wiring.progress.done}／${wiring.progress.total} 條${wiring.errors.length ? `，接線錯誤 ${wiring.errors.length} 次（${[...new Set(wiring.errors.map((e) => SEVERITY_ZH[e.severity]))].join('、')}）` : '，接線沒有錯誤'}</p>
    <p class="bl-muted">真機組裝後仍需老師實際檢查；參數只產生模擬報告，不寫入飛控。</p>`;
  dlg.showModal();
}

// ───────── 綁定介面事件 ─────────
function bindUi() {
  $('bl-model').textContent = model.nameZh;
  const sel = $('bl-model-select');
  sel.replaceChildren(...Object.entries(MODELS).map(([id, m]) => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = m.model.nameZh;
    o.selected = id === MODEL_ID;
    return o;
  }));
  sel.addEventListener('change', () => {
    const q = new URLSearchParams(location.search);
    q.set('model', sel.value);
    location.search = q.toString();
  });
  $('bl-version').textContent = `組裝實訓室 ${BUILD_LAB_FLAGS.version}｜${model.version}`;
  $('bl-cats').replaceChildren(...CATEGORIES.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = c.zh;
    b.dataset.cat = c.key;
    b.classList.toggle('on', c.key === category);
    return b;
  }));
  $('bl-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    category = b.dataset.cat;
    for (const x of $('bl-cats').children) x.classList.toggle('on', x === b);
    renderLibrary();
  });
  $('bl-search').addEventListener('input', (e) => { keyword = e.target.value; renderLibrary(); });

  // 零件卡片：點一下＝選取；按住拖動＝拖進 3D 安裝
  $('bl-list').addEventListener('dragstart', (e) => e.preventDefault());   // 停用瀏覽器原生拖曳
  $('bl-list').addEventListener('pointerdown', (e) => {
    const card = e.target.closest('[data-part]');
    if (!card) return;
    const id = card.dataset.part;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
      cleanup();
      if (!engine.isInstalled(id) && scene) {
        select(id);
        closeDrawers();
        scene.startExternalDrag(id, ev);
      }
    };
    const up = () => { cleanup(); select(id); };
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  $('bl-steplist').addEventListener('click', (e) => {
    const li = e.target.closest('[data-part]');
    if (li) select(li.dataset.part, { focus: true });
  });

  for (const b of document.querySelectorAll('[data-mode]')) {
    b.addEventListener('click', () => {
      const next = b.dataset.mode;
      if (next === engine.mode) return;
      if (next === 'exam') {
        const dirty = engine.installed.length || wiring.progress.done || engine.errors.length;
        if (dirty && !confirm('開始考試會清空目前的組裝與接線進度，並重新計時。確定開始考試嗎？')) return;
        resetAll('exam');
        toast('考試開始：不提供提示與 AI 講解，所有錯誤都會記錄。');
        return;
      }
      engine.setMode(next);
      saveAll();
      toast(`已切換到「${MODE_ZH[engine.mode]}」模式`);
      render();
    });
  }
  $('bl-next').addEventListener('click', () => {
    const id = engine.nextSuggested();
    if (id && isProp(id) && !wiring.complete) { openWiring(); return; }
    if (id) { select(id); tryInstall(id); }
  });
  $('bl-prev').addEventListener('click', () => {
    const last = engine.installed.at(-1);
    if (last) tryUninstall(last);
  });
  $('bl-undo').addEventListener('click', () => { const c = engine.undo(); if (c) afterChange(c.ids); });
  $('bl-redo').addEventListener('click', () => { const c = engine.redo(); if (c) afterChange(c.ids); });
  $('bl-install').addEventListener('click', () => selected && tryInstall(selected));
  $('bl-remove').addEventListener('click', () => selected && tryUninstall(selected));
  $('bl-zoom').addEventListener('click', () => selected && scene?.focus(selected));
  $('bl-all').addEventListener('click', () => { const r = engine.assembleAll(); if (r.ok) afterChange(r.ids); });
  $('bl-disasm').addEventListener('click', () => { const r = engine.disassembleAll(); if (r.ok) { afterChange(r.ids); toast('已全部拆解，可按「撤銷」還原'); } });
  $('bl-explode').addEventListener('click', (e) => {
    explode = !explode;
    e.currentTarget.setAttribute('aria-pressed', String(explode));
    scene?.setExploded(explode);
  });
  $('bl-hide').addEventListener('click', (e) => {
    hideInstalled = !hideInstalled;
    e.currentTarget.setAttribute('aria-pressed', String(hideInstalled));
    scene?.setHideInstalled(hideInstalled);
  });
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => scene?.view(b.dataset.view));
  $('bl-toggle-steps').addEventListener('click', () => {
    const side = $('bl-steps');
    if (matchMedia('(max-width: 819px)').matches) side.classList.toggle('open');
    else side.hidden = !side.hidden;
  });
  $('bl-export').addEventListener('click', () => exportFile(serializeAll(), BUILD_LAB_FLAGS.version));
  $('bl-done-export').addEventListener('click', () => exportFile(serializeAll(), BUILD_LAB_FLAGS.version));
  $('bl-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('檔案太大（超過 2 MB），不是組裝進度檔。', 'err'); return; }
    try {
      const data = await readFile(file);
      engine.restore(data);
      wiring.restore(data.wiring);
      afterChange('all');
      toast('已載入紀錄', 'ok');
    } catch {
      toast('這個檔案不是本機型的組裝紀錄，無法載入。', 'err');
    }
  });
  $('bl-reset').addEventListener('click', () => {
    if (!confirm('重置會拆掉所有零件並清除本機的進度與錯誤紀錄，確定嗎？')) return;
    resetAll(engine.mode);
    toast('已重置');
  });

  // 手機抽屜
  $('bl-open-lib').addEventListener('click', () => $('bl-lib').classList.add('open'));
  $('bl-open-steps').addEventListener('click', () => $('bl-steps').classList.add('open'));
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => $(b.dataset.close).classList.remove('open'));

  // 鍵盤快速鍵：Ctrl+Z 撤銷、Ctrl+Y 重做
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.target.matches('input')) return;
    if (e.key === 'z') { e.preventDefault(); $('bl-undo').click(); }
    if (e.key === 'y') { e.preventDefault(); $('bl-redo').click(); }
  });
}
// ───────── P2：接線模式 ─────────
let wview = null;
const WIRE_HEX = { power: '#d23b3b', signal: '#e0a800', data: '#1f6fd1', phase: '#6b7785' };
/** 3D 線束預覽：已接好的線畫成兩個零件之間的線（零件都裝著才畫） */
function updateWires3d() {
  scene?.setWires(wiring.connections.map((d) => {
    const s = wiring.steps.find((x) => x.id === d.stepId);
    return { from: s.fromPart, to: s.toPart, color: WIRE_HEX[s.wireType] };
  }).filter((w) => engine.isInstalled(w.from) && engine.isInstalled(w.to)));
}
function openWiring() {
  const pre = wiringPreconditions(engine);
  if (!pre.ok) {
    if (pre.propsOn.length) toast(`接線與測試前一定要先拆槳：請拆下 ${pre.propsOn.map(nameOf).join('、')}。`, 'err');
    else toast(`先完成組裝再接線：還差 ${pre.missing.length} 件（${pre.missing.slice(0, 3).map(nameOf).join('、')}${pre.missing.length > 3 ? '…' : ''}）。`, 'err');
    return;
  }
  if (!wview) {
    wview = 'loading';
    CFG.layout().then((layout) => {
      wview = createWiringView({ root: $('bl-wsvg-host'), wiring, layout, mode: () => engine.mode, onAttempt: (choice) => onWireAttempt(choice) });
      renderWiring();
    });
  }
  closeDrawers();
  $('bl-wpanel').hidden = false;
  $('bl-wresult').hidden = true;
  renderWiring();
}
function renderWiring() {
  const step = wiring.current;
  const { done, total } = wiring.progress;
  $('bl-wstep').textContent = step ? `接線 ${done + 1}／${total}` : `接線完成 ${total}／${total}`;
  $('bl-wtitle').textContent = step ? step.titleZh : '全部接線都通過檢查了。';
  $('bl-wexplain').textContent = step ? (engine.mode === 'exam' ? '考試模式：不提供說明。' : step.explainZh) : '可以查看「設定報告」，最後回到 3D 裝上槳葉。';
  $('bl-wundo').disabled = !done;
  $('bl-report').disabled = !wiring.complete;
  if (wview && wview !== 'loading') wview.render();
}
function showWireResult(r) {
  const box = $('bl-wresult');
  box.hidden = false;
  box.className = `bl-wresult ${r.severity}`;
  if (engine.mode === 'exam' && !r.ok) { box.textContent = '接錯了（已記錄），請再試一次。'; return; }
  box.textContent = r.ok ? `✓ ${r.messageZh}` : `✗ ${SEVERITY_ZH[r.severity]}：${r.messageZh}　正確做法：${r.fixZh}`;
  if (!r.ok) {
    const step = wiring.steps.find((x) => x.id === r.stepId);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bl-ai-btn';
    btn.textContent = '🤖 AI 解釋原理';
    const out = document.createElement('div');
    out.className = 'bl-ai';
    btn.addEventListener('click', () => explainWithAI(out, wiringErrorQuestion(model.nameZh, step, r), `${r.messageZh} ${r.fixZh}`));
    box.append(' ', btn, out);
  }
}
function onWireAttempt(choice) {
  const r = wiring.attempt(choice);
  showWireResult(r);
  saveAll();
  updateWires3d();
  renderWiring();
  if (r.ok && wiring.complete) {
    const issues = wiring.systemIssues();
    toast(issues.length ? `整機檢查發現問題：${issues.map((i) => i.messageZh).join('；')}` : '接線全部完成並通過整機檢查！最後回到 3D 裝上槳葉。', issues.length ? 'err' : 'ok');
    render();
  }
}
function showCases() {
  const cases = CFG.buildCases();
  $('bl-cases-body').replaceChildren(...cases.map((c, i) => {
    const r = c.run();
    const box = document.createElement('section');
    box.className = 'bl-case';
    const h = document.createElement('h3');
    h.textContent = `${i + 1}. ${c.titleZh} `;
    const sev = document.createElement('span');
    sev.className = `bl-sev ${r.severity}`;
    sev.textContent = `規則判定：${SEVERITY_ZH[r.severity]}（${r.code}）`;
    h.append(sev);
    const p = (label, text) => { const e = document.createElement('p'); const b = document.createElement('b'); b.textContent = label; e.append(b, text); return e; };
    box.append(h, p('錯誤做法：', c.wrongZh), p('系統判定：', r.messageZh), p('虛擬後果：', c.effectZh), p('正確做法：', r.fixZh));
    return box;
  }));
  $('bl-cases-dlg').showModal();
}
let lastReport = null;
function showReport() {
  lastReport = CFG.buildReport({ connections: wiring.connections.map((d) => d.stepId) });
  $('bl-report-title').textContent = CFG.reportTitle;
  const body = $('bl-report-body');
  body.className = 'bl-report';
  const rows = lastReport.rows.map((r) => `<tr><td><code>${r.name}</code></td><td>${r.value}</td><td>${r.meaningZh}<br><span class="bl-muted">${r.why}</span></td><td><span class="bl-badge">${r.source.status}</span></td></tr>`).join('');
  body.innerHTML = `<p class="bl-muted">${lastReport.firmwareNote}</p>
    <table><thead><tr><th>參數</th><th>值</th><th>意思／理由</th><th>狀態</th></tr></thead><tbody>${rows}</tbody></table>
    <h3>上線前檢查清單</h3><ol>${lastReport.checklist.map((c) => `<li>${c.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</li>`).join('')}</ol>`;
  $('bl-report-dlg').showModal();
}
function bindWiring() {
  $('bl-wiring').addEventListener('click', openWiring);
  $('bl-wback').addEventListener('click', () => { $('bl-wpanel').hidden = true; render(); });
  $('bl-wundo').addEventListener('click', () => {
    if (!wiring.undo()) return;
    saveAll(); updateWires3d(); renderWiring();
    $('bl-wresult').hidden = true;
  });
  $('bl-cases').addEventListener('click', showCases);
  $('bl-report').addEventListener('click', showReport);
  $('bl-report-dl').addEventListener('click', () => {
    if (!lastReport) return;
    const blob = new Blob([CFG.reportToText(lastReport, { version: BUILD_LAB_FLAGS.version })], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = CFG.reportFile;
    document.body.append(a); a.click(); a.remove();
  });
}

// ───────── P4：我的紀錄（本機） ─────────
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
}
function showRecords() {
  const list = listRecords();
  const body = $('bl-rec-body');
  if (!list.length) { body.textContent = '還沒有完成的紀錄。完成一次組裝與接線後會自動記錄。'; }
  else {
    const rows = [...list].reverse().map((r) => `<tr><td>${esc(String(r.finishedAt || '').replace('T', ' ').slice(0, 16))}</td><td>${esc(r.modelNameZh)}</td><td>${esc(r.modeZh)}</td><td>${Number(r.score) || 0}</td><td>${r.pass ? '是' : '否'}</td><td>${Number(r.assemblyErrors) || 0}／${Number(r.wiringErrors) || 0}</td><td>${Math.round((Number(r.elapsedMs) || 0) / 1000)}</td></tr>`).join('');
    body.innerHTML = `<table class="bl-rec"><thead><tr><th>完成時間</th><th>機型</th><th>模式</th><th>分數</th><th>及格</th><th>組裝／接線錯誤</th><th>秒</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  $('bl-rec-dlg').showModal();
}
function bindRecords() {
  $('bl-records').addEventListener('click', showRecords);
  $('bl-done-records').addEventListener('click', () => { $('bl-done').close(); showRecords(); });
  $('bl-rec-json').addEventListener('click', () => download('build-lab-紀錄.json', JSON.stringify({ kind: 'fde-build-lab-records', exportedAt: new Date().toISOString(), appVersion: BUILD_LAB_FLAGS.version, records: listRecords() }, null, 2), 'application/json'));
  $('bl-rec-csv').addEventListener('click', () => download('build-lab-紀錄.csv', recordsToCsv(listRecords()), 'text/csv;charset=utf-8'));
  $('bl-rec-clear').addEventListener('click', () => {
    if (!confirm('確定清除這台瀏覽器上的所有練習與考試紀錄嗎？清除後無法復原，建議先匯出。')) return;
    clearRecords();
    showRecords();
  });
}
// 考試計時：頁首顯示經過時間
setInterval(() => {
  const t = $('bl-timer');
  if (!t) return;
  if (engine.mode !== 'exam') { t.textContent = ''; return; }
  const sec = Math.floor(elapsedMs() / 1000);
  t.textContent = `考試中 ${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}, 1000);

function closeDrawers() { $('bl-lib').classList.remove('open'); $('bl-steps').classList.remove('open'); }

// ───────── 懸停說明浮層 ─────────
function onHover(id, x, y) {
  const tip = $('bl-tip');
  if (!id) { tip.hidden = true; return; }
  const p = engine.part(id);
  tip.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = p.nameZh;
  tip.append(b, engine.isInstalled(id) ? '已安裝（點一下看說明）' : '未安裝（按住拖到機體上）');
  tip.style.left = `${x + 14}px`;
  tip.style.top = `${y + 14}px`;
  tip.hidden = false;
}

// ───────── 啟動 ─────────
async function boot() {
  bindUi();
  bindWiring();
  bindRecords();
  const saved = loadLocal(model.modelId);
  if (saved) {
    try {
      engine.restore(saved);
      wiring.restore(saved.wiring);
      if (saved.session && Number.isFinite(saved.session.startedAt)) session = { startedAt: saved.session.startedAt, recorded: !!saved.session.recorded };
    } catch { /* 舊存檔壞掉就從頭開始 */ }
  }
  render();
  try {
    const { createScene } = await import('../core/scene.js');
    const lowPower = matchMedia('(pointer: coarse)').matches || innerWidth < 820 || new URLSearchParams(location.search).get('lite') === '1';
    scene = createScene($('bl-viewer'), model, { lowPower });
    scene.on('hover', onHover);
    scene.on('pick', (id) => select(id));
    scene.on('drop', (id, pos) => tryInstall(id, pos));
    scene.setInstalled(engine.installed);
    updateWires3d();
    thumbs = scene.thumbnails();
    $('bl-loading').hidden = true;
    render();
    if (saved?.installed?.length) toast(`已恢復上次進度（${engine.progress.done} 件）`);
  } catch (err) {
    $('bl-loading').textContent = '這台裝置無法顯示 3D 場景（需要 WebGL）。零件庫與步驟清單仍可閱讀。';
    console.error(err);
  }
}
boot();
