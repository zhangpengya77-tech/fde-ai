// F450 實訓中心｜引腳級 2D 接線畫布（P11，進階）
// 每個接頭展開成引腳，學員一根一根接（參照 FPV 接線模擬器的做法，但畫面與程式皆為自製）。
// Pixhawk 2.4.8 依 PX4 開源硬體 FMUv2.4.6（CC-BY-SA 3.0）電路板座標等比例繪製；接頭引腳為了好點選略為放大間距，
// 接頭中心位置維持實際比例。檢查規則在 pins.js；換算出的接頭級連線送給成績單、3D 線束與保存紀錄。
import { PORTS, COMPONENTS, PRACTICE_ONLY } from './model.js?v=p4-1';
import { ALL_PINS, EXPECTED_PIN_WIRES, PORT_PINS, PIN_WIRE_TOTAL, pinId, validatePinWiring } from './pins.js?v=p11-1';
import { emit, on, latest } from './bus.js?v=p4-1';

const NS = 'http://www.w3.org/2000/svg';
const STORE = 'f450twin-wirepin-v1';
const W = 1400, H = 1100;
const KIND_COLOR = { v5: '#e53935', v33: '#ff8a65', pos: '#e53935', gnd: '#222', neg: '#222', tx: '#1e88e5', rx: '#43a047', scl: '#8e24aa', sda: '#00897b', sig: '#fdd835', phase: '#90a4ae', cur: '#fb8c00', volt: '#ffb300', led: '#26c6da', safety: '#ab47bc', buzz: '#ec407a', nc: '#555', can: '#555' };

// ───────── Pixhawk：PCB 座標（mm）→ 畫布（機頭朝上：x_mm 70 在上、y_mm 0 在左） ─────────
const S = 8, CASE = [500, 140, 400, 660];                 // 外殼 50×82 mm 左右（官方 81.5×50×15.5 mm）
const px = (xmm, ymm) => [CASE[0] + 38 + ymm * S, CASE[1] + 46 + (70 - xmm) * S];
// 接頭中心（FMUv2.4.6 電路板元件座標）
const FMU = {
  'pixhawk.power': [65.43, 33.53, 'POWER'], 'pixhawk.gps': [34.95, 6.91, 'GPS'], 'pixhawk.i2c': [57.71, 5.69, 'I2C'],
  'pixhawk.switch': [27.23, 20.32, 'SWITCH'], 'pixhawk.buzzer': [18.29, 15.65, 'BUZZER'],
};
const FMU_OTHER = [[27.17, 33.74, 'TELEM2', 6], [35.04, 33.74, 'TELEM1', 6], [42.67, 34.75, 'USB', 4], [57.71, 32.92, 'SPI', 7], [27.23, 6.91, 'SERIAL4/5', 6], [42.67, 5.69, 'CAN', 4], [65.43, 5.28, 'ADC6.6', 3], [42.67, 20.32, 'ADC3.3', 5], [19.91, 25.81, 'SPKT', 3]];
// 後端伺服排針 J901：16 欄 × 3 列（上：S、中：＋、下：−），左起 RC IN、S.B.OUT、MAIN 8→1、AUX 6→1；間距 2.54 mm
const RAIL_X0 = CASE[0] + 50, RAIL_Y = CASE[1] + CASE[3] - 92, RAIL_P = 20.3;
const RAIL_COL = { 'pixhawk.rc_in': 0, 'pixhawk.main_out_4': 6, 'pixhawk.main_out_3': 7, 'pixhawk.main_out_2': 8, 'pixhawk.main_out_1': 9 };

