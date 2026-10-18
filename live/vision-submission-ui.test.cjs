const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { submitStudentModel, importSubmission, createGoldenSet } = require('./live.js');

test('page removes student submission entry and keeps teacher import UI', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /id="studentModelFile"/);
  assert.doesNotMatch(html, /id="submitStudentModel"/);
  assert.doesNotMatch(html, /id="p1ModelFile"/);
  assert.doesNotMatch(html, /id="p1ModelSubmit"/);
  assert.match(html, /id="propAssessment"/);
  assert.match(html, /id="hoverAssessment"/);
  assert.match(html, /id="teacherVisionCenter"/);
  assert.match(html, /id="refreshStudentSubmissions"/);
  assert.match(html, /id="importSubmission"/);
  assert.match(html, /id="createGoldenSet"/);
  assert.match(html, /id="refreshGoldenSets"/);
});

test('student model submission posts without teacher header', async () => {
  let captured;
  const fetchImpl = async (url, options) => { captured = { url, options }; return { ok: true, json: async () => ({ submission_id: 'sub-1', status: 'SUBMITTED' }) }; };
  const payload = { task_id: 'PROP_DIRECTION', student_id: 's1', group_id: 'G1', original_filename: 'best.pt', file_base64: 'AAA', notes: '' };
  const result = await submitStudentModel(fetchImpl, payload);
  assert.equal(captured.url, '/api/v1/vision/submissions');
  assert.equal('X-FDE-Role' in (captured.options.headers || {}), false);
  assert.equal(result.status, 'SUBMITTED');
});

test('import submission sends teacher authority headers', async () => {
  let captured;
  const fetchImpl = async (url, options) => { captured = { url, options }; return { ok: true, json: async () => ({ model_id: 'PROP_20261006_X_v1' }) }; };
  await importSubmission(fetchImpl, 'sub-1', { model_name: 'm', version: 'v1', dataset_id: 'd', dataset_version: 'v1', rule_version: 'r1' }, 'teacher-1');
  assert.equal(captured.url, '/api/v1/vision/submissions/sub-1/import');
  assert.equal(captured.options.headers['X-FDE-Role'], 'teacher');
  assert.equal(captured.options.headers['X-FDE-Teacher-ID'], 'teacher-1');
});

test('create golden set sends teacher authority headers', async () => {
  let captured;
  const fetchImpl = async (url, options) => { captured = { url, options }; return { ok: true, json: async () => ({ golden_set_id: 'PROP_GOLDEN_v1' }) }; };
  await createGoldenSet(fetchImpl, { model_type: 'PROP_DIRECTION', name: 'G', total_cases: 0 }, 'teacher-1');
  assert.equal(captured.url, '/api/v1/vision/golden-sets');
  assert.equal(captured.options.headers['X-FDE-Role'], 'teacher');
});
