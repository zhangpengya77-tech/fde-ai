const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const live = require('./live.js');

const task03Steps = [
  'T03_LAYOUT','T03_FORWARD','T03_ARMS','T03_FRAME_CHECK','T03_TESTED_MOTORS','T03_POSITIONS',
  'T03_SCREW','T03_INSTALL','T03_MECHANICAL','T03_EVIDENCE','T03_REFLECTION'
].map((step_id, index) => ({ step_id, order: index + 1, title: step_id }));

test('Task 01 through 06 use five student-facing groups without changing backend step ids', () => {
  const expectedCounts = { TASK_01: 10, TASK_02: 12, TASK_03: 11, TASK_04: 12, TASK_05: 11, TASK_06: 11 };
  for (const [taskId, count] of Object.entries(expectedCounts)) {
    const steps = live.studentStepGroupDefinitions(taskId).flatMap((group) => group.step_ids);
    assert.equal(live.studentStepGroupDefinitions(taskId).length, 5, taskId);
    assert.equal(steps.length, count, taskId);
    assert.equal(new Set(steps).size, count, taskId);
  }
});

test('current completed and future group states derive from authoritative current step', () => {
  const groups = live.studentStepGroups('TASK_03', task03Steps, 'T03_INSTALL', 'IN_PROGRESS');
  assert.deepEqual(groups.map((group) => group.state), ['COMPLETED', 'COMPLETED', 'CURRENT', 'FUTURE', 'FUTURE']);
  assert.equal(groups.find((group) => group.state === 'CURRENT').title, '安装马达');
});

test('unknown tasks fall back to one group per backend step', () => {
  const groups = live.studentStepGroups('TASK_99', [{ step_id: 'A', title: '第一步' }, { step_id: 'B', title: '第二步' }], 'A');
  assert.equal(groups.length, 2);
  assert.equal(groups[0].state, 'CURRENT');
  assert.equal(groups[1].state, 'FUTURE');
});

test('only tools required by the current backend step are visible', () => {
  assert.deepEqual(live.studentStepToolVisibility({}), { camera: true, aiCheck: false, evidence: false, reflection: false, teacher: false, safety: false });
  assert.deepEqual(live.studentStepToolVisibility({ step_id: 'T03_EVIDENCE', vision_task: 'motor_frame_presence', evidence_required: ['PHOTO'], teacher_gate: true, safety_reminders: [{ id: 'REM' }] }), { camera: true, aiCheck: true, evidence: true, reflection: false, teacher: true, safety: true });
  assert.equal(live.studentStepToolVisibility({ step_id: 'T03_REFLECTION', title: '学习总结' }).reflection, true);
});

test('teacher gate blocks learner forward navigation', () => {
  const elements = {
    primaryTrainingAction: { disabled: false, dataset: {} }, safetyCard: { hidden: false }, cameraTool: { hidden: false },
    evidenceCard: { hidden: false }, reflectionCard: { hidden: false }, teacherCard: { hidden: false }
  };
  live.renderTrainingState(elements, { task_state: 'IN_PROGRESS', current_training_step_id: 'T04_CONTINUITY', task: { id: 'TASK_04', steps: [{ step_id: 'T04_CONTINUITY', teacher_gate: true }] } });
  assert.equal(elements.primaryTrainingAction.dataset.action, 'TEACHER');
  assert.equal(elements.primaryTrainingAction.textContent, '请教师确认');
  assert.equal(elements.teacherCard.hidden, false);
});

test('empty safety and unrelated tools remain hidden', () => {
  const elements = {
    safetyCard: { hidden: false }, cameraTool: { hidden: false }, evidenceCard: { hidden: false },
    reflectionCard: { hidden: false }, teacherCard: { hidden: false }, primaryTrainingAction: { disabled: false, dataset: {} }
  };
  live.renderTrainingState(elements, { task_state: 'IN_PROGRESS', current_training_step_id: 'T03_LAYOUT', task: { id: 'TASK_03', steps: [{ step_id: 'T03_LAYOUT' }] } });
  assert.equal(elements.safetyCard.hidden, true);
  assert.equal(elements.cameraTool.hidden, false);
  assert.equal(elements.evidenceCard.hidden, true);
  assert.equal(elements.reflectionCard.hidden, true);
  assert.equal(elements.teacherCard.hidden, true);
});

test('step and task completion feedback use explicit continue actions', () => {
  assert.deepEqual(live.trainingCompletionFeedback('T03_INSTALL', 'T03_MECHANICAL', 'IN_PROGRESS'), { type: 'STEP', title: '✅ 这一步完成', canContinue: true });
  assert.deepEqual(live.trainingCompletionFeedback('T03_REFLECTION', null, 'COMPLETED'), { type: 'TASK', title: 'Task 已完成', canContinue: true });
});

