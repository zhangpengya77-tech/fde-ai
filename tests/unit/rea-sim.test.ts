// REA 考照模擬器：物理、評等與示範飛行自動測試
import { describe, expect, it } from 'vitest';
import { FIELD_I, FIELD_I2, SUBJECTS, subjectById, headingTo } from '../../src/rea/courses';
import { AIRFRAMES, bodyToField, fieldToBody, initialState, step, type Command } from '../../src/rea/physics';
import { Autopilot } from '../../src/rea/autopilot';
import { FlightSession } from '../../src/rea/session';
import { CourseRunner, tierOf } from '../../src/rea/runner';
import { DEFAULT_WIND, Wind, levelToSpeed } from '../../src/rea/wind';
import type { AirframeId } from '../../src/rea/courses';

const IDLE: Command = { throttle: 0.5, pitch: 0, roll: 0, yaw: 0 };

function fly(subjectId: string, airframeId: AirframeId, level = 0, gust = 0, maxS = 900) {
  const subject = subjectById(subjectId)!;
  const session = new FlightSession({
    subject, airframeId, mode: 'position', wind: { ...DEFAULT_WIND, level, gust, from: 'left' }, returnCallDelay: 6,
  });
  const ap = new Autopilot(AIRFRAMES[airframeId]);
  while (!session.done && session.t < maxS) session.advance(0.05, (s) => ap.command(s.runner, s.state));
  return session;
}

describe('考場幾何（AC 107-005D 尺寸）', () => {
  it('I 級 8 字：P1–P7 都在半徑 6 m 的圓上，H 直徑 2 m', () => {
    const [L, R] = FIELD_I.rings;
    for (const id of ['P1', 'P2', 'P3', 'P4']) expect(Math.hypot(FIELD_I.cones[id].x - L.center.x, FIELD_I.cones[id].y - L.center.y)).toBeCloseTo(6);
    for (const id of ['P4', 'P5', 'P6', 'P7']) expect(Math.hypot(FIELD_I.cones[id].x - R.center.x, FIELD_I.cones[id].y - R.center.y)).toBeCloseTo(6);
    expect(FIELD_I.hRadius * 2).toBe(2);
    expect(FIELD_I.bounds.xMax - FIELD_I.bounds.xMin).toBe(30);
    expect(FIELD_I.bounds.yMax - FIELD_I.bounds.yMin).toBe(23);
  });
  it('I2 小場地：P1–P4 圍成 12 × 5 m、場地 15 × 15 m', () => {
    const { P1, P3 } = FIELD_I2.cones;
    expect(P3.x - P1.x).toBe(12);
    expect(P3.y - P1.y).toBe(5);
    expect(FIELD_I2.bounds.xMax - FIELD_I2.bounds.xMin).toBe(15);
  });
  it('機頭角換算：0° 朝外、90° 朝右', () => {
    expect(headingTo({ x: 0, y: 0 }, { x: 0, y: 5 })).toBeCloseTo(0);
    expect(headingTo({ x: 0, y: 0 }, { x: 5, y: 0 })).toBeCloseTo(90);
    const f = bodyToField(1, 0, 90);
    expect(f.x).toBeCloseTo(1);
    const b = fieldToBody(0, -1, 180);
    expect(b.forward).toBeCloseTo(1);
  });
});

describe('飛行物理', () => {
  const af = AIRFRAMES['quad-4kg'];
  const run = (s0: ReturnType<typeof initialState>, cmd: Command, wind: { x: number; y: number }, mode: 'position' | 'attitude', secs: number) => {
    let s = s0;
    for (let i = 0; i < secs * 120; i++) s = step(s, cmd, wind, af, mode, 1 / 120);
    return s;
  };
  const airborne = { ...initialState(), armed: true, landed: false, h: 5 };

  it('定位模式放開搖桿會停住，有風只小幅漂移', () => {
    const s = run({ ...airborne, vx: 3 }, IDLE, { x: 3, y: 0 }, 'position', 10);
    expect(Math.hypot(s.vx, s.vy)).toBeLessThan(0.4);
  });
  it('姿態模式放開搖桿會被風吹走（速度趨近風速）', () => {
    const s = run(airborne, IDLE, { x: 3, y: 0 }, 'attitude', 20);
    expect(s.vx).toBeGreaterThan(2.5);
  });
  it('推油門會爬升、中立維持高度', () => {
    const up = run(airborne, { ...IDLE, throttle: 1 }, { x: 0, y: 0 }, 'position', 2);
    expect(up.h).toBeGreaterThan(8);
    const keep = run(airborne, IDLE, { x: 0, y: 0 }, 'position', 5);
    expect(keep.h).toBeCloseTo(5, 1);
  });
  it('下降太快觸地判定墜機', () => {
    const s = run({ ...airborne, h: 3, vh: -6 }, { ...IDLE, throttle: 0 }, { x: 0, y: 0 }, 'attitude', 2);
    expect(s.crashed).toBe(true);
  });
  it('重的機型慣性較大（同樣時間內速度較慢達到）', () => {
    const light = (() => { let s = airborne; for (let i = 0; i < 60; i++) s = step(s, { ...IDLE, pitch: 1 }, { x: 0, y: 0 }, AIRFRAMES['quad-800g'], 'position', 1 / 120); return s; })();
    const heavy = (() => { let s = airborne; for (let i = 0; i < 60; i++) s = step(s, { ...IDLE, pitch: 1 }, { x: 0, y: 0 }, AIRFRAMES['hexa-18kg'], 'position', 1 / 120); return s; })();
    expect(light.vy / AIRFRAMES['quad-800g'].maxSpeed).toBeGreaterThan(heavy.vy / AIRFRAMES['hexa-18kg'].maxSpeed);
  });
  it('機頭朝內時往左打桿，無人機往考生右邊（+x）飛', () => {
    const s = run({ ...airborne, heading: 180 }, { ...IDLE, roll: -1 }, { x: 0, y: 0 }, 'position', 2);
    expect(s.x).toBeGreaterThan(1);
  });
});

