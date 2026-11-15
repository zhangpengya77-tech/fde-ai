// F450 實訓中心｜工作台零件擬真圖（P14：電路板、焊盤、矽膠線、接頭外殼）
// 全部自製 SVG：依實物外觀（顏色、形狀、接頭與出線位置）繪製，不使用任何第三方圖片。
// 外形依據：Pixhawk 2.4.8 說明書、樂迪 R9DS 官方尺寸 43×24×15 mm、A2212/13T 930KV 馬達照片、20A 電調（黃色熱縮）、F450 下中心板（PCB 配電）。
// 每個零件的引腳位置由 pin-canvas.js 決定；這裡畫的線材與接頭會延伸到那些位置，工作台再把引腳圓點畫在上面。
const NS = 'http://www.w3.org/2000/svg';

// 共用漸層與濾鏡（放在一個隱藏的 SVG 裡，畫布與縮圖都用 url(#…) 引用）
export function ensureDefs() {
  if (document.getElementById('bench-defs')) return;
  const s = document.createElementNS(NS, 'svg');
  s.id = 'bench-defs'; s.setAttribute('width', '0'); s.setAttribute('height', '0'); s.setAttribute('aria-hidden', 'true');
  s.style.position = 'absolute';
  s.innerHTML = `<defs>
    <linearGradient id="bg-case" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4048"/><stop offset=".08" stop-color="#2a2f35"/><stop offset="1" stop-color="#101215"/></linearGradient>
    <linearGradient id="bg-case-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a5159"/><stop offset="1" stop-color="#1c2025"/></linearGradient>
    <linearGradient id="bg-yellow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a0"/><stop offset=".18" stop-color="#ffd84a"/><stop offset=".7" stop-color="#e3b520"/><stop offset="1" stop-color="#a98408"/></linearGradient>
    <linearGradient id="bg-pcb-green" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2c8a55"/><stop offset="1" stop-color="#145233"/></linearGradient>
    <linearGradient id="bg-pcb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a323c"/><stop offset="1" stop-color="#11161c"/></linearGradient>
    <linearGradient id="bg-pcb-red" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b8323a"/><stop offset="1" stop-color="#6e1218"/></linearGradient>
    <linearGradient id="bg-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset=".5" stop-color="#d9ac3a"/><stop offset="1" stop-color="#9c7414"/></linearGradient>
    <linearGradient id="bg-batt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5058"/><stop offset=".12" stop-color="#2a2e34"/><stop offset=".85" stop-color="#14171a"/><stop offset="1" stop-color="#050607"/></linearGradient>
    <linearGradient id="bg-xt60" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe680"/><stop offset=".5" stop-color="#f2c21b"/><stop offset="1" stop-color="#b98d06"/></linearGradient>
    <linearGradient id="bg-jst" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfd3d8"/></linearGradient>
    <linearGradient id="bg-bell-side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7a5c10"/><stop offset=".25" stop-color="#e9c860"/><stop offset=".45" stop-color="#fff2c0"/><stop offset=".7" stop-color="#d1a838"/><stop offset="1" stop-color="#6e520c"/></linearGradient>
    <linearGradient id="bg-steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6c737b"/><stop offset=".4" stop-color="#e6eaee"/><stop offset="1" stop-color="#5c636b"/></linearGradient>
    <linearGradient id="bg-black-side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0d0f12"/><stop offset=".4" stop-color="#3c424a"/><stop offset="1" stop-color="#0d0f12"/></linearGradient>
    <linearGradient id="bg-shrink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(255,255,255,.55)"/><stop offset=".3" stop-color="rgba(220,235,245,.18)"/><stop offset="1" stop-color="rgba(120,140,160,.25)"/></linearGradient>
    <radialGradient id="bg-puck" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#5a6169"/><stop offset=".6" stop-color="#25292e"/><stop offset="1" stop-color="#0b0c0e"/></radialGradient>
    <radialGradient id="bg-red" cx=".38" cy=".32" r=".7"><stop offset="0" stop-color="#ffb0b0"/><stop offset=".55" stop-color="#e03a3a"/><stop offset="1" stop-color="#7a1010"/></radialGradient>
    <radialGradient id="bg-buzz" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#4b5158"/><stop offset=".7" stop-color="#16191c"/><stop offset="1" stop-color="#050607"/></radialGradient>
    <radialGradient id="bg-led-blue" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e6f3ff"/><stop offset=".4" stop-color="#4aa8ff"/><stop offset="1" stop-color="rgba(40,120,255,0)"/></radialGradient>
    <filter id="bg-shadow" x="-15%" y="-15%" width="135%" height="145%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity=".32"/></filter>
    <filter id="bg-soft" x="-10%" y="-10%" width="125%" height="130%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-color="#000" flood-opacity=".4"/></filter>
  </defs>`;
  document.body.append(s);
}

