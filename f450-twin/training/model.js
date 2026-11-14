// F450 實訓中心｜共用資料模型（P2）
// 純資料與規則：不碰 DOM、不碰 three.js。3D 組裝（P2）、2D 接線（P3）、判分（P5）都只讀寫這裡。
// 原則：
//   1. 組裝順序取自 parts-data.js 的 STEPS（DJI F450 手冊 V2.2 p.7 整理）；接線取自 WIRING（14 列）。
//   2. 全部規則目前是 REFERENCE（依公開資料，待實機核對），只能用於練習，不得計入正式考核分數。
//   3. 不提供腳位級定義；接口只到「接頭名稱＋用途」。
import { STEPS, WIRING } from '../parts-data.js';

export const RULES_STATUS = 'REFERENCE';            // 改成 VERIFIED 前，必須逐條對照教師實機照片
export const PRACTICE_ONLY = RULES_STATUS !== 'VERIFIED';

// ───────── 組裝單元 ─────────
// id：組裝單元；kind：對應 parts-data.js 的 PARTS key；step：STEPS 的步驟編號；
// nodes：GLB 節點名稱開頭（同一單元的節點一起移動）；orient：需要對準機頭；slot：可互換的安裝位（槳葉依轉向）
const CORNERS = [['fr', 'FR', '右前'], ['fl', 'FL', '左前'], ['rl', 'RL', '左後'], ['rr', 'RR', '右後']];
const SPIN = { FR: 'CCW', FL: 'CW', RL: 'CCW', RR: 'CW' };   // Quad X 標準（與模型 extras.spin 一致）

export const ASSEMBLY = [
  { id: 'bottom_plate', zh: '下中心板（配電板）', kind: 'bottom_plate', step: 1, nodes: ['Bottom plate'] },
  ...CORNERS.map(([c, C, zh]) => ({ id: `esc_${c}`, zh: `ESC ${zh}`, kind: 'esc', step: 1, nodes: [`ESC ${C}`] })),
  ...CORNERS.map(([c, C, zh]) => ({ id: `arm_${c}`, zh: `機臂 ${zh}（含螺絲）`, kind: 'arm', step: 2, nodes: [`Arm ${C}`, `Fasteners ${C}`] })),
  ...CORNERS.map(([c, C, zh]) => ({ id: `motor_${c}`, zh: `馬達 ${zh}`, kind: 'motor', step: 3, nodes: [`Motor ${C}`, `Motor shaft ${C}`] })),
  { id: 'top_plate', zh: '上中心板', kind: 'top_plate', step: 4, nodes: ['Top plate'] },
  { id: 'power_module', zh: '電源模組', kind: 'power_module', step: 5, nodes: ['Power module'] },
  { id: 'power_lead', zh: 'XT60 主電源線', kind: 'power_lead', step: 5, nodes: ['Main power lead'] },
  { id: 'battery_tray', zh: '電池托板', kind: 'battery_tray', step: 5, nodes: ['Battery tray'] },
  ...CORNERS.map(([c, C, zh]) => ({ id: `leg_${c}`, zh: `腳架 ${zh}`, kind: 'landing_leg', step: 5, nodes: [`Landing leg ${C}`] })),
  { id: 'pixhawk', zh: 'Pixhawk 飛控（含減震泡棉）', kind: 'pixhawk', step: 6, nodes: ['Pixhawk foam', 'Pixhawk 2.4.8'], orient: true },
  { id: 'receiver', zh: 'R9DS 接收機', kind: 'receiver', step: 7, nodes: ['Receiver R9DS'] },
  { id: 'gps', zh: 'GPS／羅盤（含支架）', kind: 'gps', step: 7, nodes: ['GPS mast', 'GPS M8N'], orient: true },
  { id: 'harness', zh: '線材、束帶與膠帶', kind: 'wiring', step: 8, nodes: ['Wire ', 'Zip ties', 'Tape'] },
  { id: 'battery', zh: '4S 電池（含固定帶）', kind: 'battery', step: 9, nodes: ['Battery 4S', 'Battery strap'] },
  ...CORNERS.map(([c, C]) => ({
    id: `prop_${c}`, zh: `槳葉 ${SPIN[C]}（${SPIN[C] === 'CW' ? '順時針' : '逆時針'}）`, kind: 'prop', step: 10,
    nodes: [`Prop ${C}`, `Prop nut ${C}`], slot: { group: 'prop', spin: SPIN[C] },
  })),
];
export const ASSEMBLY_BY_ID = Object.fromEntries(ASSEMBLY.map((a) => [a.id, a]));
export const stepTitle = (n) => STEPS[n - 1]?.title || `第 ${n} 步`;
export const SPAWN_YAW = 180;   // 需要對準機頭的零件，從零件盤拿出時故意轉反，學員要自己轉正

