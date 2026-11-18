// 組裝實訓室｜機型資料：5 吋 FPV 穿越機（通用 225 mm 軸距 X 型碳纖機架，P3 通用件版本）
//
// 單位公釐；Y 軸朝上、機頭朝 −Z（俯視時機頭在畫面上方）、+X 為右側。
// 馬達編號與旋向依 Betaflight（與 ArduPilot 不同，分開建表）：
//   Betaflight 原始碼 src/main/flight/mixer_init.c 的 mixerQuadX 順序：M1 右後、M2 右前、M3 左後、M4 左前；
//   官方文件（Motors 分頁、Reversed motor direction）：預設「槳向內」，右前 CCW、左前 CW（對角線同旋向）→ 右後 CW、左後 CCW。
//   取得日 2026-11-19，狀態 PENDING_MANUAL。
// 外形一律程式產生的簡化外形（教師決定不模仿 CAD 製圖）；尺寸為通用件估計值，標「待確認」，
// 等選定真實機架與飛控堆疊後再換成官方規格。

const TBD = { status: '待確認', title: '通用件估計值，待選定實際機架／堆疊後換成官方規格', url: '', date: '' };
const BF_ORDER = {
  status: 'PENDING_MANUAL',
  title: 'Betaflight 原始碼 mixer_init.c（mixerQuadX）＋ Betaflight 文件 Motors 分頁／Reversed motor direction',
  url: 'https://betaflight.com/docs/wiki/app/motors-tab',
  date: '2026-11-19',
};

const BOTTOM_Y = 4;          // 底板中心高度
const PLATE_T = 3;
const ARM_T = 5;
const ARM_Y = BOTTOM_Y + PLATE_T / 2 + ARM_T / 2;
const ARM_TOP = ARM_Y + ARM_T / 2;
const STANDOFF_H = 30;       // 30 mm 鋁柱
const TOP_Y = ARM_TOP + STANDOFF_H + PLATE_T / 2;
const MOTOR_R = 112.5;       // 225 mm 軸距的一半
const MOTOR_H = 18;
const MOTOR_Y = ARM_TOP + MOTOR_H / 2;
const PROP_Y = ARM_TOP + MOTOR_H + 3;

// Betaflight 編號：M1 右後、M2 右前、M3 左後、M4 左前；槳向內：右前與左後 CCW、左前與右後 CW
const CORNERS = [
  { key: 'rr', zh: '右後', motor: 1, spin: 'CW', deg: -45 },
  { key: 'fr', zh: '右前', motor: 2, spin: 'CCW', deg: 45 },
  { key: 'rl', zh: '左後', motor: 3, spin: 'CCW', deg: -135 },
  { key: 'fl', zh: '左前', motor: 4, spin: 'CW', deg: 135 },
];
function along(deg, r) {
  const t = (deg * Math.PI) / 180;
  return [+(r * Math.cos(t)).toFixed(2), +(-r * Math.sin(t)).toFixed(2)];
}