// 線色（矽膠線）
const WC = { red: '#d42a2a', black: '#1b1d20', white: '#f2f2ee', yellow: '#f0c419', blue: '#2f6fd6', orange: '#ef8a1e', green: '#2fa35a' };

// 畫零件本體。add(tag, attrs, text) 加到目標群組；w、h 為零件外框（引腳畫在外框邊上，由工作台另外畫）
export function drawBody(add, id, w, h) {
  const kind = id.replace(/_(fr|fl|rl|rr)$/, '');
  const T = (x, y, t, cls, anchor = 'middle') => add('text', { x, y, 'text-anchor': anchor, class: cls }, t);
  // 矽膠線：從 (x1,y1) 彎到 (x2,y2)，外層深色描邊＋亮線，看起來有立體感
  const wire = (x1, y1, x2, y2, color, wd = 5, bend = 0.5, horiz = false) => {
    const d = horiz
      ? `M${x1},${y1} C${x1 + (x2 - x1) * bend},${y1} ${x2 - (x2 - x1) * bend},${y2} ${x2},${y2}`
      : `M${x1},${y1} C${x1},${y1 + (y2 - y1) * bend} ${x2},${y2 - (y2 - y1) * bend} ${x2},${y2}`;
    add('path', { d, fill: 'none', stroke: 'rgba(0,0,0,.45)', 'stroke-width': wd + 2, 'stroke-linecap': 'round' });
    add('path', { d, fill: 'none', stroke: color, 'stroke-width': wd, 'stroke-linecap': 'round' });
    add('path', { d, fill: 'none', stroke: 'rgba(255,255,255,.35)', 'stroke-width': Math.max(1, wd / 4), 'stroke-linecap': 'round', transform: 'translate(-1 -1)' });
  };
  // 白色 JST 接頭外殼（n 腳，沿 x 或 y 方向，c 為中心）
  const housing = (cx, cy, n, pitch, vertical, len = 14) => {
    const span = (n - 1) * pitch + 10;
    const [x, y, ww, hh] = vertical ? [cx - len / 2, cy - span / 2, len, span] : [cx - span / 2, cy - len / 2, span, len];
    add('rect', { x, y, width: ww, height: hh, rx: 2.5, fill: 'url(#bg-jst)', stroke: '#8d949b', 'stroke-width': 1, filter: 'url(#bg-soft)' });
    for (let i = 0; i < n; i++) {
      const px = vertical ? cx : cx - span / 2 + 5 + i * pitch, py = vertical ? cy - span / 2 + 5 + i * pitch : cy;
      add('rect', { x: px - 2.2, y: py - 2.2, width: 4.4, height: 4.4, fill: '#9aa1a8' });
    }
  };
  // 杜邦黑色舵機頭
  const dupont = (cx, cy, n, pitch, vertical) => {
    const span = (n - 1) * pitch + 10;
    const [x, y, ww, hh] = vertical ? [cx - 8, cy - span / 2, 16, span] : [cx - span / 2, cy - 8, span, 16];
    add('rect', { x, y, width: ww, height: hh, rx: 2, fill: '#15171a', stroke: '#3b4047', filter: 'url(#bg-soft)' });
  };
  // XT60（黃色，中心 cx,cy，寬 ww 高 hh；female＝母頭）
  const xt60 = (cx, cy, ww, hh, female = true) => {
    add('path', { d: `M${cx - ww / 2},${cy - hh / 2 + 3} q0,-3 3,-3 h${ww - 9} l6,6 v${hh - 6} q0,3 -3,3 h${-(ww - 3)} q-3,0 -3,-3 z`, fill: 'url(#bg-xt60)', stroke: '#8a6a00', 'stroke-width': 1.2, filter: 'url(#bg-soft)' });
    for (const dx of [-ww / 4, ww / 4]) add('circle', { cx: cx + dx, cy, r: Math.min(ww, hh) / 6, fill: female ? '#3a2c00' : '#d9ac3a', stroke: '#6b5200' });
  };
  const smd = (x, y, ww = 6, hh = 3, c = '#c8a25a') => { add('rect', { x, y, width: ww, height: hh, fill: '#2a2017' }); add('rect', { x, y, width: 1.4, height: hh, fill: c }); add('rect', { x: x + ww - 1.4, y, width: 1.4, height: hh, fill: c }); };
  const chip = (x, y, ww, hh, legs = 4) => {
    add('rect', { x, y, width: ww, height: hh, rx: 1, fill: '#15171a', stroke: '#2f343a' });
    for (let i = 0; i < legs; i++) { const t = (i + 0.5) / legs; add('rect', { x: x + ww * t - 1, y: y - 2.5, width: 2, height: 2.5, fill: '#cfd3d8' }); add('rect', { x: x + ww * t - 1, y: y + hh, width: 2, height: 2.5, fill: '#cfd3d8' }); }
    add('circle', { cx: x + 3, cy: y + 3, r: 1, fill: '#555' });
  };

  if (kind === 'receiver') {
    // 樂迪 R9DS：黑色外殼，右端排針（SBUS 由 CH9），左側兩根天線（白色末端）
    for (const [y0, y1] of [[34, 6], [70, 98]]) { add('path', { d: `M14,${(y0 + 52) / 2} C-10,${y0} -18,${y1} -30,${y1}`, fill: 'none', stroke: '#1b1d20', 'stroke-width': 3.4, 'stroke-linecap': 'round' }); add('path', { d: `M-30,${y1} l-26,${y1 < 50 ? -6 : 6}`, stroke: '#f2f2ee', 'stroke-width': 3.6, 'stroke-linecap': 'round' }); }
    add('rect', { x: 8, y: 14, width: 144, height: 78, rx: 9, fill: 'url(#bg-case)', stroke: '#4a525c', 'stroke-width': 1.6, filter: 'url(#bg-shadow)' });
    add('rect', { x: 14, y: 18, width: 132, height: 10, rx: 4, fill: 'rgba(255,255,255,.08)' });
    T(70, 54, 'R9DS', 'ba-brand');
    T(70, 70, 'RadioLink  2.4GHz', 'ba-silk light');
    T(70, 84, 'DSSS & FHSS', 'ba-silk faint');
    add('circle', { cx: 132, cy: 30, r: 7, fill: 'url(#bg-led-blue)' }); add('circle', { cx: 132, cy: 30, r: 2.6, fill: '#bfe2ff' });
    // 端面排針座（10 列×3 排）＋插著的 SBUS 杜邦頭與短線
    add('rect', { x: 150, y: 20, width: 18, height: 70, rx: 2, fill: '#0b0c0e', stroke: '#30353b' });
    for (let r = 0; r < 10; r++) for (let c = 0; c < 3; c++) add('rect', { x: 153 + c * 5, y: 23 + r * 6.6, width: 2.6, height: 2.6, fill: '#d9b44a' });
    dupont(172, 66, 3, 16, true);
    for (const [y, c] of [[50, WC.white], [66, WC.red], [82, WC.black]]) wire(172, y, 190, y, c, 4.4, 0.5, true);
    T(160, 104, 'CH9 / SBUS', 'ba-silk dark');
  } else if (kind === 'gps') {
    // M8N GPS 圓盤：黑色外殼、箭頭、狀態燈；兩條線（GPS 6P、羅盤 4P）從右側出線到白色接頭
    const cx = 70, cy = 82;
    for (const [y, c] of [[33, WC.red], [49, WC.white], [65, WC.yellow], [81, WC.black]]) wire(cx + 46, cy - 18 + (y - 57) * 0.12, 146, y, c, 3.6, 0.55, true);
    for (const [y, c] of [[117, WC.red], [133, WC.green], [149, WC.yellow], [165, WC.black]]) wire(cx + 40, cy + 36 + (y - 141) * 0.12, 146, y, c, 3.6, 0.55, true);
    add('rect', { x: cx - 9, y: cy + 50, width: 18, height: h - cy - 58, rx: 3, fill: 'url(#bg-steel)' });            // 支架桿
    add('rect', { x: cx - 26, y: h - 14, width: 52, height: 10, rx: 3, fill: '#2a2e33' });
    add('circle', { cx, cy, r: 66, fill: 'url(#bg-puck)', stroke: '#16181b', 'stroke-width': 3, filter: 'url(#bg-shadow)' });
    add('circle', { cx, cy, r: 58, fill: 'none', stroke: 'rgba(255,255,255,.12)', 'stroke-width': 2 });
    add('ellipse', { cx: cx - 18, cy: cy - 30, rx: 30, ry: 14, fill: 'rgba(255,255,255,.08)', transform: `rotate(-25 ${cx - 18} ${cy - 30})` });
    add('path', { d: `M${cx},${cy - 40} l22,30 h-12 v24 h-20 v-24 h-12 z`, fill: '#e8ecef', opacity: .92 });
    T(cx, cy + 34, 'GPS  M8N', 'ba-silk light');
    add('circle', { cx: cx + 34, cy: cy + 30, r: 5, fill: '#2fd06a', opacity: .9 }); add('circle', { cx: cx - 34, cy: cy + 30, r: 5, fill: '#3fa0ff', opacity: .9 });
    housing(152, 57, 4, 16, true, 13);
    housing(152, 141, 4, 16, true, 13);
    T(146, 12, 'GPS', 'ba-silk dark', 'end'); T(146, 188, 'I2C', 'ba-silk dark', 'end');
  } else if (kind === 'power_module') {
    // 電源模組：綠色 PCB 包透明熱縮；XT60 公頭在下（接電池）、母頭在左（往配電板），上方 6P 線到飛控 POWER
    wire(70, 74, 77, 96, WC.red, 7, 0.5); wire(85, 74, 93, 96, WC.black, 7, 0.5);
    wire(40, 62, 22, 75, WC.red, 7, 0.5, true); wire(40, 74, 22, 91, WC.black, 7, 0.5, true);
    for (let i = 0; i < 6; i++) wire(60 + i * 11, 32, 48 + i * 15, 12, [WC.red, WC.red, WC.yellow, WC.yellow, WC.black, WC.black][i], 2.6, 0.5);
    add('rect', { x: 40, y: 30, width: 100, height: 48, rx: 4, fill: 'url(#bg-pcb-green)', stroke: '#0e3a24', 'stroke-width': 1.5, filter: 'url(#bg-shadow)' });
    chip(58, 42, 16, 12, 3); smd(82, 40); smd(82, 48); smd(92, 44, 8, 4); add('rect', { x: 106, y: 38, width: 26, height: 22, rx: 2, fill: '#2a2e33' }); T(119, 53, '5V3A', 'ba-silk light');
    add('rect', { x: 44, y: 64, width: 92, height: 10, fill: 'url(#bg-gold)', opacity: .9 }); T(90, 72, 'POWER MODULE', 'ba-silk dark tiny');
    add('rect', { x: 36, y: 26, width: 108, height: 56, rx: 8, fill: 'url(#bg-shrink)', stroke: 'rgba(255,255,255,.5)' });   // 透明熱縮
    xt60(85, 100, 42, 18, false);
    xt60(14, 83, 24, 34, true);
    housing(85.5, 8, 6, 15, false, 12);
  } else if (kind === 'battery') {
    // 4S 鋰電池：黑色包裝、白色標籤；XT60 線從上方出，旁邊是白色平衡頭
    wire(74, 22, 72, 10, WC.red, 7); wire(86, 22, 88, 10, WC.black, 7);
    for (let i = 0; i < 5; i++) wire(118 + i * 3.2, 20, 128 + i * 3.4, 6, [WC.black, WC.red, WC.red, WC.red, WC.red][i], 1.8);
    add('rect', { x: 2, y: 18, width: w - 4, height: h - 18, rx: 7, fill: 'url(#bg-batt)', stroke: '#000', 'stroke-width': 1.2, filter: 'url(#bg-shadow)' });
    add('rect', { x: 6, y: 21, width: w - 12, height: 5, rx: 2.5, fill: 'rgba(255,255,255,.14)' });
    add('rect', { x: 12, y: 31, width: w - 24, height: 31, rx: 3, fill: '#f4f4f0' });
    add('rect', { x: 12, y: 31, width: 30, height: 31, rx: 3, fill: '#d42a2a' }); T(27, 52, '4S', 'ba-silk white bold');
    T(99, 45, '14.8V LiPo', 'ba-label'); T(99, 57, '2200mAh 25C', 'ba-silk dark');
    xt60(80, 6, 34, 14, false);
    add('rect', { x: 124, y: 0, width: 22, height: 8, rx: 1.5, fill: 'url(#bg-jst)', stroke: '#8d949b' });
  } else if (kind === 'pdb') {
    // F450 下中心板：紅色 PCB，四角配電焊盤、下方電池輸入焊盤、銅箔匯流
    const P = `M28,6 H${w - 28} Q${w - 6},6 ${w - 6},28 V${h - 28} Q${w - 6},${h - 6} ${w - 28},${h - 6} H28 Q6,${h - 6} 6,${h - 28} V28 Q6,6 28,6 Z`;
    add('path', { d: P, fill: 'url(#bg-pcb-red)', stroke: '#4a0b10', 'stroke-width': 2, filter: 'url(#bg-shadow)' });
    add('path', { d: `M28,12 H${w - 28}`, stroke: 'rgba(255,255,255,.14)', 'stroke-width': 5, 'stroke-linecap': 'round' });
    add('path', { d: `M30,30 H${w - 30} M337,30 V${h - 26}`, stroke: '#e0a64a', 'stroke-width': 5, opacity: .5, fill: 'none' });
    add('path', { d: `M30,86 H${w - 30} M353,86 V${h - 26}`, stroke: '#e6e2d8', 'stroke-width': 5, opacity: .3, fill: 'none' });
    for (const x of [18, w - 18]) [25, 41, 75, 91].forEach((y, i) => { add('rect', { x: x - 11, y: y - 6, width: 22, height: 12, rx: 3, fill: 'url(#bg-gold)', stroke: '#7a5a10' }); T(x + (x < w / 2 ? 20 : -20), y + 4, i % 2 ? '−' : '+', i % 2 ? 'ba-silk white' : 'ba-silk gold'); });
    for (const x of [337, 353]) add('rect', { x: x - 7, y: h - 26, width: 14, height: 22, rx: 3, fill: 'url(#bg-gold)', stroke: '#7a5a10' });
    T(310, h - 12, 'BAT', 'ba-silk white');
    for (const x of [70, w - 70, 160, 300]) add('circle', { cx: x, cy: 58, r: 7, fill: '#1a0306', stroke: '#e0a64a', 'stroke-width': 2 });
    T(w / 2, 64, 'F450  PDB', 'ba-silk gold big');
  } else if (kind === 'esc') {
    // 20A 電調：黃色熱縮本體；上方三條馬達相線、下方紅黑電源線、左側白紅黑訊號線（杜邦頭）
    for (const x of [79, 95, 111]) wire(95 + (x - 95) * 0.6, 34, x, 4, WC.black, 4.6, 0.5);
    wire(88, 92, 87, 114, WC.red, 6); wire(102, 92, 103, 114, WC.black, 6);
    for (const [y, c] of [[44, WC.white], [60, WC.red], [76, WC.black]]) wire(46, 60 + (y - 60) * 0.25, 18, y, c, 3.4, 0.5, true);
    dupont(14, 60, 3, 16, true);
    add('rect', { x: 44, y: 30, width: 104, height: 64, rx: 14, fill: 'url(#bg-yellow)', stroke: '#8a6a00', 'stroke-width': 1.4, filter: 'url(#bg-shadow)' });
    add('rect', { x: 52, y: 34, width: 88, height: 7, rx: 3.5, fill: 'rgba(255,255,255,.45)' });
    for (let i = 0; i < 3; i++) add('path', { d: `M${56 + i * 40},38 v52`, stroke: 'rgba(120,90,0,.2)', 'stroke-width': 1.2 });
    T(96, 64, '20A', 'ba-big dark'); T(124, 40, '2-4S', 'ba-silk dark tiny');
  } else if (kind === 'motor') {
    // A2212 930KV 無刷馬達（側視）：金色鐘罩、銀色軸、黑色底座；三條相線往下到引腳
    for (const x of [64, 80, 96]) wire(80 + (x - 80) * 0.5, 52, x, 66, WC.black, 3.6, 0.5);
    add('rect', { x: 78, y: 0, width: 4, height: 10, fill: 'url(#bg-steel)' });
    add('path', { d: 'M48,10 Q48,6 52,6 H108 Q112,6 112,10 V40 H48 Z', fill: 'url(#bg-bell-side)', stroke: '#5c450a', 'stroke-width': 1.2, filter: 'url(#bg-shadow)' });
    for (let i = 0; i < 5; i++) add('rect', { x: 54 + i * 11, y: 14, width: 6, height: 20, rx: 2, fill: 'rgba(40,30,0,.55)' });   // 散熱孔看見定子
    for (let i = 0; i < 5; i++) add('rect', { x: 55 + i * 11, y: 16, width: 4, height: 16, rx: 1, fill: '#b5662a', opacity: .75 });   // 銅線圈
    add('rect', { x: 44, y: 40, width: 72, height: 12, rx: 3, fill: 'url(#bg-black-side)', stroke: '#000' });
    add('rect', { x: 36, y: 50, width: 88, height: 5, rx: 2, fill: '#2a2e33' });
    T(140, 22, 'A2212', 'ba-label'); T(140, 36, '930KV', 'ba-silk dark');
  } else if (kind === 'safety_switch') {
    // 安全開關：黑色方塊、紅色按鈕帶 LED 環；左側 3P 線
    for (const [y, c] of [[24, WC.red], [40, WC.yellow], [56, WC.black]]) wire(36, 40 + (y - 40) * 0.3, 14, y, c, 3.2, 0.5, true);
    housing(12, 40, 3, 16, true, 12);
    add('rect', { x: 34, y: 12, width: 104, height: 56, rx: 10, fill: 'url(#bg-case)', stroke: '#4a525c', 'stroke-width': 1.5, filter: 'url(#bg-shadow)' });
    add('circle', { cx: 108, cy: 40, r: 22, fill: '#1a1c1f', stroke: '#e03a3a', 'stroke-width': 3 });
    add('circle', { cx: 108, cy: 40, r: 16, fill: 'url(#bg-red)' });
    add('ellipse', { cx: 102, cy: 33, rx: 6, ry: 3.5, fill: 'rgba(255,255,255,.55)' });
    T(62, 38, 'SAFETY', 'ba-silk light'); T(62, 52, 'SWITCH', 'ba-silk faint');
  } else if (kind === 'buzzer') {
    // 主動蜂鳴器：黑色圓柱、中間音孔、＋號；右側紅黑線到 2P 接頭
    wire(66, 30, 124, 27, WC.red, 3.2, 0.5, true); wire(66, 42, 124, 43, WC.black, 3.2, 0.5, true);
    housing(130, 35, 2, 16, true, 12);
    add('circle', { cx: 42, cy: h / 2, r: 28, fill: 'url(#bg-buzz)', stroke: '#000', 'stroke-width': 1.5, filter: 'url(#bg-shadow)' });
    add('circle', { cx: 42, cy: h / 2, r: 21, fill: 'none', stroke: 'rgba(255,255,255,.1)', 'stroke-width': 2 });
    add('circle', { cx: 42, cy: h / 2, r: 4.5, fill: '#000', stroke: '#444' });
    T(28, h / 2 - 8, '+', 'ba-silk light');
    T(42, h / 2 + 20, 'BUZZER', 'ba-silk faint tiny');
  }
}

