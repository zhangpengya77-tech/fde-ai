// F450 實訓中心｜工作台零件擬真圖（P13）
// 全部自製 SVG：依實物外觀（顏色、形狀、接頭位置）簡化繪製，不使用任何第三方圖片。
// 外形依據：Pixhawk 2.4.8 說明書、樂迪 R9DS 官方尺寸 43×24×15 mm、A2212/13T 930KV 馬達照片、20A 電調（黃色熱縮）、F450 下中心板。
const NS = 'http://www.w3.org/2000/svg';

// 共用漸層（放在一個隱藏的 SVG 裡，畫布與縮圖都用 url(#…) 引用）
export function ensureDefs() {
  if (document.getElementById('bench-defs')) return;
  const s = document.createElementNS(NS, 'svg');
  s.id = 'bench-defs'; s.setAttribute('width', '0'); s.setAttribute('height', '0'); s.setAttribute('aria-hidden', 'true');
  s.style.position = 'absolute';
  s.innerHTML = `<defs>
    <linearGradient id="bg-case" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b3036"/><stop offset="1" stop-color="#121417"/></linearGradient>
    <linearGradient id="bg-yellow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset=".55" stop-color="#e2bd2b"/><stop offset="1" stop-color="#b8920f"/></linearGradient>
    <linearGradient id="bg-green" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f8f5c"/><stop offset="1" stop-color="#16573a"/></linearGradient>
    <linearGradient id="bg-pcb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#26303b"/><stop offset="1" stop-color="#141a21"/></linearGradient>
    <linearGradient id="bg-batt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3f46"/><stop offset=".5" stop-color="#1b1e22"/><stop offset="1" stop-color="#0d0f11"/></linearGradient>
    <linearGradient id="bg-xt60" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd84a"/><stop offset="1" stop-color="#d4a20a"/></linearGradient>
    <radialGradient id="bg-bell" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ffe7a0"/><stop offset=".55" stop-color="#d6a92a"/><stop offset="1" stop-color="#8a6a10"/></radialGradient>
    <radialGradient id="bg-puck" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#4a5058"/><stop offset="1" stop-color="#101214"/></radialGradient>
    <radialGradient id="bg-red" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ff9a9a"/><stop offset=".6" stop-color="#d63c3c"/><stop offset="1" stop-color="#7a1414"/></radialGradient>
    <filter id="bg-shadow" x="-10%" y="-10%" width="130%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity=".35"/></filter>
  </defs>`;
  document.body.append(s);
}

