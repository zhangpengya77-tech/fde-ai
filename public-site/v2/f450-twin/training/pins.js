// F450 實訓中心｜引腳級接線資料與檢查（P11）
// 純資料與規則，不碰畫面。每個接頭展開成引腳，學員一根一根接；檢查後換算回 model.js 的 20 條接頭級連線，
// 讓成績單、3D 線束、保存紀錄沿用原本流程。
// 來源：PX4《3DR Pixhawk 1》引腳表、PX4 開源硬體 FMUv2.4.6（CC-BY-SA 3.0）、樂迪 R9DS 說明書（SBUS 由 CH9 輸出）、
//       ArduPilot 接線文件（排針不供電、訊號線連同地線）。GPS 模組端、電調 BEC、接頭類型「待實機核對」。
import { EXPECTED_WIRES } from './model.js?v=p4-1';

// kind：v5／v33（電源）、gnd（地）、pos／neg（大電流正負）、tx／rx（UART）、scl／sda（I2C）、sig（PWM／SBUS 訊號）、
//       phase（三相）、cur／volt（電流電壓量測）、led／safety（安全開關）、buzz（蜂鳴器）、can、nc（不用）
const P = (id, label, kind) => ({ id, label, kind });
const CORNERS = ['fr', 'fl', 'rl', 'rr'];
const MAIN = { fr: 1, rl: 2, fl: 3, rr: 4 };   // Quad X：右前 1、左後 2、左前 3、右後 4

// 接頭級接口 → 引腳（接口 id 與 model.js PORTS 相同）
export const PORT_PINS = {
  'battery.xt60': [P('+', '＋', 'pos'), P('-', '−', 'neg')],
  'power_module.in': [P('+', '＋', 'pos'), P('-', '−', 'neg')],
  'power_module.out': [P('+', '＋', 'pos'), P('-', '−', 'neg')],
  'power_module.fc': [P('1', '5V', 'v5'), P('2', '5V', 'v5'), P('3', 'CUR', 'cur'), P('4', 'VOLT', 'volt'), P('5', 'GND', 'gnd'), P('6', 'GND', 'gnd')],
  'pdb.in': [P('+', '＋', 'pos'), P('-', '−', 'neg')],
  ...Object.fromEntries(CORNERS.flatMap((c) => [
    [`pdb.pad_${c}`, [P('+', '＋', 'pos'), P('-', '−', 'neg')]],
    [`esc_${c}.power`, [P('+', '＋', 'pos'), P('-', '−', 'neg')]],
    [`esc_${c}.phase`, [P('a', 'A', 'phase'), P('b', 'B', 'phase'), P('c', 'C', 'phase')]],
    [`esc_${c}.signal`, [P('s', 'S', 'sig'), P('+', '＋', 'v5'), P('-', '−', 'gnd')]],
    [`motor_${c}.phase`, [P('a', 'A', 'phase'), P('b', 'B', 'phase'), P('c', 'C', 'phase')]],
  ])),
  // Pixhawk（依 PX4 官方引腳表與 FMUv2.4.6 電路板）
  'pixhawk.power': [P('1', '5V', 'v5'), P('2', '5V', 'v5'), P('3', 'CUR', 'cur'), P('4', 'VOLT', 'volt'), P('5', 'GND', 'gnd'), P('6', 'GND', 'gnd')],
  'pixhawk.gps': [P('1', '5V', 'v5'), P('2', 'TX', 'tx'), P('3', 'RX', 'rx'), P('4', 'CAN2TX', 'nc'), P('5', 'CAN2RX', 'nc'), P('6', 'GND', 'gnd')],
  'pixhawk.i2c': [P('1', '5V', 'v5'), P('2', 'SCL', 'scl'), P('3', 'SDA', 'sda'), P('4', 'GND', 'gnd')],
  'pixhawk.switch': [P('1', '3.3V', 'v33'), P('2', 'LED', 'led'), P('3', 'SAFETY', 'safety')],
  'pixhawk.buzzer': [P('1', 'BUZ', 'buzz'), P('2', 'GND', 'gnd')],
  'pixhawk.rc_in': [P('s', 'S', 'sig'), P('+', '＋', 'v5'), P('-', '−', 'gnd')],
  ...Object.fromEntries([1, 2, 3, 4].map((n) => [`pixhawk.main_out_${n}`, [P('s', 'S', 'sig'), P('+', '＋', 'v5'), P('-', '−', 'gnd')]])),
  // 周邊
  'receiver.sbus': [P('s', 'S', 'sig'), P('+', '＋', 'v5'), P('-', '−', 'gnd')],   // R9DS CH9（SBUS 模式）
  'gps.serial': [P('vcc', 'VCC', 'v5'), P('tx', 'TX', 'tx'), P('rx', 'RX', 'rx'), P('gnd', 'GND', 'gnd')],   // 通用 M8N，待實機核對
  'gps.compass': [P('vcc', 'VCC', 'v5'), P('scl', 'SCL', 'scl'), P('sda', 'SDA', 'sda'), P('gnd', 'GND', 'gnd')],
  'safety_switch.conn': [P('1', '3.3V', 'v33'), P('2', 'LED', 'led'), P('3', 'SAFETY', 'safety')],
  'buzzer.conn': [P('+', '＋', 'buzz'), P('-', '−', 'gnd')],
};
export const pinId = (port, pin) => `${port}#${pin}`;
export const ALL_PINS = Object.fromEntries(Object.entries(PORT_PINS).flatMap(([port, pins]) => pins.map((p) => [pinId(port, p.id), { ...p, port, component: port.split('.')[0] }])));

