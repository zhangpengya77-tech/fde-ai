const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const live = require('./live.js');

function task08Elements() {
  const options = {
    NOT_AVAILABLE_INDOOR: { disabled: false },
    VISION_MODEL_NOT_READY: { disabled: false }
  };
  return {
    task08CheckStatusField: { hidden: true },
    task08CheckStatus: {
      value: 'PASS',
      querySelector(selector) {
        const value = selector.match(/value="([^"]+)"/)?.[1];
        return options[value] || null;
      }
    },
    trainingCompletionConditions: { innerHTML: '' },
    primaryTrainingAction: { disabled: false, dataset: {}, textContent: '' },
    safetyCard: { hidden: false }, cameraTool: { hidden: false }, evidenceCard: { hidden: false },
    reflectionCard: { hidden: false }, teacherCard: { hidden: false }
  };
}

test('Task 08 UI exposes the controlled check result choices', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const value of ['PASS', 'RETRY', 'NEEDS_CONFIRMATION', 'NOT_AVAILABLE_INDOOR', 'VISION_MODEL_NOT_READY']) {
    assert.match(html, new RegExp(`value=["']${value}["']`));
  }
});

test('Task 08 normal check uses an explicit result action', () => {
  assert.deepEqual(live.studentPrimaryAction({
    task_state: 'IN_PROGRESS', current_task_id: 'TASK_08',
    current_step: { step_id: 'T08_RC_INPUT_CHECK' }
  }), { kind: 'STEP', label: '记录检查结果' });
});

test('missing ACTIVE PROP model is shown as pending and remains nonblocking', () => {
  const elements = task08Elements();
  const step = { step_id: 'T08_PROP_VISION', title: 'PROP Vision 验证', progress: {} };
  live.renderTrainingState(elements, {
    task_state: 'IN_PROGRESS', current_task_id: 'TASK_08', current_training_step_id: step.step_id,
    prop_vision_status: 'PENDING', unsafe_action_allowed: true,
    task: { id: 'TASK_08', order: 8, steps: [step] }
  });
  assert.equal(elements.task08CheckStatusField.hidden, false);
  assert.equal(elements.task08CheckStatus.value, 'VISION_MODEL_NOT_READY');
  assert.match(elements.trainingCompletionConditions.innerHTML, /PROP Vision：PENDING/);
  assert.notEqual(elements.primaryTrainingAction.disabled, true);
});

test('Task 08 final step requests teacher review instead of learner completion', () => {
  assert.deepEqual(live.studentPrimaryAction({
    task_state: 'IN_PROGRESS', current_task_id: 'TASK_08',
    current_step: { step_id: 'T08_TEACHER_FINAL_REVIEW', teacher_gate: true }
  }), { kind: 'TEACHER', label: '请教师最终复核' });
});
