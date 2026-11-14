// F450 實訓中心｜2D 接線畫布（P3）
// 原生 SVG，不依賴 3D／WebGL。元件、接口、檢查規則全部來自 model.js（與 3D 組裝共用）。
// 操作：點一個接口、再點另一個接口 → 連線；點線 → 選取，可刪除或「紅黑對調」；按「檢查接線」看結果。
// 草稿只存在這台裝置的瀏覽器（localStorage）；不記錄成績（P5／P6 才接判分與任務卡）。
import { COMPONENTS, PORTS, EXPECTED_WIRES, PRACTICE_ONLY, validateWiring } from './model.js?v=p4-1';
import { emit, on } from './bus.js?v=p4-1';   // P4：與 3D 同步

const NS = 'http://www.w3.org/2000/svg';
const STORE = 'f450twin-wire2d-v1';
const W = 1000, H = 720, PAD = 64;   // 畫布座標（俯視示意，非實際尺寸）

// 版面：x, y, 寬, 高, 各接口放在哪一邊（top／bottom／left／right）
const LAYOUT = {
  motor_fl: [20, 20, 130, 56, { 'motor_fl.phase': 'bottom' }],
  esc_fl: [20, 130, 150, 96, { 'esc_fl.phase': 'top', 'esc_fl.power': 'bottom', 'esc_fl.signal': 'right' }],
  motor_fr: [850, 20, 130, 56, { 'motor_fr.phase': 'bottom' }],
  esc_fr: [830, 130, 150, 96, { 'esc_fr.phase': 'top', 'esc_fr.power': 'bottom', 'esc_fr.signal': 'left' }],
  esc_rl: [20, 474, 150, 96, { 'esc_rl.power': 'top', 'esc_rl.phase': 'bottom', 'esc_rl.signal': 'right' }],
  motor_rl: [20, 624, 130, 56, { 'motor_rl.phase': 'top' }],
  esc_rr: [830, 474, 150, 96, { 'esc_rr.power': 'top', 'esc_rr.phase': 'bottom', 'esc_rr.signal': 'left' }],
  motor_rr: [850, 624, 130, 56, { 'motor_rr.phase': 'top' }],
  receiver: [300, 30, 170, 64, { 'receiver.sbus': 'bottom' }],
  gps: [520, 30, 190, 64, { 'gps.serial': 'bottom', 'gps.compass': 'right' }],
  pixhawk: [300, 168, 400, 214, {
    'pixhawk.main_out_1': 'left', 'pixhawk.main_out_2': 'left', 'pixhawk.main_out_3': 'left', 'pixhawk.main_out_4': 'left', 'pixhawk.rc_in': 'top',
    'pixhawk.gps': 'top', 'pixhawk.i2c': 'top', 'pixhawk.switch': 'right', 'pixhawk.buzzer': 'right', 'pixhawk.power': 'bottom',
  }],
  safety_switch: [790, 250, 130, 50, { 'safety_switch.conn': 'left' }],
  buzzer: [790, 330, 130, 50, { 'buzzer.conn': 'left' }],
  pdb: [300, 448, 400, 92, { 'pdb.pad_fl': 'left', 'pdb.pad_rl': 'left', 'pdb.pad_fr': 'right', 'pdb.pad_rr': 'right', 'pdb.in': 'bottom' }],
  power_module: [440, 610, 220, 80, { 'power_module.in': 'left', 'power_module.out': 'top', 'power_module.fc': 'right' }],
  battery: [190, 630, 150, 60, { 'battery.xt60': 'top' }],
};
const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const KIND_COLOR = { power: '#ff6a4d', signal: '#3fd0ff', data: '#7ee8c8' };
const roleKind = (role) => (role.startsWith('power') ? 'power' : role.startsWith('signal') ? 'signal' : 'data');

// 每個接口的座標與朝外方向
const PORT_POS = {};
for (const [cid, [x, y, w, h, sides]] of Object.entries(LAYOUT)) {
  const bySide = {};
  for (const [pid, side] of Object.entries(sides)) (bySide[side] ||= []).push(pid);
  for (const [side, list] of Object.entries(bySide)) {
    list.forEach((pid, i) => {
      const t = (i + 1) / (list.length + 1);
      const px = side === 'left' ? x : side === 'right' ? x + w : x + w * t;
      const py = side === 'top' ? y : side === 'bottom' ? y + h : y + h * t;
      PORT_POS[pid] = { x: px, y: py, n: SIDE_N[side], side, cid };
    });
  }
}

