// 2026-11-04：學員不講話時，語音助教靜置待命（不關閉、不呼叫 AI），講話時才送出問題。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const live = require('./live.js');

/** 建立可手動觸發計時器的假環境，模擬瀏覽器語音辨識的各種結束方式。 */
function harness({ busy = () => false } = {}) {
  const recognitions = [];
  const timers = [];
  const transcripts = [];
  const errors = [];
  const states = [];
  const coach = live.createHandsFreeVoiceCoach({
    recognitionFactory: () => {
      const recognition = { start() {}, stop() {} };
      recognitions.push(recognition);
      return recognition;
    },
    onTranscript: (value) => transcripts.push(value),
    onError: (code) => errors.push(code),
    onState: (state) => states.push(state),
    isBusy: busy,
    setTimeoutImpl: (fn) => { timers.push(fn); return timers.length; },
    clearTimeoutImpl: () => {}
  });
  const flush = () => { while (timers.length) timers.shift()(); };
  return { coach, recognitions, transcripts, errors, states, flush };
}

test('no-speech 不關閉語音，安靜地重新聆聽', () => {
  const h = harness();
  h.coach.enable();
  h.recognitions[0].onerror({ error: 'no-speech' });
  h.flush();
  assert.equal(h.coach.isEnabled(), true);
  assert.equal(h.recognitions.length, 2, '應自動開始下一輪聆聽');
  assert.deepEqual(h.errors, [], '靜音不是錯誤');
  assert.deepEqual(h.transcripts, [], '沒講話不呼叫 AI');
});

test('一輪結束但沒有內容時繼續待命（原本會被當成 speech-unstable 關閉）', () => {
  const h = harness();
  h.coach.enable();
  h.recognitions[0].onend();
  h.flush();
  assert.equal(h.coach.isEnabled(), true);
  assert.equal(h.recognitions.length, 2);
  assert.ok(h.states.includes('VOICE_STANDBY'));
  assert.deepEqual(h.errors, []);
});

test('長時間不講話可一直待命，講話時才送出問題', () => {
  const h = harness();
  h.coach.enable();
  for (let i = 0; i < 5; i += 1) {
    h.recognitions.at(-1).onerror({ error: 'no-speech' });
    h.flush();
  }
  assert.equal(h.recognitions.length, 6);
  h.recognitions.at(-1).onresult({ results: [{ 0: { transcript: '這個槳裝對了嗎？' }, isFinal: true }] });
  assert.deepEqual(h.transcripts, ['這個槳裝對了嗎？']);
});

test('麥克風權限被拒時才真的停止並回報', () => {
  const h = harness();
  h.coach.enable();
  h.recognitions[0].onerror({ error: 'not-allowed' });
  h.flush();
  assert.equal(h.coach.isEnabled(), false);
  assert.deepEqual(h.errors, ['not-allowed']);
  assert.equal(h.recognitions.length, 1);
});

test('網路錯誤退避重試，連續太多次才停止', () => {
  const h = harness();
  h.coach.enable();
  for (let i = 0; i < 5; i += 1) {
    h.recognitions.at(-1).onerror({ error: 'network' });
    h.flush();
  }
  assert.equal(h.coach.isEnabled(), true);
  h.recognitions.at(-1).onerror({ error: 'network' });
  h.flush();
  assert.equal(h.coach.isEnabled(), false);
  assert.deepEqual(h.errors, ['network']);
});

test('暫停後不會被待命計時器重新打開麥克風', () => {
  const h = harness();
  h.coach.enable();
  h.recognitions[0].onerror({ error: 'no-speech' });
  h.coach.pause();
  h.flush();
  assert.equal(h.recognitions.length, 1);
});

test('AI 回答中不聆聽，回答完再待命', () => {
  let busy = false;
  const h = harness({ busy: () => busy });
  h.coach.enable();
  busy = true;
  h.recognitions[0].onerror({ error: 'no-speech' });
  h.flush();
  assert.equal(h.recognitions.length, 1, 'AI 回答中不開麥克風');
  busy = false;
  h.coach.resumeAfterAnswer();
  assert.equal(h.recognitions.length, 2);
});

test('鏡頭開著時，繁體口語提問會讀取當前畫面；安全問題不靠畫面', () => {
  assert.equal(live.questionRequiresVision('這樣裝對嗎？'), true);
  assert.equal(live.questionRequiresVision('幫我看電調接線'), true);
  assert.equal(live.questionRequiresVision('可以上電了嗎？'), false);
  assert.equal(live.questionRequiresVision('可以解鎖起飛嗎'), false);
});

test('學員頁一鍵開始 AI 陪做（鏡頭＋語音）', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id="enableVoiceCoach"[^>]*>開始 AI 陪做（鏡頭＋語音）</);
});

test('iPhone 擋下自動聆聽（沒有 onstart）時，回報 start-blocked 並停止待命', () => {
  const recognitions = [];
  const timers = [];
  const errors = [];
  const coach = live.createHandsFreeVoiceCoach({
    recognitionFactory: () => { const r = { start() {}, abort() { this.aborted = true; } }; recognitions.push(r); return r; },
    onError: (code) => errors.push(code),
    setTimeoutImpl: (fn) => { timers.push(fn); return timers.length; },
    clearTimeoutImpl: () => {},
    startTimeoutMs: 2500
  });
  coach.enable();
  timers.shift()();  // 2.5 秒到了，仍沒有 onstart
  assert.deepEqual(errors, ['start-blocked']);
  assert.equal(coach.isEnabled(), false);
  assert.equal(recognitions[0].aborted, true);
});

test('有真正開始聆聽（onstart）就不會被判定擋下', () => {
  const timers = [];
  const errors = [];
  const recognitions = [];
  const coach = live.createHandsFreeVoiceCoach({
    recognitionFactory: () => { const r = { start() {} }; recognitions.push(r); return r; },
    onError: (code) => errors.push(code),
    setTimeoutImpl: (fn) => { timers.push(fn); return timers.length; },
    clearTimeoutImpl: () => {},
    startTimeoutMs: 2500
  });
  coach.enable();
  recognitions[0].onstart();
  timers.forEach((fn) => fn());
  assert.deepEqual(errors, []);
  assert.equal(coach.isEnabled(), true);
});
