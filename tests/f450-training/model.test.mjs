// F450 實訓共用資料模型的單元測試（node --test tests/f450-training/）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSEMBLY, ASSEMBLY_BY_ID, COMPONENT_NODES, EXPECTED_WIRES, componentOfNode, componentsOfKind, PORTS, PRACTICE_ONLY, SPAWN_YAW,
  assemblyReport, blockingParts, createAssemblyState, install, pick, putBack, rotate, slotsFor, unitOfNode, validateWiring, wiringSource,
} from '../../f450-twin/training/model.js';
import { WIRING, STEPS } from '../../f450-twin/parts-data.js';

// GLB r8 的 59 個頂層節點名稱（英文開頭部分），每個都必須屬於某個組裝單元
const GLB_NODES = [
  'Arm FR', 'Arm FL', 'Arm RL', 'Arm RR', 'Bottom plate', 'Top plate',
  ...['FR', 'FL', 'RL', 'RR'].flatMap((c) => [`Motor ${c}`, `Motor shaft ${c}`, `Prop nut ${c}`, `ESC ${c}`]),
  'Prop FR', 'Prop FL', 'Prop RL', 'Prop RR', 'Pixhawk foam', 'Pixhawk 2.4.8', 'Receiver R9DS', 'GPS mast', 'GPS M8N',
  'Power module', 'Battery tray', 'Battery 4S LiPo', 'Battery strap', 'Main power lead XT60',
  ...['FR', 'FL', 'RL', 'RR'].flatMap((c) => [`Zip ties ${c}`, `Tape ${c}`, `Landing leg ${c}`, `Fasteners ${c}`]),
  'Wire signal harness', 'Wire ESC power FR', 'Wire ESC power FL', 'Wire ESC power RL', 'Wire ESC power RR', 'Wire GPS cable', 'Wire power module to POWER',
];

// 依步驟把全部零件正確裝完（方向零件要轉正）
function assembleAll(state) {
  for (const a of [...ASSEMBLY].sort((x, y) => x.step - y.step)) {
    assert.equal(pick(state, a.id).ok, true, a.id);
    if (a.orient) { rotate(state, a.id, 180); }
    assert.equal(install(state, a.id, a.id).ok, true, a.id);
  }
}

test('每個 GLB 節點都對應到唯一的組裝單元', () => {
  assert.equal(GLB_NODES.length, 59);
  for (const n of GLB_NODES) {
    const hits = ASSEMBLY.filter((a) => a.nodes.some((p) => n.startsWith(p)));
    assert.equal(hits.length, 1, `${n} → ${hits.map((h) => h.id)}`);
    assert.equal(unitOfNode(n), hits[0].id);
    const three = n.replace(/\s/g, '_').replace(/[[\].:/]/g, '');   // three.js PropertyBinding.sanitizeNodeName 的規則
    assert.equal(unitOfNode(three), hits[0].id, three);
  }
});

test('2D 元件 ↔ 3D 節點：每個有 3D 零件的元件都對得到，名稱改過也一樣', () => {
  for (const [cid, prefixes] of Object.entries(COMPONENT_NODES)) {
    for (const p of prefixes) {
      const node = GLB_NODES.find((n) => n.startsWith(p));
      assert.ok(node, `${cid}：找不到 ${p}`);
      assert.equal(componentOfNode(node.replace(/\s/g, '_').replace(/[[\].:/]/g, '')), cid);
    }
  }
  assert.equal(componentOfNode('Pixhawk_248'), 'pixhawk');
  assert.equal(componentOfNode('Arm_FR'), null);
  assert.deepEqual(componentsOfKind('esc'), ['esc_fr', 'esc_fl', 'esc_rl', 'esc_rr']);
  assert.deepEqual(componentsOfKind('pixhawk'), ['pixhawk']);           // 安全開關、蜂鳴器 3D 沒有零件，不算
});

test('組裝單元涵蓋 STEPS 的 10 個步驟，且 ID 不重複', () => {
  assert.deepEqual([...new Set(ASSEMBLY.map((a) => a.step))].sort((a, b) => a - b), STEPS.map((s) => s.n));
  assert.equal(new Set(ASSEMBLY.map((a) => a.id)).size, ASSEMBLY.length);
});

test('照順序、方向正確裝完：完成、沒有錯誤', () => {
  const s = createAssemblyState();
  assembleAll(s);
  const r = assemblyReport(s);
  assert.equal(r.complete, true);
  assert.equal(r.installed, ASSEMBLY.length);
  assert.equal(r.errorCount, 0);
  assert.equal(r.nextStep, null);
});

