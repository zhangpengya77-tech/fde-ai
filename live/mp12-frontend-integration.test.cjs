const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const live = require('./live.js');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, 'live.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, 'live.js'), 'utf8');

function mpElements() {
  const stub = () => ({ textContent: '', innerHTML: '', hidden: false, disabled: false, dataset: {}, value: '' });
  return {
    missionPlannerPanel: stub(), mp12MapView: stub(), mp12DetailView: stub(),
    mp12Progress: stub(), mp12TaskList: stub(), mp12Title: stub(), mp12Objective: stub(),
    mp12Procedure: stub(), mp12Checks: stub(), mp12Safety: stub(), mp12Evidence: stub(),
    mp12CompleteSubtask: stub(), mp12TeacherReview: stub(), mp12CompletedBanner: stub()
  };
}

function item(id, overrides = {}) {
  return {
    subtask_id: id, order: Number(id.slice(2)), title: `子任务 ${id}`, objective: `目标 ${id}`,
    procedure: ['步骤一'], completion_checks: ['检查一'], safety_rules: [], scope_notes: [],
    teacher_required: false, evidence_types: ['SCREENSHOT'], vision_task: null, legacy_step_ids: [],
    status: 'NOT_STARTED', facts: [], evidence: [], teacher_decision: null, teacher_id: null,
    teacher_reason: null, teacher_note: null, updated_at: null,
    ...overrides
  };
}

function missionPlanner(completed = false, count = 0) {
  const items = Array.from({ length: 12 }, (_, i) => item(`MP${String(i + 1).padStart(2, '0')}`,
    i < count ? { status: 'COMPLETED' } : {}));
  return {
    title: 'Mission Planner AI 调参助教', parent_task_id: 'TASK_07',
    current_subtask_id: 'MP01', current_subtask: items[0], next_subtask: { subtask_id: 'MP02', title: '子任务 MP02' },
    progress: `${count} / 12`, completed_count: count, total: 12, completed,
    subtasks: {}, items
  };
}

// ---------- 1. 非 TASK_07：MP-12 hidden ----------
test('non TASK_07 hides MP-12 panel', () => {
  const e = mpElements();
  live.renderTrainingState(e, { task: { id: 'TASK_03', order: 3, steps: [] }, current_task_id: 'TASK_03' });
  assert.equal(e.missionPlannerPanel.hidden, true);
});

// ---------- 2. TASK_07 + mission_planner：MP-12 visible ----------
test('TASK_07 with mission_planner shows MP-12 panel', () => {
  const e = mpElements();
  live.renderTrainingState(e, {
    task: { id: 'TASK_07', order: 7, steps: [] }, current_task_id: 'TASK_07',
    mission_planner: missionPlanner()
  });
  assert.equal(e.missionPlannerPanel.hidden, false);
});

// ---------- 3. MP01～MP12：render 12 items ----------
test('renders all 12 MP subtasks', () => {
  const e = mpElements();
  live.renderMissionPlannerState(e, missionPlanner(), { devMode: false });
  for (let i = 1; i <= 12; i += 1) {
    const id = `MP${String(i).padStart(2, '0')}`;
    assert.ok(e.mp12TaskList.innerHTML.includes(`data-mp-subtask="${id}"`), `missing ${id}`);
  }
  assert.equal((e.mp12TaskList.innerHTML.match(/data-mp-subtask=/g) || []).length, 12);
});

// ---------- 4. progress：正確顯示 x / 12 ----------
test('progress renders x / 12 from backend payload', () => {
  const e = mpElements();
  live.renderMissionPlannerState(e, missionPlanner(false, 5), { devMode: false });
  assert.equal(e.mp12Progress.textContent, '5 / 12');
  assert.ok(!String(e.mp12Progress.textContent).startsWith('undefined'));
});

// ---------- 5. select：呼叫既有 select endpoint ----------
test('selectMpSubtask calls existing backend select endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init.method]); return { ok: true, json: async () => ({ training: {} }) }; };
  await live.selectMpSubtask(fetchImpl, 'sid', 'MP01');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/live/sessions/sid/training/mp12/MP01/select');
  assert.equal(calls[0][1], 'POST');
});

// ---------- 6. complete：呼叫既有 complete endpoint ----------
test('completeMpSubtask calls existing backend complete endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init.method]); return { ok: true, json: async () => ({ training: {} }) }; };
  await live.completeMpSubtask(fetchImpl, 'sid', 'MP03');
  assert.equal(calls[0][0], '/api/live/sessions/sid/training/mp12/MP03/complete');
  assert.equal(calls[0][1], 'POST');
});

// ---------- 7. teacher_required：學生不可自行 APPROVE ----------
test('student cannot self-approve a teacher-required MP subtask', () => {
  const pending = item('MP06', { teacher_required: true, status: 'PENDING_TEACHER_REVIEW' });
  const action = live.mpSubtaskAction(pending);
  assert.notEqual(action.kind, 'COMPLETE');
  assert.equal(action.kind, 'WAIT');
  assert.equal(action.disabled, true);
});

test('teacher review UI stays hidden for students (devMode off)', () => {
  const e = mpElements();
  const mp = missionPlanner();
  mp.current_subtask = item('MP06', { teacher_required: true, status: 'PENDING_TEACHER_REVIEW' });
  mp.current_subtask_id = 'MP06';
  live.renderMissionPlannerState(e, mp, { devMode: false });
  assert.equal(e.mp12TeacherReview.hidden, true);
});