export function initWiringCanvas(root) {
  if (!root) return null;
  let compFocus = null, from3d = [], show3d = false, lastFocusKey = '', lastWiresKey = '';   // P4 同步狀態
  let wires = load(), pending = null, selected = null, result = null, showHints = false, seq = wires.reduce((m, w) => Math.max(m, Number(String(w.id).slice(1)) || 0), 0);
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  const sv = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

  // ───────── 面板骨架 ─────────
  root.replaceChildren();
  const head = el('div', null, 'row between');
  const tools = el('span', null, 'w2-tools');
  const B = (text, cls) => { const b = el('button', text, cls); b.type = 'button'; tools.append(b, ' '); return b; };
  const bCheck = B('✓ 檢查接線', 'primary'), bSwap = B('紅黑對調'), bDel = B('刪除這條線'), bUndo = B('復原'), bClear = B('全部清除');
  head.append(el('b', '2D 接線練習'), tools);
  const syncRow = el('div', null, 'row w2-sync');
  const lab3d = el('label', null, 'inline'); const cb3d = el('input'); cb3d.type = 'checkbox'; cb3d.id = 'w2-show3d';
  lab3d.append(cb3d, document.createTextNode(' 在 3D 顯示我的接線'));
  const bTo3d = el('button', '到 3D 畫面看 ↑'); bTo3d.type = 'button';
  bTo3d.onclick = () => document.getElementById('viewer')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  syncRow.append(lab3d, bTo3d, el('span', '點元件、接口或線，3D 會同步高亮對應零件', 'note'));
  cb3d.onchange = () => { show3d = cb3d.checked; draw(); };
  const status = el('p', null, 'w2-status'); status.setAttribute('aria-live', 'polite');
  const scroller = el('div', null, 'w2-scroll');
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w2-svg', role: 'application', 'aria-label': 'F450 接線畫布：先選一個接口，再選另一個接口連線' });
  scroller.append(svg);
  const legend = el('p', null, 'note w2-legend');
  legend.append(...[['power', '電源'], ['signal', '訊號'], ['data', '資料／周邊']].map(([k, t]) => { const s = el('span', `━ ${t}`); s.style.color = KIND_COLOR[k]; return s; }),
    el('span', '｜虛線＝紅黑接反｜示意版面，不是實際尺寸與腳位'));
  const results = el('div', null, 'w2-results');
  root.append(head, syncRow, status, scroller, legend, results,
    el('p', '操作：點一個接口（圓點）→ 再點要接的另一個接口，就會連線；點線可選取，再按「刪除這條線」或「紅黑對調」。鍵盤：Tab 移到接口、Enter 選取、Esc 取消。', 'note'),
    el('p', PRACTICE_ONLY ? '練習模式：接線規則依 Pixhawk 1／2.4.8 公開文件與教師安裝指導整理，全部待實機核對；不提供腳位定義，結果不記錄、不計正式成績。實際接線前務必先拆槳，並對照實機外殼印字。' : '', 'note'));

  const gWires = sv('g', { class: 'w2-wires' }), gComps = sv('g'), gPreview = sv('path', { class: 'w2-preview', d: '' });
  svg.append(gWires, gComps, gPreview);

  // ───────── 元件與接口 ─────────
  const portEls = {};
  for (const c of COMPONENTS) {
    const [x, y, w, h] = LAYOUT[c.id];
    const g = sv('g', { class: 'w2-comp', 'data-comp': c.id });
    const rect = sv('rect', { x, y, width: w, height: h, rx: 10 }); g.append(rect);
    g.addEventListener('click', (e) => { e.stopPropagation(); pending = null; selected = null; compFocus = c.id; say(`已選元件：${c.zh}`); draw(); });   // 點框或名稱都算（接口自己會攔下點擊）
    const t = sv('text', { x: x + w / 2, y: y + h / 2 + 6, 'text-anchor': 'middle', class: 'w2-name' }); t.textContent = c.zh; g.append(t);   // 名稱置中；接口標籤都放在框外，避免重疊
    for (const p of c.ports) {
      const pos = PORT_POS[p.id];
      const pg = sv('g', { class: `w2-port ${roleKind(p.role)}`, 'data-port': p.id, tabindex: 0, role: 'button', 'aria-label': `${c.zh} ${p.label}` });
      pg.append(sv('circle', { cx: pos.x, cy: pos.y, r: 9 }));
      const lx = pos.x + pos.n[0] * 15, ly = pos.y + (pos.side === 'top' ? -15 : pos.side === 'bottom' ? 25 : -6);
      const lt = sv('text', { x: lx, y: ly, class: 'w2-plabel', 'text-anchor': pos.side === 'left' ? 'end' : pos.side === 'right' ? 'start' : 'middle' }); lt.textContent = c.kind === 'motor' ? '' : p.label;   // 馬達三相線標籤與 ESC 重複，省略
      pg.append(lt);
      pg.addEventListener('click', (e) => { e.stopPropagation(); clickPort(p.id); });
      pg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickPort(p.id); } });
      g.append(pg); portEls[p.id] = pg;
    }
    gComps.append(g);
  }

  // ───────── 互動 ─────────
  function clickPort(pid) {
    compFocus = null;
    if (!pending) { pending = pid; selected = null; say(`已選 ${desc(pid)}，再點要接的另一個接口（Esc 取消）`); return draw(); }
    if (pending === pid) { pending = null; say('已取消'); return draw(); }
    const w = { id: `w${++seq}`, from: pending, to: pid, reversed: false };
    wires.push(w); pending = null; selected = w.id; result = null;
    say(`已連線：${desc(w.from)} ↔ ${desc(w.to)}`);
    save(); draw();
  }
  svg.addEventListener('click', () => { if (pending) { pending = null; say('已取消'); draw(); } else if (selected || compFocus) { selected = null; compFocus = null; draw(); } });
  svg.addEventListener('pointermove', (e) => {
    if (!pending) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const m = pt.matrixTransform(svg.getScreenCTM().inverse()), a = PORT_POS[pending];
    gPreview.setAttribute('d', `M${a.x},${a.y} L${m.x},${m.y}`);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pending) { pending = null; say('已取消'); draw(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); removeSelected(); }
  });
  function removeSelected() {
    if (!selected) return say('請先點選一條線');
    wires = wires.filter((w) => w.id !== selected); selected = null; result = null; say('已刪除'); save(); draw();
  }
  bDel.onclick = removeSelected;
  bSwap.onclick = () => {
    const w = wires.find((x) => x.id === selected); if (!w) return say('請先點選一條線');
    w.reversed = !w.reversed; result = null;
    say(w.reversed ? '已把這條線的紅黑對調（模擬焊接時接反）' : '已改回紅正黑負'); save(); draw();
  };
  bUndo.onclick = () => { const w = wires.pop(); if (w) { selected = null; result = null; say(`已復原：${desc(w.from)} ↔ ${desc(w.to)}`); save(); } draw(); };
  bClear.onclick = () => { if (!wires.length) return; if (!confirm('清除畫布上全部的線？')) return; wires = []; selected = null; result = null; say('已全部清除'); save(); draw(); };
  bCheck.onclick = () => { result = validateWiring(wires); showHints = false; draw(); results.scrollIntoView?.({ block: 'nearest' }); };

  let msg = '先點一個接口開始接線。';
  function say(t) { msg = t; status.textContent = t; }
  const desc = (pid) => { const p = PORTS[pid]; return `${COMPONENTS.find((c) => c.id === p.component).zh} ${p.label}`; };

  // ───────── 繪製 ─────────
  function path(a, b) {
    const A = PORT_POS[a], Bp = PORT_POS[b];
    const d = Math.max(PAD, Math.hypot(A.x - Bp.x, A.y - Bp.y) * 0.35);
    return `M${A.x},${A.y} C${A.x + A.n[0] * d},${A.y + A.n[1] * d} ${Bp.x + Bp.n[0] * d},${Bp.y + Bp.n[1] * d} ${Bp.x},${Bp.y}`;
  }
  function draw() {
    gWires.replaceChildren(); gPreview.setAttribute('d', '');
    const bad = new Map(), good = new Set();
    if (result) {
      for (const i of result.issues) if (i.wire) bad.set(i.wire, i.code);
      for (const c of result.correct) good.add(c.wire);
    }
    for (const w of wires) {
      if (!PORTS[w.from] || !PORTS[w.to]) continue;
      const kind = roleKind(PORTS[w.from].role);
      const g = sv('g', { class: `w2-wire${w.id === selected ? ' sel' : ''}${bad.has(w.id) ? ' bad' : good.has(w.id) ? ' good' : ''}`, 'data-wire': w.id, tabindex: 0, role: 'button', 'aria-label': `導線 ${desc(w.from)} 到 ${desc(w.to)}` });
      const d = path(w.from, w.to);
      g.append(sv('path', { d, class: 'hit' }), sv('path', { d, class: 'line', stroke: KIND_COLOR[kind], 'stroke-dasharray': w.reversed ? '10 7' : 'none' }));
      g.addEventListener('click', (e) => { e.stopPropagation(); pending = null; compFocus = null; selected = w.id; say(`已選取：${desc(w.from)} ↔ ${desc(w.to)}${w.reversed ? '（紅黑接反）' : ''}`); draw(); });
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter') g.dispatchEvent(new MouseEvent('click', { bubbles: false })); });
      gWires.append(g);
    }
    const used = new Set(wires.flatMap((w) => [w.from, w.to]));
    for (const [pid, pe] of Object.entries(portEls)) {
      pe.classList.toggle('pending', pid === pending);
      pe.classList.toggle('used', used.has(pid));
    }
    for (const g of gComps.children) g.classList.toggle('focus3d', from3d.includes(g.dataset.comp));
    status.textContent = msg;
    renderResults();
    syncOut();
  }
  // P4：把 2D 目前的選取與接線送給 3D（只有變動時才送）
  function syncOut() {
    const w = wires.find((x) => x.id === selected);
    const comps = w ? [PORTS[w.from].component, PORTS[w.to].component] : pending ? [PORTS[pending].component] : compFocus ? [compFocus] : [];
    const label = w ? `${desc(w.from)} ↔ ${desc(w.to)}` : pending ? desc(pending) : compFocus ? COMPONENTS.find((c) => c.id === compFocus).zh : '';
    const fk = JSON.stringify([comps, w?.from, w?.to]);
    if (fk !== lastFocusKey) { lastFocusKey = fk; emit('focus2d', { components: [...new Set(comps)], wire: w ? { from: w.from, to: w.to } : null, label }); }
    const wk = JSON.stringify([show3d, wires, result ? [result.correct, result.issues.map((i) => i.wire)] : null]);
    if (wk !== lastWiresKey) { lastWiresKey = wk; emit('wires2d', { wires: wires.map((x) => ({ ...x })), result, show: show3d }); }
  }
  // P4：3D 選取零件 → 2D 框出對應元件
  on('focus3d', (d) => {
    from3d = d?.components || [];
    if (from3d.length) say(`3D 選取：${d.label}（已在畫布上框出）`);
    draw();
  });
  function renderResults() {
    results.replaceChildren();
    if (!result) { results.append(el('p', `目前 ${wires.length} 條線（正確接線共 ${EXPECTED_WIRES.length} 條）。接完後按「✓ 檢查接線」。`, 'note')); return; }
    const errs = result.issues.filter((i) => i.code !== 'MISSING'), missing = result.issues.filter((i) => i.code === 'MISSING');
    const sum = el('p', null, `w2-sum ${result.ok ? 'ok' : 'bad'}`);
    sum.textContent = result.ok ? `✓ 全部 ${result.expectedTotal} 條都接對了（練習結果，未記錄成績）`
      : `接對 ${result.correct.length} / ${result.expectedTotal}｜錯誤 ${errs.length} 處｜缺線 ${missing.length} 條`;
    results.append(sum);
    if (errs.length) {
      const ul = el('ul', null, 'w2-issues');
      errs.forEach((i) => { const zh = CODE_ZH[i.code] || i.code; const li = el('li', i.message.startsWith(zh) ? i.message : `${zh}：${i.message}`); if (i.wire) { li.tabIndex = 0; li.onclick = () => { selected = i.wire; draw(); }; } ul.append(li); });
      results.append(ul);
    }
    if (missing.length) {
      if (!showHints) { const b = el('button', `顯示缺少的 ${missing.length} 條線（提示）`); b.type = 'button'; b.onclick = () => { showHints = true; draw(); }; results.append(b); }
      else { const ul = el('ul', null, 'w2-issues hint'); missing.forEach((i) => ul.append(el('li', i.message))); results.append(ul); }
    }
  }
  const CODE_ZH = { UNKNOWN_PORT: '未知接口', SELF_LOOP: '自己接自己', DUPLICATE: '重複接線', PORT_BUSY: '同接口多條線', CONNECTOR_MISMATCH: '接頭不合', ROLE_MISMATCH: '方向或類型錯', POLARITY: '極性錯', WRONG_CONNECTION: '接錯', MISSING: '缺線' };

  // ───────── 草稿保存（只存在這台裝置） ─────────
  function load() {
    try { const v = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(v) ? v.filter((w) => w && PORTS[w.from] && PORTS[w.to]) : []; } catch { return []; }
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(wires)); } catch { /* 無痕模式：不保存 */ } }

  draw();
  return { get wires() { return wires; }, check: () => validateWiring(wires) };
}

// 頁面入口：按「開始 2D 接線練習」才顯示畫布
const panel = document.getElementById('wire2d');
const enter = document.getElementById('wire2d-enter');
if (panel && enter) {
  let api = null;
  enter.addEventListener('click', () => {
    panel.hidden = false;
    if (!api) api = initWiringCanvas(panel.querySelector('.w2-root'));
    panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  if (new URLSearchParams(location.search).get('wire2d') === '1') enter.click();   // 截圖與驗收用
}
