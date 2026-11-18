// P4 單元測試：計分、本機紀錄與 CSV、AI 提問內容與失敗退回
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeScore } from '../core/scoring.js';
import { SCORING_RULES } from '../data/scoring-rules.js';
import { addRecord, listRecords, clearRecords, recordsToCsv } from '../core/records.js';
import { partQuestion, wiringErrorQuestion, askAI } from '../core/ai-explain.js';

const done = { assemblyComplete: true, wiringComplete: true };

test('計分：沒有錯誤 100 分及格；依錯誤代碼與嚴重度扣分', () => {
  const perfect = computeScore({ ...done, assemblyErrors: [], wiringErrors: [] }, SCORING_RULES);
  assert.equal(perfect.score, 100);
  assert.equal(perfect.pass, true);
  const r = computeScore({
    ...done,
    assemblyErrors: [{ code: 'MISSING_DEPENDENCY' }, { code: 'POSITION' }],
    wiringErrors: [{ severity: 'warn' }, { severity: 'danger' }],
  }, SCORING_RULES);
  assert.equal(r.score, 100 - 2 - 1 - 3 - 8);
  assert.equal(r.breakdown.length, 4);
  assert.equal(r.review.status, 'PENDING_TEACHER');
});

test('計分：嚴重危險一律不及格；未完成不及格；分數不低於 0', () => {
  const crit = computeScore({ ...done, assemblyErrors: [], wiringErrors: [{ severity: 'critical' }] }, SCORING_RULES);
  assert.equal(crit.score, 85);
  assert.equal(crit.pass, false);
  assert.match(crit.reasonZh, /嚴重危險/);
  assert.equal(computeScore({ assemblyComplete: true, wiringComplete: false, assemblyErrors: [], wiringErrors: [] }, SCORING_RULES).pass, false);
  const many = computeScore({ ...done, assemblyErrors: [], wiringErrors: Array(20).fill({ severity: 'danger' }) }, SCORING_RULES);
  assert.equal(many.score, 0);
});

test('本機紀錄：新增、列出、清除；壞掉的儲存空間不丟錯', () => {
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.ok(addRecord({ score: 90 }, store));
  assert.ok(addRecord({ score: 70 }, store));
  assert.deepEqual(listRecords(store).map((r) => r.score), [90, 70]);
  clearRecords(store);
  assert.deepEqual(listRecords(store), []);
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() {} };
  assert.deepEqual(listRecords(broken), []);
  assert.equal(addRecord({}, broken), false);
});

test('CSV：有 BOM、引號跳脫、防止試算表公式注入', () => {
  const csv = recordsToCsv([{ finishedAt: '2026-11-19', modelNameZh: 'F450, "測試"', modeZh: '=考試', score: 90, pass: true, assemblyErrors: 0, wiringErrors: 1, elapsedMs: 61000, rulesVersion: 'v1', reviewStatus: 'PENDING_TEACHER' }]);
  assert.ok(csv.startsWith('﻿完成時間'));
  assert.match(csv, /"F450, ""測試"""/);
  assert.match(csv, /'=考試/);
  assert.match(csv, /,61,/);
});

test('AI 提問：只含零件與步驟資訊、要求不改變判定、不含個資欄位', () => {
  const q1 = partQuestion('F450', { nameZh: '電源模組', model: '通用' });
  assert.match(q1, /電源模組/);
  assert.match(q1, /不要評分/);
  const q2 = wiringErrorQuestion('F450', { titleZh: '接 GPS' }, { code: 'UART_WRONG_PORT', messageZh: '插錯口', fixZh: '接 GPS 口' });
  assert.match(q2, /不要重新判斷對錯/);
  assert.match(q2, /UART_WRONG_PORT/);
  assert.doesNotMatch(q1 + q2, /學號|姓名|email|帳號/i);
});

test('AI 呼叫：成功取回答；拒答、錯誤狀態、例外、逾時都回 ok:false', async () => {
  const ok = await askAI('q', { fetchImpl: async () => ({ ok: true, json: async () => ({ answer: ' 說明 ', source_type: 'rag' }) }) });
  assert.deepEqual(ok, { ok: true, answer: '說明', sourceType: 'rag' });
  let sent;
  await askAI('問題', { fetchImpl: async (url, init) => { sent = { url, init }; return { ok: true, json: async () => ({ answer: 'a' }) }; } });
  assert.equal(sent.url, '/api/rag/ask');
  assert.deepEqual(JSON.parse(sent.init.body), { question: '問題' });
  assert.equal((await askAI('q', { fetchImpl: async () => ({ ok: true, json: async () => ({ answer: 'x', source_type: 'refuse' }) }) })).ok, false);
  assert.equal((await askAI('q', { fetchImpl: async () => ({ ok: false }) })).ok, false);
  assert.equal((await askAI('q', { fetchImpl: async () => { throw new Error('net'); } })).ok, false);
  const slow = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort'))));
  assert.equal((await askAI('q', { fetchImpl: slow, timeoutMs: 20 })).ok, false);
});

// P5 安全：被竄改的進度檔不能把任意文字（例如 HTML／script）帶進錯誤紀錄
test('匯入安全：未知錯誤代碼、嚴重度與多餘欄位都會被丟掉', async () => {
  const { createAssemblyEngine } = await import('../core/assembly-engine.js');
  const { createWiringEngine } = await import('../core/wiring-engine.js');
  const { F450_MODEL } = await import('../data/f450-pixhawk248.js');
  const { F450_WIRING, EXTRA_POINTS, CONNECTOR_FITS } = await import('../data/f450-wiring.js');
  const { PIXHAWK_248_GENERIC } = await import('../data/boards/pixhawk-248-generic.js');
  const a = createAssemblyEngine(F450_MODEL, { now: () => 0 });
  a.restore({ kind: 'fde-build-lab-progress', modelId: 'f450-pixhawk248', installed: [], errors: [
    { partId: 'bottom_plate', code: '<img src=x onerror=alert(1)>', at: 1 },
    { partId: 'bottom_plate', code: 'POSITION', at: 2, detail: '<script>', extra: 'x' },
  ] });
  assert.deepEqual(a.errors, [{ at: 2, partId: 'bottom_plate', code: 'POSITION', detail: null }]);
  const w = createWiringEngine(F450_WIRING, PIXHAWK_248_GENERIC, EXTRA_POINTS, CONNECTOR_FITS, { now: () => 0 });
  w.restore({ done: [], errors: [
    { stepId: 'esc1-power', code: 'REVERSED_POLARITY', severity: '<b>x</b>' },
    { stepId: 'esc1-power', code: 'REVERSED_POLARITY', severity: 'danger', html: '<script>' },
  ] });
  assert.deepEqual(w.errors, [{ at: 0, stepId: 'esc1-power', code: 'REVERSED_POLARITY', severity: 'danger' }]);
});
