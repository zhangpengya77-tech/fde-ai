// F450 實訓中心｜教學／練習／考核三種模式與成績單（P5）
// 教學：一步一步提示（下一件零件、正確接口），錯誤即時說明。
// 練習：現在的做法；成績單即時更新，可以一直重來。
// 考核：清空重做、不給提示、不能自行檢查；按「交卷」後鎖定並顯示分數。
// 分數目前是「試行分數」：規則待實機核對，不計正式成績。P6：登入後可存入練習紀錄（records.js），老師在後台查看。
import { CATEGORIES, scoreSession } from './scoring.js?v=p5-1';
import { emit, on, latest } from './bus.js?v=p4-1';
import { buildPayload, recordStatus, saveRecord } from './records.js?v=p6-1';   // P6：成績存到練習紀錄

const MODES = [
  ['teach', '教學', '一步一步提示下一件零件與正確接口；錯誤會即時說明。'],
  ['practice', '練習', '自己做，可以隨時檢查、重來；下方成績單即時更新。'],
  ['exam', '考核', '從頭開始、不給提示、不能自行檢查；完成 3D 組裝與 2D 接線後按「交卷」。'],
];

export function initSession(root) {
  if (!root) return null;
  let mode = 'practice', locked = false, examStart = 0, timer = null, final = null, modeStart = Date.now(), saveMsg = null, status = null;
  let assembly = latest('assembly') || null, wires = latest('wires2d')?.wires || [];
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };

  root.replaceChildren();
  const head = el('div', null, 'row between');
  const seg = el('div', null, 'ts-modes'); seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', '實訓模式');
  const btns = MODES.map(([id, zh]) => { const b = el('button', zh); b.type = 'button'; b.dataset.trainMode = id; b.setAttribute('role', 'radio'); b.onclick = () => setMode(id); seg.append(b); return b; });
  head.append(el('b', '實訓模式與成績單'), seg);
  const desc = el('p', null, 'note ts-desc');
  const exam = el('div', null, 'ts-exam');
  const clock = el('span', null, 'ts-clock');
  const bSubmit = el('button', '交卷', 'primary'); bSubmit.type = 'button';
  const bRetry = el('button', '重新考一次'); bRetry.type = 'button';
  exam.append(clock, bSubmit, bRetry);
  const card = el('div', null, 'ts-card');
  // P6：保存列（登入狀態、保存按鈕、結果）
  const saveRow = el('div', null, 'ts-save'); saveRow.setAttribute('aria-live', 'polite');
  const saveText = el('span'); const bSave = el('button', '保存這次成績到練習紀錄'); bSave.type = 'button';
  saveRow.append(saveText, bSave);
  root.append(head, desc, exam, card, saveRow,
    el('p', '分數為試行分數：組裝順序與接線規則依 DJI 手冊、Pixhawk 公開文件與教師安裝指導整理，全部待實機核對。登入後可存入你的練習紀錄供老師查看，但不計正式成績。', 'note'));

  // ───────── 模式切換 ─────────
  function setMode(next) {
    if (next === mode && !(next === 'exam' && locked)) return;
    if (next === 'exam' && !confirm('進入考核會從頭開始：3D 組裝與 2D 接線都清空重做（練習的進度會先保留，離開考核後還原）。要開始嗎？')) return;
    if (mode === 'exam' && next !== 'exam' && !locked && !confirm('考核還沒交卷，離開會放棄這次考核。確定嗎？')) return;
    mode = next; locked = false; final = null; modeStart = Date.now(); saveMsg = null;
    clearInterval(timer); timer = null;
    if (mode === 'exam') { examStart = Date.now(); timer = setInterval(tick, 1000); }
    emit('examLock', { locked: false });
    emit('trainMode', { mode });
    render();
  }
  bSubmit.onclick = () => {
    const r = scoreSession(assembly, wires);
    const miss = [!r.assemblyDone && '3D 組裝還沒完成', wires.length === 0 && '2D 還沒有接任何線'].filter(Boolean);
    if (!confirm(`${miss.length ? `注意：${miss.join('、')}。\n` : ''}交卷後就不能再修改，確定交卷嗎？`)) return;
    locked = true; final = { ...r, seconds: Math.round((Date.now() - examStart) / 1000) };
    clearInterval(timer); timer = null;
    emit('examLock', { locked: true });
    render();
    save(final, final.seconds);   // 考核交卷後自動保存
  };
  bRetry.onclick = () => { mode = 'practice'; setMode('exam'); };
  function tick() { const s = Math.round((Date.now() - examStart) / 1000); clock.textContent = `考核計時 ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

  on('assembly', (d) => { assembly = d; if (!locked) render(); });
  on('wires2d', (d) => { wires = d?.wires || []; if (!locked) render(); });

  // ───────── 保存（P6） ─────────
  const counts = () => ({
    installed: Object.values(assembly?.parts || {}).filter((p) => p.status === 'installed').length,
    errors: (assembly?.log || []).length,
  });
  async function save(result, seconds) {
    bSave.disabled = true; saveMsg = { text: '正在保存…' }; renderSave();
    const c = counts(), wiringErrors = result.wiring.issues.filter((i) => i.code !== 'MISSING').length;   // 錯誤次數＝組裝錯誤＋接線錯誤
    const r = await saveRecord(buildPayload(result, { trainMode: mode, seconds, installed: c.installed, errors: Math.min(999, c.errors + wiringErrors) }));
    saveMsg = r.saved ? { text: '✓ 已存入你的練習紀錄（試行分數）', link: [r.recordsUrl, '查看紀錄'], ok: true }
      : r.reason === 'login' ? { text: '登入學員帳號後才能保存成績。', link: [r.loginUrl, '登入'] }
      : r.reason === 'unavailable' ? { text: '這個網站版本沒有連到教學主機，成績不會保存；請到教學網站登入後練習。' }
      : { text: `沒有保存：${r.message}` };
    bSave.disabled = false; renderSave();
  }
  bSave.onclick = () => save(scoreSession(assembly, wires), (Date.now() - modeStart) / 1000);
  function renderSave() {
    bSave.hidden = mode === 'exam';
    saveText.replaceChildren();
    const m = saveMsg || (status === null ? { text: '正在確認登入狀態…' }
      : !status.available ? { text: '這個網站版本沒有連到教學主機，成績不會保存。' }
      : status.loggedIn ? { text: `已登入：${status.nickname}。${mode === 'exam' ? '交卷後會自動保存成績。' : '按右邊按鈕保存目前成績。'}` }
      : { text: '登入學員帳號後可以保存成績。', link: [status.loginUrl, '登入'] });
    saveText.append(document.createTextNode(m.text));
    if (m.link) { const a = el('a', m.link[1]); a.href = m.link[0]; a.target = '_blank'; a.rel = 'noopener'; saveText.append(' ', a); }
    saveRow.classList.toggle('ok', !!m.ok);
    if (status && (!status.available || !status.loggedIn)) bSave.hidden = true;
  }
  recordStatus().then((st) => { status = st; renderSave(); });

  // ───────── 成績單 ─────────
  function render() {
    renderSave();
    btns.forEach((b) => { const on = b.dataset.trainMode === mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    desc.textContent = MODES.find(([id]) => id === mode)[2];
    exam.hidden = mode !== 'exam';
    bSubmit.hidden = locked; bRetry.hidden = !locked;
    if (mode === 'exam') tick();
    card.replaceChildren();
    if (mode === 'exam' && !locked) {
      card.append(el('p', '考核進行中：分數在交卷後才顯示。請到上方完成「3D 組裝練習」，到下方完成「2D 接線練習」。', 'ts-wait'));
      return;
    }
    const r = locked ? final : scoreSession(assembly, wires);
    const top = el('div', null, 'ts-total');
    top.append(el('b', `${r.total}`), el('span', ' / 100'), el('span', locked ? `　考核結果（用時 ${Math.floor(final.seconds / 60)} 分 ${final.seconds % 60} 秒）` : '　目前分數（即時）', 'note'));
    if (r.practiceOnly) top.append(el('span', '試行分數，不計正式成績', 'tag pending'));
    card.append(top);
    const grid = el('div', null, 'ts-cats');
    for (const c of r.categories) {
      const row = el('div', null, 'ts-cat');
      const bar = el('div', null, 'ts-bar'); const fill = el('i'); fill.style.width = `${(c.score / c.max) * 100}%`; bar.append(fill);
      row.append(el('span', c.zh, 'ts-name'), bar, el('span', `${c.score} / ${c.max}`, 'ts-pts'));
      grid.append(row);
      if (c.deductions.length || c.items.some((x) => !x.ok)) {
        const more = el('details', null, 'ts-more'); more.append(el('summary', `${c.zh}：失分 ${c.lost} 分的原因`));
        const ul = el('ul');
        c.deductions.forEach((d) => ul.append(el('li', `扣 ${d.pts} 分｜${d.reason}：${d.detail}`)));
        const missing = c.items.filter((x) => !x.ok);
        if (missing.length) ul.append(el('li', `未完成 ${missing.length} 項（${missing.slice(0, 4).map((x) => x.label).join('、')}${missing.length > 4 ? '…' : ''}）`));
        more.append(ul); grid.append(more);
      }
    }
    card.append(grid);
  }
  render();
  emit('trainMode', { mode });
  return { get mode() { return mode; }, setMode };
}

// 頁面入口
const box = document.getElementById('train-session');
if (box) {
  const api = initSession(box);
  const want = new URLSearchParams(location.search).get('trainMode');   // 截圖與驗收用
  if (want === 'teach') api.setMode('teach');
}
