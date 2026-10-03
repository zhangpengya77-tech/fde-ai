const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const live = require('./live.js');

test('task entry auto-starts camera only after the learner granted permission once', () => {
  assert.equal(live.shouldAutoStartCamera({ taskSelected: true, permissionGranted: true, cameraActive: false }), true);
  assert.equal(live.shouldAutoStartCamera({ taskSelected: true, permissionGranted: false, cameraActive: false }), false);
  assert.equal(live.shouldAutoStartCamera({ taskSelected: true, permissionGranted: true, cameraActive: true }), false);
});

test('hands-free coach requires opt-in and resumes standby after each recognition cycle', () => {
  const recognitions = [];
  const transcripts = [];
  let busy = false;
  const coach = live.createHandsFreeVoiceCoach({
    recognitionFactory: () => {
      const recognition = { startCalls: 0, stopCalls: 0, start() { this.startCalls += 1; }, stop() { this.stopCalls += 1; } };
      recognitions.push(recognition);
      return recognition;
    },
    onTranscript: (value) => transcripts.push(value),
    isBusy: () => busy,
    isPageActive: () => true
  });
  assert.equal(recognitions.length, 0, 'microphone must not start before opt-in');
  coach.enable();
  assert.equal(recognitions.length, 1);
  recognitions[0].onresult({ results: [{ 0: { transcript: '下一步呢？' }, isFinal: true }] });
  assert.deepEqual(transcripts, ['下一步呢？']);
  busy = true;
  recognitions[0].onend();
  assert.equal(recognitions.length, 1, 'must not listen while AI is answering');
  busy = false;
  coach.resumeAfterAnswer();
  assert.equal(recognitions.length, 2);
});

test('hands-free coach pauses on page hide and stays off after learner pause', () => {
  let active = true;
  const recognitions = [];
  const coach = live.createHandsFreeVoiceCoach({
    recognitionFactory: () => { const recognition = { start() {}, stopCalls: 0, stop() { this.stopCalls += 1; } }; recognitions.push(recognition); return recognition; },
    isPageActive: () => active
  });
  coach.enable();
  active = false;
  coach.handleVisibilityChange();
  assert.equal(recognitions[0].stopCalls, 1);
  coach.pause();
  active = true;
  coach.handleVisibilityChange();
  assert.equal(recognitions.length, 1);
});

test('hands-free coach falls back cleanly when browser recognition cannot start', () => {
  const errors = [];
  const states = [];
  const coach = live.createHandsFreeVoiceCoach({
    recognitionFactory: () => ({ start() { throw new Error('not-allowed'); }, stop() {} }),
    onError: (error) => errors.push(error.message),
    onState: (state) => states.push(state),
    isPageActive: () => true
  });
  assert.equal(coach.enable(), false);
  assert.equal(coach.isEnabled(), false);
  assert.deepEqual(errors, ['not-allowed']);
  assert.equal(states.at(-1), 'IDLE');
});

test('live preview monitor records changing frame timestamps and reports a frozen preview', () => {
  const frames = [];
  const frozen = [];
  let callback;
  const video = { currentTime: 0, requestVideoFrameCallback(fn) { callback = fn; return 7; }, cancelVideoFrameCallback() {} };
  const monitor = live.createLivePreviewMonitor(video, { onFrame: (value) => frames.push(value), onFrozen: () => frozen.push(true), now: () => 1234 });
  monitor.start();
  video.currentTime = 0.1;
  callback(0, { mediaTime: 0.1 });
  assert.deepEqual(frames, [1234]);
  monitor.checkFrozen(7000);
  assert.deepEqual(frozen, [true]);
  monitor.stop();
});

test('student page presents one Live Coach action and moves manual tools into collapsed fallback', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id="enableVoiceCoach"[^>]*>开启语音助教</);
  assert.match(html, /id="pauseVoiceCoach"/);
  assert.match(html, /id="liveCoachStatus"[^>]*>AI 已待命</);
  assert.match(html, /id="latestAiAnswer"/);
  assert.match(html, /<details id="fallbackMethods"[^>]*>\s*<summary>更多方式 \/ 备用方式<\/summary>/);
  assert.doesNotMatch(html, /<details id="fallbackMethods"[^>]*\sopen/);
});

test('ready message stays separate from the last real answer', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id="liveCoachStatus">AI 已待命</);
  assert.match(html, /id="latestAiAnswer">尚无 AI 回答。/);
  assert.doesNotMatch(html, /id="latestAiAnswer">AI 助教已准备好/);
});
test('Live Coach keeps preview local and Vision explicit single-frame', () => {
  assert.deepEqual(live.cameraPreviewPolicy(), { localPreview: true, continuousVision: false, captureMode: 'explicit_single_frame' });
});
