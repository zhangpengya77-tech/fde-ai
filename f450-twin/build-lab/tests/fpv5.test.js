// 5 吋 FPV（P3）單元測試：資料完整、Betaflight 編號與旋向、接線規則、錯誤案例、Betaflight 報告、機型註冊表
import test from 'node:test';
import assert from 'node:assert/strict';
import { FPV5_MODEL } from '../data/fpv5-225.js';
import { FPV5_WIRING, FPV5_EXTRA_POINTS, FPV5_FITS } from '../data/fpv5-wiring.js';
import { BETAFLIGHT_F7_3030_GENERIC } from '../data/boards/betaflight-f7-3030-generic.js';
import { F450_MODEL } from '../data/f450-pixhawk248.js';
import { evaluateStep, buildCatalog, CODES, SEVERITY, checkVoltage } from '../core/wiring-rules.js';
import { createWiringEngine, wiringPreconditions } from '../core/wiring-engine.js';
import { createAssemblyEngine } from '../core/assembly-engine.js';
import { buildFpv5ErrorCases } from '../core/fpv5-error-cases.js';
import { buildBetaflightReport, betaflightReportToText } from '../core/betaflight-report.js';
import { MODELS, pickModel, DEFAULT_MODEL } from '../data/models.js';

const catalog = buildCatalog(BETAFLIGHT_F7_3030_GENERIC, FPV5_EXTRA_POINTS);
const ctx = { catalog, fits: FPV5_FITS, occupied: new Set() };
const step = (id) => FPV5_WIRING.steps.find((s) => s.id === id);
const answer = (s) => (s.kind === 'polarity' ? { red: s.expect.red } : { target: s.expect });
const quad = (p) => `${p.target.pos[2] < 0 ? '前' : '後'}${p.target.pos[0] > 0 ? '右' : '左'}`;

test('資料完整：零件 id 唯一、順序合法、24 件', () => {
  const ids = FPV5_MODEL.parts.map((p) => p.partId);
  assert.equal(ids.length, 24);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...FPV5_MODEL.order].sort(), [...ids].sort());
  const seen = new Set();
  for (const id of FPV5_MODEL.order) {
    for (const d of FPV5_MODEL.parts.find((p) => p.partId === id).dependsOn) assert.ok(seen.has(d), `${id} 依賴 ${d}`);
    seen.add(id);
  }
});

test('Betaflight QUADX：M1 右後 CW、M2 右前 CCW、M3 左後 CCW、M4 左前 CW（槳向內）；與 ArduPilot 編號不同', () => {
  const m = (model, n) => model.parts.find((p) => p.partId === `motor_m${n}`);
  assert.deepEqual([1, 2, 3, 4].map((n) => [quad(m(FPV5_MODEL, n)), m(FPV5_MODEL, n).spin]), [['後右', 'CW'], ['前右', 'CCW'], ['後左', 'CCW'], ['前左', 'CW']]);
  assert.notEqual(quad(m(FPV5_MODEL, 1)), quad(m(F450_MODEL, 1)), 'BF 的 M1 與 ArduPilot 的 M1 不在同一角');
  for (const n of [1, 2, 3, 4]) assert.equal(FPV5_MODEL.parts.find((p) => p.partId === `prop_m${n}`).spin, m(FPV5_MODEL, n).spin);
});

test('接線：12 步、電池最後、每步正確答案為 OK、欄位齊全', () => {
  assert.equal(FPV5_WIRING.steps.length, 12);
  assert.equal(FPV5_WIRING.steps.at(-1).id, 'battery');
  const ant = FPV5_WIRING.steps.findIndex((s) => s.id === 'vtx-antenna');
  assert.ok(ant < FPV5_WIRING.steps.length - 1, '天線在接電池之前');
  for (const s of FPV5_WIRING.steps) {
    assert.equal(evaluateStep(s, answer(s), ctx).code, CODES.OK, s.id);
    for (const k of ['sourcePort', 'targetPort', 'sourcePin', 'targetPin', 'wireType', 'validationStatus']) assert.ok(s[k] !== undefined, `${s.id}.${k}`);
  }
});

