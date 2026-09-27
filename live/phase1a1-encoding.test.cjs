const assert = require('node:assert/strict');
const test = require('node:test');

const { captureFrame } = require('./live.js');

function makeCanvas() {
  const calls = [];
  return {
    canvas: {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: (...args) => calls.push(args) }),
      toDataURL: (mime, quality) => `data:${mime};quality=${quality}`
    },
    calls
  };
}

test('bounds a landscape snapshot to 640x480 and separates capture from encoding time', () => {
  const { canvas, calls } = makeCanvas();
  const times = [100, 104, 111];
  const result = captureFrame(
    { videoWidth: 1920, videoHeight: 1080 },
    canvas,
    () => times.shift(),
    { mimeType: 'image/jpeg', quality: 0.75 }
  );
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 360);
  assert.deepEqual(calls[0].slice(1), [0, 0, 640, 360]);
  assert.equal(result.captureMs, 4);
  assert.equal(result.encodeMs, 7);
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.imageData, 'data:image/jpeg;quality=0.75');
});

test('supports a 640x480 WebP snapshot at quality 0.75', () => {
  const { canvas } = makeCanvas();
  const result = captureFrame(
    { videoWidth: 640, videoHeight: 480 },
    canvas,
    () => 1,
    { mimeType: 'image/webp', quality: 0.75 }
  );
  assert.equal(result.mimeType, 'image/webp');
  assert.match(result.imageData, /^data:image\/webp/);
});

