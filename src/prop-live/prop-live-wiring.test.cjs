// 即時鏡頭串接檢查（node --test）：載入順序、不問不講話、框顏色必須由穩定結果決定
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const live = fs.readFileSync(path.join(__dirname, 'prop-live.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

test('index.html 依序載入：判定 → 設定 → 穩定化 → 問答 → 即時鏡頭，且都在 app.js 之前', () => {
  const order = ['prop-live/prop-judge.js', 'prop-live/prop-live-config.js', 'prop-live/prop-stabilizer.js', 'prop-live/prop-qa.js', 'prop-live/prop-live.js', 'src/app.js'];
  const positions = order.map((name) => html.indexOf(name));
  assert.ok(positions.every((p) => p > 0), '每個腳本都要載入');
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test('不問不講話：朗讀只發生在學員發問（askQuestion）裡', () => {
  // 只看本模組自己的 speak(...) 呼叫：排除 speechSynthesis.speak(...)（speak 函式內部）與 function speak 定義
  const calls = [...live.matchAll(/(?<![.\w])speak\(/g)].map((m) => m.index);
  const askStart = live.indexOf('async function askQuestion');
  const askEnd = live.indexOf('function listen');
  const outside = calls.filter((i) => (i < askStart || i > askEnd) && !live.slice(i - 9, i).includes('function'));
  assert.ok(calls.length >= 2, '至少要找到發問時的 speak 呼叫');
  assert.deepEqual(outside, [], 'askQuestion 以外不得呼叫 speak()');
  const onResult = live.slice(live.indexOf('function onResult'), live.indexOf('/** 疊框'));
  assert.doesNotMatch(onResult, /speak|askRag|asker/);
});

test('框的顏色由穩定結果決定：本幀與穩定簽章不一致時一律灰色', () => {
  const onResult = live.slice(live.indexOf('function onResult'), live.indexOf('/** 疊框'));
  assert.match(onResult, /stabilizer\.push/);
  assert.match(onResult, /stableInfo\.frameSignature === stableInfo\.signature/);
  assert.match(onResult, /color: 'gray'/);
});

test('答案面板顯示穩定結果（含修正完成），而不是單幀結果', () => {
  const render = live.slice(live.indexOf('function render('), live.indexOf('// ---- 問答'));
  assert.match(render, /stableInfo\.stable/);
  assert.match(render, /fixed: stableInfo\.fixed/);
});

// 2026-11-18 測試模式（?test=1）：必須出現綠／紅色，且平常模式不受影響
test('測試模式：只有網址帶 test=1 才啟用', () => {
  global.document = global.document || { baseURI: 'http://x/', readyState: 'loading', addEventListener() {} };
  require('./prop-live.js');
  const { isTestMode } = globalThis.FdePropLive;
  assert.equal(isTestMode({ search: '?test=1', hash: '' }), true);
  assert.equal(isTestMode({ search: '', hash: '#eagle&test=1' }), true);
  assert.equal(isTestMode({ search: '?test=10', hash: '' }), false);
  assert.equal(isTestMode({ search: '', hash: '' }), false);
});

test('測試模式：判不出時依象限上綠／紅，絕不出現灰色', () => {
  const { testModeBoxes } = globalThis.FdePropLive;
  const rules = { layout: { TL: 'CW', TR: 'CCW', BL: 'CCW', BR: 'CW' } };
  const j = { state: 'UNCERTAIN', boxes: [
    { bbox: [10, 10, 50, 50], class: 'CW', confidence: 0.32, color: 'gray' },   // 左上應 CW → 綠
    { bbox: [700, 500, 760, 560], class: 'CCW', confidence: 0.3, color: 'gray' }, // 右下應 CW → 紅
  ] };
  const out = testModeBoxes(j, rules, 800, 600);
  assert.deepEqual(out.map((b) => b.color), ['green', 'red']);
  const judged = { state: 'OK', boxes: [{ bbox: [0, 0, 1, 1], class: 'CW', color: 'red' }] };
  assert.equal(testModeBoxes(judged, rules, 800, 600)[0].color, 'red');
});

test('平常模式：onResult 仍只在非測試模式用穩定結果疊框', () => {
  const onResult = live.slice(live.indexOf('function onResult'), live.indexOf('/** 疊框'));
  assert.match(onResult, /if \(!state\.testMode\) draw\(shown/);
});