// Pixhawk 2.4.8 外殼（工作台與縮圖共用的外觀層；接口與排針由 bench.js 依引腳表畫）
export function drawPixhawkCase(add, w, h) {
  add('rect', { x: 0, y: 0, width: w, height: h, rx: 26, fill: 'url(#bg-case)', stroke: '#14171a', 'stroke-width': 3, filter: 'url(#bg-shadow)' });
  add('rect', { x: 10, y: 10, width: w - 20, height: h - 20, rx: 20, fill: 'url(#bg-case-top)', stroke: 'rgba(255,255,255,.08)', 'stroke-width': 2 });
  add('rect', { x: 18, y: 14, width: w - 36, height: 12, rx: 6, fill: 'rgba(255,255,255,.07)' });
  // 上蓋印字區（淺灰）
  add('rect', { x: w / 2 - 95, y: 154, width: 190, height: 54, rx: 9, fill: '#d6dadf', opacity: .92 });
  add('text', { x: w / 2, y: 184, 'text-anchor': 'middle', class: 'ba-brand dark' }, 'pixhawk');
  add('text', { x: w / 2, y: 201, 'text-anchor': 'middle', class: 'ba-silk dark' }, '2.4.8  ·  32bit ARM');
  // 機頭箭頭與狀態燈
  add('path', { d: `M${w / 2},22 l16,24 h-9 v14 h-14 v-14 h-9 z`, fill: '#e8ecef' });
  add('circle', { cx: w / 2, cy: 90, r: 14, fill: 'url(#bg-led-blue)' }); add('circle', { cx: w / 2, cy: 90, r: 6, fill: '#bfe2ff' });
  for (const [sx, sy] of [[20, 20], [w - 20, 20], [20, h - 20], [w - 20, h - 20]]) { add('circle', { cx: sx, cy: sy, r: 7, fill: '#0c0d0f', stroke: '#5a626b' }); add('path', { d: `M${sx - 4},${sy} h8 M${sx},${sy - 4} v8`, stroke: '#5a626b', 'stroke-width': 1.5 }); }
}

