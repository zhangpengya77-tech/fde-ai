const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const live = require('./live.js');

function elements() {
  const e = {};
  for (const name of ['course','task','progress','step','instruction','visionResult','sopResult','guidance','confirm','devPanel']) {
    e[name] = { textContent: '', hidden: false, disabled: false };
  }
  return e;
}

test('renders authoritative task state without advancing locally', () => {
  const e = elements();
  live.renderTaskState(e, {
    session: { state: 'PASS_CANDIDATE', current_step_id: 'prepare_motor', expected_class: 'motor' },
    task: { course_title: 'F450 基础组装', task_title: '零件辨识与准备', progress: { current: 1, total: 3 }, step: { title: '准备马达', instruction: '请将 F450 马达放到摄像头前。' } },
    detection: { class: 'motor', confidence: 0.89 },
    sop: { status: 'PASS_CANDIDATE' },
    guidance: { text: '已识别到当前步骤需要的零件，请确认后继续。' }
  });
  assert.equal(e.course.textContent, 'F450 基础组装');
  assert.equal(e.progress.textContent, '1 / 3');
  assert.equal(e.sopResult.textContent, 'PASS_CANDIDATE');
  assert.equal(e.confirm.disabled, false);
});

test('confirm and simulate use authoritative backend APIs', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => ({ ok: true, json: async () => ({ session: { state: 'WAITING_FOR_OBJECT' } }), url, init });
  await live.confirmStep(fetchImpl, 'sid');
  await live.simulateVision(fetchImpl, 'sid', 'motor');
  assert.deepEqual(calls, []);
  const tracked = async (url, init) => { calls.push([url, JSON.parse(init.body || '{}')]); return { ok: true, json: async () => ({}) }; };
  await live.confirmStep(tracked, 'sid');
  await live.simulateVision(tracked, 'sid', 'motor');
  assert.equal(calls[0][0], '/api/live/sessions/sid/confirm');
  assert.deepEqual(calls[1][1], { scenario: 'motor' });
});

test('phase2 markup keeps manual detect and adds task and dev controls', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const id of ['captureFrame','courseTitle','taskTitle','taskProgress','currentStep','taskInstruction','sopResult','coachGuidance','confirmStep','devSimulator']) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /Simulate motor/);
  assert.match(html, /立即 AI 检测/);
});

test('auto mode requires camera and session and exposes start stop controls', () => {
  assert.equal(live.autoStartError(false, 'sid'), 'camera_required');
  assert.equal(live.autoStartError(true, ''), 'session_required');
  assert.equal(live.autoStartError(true, 'sid'), null);
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const id of ['startCoach','stopCoach','manualMode','autoMode','autoMetrics']) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /auto-observation\.js/);
});

