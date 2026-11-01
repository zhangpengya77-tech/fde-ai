const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const live = require('./live.js');

// 80fd81（PROP_20261019_DEMO-A_v1_994d）降級後的實際記錄形狀。
const REVIEW_REQUIRED_MODEL = {
  model_id: 'PROP_20261019_DEMO-A_v1_994d',
  model_name: '學員模型 80fd81',
  model_type: 'PROP_DIRECTION',
  status: 'REVIEW_REQUIRED',
  validation_status: 'REVIEW_REQUIRED',
  evaluation_status: 'NOT_EVALUATED',
  metrics: {},
  class_names: ['CCW_F', 'CCW_B', 'CW_F', 'CW_B'],
  nc: 4,
  health: null,
  review_reason: '無評估證據，僅類別名稱吻合（需 golden set 評估或 sandbox benchmark PASS）',
  training_trace_label: '無訓練痕跡',
  has_training_trace: false,
};

const NOT_EVALUATED_MODEL = {
  model_id: 'PROP_20261018_DEMO-A_v1',
  model_name: '學員模型 003fe6',
  model_type: 'PROP_DIRECTION',
  status: 'ACTIVE',
  validation_status: 'VALIDATED',
  evaluation_status: 'NOT_EVALUATED',
  metrics: {},
  class_names: ['CW_F', 'CCW_F', 'CW_B', 'CCW_B'],
  nc: 4,
  health: 'UNTRAINED',
  health_label: '未訓練',
  training_trace_label: '無訓練痕跡',
  has_training_trace: false,
};

const EVALUATED_PASS_MODEL = {
  model_id: 'PROP_20261018_DEMO-A_v1_eval',
  model_name: '學員模型（已評估）',
  model_type: 'PROP_DIRECTION',
  status: 'ACTIVE',
  validation_status: 'VALIDATED',
  evaluation_status: 'EVALUATED',
  metrics: { precision: 0.8, recall: 0.75, map50: 0.6, map50_95: 0.4 },
  nc: 4,
  health: 'HEALTHY',
  health_label: '正常',
  map50_threshold: 0.5,
  training_trace_label: '有訓練痕跡',
  has_training_trace: true,
  has_train_args: true,
  has_epoch: true,
  has_metrics: true,
};

const EVALUATED_LOW_MODEL = {
  ...EVALUATED_PASS_MODEL,
  model_id: 'PROP_20261018_DEMO-A_v1_low',
  status: 'ACTIVE',
  validation_status: 'VALIDATED',
  metrics: { precision: 0.4, recall: 0.3, map50: 0.3, map50_95: 0.2 },
};

// 後端閘口已把低 mAP50 模型降級後的實際記錄形狀。
const DOWNGRADED_LOW_MODEL = {
  ...EVALUATED_LOW_MODEL,
  status: 'REVIEW_REQUIRED',
  validation_status: 'REVIEW_REQUIRED',
  review_reason: 'mAP50 0.3 低於門檻 0.5，未達啟用標準',
};

const BENCHMARK_PASS_MODEL = {
  ...NOT_EVALUATED_MODEL,
  model_id: 'PROP_20261020_bench',
  status: 'VALIDATED',
  benchmark_status: 'PASS',
};

test('類別吻合但未評估不得顯示為綠色通過', () => {
  const meta = live.visionModelStateMeta(NOT_EVALUATED_MODEL);
  assert.equal(meta.tone, 'warn');
  assert.equal(meta.state, 'VALIDATED_NOT_EVALUATED');
  assert.match(meta.note, /golden set/);
  const html = live.visionModelCardHtml(NOT_EVALUATED_MODEL);
  assert.ok(html.includes('已驗證未評估'));
  assert.ok(html.includes('未評估'));
  assert.ok(html.includes('健康度'));
  assert.equal(html.includes('vm-badge-pass'), false);
});

test('mAP50 達門檻（已評估）可顯示綠色通過', () => {
  const meta = live.visionModelStateMeta(EVALUATED_PASS_MODEL);
  assert.equal(meta.tone, 'pass');
  assert.equal(meta.state, 'PASS');
  const html = live.visionModelCardHtml(EVALUATED_PASS_MODEL);
  assert.ok(html.includes('已驗證並評估'));
  assert.ok(html.includes('vm-badge-pass'));
  assert.ok(html.includes('0.6'));
  assert.ok(html.includes('門檻 0.5'));
  assert.ok(html.includes('有訓練痕跡'));
  assert.ok(html.includes('train_args'));
});