// GLB 節點名稱 → 組裝單元 id（找不到回傳 null）
// three.js 的 GLTFLoader 會把節點名稱的空白換成底線（Bottom plate → Bottom_plate），比對前先換回空白
export function unitOfNode(name) {
  const clean = String(name).replace(/_/g, ' ');
  const hit = ASSEMBLY.find((a) => a.nodes.some((p) => clean.startsWith(p)));
  return hit ? hit.id : null;
}

// ───────── 組裝狀態 ─────────
// status：tray（在零件盤）／held（拿在手上）／installed（已安裝）／wrong_orientation（裝上但方向錯）
export function createAssemblyState() {
  const parts = {};
  for (const a of ASSEMBLY) parts[a.id] = { status: 'tray', slot: null, yaw: 0 };
  return { parts, log: [] };
}
const norm = (deg) => ((Math.round(deg) % 360) + 360) % 360;
const isDone = (p) => p.status === 'installed';
const placed = (p) => p.status === 'installed' || p.status === 'wrong_orientation';

// 前面步驟還沒完成（或方向錯）的單元
export function blockingParts(state, id) {
  const step = ASSEMBLY_BY_ID[id].step;
  return ASSEMBLY.filter((a) => a.step < step && !isDone(state.parts[a.id])).map((a) => a.id);
}
// 這個單元可以安裝的位置：一般只有自己；槳葉可裝到任一同組空位（由轉向決定對錯）
export function slotsFor(state, id) {
  const a = ASSEMBLY_BY_ID[id];
  if (!a.slot) return [id];
  const taken = new Set(Object.entries(state.parts).filter(([k, p]) => k !== id && placed(p)).map(([, p]) => p.slot));
  return ASSEMBLY.filter((b) => b.slot?.group === a.slot.group && !taken.has(b.id)).map((b) => b.id);
}
function fail(state, code, id, message, extra = {}) {
  const issue = { code, unit: id, message, ...extra };
  state.log.push(issue);
  return { ok: false, issue };
}

// 從零件盤拿起：順序不對就拒絕並記錄
export function pick(state, id) {
  const p = state.parts[id];
  if (!p) throw new Error(`未知的組裝單元：${id}`);
  if (p.status !== 'tray') return { ok: true };
  const block = blockingParts(state, id);
  if (block.length) {
    const first = ASSEMBLY_BY_ID[block[0]];
    return fail(state, 'ORDER', id, `順序錯：要先完成第 ${first.step} 步「${stepTitle(first.step)}」（還差 ${block.length} 件，例如 ${first.zh}）`, { blocking: block });
  }
  p.status = 'held'; p.yaw = ASSEMBLY_BY_ID[id].orient ? SPAWN_YAW : 0;
  return { ok: true };
}
export function putBack(state, id) {
  const p = state.parts[id];
  if (p.status === 'held') { p.status = 'tray'; p.yaw = 0; }
}

