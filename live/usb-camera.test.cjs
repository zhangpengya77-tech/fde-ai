const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  cameraConstraintCandidates,
  cameraErrorState,
  openCameraWithFallback
} = require('./live.js');

test('desktop selected USB camera uses ideal video settings then two compatibility fallbacks', () => {
  const devices = [{ kind: 'videoinput', deviceId: 'usb-123', label: 'Logi C310 HD WebCam' }];
  assert.deepEqual(cameraConstraintCandidates(devices, 'usb-123', false), [
    { video: { deviceId: { exact: 'usb-123' }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false },
    { video: { deviceId: { exact: 'usb-123' } }, audio: false },
    { video: true, audio: false }
  ]);
});

test('mobile prefers environment without forcing it beside a selected device', () => {
  const devices = [{ kind: 'videoinput', deviceId: 'rear' }, { kind: 'videoinput', deviceId: 'front' }];
  assert.deepEqual(cameraConstraintCandidates(devices, '', true)[0], {
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    audio: false
  });
  assert.equal(cameraConstraintCandidates(devices, 'front', true)[0].video.facingMode, undefined);
});

test('camera opening retries after OverconstrainedError and reports compatibility fallback', async () => {
  const calls = [];
  const stream = { getTracks: () => [] };
  const mediaDevices = {
    async getUserMedia(constraints) {
      calls.push(constraints);
      if (calls.length === 1) throw Object.assign(new Error('width unavailable'), { name: 'OverconstrainedError', constraint: 'width' });
      return stream;
    }
  };
  const result = await openCameraWithFallback(mediaDevices, [{ video: { width: { ideal: 640 } } }, { video: true }]);
  assert.equal(result.stream, stream);
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.failedAttempts[0].constraint, 'width');
  assert.equal(calls.length, 2);
});

test('camera errors preserve name message and failed constraint', () => {
  const mapped = cameraErrorState({ name: 'OverconstrainedError', message: 'cannot satisfy', constraint: 'frameRate' });
  assert.equal(mapped.state, 'CAMERA ERROR');
  assert.equal(mapped.name, 'OverconstrainedError');
  assert.equal(mapped.message, 'cannot satisfy');
  assert.equal(mapped.constraint, 'frameRate');
});

test('live page includes camera selector, state, resolution, and diagnostics fields', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id="cameraStatus"/);
  assert.match(html, /id="cameraDevice"/);
  assert.match(html, /id="cameraResolution"/);
  assert.match(html, /id="cameraDiagnostics"/);
});
