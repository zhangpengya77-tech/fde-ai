// 組裝實訓室｜5 吋 FPV 接線步驟（P3，Betaflight）
//
// 共 12 步：電機三相焊到 4 合 1 電調 M1～M4 → XT60 電源線 → 電容 → 電調與飛控 8P 排線 → ELRS 接收機（UART 交叉）
// → 數位圖傳 6P → 攝影機 → 圖傳天線（通電前一定先接）→ 最後才接電池。
// 規則與 F450 共用 core/wiring-rules.js；馬達編號依 Betaflight（M1 右後、M2 右前、M3 左後、M4 左前），與 ArduPilot 分開。
// validationStatus 一律 PENDING_MANUAL。

const CORNERS = [
  { key: 'rr', zh: '右後', motor: 1 },
  { key: 'fr', zh: '右前', motor: 2 },
  { key: 'rl', zh: '左後', motor: 3 },
  { key: 'fl', zh: '左前', motor: 4 },
];
const PEND = 'PENDING_MANUAL';
const BF_ORDER_ZH = 'Betaflight QUADX：M1 右後、M2 右前、M3 左後、M4 左前（和 ArduPilot 的 M1 右前不同）；電調 M1 焊盤接右後電機，依此類推。';

export const FPV5_EXTRA_POINTS = {
  ...Object.fromEntries(CORNERS.map((c) => [`esc.m${c.motor}`, { nameZh: `電調 M${c.motor} 焊盤`, type: 'esc-motor-pad', index: c.motor }])),
  'esc.bat+': { nameZh: '電調 BAT ＋', type: 'pad', polarity: '+', group: 'esc.bat' },
  'esc.bat-': { nameZh: '電調 BAT −', type: 'pad', polarity: '-', group: 'esc.bat' },
  'vtx.cam': { nameZh: '圖傳攝影機接口', type: 'cam' },
  'vtx.ant': { nameZh: '圖傳天線座', type: 'ant' },
  'xt60.in': { nameZh: 'XT60 母座（電池端）', type: 'xt60-in' },
};