// 安裝到 slotId：位置由畫面判斷（吸附距離內），這裡判斷位置類型、轉向與方向
export function install(state, id, slotId) {
  const a = ASSEMBLY_BY_ID[id], p = state.parts[id];
  if (p.status !== 'held') return fail(state, 'NOT_HELD', id, '請先從零件盤拿起這個零件');
  if (!slotsFor(state, id).includes(slotId)) return fail(state, 'WRONG_SLOT', id, `位置錯：${a.zh} 不能裝在這裡`, { slot: slotId });
  const target = ASSEMBLY_BY_ID[slotId];
  if (a.slot && target.slot.spin !== a.slot.spin) {
    return fail(state, 'WRONG_SPIN', id, `轉向錯：這個位置要裝 ${target.slot.spin} 槳，手上的是 ${a.slot.spin} 槳（Quad X：右前、左後 CCW；左前、右後 CW）`, { slot: slotId });
  }
  p.slot = slotId;
  if (a.orient && norm(p.yaw) !== 0) {
    p.status = 'wrong_orientation';
    const r = fail(state, 'ORIENTATION', id, `方向錯：${a.zh} 的箭頭要指向機頭，請按「↻ 旋轉 90°」調整`, { yaw: norm(p.yaw) });
    return { ...r, placed: true };
  }
  p.status = 'installed';
  return { ok: true };
}

// 旋轉 90° 的倍數；方向錯的零件轉正後自動變成已安裝
export function rotate(state, id, deg = 90) {
  const a = ASSEMBLY_BY_ID[id], p = state.parts[id];
  if (!a.orient) return { ok: false, message: `${a.zh} 不需要調整方向` };
  if (p.status === 'tray' || p.status === 'installed') return { ok: false, message: p.status === 'installed' ? '已經對準機頭' : '請先拿起零件' };
  p.yaw = norm(p.yaw + deg);
  if (p.status === 'wrong_orientation' && p.yaw === 0) p.status = 'installed';
  return { ok: true, yaw: p.yaw };
}

// 整體檢查：缺件、方向錯、進度與錯誤次數（判分在 P5，這裡只提供事實）
export function assemblyReport(state) {
  const list = ASSEMBLY.map((a) => [a, state.parts[a.id]]);
  const installed = list.filter(([, p]) => isDone(p)).map(([a]) => a.id);
  const wrong = list.filter(([, p]) => p.status === 'wrong_orientation').map(([a]) => a.id);
  const missing = list.filter(([, p]) => !placed(p)).map(([a]) => a.id);
  const nextStep = Math.min(...list.filter(([, p]) => !isDone(p)).map(([a]) => a.step), Infinity);
  const errors = {};
  for (const e of state.log) errors[e.code] = (errors[e.code] || 0) + 1;
  return {
    total: ASSEMBLY.length, installed: installed.length, wrongOrientation: wrong, missing,
    nextStep: Number.isFinite(nextStep) ? nextStep : null, complete: installed.length === ASSEMBLY.length,
    errorCount: state.log.length, errors, practiceOnly: PRACTICE_ONLY,
  };
}

// ───────── 接線：元件、接口、導線 ─────────
// role：power-in／power-out／signal-in／signal-out／data（雙向）
// connector：接頭類型，只有相同類型才插得上
const port = (id, label, role, connector, extra = {}) => ({ id, label, role, connector, ...extra });
const corner = (fn) => CORNERS.map(([c, C, zh]) => fn(c, C, zh));
const MAIN_OUT = { fr: 1, rl: 2, fl: 3, rr: 4 };   // Quad X 標準

