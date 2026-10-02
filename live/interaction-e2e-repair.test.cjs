const test = require('node:test');
const assert = require('node:assert/strict');
const live = require('./live.js');

function fakeButton() {
  const handlers = {};
  return { dataset: {}, textContent: '', attrs: {}, addEventListener: (name, fn) => { handlers[name] = fn; }, setAttribute(name, value) { this.attrs[name] = value; }, fire(name) { handlers[name]?.({ preventDefault() {} }); } };
}

test('interaction watchdog records timeout and always returns to IDLE', () => {
  const events = [];
  let timer;
  const machine = live.createInteractionStateMachine({ onChange: (event) => events.push(event.state), setTimeoutImpl: (fn) => { timer = fn; return 1; }, clearTimeoutImpl() {} });
  machine.transition('TRANSCRIBING');
  timer();
  assert.deepEqual(events, ['TRANSCRIBING', 'ERROR', 'IDLE']);
  assert.equal(machine.state(), 'IDLE');
});

test('speech end without a result reports no speech and returns IDLE', () => {
  const button = fakeButton();
  let recognition;
  let noResult = 0;
  const states = [];
  live.bindPushToTalk(button, { recognitionFactory: () => (recognition = { start() {}, stop() {} }), onState: (state) => states.push(state), onNoResult: () => { noResult += 1; } });
  button.fire('pointerdown');
  button.fire('pointerup');
  recognition.onend();
  assert.equal(noResult, 1);
  assert.equal(states.at(-1), 'IDLE');
});

test('result arriving before pointerup is not overwritten by TRANSCRIBING', () => {
  const button = fakeButton();
  let recognition;
  const states = [];
  const results = [];
  live.bindPushToTalk(button, { recognitionFactory: () => (recognition = { start() {}, stop() {} }), onState: (state) => states.push(state), onResult: (value) => results.push(value) });
  button.fire('pointerdown');
  recognition.onresult({ results: [{ 0: { transcript: '下一步呢？' }, isFinal: true }] });
  button.fire('pointerup');
  recognition.onend();
  assert.deepEqual(results, ['下一步呢？']);
  assert.notEqual(states.at(-1), 'TRANSCRIBING');
});

test('Ask carries request ids and times out instead of hanging', async () => {
  let payload;
  const fetchImpl = async (_url, options) => { payload = JSON.parse(options.body); return new Promise(() => {}); };
  await assert.rejects(live.askLiveCoach(fetchImpl, 's1', '下一步呢？', null, { timeoutMs: 5, requestId: 'ask-1', interactionId: 'voice-1' }), /ask_timeout/);
  assert.equal(payload.request_id, 'ask-1');
  assert.equal(payload.interaction_id, 'voice-1');
});

test('camera readiness rejects inactive or empty video without a request', () => {
  assert.equal(live.isCameraFrameReady({ getVideoTracks: () => [{ readyState: 'ended' }] }, { readyState: 4, videoWidth: 640, videoHeight: 480 }), false);
  assert.equal(live.isCameraFrameReady({ getVideoTracks: () => [{ readyState: 'live' }] }, { readyState: 1, videoWidth: 640, videoHeight: 480 }), false);
  assert.equal(live.isCameraFrameReady({ getVideoTracks: () => [{ readyState: 'live' }] }, { readyState: 4, videoWidth: 640, videoHeight: 480 }), true);
});
