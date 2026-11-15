// F450 實訓中心｜零件組裝接線工作台（P12 功能，P13 改版面）
// 版面與操作參考 FPV 接線模擬器（浮動工具列、「＋ 配件」彈出零件欄、點陣工作區、右下縮放列、右上檢查鈕、深淺色），
// 畫面、零件圖、音效與程式全部自製，不使用對方的程式、圖片或 Logo。
// 引腳定義與檢查沿用 pins.js（PX4 官方引腳表、PX4 開源硬體 FMUv2.4.6、樂迪 R9DS 說明書）；
// 零件幾何沿用 pin-canvas.js（Pixhawk 依 FMUv2.4.6 電路板座標等比例，CC-BY-SA 3.0）；零件擬真圖在 bench-art.js。
import { PORTS, PRACTICE_ONLY } from './model.js?v=p4-1';
import { ALL_PINS, EXPECTED_PIN_WIRES, PIN_WIRE_TOTAL, validatePinWiring } from './pins.js?v=p11-1';
import { PIN_POS, BOX, CASE, px, FMU, FMU_OTHER, RAIL_X0, RAIL_Y, RAIL_P, KIND_COLOR } from './pin-canvas.js?v=p12-1';
import { ensureDefs, drawBody, thumb } from './bench-art.js?v=p13-1';
import { emit, on, latest } from './bus.js?v=p4-1';

const NS = 'http://www.w3.org/2000/svg';
const STORE = 'f450twin-bench-v1', THEME = 'f450twin-bench-theme';
// 零件欄：[元件 id, 名稱, 規格]
const PALETTE = [
  ['pixhawk', 'Pixhawk 2.4.8 飛控', 'FMUv2 開源硬體等比例'], ['receiver', '樂迪 R9DS 接收機', 'SBUS 由 CH9 輸出'], ['gps', 'M8N GPS／羅盤', 'GPS 6P＋羅盤 4P'],
  ['power_module', '電源模組', 'XT60 進出＋6P 飛控線'], ['battery', '4S 鋰電池', '14.8V XT60'], ['pdb', 'F450 下中心板', '配電焊盤'],
  ['esc_fr', '20A 電調・右前', '→ MAIN OUT 1'], ['esc_rl', '20A 電調・左後', '→ MAIN OUT 2'], ['esc_fl', '20A 電調・左前', '→ MAIN OUT 3'], ['esc_rr', '20A 電調・右後', '→ MAIN OUT 4'],
  ['motor_fr', '2212 馬達・右前', 'A2212 930KV・CCW'], ['motor_rl', '2212 馬達・左後', 'A2212 930KV・CCW'], ['motor_fl', '2212 馬達・左前', 'A2212 930KV・CW'], ['motor_rr', '2212 馬達・右後', 'A2212 930KV・CW'],
  ['safety_switch', '安全開關', '3P → SWITCH'], ['buzzer', '蜂鳴器', '2P → BUZZER'],
];
const NAME = Object.fromEntries(PALETTE.map(([id, n]) => [id, n]));
// 每個零件的外框（標準位置）與引腳的零件內座標
const RECT = Object.fromEntries(PALETTE.map(([id]) => [id, id === 'pixhawk' ? CASE.slice(0, 4) : BOX[id].slice(0, 4)]));
const LOCAL = {};   // pinId → { lx, ly, n }
for (const [pid, p] of Object.entries(PIN_POS)) { const cid = ALL_PINS[pid].component, [x, y] = RECT[cid]; LOCAL[pid] = { lx: p.x - x, ly: p.y - y, n: p.n }; }
const PINS_OF = Object.fromEntries(PALETTE.map(([id]) => [id, Object.keys(LOCAL).filter((pid) => ALL_PINS[pid].component === id)]));

