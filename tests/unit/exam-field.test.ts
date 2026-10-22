import { describe, expect, it } from 'vitest';
import { loadExamConfig } from '../../src/exam/config';
import {
  buildExamField,
  figure8PathDeviationM,
  hitsAnyCone,
  isBehindExaminee,
  isWithinHMarking,
  isWithinOperationArea,
  radialDeviationM,
} from '../../src/exam/field';

const config = loadExamConfig();
const field = buildExamField(config);

describe('loadExamConfig — 修正 positioning/position 鍵與 defaultForExam 映射', () => {
  it('modes 含 manual/attitude/position 三項且不拋錯', () => {
    expect(config.modes.manual).toBeDefined();
    expect(config.modes.attitude).toBeDefined();
    expect(config.modes.position).toBeDefined();
    expect(config.modes.position.name).toContain('定位');
  });
  it('defaultForExam 映射為 position（非原始 positioning）', () => {
    expect(config.modes.defaultForExam).toBe('position');
  });
});

describe('buildExamField — 操作區', () => {
  it('操作區 80×30，長沿 Z、寬沿 X（半長 40 / 半寬 15）', () => {
    expect(field.operationArea.lengthM).toBe(80);
    expect(field.operationArea.widthM).toBe(30);
    expect(field.operationArea.halfLengthM).toBe(40);
    expect(field.operationArea.halfWidthM).toBe(15);
  });
});

describe('buildExamField — 八字雙圓與角錐（圖11 p233）', () => {
  it('共用交點 P4 於 (0,-16)，兩圓半徑 6m、圓心 ±6', () => {
    expect(field.figure8.crossing).toEqual({ x: 0, z: -16 });
    expect(field.figure8.radiusM).toBe(6);
    expect(field.figure8.leftCircle.center).toEqual({ x: -6, z: -16 });
    expect(field.figure8.rightCircle.center).toEqual({ x: 6, z: -16 });
    expect(field.figure8.leftCircle.radiusM).toBe(6);
    expect(field.figure8.rightCircle.radiusM).toBe(6);
  });

  it('角錐 P1-P7 落於各自圓周（對稱佈局）', () => {
    const c = field.figure8.cones;
    const pt = (p: { x: number; z: number }, x: number, z: number) => {
      expect(p.x).toBeCloseTo(x, 6);
      expect(p.z).toBeCloseTo(z, 6);
    };
    pt(c.P4, 0, -16);
    // 左弧 CCW：P4 → P1(-6,-10) → P2(-12,-16) → P3(-6,-22) → P4
    pt(c.P1, -6, -10);
    pt(c.P2, -12, -16);
    pt(c.P3, -6, -22);
    // 右弧 CW：P4 → P5(6,-10) → P6(12,-16) → P7(6,-22) → P4
    pt(c.P5, 6, -10);
    pt(c.P6, 12, -16);
    pt(c.P7, 6, -22);
  });

  it('每個角錐到所屬圓心距離恰為半徑 6m', () => {
    const { cones, leftCircle, rightCircle } = field.figure8;
    for (const id of ['P1', 'P2', 'P3', 'P4']) {
      const d = Math.hypot(cones[id].x - leftCircle.center.x, cones[id].z - leftCircle.center.z);
      expect(d).toBeCloseTo(6, 5);
    }
    for (const id of ['P5', 'P6', 'P7', 'P4']) {
      const d = Math.hypot(cones[id].x - rightCircle.center.x, cones[id].z - rightCircle.center.z);
      expect(d).toBeCloseTo(6, 5);
    }
  });

  it('弧順序符合官方 leftArcOrder / rightArcOrder', () => {
    expect(field.figure8.leftArcOrder).toEqual(['P4', 'P1', 'P2', 'P3', 'P4']);
    expect(field.figure8.rightArcOrder).toEqual(['P4', 'P5', 'P6', 'P7', 'P4']);
  });
});

describe('buildExamField — H 起降點與監評站位', () => {
  it('H 外標示 1.8m / 內靶 0.5m，置於原點', () => {
    expect(field.landingPointH.position).toEqual({ x: 0, z: 0 });
    expect(field.landingPointH.outerMarkingM).toBe(1.8);
    expect(field.landingPointH.innerTargetM).toBe(0.5);
  });
  it('監評站位距八字中心 4m（圖11 觀察值），置於 (0,-12)', () => {
    expect(field.examinerPosition.position).toEqual({ x: 0, z: -12 });
    expect(field.examinerPosition.stationToCenterM).toBe(4);
  });
  it('應考人後方界線為 z > 3（原點 + 3m 容許後退）', () => {
    expect(field.behindLimitZ).toBe(3);
  });
});

describe('figure8PathDeviationM — 徑向偏差', () => {
  it('位於任一圓周上偏差近 0', () => {
    expect(figure8PathDeviationM(field, 0, -16)).toBeCloseTo(0, 4); // P4 交點
    expect(figure8PathDeviationM(field, -12, -16)).toBeCloseTo(0, 4); // P2（左圓最左）
    expect(figure8PathDeviationM(field, 12, -16)).toBeCloseTo(0, 4); // P6（右圓最右）
  });
  it('向外徑向偏離 1m 偏差約 1m', () => {
    // (1,-16)：左圓距 7、右圓距 5，min |7-6|=1
    expect(figure8PathDeviationM(field, 1, -16)).toBeCloseTo(1, 3);
  });
  it('遠離考場偏差很大', () => {
    expect(figure8PathDeviationM(field, 50, 50)).toBeGreaterThan(50);
  });
});

describe('radialDeviationM — 單圓', () => {
  it('圓上點偏差 0，內偏 2m 偏差 2', () => {
    expect(radialDeviationM({ x: 0, z: -16 }, field.figure8.leftCircle)).toBeCloseTo(0, 4);
    expect(radialDeviationM({ x: -6, z: -16 }, field.figure8.leftCircle)).toBeCloseTo(6, 4); // 圓心
  });
});

describe('isWithinOperationArea', () => {
  it('原點在區內；超出半寬/半長在區外', () => {
    expect(isWithinOperationArea(field, 0, 0)).toBe(true);
    expect(isWithinOperationArea(field, 16, 0)).toBe(false); // |16| > 15
    expect(isWithinOperationArea(field, 0, 41)).toBe(false); // |41| > 40
    expect(isWithinOperationArea(field, 15, 40)).toBe(true); // 邊界內
  });
});

describe('isWithinHMarking', () => {
  it('落於 1.8m 外圈內為 true，超界 false；容差可放寬', () => {
    expect(isWithinHMarking(field, 0, 0)).toBe(true);
    expect(isWithinHMarking(field, 1.8, 0)).toBe(true);
    expect(isWithinHMarking(field, 2, 0)).toBe(false);
    expect(isWithinHMarking(field, 2, 0, 0.5)).toBe(true);
  });
});

describe('hitsAnyCone', () => {
  it('在角錐座標處回傳該角錐 id；遠離回 null', () => {
    expect(hitsAnyCone(field, 0, -16)).toBe('P4');
    expect(hitsAnyCone(field, -12, -16)).toBe('P2');
    expect(hitsAnyCone(field, 100, 100)).toBeNull();
  });
});

describe('isBehindExaminee', () => {
  it('z>3 視為超越應考人後方', () => {
    expect(isBehindExaminee(field, 4)).toBe(true);
    expect(isBehindExaminee(field, 3)).toBe(false);
    expect(isBehindExaminee(field, -10)).toBe(false);
  });
});