const parts = [];
parts.push({
  partId: 'bottom_plate', nameZh: '底板', model: '225 mm X 型碳纖底板', category: 'frame',
  desc: '機架的底板，四支機臂鎖在上面；飛控堆疊也固定在中間。',
  dimensionsMm: { x: 60, y: PLATE_T, z: 110 },
  shape: { type: 'plate', w: 60, d: 110, t: PLATE_T, color: '#1c1f22' },
  target: { pos: [0, BOTTOM_Y, 0], rotY: 0 }, dependsOn: [], source: TBD,
});
for (const c of CORNERS) {
  const [x, z] = along(c.deg, 72.5);
  parts.push({
    partId: `arm_${c.key}`, nameZh: `${c.zh}機臂`, model: '5 mm 碳纖機臂', category: 'frame',
    desc: `${c.zh}機臂，末端是電機座。`,
    dimensionsMm: { x: 105, y: ARM_T, z: 14 },
    shape: { type: 'arm', len: 105, h: ARM_T, w: 14, color: '#23272b' },
    target: { pos: [x, ARM_Y, z], rotY: c.deg }, dependsOn: ['bottom_plate'], source: TBD,
  });
}
for (const c of CORNERS) {
  const [x, z] = along(c.deg, MOTOR_R);
  parts.push({
    partId: `motor_m${c.motor}`, nameZh: `M${c.motor} 電機（${c.zh}，${c.spin}）`, model: '2207 無刷電機', category: 'power',
    desc: `Betaflight 的 ${c.motor} 號電機在${c.zh}；預設「槳向內」時要${c.spin === 'CW' ? '順時針（CW）' : '逆時針（CCW）'}旋轉。注意：和 ArduPilot 的編號不同。`,
    dimensionsMm: { x: 28, y: MOTOR_H, z: 28 },
    shape: { type: 'motor', r: 14, h: MOTOR_H, color: '#7d8790' },
    target: { pos: [x, MOTOR_Y, z], rotY: 0 }, dependsOn: [`arm_${c.key}`], motor: c.motor, spin: c.spin, source: BF_ORDER,
  });
}
parts.push({
  partId: 'esc_4in1', nameZh: '4 合 1 電調（30.5×30.5）', model: '通用 4 合 1 電調（3～6S，待確認）', category: 'power',
  desc: '一片板子控制四顆電機；電機三相線焊在 M1～M4 焊盤，電池線焊在 BAT ＋／− 焊盤。',
  dimensionsMm: { x: 40, y: 6, z: 40 },
  shape: { type: 'box', w: 40, h: 6, d: 40, color: '#2b5fae' },
  target: { pos: [0, ARM_TOP + 6, 0], rotY: 0 }, dependsOn: ['arm_rr', 'arm_fr', 'arm_rl', 'arm_fl'],
  voltageCells: { min: 3, max: 6 }, source: TBD,
});
parts.push({
  partId: 'capacitor', nameZh: '低 ESR 電容', model: '35V 470µF（待確認）', category: 'accessory',
  desc: '焊在電調電池焊盤上，吸收電壓尖峰保護電調；有白色條紋的那腳是負極。',
  dimensionsMm: { x: 20, y: 10, z: 10 },
  shape: { type: 'capacitor', r: 5, h: 20, color: '#1c2a4a' },
  target: { pos: [0, ARM_TOP + 6, 34], rotY: 0 }, dependsOn: ['esc_4in1'], source: TBD,
});
parts.push({
  partId: 'xt60_lead', nameZh: 'XT60 電源線', model: 'XT60 公頭＋12AWG 矽膠線', category: 'accessory',
  desc: '電池接頭；紅線焊 BAT＋、黑線焊 BAT−。',
  dimensionsMm: { x: 16, y: 8, z: 16 },
  shape: { type: 'box', w: 16, h: 8, d: 16, color: '#f2c200' },
  target: { pos: [0, ARM_TOP + 4, 66], rotY: 0 }, dependsOn: ['esc_4in1'], source: TBD,
  safety: '焊接電池線全程不要接電池；焊完先用三用電表量正負極有沒有短路。',
});
parts.push({
  partId: 'fc', nameZh: 'Betaflight 飛控（30.5×30.5）', model: '通用 F7 飛控（待確認）', category: 'electronics',
  desc: '疊在 4 合 1 電調上方，用 8P 排線與電調連接；箭頭朝機頭。',
  dimensionsMm: { x: 36, y: 6, z: 36 },
  shape: { type: 'fc', w: 36, h: 6, d: 36, color: '#202a33', arrow: true },
  target: { pos: [0, ARM_TOP + 16, 0], rotY: 0 }, dependsOn: ['esc_4in1'], source: TBD,
});
parts.push({
  partId: 'receiver', nameZh: 'ELRS 接收機', model: '通用 ExpressLRS 2.4GHz 接收機', category: 'electronics',
  desc: '用序列埠（UART）接飛控，協定為 CRSF；TX／RX 要交叉接。',
  dimensionsMm: { x: 12, y: 4, z: 20 },
  shape: { type: 'box', w: 12, h: 4, d: 20, color: '#30363d', antenna: true },
  target: { pos: [-20, ARM_TOP + 6, 40], rotY: 0 }, dependsOn: ['bottom_plate'], source: TBD,
});
parts.push({
  partId: 'vtx', nameZh: '數位圖傳', model: '通用數位圖傳（電壓範圍待確認）', category: 'electronics',
  desc: '把攝影機畫面傳到眼鏡；用 6P 排線接飛控（供電＋OSD）。通電前一定要先接天線。',
  dimensionsMm: { x: 30, y: 10, z: 30 },
  shape: { type: 'box', w: 30, h: 10, d: 30, color: '#3a3f45' },
  target: { pos: [0, ARM_TOP + 26, 22], rotY: 0 }, dependsOn: ['fc'], voltageCells: { min: 2, max: 6 }, source: TBD,
});
parts.push({
  partId: 'camera', nameZh: 'FPV 攝影機', model: '通用 19 mm 攝影機', category: 'electronics',
  desc: '鏡頭朝機頭，用同軸線接到圖傳。',
  dimensionsMm: { x: 19, y: 19, z: 19 },
  shape: { type: 'camera', w: 19, color: '#2a2a2a' },
  target: { pos: [0, ARM_TOP + 14, -46], rotY: 0 }, dependsOn: ['bottom_plate'], source: TBD,
});
parts.push({
  partId: 'standoffs', nameZh: '鋁柱與螺絲（30 mm）', model: 'M3×30 鋁柱 ×4', category: 'frame',
  desc: '撐起上板，形成放電子件的空間。',
  dimensionsMm: { x: 44, y: STANDOFF_H, z: 90 },
  shape: { type: 'standoffs', h: STANDOFF_H, dx: 22, dz: 45, color: '#c0392b' },
  target: { pos: [0, ARM_TOP, 0], rotY: 0 }, dependsOn: ['bottom_plate'], source: TBD,
});
parts.push({
  partId: 'top_plate', nameZh: '上板', model: '225 mm 碳纖上板', category: 'frame',
  desc: '蓋住電子件，電池綁在上板上面。裝上板前，電子件與接線空間要先整理好。',
  dimensionsMm: { x: 60, y: PLATE_T, z: 110 },
  shape: { type: 'plate', w: 60, d: 110, t: PLATE_T, color: '#2a2e33' },
  target: { pos: [0, TOP_Y, 0], rotY: 0 }, dependsOn: ['standoffs', 'fc', 'vtx', 'receiver', 'camera', 'capacitor', 'xt60_lead'], source: TBD,
});
parts.push({
  partId: 'vtx_antenna', nameZh: '圖傳天線', model: '通用 5.8GHz 天線', category: 'accessory',
  desc: '固定在機尾上方；圖傳通電前一定要先接上，否則可能過熱損壞。',
  dimensionsMm: { x: 10, y: 60, z: 10 },
  shape: { type: 'antenna', len: 50, color: '#c0392b' },
  target: { pos: [0, TOP_Y + PLATE_T / 2, 52], rotY: 0 }, dependsOn: ['top_plate'], source: TBD,
});
parts.push({
  partId: 'battery', nameZh: '鋰電池（4S／6S 示意，含綁帶）', model: 'LiPo 電池（示意）', category: 'accessory',
  desc: '用綁帶綁在上板上面。電壓要在電調與圖傳的規格範圍內。模擬中不會真的供電。',
  dimensionsMm: { x: 35, y: 34, z: 75 },
  shape: { type: 'battery', w: 35, h: 34, d: 75, color: '#f2b705' },
  target: { pos: [0, TOP_Y + PLATE_T / 2 + 17, 0], rotY: 0 }, dependsOn: ['top_plate'], source: TBD,
  safety: '鋰電池不要刺破、不要短路；飛完先降到儲存電壓再收。',
});
for (const c of CORNERS) {
  const [x, z] = along(c.deg, MOTOR_R);
  parts.push({
    partId: `prop_m${c.motor}`, nameZh: `M${c.motor} 螺旋槳（${c.spin}）`, model: '5 吋三葉槳（示意為兩葉）', category: 'power',
    desc: `${c.zh}要裝 ${c.spin === 'CW' ? 'CW' : 'CCW'} 槳，與電機旋向一致（預設槳向內）。`,
    dimensionsMm: { x: 127, y: 3, z: 127 },
    shape: { type: 'prop', dia: 127, spin: c.spin, color: c.spin === 'CW' ? '#4a4f55' : '#6a7077' },
    target: { pos: [x, PROP_Y, z], rotY: 0 }, dependsOn: [`motor_m${c.motor}`, 'fc', 'top_plate'],
    motor: c.motor, spin: c.spin, source: BF_ORDER,
    safety: '槳一定最後裝；在 Betaflight 做任何馬達測試前都要拆槳。',
  });
}

const order = [
  'bottom_plate', 'arm_rr', 'arm_fr', 'arm_rl', 'arm_fl',
  'motor_m1', 'motor_m2', 'motor_m3', 'motor_m4',
  'esc_4in1', 'capacitor', 'xt60_lead', 'fc', 'receiver', 'vtx', 'camera',
  'standoffs', 'top_plate', 'vtx_antenna', 'battery',
  'prop_m1', 'prop_m2', 'prop_m3', 'prop_m4',
];

export const FPV5_MODEL = Object.freeze({
  modelId: 'fpv5-225',
  nameZh: '5 吋 FPV 穿越機（225 mm X 型）',
  version: '通用件版（尺寸待確認）',
  frontAxis: '-Z',
  snapToleranceMm: 9,
  parts,
  order,
});
