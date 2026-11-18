// 組裝實訓室｜機型資料：F450 + Pixhawk 2.4.8（P1 通用件版本）
//
// 單位一律為公釐（mm）。座標系沿用 three.js：Y 軸朝上，機頭朝 −Z（俯視時機頭在畫面上方），+X 為機體右側。
// 馬達編號與旋向依 ArduPilot 官方文件（Quad X）：M1 右前 CCW、M2 左後 CCW、M3 左前 CW、M4 右後 CW。
//   來源：ArduPilot wiki connect-escs-and-motors（圖 m_01_01_quad_x.svg），取得日 2026-11-19，狀態 PENDING_MANUAL。
// 其餘外形尺寸目前是「通用件」估計值，全部標「待確認」：等教師提供實際套件廠牌型號後，逐項換成官方規格並附來源。
// 這個檔只放資料，不碰畫面；組裝引擎（core/assembly-engine.js）與 3D 場景（core/scene.js）都從這裡讀。

// ───────── 共用常數 ─────────
const PLATE_Y = 40;            // 下中心板中心高度（板下方留空間給電池）
const PLATE_T = 1.6;           // 中心板厚度
const ARM_H = 22;              // 機臂高度（也是上下板之間的空隙）
const ARM_Y = PLATE_Y + PLATE_T / 2 + ARM_H / 2;          // 機臂中心高度
const TOP_Y = ARM_Y + ARM_H / 2 + PLATE_T / 2;            // 上中心板中心高度
const ARM_TOP = ARM_Y + ARM_H / 2;                         // 機臂上表面高度
const MOTOR_R = 225;           // 機體中心到馬達中心距離（450 mm 軸距的一半）
const MOTOR_H = 26;
const MOTOR_Y = ARM_TOP + MOTOR_H / 2;
const PROP_Y = ARM_TOP + MOTOR_H + 3;

// 待確認來源的共用標記（之後換成官方規格時改這裡或個別零件的 source）
const TBD = { status: '待確認', title: '通用件估計值，待選定實際套件後換成官方規格', url: '', date: '' };
const AP_QUADX = {
  status: 'PENDING_MANUAL',
  title: 'ArduPilot wiki：Connect ESCs and Motors（Quad X）',
  url: 'https://ardupilot.org/copter/docs/connect-escs-and-motors.html',
  date: '2026-11-19',
};
const AP_WIRING = {
  status: 'PENDING_MANUAL',
  title: 'ArduPilot wiki：Pixhawk Wiring Quick Start',
  url: 'https://ardupilot.org/copter/docs/common-pixhawk-wiring-and-quick-start.html',
  date: '2026-11-19',
};

// 四個角的定義：θ 為 three.js 繞 Y 軸角度（0° 指向 +X，正值往 −Z 也就是機頭方向轉）
const CORNERS = [
  { key: 'fr', zh: '右前', motor: 1, spin: 'CCW', deg: 45, armColor: 'red' },
  { key: 'fl', zh: '左前', motor: 3, spin: 'CW', deg: 135, armColor: 'red' },
  { key: 'bl', zh: '左後', motor: 2, spin: 'CCW', deg: -135, armColor: 'white' },
  { key: 'br', zh: '右後', motor: 4, spin: 'CW', deg: -45, armColor: 'white' },
];

/** 沿著角的方向、距中心 r 的位置（回傳 [x, z]） */
function along(deg, r) {
  const t = (deg * Math.PI) / 180;
  return [+(r * Math.cos(t)).toFixed(2), +(-r * Math.sin(t)).toFixed(2)];
}

// ───────── 零件 ─────────
// category：frame 機架／power 動力／electronics 電子／accessory 配件
// shape：給 core/parts-gen.js 產生 3D 幾何用的描述（自行設計的簡化外形，不使用任何外部模型）
// target：安裝位置 pos（mm）與繞 Y 軸角度 rotY（度）
// dependsOn：必須先裝好的零件（拆下時則反過來：有依賴它的零件裝著就不能拆）
const parts = [];