// 一般接頭：{ at:[中心 x, y], dir:'h'|'v', pitch }；pins 依 PORT_PINS 順序排列
const SPOT = {};
const header = (port, x, y, dir = 'h', pitch = 16) => { SPOT[port] = { x, y, dir, pitch }; };
for (const [port, [xm, ym]] of Object.entries(FMU)) { const [x, y] = px(xm, ym); header(port, x, y, 'h', 16); }
// 周邊（自製簡化外形；R9DS 依官方尺寸 43×24×15 mm 比例）
const BOX = {
  motor_fl: [40, 20, 160, 70, '2212 馬達 左前'], esc_fl: [40, 140, 190, 120, 'ESC 左前（20A）'],
  motor_fr: [1200, 20, 160, 70, '2212 馬達 右前'], esc_fr: [1170, 140, 190, 120, 'ESC 右前（20A）'],
  esc_rl: [40, 830, 190, 120, 'ESC 左後（20A）'], motor_rl: [40, 1000, 160, 70, '2212 馬達 左後'],
  esc_rr: [1170, 830, 190, 120, 'ESC 右後（20A）'], motor_rr: [1200, 1000, 160, 70, '2212 馬達 右後'],
  gps: [280, 170, 160, 190, 'GPS／羅盤（M8N）'], buzzer: [300, 560, 140, 70, '蜂鳴器'],
  receiver: [250, 700, 190, 106, 'R9DS 接收機'], safety_switch: [980, 470, 150, 80, '安全開關'],
  pdb: [470, 880, 460, 110, '下中心板（配電）'], power_module: [990, 640, 170, 110, '電源模組'], battery: [1000, 1000, 160, 70, '4S 電池'],
};
const edge = (cid, side, t) => { const [x, y, w, h] = BOX[cid]; return side === 'top' ? [x + w * t, y] : side === 'bottom' ? [x + w * t, y + h] : side === 'left' ? [x, y + h * t] : [x + w, y + h * t]; };
const put = (port, cid, side, t, pitch = 16) => { const [x, y] = edge(cid, side, t); header(port, x, y, side === 'left' || side === 'right' ? 'v' : 'h', pitch); };
put('motor_fl.phase', 'motor_fl', 'bottom', 0.5); put('esc_fl.phase', 'esc_fl', 'top', 0.5); put('esc_fl.power', 'esc_fl', 'bottom', 0.5); put('esc_fl.signal', 'esc_fl', 'right', 0.5);
put('motor_fr.phase', 'motor_fr', 'bottom', 0.5); put('esc_fr.phase', 'esc_fr', 'top', 0.5); put('esc_fr.power', 'esc_fr', 'bottom', 0.5); put('esc_fr.signal', 'esc_fr', 'left', 0.5);
put('esc_rl.power', 'esc_rl', 'top', 0.5); put('esc_rl.phase', 'esc_rl', 'bottom', 0.5); put('esc_rl.signal', 'esc_rl', 'right', 0.5); put('motor_rl.phase', 'motor_rl', 'top', 0.5);
put('esc_rr.power', 'esc_rr', 'top', 0.5); put('esc_rr.phase', 'esc_rr', 'bottom', 0.5); put('esc_rr.signal', 'esc_rr', 'left', 0.5); put('motor_rr.phase', 'motor_rr', 'top', 0.5);
put('gps.serial', 'gps', 'right', 0.3); put('gps.compass', 'gps', 'right', 0.74);
put('buzzer.conn', 'buzzer', 'right', 0.5); put('receiver.sbus', 'receiver', 'right', 0.62, 16); put('safety_switch.conn', 'safety_switch', 'left', 0.5);
put('pdb.pad_fl', 'pdb', 'left', 0.3); put('pdb.pad_rl', 'pdb', 'left', 0.75); put('pdb.pad_fr', 'pdb', 'right', 0.3); put('pdb.pad_rr', 'pdb', 'right', 0.75); put('pdb.in', 'pdb', 'bottom', 0.75);
put('power_module.in', 'power_module', 'bottom', 0.5); put('power_module.out', 'power_module', 'left', 0.75); put('power_module.fc', 'power_module', 'top', 0.5, 15);
put('battery.xt60', 'battery', 'top', 0.5);

