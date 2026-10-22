import { describe, expect, it } from 'vitest';

import { MockInspectionAI } from '../../src/ai/MockInspectionAI';
import { classifyInspectionAIResult } from '../../src/inspection/types';
import type { InspectionAIInput, InspectionAIResult } from '../../src/inspection/types';

/**
 * G1/G2 contract tests.
 *
 * These lock the AI boundary itself, not the teaching scene:
 *  - the request must carry an image and must NOT carry the planted answer;
 *  - a missing image / failed model must resolve to `unavailable`, never to
 *    "no defect";
 *  - `mock` must never be reported as `real`.
 */

const VALID_IMAGE = { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' };

function input(overrides: Partial<InspectionAIInput> = {}): InspectionAIInput {
  return {
    requestId: 'req-1',
    targetId: 'INS-T1-RIGHT',
    image: VALID_IMAGE,
    distanceToTarget: 2.4,
    angleErrorDeg: 3,
    coverageRatio: 0.5,
    ...overrides,
  };
}

describe('InspectionAIInput contract (G1: no ground-truth leakage)', () => {
  it('accepts a request that carries an image and no ground truth', () => {
    // Control case: this shape MUST compile. It proves the object below is
    // otherwise type-correct, so the only error on the next literal is the
    // forbidden `defectType` field - not some unrelated type mistake.
    const accepted: InspectionAIInput = input();
    expect(accepted.image?.dataUrl).toContain('data:image/png');
  });

  it('rejects a request that smuggles the scene answer in', () => {
    // @ts-expect-error - `defectType` is the scene's ground truth and must not be part of the AI input
    const leaked: InspectionAIInput = { requestId: 'req-2', targetId: 'INS-T1-RIGHT', image: VALID_IMAGE, distanceToTarget: 2.4, angleErrorDeg: 3, coverageRatio: 0.5, defectType: 'MISSING_INSULATOR_DISC' };
    expect(leaked).toBeTruthy();
  });

  it('exposes no ground-truth key at runtime either', () => {
    const keys = Object.keys(input());
    expect(keys).not.toContain('defectType');
    expect(keys).not.toContain('expectedDefect');
    expect(keys).not.toContain('groundTruth');
    // The image reference is the only evidence channel a real model may use.
    expect(keys).toContain('image');
  });
});

describe('MockInspectionAI (G2: three-state source)', () => {
  const ai = new MockInspectionAI();

  it('returns unavailable (never "no defect") when the image is missing', async () => {
    const result = await ai.inspect(input({ image: null }));
    expect(result.source).toBe('unavailable');
    expect(result.defectDetected).toBe(false);
    expect(result.defectType).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reason).toBeTruthy();
  });

  it('returns unavailable when the image reference is blank', async () => {
    const result = await ai.inspect(input({ image: { dataUrl: '   ' } }));
    expect(result.source).toBe('unavailable');
    expect(result.reason).toBeTruthy();
  });

  it('never claims "real" - a simulation stays labelled as a simulation', async () => {
    const result = await ai.inspect(input());
    expect(result.source).toBe('mock');
    expect(result.source).not.toBe('real');
  });

  it('only ever emits one of the three declared sources', async () => {
    const results = await Promise.all([
      ai.inspect(input()),
      ai.inspect(input({ targetId: 'INS-T2-LEFT' })),
      ai.inspect(input({ image: null })),
    ]);
    const allowed = new Set(['mock', 'real', 'unavailable']);
    for (const r of results) expect(allowed.has(r.source)).toBe(true);
  });

  it('is deterministic for identical input', async () => {
    const first = await ai.inspect(input());
    const repeats = await Promise.all(Array.from({ length: 25 }, () => ai.inspect(input())));
    for (const r of repeats) expect(r).toEqual(first);
  });

  it('keeps the pre-change confidence baseline for the teaching geometry', async () => {
    // Baseline formula (unchanged): 0.92 - distancePenalty - anglePenalty + coverageBonus
    //   distance 2.4 (ideal) -> 0
    //   angle 3deg / 15 * 0.08 -> 0.016
    //   coverage 0.5 * 0.08 -> 0.04 (capped at 0.04)
    //   => 0.944
    const result = await ai.inspect(input());
    expect(result.confidence).toBeCloseTo(0.944, 10);
  });

  it('ignores a ground-truth field injected at runtime', async () => {
    const clean = await ai.inspect(input());
    const smuggled = await ai.inspect({
      ...input(),
      defectType: 'MISSING_INSULATOR_DISC',
    } as unknown as InspectionAIInput);
    expect(smuggled).toEqual(clean);
  });

  it('reports no defect for a target outside the mock scenario script', async () => {
    const result = await ai.inspect(input({ targetId: 'INS-T2-LEFT' }));
    expect(result.source).toBe('mock');
    expect(result.defectDetected).toBe(false);
    expect(result.confidence).toBe(0);
  });
});

describe('classifyInspectionAIResult (unavailable must not read as "clear")', () => {
  const base: InspectionAIResult = {
    defectDetected: false,
    defectType: null,
    confidence: 0,
    source: 'mock',
  };

  it('treats a missing result as unavailable, not as a pass', () => {
    expect(classifyInspectionAIResult(null)).toBe('unavailable');
  });

  it('treats an explicit unavailable result as unavailable even though defectDetected is false', () => {
    expect(classifyInspectionAIResult({ ...base, source: 'unavailable', reason: '图像缺失' })).toBe(
      'unavailable',
    );
  });

  it('treats a mock "no defect" verdict as clear', () => {
    expect(classifyInspectionAIResult(base)).toBe('clear');
  });

  it('treats a detected defect as defect for both mock and real sources', () => {
    expect(classifyInspectionAIResult({ ...base, defectDetected: true })).toBe('defect');
    expect(classifyInspectionAIResult({ ...base, defectDetected: true, source: 'real' })).toBe('defect');
  });
});

describe('call-site guard (the app must not hand the answer to the AI)', () => {
  it('has no ground-truth field inside the mockAI.inspect call', async () => {
    const raw = (await import('../../src/app/create-app.ts?raw')).default;
    // Comments may legitimately *name* the forbidden field to explain why it is
    // banned; only executable code counts as a leak.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const callIndex = source.indexOf('mockAI.inspect(');
    expect(callIndex).toBeGreaterThan(-1);
    // The request object ends at the first `});` after the call.
    const requestBlock = source.slice(callIndex, source.indexOf('});', callIndex));
    expect(requestBlock).not.toContain('defectType');
    expect(requestBlock).not.toContain('layout.target.defect');
    expect(requestBlock).toContain('image');
  });

  it('does not hand the scene answer to the mock at construction either', async () => {
    const raw = (await import('../../src/app/create-app.ts?raw')).default;
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const ctorIndex = source.indexOf('new MockInspectionAI(');
    expect(ctorIndex).toBeGreaterThan(-1);
    const ctorBlock = source.slice(ctorIndex, source.indexOf('});', ctorIndex));
    // Indirect leakage: passing `layout.target.defectType` as mock config would
    // let the "detector" read the answer without it ever entering the request.
    expect(ctorBlock).not.toContain('defectType');
    expect(ctorBlock).not.toContain('layout.target.defect');
  });
});
