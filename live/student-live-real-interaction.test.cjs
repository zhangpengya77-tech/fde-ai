const test = require('node:test');
const assert = require('node:assert/strict');
const live = require('./live.js');

function element() {
  return { hidden: false, textContent: '', innerHTML: '', dataset: {}, disabled: false };
}

test('initial training state renders all backend tasks and keeps detail unselected', () => {
  const elements = {
    taskMapScreen: element(), taskDetailScreen: element(), trainingTaskList: element(),
    trainingProgress: element(), mapProgress: element()
  };
  const training = {
    progress: '0 / 12',
    tasks: Array.from({ length: 12 }, (_, index) => ({
      task_id: `TASK_${String(index + 1).padStart(2, '0')}`,
      order: index + 1,
      short_name: ['认','测','装','焊','接','查','调','验','演','查','飞','析'][index],
      title: `任务 ${index + 1}`,
      status: 'NOT_STARTED', viewable: true
    }))
  };

  live.initializeStudentTaskMap(elements, training);

  assert.equal((elements.trainingTaskList.innerHTML.match(/data-view-task/g) || []).length, 12);
  assert.equal(elements.taskMapScreen.hidden, false);
  assert.equal(elements.taskDetailScreen.hidden, true);
  assert.equal(elements.mapProgress.textContent, '0 / 12');
});

test('failed task-map load replaces loading text with retry action', () => {
  const elements = { trainingTaskList: element(), taskMapScreen: element(), taskDetailScreen: element() };
  live.renderTaskMapLoadError(elements);
  assert.match(elements.trainingTaskList.innerHTML, /任务地图载入失败/);
  assert.match(elements.trainingTaskList.innerHTML, /data-retry-task-map/);
  assert.doesNotMatch(elements.trainingTaskList.innerHTML, /正在载入/);
  assert.equal(elements.taskDetailScreen.hidden, true);
});

test('question classifier captures only visual questions', () => {
  assert.equal(live.questionRequiresVision('下一步呢？'), false);
  assert.equal(live.questionRequiresVision('为什么要做罗盘校准？'), false);
  assert.equal(live.questionRequiresVision('我这个桨叶方向对不对？'), true);
  assert.equal(live.questionRequiresVision('帮我看一下这个接收机接对了吗？'), true);
  assert.equal(live.questionRequiresVision('帮我看一下，我现在可以安全上电吗？'), false);
});

test('camera preview policy never schedules continuous inference', () => {
  assert.deepEqual(live.cameraPreviewPolicy(), { localPreview: true, continuousVision: false, captureMode: 'explicit_single_frame' });
});

test('text Ask AI sends no image for a next-step question and one image for a visual question', async () => {
  const payloads = [];
  const fetchImpl = async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ answer: '回答', classification: 'step', vision_used: false }) };
  };
  let captures = 0;
  const capture = () => { captures += 1; return { imageData: 'data:image/jpeg;base64,WA==' }; };

  await live.askLiveCoach(fetchImpl, 'session-1', '下一步呢？', capture);
  await live.askLiveCoach(fetchImpl, 'session-1', '我这个桨叶方向对不对？', capture);

  assert.equal(captures, 1);
  assert.equal('image_data' in payloads[0], false);
  assert.equal(payloads[1].image_data, 'data:image/jpeg;base64,WA==');
});

test('task-map retry control invokes a real reload action', async () => {
  let listener;
  const container = { addEventListener: (_name, callback) => { listener = callback; } };
  let retries = 0;
  live.bindTaskMapRetry(container, async () => { retries += 1; });
  await listener({ target: { closest: (selector) => selector === '[data-retry-task-map]' ? {} : null } });
  assert.equal(retries, 1);
});

test('speech transcript is submitted through the same contextual Ask flow', async () => {
  let input = '';
  let submitted = '';
  await live.handleVoiceTranscript('下一步呢？', (value) => { input = value; }, async (value) => { submitted = value; });
  assert.equal(input, '下一步呢？');
  assert.equal(submitted, '下一步呢？');
});

test('session rendering tolerates the removed legacy confirm control', () => {
  const elements = {
    course: element(), task: element(), progress: element(), step: element(), instruction: element(),
    visionResult: element(), sopResult: element(), guidance: element(), confirm: null
  };
  assert.doesNotThrow(() => live.renderTaskState(elements, {
    course_title: 'F450', task_title: '零件识别', progress: { current: 1, total: 3 },
    step: { title: '准备区域', instruction: '清理桌面' }, state: 'READY'
  }));
});
