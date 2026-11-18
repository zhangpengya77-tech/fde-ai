// 組裝實訓室｜F450 接線示意圖版面（俯視，機頭朝上；右側為 Pixhawk 接口放大圖）
// 只描述「點在哪裡、零件畫在哪裡」；判定一律交給 wiring-rules。接口位置是示意，依克隆版而異（待確認）。

const C = { x: 370, y: 360 };
const DIAG = 170;
const CORNER = { fr: [1, -1], fl: [-1, -1], bl: [-1, 1], br: [1, 1] };
const MOTOR_OF = { fr: 1, bl: 2, fl: 3, br: 4 };
const along = (k, t) => [C.x + CORNER[k][0] * DIAG * t, C.y + CORNER[k][1] * DIAG * t];

export function makeF450Layout() {
  const points = {};
  for (const k of Object.keys(CORNER)) {
    const [x, y] = along(k, 0.3);
    const px = -CORNER[k][1] * 11;   // 垂直機臂方向偏移，讓 ＋／− 焊盤分開
    const py = CORNER[k][0] * 11;
    points[`pdb.${k}+`] = [x + px, y + py];
    points[`pdb.${k}-`] = [x - px, y - py];
    points[`motor.m${MOTOR_OF[k]}`] = along(k, 1);
  }
  points['pdb.in+'] = [C.x - 14, C.y + 52];
  points['pdb.in-'] = [C.x + 14, C.y + 52];
  points['pm.in'] = [C.x, C.y + 205];
  ['fc.power', 'fc.switch', 'fc.buzzer', 'fc.rcin', 'fc.usb'].forEach((id, i) => { points[id] = [815, 170 + i * 58]; });
  ['fc.telem1', 'fc.telem2', 'fc.gps', 'fc.i2c'].forEach((id, i) => { points[id] = [945, 170 + i * 58]; });
  for (let n = 1; n <= 8; n++) points[`fc.main${n}`] = [790 + (n - 1) * 25, 590];

  const parts = {
    esc_1: along('fr', 0.62), esc_2: along('bl', 0.62), esc_3: along('fl', 0.62), esc_4: along('br', 0.62),
    power_module: [C.x, C.y + 130], battery: [C.x, C.y + 270], receiver: [C.x, C.y - 140],
    gps: [C.x - 95, C.y + 95], telemetry: [C.x + 95, C.y + 95], buzzer: [C.x - 70, C.y - 70], safety_switch: [C.x + 70, C.y - 70],
  };

  /** 接點旁的短標籤與位置 */
  function label(id, catalog) {
    const [x, y] = points[id];
    if (id.startsWith('fc.main')) return { text: id.slice(7), x, y: y + 26, dark: true };
    if (id.startsWith('fc.')) return { text: catalog[id].nameZh.split(/[ （]/)[0], x, y: y + 27, dark: true };
    if (id.endsWith('+')) return { text: '＋', x, y: y + 4 };
    if (id.endsWith('-')) return { text: '−', x, y: y + 4 };
    if (id === 'pm.in') return { text: 'XT60', x, y: y + 4 };
    return null;
  }

  function drawStatic(svg, el) {
    for (const k of Object.keys(CORNER)) {
      const [x, y] = along(k, 1);
      svg.append(el('line', { x1: C.x, y1: C.y, x2: x, y2: y, stroke: k.startsWith('f') ? '#d23b3b' : '#cfd6dd', 'stroke-width': 26, 'stroke-linecap': 'round' }));
      svg.append(el('circle', { cx: x, cy: y, r: 30, fill: '#9aa4ad', stroke: '#555d66', 'stroke-width': 3 }));
      svg.append(el('text', { x, y: y + 5, 'text-anchor': 'middle', class: 'bl-wlabel bl-wlabel-dark' }, `M${MOTOR_OF[k]}`));
    }
    svg.append(el('rect', { x: C.x - 70, y: C.y - 70, width: 140, height: 140, rx: 10, fill: '#2f3b46' }));
    svg.append(el('rect', { x: C.x - 22, y: C.y - 36, width: 44, height: 72, rx: 5, fill: '#e9edf1' }));
    svg.append(el('path', { d: `M${C.x} ${C.y - 28} l10 14 h-6 v18 h-8 v-18 h-6z`, fill: '#1f6fd1' }));
    svg.append(el('text', { x: C.x, y: C.y - 228, 'text-anchor': 'middle', class: 'bl-wlabel' }, '▲ 機頭（俯視）'));
    const box = (id, w, h, fill, text) => {
      const [x, y] = parts[id];
      svg.append(el('rect', { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 5, fill }));
      svg.append(el('text', { x, y: y + h / 2 + 14, 'text-anchor': 'middle', class: 'bl-wlabel' }, text));
    };
    for (const n of [1, 2, 3, 4]) box(`esc_${n}`, 34, 20, '#2b5fae', `電調${n}`);
    box('power_module', 40, 26, '#1e4f8a', '電源模組');
    box('battery', 120, 34, '#f2b705', '電池（3S）');
    box('receiver', 50, 26, '#202a33', '接收機');
    box('gps', 36, 36, '#1b1f24', 'GPS／羅盤');
    box('telemetry', 34, 40, '#30363d', '數傳');
    box('buzzer', 22, 22, '#111', '蜂鳴器');
    box('safety_switch', 22, 26, '#c62828', '安全開關');
    svg.append(el('rect', { x: 760, y: 110, width: 225, height: 520, rx: 14, fill: '#e9edf1', stroke: '#9fb0c2' }));
    svg.append(el('text', { x: 872, y: 136, 'text-anchor': 'middle', class: 'bl-wlabel bl-wlabel-dark' }, 'Pixhawk 2.4.8 接口（放大示意）'));
    svg.append(el('text', { x: 872, y: 560, 'text-anchor': 'middle', class: 'bl-wlabel bl-wlabel-dark' }, 'MAIN OUT 1～8'));
    svg.append(el('text', { x: 872, y: 650, 'text-anchor': 'middle', class: 'bl-wlabel' }, '接口位置依克隆版而異（待確認）'));
  }

  return { points, parts, label, drawStatic };
}
