export interface RenderConfig {
  antialias: boolean;
  pixelRatio: number;
  targetFrameRate: number;
}

export function createRenderConfig(devicePixelRatio: number): RenderConfig {
  const safePixelRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;

  return {
    antialias: true,
    pixelRatio: Math.min(safePixelRatio, 2),
    targetFrameRate: 30,
  };
}