// 每條接頭級連線要接哪些引腳（[A 端腳, B 端腳]）；phase＝三相任意順序都算對
const SAME = (n) => Array.from({ length: n }, (_, i) => [String(i + 1), String(i + 1)]);
const PIN_PLAN = {
  'battery.xt60--power_module.in': [['+', '+'], ['-', '-']],
  'power_module.out--pdb.in': [['+', '+'], ['-', '-']],
  'power_module.fc--pixhawk.power': SAME(6),
  'receiver.sbus--pixhawk.rc_in': [['s', 's'], ['+', '+'], ['-', '-']],
  'gps.serial--pixhawk.gps': [['vcc', '1'], ['tx', '3'], ['rx', '2'], ['gnd', '6']],   // TX→RX、RX→TX 交叉
  'gps.compass--pixhawk.i2c': [['vcc', '1'], ['scl', '2'], ['sda', '3'], ['gnd', '4']],
  'safety_switch.conn--pixhawk.switch': SAME(3),
  'buzzer.conn--pixhawk.buzzer': [['+', '1'], ['-', '2']],
  ...Object.fromEntries(CORNERS.flatMap((c) => [
    [`pdb.pad_${c}--esc_${c}.power`, [['+', '+'], ['-', '-']]],
    [`esc_${c}.phase--motor_${c}.phase`, 'phase'],
    [`esc_${c}.signal--pixhawk.main_out_${MAIN[c]}`, [['s', 's'], ['-', '-']]],   // 紅線（＋）不接：排針不供電
  ])),
};
// 展開成引腳級的正確接線（固定的部分；三相另外判斷）
export const EXPECTED_PIN_WIRES = EXPECTED_WIRES.flatMap((w) => {
  const plan = PIN_PLAN[w.id];
  if (plan === 'phase') return ['a', 'b', 'c'].map((x) => ({ link: w.id, a: pinId(w.from, x), b: pinId(w.to, null), phase: true }));
  return plan.map(([pa, pb]) => ({ link: w.id, a: pinId(w.from, pa), b: pinId(w.to, pb) }));
});
export const PIN_WIRE_TOTAL = EXPECTED_PIN_WIRES.length;   // 54（55 根中數傳為選配，不列入）
export const pinPlanOf = (linkId) => PIN_PLAN[linkId];

const key = (a, b) => [a, b].sort().join('|');
const isPower = (k) => k === 'v5' || k === 'v33' || k === 'pos';
const isGround = (k) => k === 'gnd' || k === 'neg';

