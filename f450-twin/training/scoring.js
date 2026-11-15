// F450 實訓中心｜判分（P5）
// 純規則：輸入 3D 組裝狀態與 2D 接線，輸出 100 分的分項成績與每一筆扣分原因。
// 配分（P0 方案）：機架 20、馬達與 ESC 20、飛控 15、電源與訊號 30、安全 15。
// 重要：規則目前是 REFERENCE（待實機核對），分數只能當「試行分數」，不得計入正式成績（PRACTICE_ONLY）。
import { ASSEMBLY, ASSEMBLY_BY_ID, EXPECTED_WIRES, PRACTICE_ONLY, validateWiring } from './model.js?v=p4-1';

export const CATEGORIES = [
  { id: 'frame', zh: '機架', max: 20 },
  { id: 'motor_esc', zh: '馬達與 ESC', max: 20 },
  { id: 'fc', zh: '飛控', max: 15 },
  { id: 'power_signal', zh: '電源與訊號', max: 30 },
  { id: 'safety', zh: '安全', max: 15 },
];

// 組裝單元歸屬
const FRAME_UNITS = ['bottom_plate', 'arm_fr', 'arm_fl', 'arm_rl', 'arm_rr', 'top_plate', 'battery_tray', 'leg_fr', 'leg_fl', 'leg_rl', 'leg_rr'];
const MOTOR_ESC_UNITS = ['esc_fr', 'esc_fl', 'esc_rl', 'esc_rr', 'motor_fr', 'motor_fl', 'motor_rl', 'motor_rr'];
const FC_UNITS = ['pixhawk', 'gps', 'receiver'];
// 接線歸屬（以 EXPECTED_WIRES 的 id 判斷）
const isEscSignal = (id) => id.startsWith('esc_') && id.includes('.signal--');
const isFcWire = (id) => /^(receiver\.sbus|gps\.serial|gps\.compass)--/.test(id);
const POWER_SIGNAL_WIRES = EXPECTED_WIRES.filter((w) => !isEscSignal(w.id) && !isFcWire(w.id)).map((w) => w.id);   // 電源路徑＋安全開關、蜂鳴器

// 錯誤扣分（安全類扣在安全分）
const DEDUCT = {
  ORDER: { cat: 'frame', pts: 1, zh: '組裝順序錯' },
  ORDER_PROP: { cat: 'safety', pts: 5, zh: '電池裝好前就拿槳葉（通電前必須拆槳）' },
  ORIENTATION: { cat: 'fc', pts: 2, zh: '飛控或 GPS 方向沒對準機頭就安裝' },
  WRONG_SPIN: { cat: 'safety', pts: 3, zh: '槳葉轉向裝錯位置' },
  WRONG_SLOT: { cat: 'frame', pts: 1, zh: '零件放錯位置' },
  WRONG_CONNECTION: { cat: 'power_signal', pts: 2, zh: '接錯接口' },
  CONNECTOR_MISMATCH: { cat: 'power_signal', pts: 2, zh: '接頭類型不合' },
  ROLE_MISMATCH: { cat: 'power_signal', pts: 2, zh: '輸出接輸出／方向錯' },
  DUPLICATE: { cat: 'power_signal', pts: 1, zh: '重複接線' },
  PORT_BUSY: { cat: 'power_signal', pts: 1, zh: '同一接口接多條線' },
  SELF_LOOP: { cat: 'power_signal', pts: 1, zh: '自己接自己' },
  UNKNOWN_PORT: { cat: 'power_signal', pts: 1, zh: '未知接口' },
  POLARITY: { cat: 'safety', pts: 5, zh: '電源紅黑接反（會燒毀設備）' },
  // P11 引腳級
  SHORT: { cat: 'safety', pts: 5, zh: '電源接到地線（短路，會燒板）' },
  TX_NOT_CROSSED: { cat: 'power_signal', pts: 2, zh: 'TX／RX 沒交叉' },
  PIN_WRONG: { cat: 'power_signal', pts: 2, zh: '接錯腳' },
  UNUSED_PIN: { cat: 'power_signal', pts: 1, zh: '接到不用的腳' },
  ESC_RED_ON_RAIL: { cat: 'safety', pts: 2, zh: '電調紅線接到排針' },
  PIN_BUSY: { cat: 'power_signal', pts: 1, zh: '一腳接多根線' },
};

