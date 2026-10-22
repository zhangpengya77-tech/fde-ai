import { describe, expect, it } from 'vitest';

import {
  analyzeRecording,
  buildRecordingReportText,
  EXPECTED_REST_MID,
  RECORDING_DURATION_MS,
  RECORDING_PROMPT,
  REST_OFFCENTER_TOLERANCE,
} from '../../src/ui/raw-axis-recorder';

/**
 * 以「一串每幀樣本」模擬 10 秒錄製：右桿畫圈時 axis0（roll）大幅擺動，
 * 其餘軸靜止。驗證統計、變化量排序、靜止偏離自檢與匯出 JSON。
 */

describe('analyzeRecording', () => {
  it('computes per-axis min/max/mean/start/end and ranks by span', () => {
    const samples = [
      [0.01, 0, -1, -0.006, 0, 0, 0, 0],
      [0.01, 0, -1, -0.006, 0, 0, 0, 0],
      [0.9, 0, -1, -0.006, 0, 0, 0, 0],
      [0.95, 0, -1, -0.006, 0, 0, 0, 0],
      [0.01, 0, -1, -0.006, 0, 0, 0, 0],
    ];
    const report = analyzeRecording(samples, 'pad', 1000);

    expect(report.sampleCount).toBe(5);
    const axis0 = report.axes[0];
    expect(axis0.start).toBeCloseTo(0.01, 6);
    expect(axis0.end).toBeCloseTo(0.01, 6);
    expect(axis0.min).toBeCloseTo(0.01, 6);
    expect(axis0.max).toBeCloseTo(0.95, 6);
    expect(axis0.span).toBeCloseTo(0.94, 6);
    expect(axis0.mean).toBeCloseTo(0.376, 6);
    // 最會動的軸排最前。
    expect(report.ranked[0]).toBe(0);
    // 其餘軸完全沒動。
    expect(report.axes[1].span).toBe(0);
    expect(report.axes[2].span).toBe(0);
  });

  it('ranks several moving axes from largest to smallest span', () => {
    const samples = [
      [0, 0, -1, 0, 0, 0, 0, 0],
      [0.3, 0.8, -1, -0.5, 0, 0, 0, 0],
      [0, 0, -1, 0, 0, 0, 0, 0],
    ];
    const report = analyzeRecording(samples, null, 300);
    // span: axis1=0.8, axis3=0.5, axis0=0.3
    expect(report.ranked.slice(0, 3)).toEqual([1, 3, 0]);
  });

  it('flags axes whose rest value deviates from the expected mid', () => {
    const samples = [
      [0.02, 0.08, -0.98, 0, 0, 0, 0, 0],
      [0.02, 0.08, -0.98, 0, 0, 0, 0, 0],
    ];
    const report = analyzeRecording(samples, null, 100);
    const flag = (axis: number) => report.restFlags.find((entry) => entry.axis === axis)!;

    expect(flag(0).offCenter).toBe(false); // roll 靜止 0.02，偏離 0 < 容許
    expect(flag(1).offCenter).toBe(true); // pitch 靜止 0.08 > 0.05 → 偏離中位
    expect(flag(2).expectedMid).toBe(-1); // 油門預期在底部 -1
    expect(flag(2).deviation).toBeCloseTo(0.02, 6); // -0.98 距 -1 僅 0.02
    expect(flag(2).offCenter).toBe(false);
  });

  it('handles empty samples without throwing', () => {
    const report = analyzeRecording([], null, 0);
    expect(report.sampleCount).toBe(0);
    expect(report.axes).toEqual([]);
    expect(report.ranked).toEqual([]);
    expect(report.restFlags).toEqual([]);
  });

  it('skips NaN/infinite samples and uses the first finite value as the rest baseline', () => {
    const samples = [
      [Number.NaN, 0, -1, 0, 0, 0, 0, 0],
      [0.4, 0, -1, 0, 0, 0, 0, 0],
      [0, 0, -1, 0, 0, 0, 0, 0],
    ];
    const report = analyzeRecording(samples, null, 300);
    const axis0 = report.axes[0];
    expect(Number.isFinite(axis0.start)).toBe(true);
    expect(axis0.start).toBeCloseTo(0.4, 6); // 第一個有限值作為基線
    expect(axis0.max).toBeCloseTo(0.4, 6);
    expect(axis0.span).toBeCloseTo(0.4, 6);
  });

  it('exports JSON text with schema, device and ranked axes', () => {
    const report = analyzeRecording([[0.9, 0, -1, 0, 0, 0, 0, 0]], 'pad-1', 500);
    const parsed = JSON.parse(buildRecordingReportText(report));
    expect(parsed.schema).toBe('fde.raw-axis-recording/1');
    expect(parsed.deviceId).toBe('pad-1');
    expect(parsed.ranked[0]).toBe(0);
    expect(parsed.axes).toHaveLength(8);
  });
});

describe('raw-axis-recorder constants', () => {
  it('matches the requirement', () => {
    expect(RECORDING_DURATION_MS).toBe(10_000);
    expect(RECORDING_PROMPT).toContain('上、右、下、左');
    expect(RECORDING_PROMPT).toContain('右桿');
    expect(REST_OFFCENTER_TOLERANCE).toBeCloseTo(0.05, 6);
    // 自回中三軸預期中位 0、油門底部 -1。
    expect(EXPECTED_REST_MID[0]).toBe(0);
    expect(EXPECTED_REST_MID[1]).toBe(0);
    expect(EXPECTED_REST_MID[3]).toBe(0);
    expect(EXPECTED_REST_MID[2]).toBe(-1);
  });
});
