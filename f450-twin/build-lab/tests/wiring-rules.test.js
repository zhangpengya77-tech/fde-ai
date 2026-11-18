// 接線規則與接線引擎單元測試（node --test）
import test from 'node:test';
import assert from 'node:assert/strict';
import { F450_MODEL } from '../data/f450-pixhawk248.js';
import { F450_WIRING, EXTRA_POINTS, CONNECTOR_FITS } from '../data/f450-wiring.js';
import { PIXHAWK_248_GENERIC } from '../data/boards/pixhawk-248-generic.js';
import { evaluateStep, buildCatalog, CODES, SEVERITY, checkOrientation, checkProp } from '../core/wiring-rules.js';
import { createWiringEngine, wiringPreconditions } from '../core/wiring-engine.js';
import { createAssemblyEngine } from '../core/assembly-engine.js';
import { buildErrorCases } from '../core/error-cases.js';
import { buildParamsReport, reportToText } from '../core/params-report.js';

const catalog = buildCatalog(PIXHAWK_248_GENERIC, EXTRA_POINTS);
const ctx = { catalog, fits: CONNECTOR_FITS, occupied: new Set() };
const step = (id) => F450_WIRING.steps.find((s) => s.id === id);
const newWiring = () => createWiringEngine(F450_WIRING, PIXHAWK_248_GENERIC, EXTRA_POINTS, CONNECTOR_FITS, { now: () => 0 });
/** 正確答案 */
const answer = (s) => (s.kind === 'polarity' ? { red: s.expect.red } : { target: s.expect });

test('資料完整：21 步、每步的正確接點都在目錄中、欄位齊全、狀態為 PENDING_MANUAL', () => {
  assert.equal(F450_WIRING.steps.length, 21);
  for (const s of F450_WIRING.steps) {
    for (const k of ['sourcePort', 'targetPort', 'sourcePin', 'targetPin', 'wireType', 'validationStatus']) assert.ok(s[k] !== undefined, `${s.id}.${k}`);
    assert.equal(s.validationStatus, 'PENDING_MANUAL');
    if (s.kind === 'polarity') { assert.ok(catalog[s.expect.red]); assert.ok(catalog[s.expect.black]); } else assert.ok(catalog[s.expect], s.id);
  }
  assert.equal(F450_WIRING.steps.at(-1).id, 'battery', '電池一定最後接');
});

test('每一步的正確答案都判為 OK', () => {
  for (const s of F450_WIRING.steps) assert.equal(evaluateStep(s, answer(s), ctx).code, CODES.OK, s.id);
});

test('ESC 訊號依 ArduPilot：n 號電調接 MAIN OUT n；接錯為危險的順序錯誤', () => {
  for (const n of [1, 2, 3, 4]) assert.equal(step(`esc${n}-signal`).expect, `fc.main${n}`);
  const r = evaluateStep(step('esc1-signal'), { target: 'fc.main3' }, ctx);
  assert.equal(r.code, CODES.ESC_ORDER);
  assert.equal(r.severity, SEVERITY.danger);
});

test('極性反接為危險錯誤；焊到別組焊盤為一般錯誤', () => {
  assert.equal(evaluateStep(step('esc1-power'), { red: 'pdb.fr-' }, ctx).code, CODES.REVERSED_POLARITY);
  assert.equal(evaluateStep(step('esc1-power'), { red: 'pdb.bl+' }, ctx).code, CODES.WRONG_PAD);
});

test('主電池直接接飛控 POWER 為嚴重危險', () => {
  const r = evaluateStep(step('battery'), { target: 'fc.power' }, ctx);
  assert.equal(r.code, CODES.BATTERY_TO_FC);
  assert.equal(r.severity, SEVERITY.critical);
});

test('介面類型：GPS 插 TELEM 為用途錯誤、插 I2C 插不進去；接收機插 MAIN OUT 為訊號類型錯誤', () => {
  assert.equal(evaluateStep(step('gps-uart'), { target: 'fc.telem1' }, ctx).code, CODES.UART_WRONG_PORT);
  assert.equal(evaluateStep(step('gps-uart'), { target: 'fc.i2c' }, ctx).code, CODES.NO_FIT);
  assert.equal(evaluateStep(step('rx-rcin'), { target: 'fc.main5' }, ctx).code, CODES.SIGNAL_MISMATCH);
  assert.equal(evaluateStep(step('telem'), { target: 'fc.gps' }, ctx).code, CODES.UART_WRONG_PORT);
});

