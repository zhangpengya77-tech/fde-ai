// 組裝實訓室｜接線模式畫面（俯視 2D 示意圖＋右側飛控接口放大圖）
//
// 版面為自行設計的示意圖：左邊是機體俯視（機頭朝上），右邊把 Pixhawk 各接口放大排列方便點選。
// 接口在板上的實際位置依克隆版而異，這裡只是示意（待確認）；判定一律交給 wiring-engine／wiring-rules。
// 操作：每一步會標出「線從哪裡來」，學員點選要接的接口；極性步驟點的是「紅線」要焊的焊盤。

const NS = 'http://www.w3.org/2000/svg';
const C = { x: 370, y: 360 };   // 機體中心
const DIAG = 170;               // 中心到電機的 X／Y 偏移
const CORNER = { fr: [1, -1], fl: [-1, -1], bl: [-1, 1], br: [1, 1] };
const MOTOR_OF = { fr: 1, bl: 2, fl: 3, br: 4 };
const along = (k, t) => [C.x + CORNER[k][0] * DIAG * t, C.y + CORNER[k][1] * DIAG * t];

// 接點座標
const POINTS = {};
for (const k of Object.keys(CORNER)) {
  const [x, y] = along(k, 0.3);
  const px = -CORNER[k][1] * 11;   // 垂直於機臂方向的偏移，讓 ＋／− 兩個焊盤分開
  const py = CORNER[k][0] * 11;
  POINTS[`pdb.${k}+`] = [x + px, y + py];
  POINTS[`pdb.${k}-`] = [x - px, y - py];
  POINTS[`motor.m${MOTOR_OF[k]}`] = along(k, 1);
}
POINTS['pdb.in+'] = [C.x - 14, C.y + 52];
POINTS['pdb.in-'] = [C.x + 14, C.y + 52];
POINTS['pm.in'] = [C.x, C.y + 205];
const FC_COL_A = ['fc.power', 'fc.switch', 'fc.buzzer', 'fc.rcin', 'fc.usb'];
const FC_COL_B = ['fc.telem1', 'fc.telem2', 'fc.gps', 'fc.i2c'];
FC_COL_A.forEach((id, i) => { POINTS[id] = [815, 170 + i * 58]; });
FC_COL_B.forEach((id, i) => { POINTS[id] = [945, 170 + i * 58]; });
for (let n = 1; n <= 8; n++) POINTS[`fc.main${n}`] = [790 + (n - 1) * 25, 590];

// 零件（線的起點）位置
const PARTS = {
  esc_1: along('fr', 0.62), esc_2: along('bl', 0.62), esc_3: along('fl', 0.62), esc_4: along('br', 0.62),
  power_module: [C.x, C.y + 130], battery: [C.x, C.y + 270], receiver: [C.x, C.y - 140],
  gps: [C.x - 95, C.y + 95], telemetry: [C.x + 95, C.y + 95], buzzer: [C.x - 70, C.y - 70], safety_switch: [C.x + 70, C.y - 70],
};
const WIRE_COLOR = { power: '#d23b3b', signal: '#e0a800', data: '#1f6fd1', phase: '#6b7785' };

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

/**
 * @param {object} o { root, wiring, mode: () => string, onAttempt(choice), labels: { [partId]: 中文名 } }
 */
