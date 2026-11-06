// 原子筆搖桿純函式測試：色彩判斷、取樣、找重心、轉搖桿、平滑
import { describe, expect, it } from 'vitest';
import {
  blobToSticks,
  findBlob,
  hueDistance,
  matchesTarget,
  rgbToHsv,
  sampleTarget,
  smooth,
} from '../../src/input/pen/pen-tracker';

/** 產生一張背景灰色、指定方塊為某顏色的 RGBA 影像 */
function frame(w: number, h: number, box: { x: number; y: number; size: number; rgb: [number, number, number] } | null) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 128;
    data[i * 4 + 1] = 128;
    data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 255;
  }
  if (box) {
    for (let y = box.y; y < box.y + box.size; y++) {
      for (let x = box.x; x < box.x + box.size; x++) {
        const i = (y * w + x) * 4;
        [data[i], data[i + 1], data[i + 2]] = box.rgb;
      }
    }
  }
  return data;
}

describe('色彩換算', () => {
  it('紅綠藍的色相正確', () => {
    expect(rgbToHsv(255, 0, 0).h).toBeCloseTo(0);
    expect(rgbToHsv(0, 255, 0).h).toBeCloseTo(120);
    expect(rgbToHsv(0, 0, 255).h).toBeCloseTo(240);
  });

  it('色相差會繞圈計算（350° 與 10° 只差 20°）', () => {
    expect(hueDistance(350, 10)).toBe(20);
  });

  it('灰色、太暗的像素不算目標色', () => {
    const target = { h: 0, s: 1, v: 1, hueTolerance: 18 };
    expect(matchesTarget(rgbToHsv(128, 128, 128), target)).toBe(false);
    expect(matchesTarget(rgbToHsv(30, 0, 0), target)).toBe(false);
    expect(matchesTarget(rgbToHsv(220, 30, 30), target)).toBe(true);
  });
});

describe('取樣目標色', () => {
  it('點在藍色筆蓋上取到藍色', () => {
    const img = frame(40, 30, { x: 10, y: 10, size: 8, rgb: [20, 60, 230] });
    const t = sampleTarget(img, 40, 30, 14, 14);
    expect(t).not.toBeNull();
    expect(hueDistance(t!.h, 228)).toBeLessThan(10);
  });

  it('點在灰色背景上回傳 null（無法追蹤）', () => {
    const img = frame(40, 30, null);
    expect(sampleTarget(img, 40, 30, 5, 5)).toBeNull();
  });
});

describe('找筆尖重心', () => {
  const blue = { h: 228, s: 0.9, v: 0.9, hueTolerance: 18 };

  it('重心落在色塊中央', () => {
    const img = frame(160, 120, { x: 100, y: 20, size: 12, rgb: [20, 60, 230] });
    const b = findBlob(img, 160, 120, blue)!;
    expect(b.x).toBeCloseTo(105 / 160, 1);
    expect(b.y).toBeCloseTo(25 / 120, 1);
  });

  it('畫面裡沒有筆 → null', () => {
    expect(findBlob(frame(160, 120, null), 160, 120, blue)).toBeNull();
  });

  it('筆越靠近鏡頭（色塊越大）面積越大', () => {
    const far = findBlob(frame(160, 120, { x: 70, y: 50, size: 10, rgb: [20, 60, 230] }), 160, 120, blue)!;
    const near = findBlob(frame(160, 120, { x: 60, y: 40, size: 30, rgb: [20, 60, 230] }), 160, 120, blue)!;
    expect(near.area).toBeGreaterThan(far.area);
  });
});

describe('筆尖位置 → 搖桿', () => {
  const c = { x: 0.5, y: 0.5 };

  it('在中心附近（死區內）不動作', () => {
    expect(blobToSticks({ x: 0.51, y: 0.49 }, c)).toEqual({ roll: 0, pitch: 0 });
  });

  it('筆往上移 → 前進（pitch 正）', () => {
    expect(blobToSticks({ x: 0.5, y: 0.2 }, c).pitch).toBeGreaterThan(0.9);
  });

  it('鏡像視角：筆在原始影像往左（使用者的右手邊）→ 向右（roll 正）', () => {
    expect(blobToSticks({ x: 0.2, y: 0.5 }, c, 0.22, true).roll).toBeGreaterThan(0.9);
    expect(blobToSticks({ x: 0.2, y: 0.5 }, c, 0.22, false).roll).toBeLessThan(-0.9);
  });

  it('推到底不會超過 ±1', () => {
    const s = blobToSticks({ x: 0, y: 1 }, c);
    expect(Math.abs(s.roll)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.pitch)).toBeLessThanOrEqual(1);
  });

  it('平滑：新值只跟上一部分，減少手抖', () => {
    const s = smooth({ roll: 0, pitch: 0 }, { roll: 1, pitch: -1 }, 0.5);
    expect(s).toEqual({ roll: 0.5, pitch: -0.5 });
  });
});
