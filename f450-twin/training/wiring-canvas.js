// F450 實訓中心｜2D 接線畫布（P3）
// 原生 SVG，不依賴 3D／WebGL。元件、接口、檢查規則全部來自 model.js（與 3D 組裝共用）。
// 操作：點一個接口、再點另一個接口 → 連線；點線 → 選取，可刪除或「紅黑對調」；按「檢查接線」看結果。
// 草稿只存在這台裝置的瀏覽器（localStorage）；不記錄成績（P5／P6 才接判分與任務卡）。
import { COMPONENTS, PORTS, EXPECTED_WIRES, PRACTICE_ONLY, validateWiring } from './model.js?v=p4-1';
import { emit, on, latest } from './bus.js?v=p4-1';
import { PART_INFO, drawArt, infoKey } from './parts-art.js?v=p9-5';   // 零件擬真圖與官方資料連結   // P4：與 3D 同步；P5：教學／練習／考核

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
  // 周邊放在它要接的 Pixhawk 接口旁邊（依 Pixhawk 2.4.8 說明書的接口位置）
  receiver: [215, 372, 170, 56, { 'receiver.sbus': { side: 'bottom', at: [85, 56], label: 'SBUS 輸出' } }],
  gps: [230, 128, 120, 104, { 'gps.serial': { side: 'right', at: [120, 37], label: 'GPS', inside: true }, 'gps.compass': { side: 'right', at: [120, 67], label: '羅盤', inside: true } }],
  // Pixhawk 2.4.8 直立擺放、箭頭（機頭）朝上：舵機排針在下方（左起 RC IN、S.B.OUT、MAIN OUT 8→1、AUX OUT 6→1），
  // 左列（前→後）ADC6.6、I2C、CAN、GPS、SERIAL4/5、BUZZER；右列 POWER、SPI、USB、TELEM1、TELEM2、SPKT/DSM；中間 ADC3.3、SWITCH
  pixhawk: [410, 120, 180, 310, {
    'pixhawk.rc_in': { side: 'bottom', at: [22, 310], label: 'RC IN' },
    'pixhawk.main_out_4': { side: 'bottom', at: [66, 310], label: 'M4' },
    'pixhawk.main_out_3': { side: 'bottom', at: [92, 310], label: 'M3' },
    'pixhawk.main_out_2': { side: 'bottom', at: [118, 310], label: 'M2' },
    'pixhawk.main_out_1': { side: 'bottom', at: [144, 310], label: 'M1' },
    'pixhawk.i2c': { side: 'left', at: [0, 75], label: '' },
    'pixhawk.gps': { side: 'left', at: [0, 145], label: '' },
    'pixhawk.buzzer': { side: 'left', at: [0, 215], label: '' },
    'pixhawk.power': { side: 'right', at: [180, 40], label: '' },
    'pixhawk.switch': { side: 'right', at: [180, 248], label: '' },
  }],
  safety_switch: [640, 343, 140, 50, { 'safety_switch.conn': { side: 'left', at: [0, 25], label: '' } }],   // 標籤會壓到 Pixhawk 印字，省略（說明列有寫）
  buzzer: [220, 300, 130, 50, { 'buzzer.conn': { side: 'right', at: [130, 35], label: '2pin' } }],
  pdb: [300, 468, 400, 84, { 'pdb.pad_fl': 'left', 'pdb.pad_rl': 'left', 'pdb.pad_fr': 'right', 'pdb.pad_rr': 'right', 'pdb.in': 'bottom' }],
  power_module: [440, 610, 220, 80, { 'power_module.in': 'left', 'power_module.out': 'top', 'power_module.fc': 'right' }],
  battery: [190, 630, 150, 60, { 'battery.xt60': 'top' }],
};
const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const KIND_COLOR = { power: '#ff6a4d', signal: '#3fd0ff', data: '#7ee8c8' };
const roleKind = (role) => (role.startsWith('power') ? 'power' : role.startsWith('signal') ? 'signal' : 'data');

