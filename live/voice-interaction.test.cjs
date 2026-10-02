const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { bindPushToTalk } = require('./live.js');

function fakeButton() {
  const handlers = {};
  return {
    handlers,
    textContent: '按住说话',
    dataset: {},
    classList: { add() {}, remove() {} },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(name, handler) { handlers[name] = handler; }
  };
}

test('push-to-talk handles pointer down up and cancel with pressed feedback', () => {
  const button = fakeButton();
  const states = [];
  let started = 0;
  let stopped = 0;
  const recognition = { start() { started += 1; }, stop() { stopped += 1; }, abort() { stopped += 1; } };
  bindPushToTalk(button, { recognitionFactory: () => recognition, onState: (state) => states.push(state) });
  button.handlers.pointerdown({ preventDefault() {}, pointerId: 4 });
  assert.equal(button.textContent, '🎙 正在听……');
  assert.equal(button['aria-pressed'], 'true');
  button.handlers.pointerup({ preventDefault() {}, pointerId: 4 });
  assert.equal(button.textContent, '处理中……');
  button.handlers.pointercancel({ preventDefault() {}, pointerId: 4 });
  assert.equal(started, 1);
  assert.ok(stopped >= 1);
  assert.deepEqual(states.slice(0, 2), ['LISTENING', 'PROCESSING']);
});

test('push-to-talk prevents context menu and exposes unavailable fallback', () => {
  const button = fakeButton();
  let prevented = false;
  let fallback = '';
  bindPushToTalk(button, { recognitionFactory: null, onUnavailable: (message) => { fallback = message; } });
  button.handlers.contextmenu({ preventDefault() { prevented = true; } });
  button.handlers.pointerdown({ preventDefault() {}, pointerId: 1 });
  assert.equal(prevented, true);
  assert.equal(fallback, '语音功能暂未启用，请先使用文字问 AI。');
});

test('voice and text ask controls are real interactive elements with scoped touch protection', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'live.css'), 'utf8');
  for (const id of ['pushToTalk','textAskAi','askAiPanel','askAiInput','submitAskAi','voiceStatus']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /id="pushToTalk"[^>]*>(?:🎙 )?按住说话</);
  assert.match(css, /\.push-to-talk[^}]*user-select:\s*none/s);
  assert.match(css, /\.push-to-talk[^}]*-webkit-touch-callout:\s*none/s);
});

test('text ask uses the contextual backend while unavailable speech keeps an explicit fallback', () => {
  const source = fs.readFileSync(path.join(__dirname, 'live.js'), 'utf8');
  assert.match(source, /\/api\/live\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/ask/);
  assert.match(source, /目前 AI 教学说明暂时不可用/);
  assert.match(source, /VOICE_PROVIDER_NOT_CONFIGURED/);
});
