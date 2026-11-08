/**
 * 即時鏡頭判定穩定化（純函式模組，可在 node 測試）。
 *
 * createStabilizer(rules) → { push(judgement, frame), reset(), current() }
 *   judgement：judgePropellers 的單幀結果
 *   frame    ：{ width, height }（用來把框的位移換算成畫面比例）
 *
 * 規則（數值全部來自 rules.stability，程式不寫死）：
 *   1. 晃動：本幀與上一幀「所有框中心點的重心」位移超過畫面對角線 × maxCenterShift → 本幀視為 UNCERTAIN（UNSTABLE）
 *   2. 最近 window 幀中，同一個「判定簽章」至少 required 幀 → 成為穩定結果
 *      簽章：CORRECT／WRONG:錯的位置（例如 WRONG:TL,BR）／UNCERTAIN
 *   3. 沒有任何簽章達到 required → 穩定結果為 UNCERTAIN（寧可無法判斷，綠色必須有足夠幀數支持）
 *   4. 收集到 required 幀之前 → 還在判斷中（stable = null）
 *   5. 修正完成：上一個「確定」的穩定狀態（忽略中間的 UNCERTAIN，例如手在換槳時）是 WRONG，現在轉為 CORRECT →
 *      fixed = true，一直保持到離開 CORRECT 為止
 *
 * push 回傳 { stable, signature, changed, fixed, frameSignature, frameUnstable }
 *   stable：穩定的判定結果（judgement 物件；UNCERTAIN 時 reasonCode 會說明原因），或 null（判斷中）
 */
(function attachPropStabilizer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FdePropStabilizer = api;
})(globalThis, function createPropStabilizerModule() {
  function signatureOf(judgement) {
    if (!judgement) return 'UNCERTAIN';
    if (judgement.state === 'CORRECT') return 'CORRECT';
    if (judgement.state === 'WRONG') return `WRONG:${[...judgement.wrong].sort().join(',')}`;
    return 'UNCERTAIN';
  }

  function centroid(judgement) {
    const boxes = (judgement && judgement.boxes) || [];
    if (!boxes.length) return null;
    let x = 0;
    let y = 0;
    for (const box of boxes) {
      x += (box.bbox[0] + box.bbox[2]) / 2;
      y += (box.bbox[1] + box.bbox[3]) / 2;
    }
    return [x / boxes.length, y / boxes.length];
  }

  function uncertainResult(code, base) {
    return {
      ruleVersion: (base && base.ruleVersion) || '',
      state: 'UNCERTAIN', reasonCode: code, positions: {}, wrong: [], allReversed: false,
      boxes: ((base && base.boxes) || []).map((b) => ({ ...b, color: 'gray', position: null })),
    };
  }

  function createStabilizer(rules) {
    const cfg = rules && rules.stability;
    if (!cfg || !(cfg.window > 0) || !(cfg.required > 0) || !(cfg.maxCenterShift > 0) || cfg.required > cfg.window) {
      throw new Error('prop_rules_stability_invalid');
    }
    let history = [];
    let lastCenter = null;
    let stable = null;
    let stableSignature = '';
    let lastDefinite = '';
    let fixed = false;

    function reset() {
      history = [];
      lastCenter = null;
      stable = null;
      stableSignature = '';
      lastDefinite = '';
      fixed = false;
    }

    function push(judgement, frame) {
      const f = frame || {};
      const diag = Math.hypot(Number(f.width) || 0, Number(f.height) || 0);
      const center = centroid(judgement);
      let frameUnstable = false;
      if (center && lastCenter && diag > 0) {
        const shift = Math.hypot(center[0] - lastCenter[0], center[1] - lastCenter[1]) / diag;
        frameUnstable = shift > cfg.maxCenterShift;
      }
      lastCenter = center;
      const frameJudgement = frameUnstable ? uncertainResult('UNSTABLE', judgement) : judgement;
      const frameSignature = signatureOf(frameJudgement);
      history.push({ signature: frameSignature, judgement: frameJudgement });
      if (history.length > cfg.window) history.shift();

      const previous = stableSignature;
      if (history.length < cfg.required) {
        stable = null;
        stableSignature = '';
      } else {
        const counts = new Map();
        for (const item of history) counts.set(item.signature, (counts.get(item.signature) || 0) + 1);
        let winner = '';
        let best = 0;
        for (const [sig, count] of counts) {
          if (count >= cfg.required && count > best) { winner = sig; best = count; }
        }
        if (winner) {
          // 用最新一幀符合該簽章的結果（框的位置最新）
          const latest = [...history].reverse().find((item) => item.signature === winner).judgement;
          stable = latest;
          stableSignature = winner;
        } else {
          // 沒有足夠一致的幀：無法判斷，原因標為畫面不穩定
          stable = uncertainResult('UNSTABLE', frameJudgement);
          stableSignature = 'UNCERTAIN';
        }
      }

      // 修正完成：上一個確定狀態是 WRONG、現在轉 CORRECT
      if (stableSignature === 'CORRECT') {
        if (previous !== 'CORRECT' && lastDefinite.startsWith('WRONG')) fixed = true;
        lastDefinite = 'CORRECT';
      } else {
        fixed = false;
        if (stableSignature.startsWith('WRONG')) lastDefinite = stableSignature;
      }
      return { stable, signature: stableSignature, changed: stableSignature !== previous, fixed, frameSignature, frameUnstable };
    }

    return { push, reset, current: () => ({ stable, signature: stableSignature, fixed }) };
  }

  return { createStabilizer, signatureOf };
});