describe('風況', () => {
  it('5 級 = 7.5 m/s，達安全宣告門檻', () => {
    expect(levelToSpeed(5)).toBe(7.5);
    expect(new Wind({ ...DEFAULT_WIND, level: 5 }).safetyDeclaration()).toBe(true);
    expect(new Wind({ ...DEFAULT_WIND, level: 2 }).safetyDeclaration()).toBe(false);
  });
  it('風從左邊吹來 → 空氣往 +x 流動', () => {
    expect(new Wind({ ...DEFAULT_WIND, level: 2, from: 'left', sway: 'small' }).at(0).x).toBeGreaterThan(2.5);
  });
});

describe('評等門檻', () => {
  it('tierOf 四級', () => {
    expect(tierOf(0.5, [0.7, 1.2, 2])).toBe(0);
    expect(tierOf(1, [0.7, 1.2, 2])).toBe(1);
    expect(tierOf(1.9, [0.7, 1.2, 2])).toBe(2);
    expect(tierOf(2.5, [0.7, 1.2, 2])).toBe(3);
  });
  it('飛到考生身後直接失敗', () => {
    const r = new CourseRunner(subjectById('hover')!, FIELD_I);
    r.update(1, { ...initialState({ x: 0, y: -8 }), armed: true, landed: false, h: 1.5 }, 1 / 120);
    expect(r.result().grade).toBe(3);
    expect(r.result().failure).toContain('身後');
  });
});

const implemented = SUBJECTS.filter((s) => s.implemented);
const airframes: AirframeId[] = ['quad-800g', 'quad-4kg', 'hexa-18kg'];

describe('示範飛行：每個已實作科目 × 每種機型（無風）都能飛完且達「標準」以上', () => {
  for (const sub of implemented) {
    for (const af of airframes) {
      it(`${sub.name}／${AIRFRAMES[af].name}`, () => {
        const s = fly(sub.id, af);
        const r = s.result();
        expect(r.failure, JSON.stringify(r.steps.filter((x) => x.tier > 1))).toBeNull();
        expect(r.finished).toBe(true);
        expect(r.grade, JSON.stringify(r.steps.filter((x) => x.tier > 1).map((x) => [x.label, x.metrics]))).toBeLessThanOrEqual(1);
      });
    }
  }
});

describe('示範飛行：2 級風＋陣風 2 仍能飛完、不失敗', () => {
  for (const sub of implemented) {
    it(sub.name, () => {
      const r = fly(sub.id, sub.defaultAirframe, 2, 2).result();
      expect(r.failure).toBeNull();
      expect(r.grade, JSON.stringify(r.steps.filter((x) => x.tier > 2).map((x) => [x.label, x.metrics]))).toBeLessThanOrEqual(2);
    });
  }
});

describe('緊急返航', () => {
  it('喊返航後停住並降在較近的八字內圈', () => {
    const s = fly('return', 'quad-4kg');
    const r = s.result();
    expect(s.runner.returnCalled).toBe(true);
    const last = r.steps[r.steps.length - 1];
    expect(last.kind).toBe('emergency-return');
    expect(last.metrics.find((m) => m.key === 'land')!.value).toBeLessThan(4);
  });
});

describe('未實作科目如實標示', () => {
  it('看畫面飛、看畫面繞著目標飛標為未實作', () => {
    expect(subjectById('fpv-points')!.implemented).toBe(false);
    expect(subjectById('poi')!.implemented).toBe(false);
  });
});