// 零件欄縮圖用的 Pixhawk（外殼＋代表性接口與後端排針）
export function drawPixhawkThumb(add, w, h) {
  drawPixhawkCase(add, w, h);
  for (const [x, y] of [[90, 260], [90, 340], [90, 420], [310, 260], [310, 340], [310, 420]]) add('rect', { x: x - 44, y: y - 14, width: 88, height: 28, rx: 4, fill: '#f2f2f2', stroke: '#9aa2aa' });
  add('rect', { x: 36, y: h - 120, width: w - 72, height: 84, rx: 4, fill: '#0b0c0e' });
  for (let c = 0; c < 16; c++) for (let r = 0; r < 3; r++) add('rect', { x: 50 + c * 19, y: h - 108 + r * 22, width: 10, height: 10, fill: '#d9b44a' });
}

// 零件欄縮圖：回傳一個小 SVG（依零件實際外框，含伸出的天線、線材）
export function thumb(id, [w, h]) {
  const s = document.createElementNS(NS, 'svg');
  const padL = id === 'receiver' ? 60 : 8;
  s.setAttribute('viewBox', `${-padL} ${-8} ${w + padL + 8} ${h + 16}`); s.setAttribute('class', 'bench-thumb'); s.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; s.append(e); return e; };
  if (id === 'pixhawk') drawPixhawkThumb(add, w, h); else drawBody(add, id, w, h);
  return s;
}
