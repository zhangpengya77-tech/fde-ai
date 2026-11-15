// F450 實訓中心｜2D 接線畫布的零件擬真圖（自繪 SVG，不使用任何廠商照片或 Logo）
// 依真實零件外觀簡化繪製：Pixhawk 2.4.8 外殼與接口、R9DS 接收機與天線、M8N GPS 圓餅、黃色熱縮電調、
// 2212 金色馬達、F450 配電板焊盤、電源模組與 XT60、4S 電池、安全開關、蜂鳴器。
// 只畫外觀，接口位置與連線規則仍由 wiring-canvas.js／model.js 決定。

// 每個元件的簡介與官方資料（只放連結，新分頁開啟，不複製內容）
export const PART_INFO = {
  pixhawk: { desc: 'Pixhawk 2.4.8（Pixhawk 1 相容）飛控：箭頭朝機頭。後端排針左起 RC IN、MAIN OUT 8→1（訊號在下、正極中、負極上），ESC 訊號接 MAIN OUT 1–4；左列 GPS（6pin）、I2C（羅盤 4pin）、BUZZER（2pin）；右列 POWER（6pin 電源模組）；中間 SWITCH（3pin 安全開關）。接口位置依教師提供的《Pixhawk 2.4.8 飛控安裝指導》。', links: [['ArduPilot：Pixhawk 介紹', 'https://ardupilot.org/copter/docs/common-pixhawk-overview.html'], ['PX4：Pixhawk 1', 'https://docs.px4.io/main/en/flight_controller/pixhawk.html']] },
  receiver: { desc: 'RadioLink R9DS 接收機：兩根天線互成 90° 擺放；設為 SBUS 模式，以 3pin 線接 Pixhawk RC IN。', links: [['RadioLink：R9DS 產品頁', 'https://www.radiolink.com/r9ds'], ['ArduPilot：遙控接收機', 'https://ardupilot.org/copter/docs/common-rc-systems.html']] },
  gps: { desc: 'M8N GPS／羅盤：圓餅箭頭朝機頭、遠離電源線；6pin 接 GPS 埠，4pin 羅盤接 I2C。', links: [['ArduPilot：GPS／羅盤安裝', 'https://ardupilot.org/copter/docs/common-installing-3dr-ublox-gps-compass-module.html']] },
  safety_switch: { desc: '安全開關：解鎖前長按到燈常亮；3pin 接 Pixhawk SWITCH。', links: [['ArduPilot：安全開關', 'https://ardupilot.org/copter/docs/common-safety-switch-pixhawk.html']] },
  buzzer: { desc: '蜂鳴器：開機、解鎖與故障提示音；2pin 接 Pixhawk BUZZER。', links: [['ArduPilot：蜂鳴器', 'https://ardupilot.org/copter/docs/common-buzzer.html']] },
  esc: { desc: '20A 電調（黃色熱縮）：紅黑粗線焊到配電板（紅正黑負），三相線接馬達，3pin 訊號線依 Quad X 順序接 MAIN OUT。', links: [['ArduPilot：電調與馬達接線', 'https://ardupilot.org/copter/docs/connect-escs-and-motors.html'], ['ArduPilot：電調校準', 'https://ardupilot.org/copter/docs/esc-calibration.html']] },
  motor: { desc: 'A2212 930KV 無刷馬達：三相線接電調；轉向不對時交換任兩條。', links: [['ArduPilot：馬達順序與轉向（Quad X）', 'https://ardupilot.org/copter/docs/connect-escs-and-motors.html']] },
  pdb: { desc: 'F450 下中心板兼配電板：四組焊盤接 ESC 電源（紅正黑負），主電源由電源模組輸出供電。', links: [['DJI：Flame Wheel F450 產品頁', 'https://www.dji.com/flame-wheel-arf']] },
  power_module: { desc: '電源模組：XT60 串在電池與配電板之間；6pin 線供電給 Pixhawk 並量測電壓電流。', links: [['ArduPilot：電源模組', 'https://ardupilot.org/copter/docs/common-3dr-power-module.html'], ['ArduPilot：Pixhawk 供電', 'https://ardupilot.org/copter/docs/common-powering-the-pixhawk.html']] },
  battery: { desc: '4S 14.8V 鋰電池：XT60 有防呆方向；任何通電測試前必須先拆槳。', links: [['ArduPilot：Pixhawk 供電', 'https://ardupilot.org/copter/docs/common-powering-the-pixhawk.html']] },
};
export const infoKey = (cid) => cid.replace(/_(fr|fl|rl|rr)$/, '');   // esc_fr → esc、motor_fl → motor

