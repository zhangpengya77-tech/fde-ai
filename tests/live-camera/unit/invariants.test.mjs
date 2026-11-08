// vitest：即時鏡頭檢測的「永遠成立」規則（隨機輸入 × 大量案例），補足 src/prop-live/*.test.cjs 的固定案例。
import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const root = new URL('../../../src/prop-live/', import.meta.url);
const { judgePropellers } = require(new URL('prop-judge.js', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const { createStabilizer } = require(new URL('prop-stabilizer.js', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const { buildRuleAnswer } = require(new URL('prop-qa.js', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RULES = JSON.parse(readFileSync(new URL('prop-judge-rules.json', root), 'utf8'));
const MSG = JSON.parse(readFileSync(new URL('prop-live.zh-TW.json', root), 'utf8'));

// 可重現的亂數
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

function randomDetections(r) {
  const n = Math.floor(r() * 7); // 0~6 個框
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = r() * 1200;
    const y = r() * 680;
    const s = 20 + r() * 160;
    out.push({ class: r() < 0.05 ? 'CW_F' : r() < 0.5 ? 'CW' : 'CCW', confidence: Math.round(r() * 100) / 100, bbox: [x, y, x + s, y + s] });
  }
  return out;
}

describe('判定模組不變式（2,000 組隨機偵測）', () => {
  const r = rng(20261108);
  const cases = Array.from({ length: 2000 }, () => randomDetections(r));

  test('無法判斷時絕不出現綠框或紅框', () => {
    for (const dets of cases) {
      const j = judgePropellers(dets, RULES);
      if (j.state === 'UNCERTAIN') expect(j.boxes.every((b) => b.color === 'gray')).toBe(true);
    }
  });

  test('判為正確時：恰好 4 個達標框、分在 4 個象限、類別全部符合設定檔版面', () => {
    for (const dets of cases) {
      const j = judgePropellers(dets, RULES);
      if (j.state !== 'CORRECT') continue;
      expect(dets.filter((d) => d.confidence >= RULES.minConfidence)).toHaveLength(4);
      expect(Object.keys(j.positions).sort()).toEqual(['BL', 'BR', 'TL', 'TR']);
      for (const q of Object.keys(j.positions)) expect(j.positions[q].detected).toBe(RULES.layout[q]);
      expect(j.boxes.every((b) => b.color === 'green')).toBe(true);
    }
  });

  test('判為裝錯時：紅框恰好是錯的位置，其餘為綠框', () => {
    for (const dets of cases) {
      const j = judgePropellers(dets, RULES);
      if (j.state !== 'WRONG') continue;
      for (const b of j.boxes) expect(b.color).toBe(j.wrong.includes(b.position) ? 'red' : 'green');
      expect(j.wrong.length).toBeGreaterThan(0);
    }
  });

  test('平移、等比縮放、調換順序都不改變結果', () => {
    for (const dets of cases) {
      const base = judgePropellers(dets, RULES);
      const moved = dets.map((d) => ({ ...d, bbox: d.bbox.map((v, i) => v * 0.5 + (i % 2 ? 40 : 90)) }));
      const shuffled = [...dets].reverse();
      for (const other of [moved, shuffled]) {
        const j = judgePropellers(other, RULES);
        expect(j.state).toBe(base.state);
        expect([...j.wrong].sort()).toEqual([...base.wrong].sort());
      }
    }
  });

  test('出現舊四類（F/B）類別一律無法判斷', () => {
    for (const dets of cases) {
      if (dets.some((d) => d.class === 'CW_F' && d.confidence >= RULES.candidateConfidence)) {
        expect(judgePropellers(dets, RULES).state).toBe('UNCERTAIN');
      }
    }
  });
});

describe('穩定化不變式（500 段隨機序列）', () => {
  const correct = judgePropellers([[-1, -1, 'CW'], [1, -1, 'CCW'], [-1, 1, 'CCW'], [1, 1, 'CW']].map(([ox, oy, c]) => ({ class: c, confidence: 0.9, bbox: [640 + ox * 200 - 60, 360 + oy * 200 - 60, 640 + ox * 200 + 60, 360 + oy * 200 + 60] })), RULES);
  const wrong = judgePropellers([[-1, -1, 'CCW'], [1, -1, 'CCW'], [-1, 1, 'CCW'], [1, 1, 'CW']].map(([ox, oy, c]) => ({ class: c, confidence: 0.9, bbox: [640 + ox * 200 - 60, 360 + oy * 200 - 60, 640 + ox * 200 + 60, 360 + oy * 200 + 60] })), RULES);
  const unsure = judgePropellers([], RULES);

  test('穩定結果為正確時，最近 8 幀中至少 5 幀是正確；否則不會是綠色', () => {
    const r = rng(7);
    for (let n = 0; n < 500; n++) {
      const s = createStabilizer(RULES);
      const recent = [];
      for (let k = 0; k < 30; k++) {
        const x = r();
        const j = x < 0.5 ? correct : x < 0.8 ? wrong : unsure;
        recent.push(j.state);
        if (recent.length > RULES.stability.window) recent.shift();
        const out = s.push(j, { width: 1280, height: 720 });
        if (out.stable && out.stable.state === 'CORRECT') {
          expect(recent.filter((st) => st === 'CORRECT').length).toBeGreaterThanOrEqual(RULES.stability.required);
        }
      }
    }
  });
});

describe('問答不變式', () => {
  test('只有穩定結果是正確時，回答才會以「對」開頭；無法判斷時不說對也不說錯', () => {
    const states = [null, judgePropellers([], RULES)];
    for (const stable of states) {
      const a = buildRuleAnswer({ stable, signature: stable ? 'UNCERTAIN' : '', fixed: false }, MSG, RULES);
      expect(a.text.startsWith(MSG.qa.yes)).toBe(false);
      expect(a.text.startsWith(MSG.qa.no)).toBe(false);
    }
  });
});
