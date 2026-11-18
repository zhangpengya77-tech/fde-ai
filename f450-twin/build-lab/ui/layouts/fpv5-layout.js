// 組裝實訓室｜5 吋 FPV 接線示意圖版面（俯視，機頭朝上；右側為飛控焊盤／接口放大圖）
// 自行設計的示意圖，焊盤位置依廠牌而異（待確認）；判定一律交給 wiring-rules。

const C = { x: 380, y: 340 };
const DIAG = 190;
const CORNER = { rr: [1, 1], fr: [1, -1], rl: [-1, 1], fl: [-1, -1] };
const MOTOR_OF = { rr: 1, fr: 2, rl: 3, fl: 4 };
const along = (k, t) => [C.x + CORNER[k][0] * DIAG * t, C.y + CORNER[k][1] * DIAG * t];

export function makeFpv5Layout() {
  const points = {};
  for (const k of Object.keys(CORNER)) points[`esc.m${MOTOR_OF[k]}`] = along(k, 0.3);
  points['esc.bat+'] = [C.x - 16, C.y + 70];
  points['esc.bat-'] = [C.x + 16, C.y + 70];
  points['xt60.in'] = [C.x, C.y + 225];
  points['vtx.cam'] = [592, 560];
  points['vtx.ant'] = [648, 560];
  points['fc.esc8'] = [815, 210];
  points['fc.hd'] = [945, 210];
  points['fc.uart1.tx'] = [790, 360];
  points['fc.uart1.rx'] = [840, 360];
  points['fc.uart2.tx'] = [905, 360];
  points['fc.uart2.rx'] = [955, 360];

  const parts = {
    motor_m1: along('rr', 1), motor_m2: along('fr', 1), motor_m3: along('rl', 1), motor_m4: along('fl', 1),
    esc_4in1: [C.x, C.y], xt60_lead: [C.x, C.y + 160], capacitor: [C.x + 90, C.y + 110],
    receiver: [C.x - 140, C.y + 120], vtx: [620, 520], camera: [C.x, C.y - 230],
    vtx_antenna: [720, 610], battery: [C.x, C.y + 300],
  };

  function label(id, catalog) {
    const [x, y] = points[id];
    if (id.startsWith('esc.m')) return { text: `M${id.slice(5)}`, x, y: y - 16 };
    if (id === 'esc.bat+') return { text: '＋', x, y: y + 4 };
    if (id === 'esc.bat-') return { text: '−', x, y: y + 4 };
    if (id.startsWith('fc.uart')) return { text: `${id.endsWith('tx') ? 'TX' : 'RX'}${id.charAt(7)}`, x, y: y + 27, dark: true };
    if (id === 'fc.esc8') return { text: '電調 8P', x, y: y + 27, dark: true };
    if (id === 'fc.hd') return { text: '圖傳 6P', x, y: y + 27, dark: true };
    if (id === 'xt60.in') return { text: 'XT60', x, y: y + 4 };
    if (id === 'vtx.cam') return { text: '攝影機', x, y: y + 27 };
    if (id === 'vtx.ant') return { text: '天線', x, y: y + 27 };
    return { text: catalog[id]?.nameZh || id, x, y: y + 27 };
  }

  function drawStatic(svg, el) {
    for (const k of Object.keys(CORNER)) {
      const [x, y] = along(k, 1);
      svg.append(el('line', { x1: C.x, y1: C.y, x2: x, y2: y, stroke: '#2a2e33', 'stroke-width': 22, 'stroke-linecap': 'round' }));
      svg.append(el('circle', { cx: x, cy: y, r: 30, fill: '#7d8790', stroke: '#4a5158', 'stroke-width': 3 }));
      svg.append(el('text', { x, y: y + 5, 'text-anchor': 'middle', class: 'bl-wlabel bl-wlabel-dark' }, `M${MOTOR_OF[k]}`));
    }
    svg.append(el('rect', { x: C.x - 80, y: C.y - 80, width: 160, height: 160, rx: 8, fill: '#2b5fae' }));
    svg.append(el('text', { x: C.x, y: C.y + 4, 'text-anchor': 'middle', class: 'bl-wlabel' }, '4 合 1 電調'));
    svg.append(el('text', { x: C.x, y: C.y - 262, 'text-anchor': 'middle', class: 'bl-wlabel' }, '▲ 機頭（俯視）｜Betaflight：M1 右後、M2 右前、M3 左後、M4 左前'));
    const box = (id, w, h, fill, text) => {
      const [x, y] = parts[id];
      svg.append(el('rect', { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 5, fill }));
      svg.append(el('text', { x, y: y + h / 2 + 14, 'text-anchor': 'middle', class: 'bl-wlabel' }, text));
    };
    box('xt60_lead', 30, 22, '#f2c200', 'XT60 電源線');
    box('capacitor', 40, 18, '#1c2a4a', '電容（條紋＝−）');
    box('receiver', 36, 22, '#30363d', 'ELRS 接收機');
    box('vtx', 100, 50, '#3a3f45', '數位圖傳');
    box('camera', 36, 36, '#2a2a2a', '攝影機');
    box('vtx_antenna', 16, 40, '#c0392b', '圖傳天線');
    box('battery', 110, 34, '#f2b705', '電池');
    svg.append(el('rect', { x: 760, y: 140, width: 225, height: 290, rx: 14, fill: '#e9edf1', stroke: '#9fb0c2' }));
    svg.append(el('text', { x: 872, y: 166, 'text-anchor': 'middle', class: 'bl-wlabel bl-wlabel-dark' }, '飛控接口與焊盤（放大示意）'));
    svg.append(el('text', { x: 872, y: 420, 'text-anchor': 'middle', class: 'bl-wlabel bl-wlabel-dark' }, '焊盤位置依廠牌而異（待確認）'));
  }

  return { points, parts, label, drawStatic };
}
