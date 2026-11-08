// 問答模組測試（node --test）：不問不答、對錯由規則決定、只有錯才查知識庫且同一狀態只查一次、失敗只回規則文字。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { judgePropellers } = require('./prop-judge.js');
const { createAsker, buildRuleAnswer } = require('./prop-qa.js');

const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, 'prop-judge-rules.json'), 'utf8'));
const MSG = JSON.parse(fs.readFileSync(path.join(__dirname, 'prop-live.zh-TW.json'), 'utf8'));

function quad(classes) {
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([ox, oy], i) => ({
    class: classes[i], confidence: 0.9, bbox: [640 + ox * 200 - 70, 360 + oy * 200 - 70, 640 + ox * 200 + 70, 360 + oy * 200 + 70],
  }));
}
const info = (classes, extra) => {
  const stable = judgePropellers(classes ? quad(classes) : [], RULES);
  const signature = stable.state === 'WRONG' ? `WRONG:${stable.wrong.join(',')}` : stable.state;
  return { stable, signature, fixed: false, ...extra };
};
function fakeRag(answer) {
  const calls = [];
  const fn = async (q) => { calls.push(q); if (answer instanceof Error) throw answer; return { answer }; };
  fn.calls = calls;
  return fn;
}

test('還在判斷中（沒有穩定結果）：請學員拿穩再問，不查知識庫', async () => {
  const rag = fakeRag('x');
  const a = createAsker({ askRag: rag, messages: MSG, rules: RULES });
  const r = await a.ask('對嗎？', { stable: null, signature: '', fixed: false });
  assert.equal(r.kind, 'judging');
  assert.equal(r.ruleText, '還在判斷中，請拿穩鏡頭幾秒後再問一次。');
  assert.equal(rag.calls.length, 0);
});

test('正確：回答「對」，不查知識庫', async () => {
  const rag = fakeRag('x');
  const r = await createAsker({ askRag: rag, messages: MSG, rules: RULES }).ask('我這樣裝對嗎？', info(['CW', 'CCW', 'CCW', 'CW']));
  assert.equal(r.kind, 'correct');
  assert.equal(r.ruleText, '對，目前四支槳都已換到正確位置。');
  assert.equal(rag.calls.length, 0);
});

test('修正完成後發問：回答「你已經換到正確的了」', async () => {
  const r = await createAsker({ askRag: null, messages: MSG, rules: RULES }).ask('', info(['CW', 'CCW', 'CCW', 'CW'], { fixed: true }));
  assert.equal(r.ruleText, '對，你已經換到正確的了。');
});

test('錯：先講「不對」、逐位置說明、附正確裝法；知識庫補充放在後面', async () => {
  const rag = fakeRag('因為對角槳要同旋向以抵消反扭力。');
  const r = await createAsker({ askRag: rag, messages: MSG, rules: RULES }).ask('哪裡錯了？', info(['CCW', 'CCW', 'CCW', 'CW']));
  assert.equal(r.kind, 'wrong');
  assert.equal(r.ruleText, '不對。左上應為 CW，目前是 CCW，請依正確方向更換。正確裝法（俯視、機頭朝上）：左上 CW、右上 CCW、左下 CCW、右下 CW。');
  assert.equal(r.ragText, '因為對角槳要同旋向以抵消反扭力。');
  assert.ok(r.speech.startsWith(r.ruleText));
  assert.match(rag.calls[0], /學員問：「哪裡錯了？」/);
  assert.match(rag.calls[0], /不要重新判斷/);
});

test('同一個錯誤狀態重複發問：知識庫只呼叫一次', async () => {
  const rag = fakeRag('補充');
  const a = createAsker({ askRag: rag, messages: MSG, rules: RULES });
  const s = info(['CCW', 'CCW', 'CCW', 'CW']);
  await a.ask('對嗎', s);
  await a.ask('那怎麼換', s);
  await Promise.all([a.ask('再問一次', s), a.ask('又問', s)]);
  assert.equal(rag.calls.length, 1);
});

test('錯誤位置改變（新的錯誤狀態）才會再查一次', async () => {
  const rag = fakeRag('補充');
  const a = createAsker({ askRag: rag, messages: MSG, rules: RULES });
  await a.ask('', info(['CCW', 'CCW', 'CCW', 'CW']));
  await a.ask('', info(['CW', 'CCW', 'CCW', 'CCW']));
  assert.equal(rag.calls.length, 2);
});

test('知識庫失敗：只回答規則文字（仍然講出對錯與正確答案）', async () => {
  const r = await createAsker({ askRag: fakeRag(new Error('down')), messages: MSG, rules: RULES }).ask('對嗎', info(['CCW', 'CCW', 'CCW', 'CW']));
  assert.equal(r.ragText, null);
  assert.equal(r.speech, r.ruleText);
  assert.match(r.ruleText, /^不對。/);
});

test('知識庫逾時：只回答規則文字', async () => {
  const slow = () => new Promise((resolve) => setTimeout(() => resolve({ answer: '太慢' }), 200));
  const r = await createAsker({ askRag: slow, messages: MSG, rules: RULES, timeoutMs: 20 }).ask('', info(['CCW', 'CCW', 'CCW', 'CW']));
  assert.equal(r.ragText, null);
});

test('無法判斷：只說無法判斷並請找老師，不查知識庫、不說對或錯', async () => {
  const rag = fakeRag('x');
  const r = await createAsker({ askRag: rag, messages: MSG, rules: RULES }).ask('對嗎', info(['CW', 'CCW', 'CCW']));
  assert.equal(r.kind, 'uncertain');
  assert.ok(r.ruleText.startsWith('我無法判斷，請找線下老師確認。'));
  assert.doesNotMatch(r.ruleText, /^對|^不對/);
  assert.equal(rag.calls.length, 0);
});

test('全反：說明四支都錯並提醒確認機頭與鏡像', () => {
  const r = buildRuleAnswer(info(['CCW', 'CW', 'CW', 'CCW']), MSG, RULES);
  assert.match(r.text, /鏡像/);
  assert.equal((r.text.match(/應為/g) || []).length, 4);
});

test('正確裝法文字由設定檔 layout 產生（改設定就跟著變）', () => {
  const swapped = { ...RULES, layout: { TL: 'CCW', TR: 'CW', BL: 'CW', BR: 'CCW' } };
  const s = judgePropellers(quad(['CW', 'CW', 'CW', 'CCW']), swapped);
  const r = buildRuleAnswer({ stable: s, signature: 'WRONG:TL', fixed: false }, MSG, swapped);
  assert.match(r.text, /左上 CCW、右上 CW、左下 CW、右下 CCW/);
});