// 每個接口的座標與朝外方向。值可以是邊（平均分配），或 { side, at: [框內 x, 框內 y], label, inside } 指定位置與標籤
const PORT_POS = {};
for (const [cid, [x, y, w, h, sides]] of Object.entries(LAYOUT)) {
  const bySide = {};
  for (const [pid, v] of Object.entries(sides)) {
    if (typeof v === 'object') { PORT_POS[pid] = { x: x + v.at[0], y: y + v.at[1], n: SIDE_N[v.side], side: v.side, cid, label: v.label, inside: !!v.inside }; continue; }
    (bySide[v] ||= []).push(pid);
  }
  for (const [side, list] of Object.entries(bySide)) {
    list.forEach((pid, i) => {
      const t = (i + 1) / (list.length + 1);
      const px = side === 'left' ? x : side === 'right' ? x + w : x + w * t;
      const py = side === 'top' ? y : side === 'bottom' ? y + h : y + h * t;
      PORT_POS[pid] = { x: px, y: py, n: SIDE_N[side], side, cid };
    });
  }
}

// ───────── 完整接線方式（依 ArduPilot、PX4 官方文件；GitHub 原始文件同步列出） ─────────
const DOC = {
  px4: ['PX4：Pixhawk 接線快速入門', 'https://docs.px4.io/main/en/assembly/quick_start_pixhawk.html', 'https://github.com/PX4/PX4-user_guide/blob/main/en/assembly/quick_start_pixhawk.md'],
  ap: ['ArduPilot：Pixhawk 接線快速入門', 'https://ardupilot.org/copter/docs/common-pixhawk-wiring-and-quick-start.html', 'https://github.com/ArduPilot/ardupilot_wiki/blob/master/common/source/docs/common-pixhawk-wiring-and-quick-start.rst'],
  motors: ['ArduPilot：電調與馬達接線（Quad X）', 'https://ardupilot.org/copter/docs/connect-escs-and-motors.html', 'https://github.com/ArduPilot/ardupilot_wiki/blob/master/copter/source/docs/connect-escs-and-motors.rst'],
};
// 安裝順序：先電源路徑、再馬達、再訊號、最後周邊。id 對應 model.js 的 EXPECTED_WIRES
export const WIRING_GUIDE = [
  ['① 電源路徑', [
    ['battery.xt60--power_module.in', '電池 XT60 接電源模組輸入（XT60 有防呆方向）', ['px4']],
    ['power_module.out--pdb.in', '電源模組主輸出接配電板，再分給四顆電調', ['px4']],
    ['power_module.fc--pixhawk.power', '電源模組 6pin 線接 Pixhawk POWER：供電並量測電壓電流', ['px4', 'ap']],
    ['pdb.pad_fr--esc_fr.power', '配電板焊盤 → 右前電調電源（紅正黑負）', ['motors']],
    ['pdb.pad_fl--esc_fl.power', '配電板焊盤 → 左前電調電源（紅正黑負）', ['motors']],
    ['pdb.pad_rl--esc_rl.power', '配電板焊盤 → 左後電調電源（紅正黑負）', ['motors']],
    ['pdb.pad_rr--esc_rr.power', '配電板焊盤 → 右後電調電源（紅正黑負）', ['motors']],
  ]],
  ['② 電調與馬達', [
    ['esc_fr.phase--motor_fr.phase', '右前電調三相線 → 右前馬達（轉向不對時交換任兩條）', ['motors']],
    ['esc_fl.phase--motor_fl.phase', '左前電調三相線 → 左前馬達', ['motors']],
    ['esc_rl.phase--motor_rl.phase', '左後電調三相線 → 左後馬達', ['motors']],
    ['esc_rr.phase--motor_rr.phase', '右後電調三相線 → 右後馬達', ['motors']],
  ]],
  ['③ 電調訊號（Quad X 馬達編號＝MAIN OUT 編號）', [
    ['esc_fr.signal--pixhawk.main_out_1', '馬達 1 右前（CCW）→ MAIN OUT 1；訊號線與地線一起接', ['motors']],
    ['esc_rl.signal--pixhawk.main_out_2', '馬達 2 左後（CCW）→ MAIN OUT 2', ['motors']],
    ['esc_fl.signal--pixhawk.main_out_3', '馬達 3 左前（CW）→ MAIN OUT 3', ['motors']],
    ['esc_rr.signal--pixhawk.main_out_4', '馬達 4 右後（CW）→ MAIN OUT 4', ['motors']],
  ]],
  ['④ 遙控與周邊', [
    ['receiver.sbus--pixhawk.rc_in', 'R9DS（SBUS 模式）3pin 線 → RC IN', ['px4', 'ap']],
    ['gps.serial--pixhawk.gps', 'GPS 6pin 線 → GPS 埠（圓餅箭頭朝機頭、遠離電源線）', ['px4', 'ap']],
    ['gps.compass--pixhawk.i2c', '羅盤 4pin 線 → I2C 埠', ['px4', 'ap']],
    ['safety_switch.conn--pixhawk.switch', '安全開關 3pin → SWITCH（必接）', ['px4', 'ap']],
    ['buzzer.conn--pixhawk.buzzer', '蜂鳴器 2pin → BUZZER（必接）', ['px4', 'ap']],
  ]],
];
export const WIRING_NOTES = [
  ['Pixhawk 不供電給舵機排針：MAIN OUT 只有訊號；多軸的電調由電池供電，接訊號線與地線即可。', 'ap'],
  ['電調訊號線一定要和地線一起接，不可只接訊號線。', 'ap'],
  ['若多顆電調都有 BEC，排針只保留一顆的紅線（正極），其他拔掉，避免互相干擾。', 'ap'],
  ['RC IN 只適合低耗電的接收機；不要在接收機上直接接舵機或繼電器。', 'ap'],
  ['（選配，不計分）數傳模組接 TELEM1，地面站另一顆用 USB 接電腦。', 'px4'],
  ['任何通電測試前必須先拆槳。', 'ap'],
];