parts.push({
  partId: 'bottom_plate', nameZh: '下中心板（含分電板 PDB）', model: 'F450 下板', category: 'frame',
  desc: '機架底座，同時是分電板：電池的電經過這片板分給四顆電調。正負極焊盤要分清楚。',
  dimensionsMm: { x: 140, y: PLATE_T, z: 140 },
  shape: { type: 'plate', w: 140, d: 140, t: PLATE_T, color: '#2f3b46', pads: true },
  target: { pos: [0, PLATE_Y, 0], rotY: 0 }, dependsOn: [], source: TBD,
});

for (const c of CORNERS) {
  const [x, z] = along(c.deg, 140);
  parts.push({
    partId: `arm_${c.key}`, nameZh: `${c.zh}機臂`, model: 'F450 機臂', category: 'frame',
    desc: `${c.zh}機臂，${c.armColor === 'red' ? '紅色代表機頭方向' : '白色代表機尾方向'}。先用螺絲鎖在下中心板上。`,
    dimensionsMm: { x: 200, y: ARM_H, z: 30 },
    shape: { type: 'arm', len: 200, h: ARM_H, w: 30, color: c.armColor === 'red' ? '#d23b3b' : '#e8e8e8' },
    target: { pos: [x, ARM_Y, z], rotY: c.deg }, dependsOn: ['bottom_plate'], source: TBD,
  });
}

// 上下板之間的電子件（裝上板前要先放好）
parts.push({
  partId: 'power_module', nameZh: '電源模組（含 XT60）', model: '通用 Pixhawk 電源模組', category: 'electronics',
  desc: '把電池電壓降成 5V 給飛控，並量測電壓與電流。電池只能經過它再到飛控 POWER 口，不能直接接飛控。',
  dimensionsMm: { x: 25, y: 9, z: 21 },
  shape: { type: 'box', w: 25, h: 9, d: 21, color: '#1e4f8a', lead: 'xt60' },
  target: { pos: [0, PLATE_Y + PLATE_T / 2 + 4.5, 52], rotY: 0 }, dependsOn: ['bottom_plate'], source: AP_WIRING,
  safety: '焊接或插拔電源前一律先拔掉電池。',
});
parts.push({
  partId: 'receiver', nameZh: '遙控接收機', model: '通用接收機（PPM／SBUS）', category: 'electronics',
  desc: '接收遙控器訊號，再用一條訊號線送到飛控 RC IN。',
  dimensionsMm: { x: 40, y: 10, z: 25 },
  shape: { type: 'box', w: 40, h: 10, d: 25, color: '#202a33', antenna: true },
  target: { pos: [0, PLATE_Y + PLATE_T / 2 + 5, -45], rotY: 0 }, dependsOn: ['bottom_plate'], source: TBD,
});
parts.push({
  partId: 'telemetry', nameZh: '數傳電台（TELEM）', model: '通用 433／915 MHz 數傳', category: 'electronics',
  desc: '讓地面站即時看到飛行資料，接飛控 TELEM1。',
  dimensionsMm: { x: 26, y: 12, z: 40 },
  shape: { type: 'box', w: 26, h: 12, d: 40, color: '#30363d', antenna: true },
  target: { pos: [30, PLATE_Y + PLATE_T / 2 + 6, 22], rotY: 0 }, dependsOn: ['bottom_plate'], source: TBD,
});
parts.push({
  partId: 'buzzer', nameZh: '蜂鳴器', model: 'Pixhawk 蜂鳴器', category: 'accessory',
  desc: '用聲音提示解鎖、低電量等狀態；ArduPilot 文件說明 Pixhawk 必須接蜂鳴器。',
  dimensionsMm: { x: 12, y: 10, z: 12 },
  shape: { type: 'cyl', r: 6, h: 10, color: '#111111' },
  target: { pos: [-30, PLATE_Y + PLATE_T / 2 + 5, 22], rotY: 0 }, dependsOn: ['bottom_plate'], source: AP_WIRING,
});