export const COMPONENTS = [
  { id: 'battery', zh: '4S 電池', kind: 'battery', ports: [port('battery.xt60', 'XT60 輸出', 'power-out', 'xt60', { voltage: '14.8V' })] },
  { id: 'power_module', zh: '電源模組', kind: 'power_module', ports: [
    port('power_module.in', 'XT60 輸入', 'power-in', 'xt60'),
    port('power_module.out', 'XT60 輸出', 'power-out', 'xt60'),
    port('power_module.fc', '6P 飛控線', 'power-out', 'pm6p', { voltage: '5.3V' }),
  ] },
  { id: 'pdb', zh: '下中心板（配電）', kind: 'bottom_plate', ports: [
    port('pdb.in', '主電源輸入', 'power-in', 'xt60'),
    ...corner((c, C, zh) => port(`pdb.pad_${c}`, `焊盤 ${zh}`, 'power-out', 'solder', { polarity: true })),
  ] },
  ...corner((c, C, zh) => ({ id: `esc_${c}`, zh: `ESC ${zh}`, kind: 'esc', ports: [
    port(`esc_${c}.power`, '電源線', 'power-in', 'solder', { polarity: true }),
    port(`esc_${c}.signal`, '訊號線', 'signal-in', 'servo3p'),
    port(`esc_${c}.phase`, '三相線', 'power-out', 'phase3'),
  ] })),
  ...corner((c, C, zh) => ({ id: `motor_${c}`, zh: `馬達 ${zh}`, kind: 'motor', ports: [port(`motor_${c}.phase`, '三相線', 'power-in', 'phase3')] })),
  { id: 'pixhawk', zh: 'Pixhawk 2.4.8', kind: 'pixhawk', ports: [
    port('pixhawk.power', 'POWER', 'power-in', 'pm6p'),
    ...[1, 2, 3, 4].map((n) => port(`pixhawk.main_out_${n}`, `MAIN OUT ${n}`, 'signal-out', 'servo3p')),
    port('pixhawk.rc_in', 'RC IN', 'signal-in', 'servo3p'),
    port('pixhawk.gps', 'GPS', 'data', 'df13_6'),
    port('pixhawk.i2c', 'I2C', 'data', 'df13_4'),
    port('pixhawk.switch', 'SWITCH', 'data', 'df13_3'),
    port('pixhawk.buzzer', 'BUZZER', 'data', 'df13_2'),
  ] },
  { id: 'receiver', zh: 'R9DS 接收機', kind: 'receiver', ports: [port('receiver.sbus', 'SBUS 輸出', 'signal-out', 'servo3p')] },
  { id: 'gps', zh: 'GPS／羅盤', kind: 'gps', ports: [port('gps.serial', 'GPS 串列（6pin）', 'data', 'df13_6'), port('gps.compass', '羅盤（4pin）', 'data', 'df13_4')] },
  { id: 'safety_switch', zh: '安全開關', kind: 'pixhawk', ports: [port('safety_switch.conn', '3pin 線', 'data', 'df13_3')] },
  { id: 'buzzer', zh: '蜂鳴器', kind: 'pixhawk', ports: [port('buzzer.conn', '2pin 線', 'data', 'df13_2')] },
];
export const PORTS = Object.fromEntries(COMPONENTS.flatMap((c) => c.ports.map((p) => [p.id, { ...p, component: c.id }])));

// 正確接線：row 指回 parts-data.js 的 WIRING 列（0 起算），方便追溯來源
const wire = (from, to, row, kind) => ({ id: `${from}--${to}`, from, to, row, kind, status: RULES_STATUS });
export const EXPECTED_WIRES = [
  wire('battery.xt60', 'power_module.in', 0, 'power'),
  wire('power_module.out', 'pdb.in', 1, 'power'),
  wire('power_module.fc', 'pixhawk.power', 2, 'power'),
  ...corner((c) => wire(`pdb.pad_${c}`, `esc_${c}.power`, 3, 'power')),
  ...corner((c) => wire(`esc_${c}.signal`, `pixhawk.main_out_${MAIN_OUT[c]}`, 4 + MAIN_OUT[c] - 1, 'signal')),
  ...corner((c) => wire(`esc_${c}.phase`, `motor_${c}.phase`, 8, 'power')),
  wire('receiver.sbus', 'pixhawk.rc_in', 9, 'signal'),
  wire('gps.serial', 'pixhawk.gps', 10, 'signal'),
  wire('gps.compass', 'pixhawk.i2c', 11, 'signal'),
  wire('safety_switch.conn', 'pixhawk.switch', 12, 'signal'),
  wire('buzzer.conn', 'pixhawk.buzzer', 13, 'signal'),
];
export const wiringSource = (w) => WIRING[w.row];