test('規則：照 ArduPilot 編號焊為焊點錯誤、TX／RX 未交叉、電容反接、XT60 反接', () => {
  const ap = evaluateStep(step('motor2-phase'), { target: 'esc.m1' }, ctx);
  assert.equal(ap.code, CODES.MOTOR_MISMATCH);
  assert.match(ap.fixZh, /Betaflight/);
  assert.equal(evaluateStep(step('rx-uart'), { red: 'fc.uart2.tx' }, ctx).code, CODES.TX_RX_SWAPPED);
  assert.equal(evaluateStep(step('rx-uart'), { red: 'fc.uart1.rx' }, ctx).code, CODES.WRONG_PAD);
  const cap = evaluateStep(step('capacitor'), { red: 'esc.bat-' }, ctx);
  assert.equal(cap.code, CODES.REVERSED_POLARITY);
  assert.match(cap.messageZh, /電容/);
  assert.equal(evaluateStep(step('xt60-solder'), { red: 'esc.bat-' }, ctx).severity, SEVERITY.danger);
  assert.equal(evaluateStep(step('vtx-fc'), { target: 'fc.esc8' }, ctx).code, CODES.NO_FIT);
});

test('電壓檢查：超過最高串數為嚴重危險、低於最低為錯誤、範圍內 OK', () => {
  const parts = [{ nameZh: '電調', minCells: 3, maxCells: 6 }, { nameZh: '圖傳', minCells: 2, maxCells: 4 }];
  assert.equal(checkVoltage(6, parts).severity, SEVERITY.critical);
  assert.equal(checkVoltage(2, parts).severity, SEVERITY.warn);
  assert.ok(checkVoltage(4, parts).ok);
});

test('接線引擎：全部接完通過整機檢查；缺天線會被整機檢查抓到', () => {
  const w = createWiringEngine(FPV5_WIRING, BETAFLIGHT_F7_3030_GENERIC, FPV5_EXTRA_POINTS, FPV5_FITS, { now: () => 0 });
  for (const s of FPV5_WIRING.steps) assert.ok(w.attempt(answer(s)).ok, s.id);
  assert.ok(w.complete);
  assert.deepEqual(w.systemIssues(), []);
});

test('進入接線條件：拆槳才能接線', () => {
  const a = createAssemblyEngine(FPV5_MODEL, { now: () => 0 });
  a.assembleAll();
  assert.equal(wiringPreconditions(a).propsOn.length, 4);
  for (const n of [1, 2, 3, 4]) assert.ok(a.uninstall(`prop_m${n}`).ok);
  assert.ok(wiringPreconditions(a).ok);
});

test('錯誤案例：8 個都被規則判為錯誤，附後果與正確做法', () => {
  const cases = buildFpv5ErrorCases(FPV5_WIRING, BETAFLIGHT_F7_3030_GENERIC, FPV5_EXTRA_POINTS, FPV5_FITS);
  assert.equal(cases.length, 8);
  for (const c of cases) {
    const r = c.run();
    assert.equal(r.ok, false, c.id);
    assert.ok(r.messageZh && r.fixZh && c.effectZh, c.id);
  }
  assert.equal(cases.find((c) => c.id === 'antenna-missing').run().code, CODES.ANTENNA_MISSING);
});

test('Betaflight 報告：QUADX、槳向內（yaw_motors_reversed OFF）、CRSF、不寫入飛控', () => {
  const r = buildBetaflightReport({ connections: FPV5_WIRING.steps.map((s) => s.id) });
  const get = (n) => r.rows.find((x) => x.name === n).value;
  assert.equal(r.writesToVehicle, false);
  assert.equal(get('Mixer（機型）'), 'QUADX');
  assert.equal(get('yaw_motors_reversed'), 'OFF');
  assert.equal(get('serialrx_provider'), 'CRSF');
  assert.ok(r.rows.every((x) => x.source.status === 'PENDING_MANUAL'));
  assert.match(betaflightReportToText(r), /不可直接貼進飛控 CLI/);
});

test('機型註冊表：兩個機型都完整；網址參數選機型，未知值退回預設', () => {
  for (const [id, cfg] of Object.entries(MODELS)) {
    assert.equal(cfg.model.modelId, id);
    assert.equal(cfg.wiring.modelId, id);
    assert.ok(cfg.buildCases().length >= 8);
  }
  assert.equal(pickModel('?model=fpv5-225'), 'fpv5-225');
  assert.equal(pickModel('?model=xxx'), DEFAULT_MODEL);
  assert.equal(pickModel(''), DEFAULT_MODEL);
});
