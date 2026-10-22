import { describe, expect, it } from 'vitest';
import { buildExamField } from '../../src/exam/field';
import { loadExamConfig } from '../../src/exam/config';
import { judgeSubjectB, judgeSubjectC, type FlightSample } from '../../src/exam/subjects';

const config = loadExamConfig();
const field = buildExamField(config);

const DT = 0.05;
function s(t: number, x: number, y: number, z: number, heading: number, speed: number, vy: number): FlightSample {
  return { t, x, y, z, headingDeg: heading, speedMps: speed, vy, mode: 'position' };
}

// --- 科目 B 樣本產生器 -------------------------------------------------------
function genSubjectB(opts: { hover?: number[]; land?: { x: number; z: number }; rotDir?: 1 | -1 } = {}): FlightSample[] {
  const hover = opts.hover ?? [5, 5, 5, 5, 5];
  const land = opts.land ?? { x: 0, z: 0 };
  const out: FlightSample[] = [];
  let t = 0;
  const push = (tt: number, x: number, y: number, z: number, h: number, sp: number, vyy: number) => out.push(s(tt, x, y, z, h, sp, vyy));
  for (let i = 0; i <= 40; i++) {
    const tt = i * DT;
    push(tt, 0, Math.min(1.5, 0.75 * tt), 0, 0, 0, tt < 2 ? 0.75 : 0);
  }
  t = 2;
  let curHeading = 0;
  for (let k = 0; k < 5; k += 1) {
    const dur = hover[k];
    for (let i = 1; i <= Math.round(dur / DT); i += 1) push(t + i * DT, 0, 1.5, 0, curHeading, 0, 0);
    t += dur;
    if (k < 4) {
      const from = curHeading;
      const to = curHeading + 90 * (opts.rotDir ?? 1);
      for (let i = 1; i <= 20; i += 1) {
        const h = from + (to - from) * (i / 20);
        push(t + i * DT, 0, 1.5, 0, h, 0, 0);
      }
      curHeading = to;
      t += 1;
    }
  }
  for (let i = 1; i <= 40; i += 1) {
    const yy = 1.5 * (1 - i / 40);
    push(t + i * DT, land.x, Math.max(0, yy), land.z, curHeading, 0, -0.75);
  }
  push(t + 40 * DT + DT, land.x, 0, land.z, curHeading, 0, -0.75);
  return out;
}

describe('科目B — 完美飛行應為 S', () => {
  it('起飛→四面（右/內/左/外）各懸停5s→降落於H → S', () => {
    const r = judgeSubjectB(genSubjectB(), config, field);
    expect(r.executed).toBe(true);
    expect(r.rating).toBe('S');
    expect(r.raw.plateaus.length).toBe(5);
    expect(r.raw.rotationDeltasDeg.length).toBe(4);
    r.raw.rotationDeltasDeg.forEach((d) => expect(d).toBeCloseTo(90, 1));
    expect(r.raw.landingDeviationM!).toBeLessThanOrEqual(0.5);
  });
});

describe('科目B — 失敗情形應為 U', () => {
  it('某一面懸停僅 3s → U', () => {
    const r = judgeSubjectB(genSubjectB({ hover: [3, 5, 5, 5, 5] }), config, field);
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectB.hoverFail');
  });
  it('轉向方向錯誤（逆時針 −90°）→ U', () => {
    const r = judgeSubjectB(genSubjectB({ rotDir: -1 }), config, field);
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectB.rotationFail');
  });
  it('降落超出 0.5m 容差（落於 1.2m）→ U', () => {
    const r = judgeSubjectB(genSubjectB({ land: { x: 1.2, z: 0 } }), config, field);
    expect(r.rating).toBe('U');
    expect(r.raw.landingDeviationM!).toBeCloseTo(1.2, 2);
  });
  it('少一面（僅四個平台）→ U（缺懸停）', () => {
    const r = judgeSubjectB(genSubjectB({ hover: [5, 5, 5, 5] }), config, field);
    expect(r.rating).toBe('U');
    expect(r.raw.plateaus.length).toBe(4);
  });
});

describe('科目B — 未執行為 N', () => {
  it('從未起飛 → N', () => {
    const r = judgeSubjectB([s(0, 0, 0, 0, 0, 0, 0)], config, field);
    expect(r.rating).toBe('N');
    expect(r.executed).toBe(false);
  });
});

