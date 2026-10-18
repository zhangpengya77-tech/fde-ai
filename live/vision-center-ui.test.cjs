const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { submitPropCheck, submitHoverAnalyze, activateVisionModel } = require('./live.js');

test('existing page contains student assessment and four teacher vision areas', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /槳葉檢測/);
  assert.match(html, /四面懸停/);
  assert.match(html, /視覺模型與數據/);
  for (const label of ['模型管理', '模型比較', '困難樣本', 'Dataset Versions', '考核區域校準']) assert.match(html, new RegExp(label));
  assert.match(html, /id="propAssessmentFile"[^>]*accept="image\//);
  assert.match(html, /id="hoverAssessmentFile"[^>]*accept="video\//);
});

test('student prop and hover calls never choose a model path', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ final_result: 'PASS', result: 'PASS' }) }; };
  await submitPropCheck(fetchImpl, { detections: [], image_width: 100, image_height: 100 });
  await submitHoverAnalyze(fetchImpl, { frames: [], camera_profile_id: 'camera-1' });
  assert.equal(calls[0].url, '/api/v1/vision/prop-check');
  assert.equal(calls[1].url, '/api/v1/vision/hover-analyze');
  assert.equal('model_path' in calls[0].body, false);
  assert.equal('model_id' in calls[1].body, false);
});

test('model activation sends teacher authority headers', async () => {
  let options;
  await activateVisionModel(async (_url, value) => { options = value; return { ok: true, json: async () => ({ status: 'ACTIVE' }) }; }, 'model-1', 'teacher-1');
  assert.equal(options.headers['X-FDE-Role'], 'teacher');
  assert.equal(options.headers['X-FDE-Teacher-ID'], 'teacher-1');
});