test('teacher review uses Main v2.0 teacher authority headers, not MP-12 PIN', async () => {
  let headers = null;
  let body = null;
  const fetchImpl = async (url, init) => { headers = init.headers; body = JSON.parse(init.body); return { ok: true, json: async () => ({ training: {} }) }; };
  await live.submitMpTeacherReview(fetchImpl, 'sid', 'MP06', { decision: 'APPROVE', reason: '接线问题', note: 'ok' });
  assert.equal(headers['X-FDE-Role'], 'teacher');
  assert.equal(headers['X-FDE-Teacher-ID'], 'MOCK_TEACHER');
  assert.equal(body.pin, undefined);
  assert.equal(body.decision, 'APPROVE');
});

// ---------- 8. completed：顯示 completed banner ----------
test('completed MP-12 shows completed banner with return-to-TASK_07 button', () => {
  const e = mpElements();
  live.renderMissionPlannerState(e, missionPlanner(true, 12), { devMode: false });
  assert.equal(e.mp12CompletedBanner.hidden, false);
  assert.ok(HTML.includes('id="mp12CompletedBanner"'));
  assert.ok(HTML.includes('id="mp12BackToTask07"'));
  assert.ok(HTML.includes('可以返回 F450 主任务继续学习'));
});

// ---------- 9. completed：不自動完成 TASK_07 ----------
test('MP-12 completion does NOT auto-complete TASK_07', () => {
  const e = mpElements();
  e.trainingStatus = { textContent: '' };
  e.taskCompleteFeedback = { hidden: false };
  live.renderTrainingState(e, {
    task: { id: 'TASK_07', order: 7, steps: [] }, current_task_id: 'TASK_07',
    task_state: 'IN_PROGRESS', mission_planner: missionPlanner(true, 12)
  });
  // Banner 顯示，但 TASK_07 狀態仍由 Backend 決定，前端不得寫成 COMPLETED
  assert.equal(e.mp12CompletedBanner.hidden, false);
  assert.notEqual(e.trainingStatus.textContent, '已完成');
  assert.equal(e.taskCompleteFeedback.hidden, true); // task_state 非 COMPLETED → 不顯示完成回饋
});

test('frontend never calls TASK_07 completion or TASK_08 navigation for MP-12', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => ({ training: {} }) }; };
  await live.selectMpSubtask(fetchImpl, 'sid', 'MP01');
  await live.completeMpSubtask(fetchImpl, 'sid', 'MP01');
  await live.submitMpTeacherReview(fetchImpl, 'sid', 'MP06', { decision: 'APPROVE' });
  assert.ok(!calls.some((u) => u.includes('/tasks/TASK_07/complete')), 'must not auto-complete TASK_07');
  assert.ok(!calls.some((u) => u.includes('TASK_08')), 'must not auto-jump TASK_08');
});

// ---------- 10. TASK08：不顯示 MP-12 ----------
test('TASK_08 never shows MP-12 panel even if payload leaks mission_planner', () => {
  const e = mpElements();
  live.renderTrainingState(e, {
    task: { id: 'TASK_08', order: 8, steps: [] }, current_task_id: 'TASK_08',
    mission_planner: missionPlanner(true, 12)
  });
  assert.equal(e.missionPlannerPanel.hidden, true);
  const e2 = mpElements();
  live.renderTrainingState(e2, { task: { id: 'TASK_11', order: 11, steps: [] }, current_task_id: 'TASK_11', mission_planner: missionPlanner() });
  assert.equal(e2.missionPlannerPanel.hidden, true);
});

// ---------- 11. Main Live Coach：原 UI 不受影響 ----------
test('existing Student Live Coach rendering is unchanged', () => {
  const e = mpElements();
  e.trainingTitle = { textContent: '' };
  e.trainingObjective = { textContent: '' };
  e.trainingTaskNumber = { textContent: '' };
  e.trainingStatus = { textContent: '' };
  e.trainingProgress = { textContent: '' };
  live.renderTrainingState(e, {
    task: { id: 'TASK_07', order: 7, title: 'Mission Planner 完整调参', objective: '完成 F450 基本飞控配置。', steps: [] },
    current_task_id: 'TASK_07', task_state: 'IN_PROGRESS', progress: '6 / 12',
    mission_planner: missionPlanner()
  });
  assert.equal(e.trainingTitle.textContent, 'Mission Planner 完整调参');
  assert.equal(e.trainingObjective.textContent, '完成 F450 基本飞控配置。');
  assert.equal(e.trainingTaskNumber.textContent, 'Task 07 / 12');
  assert.equal(e.trainingProgress.textContent, '6 / 12');
});

test('no new page route: MP-12 reuses /live/ only', () => {
  assert.ok(!HTML.includes('/mp12-new/'), 'must not create mp12-new route');
  assert.ok(!HTML.includes('/mission-planner-v2/'), 'must not create mission-planner-v2 route');
});

// ---------- 12. existing backend contract：不新增重複 API ----------
test('frontend only uses the 3 existing MP-12 endpoints', () => {
  const urls = [...JS.matchAll(/training\/mp12\/\$\{encodeURIComponent\(subtaskId\)\}\/(\w[\w-]*)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(urls)].sort(), ['complete', 'select', 'teacher-review']);
  // 不得出現第二套 API（例如自建 mp12-progress / mp12-state）
  assert.ok(!JS.includes('/training/mp12-progress'));
  assert.ok(!JS.includes('/training/mp12-state'));
});

test('MP-12 panel markup and styles are present; PIN gate is NOT ported', () => {
  for (const id of ['missionPlannerPanel', 'mp12MapView', 'mp12DetailView', 'mp12TaskList', 'mp12CompletedBanner', 'mp12BackToTask07']) {
    assert.ok(HTML.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.ok(!HTML.includes('mp12TeacherPin'), 'MP-12 PIN gate must not be reintroduced');
  assert.ok(CSS.includes('.mp12-panel'));
  assert.ok(CSS.includes('.mp12-grid'));
  assert.ok(CSS.includes('.mp12-completed'));
});
