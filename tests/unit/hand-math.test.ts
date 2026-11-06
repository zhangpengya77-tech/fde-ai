// 手勢搖桿純函式測試：掌心、手掌大小、握拳、左右手分配、位置轉搖桿
import { describe, expect, it } from 'vitest';
import { assignHands, handToStick, isFist, palmCenter, palmSize, type Landmark } from '../../src/input/gesture/hand-math';

/** 產生一隻手的 21 個關鍵點：open=true 張開、false 握拳；以 (cx, cy) 為手掌中心、s 為大小 */
function hand(cx: number, cy: number, s = 0.1, open = true): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  lm[0] = { x: cx, y: cy + s * 0.6 }; // 手腕在下
  const mcp = [5, 9, 13, 17];
  mcp.forEach((i, k) => (lm[i] = { x: cx + (k - 1.5) * s * 0.3, y: cy - s * 0.4 }));
  const tips = [8, 12, 16, 20];
  tips.forEach((i, k) => (lm[i] = open ? { x: cx + (k - 1.5) * s * 0.35, y: cy - s * 1.5 } : { x: cx + (k - 1.5) * s * 0.2, y: cy - s * 0.1 }));
  lm[4] = { x: cx - s * 0.6, y: cy };
  return lm;
}

describe('手部幾何', () => {
  it('掌心約在手掌中央', () => {
    const c = palmCenter(hand(0.5, 0.5));
    expect(c.x).toBeCloseTo(0.5, 2);
    expect(c.y).toBeGreaterThan(0.45);
    expect(c.y).toBeLessThan(0.55);
  });

  it('手越近（越大）手掌大小越大', () => {
    expect(palmSize(hand(0.5, 0.5, 0.2))).toBeGreaterThan(palmSize(hand(0.5, 0.5, 0.1)));
  });

  it('張開手不是握拳；握拳判斷為握拳', () => {
    expect(isFist(hand(0.5, 0.5, 0.1, true))).toBe(false);
    expect(isFist(hand(0.5, 0.5, 0.1, false))).toBe(true);
  });
});

describe('左右手分配', () => {
  it('只有一隻手＝右手', () => {
    const h = hand(0.7, 0.5);
    expect(assignHands([h])).toEqual({ right: h, left: null });
  });

  it('兩隻手：原始影像左側＝使用者的右手', () => {
    const a = hand(0.8, 0.5);
    const b = hand(0.2, 0.5);
    const r = assignHands([a, b]);
    expect(r.right).toBe(b);
    expect(r.left).toBe(a);
  });

  it('沒有手', () => {
    expect(assignHands([])).toEqual({ right: null, left: null });
  });
});

describe('手掌位置 → 搖桿', () => {
  const n = { x: 0.5, y: 0.5 };
  it('中心附近不動作', () => {
    expect(handToStick({ x: 0.51, y: 0.49 }, n)).toEqual({ x: 0, y: 0 });
  });
  it('手往上＝前進；鏡像下原始影像往左＝向右', () => {
    expect(handToStick({ x: 0.5, y: 0.3 }, n).y).toBeCloseTo(1);
    expect(handToStick({ x: 0.3, y: 0.5 }, n).x).toBeCloseTo(1);
  });
  it('不超過 ±1', () => {
    const s = handToStick({ x: 0, y: 1 }, n);
    expect(Math.abs(s.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.y)).toBeLessThanOrEqual(1);
  });
});
