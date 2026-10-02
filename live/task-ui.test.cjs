const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const live = require('./live.js');

function elements() {
  const e = {};
  for (const name of ['course','task','progress','step','instruction','visionResult','sopResult','guidance','ragExplanation','ragSource','ragStatus','ragLatency','confirm','devPanel']) {
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
  for (const id of ['captureFrame','courseTitle','taskTitle','taskProgress','currentStep','taskInstruction','sopResult','coachGuidance','primaryTrainingAction','devSimulator']) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /Simulate motor/);
  assert.match(html, /AI 帮我看一下/);
});

test('renders rag explanation separately from sop and deterministic guidance', () => {
  const e = elements();
  live.renderTaskState(e, {
    session: { state: 'NG' },
    sop: { status: 'NG' },
    guidance: { text: '请更换正确零件。' },
    rag_explanation: {
      status: 'online',
      explanation: '马达提供旋转动力。',
      source_type: 'rag',
      latency_ms: 123.4,
      safety_notice: null
    }
  });
  assert.equal(e.sopResult.textContent, 'NG');
  assert.equal(e.guidance.textContent, '请更换正确零件。');
  assert.equal(e.ragExplanation.textContent, '马达提供旋转动力。');
  assert.equal(e.ragSource.textContent, 'FDE-AI RAG');
  assert.equal(e.ragStatus.textContent, 'ONLINE');
  assert.equal(e.ragLatency.textContent, '123.4 ms');
});

test('pending fallback and teacher safety explanation remain explicit', () => {
  const e = elements();
  live.renderTaskState(e, { session: { state: 'NG', rag_explanation: { status: 'pending', explanation: '正在查询教学知识…' } } });
  assert.equal(e.ragExplanation.textContent, '正在查询教学知识…');
  live.renderTaskState(e, { session: { state: 'TEACHER_CHECK', rag_explanation: { status: 'online', explanation: '允许起飞', safety_notice: '此步骤涉及安全操作，必须由教师确认后才能继续。' } } });
  assert.match(e.ragExplanation.textContent, /^此步骤涉及安全操作/);
  assert.match(e.ragExplanation.textContent, /允许起飞/);
});

test('live frontend never calls local rag port directly', () => {
  const source = fs.readFileSync(path.join(__dirname, 'live.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.doesNotMatch(source + html, /8770|\/api\/rag\/ask/);
  for (const id of ['ragExplanation','ragSource','ragStatus','ragLatency']) assert.match(html, new RegExp(`id=["']${id}["']`));
});

test('dev simulation keeps its mock session through confirm', () => {
  const source = fs.readFileSync(path.join(__dirname, 'live.js'), 'utf8');
  assert.match(source, /ensureSession\('MOCK_VISION'\)/);
  assert.match(source, /const id = sessionId \|\| await ensureSession\(\)/);
});

test('auto scheduler starts only after backend acceptance and stops with camera', () => {
  const source = fs.readFileSync(path.join(__dirname, 'live.js'), 'utf8');
  const backendStart = source.indexOf('/auto/start');
  const schedulerStart = source.indexOf('autoScheduler.start()', backendStart);
  assert.ok(backendStart >= 0 && schedulerStart > backendStart);
  const stopCamera = source.slice(source.indexOf('async function stopCamera()'), source.indexOf('async function startAutoObservation()'));
  assert.match(stopCamera, /stopAutoObservation\(\)/);
});

test('auto mode requires camera and session and exposes start stop controls', () => {
  assert.equal(live.autoStartError(false, 'sid'), 'camera_required');
  assert.equal(live.autoStartError(true, ''), 'session_required');
  assert.equal(live.autoStartError(true, 'sid'), null);
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const id of ['startCoach','stopCoach','manualMode','autoMode','autoMetrics']) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /auto-observation\.js/);
});