const pairKey = (a, b) => [a, b].sort().join('|');
const EXPECTED_BY_PAIR = new Map(EXPECTED_WIRES.map((w) => [pairKey(w.from, w.to), w]));
const ROLE_OK = (a, b) => (a === 'power-out' && b === 'power-in') || (a === 'signal-out' && b === 'signal-in') || (a === 'data' && b === 'data');

// 檢查接線：wires = [{ id?, from, to, reversed? }]，每個問題都指回導線與元件 ID
// code：UNKNOWN_PORT、SELF_LOOP、DUPLICATE、PORT_BUSY、CONNECTOR_MISMATCH、ROLE_MISMATCH、POLARITY、WRONG_CONNECTION、MISSING
export function validateWiring(wires) {
  const issues = [], correct = [], seen = new Map(), used = new Map();
  const comps = (...ids) => [...new Set(ids.map((p) => PORTS[p]?.component).filter(Boolean))];
  wires.forEach((w, i) => {
    const wid = w.id ?? `w${i}`;
    const a = PORTS[w.from], b = PORTS[w.to];
    const add = (code, message, extra = {}) => issues.push({ code, wire: wid, ports: [w.from, w.to], components: comps(w.from, w.to), message, ...extra });
    if (!a || !b) { add('UNKNOWN_PORT', `未知的接口：${!a ? w.from : w.to}`); return; }
    if (a.component === b.component) { add('SELF_LOOP', `${a.label} 不能接到同一個元件的 ${b.label}`); return; }
    const key = pairKey(w.from, w.to);
    if (seen.has(key)) { add('DUPLICATE', `重複接線：${a.label} ↔ ${b.label}`, { first: seen.get(key) }); return; }
    seen.set(key, wid);
    for (const p of [w.from, w.to]) { if (!used.has(p)) used.set(p, []); used.get(p).push(wid); }
    if (a.connector !== b.connector) { add('CONNECTOR_MISMATCH', `接頭不合：${a.label}（${a.connector}）插不進 ${b.label}（${b.connector}）`); return; }
    const [src, dst] = ROLE_OK(a.role, b.role) ? [a, b] : ROLE_OK(b.role, a.role) ? [b, a] : [null, null];
    if (!src) { add('ROLE_MISMATCH', `方向或類型錯：${a.label}（${a.role}）↔ ${b.label}（${b.role}）`); return; }
    if (w.reversed && (src.polarity || dst.polarity)) { add('POLARITY', `極性錯：${src.label} → ${dst.label} 紅正黑負接反`); return; }
    const exp = EXPECTED_BY_PAIR.get(key);
    if (!exp) {
      const should = EXPECTED_WIRES.filter((e) => e.from === w.from || e.to === w.from || e.from === w.to || e.to === w.to);
      add('WRONG_CONNECTION', `接錯：${PORTS[w.from].label} 不該接 ${PORTS[w.to].label}`, { expected: should.map((e) => e.id) });
      return;
    }
    correct.push({ wire: wid, expected: exp.id });
  });
  for (const [p, ids] of used) {
    if (ids.length > 1) issues.push({ code: 'PORT_BUSY', wire: ids[1], ports: [p], components: comps(p), message: `${PORTS[p]?.label || p} 同時接了 ${ids.length} 條線`, wires: ids });
  }
  const done = new Set(correct.map((c) => c.expected));
  for (const e of EXPECTED_WIRES) {
    if (!done.has(e.id)) issues.push({ code: 'MISSING', wire: null, ports: [e.from, e.to], components: comps(e.from, e.to), message: `缺線：${PORTS[e.from].label}（${COMPONENTS.find((c) => c.id === PORTS[e.from].component).zh}）→ ${PORTS[e.to].label}`, expected: e.id });
  }
  return { ok: issues.length === 0, issues, correct, expectedTotal: EXPECTED_WIRES.length, practiceOnly: PRACTICE_ONLY };
}
