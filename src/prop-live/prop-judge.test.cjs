// 螺旋槳判定模組單元測試（node --test）。規則一律讀 prop-judge-rules.json，不在測試內改寫門檻。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { judgePropellers, formatJudgement } = require('./prop-judge.js');

const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, 'prop-judge-rules.json'), 'utf8'));
const MSG = JSON.parse(fs.readFileSync(path.join(__dirname, 'prop-live.zh-TW.json'), 'utf8'));

/**
 * 產生四支槳的偵測框。classes 依 TL、TR、BL、BR 順序給類別；
 * cx/cy 是機身中心（像素），d 是槳中心到機身中心的距離，s 是框邊長。
 */
function quad(classes, { cx = 320, cy = 240, d = 120, s = 90, conf = 0.9, tilt = 0 } = {}) {
  const offsets = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  return offsets.map(([ox, oy], i) => {
    // tilt：機身略為旋轉（弧度），用來確認重心劃分不依賴完美對齊
    const x = cx + d * (ox * Math.cos(tilt) - oy * Math.sin(tilt));
    const y = cy + d * (ox * Math.sin(tilt) + oy * Math.cos(tilt));
    return { class: classes[i], confidence: Array.isArray(conf) ? conf[i] : conf, bbox: [x - s / 2, y - s / 2, x + s / 2, y + s / 2] };
  });
}
const CORRECT = ['CW', 'CCW', 'CCW', 'CW'];
const colors = (r) => r.boxes.map((b) => b.color);

test('全對：CORRECT、全綠、顯示正確文字', () => {
  const r = judgePropellers(quad(CORRECT), RULES);
  assert.equal(r.state, 'CORRECT');
  assert.deepEqual(colors(r), ['green', 'green', 'green', 'green']);
  assert.equal(r.positions.TL.motorId, 'M3');
  const f = formatJudgement(r, MSG);
  assert.equal(f.tone, 'green');
  assert.equal(f.headline, '目前四支槳都已換到正確位置。');
});

test('單支錯（左上裝成 CCW）：WRONG、只有左上紅、逐位置說明', () => {
  const r = judgePropellers(quad(['CCW', 'CCW', 'CCW', 'CW']), RULES);
  assert.equal(r.state, 'WRONG');
  assert.deepEqual(r.wrong, ['TL']);
  assert.deepEqual(colors(r).sort(), ['green', 'green', 'green', 'red']);
  assert.equal(r.boxes.find((b) => b.position === 'TL').color, 'red');
  const f = formatJudgement(r, MSG);
  assert.equal(f.tone, 'red');
  assert.deepEqual(f.lines, ['左上應為 CW，目前是 CCW，請依正確方向更換。']);
});

test('兩支錯（右上、左下）：WRONG、兩紅兩綠、兩行說明', () => {
  const r = judgePropellers(quad(['CW', 'CW', 'CW', 'CW']), RULES);
  assert.equal(r.state, 'WRONG');
  assert.deepEqual(r.wrong, ['TR', 'BL']);
  assert.equal(r.allReversed, false);
  const f = formatJudgement(r, MSG);
  assert.deepEqual(f.lines, ['右上應為 CCW，目前是 CW，請依正確方向更換。', '左下應為 CCW，目前是 CW，請依正確方向更換。']);
});

test('全反：WRONG、四支全紅、附機頭／鏡像提示', () => {
  const r = judgePropellers(quad(['CCW', 'CW', 'CW', 'CCW']), RULES);
  assert.equal(r.state, 'WRONG');
  assert.equal(r.reasonCode, 'ALL_REVERSED');
  assert.deepEqual(colors(r), ['red', 'red', 'red', 'red']);
  const f = formatJudgement(r, MSG);
  assert.equal(f.lines.length, 5);
  assert.equal(f.lines[4], MSG.allReversedHint);
});

test('鏡像擺放（前鏡頭左右鏡像）：判為全反並提示確認鏡像，不會誤判正確', () => {
  // 正確安裝的機體經左右鏡像後：左右對調
  const mirrored = quad(CORRECT).map((d) => ({ ...d, bbox: [640 - d.bbox[2], d.bbox[1], 640 - d.bbox[0], d.bbox[3]] }));
  const r = judgePropellers(mirrored, RULES);
  assert.equal(r.state, 'WRONG');
  assert.equal(r.allReversed, true);
  assert.match(formatJudgement(r, MSG).lines.at(-1), /鏡像/);
});