export function createWiringView(o) {
  const { root, wiring } = o;
  const svg = el('svg', { viewBox: '0 0 1000 700', class: 'bl-wsvg', role: 'img', 'aria-label': '接線示意圖（俯視，機頭朝上）' });
  root.append(svg);

  function drawStatic() {
    // 機架：機臂、中心板、電機
    for (const k of Object.keys(CORNER)) {
      const [x, y] = along(k, 1);
      svg.append(el('line', { x1: C.x, y1: C.y, x2: x, y2: y, stroke: k.startsWith('f') ? '#d23b3b' : '#cfd6dd', 'stroke-width': 26, 'stroke-linecap': 'round' }));
      svg.append(el('circle', { cx: x, cy: y, r: 30, fill: '#9aa4ad', stroke: '#555d66', 'stroke-width': 3 }));
      svg.append(el('text', { x, y: y + 5, 'text-anchor': 'middle', class: 'bl-wlabel bl-wlabel-dark' }, `M${MOTOR_OF[k]}`));
    }
    svg.append(el('rect', { x: C.x - 70, y: C.y - 70, width: 140, height: 140, rx: 10, fill: '#2f3b46' }));
    svg.append(el('rect', { x: C.x - 22, y: C.y - 36, width: 44, height: 72, rx: 5, fill: '#e9edf1' }));
    svg.append(el('path', { d: `M${C.x} ${C.y - 28} l10 14 h-6 v18 h-8 v-18 h-6z`, fill: '#1f6fd1' }));
    svg.append(el('text', { x: C.x, y: C.y - 228, 'text-anchor': 'middle', class: 'bl-wlabel' }, '▲ 機頭（俯視）'));   // 放在最上方，避免和接收機重疊
    // 周邊零件方塊
    const box = (id, w, h, fill, label) => {
      const [x, y] = PARTS[id];
      svg.append(el('rect', { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 5, fill, 'data-part': id }));
      svg.append(el('text', { x, y: y + h / 2 + 14, 'text-anchor': 'middle', class: 'bl-wlabel' }, label));
    };
    for (const n of [1, 2, 3, 4]) box(`esc_${n}`, 34, 20, '#2b5fae', `電調${n}`);
    box('power_module', 40, 26, '#1e4f8a', '電源模組');
    box('battery', 120, 34, '#f2b705', '電池（3S）');
    box('receiver', 50, 26, '#202a33', '接收機');
    box('gps', 36, 36, '#1b1f24', 'GPS／羅盤');
    box('telemetry', 34, 40, '#30363d', '數傳');
    box('buzzer', 22, 22, '#111', '蜂鳴器');
    box('safety_switch', 22, 26, '#c62828', '安全開關');
    // 右側：飛控接口放大圖
    svg.append(el('rect', { x: 760, y: 110, width: 225, height: 520, rx: 14, fill: '#e9edf1', stroke: '#9fb0c2' }));
    svg.append(el('text', { x: 872, y: 136, 'text-anchor': 'middle', class: 'bl-wlabel bl-wlabel-dark' }, 'Pixhawk 2.4.8 接口（放大示意）'));
    svg.append(el('text', { x: 872, y: 560, 'text-anchor': 'middle', class: 'bl-wlabel bl-wlabel-dark' }, 'MAIN OUT 1～8'));
    svg.append(el('text', { x: 872, y: 650, 'text-anchor': 'middle', class: 'bl-wlabel' }, '接口位置依克隆版而異（待確認）'));
  }

  const hotLayer = el('g');
  const wireLayer = el('g');
  svg.append(wireLayer, hotLayer);
  drawStatic();
  svg.append(wireLayer, hotLayer);   // 線與接點畫在最上層

  function hotspot(id, state) {
    const [x, y] = POINTS[id];
    const g = el('g', { class: `bl-hot ${state}`, 'data-point': id, tabindex: 0, role: 'button', 'aria-label': wiring.catalog[id].nameZh });
    g.append(el('circle', { cx: x, cy: y, r: 11 }));
    const short = id.startsWith('fc.main') ? id.slice(7)
      : id.startsWith('fc.') ? wiring.catalog[id].nameZh.split(/[ （]/)[0]
        : id.endsWith('+') ? '＋' : id.endsWith('-') ? '−' : id.startsWith('motor') ? '' : 'XT60';
    if (short) {
      const below = id.startsWith('fc.main');
      g.append(el('text', { x: below ? x : x + (id.startsWith('fc.') ? 0 : 0), y: below ? y + 26 : (id.startsWith('fc.') ? y + 27 : y + 4), 'text-anchor': 'middle', class: `bl-wlabel ${id.startsWith('fc.') ? 'bl-wlabel-dark' : ''}` }, short));
    }
    return g;
  }

  function render() {
    const step = wiring.current;
    const mode = o.mode();
    hotLayer.replaceChildren();
    wireLayer.replaceChildren();
    // 已接好的線
    for (const d of wiring.connections) {
      const s = wiring.steps.find((x) => x.id === d.stepId);
      const from = PARTS[s.fromPart] || POINTS[s.expect];
      if (s.kind === 'polarity') {
        const [rx, ry] = POINTS[s.expect.red];
        const [bx, by] = POINTS[s.expect.black];
        const [fx, fy] = PARTS[s.fromPart];
        wireLayer.append(el('line', { x1: fx - 3, y1: fy, x2: rx, y2: ry, stroke: '#d23b3b', 'stroke-width': 3 }));
        wireLayer.append(el('line', { x1: fx + 3, y1: fy, x2: bx, y2: by, stroke: '#111', 'stroke-width': 3 }));
      } else {
        const [tx, ty] = POINTS[s.expect];
        wireLayer.append(el('line', { x1: from[0], y1: from[1], x2: tx, y2: ty, stroke: WIRE_COLOR[s.wireType], 'stroke-width': s.kind === 'phase' ? 5 : 2.5, 'stroke-dasharray': s.wireType === 'data' ? '7 4' : '' }));
      }
    }
    // 目前步驟：線的來源零件
    if (step) {
      const [fx, fy] = PARTS[step.fromPart];
      hotLayer.append(el('circle', { cx: fx, cy: fy, r: 26, class: 'bl-src' }));
    }
    // 接點
    const showTarget = step && mode === 'learn';
    for (const id of Object.keys(POINTS)) {
      const isTarget = showTarget && (step.kind === 'polarity' ? id === step.expect.red : id === step.expect);
      const g = hotspot(id, isTarget ? 'is-target' : '');
      if (isTarget) {
        const [x, y] = POINTS[id];
        g.append(el('text', { x: x + 15, y: y - 12, class: 'bl-wnum' }, String(wiring.progress.done + 1)));
      }
      hotLayer.append(g);
    }
  }

  function pick(id) {
    const step = wiring.current;
    if (!step || !id) return;
    o.onAttempt(step.kind === 'polarity' ? { red: id } : { target: id });
  }
  svg.addEventListener('click', (e) => pick(e.target.closest('[data-point]')?.dataset.point));
  svg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e.target.closest('[data-point]')?.dataset.point); } });

  return { render };
}
