// S2：圖片上傳流程改走共用判定模組（node --test）。
// 後端推論照舊（mock /api/v1/vision/prop-check 回傳原始偵測框），畫面結果必須與 judgePropellers 直接判定完全一致。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const judgeModule = require('./prop-judge.js');
const client = require('../vision-client.js');

const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, 'prop-judge-rules.json'), 'utf8'));
const MSG = JSON.parse(fs.readFileSync(path.join(__dirname, 'prop-live.zh-TW.json'), 'utf8'));
const JUDGE = { judgePropellers: judgeModule.judgePropellers, formatJudgement: judgeModule.formatJudgement, rules: RULES, messages: MSG };

function quad(classes, { cx = 640, cy = 360, d = 200, s = 140, conf = 0.9 } = {}) {
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([ox, oy], i) => ({
    class: classes[i], confidence: Array.isArray(conf) ? conf[i] : conf,
    bbox: [cx + ox * d - s / 2, cy + oy * d - s / 2, cx + ox * d + s / 2, cy + oy * d + s / 2],
  }));
}

/** 模擬後端：照實回傳 evaluate_prop 結果＋原始偵測框（後端不改）。 */
function backend(detections, finalResult = 'PASS') {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ final_result: finalResult, positions: {}, detections, model: { model_id: 'PROP_V7', model_version: 'v7' } }) };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

async function run(detections, finalResult) {
  const fetchImpl = backend(detections, finalResult);
  const result = await client.propCheck({
    fetchImpl, base: 'http://x', imageDataUrl: 'data:image/jpeg;base64,AAAA', imageWidth: 1280, imageHeight: 720, fileName: 'f450.jpg', judge: JUDGE,
  });
  return { result, fetchImpl };
}

test('仍呼叫既有後端 /api/v1/vision/prop-check，送出的內容不變', async () => {
  const { fetchImpl } = await run(quad(['CW', 'CCW', 'CCW', 'CW']));
  assert.equal(fetchImpl.calls[0].url, 'http://x/api/v1/vision/prop-check');
  const body = JSON.parse(fetchImpl.calls[0].options.body);
  assert.deepEqual(Object.keys(body).sort(), ['confidence_threshold', 'image_base64', 'image_height', 'image_width', 'input_reference']);
  assert.equal(body.confidence_threshold, 0.5, '後端信心門檻不變');
});

test('全對：PASS、四個位置 PASS、文字與判定模組相同、全綠框', async () => {
  const dets = quad(['CW', 'CCW', 'CCW', 'CW']);
  const { result } = await run(dets);
  assert.equal(result.finalResult, 'PASS');
  assert.deepEqual(result.motorChecks.map((m) => m.result), ['PASS', 'PASS', 'PASS', 'PASS']);
  assert.equal(result.summary, '目前四支槳都已換到正確位置。');
  assert.deepEqual(result.overlayBoxes.map((b) => b.color), ['green', 'green', 'green', 'green']);
  assert.equal(result.motorChecks.find((m) => m.motor === 'M3').position, '左上（M3）');
});

test('單支錯：NG、只有 M3（左上）NG、逐位置說明', async () => {
  const { result } = await run(quad(['CCW', 'CCW', 'CCW', 'CW']), 'NG');
  assert.equal(result.finalResult, 'NG');
  assert.deepEqual(result.motorChecks.filter((m) => m.result === 'NG').map((m) => m.motor), ['M3']);
  assert.deepEqual(result.judgeLines, ['左上應為 CW，目前是 CCW，請依正確方向更換。']);
});

test('缺槳：CHECK、四個位置全是 CHECK、沒有任何 PASS 或綠框', async () => {
  const { result } = await run(quad(['CW', 'CCW', 'CCW', 'CW']).slice(0, 3));
  assert.equal(result.finalResult, 'CHECK');
  assert.equal(result.judgeState, 'UNCERTAIN');
  assert.ok(result.motorChecks.every((m) => m.result === 'CHECK'));
  assert.ok(!result.overlayBoxes.some((b) => b.color === 'green'));
  assert.equal(result.summary, '我無法判斷，請找線下老師確認。');
});

test('機身偏離畫面中央：以重心劃分仍正確（舊版以畫面中線切割會判錯，這是刻意的行為改變）', async () => {
  // 機身中心在 (300, 200)：舊版用畫面中線 x=640、y=360 切割，四支都會落在左上 → 舊版判 INSUFFICIENT／NG
  const { result } = await run(quad(['CW', 'CCW', 'CCW', 'CW'], { cx: 300, cy: 200, d: 90, s: 70 }), 'NG');
  assert.equal(result.finalResult, 'PASS');
  assert.equal(result.backendFinalResult, 'NG', '後端原結果保留供稽核');
});

test('圖片流程結果與 judgePropellers 直接判定完全一致（隨機 300 組）', async () => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const map = { PASS: 'CORRECT', NG: 'WRONG', CHECK: 'UNCERTAIN' };
  for (let n = 0; n < 300; n++) {
    const k = [3, 4, 4, 4, 5][Math.floor(rnd() * 5)];
    const dets = quad(['CW', 'CCW', 'CCW', 'CW'].map(() => (rnd() < 0.5 ? 'CW' : 'CCW')), { conf: [0, 1, 2, 3].map(() => 0.3 + rnd() * 0.7) }).slice(0, Math.min(k, 4));
    if (k === 5) dets.push({ class: 'CW', confidence: 0.8, bbox: [1100, 600, 1180, 680] });
    const direct = judgeModule.judgePropellers(dets, RULES);
    const { result } = await run(dets);
    assert.equal(map[result.finalResult], direct.state);
    assert.deepEqual(result.overlayBoxes, direct.boxes);
  }
});

test('不傳 judge 的舊呼叫方式仍可用（API 合約不變；學員頁一律傳 judge）', async () => {
  const fetchImpl = backend([], 'NG');
  const result = await client.propCheck({ fetchImpl, base: 'http://x', imageDataUrl: 'data:image/jpeg;base64,AA', imageWidth: 1, imageHeight: 1 });
  assert.equal(result.finalResult, 'NG');
});

test('學員頁：app.js 的槳葉檢測一律傳入 judge，且畫面不再出現 Blade Face（F/B）欄位', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const handler = app.slice(app.indexOf("$('#propellerButton')"), app.indexOf('POWER_INSPECTION_V1'));
  assert.match(handler, /judge = await loadPropJudge\(\)/);
  assert.match(handler, /fileName: file\.name,\s*judge,/);
  assert.doesNotMatch(app, /Blade Face/);
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  assert.ok(html.indexOf('prop-live/prop-judge.js') < html.indexOf('src/app.js'), '判定模組要在 app.js 之前載入');
});

test('無法判斷時不呼叫 AI 助教（不讓 AI 自行推測對錯）', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fn = app.slice(app.indexOf('async function appendInspectionKnowledgeAnswer'), app.indexOf('function renderDetectionImage'));
  const guard = fn.indexOf("result.judgeState === 'UNCERTAIN'");
  assert.ok(guard > 0 && guard < fn.indexOf('requestEagleTutor'));
});
