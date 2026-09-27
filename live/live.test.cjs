const assert = require('node:assert/strict');
const test = require('node:test');

const {
  cameraConstraints,
  captureFrame,
  checkHealth,
  scaleBoxForContain,
  stopStream,
  submitSnapshot
} = require('./live.js');

test('requests the mobile rear camera without requesting microphone access', () => {
  assert.deepEqual(cameraConstraints(), {
    video: { facingMode: { ideal: 'environment' } },
    audio: false
  });
});

test('health check returns offline state instead of throwing when backend is unreachable', async () => {
  const offline = await checkHealth(async () => { throw new Error('network down'); });
  const online = await checkHealth(async () => ({
    ok: true,
    json: async () => ({
      status: 'online',
      components: { live_backend: 'online', vision: 'online' }
    })
  }));

  assert.deepEqual(offline, {
    status: 'offline',
    components: { live_backend: 'offline', vision: 'unknown' }
  });
  assert.equal(online.status, 'online');
  assert.equal(online.components.vision, 'online');
});

test('captures one video frame and records capture time', () => {
  const calls = [];
  const video = { videoWidth: 1280, videoHeight: 720 };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: (...args) => calls.push(args) }),
    toDataURL: (mime, quality) => `${mime}:${quality}:snapshot`
  };
  const times = [100, 106, 107, 112];

  const result = captureFrame(video, canvas, () => times.shift());

  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 360);
  assert.equal(calls.length, 1);
  assert.equal(result.imageData, 'image/jpeg:0.75:snapshot');
  assert.equal(result.captureMs, 6);
  assert.equal(result.encodeMs, 5);
});

test('maps source detection box into a letterboxed preview', () => {
  assert.deepEqual(
    scaleBoxForContain([100, 50, 300, 250], 400, 300, 800, 400),
    [266.67, 66.67, 533.33, 333.33]
  );
});

test('stops every media track when camera stops or the page exits', () => {
  const stopped = [];
  const stream = {
    getTracks: () => [
      { stop: () => stopped.push('video') },
      { stop: () => stopped.push('audio') }
    ]
  };

  stopStream(stream);

  assert.deepEqual(stopped, ['video', 'audio']);
});

test('submits one snapshot and records upload round trip and response bytes', async () => {
  let requestedUrl;
  let requestedOptions;
  const fetchImpl = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return {
      ok: true,
      text: async () => JSON.stringify({
        session_id: 'session-1',
        frame_id: 'frame-1',
        detections: []
      })
    };
  };
  const times = [50, 73];

  const result = await submitSnapshot(
    fetchImpl,
    'session-1',
    { frame_id: 'frame-1', image_data: 'data:image/jpeg;base64,eA==' },
    () => times.shift()
  );

  assert.equal(requestedUrl, '/api/live/sessions/session-1/snapshot');
  assert.equal(requestedOptions.method, 'POST');
  assert.equal(JSON.parse(requestedOptions.body).frame_id, 'frame-1');
  assert.equal(result.uploadMs, 23);
  assert.ok(result.responseBytes > 0);
  assert.deepEqual(result.payload.detections, []);
});
