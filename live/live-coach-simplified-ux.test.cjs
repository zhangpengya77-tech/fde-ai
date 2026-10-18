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

test('hands-free coach renders interim speech and submits an interim transcript after end grace', () => {
  const recognitions = [];
  const interim = [];
  const submitted = [];
  const timers = [];
  const coach = live.createHandsFreeVoiceCoach({
    recognitionFactory: () => { const recognition = { start() {}, stop() {} }; recognitions.push(recognition); return recognition; },
    onInterim: (value) => interim.push(value),
    onTranscript: (value) => submitted.push(value),
    isBusy: () => submitted.length > 0,
    isPageActive: () => true,
    setTimeoutImpl: (callback) => { timers.push(callback); return timers.length; },
    clearTimeoutImpl: () => {}
  });
  coach.enable();
  recognitions[0].onresult({ results: [{ 0: { transcript: '下一步呢' }, isFinal: false }] });
  assert.deepEqual(interim, ['下一步呢']);
  assert.deepEqual(submitted, []);
  recognitions[0].onend();
  timers[0]();
  assert.deepEqual(submitted, ['下一步呢']);
});

test('late final result after onend submits exactly once', () => {
  const recognitions = [];
  const submitted = [];
  const timers = [];
  const coach = live.createHandsFreeVoiceCoach({
    recognitionFactory: () => { const recognition = { start() {}, stop() {} }; recognitions.push(recognition); return recognition; },
    onTranscript: (value) => submitted.push(value),
    isBusy: () => submitted.length > 0,
    isPageActive: () => true,
    setTimeoutImpl: (callback) => { timers.push(callback); return timers.length; },
    clearTimeoutImpl: () => {}
  });
  coach.enable();
  recognitions[0].onend();
  recognitions[0].onresult({ results: [{ 0: { transcript: '下一步呢？' }, isFinal: true }] });
  timers[0]();
  assert.deepEqual(submitted, ['下一步呢？']);
});

test('student page presents one Live Coach action and moves manual tools into collapsed fallback', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id="enableVoiceCoach"[^>]*>開始詢問 AI</);
  assert.match(html, /id="pauseVoiceCoach"[^>]*hidden[^>]*>暫停語音</);
  assert.match(html, /id="liveCoachStatus"[^>]*>AI 已待命</);
  assert.match(html, /id="latestAiAnswer"/);
  assert.match(html, /<details id="fallbackMethods"[^>]*>\s*<summary>无法使用语音？<\/summary>/);
  assert.doesNotMatch(html, /<details id="fallbackMethods"[^>]*\sopen/);
});

test('classroom layout keeps camera first while transcript and answer stay together', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const panel = html.indexOf('id="liveCoachConversation"');
  const transcript = html.indexOf('id="lastUserTranscript"');
  const answer = html.indexOf('id="latestAiAnswer"');
  const camera = html.indexOf('id="cameraTool"');
  assert.ok(camera >= 0 && panel > camera && transcript > panel && answer > transcript);
  assert.match(html, /你剛剛說/);
  assert.match(html, /<summary>无法使用语音？<\/summary>/);
  assert.match(html, /live\.css\?v=live-coach-mvp1/);
  assert.match(html, /live\.js\?v=live-coach-mvp1/);
});

test('ready message stays separate from the last real answer', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id="liveCoachStatus">AI 已待命</);
  assert.match(html, /id="latestAiAnswer">尚无 AI 回答。/);
  assert.doesNotMatch(html, /id="latestAiAnswer">AI 助教已准备好/);
});

test('student answer shows a small AI reference label without exposing RAG state', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, 'live.js'), 'utf8');
  assert.match(html, /id="answerSourceLabel"/);
  assert.match(source, /AI_REFERENCE[^\n]+AI 參考回答/);
  assert.doesNotMatch(html, />RAG MISS</);
  assert.doesNotMatch(html, />Knowledge unavailable</);
});
test('Live Coach keeps preview local and Vision explicit single-frame', () => {
  assert.deepEqual(live.cameraPreviewPolicy(), { localPreview: true, continuousVision: false, captureMode: 'explicit_single_frame' });
});

test('Task01 MVP screen keeps only task, live camera, chat, and one ask action visible', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const task = html.indexOf('id="trainingTitle"');
  const camera = html.indexOf('id="cameraTool"');
  const chat = html.indexOf('id="liveCoachConversation"');
  const ask = html.indexOf('id="enableVoiceCoach"');
  const more = html.indexOf('id="moreWays"');
  assert.ok(task >= 0 && camera > task && chat > camera && ask > chat);
  assert.match(html, /id="enableVoiceCoach"[^>]*>開始詢問 AI</);
  assert.match(html, /id="pauseVoiceCoach"[^>]*hidden[^>]*>暫停語音</);
  assert.ok(html.indexOf('id="currentStepCard"') > more, 'step explanation belongs in collapsed content');
  assert.ok(html.indexOf('id="fallbackMethods"') > more, 'manual tools belong in collapsed content');
});