test('缺槳（只有 3 支）：UNCERTAIN、灰色、不出現綠色', () => {
  const r = judgePropellers(quad(CORRECT).slice(0, 3), RULES);
  assert.equal(r.state, 'UNCERTAIN');
  assert.equal(r.reasonCode, 'COUNT_MISMATCH');
  assert.ok(colors(r).every((c) => c === 'gray'));
  const f = formatJudgement(r, MSG);
  assert.equal(f.tone, 'gray');
  assert.equal(f.headline, '我無法判斷，請找線下老師確認。');
});

test('多一支（5 支）：UNCERTAIN', () => {
  const dets = [...quad(CORRECT), { class: 'CW', confidence: 0.9, bbox: [600, 20, 640, 60] }];
  assert.equal(judgePropellers(dets, RULES).reasonCode, 'COUNT_MISMATCH');
});

test('低信心（其中一支 0.4，介於候選與門檻之間）：UNCERTAIN／LOW_CONFIDENCE，絕不顯示綠色', () => {
  const r = judgePropellers(quad(CORRECT, { conf: [0.9, 0.9, 0.9, 0.4] }), RULES);
  assert.equal(r.state, 'UNCERTAIN');
  assert.equal(r.reasonCode, 'LOW_CONFIDENCE');
  assert.ok(!colors(r).includes('green'));
});

test('剛好等於門檻 0.5：算達標（門檻不放寬也不收緊）', () => {
  assert.equal(judgePropellers(quad(CORRECT, { conf: 0.5 }), RULES).state, 'CORRECT');
});

test('低於候選門檻的雜訊框（0.1）忽略，不影響判定', () => {
  const dets = [...quad(CORRECT), { class: 'CW', confidence: 0.1, bbox: [5, 5, 30, 30] }];
  assert.equal(judgePropellers(dets, RULES).state, 'CORRECT');
});

test('同一支槳的低信心重複框（與達標框重疊）視為重複，不影響判定', () => {
  const base = quad(CORRECT);
  const dup = { ...base[0], class: 'CCW', confidence: 0.3, bbox: base[0].bbox.map((v) => v + 4) };
  assert.equal(judgePropellers([...base, dup], RULES).state, 'CORRECT');
});

test('框過度重疊（兩個達標框 IoU > 0.3）：UNCERTAIN／OVERLAP', () => {
  const base = quad(CORRECT);
  const twin = { ...base[0], class: 'CCW', confidence: 0.8, bbox: base[0].bbox.map((v) => v + 10) };
  const r = judgePropellers([base[0], twin, base[1], base[2]], RULES);
  assert.equal(r.reasonCode, 'OVERLAP');
  assert.ok(!colors(r).includes('green'));
});

test('同象限衝突（兩支都在左上）：UNCERTAIN／QUADRANT_CONFLICT', () => {
  const dets = [
    { class: 'CW', confidence: 0.9, bbox: [0, 0, 60, 60] },
    { class: 'CW', confidence: 0.9, bbox: [100, 10, 160, 70] },
    { class: 'CCW', confidence: 0.9, bbox: [500, 300, 560, 360] },
    { class: 'CW', confidence: 0.9, bbox: [520, 400, 580, 460] }
  ];
  assert.equal(judgePropellers(dets, RULES).reasonCode, 'QUADRANT_CONFLICT');
});

test('四支排成一直線（無法分出上下）：UNCERTAIN／QUADRANT_CONFLICT', () => {
  const dets = [0, 1, 2, 3].map((i) => ({ class: CORRECT[i], confidence: 0.9, bbox: [i * 150, 200, i * 150 + 60, 260] }));
  assert.equal(judgePropellers(dets, RULES).reasonCode, 'QUADRANT_CONFLICT');
});

test('舊四類模型的類別（CW_F）不得出現：UNCERTAIN／UNKNOWN_CLASS', () => {
  const dets = quad(CORRECT);
  dets[0].class = 'CW_F';
  assert.equal(judgePropellers(dets, RULES).reasonCode, 'UNKNOWN_CLASS');
});