test('renders twelve-task student training state with human-facing safety content', () => {
  const e = {};
  for (const name of ['trainingProgress','trainingTaskNumber','trainingTitle','trainingObjective','trainingAction','trainingWhy','trainingSafety','trainingSteps','trainingStatus','trainingEvidence','trainingReflection','trainingTeacher','trainingGrowth','trainingPrerequisite','cameraWaiting']) e[name] = { textContent: '', innerHTML: '' };
  live.renderTrainingState(e, {
    progress: '2 / 12', current_task_id: 'TASK_03', task_state: 'IN_PROGRESS', prerequisite_state: 'READY', camera_active: true,
    evidence_count: 1, reflection_state: 'available', teacher_review_state: 'NOT_REQUIRED',
    task: {
      order: 3, title: 'F450 机架 + 马达安装', objective: '组装机架并安装马达。', description: '完成结构安装。',
      steps: [{ id: 'MOTOR_INSTALL', title: 'Motor Install', instruction: '安装四颗马达。', rationale: '先确认结构可靠。' }],
      safety_reminders: [{ id: 'REM_MOTOR_SCREW_TOO_LONG', message: '过长的马达固定螺丝可能损伤马达内部结构。' }]
    }
  });
  assert.equal(e.trainingProgress.textContent, '2 / 12');
  assert.equal(e.trainingTaskNumber.textContent, 'Task 03 / 12');
  assert.match(e.trainingSafety.innerHTML, /⚠/);
  assert.match(e.trainingSafety.innerHTML, /过长/);
  assert.doesNotMatch(e.trainingSafety.innerHTML, /REM_MOTOR/);
  assert.equal(e.cameraWaiting.textContent, 'ACTIVE / WAITING');
});

test('task rendering does not claim camera active when camera is only waiting to start', () => {
  const e = { cameraWaiting: { textContent: 'STOPPED' } };
  live.renderTrainingState(e, { camera_active: false, task: {} });
  assert.equal(e.cameraWaiting.textContent, 'STOPPED');
});

test('snapshot refresh renders nested authoritative training state', () => {
  const e = elements();
  e.trainingStatus = { textContent: '' };
  live.renderTaskState(e, { session: { state: 'NG' }, task: { training: { task_state: 'IN_PROGRESS', task: {} } } });
  assert.equal(e.trainingStatus.textContent, '进行中');
});

test('maps internal connector and error ids to student language', () => {
  assert.equal(live.studentFacingLabel('FC_MAIN_OUT_1'), '飞控 MAIN OUT 1（1号电机输出接口）');
  assert.equal(live.studentFacingLabel('ERR_POWER_POLARITY'), '电源正负极需要重新确认。');
});

test('vision only triggers for explicit or configured checks', () => {
  const noVision = { task: { vision_tasks: [] } };
  const configured = { task: { vision_tasks: ['component_class'] } };
  assert.equal(live.shouldTriggerVision(noVision, 'camera_waiting'), false);
  assert.equal(live.shouldTriggerVision(configured, 'camera_waiting'), false);
  assert.equal(live.shouldTriggerVision(configured, 'sop_vision_check'), true);
  assert.equal(live.shouldTriggerVision(noVision, 'student_request'), true);
});

test('student task renderer markup provides one unified twelve-task layout', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const id of ['trainingTaskList','trainingProgress','trainingTaskNumber','trainingTitle','trainingObjective','trainingAction','trainingWhy','trainingSafety','trainingSteps','trainingEvidence','reflectionOriginal','reflectionAssisted','trainingTeacher','trainingStatus','trainingGrowth','cameraWaiting']) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /我的学习总结/);
  assert.match(html, /学习证据/);
  assert.match(html, /教师复核/);
});

test('student evidence and reflection use backend-owned training APIs', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init]); return { ok: true, json: async () => ({ training: { evidence_count: 1 } }) }; };
  await live.saveTrainingEvidence(fetchImpl, 'sid', { task_id: 'F450_01', evidence_type: 'PHOTO', file_reference: 'dev-upload://parts.jpg' });
  await live.saveTrainingReflection(fetchImpl, 'sid', { task_id: 'F450_01', original_text: '我辨认了零件。', source_type: 'TEXT' });
  assert.equal(calls[0][0], '/api/live/sessions/sid/training/evidence');
  assert.equal(calls[1][0], '/api/live/sessions/sid/training/reflection');
  assert.equal(JSON.parse(calls[1][1].body).original_text, '我辨认了零件。');
});

test('teacher action sends explicit role and development identity headers', async () => {
  let request;
  const fetchImpl = async (url, init) => { request = { url, init }; return { ok: true, json: async () => ({ development_identity: true }) }; };
  await live.submitTeacherReview(fetchImpl, 'sid', 'APPROVE', '已现场复核');
  assert.match(request.url, /teacher-review$/);
  assert.equal(request.init.headers['X-FDE-Role'], 'teacher');
  assert.equal(request.init.headers['X-FDE-Teacher-ID'], 'MOCK_TEACHER');
});

