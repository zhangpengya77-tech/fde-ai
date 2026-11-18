// 組裝實訓室｜F450 + Pixhawk 2.4.8 接線步驟（P2）
//
// 共 21 步：先焊電調電源 → 電源模組 → 飛控電源 → 電調訊號（MAIN OUT）→ 電調三相到電機 → 接收機 → GPS／羅盤 → 數傳 → 蜂鳴器 → 安全開關，
// 最後才接電池（模擬上電前檢查）。真實操作時焊接全程不接電池。
// 每一步的接口、極性、介面類型由 core/wiring-rules.js 確定性檢查；這裡只描述「正確答案」與白話說明。
// 欄位依 R2.1 規格：sourcePort／targetPort／sourcePin／targetPin／wireType／polarity／validationStatus。
// validationStatus 一律 PENDING_MANUAL：接線內容須經教師或有實機經驗者覆核才可標 PASS。

const CORNERS = [
  { key: 'fr', zh: '右前', motor: 1 },
  { key: 'bl', zh: '左後', motor: 2 },
  { key: 'fl', zh: '左前', motor: 3 },
  { key: 'br', zh: '右後', motor: 4 },
];

// 非飛控端的接點（飛控端接口在板卡配置檔）
export const EXTRA_POINTS = {
  'pdb.in+': { nameZh: '分電板輸入 ＋', type: 'pad', polarity: '+', group: 'pdb.in' },
  'pdb.in-': { nameZh: '分電板輸入 −', type: 'pad', polarity: '-', group: 'pdb.in' },
  ...Object.fromEntries(CORNERS.flatMap((c) => [
    [`pdb.${c.key}+`, { nameZh: `分電板${c.zh}焊盤 ＋`, type: 'pad', polarity: '+', group: `pdb.${c.key}` }],
    [`pdb.${c.key}-`, { nameZh: `分電板${c.zh}焊盤 −`, type: 'pad', polarity: '-', group: `pdb.${c.key}` }],
  ])),
  'pm.in': { nameZh: '電源模組 XT60 輸入', type: 'xt60-in' },
  ...Object.fromEntries(CORNERS.map((c) => [`motor.m${c.motor}`, { nameZh: `M${c.motor} 電機三相線（${c.zh}）`, type: 'motor-phase', index: c.motor }])),
};

const PEND = 'PENDING_MANUAL';
const steps = [];