const round1 = (x) => Math.round(x * 10) / 10;

// assembly：model.js 的組裝狀態（含 log）；wires：2D 接線陣列
export function scoreSession(assembly, wires, pinIssues = []) {
  const cats = Object.fromEntries(CATEGORIES.map((c) => [c.id, { ...c, earned: 0, deductions: [], items: [] }]));
  const parts = assembly?.parts || {};
  const done = (id) => parts[id]?.status === 'installed';
  const share = (cat, pts, ok, label) => { cats[cat].items.push({ label, pts: round1(pts), ok }); if (ok) cats[cat].earned += pts; };

  // ── 組裝得分 ──
  FRAME_UNITS.forEach((id) => share('frame', 20 / FRAME_UNITS.length, done(id), `安裝 ${ASSEMBLY_BY_ID[id].zh}`));
  MOTOR_ESC_UNITS.forEach((id) => share('motor_esc', 10 / MOTOR_ESC_UNITS.length, done(id), `安裝 ${ASSEMBLY_BY_ID[id].zh}`));
  share('fc', 5, done('pixhawk'), '安裝 Pixhawk 並對準機頭');
  share('fc', 3, done('gps'), '安裝 GPS 並對準機頭');
  share('fc', 2, done('receiver'), '安裝接收機');

  // ── 接線得分 ──
  const result = validateWiring(wires || []);
  const correct = new Set(result.correct.map((c) => c.expected));
  EXPECTED_WIRES.filter((w) => isEscSignal(w.id)).forEach((w) => share('motor_esc', 10 / 4, correct.has(w.id), `ESC 訊號線順序：${w.from.split('.')[0].replace('esc_', 'ESC ').toUpperCase()} → ${w.to.split('.')[1].replace('main_out_', 'MAIN OUT ')}`));
  EXPECTED_WIRES.filter((w) => isFcWire(w.id)).forEach((w) => share('fc', 5 / 3, correct.has(w.id), `飛控接線：${w.from} → ${w.to}`));
  POWER_SIGNAL_WIRES.forEach((id) => share('power_signal', 30 / POWER_SIGNAL_WIRES.length, correct.has(id), `接線：${id.replace('--', ' → ')}`));

  // 安全：隨完成度累積（已安裝件數＋接對條數），全部完成才拿滿 15 分；有安全錯誤再扣。避免只做一點就拿到整筆安全分
  const progress = (ASSEMBLY.filter((x) => done(x.id)).length + correct.size) / (ASSEMBLY.length + EXPECTED_WIRES.length);
  cats.safety.earned = 15 * progress;
  cats.safety.items.push({ label: `安全分隨完成度累積（目前 ${Math.round(progress * 100)}%）`, pts: 15, ok: progress === 1 });

  // ── 扣分 ──
  const deduct = (code, detail) => {
    const d = DEDUCT[code]; if (!d) return;
    cats[d.cat].deductions.push({ code, reason: d.zh, detail, pts: d.pts });
  };
  for (const e of assembly?.log || []) {
    if (e.code === 'ORDER' && ASSEMBLY_BY_ID[e.unit]?.kind === 'prop') deduct('ORDER_PROP', e.message);
    else deduct(e.code, e.message);
  }
  for (const i of result.issues) if (i.code !== 'MISSING') deduct(i.code, i.message);
  for (const i of pinIssues) deduct(i.code, i.message);   // P11：引腳級錯誤

  // 合計（每項不低於 0、不高於滿分）
  for (const c of Object.values(cats)) {
    const minus = c.deductions.reduce((s, d) => s + d.pts, 0);
    c.score = round1(Math.max(0, Math.min(c.max, c.earned - minus)));
    c.lost = round1(c.max - c.score);
  }
  const list = CATEGORIES.map((c) => cats[c.id]);
  const total = Math.round(list.reduce((s, c) => s + c.score, 0));
  return {
    total, categories: list, wiring: result,
    assemblyDone: ASSEMBLY.every((a) => done(a.id)), wiringDone: result.ok,
    practiceOnly: PRACTICE_ONLY,
  };
}