test('mAP50 低於門檻不得顯示綠色通過', () => {
  const meta = live.visionModelStateMeta(EVALUATED_LOW_MODEL);
  assert.equal(meta.tone, 'warn');
  assert.equal(meta.state, 'BELOW_THRESHOLD');
  const html = live.visionModelCardHtml(EVALUATED_LOW_MODEL);
  assert.ok(html.includes('mAP50 0.3 低於門檻 0.5'));
  assert.equal(html.includes('已驗證並評估'), false);
  assert.equal(html.includes('vm-card-pass'), false);
  const downgraded = live.visionModelCardHtml(DOWNGRADED_LOW_MODEL);
  assert.ok(downgraded.includes('mAP50 0.3 低於門檻 0.5，未達啟用標準'));
  assert.equal(downgraded.includes('vm-card-pass'), false);
});

test('REVIEW_REQUIRED 顯示降級原因且不得啟用色彩', () => {
  const meta = live.visionModelStateMeta(REVIEW_REQUIRED_MODEL);
  assert.equal(meta.tone, 'warn');
  assert.equal(meta.label, '待審查');
  const html = live.visionModelCardHtml(REVIEW_REQUIRED_MODEL);
  assert.ok(html.includes('無評估證據，僅類別名稱吻合'));
  assert.ok(html.includes('需 golden set 評估或 sandbox benchmark PASS'));
  assert.ok(html.includes('data-state="REVIEW_REQUIRED"'));
  assert.equal(html.includes('vm-card-pass'), false);
  assert.equal(html.includes('vm-badge-pass'), false);
});

test('benchmark PASS 可作為評估證據', () => {
  const meta = live.visionModelStateMeta(BENCHMARK_PASS_MODEL);
  assert.equal(meta.tone, 'pass');
  assert.equal(meta.state, 'PASS');
  assert.ok(live.visionModelCardHtml(BENCHMARK_PASS_MODEL).includes('基準測試通過'));
});

test('模型清單渲染為卡片而非 JSON dump，未評估標示可見', () => {
  const html = live.visionModelListHtml([NOT_EVALUATED_MODEL, EVALUATED_PASS_MODEL, REVIEW_REQUIRED_MODEL]);
  assert.ok(html.includes('共 3 筆模型'));
  assert.ok(html.includes('學員模型 80fd81'));
  assert.ok(html.includes('待審查'));
  assert.ok(html.includes('未評估'));
  assert.equal(html.includes('"model_id"'), false);
  assert.equal(html.includes('"validation_status"'), false);
});

test('單筆模型記錄（上傳／啟用／封存回傳）也渲染成卡片', () => {
  const html = live.visionModelListHtml(EVALUATED_PASS_MODEL);
  assert.ok(html.includes('vm-card vm-card-pass'));
  assert.equal(live.visionModelListHtml([]).includes('尚無模型記錄'), true);
  assert.equal(live.visionModelListHtml({ error: 'boom' }).includes('boom'), true);
});

test('統一評估結果（保存 golden metrics）以指標表呈現並標示門檻', () => {
  const html = live.visionModelCompareHtml(EVALUATED_PASS_MODEL);
  assert.ok(html.includes('統一評估') === false || html.includes('學員模型（已評估）'));
  assert.ok(html.includes('precision'));
  assert.ok(html.includes('≥ 門檻 0.5'));
  assert.ok(html.includes('已評估'));
  assert.ok(html.includes('vm-badge-pass'));
  const low = live.visionModelCompareHtml(EVALUATED_LOW_MODEL);
  assert.ok(low.includes('< 門檻 0.5'));
  assert.equal(low.includes('≥ 門檻'), false);
  const list = live.visionModelCompareHtml([NOT_EVALUATED_MODEL, REVIEW_REQUIRED_MODEL]);
  assert.ok(list.includes('vm-table-compare'));
  assert.ok(list.includes('待審查'));
});

test('槳葉檢測結果：PASS 才顯示綠色通過，資料不足不得變綠', () => {
  const pass = live.propAssessmentHtml({
    rule_version: 'r1',
    final_result: 'PASS',
    model: { model_id: 'm-1', model_version: 'v1' },
    positions: {
      M1: { expected: 'CCW_F', detected: 'CCW_F', confidence: 0.9, result: 'PASS', reason: '方向與槳面正確' },
      M2: { expected: 'CCW_F', detected: 'CCW_F', confidence: 0.9, result: 'PASS', reason: '方向與槳面正確' },
      M3: { expected: 'CW_F', detected: 'CW_F', confidence: 0.9, result: 'PASS', reason: '方向與槳面正確' },
      M4: { expected: 'CW_F', detected: 'CW_F', confidence: 0.9, result: 'PASS', reason: '方向與槳面正確' },
    },
  });
  assert.ok(pass.includes('data-final="PASS"'));
  assert.ok(pass.includes('vm-card-pass'));
  assert.ok(pass.includes('使用模型 m-1（v1）'));

  const insufficient = live.propAssessmentHtml({
    rule_version: 'r1',
    final_result: 'INSUFFICIENT_DATA',
    model: null,
    positions: { M1: { expected: 'CCW_F', detected: null, confidence: null, result: 'INSUFFICIENT_DATA', reason: '缺少槳葉', reason_code: 'MISSING_TARGET' } },
  });
  assert.ok(insufficient.includes('data-final="INSUFFICIENT_DATA"'));
  assert.ok(insufficient.includes('資料不足'));
  assert.ok(insufficient.includes('vm-card-warn'));
  assert.equal(insufficient.includes('vm-card-pass'), false);

  const notReady = live.propAssessmentHtml({ status: 'MODEL_NOT_READY', simulation_mode: false });
  assert.ok(notReady.includes('沒有可用的 ACTIVE 模型'));
  assert.equal(live.propAssessmentHtml({ error: '壞掉' }).includes('壞掉'), true);
});

