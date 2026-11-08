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
