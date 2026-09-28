const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { cameraConstraintsForDevices, cameraErrorState } = require('./live.js');

test('desktop uses the only USB camera by exact device id', () => {
  const devices = [{ kind: 'videoinput', deviceId: 'usb-123', label: 'Logi C310 HD WebCam' }];
  assert.deepEqual(cameraConstraintsForDevices(devices, '', false), {
    video: { deviceId: { exact: 'usb-123' } },
    audio: false
  });
});

test('selected camera wins while mobile without selection prefers environment', () => {
  const devices = [
    { kind: 'videoinput', deviceId: 'front' },
    { kind: 'videoinput', deviceId: 'rear' }
  ];
  assert.deepEqual(cameraConstraintsForDevices(devices, 'front', true).video.deviceId, { exact: 'front' });
  assert.deepEqual(cameraConstraintsForDevices(devices, '', true).video.facingMode, { ideal: 'environment' });
});

test('camera errors map to explicit user states', () => {
  assert.equal(cameraErrorState({ name: 'NotFoundError' }).state, 'NO CAMERA');
  assert.equal(cameraErrorState({ name: 'NotAllowedError' }).state, 'PERMISSION REQUIRED');
  assert.equal(cameraErrorState({ name: 'NotReadableError' }).state, 'CAMERA ERROR');
});

test('live page includes camera selector, state, and resolution fields', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id="cameraStatus"/);
  assert.match(html, /id="cameraDevice"/);
  assert.match(html, /id="cameraResolution"/);
});