export function initBench(root) {
  if (!root) return null;
  ensureDefs();
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  const sv = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const add = (parent, tag, attrs, text) => { const e = sv(tag, attrs); if (text != null) e.textContent = text; parent.append(e); return e; };
  let { parts, wires } = load();                 // parts：{ 元件: { x, y, rot } }；wires：[{ id, a, b }]
  let view = { x: 0, y: 0, k: 0.6 }, sel = null, pending = null, seq = wires.length, active = false, sound = true, hist = [];
  let trainMode = latest('trainMode')?.mode || 'practice', locked = !!latest('examLock')?.locked, stash = null, lastWiresKey = '', lastFocusKey = '';
  const isExam = () => trainMode === 'exam';
  const narrow = () => matchMedia('(max-width: 760px)').matches;

  // ───────── 版面：工作區上疊浮動工具列、零件欄、檢查鈕、縮放列 ─────────
  root.replaceChildren(); root.classList.add('bench');
  let theme = 'light'; try { theme = localStorage.getItem(THEME) || 'light'; } catch { /* 無痕模式 */ }
  const setTheme = (t) => { theme = t; root.classList.toggle('bench-dark', t === 'dark'); bTheme.textContent = t === 'dark' ? '☀' : '☾'; try { localStorage.setItem(THEME, t); } catch { /* 無痕模式 */ } draw(); };
  const title = el('b', '零件組裝接線');
  const status = el('p', '按「＋ 配件」把零件拖進工作區（或按零件右邊的「＋」），再點引腳接線。拖曳空白處可平移，滾輪或右下角縮放。', 'w2-status'); status.setAttribute('aria-live', 'polite');
  const stage = el('div', null, 'bench-stage');
  const svg = sv('svg', { class: 'bench-svg', role: 'application', tabindex: 0, 'aria-label': 'F450 零件組裝接線工作台' });
  const world = add(svg, 'g', { class: 'bench-world' });
  const gParts = add(world, 'g'), gWires = add(world, 'g'), gPins = add(world, 'g'), gDemo = add(world, 'g', { class: 'w2-demo', 'pointer-events': 'none' }), gFx = add(world, 'g', { 'pointer-events': 'none' });
  const prev = add(world, 'path', { class: 'w2-preview', d: '' });
  const B = (parent, label, tip, act, cls = '') => { const b = el('button', label, cls); b.type = 'button'; b.title = tip; b.setAttribute('aria-label', tip); b.dataset.act = act; parent.append(b); return b; };
  // 左上浮動工具列
  const top = el('div', null, 'bench-topbar');
  const bParts = B(top, '＋ 配件', '打開零件欄', 'parts', 'strong'), bUndo = B(top, '↶', '復原上一步', 'undo'), bDel = B(top, '🗑', '刪除選取的零件或導線（Delete 鍵）', 'delete'), bRot = B(top, '↻', '選取的零件旋轉 90°', 'rotate');
  const bDemo = B(top, '完整接線示例', '放好全部零件並依序畫出 54 根正確接線', 'demo'), bFile = B(top, '檔案', '匯出、匯入、清除', 'file');
  const fileMenu = el('div', null, 'bench-menu'); fileMenu.hidden = true;
  const bExport = B(fileMenu, '匯出接線檔（JSON）', '把目前的零件與接線存成檔案', 'export'), bImport = B(fileMenu, '匯入接線檔', '讀入之前匯出的接線檔', 'import'), bClear = B(fileMenu, '清除全部', '清空工作台', 'clear');
  const fileInput = el('input'); fileInput.type = 'file'; fileInput.accept = '.json,application/json'; fileInput.hidden = true;
  // 右上：檢查（綠）、上電測試（紅）
  const acts = el('div', null, 'bench-actions');
  const bCheck = B(acts, '✓', '檢查接線', 'check', 'go'), bPower = B(acts, '⚡', '上電測試', 'power', 'power');
  // 彈出零件欄
  const palette = el('div', null, 'bench-palette'); palette.setAttribute('aria-label', '零件欄'); palette.hidden = true;
  // 右下縮放列
  const zbar = el('div', null, 'bench-zoombar');
  const bOut = B(zbar, '－', '縮小', 'zoom-out'), zoomTxt = el('span', '60%', 'bench-zoom'); zbar.append(zoomTxt);
  const bIn = B(zbar, '＋', '放大', 'zoom-in'), bFit = B(zbar, '⛶', '縮放到看見全部零件', 'fit'), bSound = B(zbar, '🔊', '聲音開／關', 'sound'), bTheme = B(zbar, '☾', '深色／淺色', 'theme');
  stage.append(svg, top, fileMenu, acts, palette, zbar, fileInput);
  const report = el('div', null, 'bench-report'); report.setAttribute('aria-live', 'polite');
  const head = el('div', null, 'row between'); head.append(title);
  root.append(head, status, stage, report,
    el('p', 'Pixhawk 2.4.8 依 PX4 開源硬體 FMUv2.4.6 電路板座標等比例繪製（© PX4／3D Robotics，CC-BY-SA 3.0；本圖同授權）。引腳依 PX4 官方《Pixhawk 1》引腳表；R9DS 依樂迪官方說明書（SBUS 由 CH9 輸出）。版面與操作參考 FPV 接線模擬器，零件圖與程式為自製。GPS 模組端、電調 BEC、接頭類型待實機核對。', 'note'),
    el('p', PRACTICE_ONLY ? '練習用：上電測試是模擬，實機通電前務必拆槳；規則待教師以實機核對，結果不計正式成績。' : '', 'note'));
  const say = (t) => { status.textContent = t; };

  // ───────── 復原 ─────────
  const snapshot = () => { hist.push(JSON.stringify({ parts, wires })); if (hist.length > 100) hist.shift(); };
  bUndo.onclick = () => {
    if (locked || !hist.length) return say('沒有可以復原的步驟');
    ({ parts, wires } = JSON.parse(hist.pop())); sel = null; pending = null; result = null; gFx.replaceChildren(); save(); draw(); say('已復原上一步');
  };

  // ───────── 零件欄 ─────────
  const below = () => `${top.offsetTop + top.offsetHeight + 8}px`;   // 工具列在手機上會換行，零件欄與檔案選單接在它下面
  const openPalette = (on) => { const was = !palette.hidden; palette.style.top = below(); palette.hidden = !on; bParts.classList.toggle('on', on); bParts.setAttribute('aria-expanded', String(on)); if (was !== on && Object.keys(parts).length) fit(); };
  bParts.onclick = () => openPalette(palette.hidden);
  function renderPalette() {
    palette.replaceChildren();
    const ph = el('div', null, 'bench-ph'); ph.append(el('b', '配件')); const x = el('button', '✕'); x.type = 'button'; x.title = '關閉零件欄'; x.onclick = () => openPalette(false); ph.append(x); palette.append(ph);
    for (const [id, n, spec] of PALETTE) {
      const placed = !!parts[id];
      const item = el('div', null, `bench-item${placed ? ' placed' : ''}`); item.draggable = !placed && !locked; item.dataset.part = id;
      const txt = el('div'); txt.append(el('b', n), el('span', spec));
      const b = el('button', placed ? '✓' : '＋'); b.type = 'button'; b.disabled = placed || locked; b.title = placed ? '已放在工作區' : `加入 ${n}`; b.setAttribute('aria-label', b.title);
      b.onclick = () => { place(id); if (narrow()) openPalette(false); };
      item.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'copy'; });
      item.append(thumb(id, RECT[id].slice(2)), txt, b); palette.append(item);
    }
  }
  svg.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  svg.addEventListener('drop', (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (RECT[id]) { const [wx, wy] = toWorld(e.clientX, e.clientY); place(id, wx - RECT[id][2] / 2, wy - RECT[id][3] / 2); } });
  function place(id, x, y) {
    if (locked || parts[id]) return;
    snapshot();
    const auto = x == null;   // 按「＋」：放到建議位置（不重疊）；拖入：放在放開的地方
    if (auto) [x, y] = RECT[id];
    parts[id] = { x: Math.round(x), y: Math.round(y), rot: 0 }; sel = { part: id };
    say(`已放入 ${NAME[id]}：拖曳可移動，點引腳接線。`); save(); draw(); if (auto) fit();
  }

  // ───────── 座標與視角 ─────────
  const toWorld = (cx, cy) => { const r = svg.getBoundingClientRect(); return [(cx - r.left - view.x) / view.k, (cy - r.top - view.y) / view.k]; };
  function applyView() { world.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`); zoomTxt.textContent = `${Math.round(view.k * 100)}%`; }
  function zoomAt(f, cx, cy) {
    const r = svg.getBoundingClientRect(); cx ??= r.left + r.width / 2; cy ??= r.top + r.height / 2;
    const k = Math.min(2.5, Math.max(0.15, view.k * f)), wx = (cx - r.left - view.x) / view.k, wy = (cy - r.top - view.y) / view.k;
    view = { k, x: cx - r.left - wx * k, y: cy - r.top - wy * k }; applyView();
  }
  function fit() {
    const ids = Object.keys(parts); const r = svg.getBoundingClientRect();
    if (!ids.length || !r.width) { view = { x: 20, y: 80, k: Math.min((r.width || 840) / 1500, 0.8) }; return applyView(); }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) { const p = parts[id], [, , w, h] = RECT[id], s = Math.max(w, h); x0 = Math.min(x0, p.x - (s - w) / 2); y0 = Math.min(y0, p.y - (s - h) / 2); x1 = Math.max(x1, p.x + w + (s - w) / 2); y1 = Math.max(y1, p.y + h + (s - h) / 2 + 24); }
    const padTop = 80, padBot = 70, padR = 84;   // 讓出上方工具列、下方縮放列、右側檢查鈕
    const padL = !palette.hidden && !narrow() ? palette.offsetWidth + 24 : 20;   // 零件欄開著時，零件排在它右邊
    const aw = r.width - padL - padR, ah = r.height - padTop - padBot;
    const k = Math.min(1.6, Math.max(0.15, Math.min(aw / (x1 - x0), ah / (y1 - y0))));
    view = { k, x: padL + (aw - (x1 - x0) * k) / 2 - x0 * k, y: padTop + (ah - (y1 - y0) * k) / 2 - y0 * k }; applyView();
  }
  svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY); }, { passive: false });
  bIn.onclick = () => zoomAt(1.2); bOut.onclick = () => zoomAt(1 / 1.2); bFit.onclick = fit;
  const pinWorld = (pid) => {   // 引腳在工作區的座標（含零件旋轉）
    const cid = ALL_PINS[pid].component, p = parts[cid], L = LOCAL[pid], [, , w, h] = RECT[cid];
    const a = (p.rot * Math.PI) / 180, dx = L.lx - w / 2, dy = L.ly - h / 2, c = Math.cos(a), s = Math.sin(a);
    return { x: p.x + w / 2 + dx * c - dy * s, y: p.y + h / 2 + dx * s + dy * c, n: [L.n[0] * c - L.n[1] * s, L.n[0] * s + L.n[1] * c] };
  };

  // ───────── 拖曳：空白處平移（小手），零件可移動；雙指縮放 ─────────
  let drag = null; const touches = new Map();
  svg.addEventListener('pointerdown', (e) => {
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 2) { const [[ax, ay], [bx, by]] = [...touches.values()]; drag = { kind: 'pinch', d: Math.hypot(ax - bx, ay - by), moved: true }; return; }
    const partEl = e.target.closest('[data-part]');
    if (partEl && !locked) { const id = partEl.dataset.part, [wx, wy] = toWorld(e.clientX, e.clientY); snapshot(); drag = { kind: 'part', id, dx: wx - parts[id].x, dy: wy - parts[id].y, moved: false }; sel = { part: id }; }
    else if (!e.target.closest('[data-pin],[data-wire]')) drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    if (drag) { try { svg.setPointerCapture(e.pointerId); } catch { /* Safari 偶爾不支援 */ } svg.classList.add('grabbing'); svg.focus({ preventScroll: true }); }
    if (!fileMenu.hidden) fileMenu.hidden = true;
  });
  svg.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (pending && !drag) { const [wx, wy] = toWorld(e.clientX, e.clientY), a = pinWorld(pending); prev.setAttribute('d', `M${a.x},${a.y} L${wx},${wy}`); }
    if (!drag) return;
    if (drag.kind === 'pinch') { if (touches.size < 2) return; const [[ax, ay], [bx, by]] = [...touches.values()], d = Math.hypot(ax - bx, ay - by); zoomAt(d / drag.d, (ax + bx) / 2, (ay + by) / 2); drag.d = d; return; }
    if (drag.kind === 'pan') { view.x = drag.vx + e.clientX - drag.sx; view.y = drag.vy + e.clientY - drag.sy; drag.moved = true; applyView(); return; }
    const [wx, wy] = toWorld(e.clientX, e.clientY); parts[drag.id].x = Math.round(wx - drag.dx); parts[drag.id].y = Math.round(wy - drag.dy); drag.moved = true; draw(false);
  });
  const endPointer = (e) => {
    touches.delete(e.pointerId);
    if (!drag) return;
    const d = drag; if (d.kind === 'pinch' && touches.size) return;
    drag = null; svg.classList.remove('grabbing');
    if (d.kind === 'part') { if (d.moved) save(); else hist.pop(); say(`已選取 ${NAME[d.id]}：可「↻」旋轉或「🗑」刪除。`); draw(); }
    else if (d.kind === 'pan' && !d.moved) { if (pending) { pending = null; say('已取消'); } sel = null; if (narrow()) openPalette(false); draw(); }
  };
  svg.addEventListener('pointerup', endPointer); svg.addEventListener('pointercancel', endPointer);
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('input,textarea')) return;
    if (e.key === 'Escape') { if (pending) { pending = null; say('已取消'); draw(); } openPalette(false); fileMenu.hidden = true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeSel(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); bUndo.onclick(); }
  });
  bRot.onclick = () => { if (locked || !sel?.part) return say('先點選一個零件'); snapshot(); const p = parts[sel.part]; p.rot = (p.rot + 90) % 360; save(); draw(); };
  bDel.onclick = removeSel;
  function removeSel() {
    if (locked || !sel) return say('先點選一個零件或一根線');
    snapshot();
    if (sel.part) { const id = sel.part; delete parts[id]; wires = wires.filter((w) => ALL_PINS[w.a].component !== id && ALL_PINS[w.b].component !== id); say(`已把 ${NAME[id]} 放回零件欄（連到它的線一起刪除）`); }
    else { wires = wires.filter((w) => w.id !== sel.wire); say('已刪除這根線'); }
    sel = null; result = null; save(); draw();
  }
  // 檔案選單：匯出、匯入、清除
  bFile.onclick = () => { fileMenu.style.top = below(); fileMenu.hidden = !fileMenu.hidden; };
  bClear.onclick = () => { fileMenu.hidden = true; if (locked || (!Object.keys(parts).length && !wires.length) || !confirm('清空工作台（零件與接線）？可以按「↶」復原。')) return; snapshot(); parts = {}; wires = []; sel = null; result = null; stopDemo(); gFx.replaceChildren(); save(); draw(); };
  bExport.onclick = () => {
    fileMenu.hidden = true;
    const blob = new Blob([JSON.stringify({ format: 'f450-bench', version: 1, parts, wires }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'F450-接線.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    say('已匯出接線檔');
  };
  bImport.onclick = () => { fileMenu.hidden = true; fileInput.value = ''; fileInput.click(); };
  fileInput.onchange = async () => {
    const f = fileInput.files?.[0]; if (!f) return;
    try { const v = sanitize(JSON.parse(await f.text())); snapshot(); ({ parts, wires } = v); seq = wires.length + 1; sel = null; result = null; save(); draw(); fit(); say(`已匯入：${Object.keys(parts).length} 個零件、${wires.length} 根線`); }
    catch { say('這個檔案讀不出來（不是工作台匯出的接線檔）'); }
  };
  bSound.onclick = () => { sound = !sound; bSound.textContent = sound ? '🔊' : '🔇'; };
  bTheme.onclick = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  // ───────── 接線 ─────────
  const pname = (pid) => { const P = ALL_PINS[pid]; return `${NAME[P.component] || P.component} ${PORTS[P.port]?.label || ''} ${P.label}`; };
  function clickPin(pid) {
    if (locked) return say('已交卷，接線已鎖定');
    if (!pending) { pending = pid; sel = null; say(`已選 ${pname(pid)}，再點要接的另一根引腳（Esc 取消）`); return draw(); }
    if (pending === pid) { pending = null; say('已取消'); return draw(); }
    snapshot();
    const w = { id: `b${++seq}`, a: pending, b: pid }; wires.push(w); pending = null; sel = { wire: w.id }; result = null;
    say(`已接：${pname(w.a)} ↔ ${pname(w.b)}`); save(); draw();
  }
  let result = null;
  bCheck.onclick = () => { if (isExam()) return; result = validatePinWiring(wires); renderReport(); draw(); say(result.complete ? `✓ 全部 ${PIN_WIRE_TOTAL} 根都接對了，可以按「⚡」上電測試` : `接對 ${result.ok}／${PIN_WIRE_TOTAL} 根，問題列在下方`); };

  // ───────── 上電測試 ─────────
  let ac = null;
  const audio = () => { if (!sound) return null; try { ac ??= new (window.AudioContext || window.webkitAudioContext)(); return ac; } catch { return null; } };
  function bang() {   // 自製合成音：白噪音爆炸聲（不使用外部音檔）
    const a = audio(); if (!a) return;
    const n = a.sampleRate * 0.7, buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = 0.9; src.connect(f).connect(g).connect(a.destination); src.start();
  }
  function beeps(list) { const a = audio(); if (!a) return; let t = a.currentTime; for (const [hz, dur, gap = 0.06] of list) { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = hz; g.gain.value = 0.12; o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur); t += dur + gap; } }
  bPower.onclick = () => {
    if (isExam()) return;
    gFx.replaceChildren(); svg.classList.remove('shake');
    const r = validatePinWiring(wires), done = new Set(r.links.map((l) => `${l.from}--${l.to}`)), has = (id) => done.has(id);
    const lines = [];
    if (!parts.battery) { renderPowerReport([['bad', '沒有電池：先從零件欄放入 4S 鋰電池並接到電源模組']]); return; }
    const short = r.issues.find((i) => i.code === 'SHORT');
    if (short && (has('battery.xt60--power_module.in') || short.pins.some((p) => p.startsWith('battery.')))) {   // 有電才會炸
      const w = wires.find((x) => x.id === short.wire), a = pinWorld(w.a), b = pinWorld(w.b), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, z = 1 / Math.min(1, view.k);
      const star = Array.from({ length: 12 }, (_, i) => { const ang = (i * Math.PI) / 6, rr = (i % 2 ? 34 : 80) * z; return `${mx + Math.cos(ang) * rr},${my + Math.sin(ang) * rr}`; }).join(' ');
      add(gFx, 'polygon', { points: star, class: 'bench-boom' }); add(gFx, 'text', { x: mx, y: my + 10 * z, 'text-anchor': 'middle', class: 'bench-boom-txt', style: `font-size:${Math.round(30 * z)}px` }, '砰！');
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { void svg.getBoundingClientRect(); svg.classList.add('shake'); }
      bang(); result = r; draw();
      renderPowerReport([['bad', `砰！短路：${short.message}。真機會冒煙、燒毀零件，請立刻斷電。`]]);
      return;
    }
    if (!has('battery.xt60--power_module.in')) { renderPowerReport([['bad', '沒有通電：電池 XT60 沒有正確接到電源模組輸入（＋接＋、−接−）']]); return; }
    lines.push(['ok', '電源模組：通電']);
    const pdb = has('power_module.out--pdb.in');
    lines.push([pdb ? 'ok' : 'bad', pdb ? '配電板：通電' : '配電板：沒電（電源模組輸出沒接到配電板）']);
    const fc = has('power_module.fc--pixhawk.power') && parts.pixhawk;
    lines.push([fc ? 'ok' : 'bad', fc ? 'Pixhawk：開機（狀態燈閃爍）' : 'Pixhawk：沒開機（POWER 6P 沒接好）']);
    if (fc) {
      lines.push(has('buzzer.conn--pixhawk.buzzer') ? ['ok', '蜂鳴器：開機音 ♪'] : ['warn', '蜂鳴器：沒聽到開機音（BUZZER 沒接）']);
      lines.push(has('safety_switch.conn--pixhawk.switch') ? ['ok', '安全開關：紅燈閃爍（長按解鎖）'] : ['warn', '安全開關：沒反應（SWITCH 沒接，飛控無法解鎖）']);
      const gpsCross = r.issues.some((i) => i.code === 'TX_NOT_CROSSED' && i.pins.some((p) => p.startsWith('gps.')));
      lines.push(has('gps.serial--pixhawk.gps') ? ['ok', 'GPS：搜星中（藍燈閃）'] : gpsCross ? ['bad', 'GPS：沒有資料（TX／RX 沒交叉）'] : ['warn', 'GPS：沒有連線']);
      lines.push(has('gps.compass--pixhawk.i2c') ? ['ok', '羅盤：已連線'] : ['warn', '羅盤：沒有連線（I2C）']);
      lines.push(has('receiver.sbus--pixhawk.rc_in') ? ['ok', 'R9DS：有電，SBUS 訊號送到 RC IN（紫／藍燈）'] : ['warn', 'R9DS：沒有連線（CH9 → RC IN）']);
    }
    for (const [c, zh, n] of [['fr', '右前', 1], ['rl', '左後', 2], ['fl', '左前', 3], ['rr', '右後', 4]]) {
      const p = pdb && has(`pdb.pad_${c}--esc_${c}.power`), m = has(`esc_${c}.phase--motor_${c}.phase`), s = fc && has(`esc_${c}.signal--pixhawk.main_out_${n}`);
      lines.push([p && m && s ? 'ok' : p ? 'warn' : 'bad', `電調${zh}：${p ? '嗶嗶自檢' : '沒電'}${p ? (m ? '，馬達可轉（拆槳測試）' : '，馬達不會轉（三相沒接好）') : ''}${p ? (s ? `，收到 MAIN OUT ${n} 訊號` : '，沒有訊號（無法控制）') : ''}`]);
    }
    if (r.issues.some((i) => i.code === 'ESC_RED_ON_RAIL')) lines.push(['warn', '注意：電調紅線接到排針，排針被反灌電（多顆 BEC 會互相干擾）']);
    const allOk = lines.every(([t]) => t === 'ok') && r.complete;
    lines.unshift([allOk ? 'ok' : 'warn', allOk ? '✓ 上電測試通過：全部零件正常' : '上電測試：有零件沒有正常工作（見下方）']);
    if (fc && has('buzzer.conn--pixhawk.buzzer')) beeps([[1047, 0.12], [1319, 0.12], [1568, 0.22]]); else beeps([[880, 0.08], [880, 0.08], [880, 0.08]]);
    renderPowerReport(lines);
  };
  function renderPowerReport(lines) {
    report.replaceChildren(el('b', '⚡ 上電測試結果'));
    const ul = el('ul', null, 'bench-power'); lines.forEach(([t, s]) => ul.append(el('li', s, t))); report.append(ul);
    status.textContent = lines[0][1];
    report.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }
  function renderReport() {
    report.replaceChildren();
    if (!result) return;
    const errs = result.issues.filter((i) => i.code !== 'PIN_MISSING');
    report.append(el('p', result.complete ? `✓ 全部 ${PIN_WIRE_TOTAL} 根都接對了` : `接對 ${result.ok}／${PIN_WIRE_TOTAL} 根｜錯誤 ${errs.length} 處｜完成連線 ${result.links.length}／20 條`, `w2-sum ${result.complete ? 'ok' : 'bad'}`));
    const missingParts = PALETTE.filter(([id]) => !parts[id]).map(([, n]) => n);
    if (missingParts.length) report.append(el('p', `還沒放入的零件：${missingParts.join('、')}`, 'note'));
    if (result.issues.length) { const ul = el('ul', null, 'w2-issues'); result.issues.slice(0, 30).forEach((i) => ul.append(el('li', i.message))); report.append(ul); }
  }

  // ───────── 完整接線示例 ─────────
  let demoTimer = null;
  function stopDemo() { clearInterval(demoTimer); demoTimer = null; gDemo.replaceChildren(); bDemo.textContent = '完整接線示例'; }
  bDemo.onclick = () => {
    if (isExam() || locked) return;
    if (demoTimer || gDemo.childNodes.length) { stopDemo(); return; }
    let placedNew = 0;
    for (const [id] of PALETTE) if (!parts[id]) { if (!placedNew) snapshot(); const [x, y] = RECT[id]; parts[id] = { x, y, rot: 0 }; placedNew++; }
    if (placedNew) { save(); say(`示例先把 ${placedNew} 個零件放到標準位置`); }
    openPalette(false); draw(); fit();
    const all = EXPECTED_PIN_WIRES.map((e) => ({ a: e.a, b: e.phase ? e.b.replace('#null', `#${e.a.split('#')[1]}`) : e.b })); let k = 0;
    bDemo.textContent = '■ 停止示例';
    demoTimer = setInterval(() => {
      if (k >= all.length) { clearInterval(demoTimer); demoTimer = null; bDemo.textContent = '■ 清除示例'; say(`示例完成：共 ${all.length} 根。照著自己接一次，再按「⚡」上電測試。`); return; }
      const w = all[k++]; add(gDemo, 'path', { d: wirePath(w.a, w.b), class: 'demo-line', stroke: wireColor(w) }); say(`示例第 ${k}／${all.length} 根：${pname(w.a)} → ${pname(w.b)}`);
    }, 220);
  };

  // ───────── 繪製 ─────────
  const wireColor = (w) => { const k = ALL_PINS[w.a].kind; return k === 'gnd' || k === 'neg' ? (theme === 'dark' ? '#cfd6dd' : '#2a2e33') : KIND_COLOR[k]; };
  function wirePath(a, b) { const A = pinWorld(a), B = pinWorld(b), d = Math.max(40, Math.hypot(A.x - B.x, A.y - B.y) * 0.3); return `M${A.x},${A.y} C${A.x + A.n[0] * d},${A.y + A.n[1] * d} ${B.x + B.n[0] * d},${B.y + B.n[1] * d} ${B.x},${B.y}`; }
  function drawPart(id) {
    const p = parts[id], [, , w, h] = RECT[id];
    const g = add(gParts, 'g', { class: `bench-part${sel?.part === id ? ' sel' : ''}`, 'data-part': id, transform: `translate(${p.x} ${p.y}) rotate(${p.rot} ${w / 2} ${h / 2})` });
    add(g, 'rect', { x: -6, y: -6, width: w + 12, height: h + 12, rx: 14, class: 'bench-selbox' });   // 選取框（也讓整塊都能拖）
    const A = (tag, attrs, text) => add(g, tag, attrs, text);
    if (id === 'pixhawk') {
      A('rect', { x: 0, y: 0, width: w, height: h, rx: 26, fill: 'url(#bg-case)', stroke: '#454c55', 'stroke-width': 3, filter: 'url(#bg-shadow)' });
      A('path', { d: `M${w / 2},20 l14,22 h-8 v14 h-12 v-14 h-8 z`, fill: '#e8ecef' });
      A('circle', { cx: w / 2, cy: 80, r: 10, fill: '#2f6fd6', stroke: '#9cc0ff' });
      A('text', { x: w / 2, y: 190, 'text-anchor': 'middle', class: 'pin-silk big' }, 'Pixhawk 2.4.8');
      for (const [sx, sy] of [[18, 18], [w - 18, 18], [18, h - 18], [w - 18, h - 18]]) A('circle', { cx: sx, cy: sy, r: 6, fill: '#0c0d0f', stroke: '#5a626b' });
      const silk = (x, y, t) => A('text', { x, y, 'text-anchor': 'middle', class: 'pin-silk' }, t);
      const L = (xm, ym) => { const [x, y] = px(xm, ym); return [x - CASE[0], y - CASE[1]]; };
      for (const [xm, ym, nm, n] of FMU_OTHER) { const [x, y] = L(xm, ym); A('rect', { x: x - n * 6 - 4, y: y - 6, width: n * 12 + 8, height: 12, rx: 2, fill: '#2c3239', stroke: '#4b535c' }); silk(x, y - 11, nm); }
      for (const [port, [xm, ym, nm]] of Object.entries(FMU)) { const [x, y] = L(xm, ym), n = PINS_OF.pixhawk.filter((q) => ALL_PINS[q].port === port).length; A('rect', { x: x - n * 8 - 6, y: y - 9, width: n * 16 + 12, height: 18, rx: 3, fill: '#f2f2f2', stroke: '#7ee8c8', 'stroke-width': 2 }); silk(x, y - 15, nm); }
      const rx0 = RAIL_X0 - CASE[0], ry0 = RAIL_Y - CASE[1];
      A('rect', { x: rx0 - 12, y: ry0 - 10, width: 16 * RAIL_P + 4, height: 60, rx: 3, fill: '#0b0c0e' });
      for (let c = 0; c < 16; c++) for (let r = 0; r < 3; r++) A('rect', { x: rx0 + c * RAIL_P - 3, y: ry0 + r * 20 - 3, width: 6, height: 6, fill: '#d9b44a' });
      silk(rx0, ry0 - 14, 'RC'); silk(rx0 + RAIL_P, ry0 - 14, 'SB'); [8, 7, 6, 5, 4, 3, 2, 1].forEach((m, i) => silk(rx0 + (2 + i) * RAIL_P, ry0 - 14, String(m)));
      silk(rx0 + 5.5 * RAIL_P, ry0 - 28, 'MAIN OUT 8 ← 1'); silk(rx0 + 12.5 * RAIL_P, ry0 - 28, 'AUX 6 ← 1');
      ['S', '+', '−'].forEach((t, r) => A('text', { x: rx0 + 16 * RAIL_P - 4, y: ry0 + r * 20 + 4, class: 'pin-silk' }, t));
    } else drawBody(A, id, w, h);
    // 名稱放在沒有引腳的那一邊（下方優先，下方有引腳就放上方）；電調的位置直接寫在本體上
    if (id.startsWith('esc_')) A('text', { x: w / 2, y: h / 2 + 30, 'text-anchor': 'middle', class: 'ba-label dark' }, NAME[id].split('・')[1]);
    else { const pinsAt = (yy) => PINS_OF[id].some((q) => Math.abs(LOCAL[q].ly - yy) < 2); const capY = !pinsAt(h) ? h + 22 : !pinsAt(0) ? -12 : h / 2; A('text', { x: w / 2, y: capY, 'text-anchor': 'middle', class: 'bench-cap', transform: p.rot ? `rotate(${-p.rot} ${w / 2} ${h / 2})` : '' }, NAME[id]); }
  }
  function draw(full = true) {
    gParts.replaceChildren(); gWires.replaceChildren(); gPins.replaceChildren(); prev.setAttribute('d', '');
    for (const id of Object.keys(parts)) drawPart(id);
    if (trainMode === 'teach') result = validatePinWiring(wires);
    const bad = new Set((result?.issues || []).map((i) => i.wire).filter(Boolean));
    for (const w of wires) {
      if (!parts[ALL_PINS[w.a]?.component] || !parts[ALL_PINS[w.b]?.component]) continue;
      const g = add(gWires, 'g', { class: `w2-wire pinwire${sel?.wire === w.id ? ' sel' : ''}${bad.has(w.id) ? ' bad' : result ? ' good' : ''}`, 'data-wire': w.id });
      const d = wirePath(w.a, w.b); add(g, 'path', { d, class: 'hit' }); add(g, 'path', { d, class: 'line', stroke: wireColor(w) });
      g.addEventListener('click', (e) => { e.stopPropagation(); if (locked) return; pending = null; sel = { wire: w.id }; say(`已選：${pname(w.a)} ↔ ${pname(w.b)}（🗑 刪除）`); draw(); });
    }
    const used = new Set(wires.flatMap((w) => [w.a, w.b]));
    const sug = new Set();
    if (trainMode === 'teach' && pending) for (const e of EXPECTED_PIN_WIRES) {
      if (e.phase) { if (e.a.split('#')[0] === pending.split('#')[0]) ['a', 'b', 'c'].forEach((x) => sug.add(e.b.replace('#null', `#${x}`))); continue; }
      if (e.a === pending) sug.add(e.b); if (e.b === pending) sug.add(e.a);
    }
    for (const id of Object.keys(parts)) for (const pid of PINS_OF[id]) {
      const P = ALL_PINS[pid], pos = pinWorld(pid);
      const col = KIND_COLOR[P.kind] === '#222' ? (theme === 'dark' ? '#9aa4ae' : '#2a2e33') : KIND_COLOR[P.kind];
      const g = add(gPins, 'g', { class: `pin${used.has(pid) ? ' used' : ''}${pending === pid ? ' pending' : ''}${sug.has(pid) ? ' suggest' : ''}`, 'data-pin': pid, tabindex: 0, role: 'button', 'aria-label': pname(pid), style: `color:${col}` });
      add(g, 'circle', { cx: pos.x, cy: pos.y, r: 6, class: 'pin-dot', stroke: 'currentColor', 'stroke-width': 2.5 });
      if (!/pixhawk\.(rc_in|main_out)/.test(P.port)) add(g, 'text', { x: pos.x + pos.n[0] * 10, y: pos.y + (pos.n[1] < 0 ? -10 : pos.n[1] > 0 ? 18 : 4), 'text-anchor': pos.n[0] < 0 ? 'end' : pos.n[0] > 0 ? 'start' : 'middle', class: 'pin-label' }, P.label);
      g.addEventListener('pointerdown', (e) => e.stopPropagation());
      g.addEventListener('click', (e) => { e.stopPropagation(); clickPin(pid); });
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickPin(pid); } });
    }
    if (!full) return;
    [bRot, bDel, bClear, bUndo, bImport].forEach((b) => (b.disabled = locked));
    bCheck.hidden = isExam() || trainMode === 'teach'; bDemo.hidden = isExam(); bPower.hidden = isExam(); bFile.hidden = isExam(); if (isExam()) fileMenu.hidden = true;
    title.textContent = `零件組裝接線（${{ teach: '教學', practice: '練習', exam: locked ? '考核・已交卷' : '考核' }[trainMode]}）`;
    if (trainMode === 'teach' || result) renderReport();
    renderPalette(); syncOut();
  }
  // 換算接頭級連線，送給成績單、3D 線束、保存紀錄（只有顯示中才送）
  function syncOut() {
    if (!active) return;
    const r = validatePinWiring(wires), wk = JSON.stringify([r.links, r.issues.map((i) => i.code + i.wire)]);
    if (wk !== lastWiresKey) { lastWiresKey = wk; emit('wires2d', { wires: r.links, result: null, show: !!latest('wires2d')?.show, pinIssues: r.issues.filter((i) => i.code !== 'PIN_MISSING'), level: 'bench' }); }
    const w = wires.find((x) => x.id === sel?.wire), comps = w ? [ALL_PINS[w.a].component, ALL_PINS[w.b].component] : pending ? [ALL_PINS[pending].component] : sel?.part ? [sel.part] : [];
    const fk = JSON.stringify(comps);
    if (fk !== lastFocusKey) { lastFocusKey = fk; emit('focus2d', { components: [...new Set(comps)], wire: w ? { from: ALL_PINS[w.a].port, to: ALL_PINS[w.b].port } : null, label: w ? `${pname(w.a)} ↔ ${pname(w.b)}` : pending ? pname(pending) : sel?.part ? NAME[sel.part] : '' }); }
  }
  on('trainMode', (d) => {
    const next = d?.mode || 'practice';
    if (next === 'exam') { if (!stash) stash = { parts, wires }; parts = {}; wires = []; }
    else if (trainMode === 'exam' && stash) { ({ parts, wires } = stash); stash = null; }
    trainMode = next; locked = false; pending = null; sel = null; result = null; hist = []; stopDemo(); gFx.replaceChildren(); report.replaceChildren(); draw();
  });
  on('examLock', (d) => { locked = !!d?.locked; pending = null; sel = null; draw(); });
  function sanitize(v) {
    const p = v?.parts && typeof v.parts === 'object' ? Object.fromEntries(Object.entries(v.parts).filter(([id, q]) => RECT[id] && Number.isFinite(q?.x) && Number.isFinite(q?.y)).map(([id, q]) => [id, { x: Math.round(q.x), y: Math.round(q.y), rot: [0, 90, 180, 270].includes(q.rot) ? q.rot : 0 }])) : null;
    if (!p) throw new Error('bad file');
    const w = Array.isArray(v.wires) ? v.wires.filter((x) => ALL_PINS[x?.a] && ALL_PINS[x?.b] && p[ALL_PINS[x.a].component] && p[ALL_PINS[x.b].component]).map((x, i) => ({ id: `b${i + 1}`, a: x.a, b: x.b })) : [];
    return { parts: p, wires: w };
  }
  function load() { try { return sanitize(JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { return { parts: {}, wires: [] }; } }
  function save() { if (isExam()) return; try { localStorage.setItem(STORE, JSON.stringify({ parts, wires })); } catch { /* 無痕模式 */ } }
  if (isExam()) { stash = { parts, wires }; parts = {}; wires = []; }
  addEventListener('resize', () => { if (active) fit(); });   // 手機轉向、視窗改變時重新適配
  root.classList.toggle('bench-dark', theme === 'dark'); bTheme.textContent = theme === 'dark' ? '☀' : '☾';
  applyView(); draw();
  return {
    setActive(onoff) { active = onoff; lastWiresKey = ''; lastFocusKey = ''; if (onoff) { draw(); openPalette(!Object.keys(parts).length && !isExam()); requestAnimationFrame(fit); } else stopDemo(); },
    get state() { return { parts, wires }; },
  };
}
