const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const live = require('./live.js');

test('assistant visual action opens camera when off and observes when on', () => {
  assert.deepEqual(live.assistantVisualActionState(false), { action: 'OPEN_CAMERA', label: '📷 打开摄像头' });
  assert.deepEqual(live.assistantVisualActionState(true), { action: 'OBSERVE_FRAME', label: '🤖 AI 看当前画面' });
});

test('voice entry remains visible and reports unsupported capability', () => {
  assert.deepEqual(live.voiceEntryState(true), { label: '🎙 按住说话', available: true });
  assert.deepEqual(live.voiceEntryState(false), { label: '🎙 语音暂不可用', available: false });
});

test('Live Coach keeps the natural voice action visible and moves manual tools into fallback', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /<section id="aiTools" class="live-coach-card">/);
  assert.match(html, /id="enableVoiceCoach"[^>]*>開始詢問 AI</);
  assert.match(html, /id="pauseVoiceCoach"[^>]*hidden[^>]*>暫停語音</);
  assert.match(html, /<details id="fallbackMethods"[^>]*>/);
  assert.doesNotMatch(html, /<details id="fallbackMethods"[^>]*\sopen/);
  for (const id of ['pushToTalk', 'textAskAi', 'assistantVisualAction']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /🤖 AI 看当前画面|📷 打开摄像头/);
});

test('generic visual observation captures exactly one frame through Ask and never completes a step', async () => {
  let captures = 0;
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ answer: '请把零件集中放进画面。', vision_used: true }) };
  };
  await live.askLiveCoach(fetchImpl, 'session-1', live.genericVisualObservationQuestion(), () => {
    captures += 1;
    return { imageData: 'data:image/jpeg;base64,AA==' };
  });
  assert.equal(captures, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/ask$/);
  assert.doesNotMatch(calls[0].url, /complete|confirm|teacher/);
});
