const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('student-facing live coach uses required Traditional Chinese labels', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, 'live.js'), 'utf8');
  for (const phrase of ['暫停語音', '你剛剛說']) assert.match(html, new RegExp(phrase));
  assert.doesNotMatch(html, /播放回答|停止播放/);
  for (const phrase of ['正在聽', 'AI 正在思考', 'AI 參考回答', '需要教師確認', '目前畫面', '下一步', '再試一次']) assert.match(js, new RegExp(phrase));
  for (const phrase of ['RAG MISS', 'Knowledge unavailable', 'credit_balance_exhausted', 'HTTP 429']) assert.doesNotMatch(html + js, new RegExp(phrase, 'i'));
});
