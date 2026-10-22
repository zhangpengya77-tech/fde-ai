import { describe, expect, it } from 'vitest';

import { MockInspectionAI } from '../../src/ai/MockInspectionAI';
import type { InspectionAIInput } from '../../src/inspection/types';

/**
 * The mock is a *scenario script*, not a vision model: it answers for the one
 * target it was configured with. The request carries no ground truth (see
 * `inspection-ai-contract.test.ts`), so nothing here can compare the scene's
 * answer against itself.
 */
function input(overrides: Partial<InspectionAIInput> = {}): InspectionAIInput {
  return {
    requestId: 'req-1',
    targetId: 'INS-T1-RIGHT',
    image: { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' },
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
    const result = await ai.inspect(input({ targetId: 'INS-T2-LEFT' }));
    expect(result.defectDetected).toBe(false);
    expect(result.defectType).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('returns unavailable when there is no image to judge', async () => {
    const result = await ai.inspect(input({ image: null }));
    expect(result.source).toBe('unavailable');
    expect(result.defectDetected).toBe(false);
  });
});
