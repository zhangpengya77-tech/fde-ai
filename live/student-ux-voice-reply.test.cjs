const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const live = require('./live.js');

test('current step presentation explains one action in plain language', () => {
  const view = live.studentCurrentStepView({
    step_id: 'T01_WORKSPACE', title: '準備工作區域',
    student_instruction: '清空桌面並集中擺放零件，暫時不要組裝。'
  });
  assert.equal(view.title, '準備工作區域');
  assert.deepEqual(view.how, ['清空桌面', '把 F450 零件全部集中擺放', '電池先不要接電', '槳葉暫時不要安裝']);
  assert.deepEqual(view.doneWhen, ['所有零件都在桌面', '飛機沒有接電', '槳葉沒有安裝', '工作區域沒有雜物']);
});

test('missing step never renders Step 0 / 0', () => {
  assert.equal(live.studentStepProgressLabel(null, []), '正在準備當前步驟…');
  assert.equal(live.studentStepProgressLabel({ order: 2 }, [{}, {}, {}]), '當前第 2 步');
});

test('student page keeps full task flow collapsed and one primary CTA', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /<details[^>]*class="step-map"(?![^>]*\sopen)/);
  assert.match(html, /查看整個任務流程/);
  assert.equal((html.match(/id="primaryTrainingAction"/g) || []).length, 1);
  assert.doesNotMatch(html, />Step 0 \/ 0</);
});

test('teacher step uses teacher confirmation while normal step says I am done', () => {
  assert.deepEqual(live.studentPrimaryAction({ task_state: 'IN_PROGRESS', current_training_step_id: 'STEP_1', current_step: { step_id: 'STEP_1' } }), { kind: 'STEP', label: '我完成了' });
  assert.deepEqual(live.studentPrimaryAction({ task_state: 'IN_PROGRESS', current_training_step_id: 'STEP_1', current_step: { step_id: 'STEP_1', teacher_gate: true } }), { kind: 'TEACHER', label: '請教師確認' });
});

test('embedded browser and Safari capabilities are detected separately', () => {
  const embedded = live.detectBrowserCapabilities({ userAgent: 'Mozilla/5.0 iPhone BytedanceWebview Aweme', mediaDevices: {}, speechRecognition: null, speechSynthesis: null });
  assert.equal(embedded.browser, 'Embedded WebView');
  assert.equal(embedded.embedded, true);
  assert.equal(embedded.speechInput, false);
  const safari = live.detectBrowserCapabilities({ userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', mediaDevices: { getUserMedia() {}, getSupportedConstraints: () => ({ facingMode: true }) }, speechRecognition: function () {}, speechSynthesis: {} });
  assert.equal(safari.browser, 'Safari');
  assert.equal(safari.embedded, false);
  assert.equal(safari.camera, true);
  assert.equal(safari.speechInput, true);
  assert.equal(safari.speechOutput, true);
});

test('Chinese TTS prefers zh-TW then falls back to zh-CN', () => {
  const cn = { lang: 'zh-CN', name: 'CN' };
  const tw = { lang: 'zh-TW', name: 'TW' };
  assert.equal(live.selectChineseVoice([cn, tw]), tw);
  assert.equal(live.selectChineseVoice([cn]), cn);
});

test('speech reply speaks at classroom pace and can stop', () => {
  const spoken = [];
  let cancelled = 0;
  const synthesis = { getVoices: () => [{ lang: 'zh-TW' }], speak: (utterance) => spoken.push(utterance), cancel: () => { cancelled += 1; } };
  function Utterance(text) { this.text = text; }
  const reply = live.createSpeechReply({ synthesis, Utterance });
  assert.equal(reply.speak('現在先清空桌面。'), true);
  assert.equal(spoken[0].lang, 'zh-TW');
  assert.equal(spoken[0].rate, 0.95);
  reply.stop();
  assert.equal(cancelled, 2);
});

test('speech reply reports unsupported TTS without silent failure', () => {
  const reply = live.createSpeechReply({ synthesis: null, Utterance: null });
  assert.equal(reply.speak('回答'), false);
  assert.equal(reply.supported, false);
});

test('voice answer is limited to three short points', () => {
  assert.equal(live.voiceAnswerSummary('第一點。第二點。第三點。第四點。'), '第一點。第二點。第三點。');
});

test('every student question auto speaks while subtitle remains available', () => {
  const spoken = [];
  const speechReply = { supported: true, speak: (text) => { spoken.push(text); return true; } };
  assert.deepEqual(live.deliverAiAnswer('第一點。第二點。第三點。第四點。', { autoSpeak: true, speechReply }), { text: '第一點。第二點。第三點。第四點。', spoken: true });
  assert.deepEqual(live.deliverAiAnswer('文字問題回答。', { autoSpeak: true, speechReply }), { text: '文字問題回答。', spoken: true });
  assert.deepEqual(spoken, ['第一點。第二點。第三點。', '文字問題回答。']);
});

test('voice reply controls and embedded browser warning exist in Student Mode', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const id of ['browserCapabilityWarning','copyCurrentLink','currentStepHow','currentStepDoneWhen']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /建議使用 Safari 打開本頁面/);
});

test('Student Mode does not render playback or stop controls', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /id="playAiAnswer"/);
  assert.doesNotMatch(html, /id="stopAiAnswer"/);
});