export function initWiringCanvas(root) {
  if (!root) return null;
  let activeLevel = true;   // P11：接頭級／引腳級切換
  let trainMode = latest('trainMode')?.mode || 'practice', locked = !!latest('examLock')?.locked, stash = null;   // P5
  const isExam = () => trainMode === 'exam';
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
  const title = el('b', '2D 接線練習');
  head.append(title, tools);
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
  const info = el('div', null, 'w2-info'); info.setAttribute('aria-live', 'polite');
  const guide = el('details', null, 'w2-guide');
  const gsum = el('summary', '完整接線方式（依 ArduPilot、PX4 官方文件，含 GitHub 原始文件）');
  const bDemo = el('button', '▶ 完整接線示範'); bDemo.type = 'button';
  const demoCap = el('p', null, 'note w2-demo-cap'); demoCap.setAttribute('aria-live', 'polite');
  guide.append(gsum, el('p', '打開會看到全部答案。示範只畫在獨立圖層，不會改動你自己的接線；考核模式不提供。', 'note'), bDemo, demoCap);
  const linkA = (label, href) => { const a = el('a', label); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
  let n = 0;
  for (const [title, rows] of WIRING_GUIDE) {
    guide.append(el('h4', title));
    const ol = el('ol', null, 'w2-steps'); ol.start = n + 1;
    for (const [id, text, refs] of rows) {
      n++;
      const li = el('li'); li.dataset.guideWire = id; li.append(el('span', text));
      const src = el('span', null, 'w2-src'); src.append(' 依據：');
      refs.forEach((r) => { src.append(linkA(DOC[r][0], DOC[r][1]), ' '); src.append(linkA('GitHub', DOC[r][2]), '　'); });
      li.append(src); ol.append(li);
    }
    guide.append(ol);
  }
  guide.append(el('h4', '⑤ 官方文件的注意事項'));
  const notes = el('ul', null, 'w2-steps');
  WIRING_NOTES.forEach(([t, r]) => { const li = el('li', t); li.append(' ', linkA('出處 ↗', DOC[r][1])); notes.append(li); });
  guide.append(notes);
  let demoTimer = null;
  function stopDemo(clear = true) { clearInterval(demoTimer); demoTimer = null; bDemo.textContent = '▶ 完整接線示範'; if (clear) { gDemo.replaceChildren(); demoCap.textContent = ''; } }
  bDemo.onclick = () => {
    if (demoTimer || gDemo.childNodes.length) { stopDemo(); return; }
    const all = WIRING_GUIDE.flatMap(([, rows]) => rows); let k = 0;
    bDemo.textContent = '■ 停止並清除示範';
    const step = () => {
      if (k >= all.length) { stopDemo(false); bDemo.textContent = '■ 清除示範'; demoCap.textContent = `示範完成：共 ${all.length} 條。可以照著自己接一次，再按「檢查接線」。`; return; }
      const [id, text] = all[k++]; const [a, b] = id.split('--');
      const kind = roleKind(PORTS[a].role);
      gDemo.append(sv('path', { d: path(a, b), class: 'demo-line', stroke: KIND_COLOR[kind] }));
      demoCap.textContent = `第 ${k}／${all.length} 條：${text}`;
    };
    step(); demoTimer = setInterval(step, 900);
  };
  root.append(head, syncRow, status, scroller, info, legend, results, guide,
    el('p', '操作：點一個接口（圓點）→ 再點要接的另一個接口，就會連線；點線可選取，再按「刪除這條線」或「紅黑對調」。鍵盤：Tab 移到接口、Enter 選取、Esc 取消。', 'note'),
    el('p', PRACTICE_ONLY ? '練習模式：接線規則依 Pixhawk 1／2.4.8 公開文件與教師安裝指導整理，全部待實機核對；不提供腳位定義，結果不記錄、不計正式成績。實際接線前務必先拆槳，並對照實機外殼印字。' : '', 'note'));

  const gWires = sv('g', { class: 'w2-wires' }), gComps = sv('g'), gPreview = sv('path', { class: 'w2-preview', d: '' });
  const gDemo = sv('g', { class: 'w2-demo', 'pointer-events': 'none' });   // 完整接線示範：獨立圖層，不改學員的線
  svg.append(gWires, gComps, gDemo, gPreview);

  // ───────── 元件與接口 ─────────
  const portEls = {};
  for (const c of COMPONENTS) {
    const [x, y, w, h] = LAYOUT[c.id];
    const g = sv('g', { class: 'w2-comp', 'data-comp': c.id });
    const rect = sv('rect', { x, y, width: w, height: h, rx: 10, class: 'w2-box' }); g.append(rect);   // 外框（樣式只套在外框，不影響零件圖）
    g.append(drawArt(c.id, [x, y, w, h], c.ports.map((pp) => ({ ...pp, ...PORT_POS[pp.id] })), sv));   // 擬真零件圖（自繪，不用廠商照片）
    g.addEventListener('click', (e) => { e.stopPropagation(); pending = null; selected = null; compFocus = c.id; say(`已選元件：${c.zh}`); draw(); });   // 點框或名稱都算（接口自己會攔下點擊）
    const NAME_Y = { pixhawk: y + 138, battery: y + 31, receiver: y + 30, gps: y + h - 10 };   // 名稱放在不壓到零件圖的位置
    const NAME_X = { safety_switch: x + 64 + (w - 64) / 2, buzzer: x + 64 + (w - 64) / 2 };
    const t = sv('text', { x: NAME_X[c.id] ?? x + w / 2, y: NAME_Y[c.id] ?? y + h / 2 + 6, 'text-anchor': 'middle', class: `w2-name${c.id === 'pixhawk' ? ' silk' : ''}` }); t.textContent = c.zh; g.append(t);   // 名稱置中；接口標籤都放在框外，避免重疊
    for (const p of c.ports) {
      const pos = PORT_POS[p.id];
      const pg = sv('g', { class: `w2-port ${roleKind(p.role)}`, 'data-port': p.id, tabindex: 0, role: 'button', 'aria-label': `${c.zh} ${p.label}` });
      pg.append(sv('circle', { cx: pos.x, cy: pos.y, r: 9 }));
      const k = pos.inside ? -1 : 1;   // inside：標籤寫在框內（像電路板上的印字）
      const lx = pos.x + pos.n[0] * 15 * k, ly = pos.y + (pos.side === 'top' ? -15 : pos.side === 'bottom' ? 25 : pos.inside ? 4 : -6);
      const anchor = pos.side === 'left' ? (pos.inside ? 'start' : 'end') : pos.side === 'right' ? (pos.inside ? 'end' : 'start') : 'middle';
      const lt = sv('text', { x: lx, y: ly, class: 'w2-plabel', 'text-anchor': anchor }); lt.textContent = c.kind === 'motor' ? '' : (pos.label ?? p.label);   // 馬達三相線標籤與 ESC 重複，省略
      pg.append(lt);
      pg.addEventListener('click', (e) => { e.stopPropagation(); clickPort(p.id); });
      pg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickPort(p.id); } });
      g.append(pg); portEls[p.id] = pg;
    }
    gComps.append(g);
  }

  // ───────── 互動 ─────────
  function clickPort(pid) {
    if (locked) return say('已交卷，接線已鎖定');
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
    if (locked) return;
    if (!selected) return say('請先點選一條線');
    wires = wires.filter((w) => w.id !== selected); selected = null; result = null; say('已刪除'); save(); draw();
  }
  bDel.onclick = removeSelected;
  bSwap.onclick = () => {
    if (locked) return;
    const w = wires.find((x) => x.id === selected); if (!w) return say('請先點選一條線');
    w.reversed = !w.reversed; result = null;
    say(w.reversed ? '已把這條線的紅黑對調（模擬焊接時接反）' : '已改回紅正黑負'); save(); draw();
  };
  bUndo.onclick = () => { if (locked) return; const w = wires.pop(); if (w) { selected = null; result = null; say(`已復原：${desc(w.from)} ↔ ${desc(w.to)}`); save(); } draw(); };
  bClear.onclick = () => { if (locked || !wires.length) return; if (!confirm('清除畫布上全部的線？')) return; wires = []; selected = null; result = null; say('已全部清除'); save(); draw(); };
  bCheck.onclick = () => { if (isExam()) return; result = validateWiring(wires); showHints = false; draw(); results.scrollIntoView?.({ block: 'nearest' }); };

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
    if (trainMode === 'teach') { result = validateWiring(wires); showHints = true; }   // 教學：每次變動都即時檢查、直接列出缺線
    if (isExam()) { result = null; showHints = false; }
    bCheck.hidden = isExam() || trainMode === 'teach';
    guide.hidden = isExam(); if (isExam() && (demoTimer || gDemo.childNodes.length)) stopDemo();   // 考核不提供完整接線方式
    [bSwap, bDel, bUndo, bClear].forEach((b) => (b.disabled = locked));
    title.textContent = `2D 接線練習（${{ teach: '教學', practice: '練習', exam: locked ? '考核・已交卷' : '考核' }[trainMode]}）`;
    const suggest = new Set(trainMode === 'teach' && pending ? EXPECTED_WIRES.filter((e) => e.from === pending || e.to === pending).map((e) => (e.from === pending ? e.to : e.from)) : []);
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
      g.addEventListener('click', (e) => { e.stopPropagation(); if (locked) return; pending = null; compFocus = null; selected = w.id; say(`已選取：${desc(w.from)} ↔ ${desc(w.to)}${w.reversed ? '（紅黑接反）' : ''}`); draw(); });
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter') g.dispatchEvent(new MouseEvent('click', { bubbles: false })); });
      gWires.append(g);
    }
    const used = new Set(wires.flatMap((w) => [w.from, w.to]));
    for (const [pid, pe] of Object.entries(portEls)) {
      pe.classList.toggle('pending', pid === pending);
      pe.classList.toggle('used', used.has(pid));
      pe.classList.toggle('suggest', suggest.has(pid));   // 教學：標出這個接口該接到哪裡
    }
    for (const g of gComps.children) g.classList.toggle('focus3d', from3d.includes(g.dataset.comp));
    status.textContent = msg;
    renderResults();
    syncOut();
  }
  // P4：把 2D 目前的選取與接線送給 3D（只有變動時才送）
  // 選取元件、接口或線時，顯示該零件的簡介與官方資料（新分頁、只連結不複製）
  function renderInfo() {
    const w = wires.find((x) => x.id === selected);
    const cid = compFocus || (pending && PORTS[pending].component) || (w && PORTS[w.from].component) || from3d[0];
    info.replaceChildren();
    const data = cid && PART_INFO[infoKey(cid)];
    if (!data) { info.append(el('span', '點畫布上的零件，可看說明與官方資料。', 'note')); return; }
    info.append(el('b', COMPONENTS.find((c) => c.id === cid).zh), el('span', `　${data.desc}`));
    const links = el('span', null, 'w2-links'); links.append(el('span', '官方資料：'));
    data.links.forEach(([label, href]) => { const a = el('a', `${label} ↗`); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; links.append(a); });
    info.append(links);
  }
  function syncOut() {
    renderInfo();
    if (!activeLevel) return;   // P11：切到引腳級時，由引腳畫布送出
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
    if (isExam()) { results.append(el('p', locked ? `已交卷：共接了 ${wires.length} 條線。分數見上方成績單。` : `考核中：目前 ${wires.length} 條線。考核不能自行檢查，完成後到上方成績單按「交卷」。`, 'note')); return; }
    if (!result) { results.append(el('p', `目前 ${wires.length} 條線（正確接線共 ${EXPECTED_WIRES.length} 條）。接完後按「✓ 檢查接線」。`, 'note')); return; }
    const errs = result.issues.filter((i) => i.code !== 'MISSING'), missing = result.issues.filter((i) => i.code === 'MISSING');
    const sum = el('p', null, `w2-sum ${result.ok ? 'ok' : 'bad'}`);
    sum.textContent = result.ok ? `✓ 全部 ${result.expectedTotal} 條都接對了（${trainMode === 'teach' ? '教學' : '練習'}結果，未記錄成績）`
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
  function save() { if (isExam()) return; try { localStorage.setItem(STORE, JSON.stringify(wires)); } catch { /* 無痕模式：不保存 */ } }

  // P5：模式切換。考核時先收起練習草稿、從空白開始；離開考核再還原
  function applyMode(next) {
    if (next === 'exam') { if (!stash) stash = wires; wires = []; seq = 0; say('考核開始：從空白畫布開始接線，系統不會提示'); }
    else if (trainMode === 'exam' && stash) { wires = stash; stash = null; seq = wires.reduce((m, w) => Math.max(m, Number(String(w.id).slice(1)) || 0), 0); say('已回到練習草稿'); }
    else if (next === 'teach') say('教學模式：先點一個接口，畫布會用閃爍的圈標出它該接到哪裡');
    trainMode = next; locked = false; pending = null; selected = null; result = null; draw();
  }
  on('trainMode', (d) => applyMode(d?.mode || 'practice'));
  on('examLock', (d) => { locked = !!d?.locked; pending = null; selected = null; if (locked) say('已交卷，接線已鎖定'); draw(); });
  if (isExam()) { trainMode = 'practice'; applyMode('exam'); }

  draw();
  return { get wires() { return wires; }, check: () => validateWiring(wires), setActive(on) { activeLevel = on; lastWiresKey = ''; lastFocusKey = ''; if (on) draw(); } };
}