test('mobile markup provides one-step shell, conditional tools, AI drawer, and collapsed dev mode', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const id of ['studentGroupProgress','currentStepCard','cameraTool','evidenceCard','reflectionCard','teacherCard','stepCompleteFeedback','taskCompleteFeedback','aiTools','devModePanel']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /<div[^>]+id=["']cameraTool["']/);
  assert.match(html, /<details[^>]+id=["']aiTools["']/);
  assert.doesNotMatch(html, /<details[^>]+id=["']devModePanel["'][^>]*\sopen(?:\s|>)/);
});

test('390px stylesheet is a dedicated single-column step experience', () => {
  const css = fs.readFileSync(path.join(__dirname, 'live.css'), 'utf8');
  assert.match(css, /@media\s*\(max-width:\s*390px\)/);
  assert.match(css, /\.student-group-progress/);
  assert.match(css, /\.current-step-card/);
  assert.match(css, /\.student-tool\[hidden\]/);
});

test('twelve task map is the default screen and every task card remains viewable', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id=["']taskMapScreen["']/);
  assert.match(html, /id=["']taskDetailScreen["'][^>]*hidden/);
  assert.match(html, /id=["']backToTaskMap["']/);
  const elements = { taskMapScreen: { hidden: true }, taskDetailScreen: { hidden: false } };
  live.showTaskMap(elements);
  assert.equal(elements.taskMapScreen.hidden, false);
  assert.equal(elements.taskDetailScreen.hidden, true);
  live.showTaskDetail(elements);
  assert.equal(elements.taskMapScreen.hidden, true);
  assert.equal(elements.taskDetailScreen.hidden, false);
});

test('completion policies distinguish AI, teacher, and hybrid tasks', () => {
  assert.equal(live.taskCompletionPolicy('TASK_01'), 'AI_ASSISTED_COMPLETE');
  assert.equal(live.taskCompletionPolicy('TASK_02'), 'TEACHER_CONFIRM');
  assert.equal(live.taskCompletionPolicy('TASK_05'), 'HYBRID_CONFIRM');
  assert.equal(live.taskCompletionPolicy('TASK_09'), 'AI_ASSISTED_COMPLETE');
  assert.equal(live.taskCompletionPolicy('TASK_11'), 'TEACHER_CONFIRM');
});

test('backend task states render green orange and red without frontend completion inference', () => {
  const e = { trainingTaskList: { innerHTML: '' } };
  live.renderTrainingState(e, { task: {}, tasks: [
    { task_id: 'TASK_01', order: 1, short_name: '认', title: '零件识别与检查', status: 'COMPLETED' },
    { task_id: 'TASK_02', order: 2, short_name: '测', title: 'Motor + ESC 台架测试', status: 'PENDING_TEACHER_REVIEW' },
    { task_id: 'TASK_03', order: 3, short_name: '装', title: '机架 + 马达安装', status: 'NEED_REWORK' }
  ] });
  assert.match(e.trainingTaskList.innerHTML, /data-state="COMPLETED"/);
  assert.match(e.trainingTaskList.innerHTML, /data-state="PENDING_TEACHER_REVIEW"/);
  assert.match(e.trainingTaskList.innerHTML, /data-state="NEED_REWORK"/);
  assert.match(e.trainingTaskList.innerHTML, /data-view-task="TASK_03"/);
});

test('overall progress and Growth Record 05 read the same backend progress value', () => {
  const e = { trainingProgress: { textContent: '' }, mapProgress: { textContent: '' }, trainingGrowth: { textContent: '' } };
  live.renderTrainingState(e, { progress: '3 / 12', task: {} });
  assert.equal(e.trainingProgress.textContent, '3 / 12');
  assert.equal(e.mapProgress.textContent, '3 / 12');
  assert.match(e.trainingGrowth.textContent, /^3 \/ 12/);
});

test('task map CSS is two columns on 390px and expands on desktop', () => {
  const css = fs.readFileSync(path.join(__dirname, 'live.css'), 'utf8');
  assert.match(css, /\.task-map-grid\{[^}]*grid-template-columns:repeat\(4/);
  assert.match(css, /@media\s*\(max-width:\s*700px\)[\s\S]*\.task-map-grid\{grid-template-columns:repeat\(2/);
  for (const state of ['NOT_STARTED','IN_PROGRESS','PENDING_TEACHER_REVIEW','NEED_REWORK','COMPLETED','BLOCKED']) assert.match(css, new RegExp(`data-state=["']${state}["']`));
});