test('step teacher action includes the backend current training step id', async () => {
  let body;
  const fetchImpl = async (_url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ training: {} }) }; };
  await live.submitTeacherReview(fetchImpl, 'sid', 'APPROVE', 'checked', 'TASK_02', 'T02_PREPOWER_TEACHER');
  assert.equal(body.step_id, 'T02_PREPOWER_TEACHER');
});

test('task map renders backend status rather than a nonexistent state field', () => {
  const e = { trainingTaskList: { innerHTML: '' } };
  live.renderTrainingState(e, { task: {}, tasks: [{ task_id: 'TASK_01', order: 1, title: '零件识别', status: 'COMPLETED' }] });
  assert.match(e.trainingTaskList.innerHTML, /已完成/);
  assert.doesNotMatch(e.trainingTaskList.innerHTML, />COMPLETED</);
  assert.doesNotMatch(e.trainingTaskList.innerHTML, /undefined/);
});

test('future task navigation fetches a read-only view without starting the task', async () => {
  let request;
  const fetchImpl = async (url, init) => { request = { url, init }; return { ok: true, json: async () => ({ training_task_view: { task: { id: 'TASK_07' }, actionable: false } }) }; };
  const result = await live.fetchTrainingTaskView(fetchImpl, 'sid', 'TASK_07');
  assert.equal(request.url, '/api/live/sessions/sid/training/tasks/TASK_07');
  assert.equal(request.init, undefined);
  assert.equal(result.training_task_view.actionable, false);
});

test('training step facts and safety acknowledgments use backend-owned APIs', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init]); return { ok: true, json: async () => ({ training: { current_training_step_id: 'T01_FRAME' } }) }; };
  await live.submitTrainingStepFact(fetchImpl, 'sid', 'T01_WORKSPACE', 'LEARNER_CONFIRMED');
  await live.acknowledgeTrainingStepSafety(fetchImpl, 'sid', 'T02_NO_PROP');
  assert.match(calls[0][0], /training\/steps\/T01_WORKSPACE\/facts$/);
  assert.deepEqual(JSON.parse(calls[0][1].body), { fact: 'LEARNER_CONFIRMED' });
  assert.match(calls[1][0], /training\/steps\/T02_NO_PROP\/safety-ack$/);
});

test('mobile student UI provides current step, safety acknowledgement, and one primary action', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const id of ['trainingStepNumber','trainingCompletionConditions','acknowledgeTrainingSafety','primaryTrainingAction','trainingStepList']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test('student mode leads with plain-language coaching actions', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const text of ['F450 AI 实训助教', 'AI 陪你一步一步完成 F450 实训', '现在要做什么', '为什么要这样做', 'AI 助教', '打开摄像头', 'AI 帮我看一下', '问 AI', '当前操作', '留下学习证据', '我的学习总结', '教师复核状态']) {
    assert.match(html, new RegExp(text));
  }
});

test('technical diagnostics remain available only inside collapsed dev mode', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /<details[^>]+id=["']devModePanel["'][^>]*>/);
  assert.doesNotMatch(html, /<details[^>]+id=["']devModePanel["'][^>]*\sopen(?:\s|>)/);
  const start = html.indexOf('id="devModePanel"');
  const end = html.indexOf('</details>', start);
  const devMarkup = html.slice(start, end);
  for (const text of ['Detection Facts', 'MODEL_ACCURACY_PENDING', 'RAG 延迟', 'Device diagnostics']) assert.match(devMarkup, new RegExp(text));
});

test('internal coaching states translate to student language', () => {
  assert.equal(live.studentCoachMessage('NO_DETECTION'), '目前没有清楚看到目标零件，请把零件完整放到镜头中央。');
  assert.equal(live.studentCoachMessage('UNCERTAIN'), 'AI 目前看不清楚，请调整角度或请老师确认。');
  assert.equal(live.studentCoachMessage('PASS_CANDIDATE'), 'AI 初步检查没有发现明显问题。');
  assert.match(live.studentCoachMessage('PASS_CANDIDATE', true), /等待教师复核/);
});

test('task map renders student-facing status instead of raw backend state', () => {
  assert.equal(live.studentTaskStatus('NOT_STARTED'), '未开始');
  assert.equal(live.studentTaskStatus('IN_PROGRESS'), '进行中');
  assert.equal(live.studentTaskStatus('PENDING_TEACHER_REVIEW'), '待教师确认');
  assert.equal(live.studentTaskStatus('NEED_REWORK'), '需重新检查');
  assert.equal(live.studentTaskStatus('COMPLETED'), '已完成');
});