test('順序錯：第 1 步沒完成就拿機臂，被拒絕並記錄', () => {
  const s = createAssemblyState();
  const r = pick(s, 'arm_fr');
  assert.equal(r.ok, false);
  assert.equal(r.issue.code, 'ORDER');
  assert.ok(r.issue.blocking.includes('bottom_plate'));
  assert.equal(s.parts.arm_fr.status, 'tray');
  assert.equal(assemblyReport(s).errors.ORDER, 1);
});

test('順序錯：槳葉必須最後裝（電池沒裝不能裝槳）', () => {
  const s = createAssemblyState();
  for (const a of ASSEMBLY.filter((x) => x.step < 9)) { pick(s, a.id); if (a.orient) rotate(s, a.id, 180); install(s, a.id, a.id); }
  assert.deepEqual(blockingParts(s, 'prop_fr'), ['battery']);
  assert.equal(pick(s, 'prop_fr').issue.code, 'ORDER');
});

test('方向錯：Pixhawk 拿出時是反的，直接裝會標成方向錯；轉正後變成已安裝', () => {
  const s = createAssemblyState();
  for (const a of ASSEMBLY.filter((x) => x.step < 6)) { pick(s, a.id); install(s, a.id, a.id); }
  pick(s, 'pixhawk');
  assert.equal(s.parts.pixhawk.yaw, SPAWN_YAW);
  const r = install(s, 'pixhawk', 'pixhawk');
  assert.equal(r.issue.code, 'ORIENTATION');
  assert.equal(s.parts.pixhawk.status, 'wrong_orientation');
  assert.deepEqual(assemblyReport(s).wrongOrientation, ['pixhawk']);
  assert.equal(pick(s, 'receiver').issue.code, 'ORDER');          // 方向錯沒修正，不能進下一步
  rotate(s, 'pixhawk', 90); assert.equal(s.parts.pixhawk.status, 'wrong_orientation');
  rotate(s, 'pixhawk', 90); assert.equal(s.parts.pixhawk.status, 'installed');
  assert.equal(pick(s, 'receiver').ok, true);
});

test('不需要方向的零件不能旋轉', () => {
  const s = createAssemblyState();
  pick(s, 'bottom_plate');
  assert.equal(rotate(s, 'bottom_plate').ok, false);
});

test('槳葉轉向：CCW 槳裝到 CW 位置被拒絕；裝到另一個 CCW 位置可以', () => {
  const s = createAssemblyState();
  for (const a of ASSEMBLY.filter((x) => x.step < 10)) { pick(s, a.id); if (a.orient) rotate(s, a.id, 180); install(s, a.id, a.id); }
  assert.equal(ASSEMBLY_BY_ID.prop_fr.slot.spin, 'CCW');
  assert.equal(ASSEMBLY_BY_ID.prop_fl.slot.spin, 'CW');
  pick(s, 'prop_fr');
  assert.equal(install(s, 'prop_fr', 'prop_fl').issue.code, 'WRONG_SPIN');
  assert.equal(s.parts.prop_fr.status, 'held');
  assert.equal(install(s, 'prop_fr', 'prop_rl').ok, true);          // 左後也是 CCW
  pick(s, 'prop_rl');
  assert.deepEqual(slotsFor(s, 'prop_rl').sort(), ['prop_fl', 'prop_fr', 'prop_rr']);   // 左後已被占用
  assert.equal(install(s, 'prop_rl', 'prop_rl').issue.code, 'WRONG_SLOT');
  assert.equal(install(s, 'prop_rl', 'prop_fr').ok, true);
});

test('非槳葉零件只能裝在自己的位置；沒拿起不能安裝；放回零件盤', () => {
  const s = createAssemblyState();
  assert.equal(install(s, 'bottom_plate', 'bottom_plate').issue.code, 'NOT_HELD');
  pick(s, 'esc_fr');
  assert.equal(install(s, 'esc_fr', 'esc_fl').issue.code, 'WRONG_SLOT');
  putBack(s, 'esc_fr');
  assert.equal(s.parts.esc_fr.status, 'tray');
});

test('規則目前只能用於練習（未逐條核對實機）', () => {
  assert.equal(PRACTICE_ONLY, true);
  assert.equal(assemblyReport(createAssemblyState()).practiceOnly, true);
  assert.ok(EXPECTED_WIRES.every((w) => w.status === 'REFERENCE'));
});

