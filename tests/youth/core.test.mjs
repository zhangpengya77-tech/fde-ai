// 青少年實驗室：核心模組單元測試（node --test tests/youth/*.test.mjs）
import test from 'node:test';
import assert from 'node:assert/strict';

// 瀏覽器 localStorage 替身（測試用）
const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };

const P = await import('../../live/youth/core/physics.js');
const S = await import('../../live/youth/core/store.js');
const A = await import('../../live/youth/core/assistant.js');
const I = await import('../../live/youth/core/input.js');
const { UNITS, LABS } = await import('../../live/youth/data/units.js');

test('電池：串聯電壓相加、並聯容量相加、能量 Wh', () => {
  const r = P.batteryPack({ s: 4, p: 2, cellV: 3.7, cellMah: 2200 });
  assert.equal(r.voltage, 14.8); assert.equal(r.capacityMah, 4400); assert.equal(r.energyWh, 65.1); assert.equal(r.label, '4S2P'); assert.equal(r.cells, 8);
  assert.equal(P.batteryPack({ s: 6, cellV: 4.2 }).voltage, 25.2);
  assert.equal(P.batteryPack({ s: 3, cellV: 4.34 }).state, 'over');
  assert.equal(P.batteryPack({ s: 3, cellV: 3.1 }).state, 'under');
  assert.equal(P.batteryPack({ s: 3, cellV: 3.7 }).state, 'ok');
  assert.equal(P.batteryPack({ s: 99 }).s, 12, 'S 數有上限');
});

test('換相：六步、每步 60° 電角度、14 極機械角', () => {
  assert.equal(P.COMMUTATION.length, 6);
  P.COMMUTATION.forEach(c => { const v = [c.A, c.B, c.C]; assert.equal(v.filter(x => x === '+').length, 1); assert.equal(v.filter(x => x === '-').length, 1); });
  assert.equal(P.fieldAngle(3), 180); assert.equal(P.fieldAngle(7), 60);
  assert.ok(Math.abs(P.mechanicalAngle(60) - 60 / 7) < 1e-9);
});

test('死區與夾限', () => {
  assert.equal(P.deadzone(0.05, 0.08), 0);
  assert.equal(P.deadzone(1, 0.08), 1);
  assert.ok(P.deadzone(-0.5, 0.1) < 0);
});

test('足球機：油門上升、邊界、緊急停止下降', () => {
  let s = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, armed: true };
  for (let i = 0; i < 120; i++) s = P.stepDrone(s, { throttle: 1, yaw: 0, pitch: 0, roll: 0 }, 1 / 60);
  assert.ok(s.y > 1, `應上升，實際 ${s.y}`);
  for (let i = 0; i < 600; i++) s = P.stepDrone(s, { throttle: 0, yaw: 0, pitch: 1, roll: 0 }, 1 / 60);
  assert.ok(Math.abs(s.z) <= 5 + 1e-9, '不可飛出網籠');
  assert.ok(s.z < 0, 'yaw=0 時前進是 -z 方向');
  s.armed = false; const y0 = s.y;
  for (let i = 0; i < 30; i++) s = P.stepDrone(s, { throttle: 1, yaw: 0, pitch: 0, roll: 0 }, 1 / 60);
  assert.ok(s.y < y0, '緊急停止後不可再上升');
});

test('穿門判定：穿過圓環內才算', () => {
  const ring = { x: 8, y: 2, z: 0, r: 0.65 };
  assert.equal(P.passedRing({ x: 7.9, y: 2, z: 0 }, { x: 8.1, y: 2, z: 0.2 }, ring), true);
  assert.equal(P.passedRing({ x: 7.9, y: 3, z: 0 }, { x: 8.1, y: 3, z: 0 }, ring), false, '從圓環上方飛過不算');
  assert.equal(P.passedRing({ x: 7.0, y: 2, z: 0 }, { x: 7.5, y: 2, z: 0 }, ring), false, '沒穿過平面不算');
});

test('自穩 PD：開啟後收斂、關閉不收斂', () => {
  let a = 0.4, r = 0;
  for (let i = 0; i < 600; i++) ({ angle: a, rate: r } = P.stabilize(a, r, 1 / 60, true));
  assert.ok(Math.abs(a) < 0.02);
  let b = 0.4, rb = 0; for (let i = 0; i < 60; i++) ({ angle: b, rate: rb } = P.stabilize(b, rb, 1 / 60, false));
  assert.equal(b, 0.4);
});