// 每根引腳的座標
const PIN_POS = {};
for (const [port, pins] of Object.entries(PORT_PINS)) {
  if (port in RAIL_COL) {
    const x = RAIL_X0 + RAIL_COL[port] * RAIL_P;
    pins.forEach((p, i) => { PIN_POS[pinId(port, p.id)] = { x, y: RAIL_Y + i * 20, n: [0, 1] }; });
    continue;
  }
  const s = SPOT[port]; if (!s) continue;
  pins.forEach((p, i) => {
    const o = (i - (pins.length - 1) / 2) * s.pitch;
    const x = s.dir === 'h' ? s.x + o : s.x, y = s.dir === 'h' ? s.y : s.y + o;
    const n = port.startsWith('pixhawk.') ? [0, -1] : s.dir === 'h' ? [0, s.y <= BOX[port.split('.')[0]]?.[1] + 1 ? -1 : 1] : [s.x <= BOX[port.split('.')[0]]?.[0] + 1 ? -1 : 1, 0];
    PIN_POS[pinId(port, p.id)] = { x, y, n };
  });
}
export { PIN_POS, BOX, CASE, px, FMU, FMU_OTHER, RAIL_X0, RAIL_Y, RAIL_P, RAIL_COL, KIND_COLOR };   // P12 工作台沿用同一份幾何

