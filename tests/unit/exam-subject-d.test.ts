/**
 * 科目 D 判定單元測試（側面停懸及前進、後退，AC 107-005D p164）。
 *
 * 以合成飛行樣本直接測 judgeSubjectD 的純函式行為（不經飛控）；
 * 「真的飛完科目」的端到端驗證見 exam-e2e-subject-d.test.ts。
 */

import { describe, expect, it } from 'vitest';
import { buildExamField, subjectDWaypoints } from '../../src/exam/field';
import { loadExamConfig } from '../../src/exam/config';
import { judgeSubjectD } from '../../src/exam/subject-d';
import type { FlightSample } from '../../src/exam/subjects';

const config = loadExamConfig();
const field = buildExamField(config);
const wp = subjectDWaypoints(field);

const DT = 0.05;

function s(t: number, x: number, y: number, z: number, heading: number, speed: number, vy = 0): FlightSample {
  // 合成樣本視為無風（對地速度＝對空速度）。
  return { t, x, y, z, headingDeg: heading, speedMps: speed, groundSpeedMps: speed, vy, mode: 'position' };
}

/** 有號最短路徑角度差（落於 (−180,180]）。 */
function shortest(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

interface GenOptions {
  /** 六個定點各自的懸停秒數。 */
  hover?: number[];
  /** 第二輪方向反轉（H→P3→P7→H）。 */
  reverseSecond?: boolean;
  /** 第一輪後退只走到兩圓中點（不到 P7）。 */
  stopAtMidpoint?: boolean;
  /** 機動過程高度（預設 1.5）。 */
  altitudeM?: number;
  /** 第二輪高度（用於「未維持等高」）。 */
  secondRoundAltitudeM?: number;
}

/** 官方動作序列的定點（左側面一輪 + 右側面一輪）。 */
function steps(reverseSecond: boolean): Array<{ p: { x: number; z: number }; h: number }> {
  const base = [
    { p: wp.p3, h: 270 },
    { p: wp.p7, h: 270 },
    { p: wp.h, h: 270 },
  ];
  const second = reverseSecond
    ? [
        { p: wp.p3, h: 90 },
        { p: wp.p7, h: 90 },
        { p: wp.h, h: 90 },
      ]
    : [
        { p: wp.p7, h: 90 },
        { p: wp.p3, h: 90 },
        { p: wp.h, h: 90 },
      ];
  return [...base, ...second];
}

function genSubjectD(opts: GenOptions = {}): FlightSample[] {
  const hover = opts.hover ?? [5.5, 5.5, 5.5, 5.5, 5.5, 5.5];
  const alt = opts.altitudeM ?? 1.5;
  const alt2 = opts.secondRoundAltitudeM ?? alt;
  const seq = steps(opts.reverseSecond ?? false);
  const out: FlightSample[] = [];
  let t = 0;

  // 起飛爬升（y < 0.15 不算空中，不會形成平台）。
  for (let i = 0; i <= 40; i += 1) {
    out.push(s(i * DT, 0, Math.min(alt, 0.75 * i * DT), 0, 0, i < 27 ? 0 : 0));
  }
  t = 40 * DT;

  const transit = (from: { x: number; z: number }, to: { x: number; z: number }, fromH: number, toH: number, speed = 3): void => {
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const dur = Math.max(dist / speed, 0.5);
    const n = Math.max(2, Math.round(dur / DT));
    const dh = shortest(fromH, toH);
    for (let i = 1; i <= n; i += 1) {
      const f = i / n;
      out.push(
        s(
          t + i * DT,
          from.x + (to.x - from.x) * f,
          alt,
          from.z + (to.z - from.z) * f,
          fromH + dh * f,
          speed,
        ),
      );
    }
    t += n * DT;
  };

  const hold = (p: { x: number; z: number }, h: number, seconds: number, altitude: number): void => {
    const n = Math.max(1, Math.round(seconds / DT));
    for (let i = 1; i <= n; i += 1) out.push(s(t + i * DT, p.x, altitude, p.z, h, 0));
    t += n * DT;
  };

  let from = wp.h;
  let heading = 0;
  seq.forEach((step, i) => {
    let target = step.p;
    // 第一輪後退只走到兩圓中點。
    if (opts.stopAtMidpoint && i === 1) {
      target = { x: (wp.p3.x + wp.p7.x) / 2, z: (wp.p3.z + wp.p7.z) / 2 };
    }
    const altitude = i >= 3 ? alt2 : alt;
    transit(from, target, heading, step.h);
    from = target;
    heading = step.h;
    hold(target, step.h, hover[i] ?? 5.5, altitude);
  });

  // 機頭朝外，降落於 H。
  transit(from, wp.h, heading, 0);
  for (let i = 1; i <= 40; i += 1) {
    out.push(s(t + i * DT, 0, Math.max(0, alt * (1 - i / 40)), 0, 0, 0, -0.75));
  }
  out.push(s(t + 41 * DT, 0, 0, 0, 0, 0, -0.75));
  return out;
}

const run = (samples: FlightSample[]) => judgeSubjectD(samples, config, field, { configRetreatDistanceM: 12, level: 'I' });

describe('科目D — 場幾何（對應官方 p164 後退距離級距 I = 12m）', () => {
  it('P3 在左圓、P7 在右圓，P3↔P7 間距 = 12m', () => {
    expect(wp.p3.x).toBeLessThan(0);
    expect(wp.p7.x).toBeGreaterThan(0);
    expect(wp.retreatSpacingM).toBeCloseTo(12, 6);
  });
  it('官方級距 I/II/III = 12/18/24（config.subjects.D.params）', () => {
    expect(config.subjects.D.params.retreatDistanceByLevelM).toEqual({ I: 12, II: 18, III: 24 });
    expect(config.subjects.D.params.hoverSecondsMin).toBe(5);
    expect(config.subjects.D.page).toBe(164);
  });
});

describe('科目D — 理想操作 → S', () => {
  it('六個定點各懸停 5.5s、兩輪橫向跨度 12m → S', () => {
    const r = run(genSubjectD());
    expect(r.executed).toBe(true);
    expect(r.rating).toBe('S');
    expect(r.failReasonKeys).toEqual([]);
    expect(r.raw.waypoints.map((w) => w.id)).toEqual(['P3', 'P7', 'H', 'P7', 'P3', 'H']);
    expect(r.raw.waypoints.every((w) => w.matched)).toBe(true);
    r.raw.waypoints.forEach((w) => {
      expect(w.hoverSeconds).toBeGreaterThanOrEqual(4.8);
      expect(w.driftM).toBeLessThanOrEqual(0.5);
    });
    // 左輪：前進到 P3（−X）、後退到 P7（+X）、前進回 H（−X）。
    expect(r.raw.waypoints[0].arrivalDirection).toBe('forward');
    expect(r.raw.waypoints[1].arrivalDirection).toBe('backward');
    expect(r.raw.waypoints[2].arrivalDirection).toBe('forward');
    // 右輪：前進到 P7（+X）、後退到 P3（−X）、前進回 H（+X）。
    expect(r.raw.waypoints[3].arrivalDirection).toBe('forward');
    expect(r.raw.waypoints[4].arrivalDirection).toBe('backward');
    expect(r.raw.waypoints[5].arrivalDirection).toBe('forward');
    // 兩輪橫向跨度都達到場地 P3↔P7 間距。
    expect(r.raw.retreatTravelM).toBeGreaterThanOrEqual(11);
    expect(r.raw.altitudeMinM).toBeCloseTo(1.5, 5);
    expect(r.raw.altitudeMaxM).toBeCloseTo(1.5, 5);
  });

  it('航向序列：左輪 270°、右輪 90°（機頭朝側面）', () => {
    const r = run(genSubjectD());
    expect(r.raw.waypoints.map((w) => w.headingDeg)).toEqual([270, 270, 270, 90, 90, 90]);
  });
});

describe('科目D — 不良操作 → U', () => {
  it('未起飛 → N', () => {
    const samples = genSubjectD().map((smp) => ({ ...smp, y: 0 }));
    const r = run(samples);
    expect(r.executed).toBe(false);
    expect(r.rating).toBe('N');
    expect(r.failReasonKeys).toContain('subjectD.notExecuted');
  });

  it('某定點只懸停 3s（< 4.8s 容差）→ U（hoverFail）', () => {
    const r = run(genSubjectD({ hover: [5.5, 5.5, 5.5, 3, 5.5, 5.5] }));
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectD.hoverFail');
    expect(r.raw.waypoints[3].hoverSeconds).toBeLessThan(4.8);
  });

  it('右輪前進/後退搞反（H→P3→P7→H）→ U（directionFail）', () => {
    const r = run(genSubjectD({ reverseSecond: true }));
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectD.directionFail');
  });

  it('後退只走到兩圓中點（不到 P7）→ U（missingHover 且橫向跨度不足）', () => {
    const r = run(genSubjectD({ stopAtMidpoint: true }));
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectD.missingHover');
    expect(r.failReasonKeys).toContain('subjectD.retreatFail');
    // 第一輪只跨越 P3→中點→H，橫向跨度約 6m < 11m。
    expect(r.raw.retreatTravelM).toBeLessThan(11);
    expect(r.raw.waypoints[1].matched).toBe(false);
  });

  it('第二輪飛高 0.5m（未維持定點等高）→ U（altitudeSpreadFail）', () => {
    const r = run(genSubjectD({ secondRoundAltitudeM: 2.0 }));
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectD.altitudeSpreadFail');
    expect(r.raw.altitudeMaxM).toBeGreaterThan(1.8);
  });

  it('懸停點偏離定點 1m（超出 0.5m 定位容差）→ U（視為未到該定點）', () => {
    const samples = genSubjectD();
    // 把第二個定點（P7@270）的懸停樣本整體平移 +1m x。
    const shifted = samples.map((smp) => {
      const nearP7 = Math.hypot(smp.x - wp.p7.x, smp.z - wp.p7.z) < 0.01 && Math.abs(smp.headingDeg - 270) < 1;
      return nearP7 ? { ...smp, x: smp.x + 1 } : smp;
    });
    const r = run(shifted);
    expect(r.rating).toBe('U');
    // 定位容差 0.5m 同時是「是否算到達該定點」的門檻；偏 1m 即未到達。
    expect(r.failReasonKeys).toContain('subjectD.missingHover');
    expect(r.raw.waypoints[1].matched).toBe(false);
  });
});

describe('科目D — 級距差異如實記錄（不自創及格線）', () => {
  it('官方級距 II（18m）與場地間距（12m）不符時，原始量測記錄兩者', () => {
    const r = judgeSubjectD(genSubjectD(), config, field, { configRetreatDistanceM: 18, level: 'II' });
    expect(r.raw.configRetreatDistanceM).toBe(18);
    expect(r.raw.retreatSpacingM).toBeCloseTo(12, 6);
    expect(r.raw.level).toBe('II');
    // 場地為級距 I 幾何，故級距 II 的 18m 無法重現——判定仍以場地實際跨度為準。
    expect(r.rating).toBe('S');
  });
});