// 頁面入口：按「開始 2D 接線練習」才顯示畫布
const panel = document.getElementById('wire2d');
const enter = document.getElementById('wire2d-enter');
if (panel && enter) {
  let api = null;
  let pinApi = null;
  // P11：接頭級（基礎）／引腳級（進階）切換；引腳級畫布第一次切換時才載入
  async function setLevel(level) {
    const pinRoot = panel.querySelector('.w2-pin-root'), baseRoot = panel.querySelector('.w2-root');
    panel.querySelectorAll('[data-level]').forEach((b) => { b.classList.toggle('on', b.dataset.level === level); b.setAttribute('aria-selected', String(b.dataset.level === level)); });
    baseRoot.hidden = level !== 'base'; pinRoot.hidden = level !== 'pin';
    if (level === 'pin' && !pinApi) pinApi = (await import('./pin-canvas.js?v=p11-1')).initPinCanvas(pinRoot);
    api?.setActive(level === 'base'); pinApi?.setActive(level === 'pin');
  }
  panel.querySelectorAll('[data-level]').forEach((b) => (b.onclick = () => setLevel(b.dataset.level)));
  enter.addEventListener('click', () => {
    panel.hidden = false;
    if (!api) api = initWiringCanvas(panel.querySelector('.w2-root'));
    panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  if (new URLSearchParams(location.search).get('wireLevel') === 'pin') { enter.click(); setLevel('pin'); }   // 截圖與驗收用
  if (new URLSearchParams(location.search).get('wire2d') === '1') enter.click();   // 截圖與驗收用
}