// --- 科目 C 樣本產生器 -------------------------------------------------------
function genSubjectC(opts: { radOff?: number; alt?: number; pauseAt?: boolean; rightCCW?: boolean } = {}): FlightSample[] {
  const out: FlightSample[] = [];
  let t = 0;
  const alt = opts.alt ?? 1.5;
  const push = (tt: number, x: number, y: number, z: number, h: number, sp: number, vyy: number) => out.push(s(tt, x, y, z, h, sp, vyy));
  for (let i = 0; i <= 40; i++) {
    const tt = i * DT;
    push(tt, 0, Math.min(alt, 0.75 * tt), 0, 0, 0, tt < 2 ? 0.75 : 0);
  }
  t = 2;
  for (let i = 1; i <= 100; i += 1) push(t + i * DT, 0, alt, 0, 0, 0, 0); // 初始懸停
  t += 5;
  for (let i = 1; i <= 40; i += 1) push(t + i * DT, 0, alt, -16 * (i / 40), 0, 8, 0); // 進場到 P4
  t += 2;
  const r = 6 + (opts.radOff ?? 0);
  const lc = { x: -6, z: -16 };
  const steps = 120;
  for (let i = 1; i <= steps; i += 1) {
    const a = (i / steps) * 2 * Math.PI;
    push(t + i * DT, lc.x + r * Math.cos(a), alt, lc.z + r * Math.sin(a), 0, 6, 0);
  }
  t += steps * DT;
  if (opts.pauseAt) {
    for (let i = 1; i <= 20; i += 1) push(t + i * DT, 0, alt, -16, 0, 0, 0); // P4 停頓 1s
    t += 20 * DT; // 推進時間，避免與右圓樣本共用時間戳
  }
  const rc = { x: 6, z: -16 };
  for (let i = 1; i <= steps; i += 1) {
    const b = opts.rightCCW ? Math.PI + (i / steps) * 2 * Math.PI : Math.PI - (i / steps) * 2 * Math.PI;
    push(t + i * DT, rc.x + r * Math.cos(b), alt, rc.z + r * Math.sin(b), 0, 6, 0);
  }
  t += steps * DT;
  for (let i = 1; i <= 40; i += 1) push(t + i * DT, 0, alt, -16 * (1 - i / 40), 0, 8, 0); // 返航
  t += 2;
  for (let i = 1; i <= 20; i += 1) push(t + i * DT, 0, alt, 0, 0, 0, 0); // 終點懸停
  return out;
}

describe('科目C — 完美八字應為 S', () => {
  it('左弧逆時針 + 右弧順時針各一圈、路徑偏差小、等速 → S', () => {
    const r = judgeSubjectC(genSubjectC(), config, field);
    expect(r.executed).toBe(true);
    expect(r.rating).toBe('S');
    expect(r.raw.leftWinding).toBeGreaterThan(40); // 逆時針
    expect(r.raw.rightWinding).toBeLessThan(-40); // 順時針
    expect(r.raw.leftBeforeRight).toBe(true);
    expect(r.raw.offPathExcursionCount).toBe(0);
  });
});

describe('科目C — 失敗情形應為 U', () => {
  it('路徑半徑偏差 1.5m（超出 1.0m 容差）→ U', () => {
    const r = judgeSubjectC(genSubjectC({ radOff: 1.5 }), config, field);
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectC.pathFail');
    expect(r.raw.offPathExcursionCount).toBeGreaterThan(0);
  });
  it('高度 3m（超出 1.5±0.5）→ U', () => {
    const r = judgeSubjectC(genSubjectC({ alt: 3 }), config, field);
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectC.altitudeFail');
  });
  it('轉彎停頓 1s（超過 0.5s）→ U', () => {
    const r = judgeSubjectC(genSubjectC({ pauseAt: true }), config, field);
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectC.pauseFail');
  });
  it('右弧改為逆時針（方向錯誤）→ U', () => {
    const r = judgeSubjectC(genSubjectC({ rightCCW: true }), config, field);
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectC.rightCircleFail');
  });
});

describe('科目C — 未執行為 N', () => {
  it('從未起飛 → N', () => {
    const r = judgeSubjectC([s(0, 0, 0, 0, 0, 0, 0)], config, field);
    expect(r.rating).toBe('N');
    expect(r.executed).toBe(false);
  });
});
