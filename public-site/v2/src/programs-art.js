/*
 * FDE-AI 五大職業實訓課程｜原創技術示意圖（2026-11-17）
 * - 全部由程式繪製的 SVG 線框圖（深海軍藍底、青藍光線、資料網格），FDE-AI 自有，不使用任何第三方圖片或品牌。
 * - 這些都是「示意圖」，不是真實教學設備照片；頁面上會標示「示意圖」，實拍照片另外標示「實拍」。
 * - 每張圖約 2～4 KB，不需下載點陣圖，老舊教室電腦也能快速開啟。
 */
(function (root) {
  'use strict';
  const C = { cyan: '#00c2ff', blue: '#168bff', green: '#35e6a8', yellow: '#f5b84b', red: '#ff5c73', line: 'rgba(0,194,255,.55)', dim: 'rgba(0,194,255,.18)', text: '#ddf3ff' };
  let uid = 0;

  // ── 基本零件 ──
  const quadTop = (x, y, s = 1, spin = true) => {
    const a = 38 * s, r = 17 * s;
    const rot = (cx, cy) => `<g class="pa-rotor"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.cyan}" stroke-width="1.6" opacity=".9"/><path d="M${cx - r * 0.8},${cy} L${cx + r * 0.8},${cy}" stroke="${C.cyan}" stroke-width="2" class="${spin ? 'pa-spin' : ''}" style="transform-origin:${cx}px ${cy}px"/></g>`;
    return `<g><path d="M${x - a},${y - a} L${x + a},${y + a} M${x + a},${y - a} L${x - a},${y + a}" stroke="${C.line}" stroke-width="4" stroke-linecap="round"/>
      <rect x="${x - 13 * s}" y="${y - 13 * s}" width="${26 * s}" height="${26 * s}" rx="${5 * s}" fill="#0b2340" stroke="${C.cyan}" stroke-width="1.6"/>
      <circle cx="${x}" cy="${y}" r="${4 * s}" fill="${C.green}"/>
      ${rot(x - a, y - a)}${rot(x + a, y - a)}${rot(x - a, y + a)}${rot(x + a, y + a)}</g>`;
  };
  const quadSide = (x, y, s = 1) => `<g><path d="M${x - 46 * s},${y} H${x + 46 * s}" stroke="${C.line}" stroke-width="4" stroke-linecap="round"/>
    <rect x="${x - 14 * s}" y="${y - 10 * s}" width="${28 * s}" height="${16 * s}" rx="4" fill="#0b2340" stroke="${C.cyan}" stroke-width="1.5"/>
    <path d="M${x - 62 * s},${y - 8 * s} H${x - 30 * s} M${x + 30 * s},${y - 8 * s} H${x + 62 * s}" stroke="${C.cyan}" stroke-width="2.4" class="pa-blur"/>
    <path d="M${x - 46 * s},${y} v-8 M${x + 46 * s},${y} v-8" stroke="${C.cyan}" stroke-width="2"/>
    <path d="M${x - 18 * s},${y + 6 * s} l-8 ${16 * s} M${x + 18 * s},${y + 6 * s} l8 ${16 * s}" stroke="${C.line}" stroke-width="2"/></g>`;
  const plane = (x, y, s = 1, vtol = false) => `<g><path d="M${x - 60 * s},${y} L${x + 60 * s},${y}" stroke="${C.cyan}" stroke-width="3" stroke-linecap="round"/>
    <path d="M${x - 10 * s},${y - 50 * s} L${x + 6 * s},${y - 50 * s} L${x + 8 * s},${y + 50 * s} L${x - 12 * s},${y + 50 * s} Z" fill="rgba(0,194,255,.12)" stroke="${C.cyan}" stroke-width="1.6"/>
    <path d="M${x + 44 * s},${y} l12 -16 M${x + 44 * s},${y} l12 16" stroke="${C.cyan}" stroke-width="2"/>
    ${vtol ? [-30, 30].map((dy) => `<circle cx="${x - 2 * s}" cy="${y + dy * s}" r="${14 * s}" fill="none" stroke="${C.green}" stroke-width="1.5"/><path d="M${x - 14 * s},${y + dy * s} h${24 * s}" stroke="${C.green}" stroke-width="2" class="pa-spin" style="transform-origin:${x - 2 * s}px ${y + dy * s}px"/>`).join('') : ''}</g>`;
  const rover = (x, y, s = 1) => `<g><rect x="${x - 50 * s}" y="${y - 18 * s}" width="${100 * s}" height="${30 * s}" rx="6" fill="#0b2340" stroke="${C.cyan}" stroke-width="1.6"/>
    ${[-34, 34].map((dx) => `<circle cx="${x + dx * s}" cy="${y + 16 * s}" r="${12 * s}" fill="none" stroke="${C.cyan}" stroke-width="2"/>`).join('')}
    <rect x="${x - 8 * s}" y="${y - 32 * s}" width="${16 * s}" height="${14 * s}" rx="3" fill="none" stroke="${C.green}" stroke-width="1.6"/>
    <path d="M${x},${y - 32 * s} m-40,-6 a40,40 0 0 1 80,0" fill="none" stroke="${C.green}" stroke-width="1" stroke-dasharray="3 4" class="pa-scan"/></g>`;
  const screen = (x, y, w, h, inner = '') => `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#081a2e" stroke="${C.cyan}" stroke-width="1.6"/>
    <rect x="${x}" y="${y}" width="${w}" height="10" rx="5" fill="rgba(0,194,255,.25)"/>${inner}
    <path d="M${x + w / 2 - 14},${y + h} l-6 14 h40 l-6 -14" fill="none" stroke="${C.line}" stroke-width="1.5"/></g>`;
  const chart = (x, y, w, h, color = C.green) => { const pts = Array.from({ length: 9 }, (_, i) => `${x + (w * i) / 8},${y + h * (0.5 + 0.35 * Math.sin(i * 1.3 + w))}`).join(' '); return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8"/>`; };
  const bbox = (x, y, w, h, label, col = C.green) => `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${col}" stroke-width="2"/><rect x="${x}" y="${y - 14}" width="${label.length * 7 + 10}" height="14" fill="${col}"/><text x="${x + 5}" y="${y - 3}" font-size="10" font-family="monospace" fill="#04121f">${label}</text></g>`;
  const pcb = (x, y, w, h) => { let t = ''; for (let i = 0; i < 6; i++) t += `<path d="M${x + 12},${y + 14 + i * (h - 28) / 5} H${x + w * 0.4} L${x + w * 0.5},${y + h / 2} H${x + w - 14}" fill="none" stroke="${C.yellow}" stroke-width="1.4" opacity=".75"/>`;
    return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#0c3a2b" stroke="${C.green}" stroke-width="1.6"/>${t}<rect x="${x + w * 0.45}" y="${y + h * 0.3}" width="${w * 0.22}" height="${h * 0.4}" rx="3" fill="#081a2e" stroke="${C.cyan}" stroke-width="1.5"/>${Array.from({ length: 5 }, (_, i) => `<circle cx="${x + 14 + i * 16}" cy="${y + h - 12}" r="3" fill="${C.yellow}"/>`).join('')}</g>`; };
  const printer = (x, y) => `<g><rect x="${x}" y="${y}" width="110" height="110" rx="6" fill="none" stroke="${C.cyan}" stroke-width="1.8"/><path d="M${x + 8},${y + 24} H${x + 102}" stroke="${C.line}" stroke-width="2"/>
    <rect x="${x + 44}" y="${y + 18}" width="22" height="14" rx="2" fill="#0b2340" stroke="${C.cyan}"/><path d="M${x + 55},${y + 32} v10" stroke="${C.yellow}" stroke-width="2"/>
    <path d="M${x + 30},${y + 98} L${x + 42},${y + 62} H${x + 70} L${x + 82},${y + 98} Z" fill="rgba(0,194,255,.15)" stroke="${C.green}" stroke-width="1.5"/><path d="M${x + 10},${y + 100} H${x + 100}" stroke="${C.cyan}" stroke-width="2"/></g>`;
  const people = (x, y, n = 3, s = 1) => Array.from({ length: n }, (_, i) => { const px = x + i * 34 * s; return `<g opacity=".9"><circle cx="${px}" cy="${y}" r="${8 * s}" fill="none" stroke="${C.cyan}" stroke-width="1.6"/><path d="M${px - 13 * s},${y + 30 * s} q${13 * s},-${26 * s} ${26 * s},0" fill="none" stroke="${C.cyan}" stroke-width="1.6"/></g>`; }).join('');
  const tower = (x, y) => `<g><path d="M${x},${y} L${x - 30},${y + 130} M${x},${y} L${x + 30},${y + 130} M${x - 22},${y + 40} H${x + 22} M${x - 40},${y + 22} H${x + 40} M${x - 14},${y + 70} L${x + 20},${y + 100} M${x + 14},${y + 70} L${x - 20},${y + 100}" stroke="${C.cyan}" stroke-width="1.8" fill="none"/>${[-40, 40].map((d) => `<circle cx="${x + d}" cy="${y + 26}" r="3" fill="${C.yellow}"/>`).join('')}</g>`;
  const check = (x, y, rows = 4) => `<g><rect x="${x}" y="${y}" width="120" height="${rows * 22 + 20}" rx="6" fill="#081a2e" stroke="${C.cyan}" stroke-width="1.6"/>${Array.from({ length: rows }, (_, i) => `<path d="M${x + 12},${y + 22 + i * 22} l5 5 l9 -10" stroke="${C.green}" stroke-width="2" fill="none"/><path d="M${x + 36},${y + 22 + i * 22} H${x + 104}" stroke="${C.line}" stroke-width="2"/>`).join('')}</g>`;
  const wrench = (x, y, s = 1) => `<path d="M${x},${y} l${40 * s},${40 * s} m-${46 * s},-${50 * s} a${12 * s},${12 * s} 0 1 0 ${14 * s},${14 * s} l-${6 * s},-${2 * s} l-${2 * s},-${6 * s} Z" fill="none" stroke="${C.yellow}" stroke-width="2.4" stroke-linecap="round"/>`;
  const gimbal = (x, y) => `<g><path d="M${x},${y - 40} v14 M${x - 22},${y - 26} h44 v26 M${x - 22},${y - 26} v26" fill="none" stroke="${C.cyan}" stroke-width="2"/><rect x="${x - 18}" y="${y}" width="36" height="26" rx="5" fill="#0b2340" stroke="${C.cyan}" stroke-width="1.8"/><circle cx="${x}" cy="${y + 13}" r="8" fill="none" stroke="${C.green}" stroke-width="2"/></g>`;
  const thermal = (x, y, w, h) => `<g><defs><linearGradient id="pa-th${uid}" x1="0" x2="1"><stop offset="0" stop-color="#1b2c8a"/><stop offset=".5" stop-color="#c2185b"/><stop offset="1" stop-color="#ffd54f"/></linearGradient></defs><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="url(#pa-th${uid})" opacity=".85"/></g>`;
  const grid = (x, y, w, h, n = 6) => { let g = ''; for (let i = 0; i <= n; i++) g += `<path d="M${x + (w * i) / n},${y} V${y + h} M${x},${y + (h * i) / n} H${x + w}" stroke="${C.dim}" stroke-width="1"/>`; return g; };
  const route = (pts, col = C.yellow) => `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="6 5" class="pa-dash"/>${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${col}"/>`).join('')}`;
  const label = (x, y, t, size = 12, col = C.cyan) => `<text x="${x}" y="${y}" font-size="${size}" font-family="monospace" fill="${col}" letter-spacing="1">${t}</text>`;

  // ── 各場景（畫布 320×200） ──
  const SCENES = {
    license: () => `${grid(30, 20, 260, 160)}${route([[60, 160], [60, 50], [160, 50], [260, 50], [260, 160]])}${quadTop(160, 105, 0.9)}${label(20, 190, 'PRE-FLIGHT · HOVER · ROUTE')}`,
    seed: () => `${people(40, 120, 4)}${screen(170, 30, 130, 90, chart(180, 50, 110, 60))}${quadTop(90, 60, 0.6)}${label(20, 190, 'TEACH · BUILD · AI')}`,
    pilot: () => `${tower(250, 30)}${route([[40, 170], [120, 60], [210, 60], [250, 40]])}${quadTop(140, 110, 0.75)}${label(20, 190, 'MISSION · INSPECT · MAP')}`,
    rd: () => `${pcb(20, 30, 130, 90)}${screen(170, 30, 130, 90, `<text x="182" y="62" font-size="10" font-family="monospace" fill="${C.green}">ros2 launch nav2</text><text x="182" y="78" font-size="10" font-family="monospace" fill="${C.cyan}">sim_vehicle.py -v Copter</text><text x="182" y="94" font-size="10" font-family="monospace" fill="${C.yellow}">MAVLink HEARTBEAT ✓</text>`)}${quadSide(160, 165, 0.7)}${label(20, 194, 'PCB · SITL · ROS 2 · QGC')}`,
    mro: () => `${quadTop(110, 100, 0.95, false)}${wrench(200, 60, 1.1)}${check(210, 110, 3)}${label(20, 190, 'ASSEMBLE · DIAGNOSE · VERIFY')}`,
    rules: () => `${check(30, 40, 4)}<circle cx="230" cy="100" r="54" fill="none" stroke="${C.red}" stroke-width="3"/><path d="M192,138 L268,62" stroke="${C.red}" stroke-width="3"/>${quadTop(230, 100, 0.45, false)}${label(20, 190, 'RULES · SAFETY · NO-FLY ZONE')}`,
    simulator: () => `${screen(30, 24, 260, 130, `${grid(40, 40, 240, 104, 8)}${route([[70, 130], [120, 70], [200, 70], [250, 120]], C.green)}`)}${quadTop(160, 98, 0.45)}${label(20, 194, 'SIMULATOR TRAINING')}`,
    hover: () => `${quadSide(160, 80, 1)}<ellipse cx="160" cy="160" rx="70" ry="14" fill="none" stroke="${C.yellow}" stroke-width="2"/><path d="M160,100 v50" stroke="${C.line}" stroke-dasharray="4 4"/>${label(20, 190, 'HOVER · ATTITUDE CONTROL')}`,
    route: () => `${grid(30, 20, 260, 160)}<circle cx="110" cy="100" r="50" fill="none" stroke="${C.yellow}" stroke-width="2" stroke-dasharray="6 5" class="pa-dash"/><circle cx="210" cy="100" r="50" fill="none" stroke="${C.yellow}" stroke-width="2" stroke-dasharray="6 5" class="pa-dash"/>${quadTop(160, 100, 0.4)}${label(20, 194, 'EXAM ROUTE · FIGURE 8')}`,
    checklist: () => `${check(40, 30, 5)}${quadTop(240, 100, 0.7, false)}${label(20, 194, 'PRE-FLIGHT CHECK SOP')}`,
    f450: () => `${quadTop(160, 100, 1.15, false)}<path d="M120,60 h-60 M200,140 h70" stroke="${C.yellow}" stroke-width="1.4"/>${label(16, 56, 'ESC', 11, C.yellow)}${label(272, 144, 'FC', 11, C.yellow)}${label(20, 194, 'F450 ASSEMBLY')}`,
    cad: () => `${printer(190, 50)}<g transform="translate(40 40)"><path d="M0,60 L60,30 L120,60 L60,90 Z M0,60 V100 L60,130 V90 M120,60 V100 L60,130" fill="rgba(0,194,255,.08)" stroke="${C.cyan}" stroke-width="1.6"/></g>${label(20, 194, 'CAD · 3D PRINT')}`,
    ai: () => `${screen(30, 24, 260, 140, `${quadTop(110, 95, 0.45)}${bbox(80, 64, 64, 62, 'drone 0.94')}${bbox(170, 80, 90, 56, 'prop CW 0.88', C.yellow)}`)}${label(20, 194, 'YOLO · AI VISION')}`,
    industry: () => `${tower(70, 30)}<path d="M150,150 l30,-30 h60 l-30,30 Z M170,135 h60" stroke="${C.cyan}" stroke-width="1.6" fill="rgba(0,194,255,.08)"/>${quadTop(240, 60, 0.5)}${label(20, 194, 'INSPECTION · MAPPING · AGRI')}`,
    classroom: () => `${screen(110, 20, 140, 90, chart(122, 40, 116, 56, C.cyan))}${people(60, 140, 6, 0.9)}${label(20, 194, 'LESSON DESIGN · TEACHING')}`,
    factory: () => `<path d="M20,150 H300" stroke="${C.cyan}" stroke-width="3"/>${[50, 110, 170, 230].map((x) => `<circle cx="${x}" cy="160" r="8" fill="none" stroke="${C.cyan}" stroke-width="1.6"/>`).join('')}${[60, 150, 240].map((x) => quadTop(x, 120, 0.32, false)).join('')}<path d="M40,30 h240 v50 h-240 Z" fill="none" stroke="${C.line}"/>${label(52, 60, 'ASSEMBLY · QC LINE', 12)}${label(20, 194, 'FACTORY INTERNSHIP')}`,
    assistant: () => `${people(40, 110, 3)}${people(200, 110, 3)}<path d="M150,60 v90" stroke="${C.line}" stroke-dasharray="4 4"/>${quadTop(160, 50, 0.4, false)}${label(20, 194, 'TEACHING ASSISTANT')}`,
    exam: () => `<rect x="90" y="30" width="140" height="120" rx="8" fill="#081a2e" stroke="${C.cyan}" stroke-width="1.8"/><path d="M130,80 l18 20 l40 -46" stroke="${C.green}" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="160" cy="125" r="10" fill="none" stroke="${C.yellow}" stroke-width="2"/>${label(20, 194, 'FINAL REVIEW · PORTFOLIO')}`,
    mission: () => `${screen(30, 24, 260, 130, `${grid(40, 40, 240, 104, 8)}${route([[60, 130], [60, 60], [140, 60], [140, 130], [220, 130], [220, 60], [270, 60]], C.yellow)}`)}${label(20, 194, 'MISSION PLANNER · QGC')}`,
    inspection: () => `${tower(90, 30)}<rect x="170" y="120" width="120" height="50" fill="rgba(0,194,255,.1)" stroke="${C.cyan}" stroke-width="1.5"/>${grid(170, 120, 120, 50, 6)}${quadTop(210, 70, 0.45)}${bbox(60, 50, 60, 40, 'defect', C.red)}${label(20, 194, 'POWER LINE · SOLAR INSPECT')}`,
    agri: () => `${Array.from({ length: 7 }, (_, i) => `<path d="M${20 + i * 44},180 L${100 + i * 30},110" stroke="${C.green}" stroke-width="1.5" opacity=".7"/>`).join('')}${quadSide(160, 60, 0.9)}${Array.from({ length: 9 }, (_, i) => `<path d="M${120 + i * 10},76 l${(i - 4) * 3},30" stroke="${C.cyan}" stroke-width="1" stroke-dasharray="2 4" class="pa-dash"/>`).join('')}${label(20, 194, 'AGRI SPRAY PLANNING')}`,
    clean: () => `<rect x="30" y="20" width="110" height="160" fill="rgba(0,194,255,.06)" stroke="${C.cyan}" stroke-width="1.6"/>${grid(30, 20, 110, 160, 5)}${quadSide(210, 90, 0.85)}<path d="M168,92 Q150,96 140,100" stroke="${C.cyan}" stroke-width="2" stroke-dasharray="3 3" class="pa-dash"/><path d="M200,180 h100" stroke="${C.red}" stroke-width="2" stroke-dasharray="8 6"/>${label(196, 174, 'SAFETY ZONE', 10, C.red)}${label(20, 194, 'FACADE CLEANING')}`,
    mapping: () => `${grid(30, 20, 260, 160, 8)}${route([[50, 40], [270, 40], [270, 80], [50, 80], [50, 120], [270, 120], [270, 160], [50, 160]], C.cyan)}<path d="M110,150 l40,-50 l30,30 l40,-60 l40,80 Z" fill="rgba(53,230,168,.15)" stroke="${C.green}" stroke-width="1.6"/>${label(20, 194, 'PHOTOGRAMMETRY · WebODM')}`,
    formation: () => `${grid(30, 20, 260, 150)}${quadTop(110, 80, 0.45)}${quadTop(210, 80, 0.45)}<path d="M110,80 H210" stroke="${C.green}" stroke-width="1.4" stroke-dasharray="4 4" class="pa-dash"/>${label(88, 140, 'LEADER', 10, C.green)}${label(186, 140, 'FOLLOWER', 10, C.green)}${label(20, 194, 'MAVLink · DUAL SITL (DEV)')}`,
    pcb: () => `${pcb(40, 30, 240, 140)}${label(20, 194, 'SCHEMATIC · KiCad PCB')}`,
    sitl: () => `${screen(20, 24, 140, 110, `<text x="30" y="56" font-size="9" font-family="monospace" fill="${C.green}">$ sim_vehicle.py</text><text x="30" y="72" font-size="9" font-family="monospace" fill="${C.cyan}">ros2 topic echo</text><text x="30" y="88" font-size="9" font-family="monospace" fill="${C.yellow}">/mavros/state</text>`)}${rover(240, 120, 0.7)}${quadTop(240, 50, 0.4)}${label(20, 194, 'SITL · ROS 2 · NAV2')}`,
    gcs: () => `${screen(30, 24, 260, 140, `<rect x="40" y="40" width="70" height="114" fill="rgba(0,194,255,.08)"/>${chart(120, 50, 160, 40, C.cyan)}${chart(120, 100, 160, 40, C.yellow)}<text x="46" y="60" font-size="9" font-family="monospace" fill="${C.text}">ALT 12.4</text><text x="46" y="76" font-size="9" font-family="monospace" fill="${C.text}">BAT 15.8V</text>`)}${label(20, 194, 'QGC · Qt/QML · MAVLink')}`,
    vtol: () => `${plane(160, 95, 1.1, true)}${label(20, 194, 'FIXED-WING · VTOL')}`,
    fixedwing: () => `${plane(160, 95, 1.1)}<circle cx="156" cy="100" r="6" fill="none" stroke="${C.yellow}" stroke-width="2"/>${label(170, 104, 'CG', 11, C.yellow)}${label(20, 194, 'FIXED-WING · V-TAIL · CG')}`,
    rover: () => `${grid(30, 20, 260, 150)}${rover(160, 110, 1.2)}${route([[60, 160], [100, 60], [260, 60]], C.green)}${label(20, 194, 'ROVER · LiDAR SLAM')}`,
    tools: () => `${wrench(70, 50, 1.3)}<rect x="170" y="50" width="100" height="70" rx="8" fill="#081a2e" stroke="${C.cyan}" stroke-width="1.8"/><text x="186" y="94" font-size="20" font-family="monospace" fill="${C.green}">16.8V</text>${label(20, 194, 'SAFETY · TOOLS · METER')}`,
    wiring: () => `${pcb(30, 60, 120, 70)}<path d="M150,80 C200,80 200,40 260,40 M150,110 C210,110 210,150 270,150" stroke="${C.red}" stroke-width="3" fill="none"/><path d="M150,90 C200,90 205,52 260,52 M150,120 C214,120 214,162 270,162" stroke="#e8eef4" stroke-width="3" fill="none"/>${label(20, 194, 'POWER · HARNESS · XT60')}`,
    fc: () => `<rect x="90" y="40" width="140" height="110" rx="14" fill="#0b2340" stroke="${C.cyan}" stroke-width="2"/><path d="M160,60 l10 14 h-6 v14 h-8 v-14 h-6 Z" fill="${C.text}"/>${Array.from({ length: 8 }, (_, i) => `<rect x="${104 + i * 15}" y="128" width="8" height="12" fill="${C.yellow}"/>`).join('')}<path d="M60,90 H90 M230,90 H270" stroke="${C.green}" stroke-width="2"/>${label(20, 194, 'FLIGHT CONTROLLER · CALIBRATE')}`,
    diagnose: () => `${screen(30, 24, 260, 130, `${chart(40, 44, 240, 40, C.yellow)}${chart(40, 92, 240, 40, C.red)}`)}${label(20, 194, 'VIBRATION · VOLTAGE · DIAGNOSE')}`,
    repair: () => `${quadTop(110, 100, 0.8, false)}${wrench(190, 70, 1.2)}<path d="M210,150 h70" stroke="${C.green}" stroke-width="3"/>${label(20, 194, 'REPAIR · RETEST')}`,
    health: () => `${screen(30, 24, 260, 130, `${chart(40, 44, 240, 90, C.green)}<rect x="210" y="40" width="70" height="20" rx="4" fill="${C.green}"/><text x="216" y="54" font-size="10" font-family="monospace" fill="#04121f">HEALTH OK</text>`)}${label(20, 194, 'FLIGHT LOG · HEALTH AI')}`,
    qc: () => `${check(30, 40, 4)}<circle cx="230" cy="100" r="44" fill="none" stroke="${C.green}" stroke-width="3"/><text x="206" y="108" font-size="22" font-family="monospace" fill="${C.green}">QC ✓</text>${label(20, 194, 'QUALITY · PARTS ACCEPTANCE')}`,
    large: () => `${quadTop(160, 100, 1.45, false)}<path d="M60,182 H260" stroke="${C.yellow}" stroke-width="1.5"/>${label(130, 178, '≥ 950 mm', 12, C.yellow)}${label(20, 30, 'LARGE EXAM AIRFRAME')}`,
    gimbal: () => `${quadSide(110, 50, 0.9)}${gimbal(110, 100)}${thermal(190, 40, 110, 80)}${bbox(220, 62, 40, 46, 'target')}${label(20, 194, 'GIMBAL · THERMAL · AI MODULE')}`,
  };

  function svg(kind, opts = {}) {
    uid++;
    const draw = SCENES[kind] || SCENES.license;
    const t = opts.title || '';
    return `<svg class="pa-art" viewBox="0 0 320 200" role="img" aria-label="${t ? t + '（示意圖）' : '課程示意圖'}" preserveAspectRatio="xMidYMid slice">
      <defs><radialGradient id="pa-bg${uid}" cx=".7" cy=".2" r="1"><stop offset="0" stop-color="#123a63"/><stop offset=".55" stop-color="#0a1c33"/><stop offset="1" stop-color="#050d18"/></radialGradient></defs>
      <rect width="320" height="200" fill="url(#pa-bg${uid})"/>${grid(0, 0, 320, 200, 10)}${draw()}</svg>`;
  }

  root.FdeProgramArt = { svg, kinds: Object.keys(SCENES) };
})(typeof self !== 'undefined' ? self : this);