test('三相接錯電機為焊點錯誤；接口重複使用會被擋下', () => {
  assert.equal(evaluateStep(step('esc1-phase'), { target: 'motor.m2' }, ctx).code, CODES.MOTOR_MISMATCH);
  const busy = { ...ctx, occupied: new Set(['fc.telem1']) };
  assert.equal(evaluateStep(step('gps-uart'), { target: 'fc.telem1' }, busy).code, CODES.OCCUPIED);
});

test('飛控方向與槳葉旋向', () => {
  assert.ok(checkOrientation(0, 0).ok);
  assert.equal(checkOrientation(180, 0).code, CODES.FC_ORIENTATION);
  assert.ok(checkOrientation(180, 4).ok);
  assert.ok(checkProp('CW', 'CW').ok);
  assert.equal(checkProp('CCW', 'CW').code, CODES.PROP_REVERSED);
});

test('接線引擎：錯誤不會接上且被記錄；全部正確可完成；撤銷；存檔竄改會被擋', () => {
  const w = newWiring();
  assert.equal(w.attempt({ red: 'pdb.fr-' }).code, CODES.REVERSED_POLARITY);
  assert.equal(w.progress.done, 0);
  assert.equal(w.errors.length, 1);
  for (const s of F450_WIRING.steps) assert.ok(w.attempt(answer(s)).ok, s.id);
  assert.ok(w.complete);
  assert.deepEqual(w.systemIssues(), []);
  w.undo();
  assert.equal(w.progress.done, 20);
  const saved = w.serialize();
  const w2 = newWiring();
  saved.done[3].choice = { red: 'pdb.br-' };   // 竄改第 4 步為反接
  w2.restore(saved);
  assert.equal(w2.progress.done, 3);
  assert.equal(w2.errors.length, 1);
});

test('進入接線的條件：其他零件裝好、槳葉全部拆下', () => {
  const a = createAssemblyEngine(F450_MODEL, { now: () => 0 });
  assert.equal(wiringPreconditions(a).ok, false);
  a.assembleAll();
  const withProps = wiringPreconditions(a);
  assert.equal(withProps.ok, false);
  assert.equal(withProps.propsOn.length, 4);
  for (const n of [1, 2, 3, 4]) a.uninstall(`prop_m${n}`);
  assert.ok(wiringPreconditions(a).ok);
});

test('錯誤案例：8 個案例都被規則引擎識別為錯誤，且附後果與正確做法', () => {
  const cases = buildErrorCases(F450_WIRING, PIXHAWK_248_GENERIC, EXTRA_POINTS, CONNECTOR_FITS);
  assert.equal(cases.length, 8);
  for (const c of cases) {
    const r = c.run();
    assert.equal(r.ok, false, c.id);
    assert.ok(r.messageZh && r.fixZh && c.effectZh, c.id);
  }
});

test('參數報告：依 Copter-4.6.3 名稱、標示不寫入飛控；接線不完整時電池監測為 0', () => {
  const full = buildParamsReport({ connections: F450_WIRING.steps.map((s) => s.id) });
  const get = (r, n) => r.rows.find((x) => x.name === n).value;
  assert.equal(full.writesToVehicle, false);
  assert.equal(get(full, 'FRAME_CLASS'), 1);
  assert.equal(get(full, 'FRAME_TYPE'), 1);
  assert.equal(get(full, 'BATT_MONITOR'), 4);
  assert.equal(get(full, 'GPS1_TYPE'), 1);
  assert.ok(full.rows.every((r) => r.source.status === 'PENDING_MANUAL'));
  assert.equal(get(buildParamsReport({ connections: [] }), 'BATT_MONITOR'), 0);
  assert.match(reportToText(full), /不可直接寫入真實飛控/);
});
