const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
  performCaptureInteraction,
  triggerFilePicker,
  performUploadInteraction,
  detectionResultHtml,
  submitSnapshot
} = require('./live.js');

test('camera active detect interaction invokes capture and snapshot flow with visible busy state', async () => {
  const states = [];
  const events = [];
  let captured = 0;
  let sent = 0;
  await performCaptureInteraction({
    captureFrame: () => { captured += 1; return { imageData: 'data:image/jpeg;base64,AA==', width: 640, height: 480, captureMs: 1, encodeMs: 2 }; },
    sendImage: async () => { sent += 1; },
    setBusy: (busy) => states.push(busy),
    onError: () => assert.fail('unexpected error'),
    log: (event) => events.push(event)
  });
  assert.equal(captured, 1);
  assert.equal(sent, 1);
  assert.deepEqual(states, [true, false]);
  assert.deepEqual(events, ['CAPTURE_CLICKED', 'FRAME_CAPTURED', 'JPEG_ENCODED']);
});

test('snapshot submission generates a POST request', async () => {
  let request;
  await submitSnapshot(async (url, options) => {
    request = { url, options };
    return { ok: true, text: async () => JSON.stringify({ detections: [], metrics: { vision_upstream_ms: 1 } }) };
  }, 'session-1', { image_data: 'data:image/jpeg;base64,AA==' }, () => 1);
  assert.equal(request.options.method, 'POST');
  assert.match(request.url, /session-1\/snapshot$/);
});

test('upload button explicitly triggers its file input', () => {
  let clicks = 0;
  triggerFilePicker({ click: () => { clicks += 1; } }, () => {});
  assert.equal(clicks, 1);
});

test('selected image invokes detection flow while cancel is a no-op', async () => {
  let calls = 0;
  await performUploadInteraction({ type: 'image/png' }, async () => { calls += 1; }, () => {});
  await performUploadInteraction(undefined, async () => { calls += 1; }, () => {});
  assert.equal(calls, 1);
});

test('capture failure restores button and exposes a visible error', async () => {
  const states = [];
  const errors = [];
  await assert.rejects(() => performCaptureInteraction({
    captureFrame: () => { throw new Error('camera_not_ready'); },
    sendImage: async () => {},
    setBusy: (busy) => states.push(busy),
    onError: (error) => errors.push(error.message),
    log: () => {}
  }), /camera_not_ready/);
  assert.deepEqual(states, [true, false]);
  assert.deepEqual(errors, ['camera_not_ready']);
});

test('zero detections render an explicit empty result message', () => {
  assert.match(detectionResultHtml([]), /未识别到目标零件/);
});
test('manual snapshot UI exposes explicit detect and upload controls', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id="assistantVisualAction"[^>]*>📷 打开摄像头</);
  assert.match(html, /id="captureFrame"[^>]*>🤖 AI 看当前画面</);
  assert.match(html, /id="uploadImage"/);
  assert.match(html, /id="imageFile"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /打开摄像头/);
  assert.match(html, /需要时再请 AI 检查/);
});