// ───────── 接線 ─────────
test('正確接線共 20 條，每條都指回 WIRING 的一列，接口都存在', () => {
  assert.equal(EXPECTED_WIRES.length, 20);
  const rows = new Set(EXPECTED_WIRES.map((w) => w.row));
  assert.equal(rows.size, WIRING.length);                             // 14 列全部用到
  for (const w of EXPECTED_WIRES) { assert.ok(PORTS[w.from], w.from); assert.ok(PORTS[w.to], w.to); assert.ok(wiringSource(w)); }
});

test('全部接對：沒有問題', () => {
  const r = validateWiring(EXPECTED_WIRES.map((w) => ({ from: w.from, to: w.to })));
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.correct.length, 20);
});

for (const w of EXPECTED_WIRES) {
  test(`正確接線：${w.id}（反向拉線也算對）`, () => {
    const r = validateWiring([{ from: w.to, to: w.from }]);
    assert.equal(r.correct.length, 1);
    assert.equal(r.issues.filter((i) => i.code !== 'MISSING').length, 0);
    assert.equal(r.issues.filter((i) => i.code === 'MISSING').length, 19);
  });
}

const allBut = (id) => EXPECTED_WIRES.filter((w) => w.id !== id).map((w) => ({ from: w.from, to: w.to }));
const codes = (r) => r.issues.map((i) => i.code);

test('缺線：少一條 GPS 線，指出缺哪一條', () => {
  const r = validateWiring(allBut('gps.serial--pixhawk.gps'));
  assert.deepEqual(codes(r), ['MISSING']);
  assert.equal(r.issues[0].expected, 'gps.serial--pixhawk.gps');
  assert.deepEqual(r.issues[0].components.sort(), ['gps', 'pixhawk']);
});

test('接錯：右前 ESC 接到 MAIN OUT 2', () => {
  const ws = allBut('esc_fr.signal--pixhawk.main_out_1');
  ws.push({ id: 'bad', from: 'esc_fr.signal', to: 'pixhawk.main_out_1'.replace('1', '3') });
  const r = validateWiring(ws);
  const wrong = r.issues.find((i) => i.code === 'WRONG_CONNECTION');
  assert.equal(wrong.wire, 'bad');
  assert.ok(wrong.expected.includes('esc_fr.signal--pixhawk.main_out_1'));
  assert.ok(codes(r).includes('PORT_BUSY'));                         // MAIN OUT 3 已被左前 ESC 占用
});

test('接頭不合：XT60 接到伺服排針', () => {
  const r = validateWiring([{ from: 'battery.xt60', to: 'pixhawk.rc_in' }]);
  assert.equal(r.issues[0].code, 'CONNECTOR_MISMATCH');
});

test('方向或類型錯：兩個輸出接在一起', () => {
  const r = validateWiring([{ from: 'receiver.sbus', to: 'pixhawk.main_out_1' }]);
  assert.equal(r.issues[0].code, 'ROLE_MISMATCH');
});

test('極性錯：ESC 電源線紅黑接反', () => {
  const r = validateWiring([{ from: 'pdb.pad_fr', to: 'esc_fr.power', reversed: true }]);
  assert.equal(r.issues[0].code, 'POLARITY');
});

test('XT60 有防呆，不會判成極性錯', () => {
  const r = validateWiring([{ from: 'battery.xt60', to: 'power_module.in', reversed: true }]);
  assert.equal(r.correct.length, 1);
});

test('重複接線', () => {
  const r = validateWiring([{ from: 'receiver.sbus', to: 'pixhawk.rc_in' }, { from: 'pixhawk.rc_in', to: 'receiver.sbus' }]);
  assert.equal(r.issues[0].code, 'DUPLICATE');
});

test('同一個接口接兩條線', () => {
  const r = validateWiring([{ from: 'pdb.pad_fr', to: 'esc_fr.power' }, { from: 'pdb.pad_fr', to: 'esc_fl.power' }]);
  assert.ok(codes(r).includes('PORT_BUSY'));
});

test('未知接口與自己接自己', () => {
  assert.equal(validateWiring([{ from: 'pixhawk.can', to: 'gps.serial' }]).issues[0].code, 'UNKNOWN_PORT');
  assert.equal(validateWiring([{ from: 'pixhawk.gps', to: 'pixhawk.i2c' }]).issues[0].code, 'SELF_LOOP');
});
