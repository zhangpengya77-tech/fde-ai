import { describe, expect, it } from 'vitest';

import { createRenderConfig } from '../../src/app/render-config';

describe('createRenderConfig', () => {
  it('caps high-density displays for teaching-laptop performance', () => {
    expect(createRenderConfig(3)).toEqual({
      antialias: true,
      pixelRatio: 2,
      targetFrameRate: 30,
    });
  });

  it('preserves a valid lower device pixel ratio', () => {
    expect(createRenderConfig(1.25).pixelRatio).toBe(1.25);
  });
});
