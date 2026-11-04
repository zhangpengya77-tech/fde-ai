const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const live = require('./live.js');

test('student primary action exposes exactly one plain-language CTA', () => {
  assert.deepEqual(live.studentPrimaryAction({ task_state: 'NOT_STARTED' }), { kind: 'START', label: '開始任務' });
  assert.deepEqual(live.studentPrimaryAction({ task_state: 'IN_PROGRESS', current_step: { teacher_gate: true } }), { kind: 'TEACHER', label: '請教師確認' });
  assert.deepEqual(live.studentPrimaryAction({ task_state: 'IN_PROGRESS', current_step: { evidence_required: ['PHOTO'] } }), { kind: 'EVIDENCE', label: '保存學習證據' });
  assert.deepEqual(live.studentPrimaryAction({ task_state: 'IN_PROGRESS', current_training_step_id: 'STEP_1', current_step: {} }), { kind: 'STEP', label: '我完成了' });
  assert.deepEqual(live.studentPrimaryAction({ task_state: 'COMPLETED' }), { kind: 'MAP', label: '返回任務地圖' });
});

test('task map includes a human-readable status legend', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const label of ['灰色 未開始','藍色 進行中','橙色 待教師確認','紅色 需重新檢查','綠色 已完成']) assert.match(html, new RegExp(label));
});

test('AI tools and manual camera access remain discoverable on every task', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id=["']aiTools["']/);
  for (const id of ['startCamera','switchCamera','textAskAi']) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.doesNotMatch(html, /id=["']cameraTool["'][^>]*\shidden/);
});

test('student completion area has one primary action and no backend jargon', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id=["']primaryTrainingAction["']/);
  assert.equal((html.match(/id=["']primaryTrainingAction["']/g) || []).length, 1);
  assert.doesNotMatch(html, /提交任務完成條件|actionable|completable|block_reason|training_step_progress/);
  assert.doesNotMatch(html, /id=["']startTrainingTask["']/);
  assert.doesNotMatch(html, /id=["']completeTrainingTask["']/);
});

test('safety acknowledgment is a checkbox rather than a primary button', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /<input[^>]+id=["']acknowledgeTrainingSafety["'][^>]+type=["']checkbox["']/);
});

test('non-vision steps keep camera controls but hide only AI check', () => {
  const visibility = live.studentStepToolVisibility({});
  assert.equal(visibility.camera, true);
  assert.equal(visibility.aiCheck, false);
  assert.equal(live.studentStepToolVisibility({ vision_task: 'component_present' }).aiCheck, true);
});
