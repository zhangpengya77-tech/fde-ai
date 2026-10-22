import { describe, expect, it } from 'vitest';
import { toFlightSample } from '../../src/exam/exam-app';
import type { ExamFlightSnapshot } from '../../src/exam/types';

function snap(over: Partial<ExamFlightSnapshot> = {}): ExamFlightSnapshot {
  return {
    state: 'flying',
    mode: 'position',
    position: { x: 1, y: 2, z: -3 },
    velocity: { x: 0, y: 0, z: 0 },
    rollDeg: 0,
    pitchDeg: 0,
    headingDeg: 90,
    altitudeM: 2,
    horizontalSpeedMps: 4,
    verticalSpeedMps: 0.5,
    windVector: { x: 0, y: 0, z: 0 },
    positionHoldCompensating: false,
    ...over,
  };
}

describe('toFlightSample — 快照轉錄製樣本', () => {
  it('欄位正確映射（x/y/z/heading/speed/vy/mode）', () => {
    const f = toFlightSample(snap(), 12.5);
    expect(f.t).toBe(12.5);
    expect(f.x).toBe(1);
    expect(f.y).toBe(2);
    expect(f.z).toBe(-3);
    expect(f.headingDeg).toBe(90);
    expect(f.speedMps).toBe(4);
    expect(f.vy).toBe(0.5);
    expect(f.mode).toBe('position');
  });
  it('手動模式快照 → mode=manual', () => {
    const f = toFlightSample(snap({ mode: 'manual' }), 0);
    expect(f.mode).toBe('manual');
  });
});
