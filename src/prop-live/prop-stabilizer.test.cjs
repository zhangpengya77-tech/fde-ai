// 穩定化模組測試（node --test）：8 幀取 5、晃動、修正完成、絕不在證據不足時顯示綠色。規則一律讀設定檔。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { judgePropellers } = require('./prop-judge.js');
const { createStabilizer } = require('./prop-stabilizer.js');

const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, 'prop-judge-rules.json'), 'utf8'));
const FRAME = { width: 1280, height: 720 };

function quad(classes, { cx = 640, cy = 360, d = 200, s = 140, conf = 0.9 } = {}) {
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([ox, oy], i) => ({
    class: classes[i], confidence: conf, bbox: [cx + ox * d - s / 2, cy + oy * d - s / 2, cx + ox * d + s / 2, cy + oy * d + s / 2],
  }));
}
const J = {
  correct: (o) => judgePropellers(quad(['CW', 'CCW', 'CCW', 'CW'], o), RULES),
  wrongTL: (o) => judgePropellers(quad(['CCW', 'CCW', 'CCW', 'CW'], o), RULES),
  missing: (o) => judgePropellers(quad(['CW', 'CCW', 'CCW', 'CW'], o).slice(0, 3), RULES),
};
function feed(stab, seq) {
  let out = null;
  for (const make of seq) out = stab.push(make(), FRAME);
  return out;
}
const repeat = (make, n) => Array(n).fill(make);

test('設定值來自規則檔：8 幀取 5', () => {
  assert.equal(RULES.stability.window, 8);
  assert.equal(RULES.stability.required, 5);
});

test('前 4 幀還在判斷中（stable = null），第 5 幀一致才出現結果', () => {
  const s = createStabilizer(RULES);
  for (let i = 0; i < 4; i++) assert.equal(s.push(J.correct(), FRAME).stable, null);
  const out = s.push(J.correct(), FRAME);
  assert.equal(out.stable.state, 'CORRECT');
  assert.equal(out.changed, true);
});

test('偶爾閃一幀錯（8 幀中 1 幀 WRONG）不會切換，仍維持正確', () => {
  const s = createStabilizer(RULES);
  feed(s, repeat(J.correct, 8));
  const out = feed(s, [J.wrongTL, J.correct]);
  assert.equal(out.stable.state, 'CORRECT');
});

test('正確／錯誤各半（4:4）沒有過半 → 無法判斷，不顯示綠色', () => {
  const s = createStabilizer(RULES);
  const out = feed(s, [J.correct, J.wrongTL, J.correct, J.wrongTL, J.correct, J.wrongTL, J.correct, J.wrongTL]);
  assert.equal(out.stable.state, 'UNCERTAIN');
  assert.equal(out.stable.reasonCode, 'UNSTABLE');
  assert.ok(out.stable.boxes.every((b) => b.color === 'gray'));
});

test('需要 5 幀錯才切成 WRONG（4 幀錯時仍是無法判斷而不是綠色）', () => {
  const s = createStabilizer(RULES);
  feed(s, repeat(J.correct, 8));
  let out = feed(s, repeat(J.wrongTL, 4));
  assert.equal(out.stable.state, 'UNCERTAIN', '4 正 4 錯：沒有過半');
  out = s.push(J.wrongTL(), FRAME);
  assert.equal(out.stable.state, 'WRONG');
  assert.deepEqual(out.stable.wrong, ['TL']);
});

test('錯誤位置不同視為不同簽章（左上錯 vs 右下錯不會互相累計）', () => {
  const s = createStabilizer(RULES);
  const wrongBR = () => judgePropellers(quad(['CW', 'CCW', 'CCW', 'CCW']), RULES);
  const out = feed(s, [J.wrongTL, J.wrongTL, J.wrongTL, wrongBR, wrongBR, wrongBR, J.wrongTL, wrongBR]);
  assert.equal(out.stable.state, 'UNCERTAIN');
});

test('修正完成：WRONG 穩定後換槳（中間手擋住、無法判斷）再轉 CORRECT → fixed=true', () => {
  const s = createStabilizer(RULES);
  feed(s, repeat(J.wrongTL, 8));
  feed(s, repeat(J.missing, 8));
  const out = feed(s, repeat(J.correct, 8));
  assert.equal(out.stable.state, 'CORRECT');
  assert.equal(out.fixed, true);
});

test('一開始就正確（沒有先錯）→ 不是修正完成', () => {
  const s = createStabilizer(RULES);
  assert.equal(feed(s, repeat(J.correct, 8)).fixed, false);
});

test('修正完成訊息只在持續正確期間保留，離開正確就清除', () => {
  const s = createStabilizer(RULES);
  feed(s, repeat(J.wrongTL, 8));
  assert.equal(feed(s, repeat(J.correct, 8)).fixed, true);
  assert.equal(feed(s, repeat(J.missing, 8)).fixed, false);
  assert.equal(feed(s, repeat(J.correct, 8)).fixed, false, '上一個確定狀態已是 CORRECT');
});

test('畫面晃動：框的重心一幀移動超過對角線 6% → 該幀視為 UNSTABLE', () => {
  const s = createStabilizer(RULES);
  s.push(J.correct({ cx: 400 }), FRAME);
  const out = s.push(J.correct({ cx: 600 }), FRAME); // 位移 200 / 對角線 1469 ≈ 13.6%
  assert.equal(out.frameUnstable, true);
  assert.equal(out.frameSignature, 'UNCERTAIN');
});

test('小幅移動（約 2%）不算晃動', () => {
  const s = createStabilizer(RULES);
  s.push(J.correct({ cx: 640 }), FRAME);
  assert.equal(s.push(J.correct({ cx: 670 }), FRAME).frameUnstable, false);
});

test('持續晃動 → 穩定結果為無法判斷，即使每一幀單看都是正確', () => {
  const s = createStabilizer(RULES);
  let out = null;
  for (let i = 0; i < 10; i++) out = s.push(J.correct({ cx: i % 2 ? 400 : 700 }), FRAME);
  assert.equal(out.stable.state, 'UNCERTAIN');
  assert.ok(!out.stable.boxes.some((b) => b.color === 'green'));
});

test('reset 後重新開始判斷', () => {
  const s = createStabilizer(RULES);
  feed(s, repeat(J.correct, 8));
  s.reset();
  assert.equal(s.push(J.correct(), FRAME).stable, null);
});

test('穩定設定不合理（required > window）直接丟錯', () => {
  assert.throws(() => createStabilizer({ ...RULES, stability: { window: 4, required: 5, maxCenterShift: 0.06 } }), /prop_rules_stability_invalid/);
});
