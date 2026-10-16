import { describe, expect, it } from 'vitest';

import { MockInspectionAI } from '../../src/ai/MockInspectionAI';
import type { InspectionAIInput } from '../../src/inspection/types';

function input(overrides: Partial<InspectionAIInput> = {}): InspectionAIInput {
  return {
    targetId: 'INS-T1-RIGHT',
    defectType: 'MISSING_INSULATOR_DISC',
    distanceToTarget: 2.4,
    angleErrorDeg: 3,
    coverageRatio: 0.5,
    ...overrides,
  };
}

describe('MockInspectionAI', () => {
  const ai = new MockInspectionAI();

  it('detects the planted teaching defect deterministically', async () => {
    const result = await ai.inspect(input());
    expect(result.defectDetected).toBe(true);
    expect(result.defectType).toBe('MISSING_INSULATOR_DISC');
    expect(result.source).toBe('mock');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(0.99);
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('is stable: identical input always yields an identical result', async () => {
    const a = await ai.inspect(input());
    const b = await ai.inspect(input());
    expect(a).toEqual(b);
    // Never random - many repeats stay identical.
    const results = await Promise.all(Array.from({ length: 25 }, () => ai.inspect(input())));
    for (const r of results) expect(r).toEqual(a);
  });

  it('always reports source "mock" (never a real model)', async () => {
    const result = await ai.inspect(input());
    expect(result.source).toBe('mock');
  });

  it('returns no defect for a different target', async () => {
    const result = await ai.inspect(input({ targetId: 'INS-T2-LEFT', defectType: 'MISSING_INSULATOR_DISC' }));
    expect(result.defectDetected).toBe(false);
    expect(result.defectType).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