test('頁面不再直接 dump JSON：容器改為卡片區，且不提供調低信心度門檻的輸入', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /<div id="visionModelList" class="vision-model-list">/);
  assert.match(html, /<div id="visionModelCompare" class="vision-model-compare">/);
  assert.equal(html.includes('<pre id="visionModelList">'), false);
  assert.equal(html.includes('<pre id="visionModelCompare">'), false);
  assert.equal(/confidence_threshold/.test(html), false);
});

test('樣式表為綠色通過、警示、拒絕分級著色', () => {
  const css = fs.readFileSync(path.join(__dirname, 'live.css'), 'utf8');
  for (const tone of ['pass', 'warn', 'bad', 'neutral']) assert.ok(css.includes(`.vm-badge-${tone}`), tone);
});

test('啟用被閘口阻擋時提示原因而不是靜默失敗', () => {
  assert.match(live.visionActivateErrorMessage('model_quality_gate'), /質量閘口/);
  assert.match(live.visionActivateErrorMessage('model_health_blocked'), /健康度/);
  assert.equal(live.visionActivateErrorMessage('boom'), 'boom');
});

test('刷新模型按鈕把清單與比較區渲染成可讀內容', async () => {
  const models = [NOT_EVALUATED_MODEL, EVALUATED_PASS_MODEL, REVIEW_REQUIRED_MODEL];
  const clicks = {};
  const documentRef = {
    querySelector(selector) {
      if (!clicks[selector]) clicks[selector] = { listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, innerHTML: '', textContent: '' };
      return clicks[selector];
    },
  };
  const fetchImpl = async (url) => {
    assert.equal(url, '/api/v1/vision/models');
    return { ok: true, json: async () => models };
  };
  live.initializeVisionCenter(documentRef, fetchImpl);
  await clicks['#refreshVisionModels'].listeners.click();
  const list = clicks['#visionModelList'].innerHTML;
  assert.ok(list.includes('共 3 筆模型'));
  assert.ok(list.includes('待審查'));
  assert.ok(list.includes('無評估證據，僅類別名稱吻合'));
  assert.ok(list.includes('已驗證並評估'));
  assert.equal(list.includes('"model_id"'), false);
  const compare = clicks['#visionModelCompare'].innerHTML;
  assert.ok(compare.includes('vm-table-compare'));
  assert.ok(compare.includes('已驗證未評估'));
});

test('啟用失敗（閘口）時模型清單顯示人話提示', async () => {
  const clicks = {};
  const documentRef = {
    querySelector(selector) {
      if (!clicks[selector]) clicks[selector] = { listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, innerHTML: '', textContent: '', value: 'PROP_20261019_DEMO-A_v1_994d' };
      return clicks[selector];
    },
  };
  const fetchImpl = async () => ({ ok: false, status: 422, json: async () => ({ error: { code: 'activation_failed', message: 'model_quality_gate' } }) });
  live.initializeVisionCenter(documentRef, fetchImpl);
  await clicks['#activateVisionModel'].listeners.click();
  assert.ok(clicks['#visionModelList'].innerHTML.includes('質量閘口'));
});

test('保存統一評估後比較區顯示門檻判定', async () => {
  const values = {
    '#visionEvaluationModelId': 'm-1',
    '#visionEvaluationMetrics': '{"precision":0.8,"recall":0.75,"map50":0.6,"map50_95":0.4}',
  };
  const clicks = {};
  const documentRef = {
    querySelector(selector) {
      if (!clicks[selector]) clicks[selector] = { listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, innerHTML: '', textContent: '', value: values[selector] || '' };
      return clicks[selector];
    },
  };
  const fetchImpl = async (url) => {
    assert.match(url, /\/evaluate$/);
    return { ok: true, json: async () => EVALUATED_PASS_MODEL };
  };
  live.initializeVisionCenter(documentRef, fetchImpl);
  await clicks['#saveGoldenEvaluation'].listeners.click();
  assert.ok(clicks['#visionModelCompare'].innerHTML.includes('≥ 門檻 0.5'));
});