// 1～4：電調電源線焊到分電板（極性）
for (const c of CORNERS) {
  steps.push({
    id: `esc${c.motor}-power`, kind: 'polarity', wireType: 'power', polarity: true,
    titleZh: `把 ${c.motor} 號電調（${c.zh}）的電源線焊到分電板`,
    explainZh: '紅線焊「＋」焊盤、黑線焊「−」焊盤：正接正、負接負。焊接時不接電池。',
    fromPart: `esc_${c.motor}`, toPart: 'bottom_plate',
    sourcePort: `esc${c.motor}.power`, targetPort: `pdb.${c.key}`, sourcePin: '＋／−', targetPin: '＋／−',
    group: `pdb.${c.key}`, expect: { red: `pdb.${c.key}+`, black: `pdb.${c.key}-` },
    validationStatus: PEND,
  });
}
// 5：電源模組輸出到分電板
steps.push({
  id: 'pm-out', kind: 'polarity', wireType: 'power', polarity: true,
  titleZh: '把電源模組的輸出線焊到分電板輸入',
  explainZh: '電源模組輸出的紅線接分電板「＋」、黑線接「−」，分電板再把電分給四顆電調。',
  fromPart: 'power_module', toPart: 'bottom_plate',
  sourcePort: 'pm.out', targetPort: 'pdb.in', sourcePin: '＋／−', targetPin: '＋／−',
  group: 'pdb.in', expect: { red: 'pdb.in+', black: 'pdb.in-' }, validationStatus: PEND,
});
// 6：電源模組 6P 到飛控 POWER
steps.push({
  id: 'pm-fc', kind: 'port', wireType: 'power', polarity: false, connector: 'pm-6p',
  titleZh: '把電源模組的 6P 線插到飛控',
  explainZh: '電源模組降壓後的 5V 與電壓電流量測，從 6P 排線送到飛控 POWER 口。',
  fromPart: 'power_module', toPart: 'pixhawk',
  sourcePort: 'pm.fc6p', targetPort: 'fc.power', sourcePin: '1～6', targetPin: '1～6（5V、5V、CUR、VOLT、GND、GND）',
  expect: 'fc.power', validationStatus: PEND,
});
// 7～10：電調訊號線到 MAIN OUT（依馬達編號）
for (const c of [...CORNERS].sort((a, b) => a.motor - b.motor)) {
  steps.push({
    id: `esc${c.motor}-signal`, kind: 'port', wireType: 'signal', polarity: false, connector: 'esc-signal',
    titleZh: `把 ${c.motor} 號電調（${c.zh}）的訊號線插到飛控`,
    explainZh: `ArduPilot 依馬達編號輸出：${c.motor} 號電調接 MAIN OUT ${c.motor}。白／黃線（訊號）朝排針的 S 腳。`,
    fromPart: `esc_${c.motor}`, toPart: 'pixhawk',
    sourcePort: `esc${c.motor}.signal`, targetPort: `fc.main${c.motor}`, sourcePin: 'S、−（＋視電調 BEC 而定）', targetPin: 'S、−',
    expect: `fc.main${c.motor}`, validationStatus: PEND,
  });
}
// 11～14：電調三相到電機
for (const c of [...CORNERS].sort((a, b) => a.motor - b.motor)) {
  steps.push({
    id: `esc${c.motor}-phase`, kind: 'phase', wireType: 'phase', polarity: false,
    titleZh: `把 ${c.motor} 號電調的三條相線接到 M${c.motor} 電機`,
    explainZh: '三相線沒有正負極；旋轉方向不對時，任意對調其中兩條即可（之後用馬達測試確認，測試前一定拆槳）。',
    fromPart: `esc_${c.motor}`, toPart: `motor_m${c.motor}`,
    sourcePort: `esc${c.motor}.phase`, targetPort: `motor.m${c.motor}`, sourcePin: 'A／B／C', targetPin: 'A／B／C（順序決定旋向）',
    expect: `motor.m${c.motor}`, validationStatus: PEND,
  });
}
steps.push({
  id: 'rx-rcin', kind: 'port', wireType: 'signal', polarity: false, connector: 'rx-servo',
  titleZh: '把遙控接收機接到飛控 RC IN',
  explainZh: '接收機用 PPM 或 SBUS 輸出，一條 3P 線接到 RC IN。沒接的話遙控器完全無法控制飛機。',
  fromPart: 'receiver', toPart: 'pixhawk',
  sourcePort: 'rx.out', targetPort: 'fc.rcin', sourcePin: 'S、＋、−', targetPin: 'S、＋、−', expect: 'fc.rcin', validationStatus: PEND,
});
steps.push({
  id: 'gps-uart', kind: 'port', wireType: 'data', polarity: false, connector: 'gps-6p',
  titleZh: '把 GPS 的 6P 線插到飛控 GPS 口',
  explainZh: 'GPS 用序列埠傳位置資料；GPS 口、TELEM1、TELEM2 接頭一樣，插錯也插得進去，所以要看清楚標示。',
  fromPart: 'gps', toPart: 'pixhawk',
  sourcePort: 'gps.serial', targetPort: 'fc.gps', sourcePin: 'VCC、TX、RX、GND', targetPin: '5V、RX、TX、GND（TX／RX 交叉）', expect: 'fc.gps', validationStatus: PEND,
});
steps.push({
  id: 'gps-i2c', kind: 'port', wireType: 'data', polarity: false, connector: 'compass-4p',
  titleZh: '把 GPS 上的羅盤 4P 線插到飛控 I2C 口',
  explainZh: '羅盤（指南針）走 I2C 匯流排，接 I2C 口。',
  fromPart: 'gps', toPart: 'pixhawk',
  sourcePort: 'gps.compass', targetPort: 'fc.i2c', sourcePin: 'VCC、SCL、SDA、GND', targetPin: '5V、SCL、SDA、GND', expect: 'fc.i2c', validationStatus: PEND,
});
steps.push({
  id: 'telem', kind: 'port', wireType: 'data', polarity: false, connector: 'telem-6p',
  titleZh: '把數傳電台接到飛控 TELEM1',
  explainZh: 'ArduPilot 預設在 TELEM1（SERIAL1）用 MAVLink2 跟地面站溝通，本課程統一接 TELEM1。',
  fromPart: 'telemetry', toPart: 'pixhawk',
  sourcePort: 'telem.serial', targetPort: 'fc.telem1', sourcePin: '5V、TX、RX、CTS、RTS、GND', targetPin: '同左（TX／RX 交叉）', expect: 'fc.telem1', validationStatus: PEND,
});
steps.push({
  id: 'buzzer', kind: 'port', wireType: 'signal', polarity: false, connector: 'buzzer-2p',
  titleZh: '把蜂鳴器接到飛控 BUZZER 口', explainZh: 'Pixhawk 必須接蜂鳴器，解鎖與警告都靠它提示。',
  fromPart: 'buzzer', toPart: 'pixhawk', sourcePort: 'buzzer.conn', targetPort: 'fc.buzzer', sourcePin: '＋、−', targetPin: 'BUZ、GND', expect: 'fc.buzzer', validationStatus: PEND,
});
steps.push({
  id: 'switch', kind: 'port', wireType: 'signal', polarity: false, connector: 'switch-3p',
  titleZh: '把安全開關接到飛控 SWITCH 口', explainZh: '安全開關沒按下前，飛控不會輸出馬達訊號，是地面安全的第一道防線。',
  fromPart: 'safety_switch', toPart: 'pixhawk', sourcePort: 'switch.conn', targetPort: 'fc.switch', sourcePin: '1～3', targetPin: '3.3V、LED、SAFETY', expect: 'fc.switch', validationStatus: PEND,
});
// 最後：電池
steps.push({
  id: 'battery', kind: 'port', wireType: 'power', polarity: true, connector: 'xt60',
  titleZh: '最後：把電池 XT60 接到電源模組（模擬上電）',
  explainZh: '電池一定要經過電源模組；主電池電壓直接接飛控 POWER 口會燒毀飛控。接電前再確認槳已拆下。',
  fromPart: 'battery', toPart: 'power_module',
  sourcePort: 'battery.xt60', targetPort: 'pm.in', sourcePin: '＋／−（XT60 防呆）', targetPin: '＋／−', expect: 'pm.in', validationStatus: PEND,
});

// 接頭類型 → 實體插得進去的接口類型（插得進去不代表對；對不對由規則判斷）
export const CONNECTOR_FITS = {
  'pm-6p': ['power6'],
  'esc-signal': ['pwm', 'rcin'],
  'rx-servo': ['rcin', 'pwm'],
  'gps-6p': ['uart'],
  'telem-6p': ['uart'],
  'compass-4p': ['i2c'],
  'buzzer-2p': ['buzzer'],
  'switch-3p': ['switch'],
  xt60: ['xt60-in', 'power6'],   // 接到 POWER 口要靠轉接線——這正是要教的危險錯誤
};

export const F450_WIRING = Object.freeze({ modelId: 'f450-pixhawk248', boardId: 'pixhawk-248-generic', steps });