parts.push({
  partId: 'top_plate', nameZh: '上中心板', model: 'F450 上板', category: 'frame',
  desc: '把四支機臂夾緊；飛控、GPS 都裝在上板。裝上板前，上下板之間的零件要先放好。',
  dimensionsMm: { x: 110, y: PLATE_T, z: 110 },
  shape: { type: 'plate', w: 110, d: 110, t: PLATE_T, color: '#3a4652' },
  target: { pos: [0, TOP_Y, 0], rotY: 0 },
  dependsOn: ['arm_fr', 'arm_fl', 'arm_bl', 'arm_br', 'power_module', 'receiver', 'telemetry', 'buzzer'], source: TBD,
});

for (const c of CORNERS) {
  const [x, z] = along(c.deg, MOTOR_R);
  parts.push({
    partId: `motor_m${c.motor}`, nameZh: `M${c.motor} 電機（${c.zh}，${c.spin}）`, model: '2212 級無刷電機', category: 'power',
    desc: `${c.zh}是 ${c.motor} 號電機，依 ArduPilot Quad X 應該${c.spin === 'CW' ? '順時針（CW）' : '逆時針（CCW）'}旋轉。`,
    dimensionsMm: { x: 28, y: MOTOR_H, z: 28 },
    shape: { type: 'motor', r: 14, h: MOTOR_H, color: '#9aa4ad' },
    target: { pos: [x, MOTOR_Y, z], rotY: 0 }, dependsOn: [`arm_${c.key}`],
    motor: c.motor, spin: c.spin, source: AP_QUADX,
  });
}

for (const c of CORNERS) {
  const [x, z] = along(c.deg, 120);
  parts.push({
    partId: `esc_${c.motor}`, nameZh: `${c.motor} 號電調（${c.zh}）`, model: '通用 20A 電調', category: 'power',
    desc: `控制 M${c.motor} 電機轉速；訊號線接飛控 MAIN OUT ${c.motor}。`,
    dimensionsMm: { x: 45, y: 8, z: 25 },
    shape: { type: 'box', w: 45, h: 8, d: 25, color: '#2b5fae' },
    target: { pos: [x, ARM_TOP + 4, z], rotY: c.deg }, dependsOn: [`arm_${c.key}`],
    motor: c.motor, source: AP_WIRING,
  });
}

