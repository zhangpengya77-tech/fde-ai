// 組裝引擎單元測試（node --test）：依賴、位置校驗、撤銷重做、拆解、存檔恢復、資料完整性
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssemblyEngine, ERR, distanceMm } from '../core/assembly-engine.js';
import { F450_MODEL } from '../data/f450-pixhawk248.js';
import { saveLocal, loadLocal } from '../core/storage.js';

const fresh = (mode) => createAssemblyEngine(F450_MODEL, { mode, now: () => 1000 });

test('資料完整：零件 id 唯一、順序涵蓋全部零件、依賴都存在且順序合法', () => {
  const ids = F450_MODEL.parts.map((p) => p.partId);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...F450_MODEL.order].sort(), [...ids].sort());
  const seen = new Set();
  for (const id of F450_MODEL.order) {
    const p = F450_MODEL.parts.find((x) => x.partId === id);
    for (const d of p.dependsOn) assert.ok(seen.has(d), `${id} 依賴 ${d} 但順序在它前面`);
    seen.add(id);
  }
});

test('每個零件都有尺寸、安裝位置與來源狀態（沒核對的必須標待確認或 PENDING_MANUAL）', () => {
  for (const p of F450_MODEL.parts) {
    assert.ok(p.dimensionsMm && p.target && Array.isArray(p.target.pos), p.partId);
    assert.ok(['待確認', 'PENDING_MANUAL', 'PASS'].includes(p.source.status), p.partId);
  }
});

test('ArduPilot Quad X：M1 右前 CCW、M2 左後 CCW、M3 左前 CW、M4 右後 CW（機頭朝 −Z）', () => {
  const m = (n) => F450_MODEL.parts.find((p) => p.partId === `motor_m${n}`);
  const quad = (p) => `${p.target.pos[2] < 0 ? '前' : '後'}${p.target.pos[0] > 0 ? '右' : '左'}`;
  assert.deepEqual([1, 2, 3, 4].map((n) => [quad(m(n)), m(n).spin]), [['前右', 'CCW'], ['後左', 'CCW'], ['前左', 'CW'], ['後右', 'CW']]);
  for (const n of [1, 2, 3, 4]) {
    const prop = F450_MODEL.parts.find((p) => p.partId === `prop_m${n}`);
    assert.equal(prop.spin, m(n).spin, `M${n} 槳與電機旋向一致`);
  }
});

test('依賴：沒有下中心板不能裝機臂，並記錄錯誤', () => {
  const e = fresh();
  const r = e.install('arm_fr');
  assert.equal(r.ok, false);
  assert.equal(r.code, ERR.MISSING_DEPENDENCY);
  assert.deepEqual(r.missing, ['bottom_plate']);
  assert.equal(e.errors.length, 1);
});

test('上中心板要等上下板之間的零件都放好', () => {
  const e = fresh();
  for (const id of ['bottom_plate', 'arm_fr', 'arm_fl', 'arm_bl', 'arm_br']) assert.ok(e.install(id).ok);
  const r = e.install('top_plate');
  assert.equal(r.code, ERR.MISSING_DEPENDENCY);
  assert.deepEqual(r.missing.sort(), ['buzzer', 'power_module', 'receiver', 'telemetry']);
});

test('拖放位置：容許距離內算對，太遠記為位置錯誤', () => {
  const e = fresh();
  const target = F450_MODEL.parts[0].target.pos;
  const far = e.install('bottom_plate', [target[0] + 60, target[1], target[2]]);
  assert.equal(far.code, ERR.POSITION);
  assert.equal(e.errors.at(-1).detail.distance, 60);
  const near = e.install('bottom_plate', [target[0] + 10, target[1], target[2] - 5]);
  assert.ok(near.ok);
});

test('拆下：有零件裝在上面時不能先拆', () => {
  const e = fresh();
  e.install('bottom_plate');
  e.install('arm_fr');
  const r = e.uninstall('bottom_plate');
  assert.equal(r.code, ERR.HAS_DEPENDENTS);
  assert.deepEqual(r.blockers, ['arm_fr']);
  assert.ok(e.uninstall('arm_fr').ok);
  assert.ok(e.uninstall('bottom_plate').ok);
});

test('下一步安裝依學習順序，槳葉一定在最後', () => {
  const e = fresh();
  const seq = [];
  let r;
  while ((r = e.installNext()).ok) seq.push(r.partId);
  assert.deepEqual(seq, F450_MODEL.order);
  assert.deepEqual(seq.slice(-4), ['prop_m1', 'prop_m2', 'prop_m3', 'prop_m4']);
  assert.equal(e.installNext().code, 'DONE');
  assert.deepEqual(e.progress, { done: 27, total: 27 });
});

test('撤銷／重做：單步與整批拆解都能還原', () => {
  const e = fresh();
  e.install('bottom_plate');
  e.install('arm_fr');
  e.undo();
  assert.deepEqual(e.installed, ['bottom_plate']);
  e.redo();
  assert.deepEqual(e.installed, ['bottom_plate', 'arm_fr']);
  e.assembleAll();
  assert.equal(e.installed.length, 27);
  e.disassembleAll();
  assert.equal(e.installed.length, 0);
  e.undo();
  assert.equal(e.installed.length, 27);
  // 新動作會清掉重做紀錄
  e.undo();   // 撤銷「全部復原」，回到只有底座＋右前機臂
  assert.ok(e.canRedo);
  assert.ok(e.install('arm_fl').ok);
  assert.equal(e.canRedo, false);
});

test('存檔／恢復：被改壞的存檔不能造成違反依賴的狀態', () => {
  const a = fresh('exam');
  a.install('bottom_plate');
  a.install('arm_fr');
  a.install('motor_m1');
  a.install('top_plate');   // 會失敗並記錄錯誤
  const saved = a.serialize();
  assert.equal(saved.mode, 'exam');
  const b = fresh();
  b.restore(saved);
  assert.deepEqual(b.installed, ['bottom_plate', 'arm_fr', 'motor_m1']);
  assert.equal(b.errors.length, 1);
  assert.equal(b.mode, 'exam');
  const c = fresh();
  c.restore({ ...saved, installed: ['motor_m1', 'arm_fr'] });   // 沒有底座
  assert.deepEqual(c.installed, []);
  assert.throws(() => c.restore({ kind: 'other' }), /build_lab_bad_save/);
});

test('本機儲存：存取成功，儲存空間壞掉時不丟錯', () => {
  const mem = new Map();
  const store = { setItem: (k, v) => mem.set(k, v), getItem: (k) => mem.get(k) ?? null, removeItem: (k) => mem.delete(k) };
  assert.ok(saveLocal('f450-pixhawk248', { a: 1 }, store));
  assert.equal(loadLocal('f450-pixhawk248', store).a, 1);
  const broken = { setItem() { throw new Error('quota'); }, getItem() { throw new Error('denied'); } };
  assert.equal(saveLocal('x', {}, broken), false);
  assert.equal(loadLocal('x', broken), null);
});

test('distanceMm', () => {
  assert.equal(distanceMm([0, 0, 0], [3, 4, 0]), 5);
});

// 2026-11-19：俯視截圖發現飛控／GPS 箭頭指向機尾 → 用數學確認「平躺後箭頭尖端朝 −Z（機頭）」
test('箭頭方向：Shape 的 +Y 經繞 X 軸 −90° 後指向 −Z（機頭）', () => {
  const t = -Math.PI / 2;
  const [y, z] = [1, 0];
  const z2 = y * Math.sin(t) + z * Math.cos(t);
  assert.ok(z2 < 0);
});