const steps = [];
for (const c of CORNERS) {
  steps.push({
    id: `motor${c.motor}-phase`, kind: 'phase', wireType: 'phase', polarity: false, targetType: 'esc-motor-pad', orderRuleZh: BF_ORDER_ZH,
    titleZh: `把 ${c.zh}電機（Betaflight M${c.motor}）的三條線焊到電調`,
    explainZh: `Betaflight 的 M${c.motor} 在${c.zh}，要焊到電調的「M${c.motor}」焊盤。三相線沒有正負，轉向不對可在 Betaflight／BLHeli 設定反轉（拆槳測試）。`,
    fromPart: `motor_m${c.motor}`, toPart: 'esc_4in1',
    sourcePort: `motor${c.motor}.phase`, targetPort: `esc.m${c.motor}`, sourcePin: 'A／B／C', targetPin: '三相焊盤', expect: `esc.m${c.motor}`, validationStatus: PEND,
  });
}
steps.push({
  id: 'xt60-solder', kind: 'polarity', wireType: 'power', polarity: true, group: 'esc.bat', groupZh: '電調 BAT 焊盤',
  titleZh: '把 XT60 電源線焊到電調的電池焊盤', explainZh: '紅線焊「BAT＋」、黑線焊「BAT−」。焊接全程不接電池，焊完先量有沒有短路。',
  fromPart: 'xt60_lead', toPart: 'esc_4in1', sourcePort: 'xt60.lead', targetPort: 'esc.bat', sourcePin: '＋／−', targetPin: 'BAT＋／BAT−',
  expect: { red: 'esc.bat+', black: 'esc.bat-' }, validationStatus: PEND,
});
steps.push({
  id: 'capacitor', kind: 'polarity', wireType: 'power', polarity: true, capacitor: true, group: 'esc.bat', groupZh: '電調 BAT 焊盤',
  titleZh: '把低 ESR 電容焊到電池焊盤（請點「正極腳」要焊的位置）', explainZh: '電容吸收電壓尖峰保護電調。外殼白色條紋那腳是負極，焊「BAT−」；另一腳焊「BAT＋」。',
  fromPart: 'capacitor', toPart: 'esc_4in1', sourcePort: 'cap.leads', targetPort: 'esc.bat', sourcePin: '＋／−（條紋為 −）', targetPin: 'BAT＋／BAT−',
  expect: { red: 'esc.bat+', black: 'esc.bat-' }, validationStatus: PEND,
});
steps.push({
  id: 'esc-fc', kind: 'port', wireType: 'signal', polarity: false, connector: 'esc-8p',
  titleZh: '用 8P 排線連接電調與飛控', explainZh: '排線同時送電、電流量測與四個馬達訊號。兩端線序依廠牌而異，要用原廠排線。',
  fromPart: 'esc_4in1', toPart: 'fc', sourcePort: 'esc.8p', targetPort: 'fc.esc8', sourcePin: '1～8（待確認）', targetPin: '1～8（待確認）', expect: 'fc.esc8', validationStatus: PEND,
});
steps.push({
  id: 'rx-uart', kind: 'polarity', pair: 'uart', wireType: 'data', polarity: false, group: 'fc.uart2', groupZh: 'UART2',
  titleZh: '把 ELRS 接收機接到飛控 UART2（請點接收機「TX 線」要焊的焊盤）',
  explainZh: '序列埠要交叉：接收機 TX → 飛控 RX、接收機 RX → 飛控 TX；5V 與 GND 另外接飛控的 5V／GND 焊盤。',
  fromPart: 'receiver', toPart: 'fc', sourcePort: 'rx.uart', targetPort: 'fc.uart2', sourcePin: 'TX、RX、5V、GND', targetPin: 'RX2、TX2、5V、GND',
  expect: { red: 'fc.uart2.rx', black: 'fc.uart2.tx' }, validationStatus: PEND,
});
steps.push({
  id: 'vtx-fc', kind: 'port', wireType: 'data', polarity: false, connector: 'hd-6p',
  titleZh: '用 6P 排線連接數位圖傳與飛控', explainZh: '排線送電給圖傳，並傳 OSD 資料（MSP DisplayPort）。',
  fromPart: 'vtx', toPart: 'fc', sourcePort: 'vtx.6p', targetPort: 'fc.hd', sourcePin: '1～6（待確認）', targetPin: '1～6（待確認）', expect: 'fc.hd', validationStatus: PEND,
});
steps.push({
  id: 'camera', kind: 'port', wireType: 'data', polarity: false, connector: 'cam-cable',
  titleZh: '把攝影機排線接到圖傳', explainZh: '攝影機畫面經這條線送進圖傳。',
  fromPart: 'camera', toPart: 'vtx', sourcePort: 'cam.cable', targetPort: 'vtx.cam', sourcePin: '—', targetPin: '—', expect: 'vtx.cam', validationStatus: PEND,
});
steps.push({
  id: 'vtx-antenna', kind: 'port', wireType: 'signal', polarity: false, connector: 'antenna',
  titleZh: '把天線接到圖傳（一定在通電前）', explainZh: '圖傳沒接天線就通電，發射功率無處可去，可能過熱損壞。',
  fromPart: 'vtx_antenna', toPart: 'vtx', sourcePort: 'antenna', targetPort: 'vtx.ant', sourcePin: '—', targetPin: '—', expect: 'vtx.ant', validationStatus: PEND,
});
steps.push({
  id: 'battery', kind: 'port', wireType: 'power', polarity: true, connector: 'xt60',
  titleZh: '最後：接上電池（模擬上電）', explainZh: '確認槳已拆、天線已接、電池電壓在電調與圖傳規格內，才接電池。',
  fromPart: 'battery', toPart: 'xt60_lead', sourcePort: 'battery.xt60', targetPort: 'xt60.in', sourcePin: '＋／−（XT60 防呆）', targetPin: '＋／−', expect: 'xt60.in', validationStatus: PEND,
});

export const FPV5_FITS = {
  'esc-8p': ['esc8'],
  'hd-6p': ['hd6'],
  'cam-cable': ['cam'],
  antenna: ['ant'],
  xt60: ['xt60-in'],
};

export const FPV5_WIRING = Object.freeze({
  modelId: 'fpv5-225',
  boardId: 'betaflight-f7-3030-generic',
  steps,
  requirements: [
    { stepId: 'rx-uart', code: 'RC_MISSING', severity: 'danger', messageZh: '接收機未連接：遙控器無法控制飛機。', fixZh: '接收機接到 UART，並在 Betaflight 的 Ports 與 Receiver 分頁設定。' },
    { stepId: 'vtx-antenna', code: 'ANTENNA_MISSING', severity: 'danger', messageZh: '圖傳未接天線：通電後可能過熱損壞。', fixZh: '通電前先把天線鎖上圖傳。' },
  ],
});