parts.push({
  partId: 'damping_mount', nameZh: '飛控減震座', model: '通用減震座', category: 'accessory',
  desc: '減少電機震動傳到飛控，讓姿態感測更準。',
  dimensionsMm: { x: 60, y: 8, z: 60 },
  shape: { type: 'damper', w: 60, h: 8, d: 60, color: '#4a5560' },
  target: { pos: [0, TOP_Y + PLATE_T / 2 + 4, 0], rotY: 0 }, dependsOn: ['top_plate'], source: TBD,
});
parts.push({
  partId: 'pixhawk', nameZh: 'Pixhawk 2.4.8 飛控', model: 'Pixhawk 2.4.8（克隆版，待確認）', category: 'electronics',
  desc: '飛機的大腦。箭頭一定要朝機頭方向；方向裝錯會一起飛就翻。',
  dimensionsMm: { x: 50, y: 16, z: 82 },
  shape: { type: 'fc', w: 50, h: 16, d: 82, color: '#e9edf1', arrow: true },
  target: { pos: [0, TOP_Y + PLATE_T / 2 + 8 + 8, 0], rotY: 0 }, dependsOn: ['damping_mount'], source: TBD,
});
parts.push({
  partId: 'safety_switch', nameZh: '安全開關', model: 'Pixhawk 安全開關', category: 'accessory',
  desc: '解鎖前要先按住它；ArduPilot 文件說明 Pixhawk 必須接安全開關（或在參數中停用）。',
  dimensionsMm: { x: 15, y: 10, z: 20 },
  shape: { type: 'box', w: 15, h: 10, d: 20, color: '#c62828' },
  target: { pos: [40, TOP_Y + PLATE_T / 2 + 5, -42], rotY: 0 }, dependsOn: ['top_plate'], source: AP_WIRING,
});
parts.push({
  partId: 'gps', nameZh: 'GPS／羅盤（含支架）', model: '通用 GPS＋羅盤', category: 'electronics',
  desc: '提供位置與方向；裝高一點遠離電源線干擾，箭頭朝機頭。',
  dimensionsMm: { x: 60, y: 115, z: 60 },
  shape: { type: 'gps', mastH: 100, r: 30, color: '#1b1f24' },
  target: { pos: [-30, TOP_Y + PLATE_T / 2, 40], rotY: 0 }, dependsOn: ['top_plate'], source: TBD,
});
parts.push({
  partId: 'battery', nameZh: '鋰電池（3S，含綁帶）', model: '3S 鋰聚合物電池（示意）', category: 'accessory',
  desc: '動力來源，用綁帶固定在下板下方。模擬中不會真的供電。',
  dimensionsMm: { x: 45, y: 30, z: 140 },
  shape: { type: 'battery', w: 45, h: 30, d: 140, color: '#f2b705' },
  target: { pos: [0, PLATE_Y - PLATE_T / 2 - 15, 0], rotY: 0 }, dependsOn: ['bottom_plate', 'power_module'], source: TBD,
  safety: '鋰電池不要刺破、不要短路；不用時放在防爆袋並以儲存電壓保存。',
});

for (const c of CORNERS) {
  const [x, z] = along(c.deg, MOTOR_R);
  parts.push({
    partId: `prop_m${c.motor}`, nameZh: `M${c.motor} 螺旋槳（${c.spin}）`, model: '10 吋槳（待確認）', category: 'power',
    desc: `${c.zh}要裝 ${c.spin === 'CW' ? 'CW 正槳' : 'CCW 反槳'}，與電機旋向一致。`,
    dimensionsMm: { x: 254, y: 3, z: 254 },
    shape: { type: 'prop', dia: 254, spin: c.spin, color: c.spin === 'CW' ? '#3a3a3a' : '#5a5a5a' },
    target: { pos: [x, PROP_Y, z], rotY: 0 }, dependsOn: [`motor_m${c.motor}`, 'pixhawk', 'gps'],
    motor: c.motor, spin: c.spin, source: AP_QUADX,
    safety: '槳葉一定最後裝；任何地面測試、調參、接線檢查都要先拆槳。',
  });
}

// ───────── 學習模式的建議安裝順序 ─────────
// 先機架與上下板之間的零件，再上板、動力、飛控與感測器，電池，最後才裝槳。
const order = [
  'bottom_plate', 'arm_fr', 'arm_fl', 'arm_bl', 'arm_br',
  'power_module', 'receiver', 'telemetry', 'buzzer', 'top_plate',
  'motor_m1', 'motor_m2', 'motor_m3', 'motor_m4',
  'esc_1', 'esc_2', 'esc_3', 'esc_4',
  'damping_mount', 'pixhawk', 'safety_switch', 'gps', 'battery',
  'prop_m1', 'prop_m2', 'prop_m3', 'prop_m4',
];

export const CATEGORIES = [
  { key: 'all', zh: '全部' },
  { key: 'frame', zh: '機架' },
  { key: 'power', zh: '動力' },
  { key: 'electronics', zh: '電子' },
  { key: 'accessory', zh: '配件' },
];

export const F450_MODEL = Object.freeze({
  modelId: 'f450-pixhawk248',
  nameZh: 'F450 四旋翼＋Pixhawk 2.4.8',
  version: '通用件版（尺寸待確認）',
  frontAxis: '-Z',
  snapToleranceMm: 18,     // 拖放時離正確位置多近才算對（公釐）
  parts,
  order,
});
