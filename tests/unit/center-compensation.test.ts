import { describe, expect, it } from 'vitest';
import {
  CENTER_OFFSET_MIN,
  CENTER_PARKED_SPREAD,
  compensatedCenter,
  detectCenterOffset,
} from '../../src/ui/center-compensation';
import { createMode2Profile } from '../../src/input/device-profile';

describe('detectCenterOffset', () => {
  it('搖桿停在偏離中心的位置 → 判定偏移', () => {
    const result = detectCenterOffset([0.2, 0.2, 0.2, 0.2], 0, 0.05);
    expect(result.offCenter).toBe(true);
    expect(result.deviation).toBeCloseTo(0.2, 6);
    expect(result.rest).toBeCloseTo(0.2, 6);
  });

  it('搖桿正在移動 → 不算偏移（避免把推動中的桿誤判）', () => {
    const result = detectCenterOffset([-0.9, 0.1, 0.9, -0.1], 0, 0.05);
    expect(result.offCenter).toBe(false);
  });

  it('偏離量沒超過死區 → 不算偏移', () => {
    const result = detectCenterOffset([0.04, 0.04, 0.04, 0.04], 0, 0.05);
    expect(result.offCenter).toBe(false);
    expect(Math.abs(result.deviation)).toBeLessThan(CENTER_OFFSET_MIN);
  });

  it('死區為 0 時仍以 CENTER_OFFSET_MIN 為下限', () => {
    expect(detectCenterOffset([0.02, 0.02, 0.02, 0.02], 0, 0).offCenter).toBe(false);
    expect(detectCenterOffset([0.2, 0.2, 0.2, 0.2], 0, 0).offCenter).toBe(true);
  });

  it('空樣本不判定偏移', () => {
    const result = detectCenterOffset([], 0.3, 0.05);
    expect(result.offCenter).toBe(false);
    expect(result.rest).toBe(0.3);
  });

  it('停著的判準是波動小於 CENTER_PARKED_SPREAD', () => {
    const jittery = detectCenterOffset([0.2, 0.21, 0.19, 0.205], 0, 0.05);
    expect(jittery.offCenter).toBe(true);
    const moving = detectCenterOffset([0.2, 0.2 + CENTER_PARKED_SPREAD + 0.01, 0.2, 0.2], 0, 0.05);
    expect(moving.offCenter).toBe(false);
  });
});

describe('compensatedCenter', () => {
  const calibration = createMode2Profile('pad').axes.pitch.calibration;

  it('取目前靜止值，並夾在已量測的 min/max 內', () => {
    expect(compensatedCenter(0.08, calibration)).toBeCloseTo(0.08, 6);
    expect(compensatedCenter(5, calibration)).toBe(calibration.max);
    expect(compensatedCenter(-5, calibration)).toBe(calibration.min);
  });

  it('非有限值退回原 center', () => {
    expect(compensatedCenter(Number.NaN, calibration)).toBe(calibration.center);
  });
});
