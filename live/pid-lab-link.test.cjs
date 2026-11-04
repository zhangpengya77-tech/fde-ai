// AI PID 與濾波實驗室入口：只在 TASK_07 / TASK_08 顯示，純連結，不改變步驟與完成條件。
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const live = require('./live.js');

function elementsWithLink() {
  const link = { hidden: true };
  const documentStub = { getElementById: (id) => (id === 'pidLabLink' ? link : null) };
  return { link, elements: { trainingObjective: { textContent: '', ownerDocument: documentStub } } };
}

function render(taskId, order) {
  const { link, elements } = elementsWithLink();
  live.renderTrainingState(elements, {
    task_state: 'IN_PROGRESS', current_task_id: taskId, current_training_step_id: 'S1',
    task: { id: taskId, order, title: 'x', steps: [{ step_id: 'S1', title: 's', progress: {} }] }
  });
  return link;
}

test('index.html 含隱藏的實驗室連結，指向 /pid-lab/', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id="pidLabLink"[^>]*hidden/);
  assert.match(html, /href="\/pid-lab\/"/);
});

test('TASK_07 與 TASK_08 顯示實驗室連結', () => {
  assert.equal(render('TASK_07', 7).hidden, false);
  assert.equal(render('TASK_08', 8).hidden, false);
});

test('其他任務不顯示實驗室連結', () => {
  for (const [id, order] of [['TASK_01', 1], ['TASK_06', 6], ['TASK_09', 9], ['TASK_12', 12]]) {
    assert.equal(render(id, order).hidden, true, id);
  }
});
