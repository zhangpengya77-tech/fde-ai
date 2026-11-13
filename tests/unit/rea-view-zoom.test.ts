// 3D 畫面滾輪縮放：方向、等比例、上下限、行模式換算
import { describe, expect, it } from 'vitest';
import { VIEW_ZOOM_MAX, VIEW_ZOOM_MIN, nextViewZoom, viewZoomLabel } from '../../src/rea/view-zoom';

describe('滾輪縮放', () => {
  it('往上滾放大、往下滾縮小，同一格倍率相同（等比例）', () => {
    const up = nextViewZoom(1, -100);
    const down = nextViewZoom(1, 100);
    expect(up).toBeGreaterThan(1);
    expect(down).toBeLessThan(1);
    expect(up * down).toBeCloseTo(1, 6);
    expect(nextViewZoom(2, -100) / 2).toBeCloseTo(up, 6);
  });
  it('限制在 ×0.5～×5', () => {
    let z = 1;
    for (let i = 0; i < 100; i++) z = nextViewZoom(z, -100);
    expect(z).toBe(VIEW_ZOOM_MAX);
    for (let i = 0; i < 200; i++) z = nextViewZoom(z, 100);
    expect(z).toBe(VIEW_ZOOM_MIN);
  });
  it('以「行」為單位的滾輪換算成像素；異常值回到 ×1 以內', () => {
    expect(nextViewZoom(1, -3, 1)).toBeCloseTo(nextViewZoom(1, -99), 6);
    expect(nextViewZoom(1, Number.NaN)).toBe(1);
  });
  it('提示文字', () => {
    expect(viewZoomLabel(1.84)).toBe('縮放 ×1.8（雙擊畫面重設）');
  });
});
