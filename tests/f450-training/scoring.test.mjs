// F450 實訓判分的單元測試（node --test tests/f450-training/scoring.test.mjs）
import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSEMBLY, EXPECTED_WIRES, createAssemblyState, install, pick, rotate } from '../../f450-twin/training/model.js';
import { CATEGORIES, scoreSession } from '../../f450-twin/training/scoring.js';

const perfectWires = () => EXPECTED_WIRES.map((w, i) => ({ id: `w${i}`, from: w.from, to: w.to }));
function assembled({ skip = [] } = {}) {
  const s = createAssemblyState();
  for (const a of [...ASSEMBLY].sort((x, y) => x.step - y.step)) {
    if (skip.includes(a.id)) continue;
    pick(s, a.id); if (a.orient) rotate(s, a.id, 180); install(s, a.id, a.id);
  }
  return s;
}
const cat = (r, id) => r.categories.find((c) => c.id === id);

test('配分加起來是 100', () => {
  assert.equal(CATEGORIES.reduce((s, c) => s + c.max, 0), 100);
});

test('全部正確：100 分，每項滿分', () => {
  const r = scoreSession(assembled(), perfectWires());
  assert.equal(r.total, 100);
  for (const c of r.categories) assert.equal(c.score, c.max, c.zh);
  assert.equal(r.assemblyDone, true);
  assert.equal(r.wiringDone, true);
  assert.equal(r.practiceOnly, true);
});

test('什麼都沒做：0 分（安全分不白送）', () => {
  const r = scoreSession(createAssemblyState(), []);
  assert.equal(r.total, 0);
});

test('只做完組裝、沒接線：機架滿分、電源與訊號 0', () => {
  const r = scoreSession(assembled(), []);
  assert.equal(cat(r, 'frame').score, 20);
  assert.equal(cat(r, 'power_signal').score, 0);
  assert.equal(cat(r, 'motor_esc').score, 10);   // 組裝 10，ESC 訊號順序 10 沒拿到
  assert.equal(cat(r, 'safety').score, 9);        // 安全分隨完成度：30 件／50 項 × 15
});

test('ESC 訊號線接錯一條：馬達與 ESC 扣 2.5 分，電源與訊號再扣 2 分（接錯）＋1 分（接口重複）', () => {
  const ws = perfectWires().filter((w) => w.from !== 'esc_fr.signal');
  ws.push({ id: 'bad', from: 'esc_fr.signal', to: 'pixhawk.main_out_3' });   // MAIN OUT 3 已被左前占用
  const r = scoreSession(assembled(), ws);
  assert.equal(cat(r, 'motor_esc').score, 17.5);
  assert.deepEqual(cat(r, 'power_signal').deductions.map((d) => d.code).sort(), ['PORT_BUSY', 'WRONG_CONNECTION']);
  assert.equal(cat(r, 'power_signal').score, 27);
  assert.equal(cat(r, 'safety').score, 14.7);   // 完成度 49／50（錯的那條不算完成）
  assert.equal(r.total, 94);   // 20＋17.5＋15＋27＋14.7 = 94.2
});

test('紅黑接反：安全扣 5 分', () => {
  const ws = perfectWires().map((w) => (w.from === 'pdb.pad_fr' ? { ...w, reversed: true } : w));
  const r = scoreSession(assembled(), ws);
  assert.equal(cat(r, 'safety').score, 9.7);   // 完成度 49／50 → 14.7，再扣 5
  assert.equal(cat(r, 'safety').deductions[0].code, 'POLARITY');
});

test('方向錯一次（後來轉正）：飛控扣 2 分；順序錯一次：機架扣 1 分', () => {
  const s = createAssemblyState();
  pick(s, 'arm_fr');                                       // 順序錯
  for (const a of [...ASSEMBLY].sort((x, y) => x.step - y.step)) {
    pick(s, a.id);
    if (a.id === 'pixhawk') { install(s, a.id, a.id); rotate(s, a.id, 180); continue; }   // 先裝反再轉正
    if (a.orient) rotate(s, a.id, 180);
    install(s, a.id, a.id);
  }
  const r = scoreSession(s, perfectWires());
  assert.equal(cat(r, 'fc').score, 13);
  assert.equal(cat(r, 'frame').score, 19);
  assert.equal(r.total, 97);
});

test('太早拿槳、槳轉向裝錯：扣在安全分', () => {
  const s = assembled({ skip: ['battery', 'prop_fr', 'prop_fl', 'prop_rl', 'prop_rr'] });
  pick(s, 'prop_fr');                                      // 電池還沒裝 → 順序錯（槳）
  pick(s, 'battery'); install(s, 'battery', 'battery');
  pick(s, 'prop_fr'); install(s, 'prop_fr', 'prop_fl');    // 轉向錯
  install(s, 'prop_fr', 'prop_fr');
  for (const id of ['prop_fl', 'prop_rl', 'prop_rr']) { pick(s, id); install(s, id, id); }
  const r = scoreSession(s, perfectWires());
  assert.deepEqual(cat(r, 'safety').deductions.map((d) => d.code).sort(), ['ORDER_PROP', 'WRONG_SPIN']);
  assert.equal(cat(r, 'safety').score, 7);
  assert.equal(cat(r, 'frame').score, 20);                // 槳的順序錯不重複扣機架分
});

test('只做一點點，安全分只拿一點點', () => {
  const s = createAssemblyState(); pick(s, 'bottom_plate'); install(s, 'bottom_plate', 'bottom_plate');
  const r = scoreSession(s, [{ from: 'battery.xt60', to: 'power_module.in' }]);
  assert.equal(cat(r, 'safety').score, 0.6);      // 2／50 × 15
  assert.ok(r.total < 6, String(r.total));
});

test('扣分不會讓單項變負數', () => {
  const ws = perfectWires().map((w) => (w.from.startsWith('pdb.pad') ? { ...w, reversed: true } : w));   // 4 條紅黑接反＝扣 20
  const r = scoreSession(assembled(), ws);
  assert.equal(cat(r, 'safety').score, 0);
});

test('每一筆扣分都附原因', () => {
  const r = scoreSession(createAssemblyState(), [{ from: 'battery.xt60', to: 'pixhawk.rc_in' }]);
  const all = r.categories.flatMap((c) => c.deductions);
  assert.ok(all.length > 0);
  assert.ok(all.every((d) => d.reason && d.detail && d.pts > 0));
});