test('教材完整性：12 單元，每單元 4 段講解、≥3 題、答案合法、有實驗與互動', async () => {
  const { WIDGET_NAMES } = await import('../../live/youth/widgets.js');
  assert.equal(UNITS.length, 12);
  const ids = new Set();
  for (const u of UNITS) {
    ids.add(u.id);
    assert.equal(u.sections.length, 4, `${u.code} 講解段數`);
    u.sections.forEach(s => { assert.ok(s.h && s.p.length >= 40, `${u.code}「${s.h}」內容太短`); assert.ok(!/待補|TODO|佔位|lorem/i.test(s.p)); });
    assert.ok(u.quiz.length >= 3, `${u.code} 題數`);
    u.quiz.forEach(q => { assert.ok(q.answer >= 0 && q.answer < q.options.length); assert.ok(q.explain); });
    assert.ok(WIDGET_NAMES.includes(u.widget), `${u.code} 互動元件 ${u.widget} 不存在`);
    assert.ok(['soccer', 'coding', 'project'].includes(u.lab) || LABS.find(l => l.id === u.lab), `${u.code} 實驗 ${u.lab}`);
    assert.ok(u.task && u.goal);
  }
  assert.equal(ids.size, 12);
  assert.equal(LABS.length, 6);
});

test('學習紀錄：最小化個資、進度、測驗、匯出', () => {
  mem.clear(); S._reset();
  assert.throws(() => S.login('', 'A1'));
  const m = S.login('小鷹<script>', 'fde-a1');
  assert.equal(m.nick, '小鷹script', '移除特殊字元');
  assert.equal(m.cls, 'FDE-A1');
  S.markStep(1, 'read'); S.markStep(1, 'widget'); S.markStep(1, 'read');
  assert.equal(S.unitProgress(1).done, 2);
  assert.equal(S.saveQuiz(1, 2, 3, [2]), 67);
  assert.equal(S.unitProgress(1).done, 3, '及格才算測驗步驟');
  assert.equal(S.saveQuiz(2, 1, 3, [0, 1]), 33);
  assert.equal(S.unitProgress(2).done, 0, '不及格不算');
  S.saveLab('battery', { completed: true });
  S.saveSoccer({ mode: 'ring', ok: true, seconds: 12 });
  const rep = S.exportReport();
  assert.equal(rep.format, 'fde-youth-report');
  assert.deepEqual(Object.keys(rep).sort(), ['cls', 'exported', 'format', 'labs', 'nick', 'projects', 'soccer', 'units', 'version'].sort());
  // 同裝置換另一位學員：看不到前一位的紀錄
  S.login('小魚', 'FDE-A1');
  assert.equal(S.unitProgress(1).done, 0, '不同學員資料互相隔離');
});

test('教師端：只能匯入已建立班級、班級篩選阻擋跨班', () => {
  mem.clear(); S._reset();
  S.login('阿明', 'B2'); const rep = S.exportReport();
  assert.throws(() => S.teacherImport(rep), /尚未建立班級/);
  S.teacherCreateClass('A1', '甲班'); S.teacherCreateClass('B2', '乙班');
  assert.throws(() => S.teacherImport(rep, 'A1'), /不是目前選擇/);
  assert.deepEqual(S.teacherImport(rep, 'B2'), { cls: 'B2', nick: '阿明' });
  assert.equal(Object.keys(S.teacherData().classes.A1.students).length, 0, '甲班不應看到乙班學生');
  assert.throws(() => S.teacherImport({ format: 'x' }), /格式/);
});

test('規則式助教：命中、未命中不編造、錯題建議', () => {
  const r = A.ask('什麼是 Yaw？'); assert.ok(r.matched); assert.equal(r.unit, 3);
  assert.ok(A.ask('3S 是幾伏').answer.includes('11.1'));
  const n = A.ask('今天晚餐吃什麼'); assert.equal(n.matched, false); assert.ok(n.answer.includes('問老師'));
  assert.ok(A.reviewAdvice(UNITS[0], [0, 1]).includes('重讀'));
  assert.ok(A.reviewAdvice(UNITS[0], []).includes('全部答對'));
});

test('遙控器軸讀值：校準、反向、死區', () => {
  const ch = { axis: 1, invert: true };
  assert.equal(I.readAxis(-1, ch, null, 0.08), 1, '推到頂（-1）反向後為 +1');
  assert.equal(I.readAxis(0.03, ch, null, 0.08), 0, '死區內為 0');
  const cal = { 1: { min: -0.8, max: 0.9, center: 0.1 } };
  assert.equal(I.readAxis(0.9, { axis: 1, invert: false }, cal, 0), 1, '校準後滿行程為 1');
  assert.equal(I.readAxis(0.1, { axis: 1, invert: false }, cal, 0), 0, '校準中心為 0');
});
