import { describe, expect, it } from 'vitest';
import { loadExamConfig } from '../../src/exam/config';
import { buildExamField } from '../../src/exam/field';
import {
  approachToP1,
  arcPoints,
  figure8Maneuver,
  figure8Path,
  leftArc,
  linePoints,
  pathLength,
  returnToHome,
  rightArc,
} from '../../src/exam/scripted-programs';

const config = loadExamConfig();
const field = buildExamField(config);

describe('scripted-programs — 取樣工具', () => {
  it('arcPoints 起終點落在圓周上、角度遞增', () => {
    const pts = arcPoints({ x: 0, z: 0 }, 6, 0, 90, 0.2);
    expect(pts[0]).toEqual({ x: 6, z: 0 });
    expect(pts[pts.length - 1].z).toBeCloseTo(6, 6);
    expect(pts.length).toBeGreaterThan(10);
  });

  it('linePoints 首尾即端點', () => {
    const pts = linePoints({ x: 0, z: 0 }, { x: 3, z: 4 }, 1);
    expect(pts[0]).toEqual({ x: 0, z: 0 });
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(3, 9);
    expect(last.z).toBeCloseTo(4, 9);
    expect(pts).toHaveLength(6); // 5m / 1m 步長 + 端點
  });

  it('pathLength 累計弧長', () => {
    expect(pathLength(linePoints({ x: 0, z: 0 }, { x: 3, z: 4 }, 1))).toBeCloseTo(5, 6);
  });
});

describe('scripted-programs — 八字路徑幾何', () => {
  it('進場段由 H 出發、以切向併入 P1', () => {
    const pts = approachToP1(field);
    expect(pts[0]).toEqual({ x: 0, z: 0 });
    const p1 = field.figure8.cones.P1;
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(p1.x, 6);
    expect(last.z).toBeCloseTo(p1.z, 6);
  });

  it('左弧：P1 起、P4 訖，逆時針（官方順序 P1→P2→P3→P4）', () => {
    const pts = leftArc(field);
    const p1 = field.figure8.cones.P1;
    const p4 = field.figure8.crossing;
    expect(pts[0].x).toBeCloseTo(p1.x, 6);
    expect(pts[0].z).toBeCloseTo(p1.z, 6);
    expect(pts[pts.length - 1].x).toBeCloseTo(p4.x, 6);
    expect(pts[pts.length - 1].z).toBeCloseTo(p4.z, 6);
    // 官方半徑 6m（config.figure8.circleRadiusM）。
    expect(config.field.figure8.circleRadiusM).toBe(6);
    expect(pathLength(pts)).toBeCloseTo((3 * Math.PI * 6) / 2, 0);
  });

  it('右弧：P4 起、P4 訖，順時針一圈', () => {
    const pts = rightArc(field);
    const p4 = field.figure8.crossing;
    expect(pts[0].x).toBeCloseTo(p4.x, 6);
    expect(pts[pts.length - 1].x).toBeCloseTo(p4.x, 6);
    expect(pathLength(pts)).toBeCloseTo(2 * Math.PI * 6, 0);
  });

  it('返航段由 P4 回到 H', () => {
    const pts = returnToHome(field);
    expect(pts[0].x).toBeCloseTo(0, 6);
    expect(pts[0].z).toBeCloseTo(field.figure8.crossing.z, 6);
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(0, 9);
    expect(last.z).toBeCloseTo(0, 9);
  });

  it('機動段 = 進場 + 左弧 + 右弧；完整路徑再加返航', () => {
    const maneuver = figure8Maneuver(field);
    const full = figure8Path(field);
    expect(full.length).toBeGreaterThan(maneuver.length);
    expect(pathLength(full)).toBeGreaterThan(pathLength(maneuver));
  });

  it('半徑縮放只影響指定弧（leftRadiusScale）', () => {
    const normal = leftArc(field);
    const scaled = leftArc(field, { leftRadiusScale: 1.3 });
    // 起點同為 P1（縮放自圓心等比放大，P1 在圓上角度 90° → 位置變遠）。
    expect(scaled[0].z).toBeGreaterThan(normal[0].z);
    expect(rightArc(field, { leftRadiusScale: 1.3 })).toHaveLength(rightArc(field).length);
  });

  it('官方強約束：兩圓半徑 6m、圓心相距 12m、交點 P4 相切', () => {
    expect(field.figure8.leftCircle.radiusM).toBe(6);
    expect(field.figure8.rightCircle.radiusM).toBe(6);
    const dx = field.figure8.rightCircle.center.x - field.figure8.leftCircle.center.x;
    expect(dx).toBeCloseTo(12, 9);
    // P4 同時在兩圓周上。
    for (const c of field.figure8.circles) {
      const d = Math.hypot(field.figure8.crossing.x - c.center.x, field.figure8.crossing.z - c.center.z);
      expect(d).toBeCloseTo(6, 9);
    }
  });
});
