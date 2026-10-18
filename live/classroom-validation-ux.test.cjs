const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const live = require('./live.js');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('task detail keeps camera and conversation primary while step actions stay in collapsed fallback', () => {
  const camera = html.indexOf('id="cameraTool"');
  const conversation = html.indexOf('id="liveCoachConversation"');
  const more = html.indexOf('id="moreWays"');
  const step = html.indexOf('id="currentStepCard"');
  const completion = html.indexOf('id="completionCard"');
  assert.ok(camera > 0 && camera < conversation);
  assert.ok(conversation < more);
  assert.ok(more < step);
  assert.ok(step < completion);
});

test('student default view exposes one completion action and collapses every auxiliary tool', () => {
  assert.match(html, /<details id="moreWays"[^>]*>\s*<summary>更多方式<\/summary>/);
  assert.doesNotMatch(html, /<details id="moreWays"[^>]*\sopen/);
  assert.match(html, /id="primaryTrainingAction"/);
  assert.match(html, /id="answerSourceLabel" hidden/);
});

test('classroom validation controls stay inside teacher dev mode', () => {
  const dev = html.indexOf('class="dev-mode-panel"');
  const toggle = html.indexOf('id="classroomValidationToggle"');
  const report = html.indexOf('id="classroomValidationReport"');
  assert.ok(dev > 0 && toggle > dev && report > toggle);
});

test('classroom validation client records events and reads the learning report', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ enabled: true }) };
  };
  await live.setClassroomValidation(fetchImpl, 'session-1', true);
  await live.recordClassroomEvent(fetchImpl, 'session-1', { event_type: 'AI_ASK' });
  await live.fetchClassroomValidationReport(fetchImpl, 'session-1');
  assert.deepEqual(calls.map((item) => [item.url, item.options.method || 'GET']), [
    ['/api/live/sessions/session-1/classroom-validation', 'POST'],
    ['/api/live/sessions/session-1/classroom-validation/events', 'POST'],
    ['/api/live/sessions/session-1/classroom-validation/report', 'GET'],
  ]);
});
