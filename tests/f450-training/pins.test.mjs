// F450 引腳級接線規則的單元測試（node --test tests/f450-training/pins.test.mjs）
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPECTED_WIRES } from '../../f450-twin/training/model.js';
import { ALL_PINS, EXPECTED_PIN_WIRES, PIN_WIRE_TOTAL, pinId, validatePinWiring } from '../../f450-twin/training/pins.js';

// 依計畫產生全部正確的引腳線（三相用 A→A、B→B、C→C）
const perfect = () => EXPECTED_PIN_WIRES.map((e, i) => ({ id: `p${i}`, a: e.a, b: e.phase ? e.b.replace('#null', `#${e.a.split('#')[1]}`) : e.b }));
const codes = (r) => r.issues.map((i) => i.code);

test('引腳級正確接線共 54 根，每根兩端的引腳都存在', () => {
  assert.equal(PIN_WIRE_TOTAL, 54);
  for (const w of perfect()) { assert.ok(ALL_PINS[w.a], w.a); assert.ok(ALL_PINS[w.b], w.b); }
});

test('全部接對：沒有問題，換算出 20 條接頭級連線', () => {
  const r = validatePinWiring(perfect());
  assert.deepEqual(r.issues, []);
  assert.equal(r.links.length, EXPECTED_WIRES.length);
  assert.equal(r.complete, true);
});

test('GPS：TX 接 TX（沒交叉）會被抓到', () => {
  const ws = perfect().filter((w) => !w.a.startsWith('gps.serial#tx') && !w.a.startsWith('gps.serial#rx'));
  ws.push({ id: 'bad', a: pinId('gps.serial', 'tx'), b: pinId('pixhawk.gps', '2') });
  const r = validatePinWiring(ws);
  assert.ok(codes(r).includes('TX_NOT_CROSSED'));
  assert.ok(!r.links.some((l) => l.from === 'gps.serial'));          // 這條連線不算完成
});

test('GPS：TX→RX、RX→TX 交叉才算對', () => {
  const r = validatePinWiring([
    { a: pinId('gps.serial', 'vcc'), b: pinId('pixhawk.gps', '1') }, { a: pinId('gps.serial', 'tx'), b: pinId('pixhawk.gps', '3') },
    { a: pinId('gps.serial', 'rx'), b: pinId('pixhawk.gps', '2') }, { a: pinId('gps.serial', 'gnd'), b: pinId('pixhawk.gps', '6') },
  ]);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.links.map((l) => l.from), ['gps.serial']);
});

test('5V 接到 GND＝短路', () => {
  const r = validatePinWiring([{ a: pinId('power_module.fc', '1'), b: pinId('pixhawk.power', '5') }]);
  assert.equal(r.issues[0].code, 'SHORT');
});

test('電調紅線接到排針＋：警告不要接', () => {
  const r = validatePinWiring([{ a: pinId('esc_fr.signal', '+'), b: pinId('pixhawk.main_out_1', '+') }]);
  assert.equal(r.issues[0].code, 'ESC_RED_ON_RAIL');
});

test('GPS 的 CAN2 腳這台不用接', () => {
  const r = validatePinWiring([{ a: pinId('gps.serial', 'tx'), b: pinId('pixhawk.gps', '4') }]);
  assert.equal(r.issues[0].code, 'UNUSED_PIN');
});

test('只接訊號、漏接地線：該條連線缺線、不算完成', () => {
  const r = validatePinWiring([{ a: pinId('esc_fr.signal', 's'), b: pinId('pixhawk.main_out_1', 's') }]);
  assert.ok(codes(r).includes('PIN_MISSING'));
  assert.equal(r.links.length, 0);
});

test('電調訊號接錯 MAIN OUT（右前接到 2）＝接錯腳', () => {
  const r = validatePinWiring([{ a: pinId('esc_fr.signal', 's'), b: pinId('pixhawk.main_out_2', 's') }]);
  assert.equal(r.issues[0].code, 'PIN_WRONG');
});

test('三相線任意順序都算對（換兩根＝轉向相反，不是接錯）', () => {
  const r = validatePinWiring([
    { a: pinId('esc_fr.phase', 'a'), b: pinId('motor_fr.phase', 'b') }, { a: pinId('esc_fr.phase', 'b'), b: pinId('motor_fr.phase', 'a') },
    { a: pinId('esc_fr.phase', 'c'), b: pinId('motor_fr.phase', 'c') },
  ]);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.links.map((l) => l.from), ['esc_fr.phase']);
});

test('三相線接到別顆馬達＝接錯腳', () => {
  const r = validatePinWiring([{ a: pinId('esc_fr.phase', 'a'), b: pinId('motor_fl.phase', 'a') }]);
  assert.equal(r.issues[0].code, 'PIN_WRONG');
});

test('R9DS（CH9 SBUS）S／＋／− 對 RC IN S／＋／−', () => {
  const r = validatePinWiring(['s', '+', '-'].map((x) => ({ a: pinId('receiver.sbus', x), b: pinId('pixhawk.rc_in', x) })));
  assert.deepEqual(r.issues, []);
  assert.equal(r.links[0].to, 'pixhawk.rc_in');
});

test('同一腳接兩根、重複接線、未知引腳', () => {
  assert.ok(codes(validatePinWiring([{ a: pinId('buzzer.conn', '+'), b: pinId('pixhawk.buzzer', '1') }, { a: pinId('buzzer.conn', '+'), b: pinId('pixhawk.switch', '2') }])).includes('PIN_BUSY'));
  assert.equal(validatePinWiring([{ a: pinId('buzzer.conn', '+'), b: pinId('pixhawk.buzzer', '1') }, { a: pinId('pixhawk.buzzer', '1'), b: pinId('buzzer.conn', '+') }]).issues[0].code, 'DUPLICATE');
  assert.equal(validatePinWiring([{ a: 'x#1', b: pinId('pixhawk.buzzer', '1') }]).issues[0].code, 'UNKNOWN_PIN');
});