// 畫零件本體。add(tag, attrs, text) 加到目標群組；w、h 為零件外框（引腳畫在外框邊上，由工作台另外畫）
export function drawBody(add, id, w, h) {
  const kind = id.replace(/_(fr|fl|rl|rr)$/, '');
  const T = (x, y, t, cls, anchor = 'middle') => add('text', { x, y, 'text-anchor': anchor, class: cls }, t);
  if (kind === 'receiver') {
    add('rect', { x: 6, y: 6, width: w - 12, height: h - 12, rx: 10, fill: 'url(#bg-case)', stroke: '#4a525c', 'stroke-width': 2, filter: 'url(#bg-shadow)' });
    for (let c = 0; c < 9; c++) for (let r = 0; r < 3; r++) add('rect', { x: 16 + c * 13, y: 16 + r * 11, width: 7, height: 7, rx: 1, fill: ['#d9b44a', '#d9b44a', '#d9b44a'][r], stroke: '#6b5513' });
    for (let c = 0; c < 9; c++) T(19.5 + c * 13, 58, c === 8 ? 'S' : String(c + 1), 'ba-silk');
    add('rect', { x: 14, y: 64, width: 96, height: 16, rx: 3, fill: '#f2f2ee' });
    T(62, 76, 'RadioLink R9DS', 'ba-label');
    add('circle', { cx: w - 22, cy: 22, r: 4, fill: '#3fa0ff' });
    add('path', { d: `M${w - 10},${h - 30} q30,-10 44,-40`, stroke: '#2b2b2b', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' });
    add('path', { d: `M${w - 10},${h - 18} q36,4 48,-14`, stroke: '#2b2b2b', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' });
    add('path', { d: `M${w + 26},${h - 64} l8,-12 M${w + 34},${h - 30} l12,-4`, stroke: '#f2f2ee', 'stroke-width': 4, 'stroke-linecap': 'round' });
  } else if (kind === 'gps') {
    const cx = w / 2, cy = 82;
    add('rect', { x: cx - 10, y: cy + 40, width: 20, height: h - cy - 52, fill: '#8a939c' });                        // 支架
    add('circle', { cx, cy, r: 68, fill: 'url(#bg-puck)', stroke: '#2a2e33', 'stroke-width': 3, filter: 'url(#bg-shadow)' });
    add('circle', { cx, cy, r: 46, fill: 'none', stroke: '#e8ecef', 'stroke-width': 5 });
    add('path', { d: `M${cx},${cy - 32} l20,28 h-11 v26 h-18 v-26 h-11 z`, fill: '#d63c3c' });
    T(cx, cy + 58, 'GPS', 'ba-silk light');
    add('rect', { x: 6, y: h - 24, width: w - 12, height: 16, rx: 3, fill: '#2a2e33' });
    T(cx, h - 12, 'M8N', 'ba-silk light');
  } else if (kind === 'power_module') {
    add('rect', { x: 18, y: 14, width: w - 36, height: h - 28, rx: 6, fill: 'url(#bg-green)', stroke: '#0f3d27', 'stroke-width': 2, filter: 'url(#bg-shadow)' });
    for (let i = 0; i < 4; i++) add('rect', { x: 34 + i * 18, y: 34, width: 10, height: 6, fill: '#c9ced4' });
    add('rect', { x: 34, y: 50, width: 26, height: 18, rx: 2, fill: '#15181c' });
    add('rect', { x: 70, y: 50, width: 14, height: 14, rx: 7, fill: '#c9a227' });
    T(w / 2 + 20, h - 22, 'PM 5.3V', 'ba-silk light');
    add('rect', { x: w / 2 - 20, y: h - 18, width: 40, height: 18, rx: 3, fill: 'url(#bg-xt60)', stroke: '#7a6300' });   // XT60 輸入（下）
    add('rect', { x: 0, y: h * 0.75 - 9, width: 26, height: 18, rx: 3, fill: 'url(#bg-xt60)', stroke: '#7a6300' });      // XT60 輸出（左）
    add('rect', { x: w / 2 - 30, y: 2, width: 60, height: 14, rx: 2, fill: '#f4f4f4', stroke: '#9aa2aa' });              // 6P 飛控線
  } else if (kind === 'battery') {
    add('rect', { x: 4, y: 12, width: w - 8, height: h - 16, rx: 8, fill: 'url(#bg-batt)', stroke: '#000', 'stroke-width': 1.5, filter: 'url(#bg-shadow)' });
    add('rect', { x: 14, y: 30, width: w - 28, height: 22, rx: 3, fill: '#f2f2ee' });
    T(w / 2, 46, '4S 14.8V LiPo', 'ba-label');
    add('rect', { x: w / 2 - 18, y: 0, width: 36, height: 14, rx: 3, fill: 'url(#bg-xt60)', stroke: '#7a6300' });
    add('rect', { x: w - 30, y: 4, width: 18, height: 8, rx: 2, fill: '#f4f4f4', stroke: '#9aa2aa' });                    // 平衡頭
  } else if (kind === 'pdb') {
    add('path', { d: `M30,8 H${w - 30} Q${w - 8},8 ${w - 8},30 V${h - 30} Q${w - 8},${h - 8} ${w - 30},${h - 8} H30 Q8,${h - 8} 8,${h - 30} V30 Q8,8 30,8 Z`, fill: 'url(#bg-pcb)', stroke: '#c9a227', 'stroke-width': 3, filter: 'url(#bg-shadow)' });
    for (const [x, y] of [[40, 30], [40, h - 30], [w - 40, 30], [w - 40, h - 30]]) { add('rect', { x: x - 14, y: y - 9, width: 12, height: 18, rx: 2, fill: '#e0b54a' }); add('rect', { x: x + 2, y: y - 9, width: 12, height: 18, rx: 2, fill: '#e0b54a' }); }
    for (let i = 0; i < 6; i++) add('circle', { cx: w / 2 - 75 + i * 30, cy: h / 2, r: 5, fill: '#0c1015', stroke: '#c9a227' });
    T(w / 2, h / 2 - 16, 'F450  ＋  −', 'ba-silk gold');
  } else if (kind === 'esc') {
    add('rect', { x: 26, y: 26, width: w - 52, height: h - 52, rx: 14, fill: 'url(#bg-yellow)', stroke: '#9b7a0c', 'stroke-width': 2, filter: 'url(#bg-shadow)' });
    add('path', { d: `M38,40 H${w - 38}`, stroke: '#fff2b0', 'stroke-width': 3, opacity: .7 });
    T(w / 2, h / 2 + 10, '20A', 'ba-big dark');
  } else if (kind === 'motor') {
    const cx = 44, cy = h / 2;
    add('rect', { x: 4, y: cy - 12, width: 80, height: 24, rx: 6, fill: '#2a2e33' });                               // 底座
    add('circle', { cx, cy, r: 30, fill: 'url(#bg-bell)', stroke: '#6e5410', 'stroke-width': 2, filter: 'url(#bg-shadow)' });
    for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; add('circle', { cx: cx + Math.cos(a) * 18, cy: cy + Math.sin(a) * 18, r: 4, fill: '#5c470d' }); }
    add('circle', { cx, cy, r: 7, fill: '#d8d8d8', stroke: '#777' });
    T(118, cy - 4, 'A2212', 'ba-label dark');
    T(118, cy + 14, '930KV', 'ba-silk dark');
  } else if (kind === 'safety_switch') {
    add('rect', { x: 8, y: 8, width: w - 16, height: h - 16, rx: 10, fill: 'url(#bg-case)', stroke: '#4a525c', 'stroke-width': 2, filter: 'url(#bg-shadow)' });
    add('circle', { cx: w - 40, cy: h / 2, r: 20, fill: 'url(#bg-red)', stroke: '#ffb3b3', 'stroke-width': 2 });
    T(54, h / 2 + 5, 'SAFETY', 'ba-silk light');
  } else if (kind === 'buzzer') {
    add('rect', { x: 8, y: 8, width: w - 16, height: h - 16, rx: 10, fill: '#e8eaed', opacity: 0 });
    add('circle', { cx: 46, cy: h / 2, r: 26, fill: 'url(#bg-case)', stroke: '#000', 'stroke-width': 2, filter: 'url(#bg-shadow)' });
    add('circle', { cx: 46, cy: h / 2, r: 5, fill: '#000' });
    T(36, h / 2 - 10, '+', 'ba-silk light');
    T(100, h / 2 + 5, 'BUZZER', 'ba-silk dark', 'start');
  }
}

// 零件欄縮圖用的 Pixhawk（簡化：外殼、箭頭、接頭、後端排針）
export function drawPixhawkThumb(add, w, h) {
  add('rect', { x: 4, y: 4, width: w - 8, height: h - 8, rx: 30, fill: 'url(#bg-case)', stroke: '#454c55', 'stroke-width': 6 });
  add('path', { d: `M${w / 2},40 l40,60 h-24 v40 h-32 v-40 h-24 z`, fill: '#e8ecef' });
  for (const [x, y] of [[90, 200], [90, 300], [310, 200], [310, 300], [200, 420]]) add('rect', { x: x - 40, y: y - 14, width: 80, height: 28, rx: 4, fill: '#f2f2f2' });
  for (let c = 0; c < 16; c++) for (let r = 0; r < 3; r++) add('rect', { x: 50 + c * 19, y: h - 110 + r * 22, width: 10, height: 10, fill: ['#e8e2c8', '#c0392b', '#2a2a2a'][r] });
}

// 零件欄縮圖：回傳一個小 SVG
export function thumb(id, [w, h]) {
  const s = document.createElementNS(NS, 'svg');
  const pad = id === 'receiver' ? 50 : 8;
  s.setAttribute('viewBox', `${-8} ${-8} ${w + pad + 8} ${h + 16}`); s.setAttribute('class', 'bench-thumb'); s.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; s.append(e); return e; };
  if (id === 'pixhawk') drawPixhawkThumb(add, w, h); else drawBody(add, id, w, h);
  return s;
}
