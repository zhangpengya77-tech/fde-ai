const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..', '..');
const appSource = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const platformSource = fs.readFileSync(path.join(__dirname, '..', 'static', 'learning', 'public-platform.js'), 'utf8');

test('mobile voice uses hold-to-talk and a same-origin RAG path', () => {
  assert.match(appSource, /pointerdown/);
  assert.match(appSource, /pointerup/);
  assert.match(appSource, /pointercancel/);
  assert.match(appSource, /isSecureContext/);
  assert.doesNotMatch(appSource, /localVoiceEndpoint/);
  assert.match(appSource, /\/api\/public\/voice\/ask\//);
  assert.match(indexSource, /按住說話/);
  assert.match(indexSource, /正在聽[^<]*放開送出/);
});

test('mobile build media controls provide preview and upload status hooks', () => {
  assert.match(indexSource, /id="assistantImageInput"/);
  assert.match(indexSource, /id="assistantVideoInput"/);
  assert.match(indexSource, /data-assistant-upload-status/);
  assert.match(appSource, /assistantImageInput/);
  assert.match(appSource, /assistantVideoInput/);
  assert.match(appSource, /runLocalYoloDetection/);
  assert.match(appSource, /runLocalHoverScoring/);
  assert.match(appSource, /successEvent\.replace/);
  assert.match(appSource, /successEvent/);
  assert.match(appSource, /failureEvent/);
});

test('public platform fetch keeps AI requests on the current origin', () => {
  assert.match(platformSource, /\/api\/public\/rag\/ask\//);
  assert.match(platformSource, /\/api\/public\/voice\/ask\//);
  assert.match(platformSource, /credentials: 'same-origin'/);
});