// 畫零件外觀；sv(tag, attrs) 建立 SVG 元素；ports＝這個元件的接口 [{id, x, y, n, role}]
export function drawArt(cid, [x, y, w, h], ports, sv) {
  const g = sv('g', { class: 'w2-art', 'pointer-events': 'none' });
  const add = (tag, attrs, text) => { const e = sv(tag, attrs); if (text != null) e.textContent = text; g.append(e); return e; };
  const cx = x + w / 2, cy = y + h / 2;
  // 接口的線頭：從接口往元件內側畫一小段線，看起來像真的接頭與線材
  const stubs = (len = 14, color = null) => ports.forEach((p) => add('line', { x1: p.x, y1: p.y, x2: p.x - p.n[0] * len, y2: p.y - p.n[1] * len, stroke: color || (p.role.startsWith('power') ? '#c0392b' : '#2b2b2b'), 'stroke-width': p.role.startsWith('power') ? 5 : 3, 'stroke-linecap': 'round' }));
  const kind = infoKey(cid);

  if (kind === 'pixhawk') {
    // 依 Pixhawk 2.4.8 說明書：黑色外殼、箭頭朝機頭（上）、排針在後端（下）；白色 DF13 接頭與印字位置照實物排列
    add('rect', { x: x + 4, y: y + 4, width: w - 8, height: h - 8, rx: 16, fill: '#16191d', stroke: '#454c55', 'stroke-width': 2 });
    add('path', { d: `M${cx},${y + 16} l10,16 h-6 v10 h-8 v-10 h-6 z`, fill: '#e8ecef' });          // 機頭箭頭
    add('circle', { cx: cx, cy: y + 62, r: 9, fill: '#3a3f46', stroke: '#8a939c' });                  // 主 LED
    const sock = (sx, sy, label, active) => {                                                          // 白色 DF13 接頭＋印字
      add('rect', { x: sx - 14, y: sy - 6, width: 28, height: 12, rx: 2, fill: active ? '#f4f4f4' : '#c9ced4', stroke: active ? '#7ee8c8' : '#7d858d', 'stroke-width': active ? 2 : 1 });
      add('text', { x: sx, y: sy + 17, 'text-anchor': 'middle', class: 'w2-art-silk' }, label);
    };
    const L = x + 30, R = x + w - 30, C = cx;
    [['ADC6.6', 40], ['I2C', 75, 1], ['CAN', 110], ['GPS', 145, 1], ['SERIAL4/5', 180], ['BUZZER', 215, 1]].forEach(([t, dy, a]) => sock(L, y + dy, t, a));
    [['POWER', 40, 1], ['SPI', 75], ['USB', 110], ['TELEM1', 145], ['TELEM2', 180], ['SPKT/DSM', 215]].forEach(([t, dy, a]) => sock(R, y + dy, t, a));
    sock(C, y + 98, 'ADC3.3'); sock(C, y + 180, 'SWITCH', 1);   // SWITCH 與 TELEM2、SERIAL4/5 同一排（離排針第二排）
    // 從接頭拉到框邊的線（左列接左邊、POWER／SWITCH 接右邊）
    [[L - 14, 75], [L - 14, 145], [L - 14, 215]].forEach(([sx, dy]) => add('line', { x1: sx, y1: y + dy, x2: x, y2: y + dy, stroke: '#7ee8c8', 'stroke-width': 2 }));
    add('line', { x1: R + 14, y1: y + 40, x2: x + w, y2: y + 40, stroke: '#ff6a4d', 'stroke-width': 2 });
    add('path', { d: `M${C},${y + 186} V${y + 248} H${x + w}`, stroke: '#7ee8c8', 'stroke-width': 2, fill: 'none' });   // 往下繞到框邊，不穿過 TELEM2
    // 後端舵機排針：15 欄 × 3 列（上：負極黑、中：正極紅、下：訊號白），左起 RC IN、S.B.OUT、MAIN 8→1、AUX 6→1
    for (let col = 0; col < 15; col++) for (let row = 0; row < 3; row++) add('rect', { x: x + 16 + col * 10.2, y: y + h - 44 + row * 7, width: 5, height: 5, fill: ['#2a2a2a', '#c0392b', '#eeeeee'][row] });
    add('text', { x: x + 18, y: y + h - 50, class: 'w2-art-silk' }, 'RC');
    add('text', { x: x + 52, y: y + h - 50, class: 'w2-art-silk' }, 'MAIN OUT 8←1');
    add('text', { x: x + 128, y: y + h - 50, class: 'w2-art-silk' }, 'AUX');
    // 用到的排針（RC IN、MAIN 1–4）往下拉線到接口
    [[22, 0], [66, 5], [92, 6], [118, 7], [144, 8]].forEach(([px, col]) => add('line', { x1: x + 18 + col * 10.2, y1: y + h - 28, x2: x + px, y2: y + h, stroke: '#3fd0ff', 'stroke-width': 2 }));
  } else if (kind === 'receiver') {
    add('rect', { x: x + 14, y: y + 10, width: w - 28, height: h - 26, rx: 6, fill: '#15181c', stroke: '#3a4048' });
    for (let k = 0; k < 9; k++) add('circle', { cx: x + 34 + k * 12, cy: y + h - 24, r: 2.2, fill: '#c8a050' });   // 排針
    add('path', { d: `M${x + w - 18},${y + 16} q22,-6 30,-22`, stroke: '#9aa4ae', 'stroke-width': 2, fill: 'none' });   // 天線
    add('path', { d: `M${x + w - 18},${y + 28} q26,4 34,-6`, stroke: '#9aa4ae', 'stroke-width': 2, fill: 'none' });
    stubs(10);
  } else if (kind === 'gps') {
    const gy = y + 44;   // 圓餅在上方，名稱在下方
    add('circle', { cx: x + 44, cy: gy, r: 28, fill: '#121417', stroke: '#3a4048', 'stroke-width': 2 });
    add('circle', { cx: x + 44, cy: gy, r: 19, fill: 'none', stroke: '#e8ecef', 'stroke-width': 3 });
    add('path', { d: `M${x + 44},${gy - 13} l8,12 h-5 v12 h-6 v-12 h-5 z`, fill: '#d63c3c' });
    stubs(12);
  } else if (kind === 'safety_switch') {
    add('rect', { x: x + 22, y: y + 10, width: 34, height: h - 20, rx: 6, fill: '#15181c' });
    add('circle', { cx: x + 39, cy: cy, r: 10, fill: '#d63c3c', stroke: '#ff9f9f', 'stroke-width': 2 });
    stubs(10);
  } else if (kind === 'buzzer') {
    add('circle', { cx: x + 39, cy: cy, r: 16, fill: '#15181c', stroke: '#3a4048', 'stroke-width': 2 });
    add('circle', { cx: x + 39, cy: cy, r: 3, fill: '#5a6068' });
    add('text', { x: x + 31, y: cy - 6, class: 'w2-art-sub' }, '+');
    stubs(10);
  } else if (kind === 'esc') {
    add('rect', { x: x + 30, y: y + 28, width: w - 60, height: h - 56, rx: 8, fill: '#e2bd2b', stroke: '#a88912', 'stroke-width': 2 });
    add('text', { x: cx, y: cy + 22, 'text-anchor': 'middle', class: 'w2-art-dark' }, '20A');
    ports.forEach((p) => {                                                    // 電源紅黑雙線、三相三線、訊號三色細線
      const ex = p.x - p.n[0] * 22, ey = p.y - p.n[1] * 22;
      const cols = p.id.endsWith('.power') ? ['#c0392b', '#1b1b1b'] : p.id.endsWith('.phase') ? ['#1b1b1b', '#1b1b1b', '#1b1b1b'] : ['#6b3f1f', '#c0392b', '#e8a33d'];
      cols.forEach((col, i) => { const o = (i - (cols.length - 1) / 2) * 4; add('line', { x1: p.x + (p.n[1] ? o : 0), y1: p.y + (p.n[0] ? o : 0), x2: ex + (p.n[1] ? o : 0), y2: ey + (p.n[0] ? o : 0), stroke: col, 'stroke-width': p.id.endsWith('.signal') ? 2 : 3 }); });
    });
  } else if (kind === 'motor') {
    add('circle', { cx: cx, cy: cy, r: 22, fill: '#c9a227', stroke: '#8a6d12', 'stroke-width': 2 });
    add('circle', { cx: cx, cy: cy, r: 9, fill: '#6e5a1a' });
    add('circle', { cx: cx, cy: cy, r: 3, fill: '#d8d8d8' });
    stubs(14, '#1b1b1b');
  } else if (kind === 'pdb') {
    add('rect', { x: x + 10, y: y + 8, width: w - 20, height: h - 16, rx: 12, fill: '#1b222b', stroke: '#c9a227', 'stroke-width': 2 });
    ports.filter((p) => p.id.includes('pad_')).forEach((p) => {               // 焊盤：紅正黑負
      const px = p.x - p.n[0] * 30;
      add('rect', { x: px - 9, y: p.y - 7, width: 8, height: 14, rx: 2, fill: '#d4a63a' });
      add('rect', { x: px + 1, y: p.y - 7, width: 8, height: 14, rx: 2, fill: '#d4a63a' });
      add('text', { x: px - 5, y: p.y - 10, 'text-anchor': 'middle', class: 'w2-art-plus' }, '+');
      add('text', { x: px + 5, y: p.y - 10, 'text-anchor': 'middle', class: 'w2-art-sub' }, '−');
    });
    stubs(12);
  } else if (kind === 'power_module') {
    add('rect', { x: x + 50, y: y + 22, width: w - 100, height: h - 36, rx: 6, fill: '#1e6b44', stroke: '#2e9a63', 'stroke-width': 2 });
    ports.forEach((p) => {                                                    // XT60 黃色接頭／6pin 白色接頭
      const xt = !p.id.endsWith('.fc');
      const bx = p.x - p.n[0] * 18, by = p.y - p.n[1] * 18;
      add('rect', { x: bx - (xt ? 10 : 7), y: by - (xt ? 8 : 5), width: xt ? 20 : 14, height: xt ? 16 : 10, rx: 3, fill: xt ? '#f1c40f' : '#f2f2f2', stroke: '#7a6300' });
    });
  } else if (kind === 'battery') {
    add('rect', { x: x + 12, y: y + 16, width: w - 24, height: h - 22, rx: 6, fill: '#15181c', stroke: '#3a4048', 'stroke-width': 2 });
    add('rect', { x: x + 22, y: y + 36, width: w - 44, height: 12, fill: '#f2f2ee' });
    add('text', { x: cx, y: y + 46, 'text-anchor': 'middle', class: 'w2-art-dark' }, '4S 14.8V LiPo');
    ports.forEach((p) => add('rect', { x: p.x - 10, y: p.y + 4, width: 20, height: 12, rx: 3, fill: '#f1c40f', stroke: '#7a6300' }));   // XT60
  }
  return g;
}