export function initPinCanvas(root) {
  if (!root) return null;
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  const sv = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  let wires = load(), pending = null, selected = null, result = null, seq = wires.length, active = false;
  let trainMode = latest('trainMode')?.mode || 'practice', locked = !!latest('examLock')?.locked, stash = null, lastWiresKey = '', lastFocusKey = '';
  const isExam = () => trainMode === 'exam';

  root.replaceChildren();
  const tools = el('span', null, 'w2-tools');
  const B = (t, cls) => { const b = el('button', t, cls); b.type = 'button'; tools.append(b, ' '); return b; };
  const bCheck = B('✓ 檢查引腳接線', 'primary'), bDel = B('刪除這根線'), bUndo = B('復原'), bClear = B('全部清除'), bDemo = B('▶ 完整引腳示範');
  const title = el('b', '引腳級接線（進階）');
  const head = el('div', null, 'row between'); head.append(title, tools);
  const status = el('p', '先點一根引腳（小圓點），再點要接的另一根引腳。', 'w2-status'); status.setAttribute('aria-live', 'polite');
  const scroller = el('div', null, 'w2-scroll pin-scroll');
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w2-svg pin-svg', role: 'application', 'aria-label': 'F450 引腳級接線畫布' });
  scroller.append(svg);
  const results = el('div', null, 'w2-results');
  const legend = el('p', null, 'note w2-legend');
  [['v5', '5V／＋'], ['gnd', 'GND／−'], ['tx', 'TX'], ['rx', 'RX'], ['scl', 'SCL'], ['sda', 'SDA'], ['sig', '訊號 S'], ['phase', '三相']].forEach(([k, t]) => { const s = el('span', `● ${t}`); s.style.color = k === 'gnd' ? '#9aa4ae' : KIND_COLOR[k]; legend.append(s); });
  root.append(head, status, scroller, legend, results,
    el('p', 'Pixhawk 2.4.8 依 PX4 開源硬體 FMUv2.4.6 電路板座標等比例繪製（© PX4／3D Robotics，CC-BY-SA 3.0；本圖同授權）。引腳依 PX4 官方《Pixhawk 1》引腳表；R9DS 依樂迪官方說明書（SBUS 由 CH9 輸出）。GPS 模組端、電調是否有 BEC、接頭類型（DF13／PicoBlade）待實機核對。', 'note'),
    el('p', PRACTICE_ONLY ? '練習用：規則待教師以實機核對，結果不計正式成績。實際接線前務必先拆槳、斷電。' : '', 'note'));

  const gArt = sv('g'), gWires = sv('g', { class: 'w2-wires' }), gPins = sv('g'), gDemo = sv('g', { class: 'w2-demo', 'pointer-events': 'none' }), gPrev = sv('path', { class: 'w2-preview', d: '' });
  svg.append(gArt, gWires, gPins, gDemo, gPrev);
  const add = (parent, tag, attrs, text) => { const e = sv(tag, attrs); if (text != null) e.textContent = text; parent.append(e); return e; };

  // ───────── 外形 ─────────
  // Pixhawk 外殼、PCB、接頭印字
  add(gArt, 'rect', { x: CASE[0], y: CASE[1], width: CASE[2], height: CASE[3], rx: 26, fill: '#16191d', stroke: '#454c55', 'stroke-width': 3 });
  add(gArt, 'path', { d: `M${CASE[0] + CASE[2] / 2},${CASE[1] + 20} l14,22 h-8 v14 h-12 v-14 h-8 z`, fill: '#e8ecef' });
  add(gArt, 'text', { x: CASE[0] + CASE[2] / 2, y: CASE[1] + 190, 'text-anchor': 'middle', class: 'pin-silk big' }, 'Pixhawk 2.4.8');
  add(gArt, 'text', { x: CASE[0] + CASE[2] / 2, y: CASE[1] + 208, 'text-anchor': 'middle', class: 'pin-silk' }, '箭頭＝機頭方向');
  const silk = (x, y, t) => add(gArt, 'text', { x, y, 'text-anchor': 'middle', class: 'pin-silk' }, t);
  for (const [xm, ym, name, n] of FMU_OTHER) {   // 這台不用的接頭：灰色、不能點
    const [x, y] = px(xm, ym);
    add(gArt, 'rect', { x: x - n * 6 - 4, y: y - 6, width: n * 12 + 8, height: 12, rx: 2, fill: '#2c3239', stroke: '#4b535c' });
    silk(x, y - 11, name);
  }
  for (const [port, [xm, ym, name]] of Object.entries(FMU)) {
    const [x, y] = px(xm, ym), n = PORT_PINS[port].length;
    add(gArt, 'rect', { x: x - n * 8 - 6, y: y - 9, width: n * 16 + 12, height: 18, rx: 3, fill: '#f2f2f2', stroke: '#7ee8c8', 'stroke-width': 2 });
    silk(x, y - 15, name);
  }
  // 伺服排針
  for (let col = 0; col < 16; col++) for (let row = 0; row < 3; row++) add(gArt, 'rect', { x: RAIL_X0 + col * RAIL_P - 3, y: RAIL_Y + row * 20 - 3, width: 6, height: 6, fill: ['#e8e2c8', '#c0392b', '#2a2a2a'][row] });
  silk(RAIL_X0, RAIL_Y - 14, 'RC');
  silk(RAIL_X0 + 1 * RAIL_P, RAIL_Y - 14, 'SB');
  silk(RAIL_X0 + 5.5 * RAIL_P, RAIL_Y - 28, 'MAIN OUT 8 ← 1'); [8, 7, 6, 5, 4, 3, 2, 1].forEach((m, i) => silk(RAIL_X0 + (2 + i) * RAIL_P, RAIL_Y - 14, String(m)));
  silk(RAIL_X0 + 12.5 * RAIL_P, RAIL_Y - 28, 'AUX 6 ← 1');
  ['S', '＋', '−'].forEach((t, i) => add(gArt, 'text', { x: RAIL_X0 - 22, y: RAIL_Y + i * 20 + 4, 'text-anchor': 'end', class: 'pin-silk' }, t));
  // 周邊外形
  for (const [cid, [x, y, w, h, name]] of Object.entries(BOX)) {
    const kind = cid.replace(/_(fr|fl|rl|rr)$/, '');
    const fill = { esc: '#e2bd2b', motor: '#c9a227', gps: '#121417', buzzer: '#15181c', receiver: '#15181c', safety_switch: '#15181c', pdb: '#1b222b', power_module: '#1e6b44', battery: '#15181c' }[kind];
    const g = add(gArt, 'g', { class: 'pin-comp', 'data-comp': cid });
    add(g, 'rect', { x, y, width: w, height: h, rx: 10, fill, stroke: kind === 'pdb' ? '#c9a227' : '#3a4048', 'stroke-width': 2 });
    const ny = kind === 'gps' ? y + h - 14 : kind === 'receiver' ? y + 84 : y + h / 2 + 6;   // GPS、R9DS 名稱放下方，不壓到外形
    add(g, 'text', { x: x + w / 2, y: ny, 'text-anchor': 'middle', class: `pin-name${['esc', 'motor'].includes(kind) ? ' dark' : ''}` }, name);
    if (kind === 'receiver') {   // R9DS：CH1–CH9 排針（只有 CH9 會用到，SBUS 模式）
      for (let c = 0; c < 9; c++) for (let r = 0; r < 3; r++) add(g, 'rect', { x: x + 14 + c * 14, y: y + 14 + r * 12, width: 5, height: 5, fill: ['#e8e2c8', '#c0392b', '#2a2a2a'][r] });
      add(g, 'text', { x: x + 14 + 8 * 14 + 2, y: y + 62, 'text-anchor': 'middle', class: 'pin-silk' }, 'CH9 SBUS');
      add(g, 'text', { x: x + 16, y: y + h - 6, class: 'pin-silk' }, '43×24×15 mm');
    }
    if (kind === 'gps') { add(g, 'circle', { cx: x + 60, cy: y + 70, r: 40, fill: '#0c0d0f', stroke: '#e8ecef', 'stroke-width': 4 }); add(g, 'path', { d: `M${x + 60},${y + 46} l12,18 h-7 v18 h-10 v-18 h-7 z`, fill: '#d63c3c' }); }
  }

  // ───────── 引腳 ─────────
  const pinEls = {};
  for (const [pid, pos] of Object.entries(PIN_POS)) {
    const P = ALL_PINS[pid];
    const g = add(gPins, 'g', { class: 'pin', 'data-pin': pid, tabindex: 0, role: 'button', 'aria-label': `${P.port} ${P.label}` });
    add(g, 'circle', { cx: pos.x, cy: pos.y, r: 6, fill: '#0b1b2b', stroke: KIND_COLOR[P.kind] === '#222' ? '#9aa4ae' : KIND_COLOR[P.kind], 'stroke-width': 2.5 });
    const isRail = /pixhawk\.(rc_in|main_out)/.test(P.port);
    // 標籤：直排接頭放左右；橫排接頭斜放避免重疊（Pixhawk 放在引腳下方，上方留給接頭名稱）
    if (!isRail) {
      const onFmu = P.port.startsWith('pixhawk.'), horiz = pos.n[0] === 0;
      if (horiz) {
        const down = onFmu || pos.n[1] > 0, lx = pos.x - 2, ly = pos.y + (down ? 13 : -11);
        add(g, 'text', { x: lx, y: ly, 'text-anchor': 'start', class: 'pin-label', transform: `rotate(${down ? 55 : -55} ${lx} ${ly})` }, P.label);
      } else add(g, 'text', { x: pos.x + pos.n[0] * 10, y: pos.y + 4, 'text-anchor': pos.n[0] < 0 ? 'end' : 'start', class: 'pin-label' }, P.label);
    }
    g.addEventListener('click', (e) => { e.stopPropagation(); clickPin(pid); });
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickPin(pid); } });
    pinEls[pid] = g;
  }

  // ───────── 互動 ─────────
  const name = (pid) => { const P = ALL_PINS[pid]; const c = COMPONENTS.find((x) => x.id === P.component); return `${c ? c.zh : P.component} ${PORTS[P.port]?.label || ''} ${P.label}`; };
  function say(t) { status.textContent = t; }
  function clickPin(pid) {
    if (locked) return say('已交卷，接線已鎖定');
    if (!pending) { pending = pid; selected = null; say(`已選 ${name(pid)}，再點要接的另一根引腳（Esc 取消）`); return draw(); }
    if (pending === pid) { pending = null; say('已取消'); return draw(); }
    const w = { id: `q${++seq}`, a: pending, b: pid };
    wires.push(w); pending = null; selected = w.id; result = null;
    say(`已接：${name(w.a)} ↔ ${name(w.b)}`); save(); draw();
  }
  svg.addEventListener('click', () => { if (pending || selected) { pending = null; selected = null; draw(); } });
  svg.addEventListener('pointermove', (e) => {
    if (!pending) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const m = pt.matrixTransform(svg.getScreenCTM().inverse()), a = PIN_POS[pending];
    gPrev.setAttribute('d', `M${a.x},${a.y} L${m.x},${m.y}`);
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pending) { pending = null; say('已取消'); draw(); } });
  bDel.onclick = () => { if (locked || !selected) return; wires = wires.filter((w) => w.id !== selected); selected = null; result = null; save(); draw(); };
  bUndo.onclick = () => { if (locked) return; wires.pop(); selected = null; result = null; save(); draw(); };
  bClear.onclick = () => { if (locked || !wires.length || !confirm('清除全部引腳接線？')) return; wires = []; selected = null; result = null; save(); draw(); };
  bCheck.onclick = () => { if (isExam()) return; result = validatePinWiring(wires); draw(); };
  let demoTimer = null;
  function stopDemo() { clearInterval(demoTimer); demoTimer = null; gDemo.replaceChildren(); bDemo.textContent = '▶ 完整引腳示範'; }
  bDemo.onclick = () => {
    if (demoTimer || gDemo.childNodes.length) { stopDemo(); return; }
    const all = EXPECTED_PIN_WIRES.map((e) => ({ a: e.a, b: e.phase ? e.b.replace('#null', `#${e.a.split('#')[1]}`) : e.b })); let k = 0;
    bDemo.textContent = '■ 停止並清除示範';
    demoTimer = setInterval(() => {
      if (k >= all.length) { clearInterval(demoTimer); demoTimer = null; bDemo.textContent = '■ 清除示範'; say(`示範完成：共 ${all.length} 根。可以照著自己接一次，再按「檢查引腳接線」。`); return; }
      const w = all[k++]; gDemo.append(sv('path', { d: path(w.a, w.b), class: 'demo-line', stroke: color(w) }));
      say(`示範第 ${k}／${all.length} 根：${name(w.a)} → ${name(w.b)}`);
    }, 250);
  };

  // ───────── 繪製 ─────────
  const color = (w) => { const k = ALL_PINS[w.a].kind; return k === 'gnd' || k === 'neg' ? '#cfd6dd' : KIND_COLOR[k]; };
  function path(a, b) {
    const A = PIN_POS[a], Bp = PIN_POS[b], d = Math.max(50, Math.hypot(A.x - Bp.x, A.y - Bp.y) * 0.3);
    return `M${A.x},${A.y} C${A.x + A.n[0] * d},${A.y + A.n[1] * d} ${Bp.x + Bp.n[0] * d},${Bp.y + Bp.n[1] * d} ${Bp.x},${Bp.y}`;
  }
  function draw() {
    if (trainMode === 'teach') result = validatePinWiring(wires);
    if (isExam()) result = null;
    bCheck.hidden = isExam() || trainMode === 'teach'; bDemo.hidden = isExam(); [bDel, bUndo, bClear].forEach((b) => (b.disabled = locked));
    title.textContent = `引腳級接線（進階・${{ teach: '教學', practice: '練習', exam: locked ? '考核・已交卷' : '考核' }[trainMode]}）`;
    gWires.replaceChildren(); gPrev.setAttribute('d', '');
    const bad = new Set((result?.issues || []).map((i) => i.wire).filter(Boolean));
    for (const w of wires) {
      if (!PIN_POS[w.a] || !PIN_POS[w.b]) continue;
      const g = add(gWires, 'g', { class: `w2-wire pinwire${w.id === selected ? ' sel' : ''}${bad.has(w.id) ? ' bad' : result ? ' good' : ''}`, 'data-pinwire': w.id });
      const d = path(w.a, w.b);
      add(g, 'path', { d, class: 'hit' }); add(g, 'path', { d, class: 'line', stroke: color(w) });
      g.addEventListener('click', (e) => { e.stopPropagation(); if (locked) return; pending = null; selected = w.id; say(`已選：${name(w.a)} ↔ ${name(w.b)}`); draw(); });
    }
    const used = new Set(wires.flatMap((w) => [w.a, w.b]));
    const sug = new Set(trainMode === 'teach' && pending ? EXPECTED_PIN_WIRES.flatMap((e) => (e.a === pending ? [e.phase ? null : e.b] : e.b === pending ? [e.a] : [])).filter(Boolean) : []);
    if (trainMode === 'teach' && pending && ALL_PINS[pending].kind === 'phase') EXPECTED_PIN_WIRES.filter((e) => e.phase && e.a.split('#')[0] === pending.split('#')[0]).forEach((e) => ['a', 'b', 'c'].forEach((x) => sug.add(e.b.replace('#null', `#${x}`))));
    for (const [pid, g] of Object.entries(pinEls)) { g.classList.toggle('used', used.has(pid)); g.classList.toggle('pending', pid === pending); g.classList.toggle('suggest', sug.has(pid)); }
    renderResults(); syncOut();
  }
  const CODE_ZH = { SHORT: '短路', TX_NOT_CROSSED: 'TX／RX 沒交叉', UNUSED_PIN: '不用的腳', ESC_RED_ON_RAIL: '電調紅線', PIN_WRONG: '接錯腳', PIN_MISSING: '缺線', PIN_BUSY: '一腳多線', DUPLICATE: '重複', SELF_LOOP: '自己接自己', UNKNOWN_PIN: '未知引腳' };
  function renderResults() {
    results.replaceChildren();
    if (isExam()) { results.append(el('p', locked ? `已交卷：共 ${wires.length} 根線。` : `考核中：目前 ${wires.length} 根線（共需 ${PIN_WIRE_TOTAL} 根），不能自行檢查。`, 'note')); return; }
    if (!result) { results.append(el('p', `目前 ${wires.length} 根線（正確接線共 ${PIN_WIRE_TOTAL} 根）。接完後按「✓ 檢查引腳接線」。`, 'note')); return; }
    const errs = result.issues.filter((i) => i.code !== 'PIN_MISSING');
    results.append(el('p', result.complete ? `✓ 全部 ${PIN_WIRE_TOTAL} 根都接對了` : `接對 ${result.ok}／${PIN_WIRE_TOTAL} 根｜錯誤 ${errs.length} 處｜完成連線 ${result.links.length}／20 條`, `w2-sum ${result.complete ? 'ok' : 'bad'}`));
    if (result.issues.length) { const ul = el('ul', null, 'w2-issues'); result.issues.slice(0, 30).forEach((i) => ul.append(el('li', `${CODE_ZH[i.code] || i.code}：${i.message}`))); results.append(ul); }
  }
  // 換算成接頭級連線送出（只有目前顯示的畫布會送）
  function syncOut() {
    if (!active) return;
    const r = validatePinWiring(wires);
    const wk = JSON.stringify([r.links, r.issues.map((i) => i.code + i.wire)]);
    if (wk !== lastWiresKey) { lastWiresKey = wk; emit('wires2d', { wires: r.links, result: null, show: !!latest('wires2d')?.show, pinIssues: r.issues.filter((i) => i.code !== 'PIN_MISSING'), level: 'pin' }); }
    const w = wires.find((x) => x.id === selected);
    const comps = w ? [ALL_PINS[w.a].component, ALL_PINS[w.b].component] : pending ? [ALL_PINS[pending].component] : [];
    const fk = JSON.stringify(comps);
    if (fk !== lastFocusKey) { lastFocusKey = fk; emit('focus2d', { components: [...new Set(comps)], wire: w ? { from: ALL_PINS[w.a].port, to: ALL_PINS[w.b].port } : null, label: w ? `${name(w.a)} ↔ ${name(w.b)}` : pending ? name(pending) : '' }); }
  }
  on('trainMode', (d) => {
    const next = d?.mode || 'practice';
    if (next === 'exam') { if (!stash) stash = wires; wires = []; }
    else if (trainMode === 'exam' && stash) { wires = stash; stash = null; }
    trainMode = next; locked = false; pending = null; selected = null; result = null; stopDemo(); draw();
  });
  on('examLock', (d) => { locked = !!d?.locked; pending = null; selected = null; draw(); });
  function load() { try { const v = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(v) ? v.filter((w) => ALL_PINS[w.a] && ALL_PINS[w.b]) : []; } catch { return []; } }
  function save() { if (isExam()) return; try { localStorage.setItem(STORE, JSON.stringify(wires)); } catch { /* 無痕模式 */ } }
  if (isExam()) { stash = wires; wires = []; }
  draw();
  return {
    setActive(on) { active = on; lastWiresKey = ''; lastFocusKey = ''; if (on) draw(); else stopDemo(); },
    get wires() { return wires; },
  };
}
