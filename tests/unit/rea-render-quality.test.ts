import { describe, expect, it } from 'vitest';
import { normalizeRenderQuality, RENDER_QUALITY_PRESETS } from '../../src/rea/render-quality';

describe('REA renderer quality budgets', () => {
  it('keeps the low preset within the medium and high pixel/shadow budgets', () => {
    expect(RENDER_QUALITY_PRESETS.low.maxPixelRatio).toBeLessThanOrEqual(RENDER_QUALITY_PRESETS.medium.maxPixelRatio);
    expect(RENDER_QUALITY_PRESETS.medium.maxPixelRatio).toBeLessThanOrEqual(RENDER_QUALITY_PRESETS.high.maxPixelRatio);
    expect(RENDER_QUALITY_PRESETS.low.shadowMapSize).toBeLessThanOrEqual(RENDER_QUALITY_PRESETS.medium.shadowMapSize);
    expect(RENDER_QUALITY_PRESETS.medium.shadowMapSize).toBeLessThanOrEqual(RENDER_QUALITY_PRESETS.high.shadowMapSize);
    expect(RENDER_QUALITY_PRESETS.low.shadows).toBe(false);
  });

  it('normalizes absent or unsupported stored preferences to medium', () => {
    expect(normalizeRenderQuality('low')).toBe('low');
    expect(normalizeRenderQuality('high')).toBe('high');
    expect(normalizeRenderQuality(undefined)).toBe('medium');
    expect(normalizeRenderQuality('ultra')).toBe('medium');
  });
});