// 檢查引腳級接線：wires＝[{ id?, a, b }]（a、b 為 pinId）。回傳問題清單與換算出的接頭級連線
// code：UNKNOWN_PIN、SELF_LOOP、DUPLICATE、PIN_BUSY、SHORT（電源接地）、TX_NOT_CROSSED、UNUSED_PIN、ESC_RED_ON_RAIL、
//       PIN_WRONG（接錯腳）、PIN_MISSING（缺腳）
export function validatePinWiring(wires) {
  const issues = [], seen = new Map(), used = new Map();
  const add = (code, w, message, extra = {}) => issues.push({ code, wire: w?.id ?? null, pins: w ? [w.a, w.b] : [], message, ...extra });
  const ok = [];   // 接對的 [a, b]
  for (const [i, w0] of wires.entries()) {
    const w = { id: w0.id ?? `p${i}`, a: w0.a, b: w0.b };
    const A = ALL_PINS[w.a], B = ALL_PINS[w.b];
    if (!A || !B) { add('UNKNOWN_PIN', w, `未知的引腳：${!A ? w.a : w.b}`); continue; }
    if (A.component === B.component) { add('SELF_LOOP', w, `${A.label} 不能接到同一個零件的 ${B.label}`); continue; }
    const k = key(w.a, w.b);
    if (seen.has(k)) { add('DUPLICATE', w, '重複接線'); continue; }
    seen.set(k, w.id);
    for (const p of [w.a, w.b]) (used.get(p) || used.set(p, []).get(p)).push(w.id);
    if ((isPower(A.kind) && isGround(B.kind)) || (isGround(A.kind) && isPower(B.kind))) { add('SHORT', w, `短路：${A.label} 接到 ${B.label}（電源接地，會燒板）`); continue; }
    if ((A.kind === 'tx' && B.kind === 'tx') || (A.kind === 'rx' && B.kind === 'rx')) { add('TX_NOT_CROSSED', w, `TX／RX 沒交叉：${A.label} 不能接 ${B.label}，要 TX 接 RX`); continue; }
    if (A.kind === 'nc' || B.kind === 'nc') { add('UNUSED_PIN', w, `${(A.kind === 'nc' ? A : B).label} 這腳這台不用接`); continue; }
    const escRed = (p) => /^esc_..\.signal#\+$/.test(p), rail = (p) => /^pixhawk\.main_out_\d#\+$/.test(p);
    if ((escRed(w.a) && rail(w.b)) || (escRed(w.b) && rail(w.a))) { add('ESC_RED_ON_RAIL', w, '電調紅線（＋）不要接到排針：Pixhawk 不供電給排針；有 BEC 時只能留一顆'); continue; }
    const exp = EXPECTED_PIN_WIRES.find((e) => !e.phase && key(e.a, e.b) === k);
    const phaseOk = A.kind === 'phase' && B.kind === 'phase' && EXPECTED_PIN_WIRES.some((e) => e.phase && [w.a, w.b].includes(e.a) && [w.a, w.b].some((p) => p.startsWith(e.b.replace('#null', '#'))));
    if (exp || phaseOk) { ok.push(w); continue; }
    add('PIN_WRONG', w, `接錯腳：${A.port} ${A.label} 不該接 ${B.port} ${B.label}`);
  }
  for (const [p, ids] of used) if (ids.length > 1) issues.push({ code: 'PIN_BUSY', wire: ids[1], pins: [p], message: `${ALL_PINS[p]?.port} ${ALL_PINS[p]?.label} 接了 ${ids.length} 根線`, wires: ids });
  // 換算接頭級連線：該條連線的引腳全部接對（三相：三根都接到對應馬達的不同腳）才算一條
  const okKeys = new Set(ok.map((w) => key(w.a, w.b)));
  const links = [];
  for (const link of EXPECTED_WIRES) {
    const plan = PIN_PLAN[link.id];
    let done;
    if (plan === 'phase') {
      const mine = ok.filter((w) => [w.a, w.b].some((p) => p.startsWith(`${link.from}#`)) && [w.a, w.b].some((p) => p.startsWith(`${link.to}#`)));
      const escPins = new Set(mine.map((w) => [w.a, w.b].find((p) => p.startsWith(`${link.from}#`))));
      const motPins = new Set(mine.map((w) => [w.a, w.b].find((p) => p.startsWith(`${link.to}#`))));
      done = escPins.size === 3 && motPins.size === 3;
    } else done = plan.every(([pa, pb]) => okKeys.has(key(pinId(link.from, pa), pinId(link.to, pb))));
    const touched = ok.some((w) => [w.a, w.b].some((p) => p.startsWith(`${link.from}#`)) && [w.a, w.b].some((p) => p.startsWith(`${link.to}#`)));
    if (done) links.push({ id: `pin:${link.id}`, from: link.from, to: link.to });
    else if (touched) issues.push({ code: 'PIN_MISSING', wire: null, pins: [], link: link.id, message: `${link.id.replace('--', ' → ')} 還缺幾根線（例如地線或電源）` });
  }
  return { issues, ok: ok.length, total: PIN_WIRE_TOTAL, links, complete: links.length === EXPECTED_WIRES.length && issues.length === 0 };
}
