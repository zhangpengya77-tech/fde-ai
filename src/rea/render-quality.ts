export type RenderQuality = 'low' | 'medium' | 'high';

export interface RenderQualityPreset {
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
}

/** Conservative renderer budgets; flight physics and scoring are unaffected. */
export const RENDER_QUALITY_PRESETS: Record<RenderQuality, RenderQualityPreset> = {
  low: { maxPixelRatio: 1, shadows: false, shadowMapSize: 512 },
  medium: { maxPixelRatio: 1.25, shadows: true, shadowMapSize: 1024 },
  high: { maxPixelRatio: 2, shadows: true, shadowMapSize: 2048 },
};

export function normalizeRenderQuality(value: unknown): RenderQuality {
  return value === 'low' || value === 'high' || value === 'medium' ? value : 'medium';
}