test('畫面晃動（context.unstable）：UNCERTAIN／UNSTABLE，即使四支都對也不顯示綠色', () => {
  const r = judgePropellers(quad(CORRECT), RULES, { unstable: true });
  assert.equal(r.reasonCode, 'UNSTABLE');
  assert.ok(colors(r).every((c) => c === 'gray'));
});

test('沒有任何偵測：UNCERTAIN／NO_DETECTION', () => {
  assert.equal(judgePropellers([], RULES).reasonCode, 'NO_DETECTION');
  assert.equal(judgePropellers(null, RULES).reasonCode, 'NO_DETECTION');
});

test('框座標格式錯誤：UNCERTAIN（不猜）', () => {
  const dets = quad(CORRECT);
  dets[2].bbox = [10, 10, 5, 5];
  assert.equal(judgePropellers(dets, RULES).state, 'UNCERTAIN');
});

test('機身不在畫面中央（偏到左上角）：重心劃分仍正確', () => {
  assert.equal(judgePropellers(quad(CORRECT, { cx: 150, cy: 130, d: 70, s: 50 }), RULES).state, 'CORRECT');
});

test('機身略為歪斜 15°：仍正確判定', () => {
  assert.equal(judgePropellers(quad(CORRECT, { tilt: (15 * Math.PI) / 180 }), RULES).state, 'CORRECT');
});

test('正規化座標（0~1）與像素座標結果相同', () => {
  const px = quad(['CCW', 'CCW', 'CCW', 'CW']);
  const norm = px.map((d) => ({ ...d, bbox: d.bbox.map((v, i) => v / (i % 2 ? 480 : 640)) }));
  assert.deepEqual(judgePropellers(norm, RULES).wrong, judgePropellers(px, RULES).wrong);
});

test('偵測框順序不同，結果相同', () => {
  const dets = quad(['CW', 'CW', 'CCW', 'CW']);
  assert.deepEqual(judgePropellers([...dets].reverse(), RULES).wrong, judgePropellers(dets, RULES).wrong);
});

test('修正完成文字：formatJudgement(fixed) 顯示「你已經換到正確的了」', () => {
  const f = formatJudgement(judgePropellers(quad(CORRECT), RULES), MSG, { fixed: true });
  assert.equal(f.headline, '你已經換到正確的了。');
  assert.equal(f.tone, 'green');
});

test('版面由設定檔決定：改 layout 後判定跟著變（程式內沒有寫死）', () => {
  const swapped = { ...RULES, layout: { TL: 'CCW', TR: 'CW', BL: 'CW', BR: 'CCW' } };
  assert.equal(judgePropellers(quad(['CCW', 'CW', 'CW', 'CCW']), swapped).state, 'CORRECT');
});

test('設定檔缺欄位：直接丟錯，不使用隱藏預設值', () => {
  const { minConfidence, ...broken } = RULES;
  assert.throws(() => judgePropellers(quad(CORRECT), broken), /prop_rules_missing_minConfidence/);
});

test('規則檔與既有後端規則一致：左上 CW、右上 CCW、左下 CCW、右下 CW；信心門檻 0.5', () => {
  assert.deepEqual(RULES.layout, { TL: 'CW', TR: 'CCW', BL: 'CCW', BR: 'CW' });
  assert.deepEqual(RULES.classes, ['CW', 'CCW']);
  assert.equal(RULES.minConfidence, 0.5);
  assert.deepEqual(RULES.stability, { window: 8, required: 5, maxCenterShift: 0.06 });
});

test('即時鏡頭設定：推論尺寸固定 640（手機也是），省電模式只降擷取解析度與 FPS 上限', () => {
  assert.equal(RULES.live.imgsz, 640);
  assert.ok(RULES.live.powerSaveMaxFps < RULES.live.maxFps);
  assert.ok(RULES.live.powerSaveCapture.width < RULES.live.capture.width);
  assert.equal(RULES.live.defaultFacingMode, 'environment');
});

test('所有 UNCERTAIN 情境都不會出現綠框（窮舉上面的不確定情境）', () => {
  const cases = [
    judgePropellers(quad(CORRECT).slice(0, 3), RULES),
    judgePropellers(quad(CORRECT, { conf: [0.9, 0.9, 0.9, 0.3] }), RULES),
    judgePropellers(quad(CORRECT), RULES, { unstable: true }),
  ];
  for (const r of cases) assert.ok(r.state === 'UNCERTAIN' && !colors(r).includes('green'));
});
