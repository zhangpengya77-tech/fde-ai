// REA 趣味挑戰（2026-11-08）：圈門穿越判定、計時星等，以及「用簡單自動駕駛真的能完成每個挑戰」
import { describe, expect, it } from 'vitest';
import { CHALLENGES, CAGE, ChallengeRun, crossesGate, starsFor, type Target } from '../../src/rea/challenges';
import { AIRFRAMES, type Command } from '../../src/rea/physics';
import { DEFAULT_WIND } from '../../src/rea/wind';

const gate: Target = { kind: 'gate', x: 0, y: 5, h: 1.5, r: 1, facing: 0 };

describe('圈門穿越判定', () => {
  it('從圈中間穿過算過；從圈外穿過不算', () => {
    expect(crossesGate(gate, { x: 0, y: 4.9, h: 1.5 }, { x: 0.2, y: 5.1, h: 1.6 })).toBe(true);
    expect(crossesGate(gate, { x: 1.6, y: 4.9, h: 1.5 }, { x: 1.6, y: 5.1, h: 1.5 })).toBe(false);
    expect(crossesGate(gate, { x: 0, y: 4.9, h: 3 }, { x: 0, y: 5.1, h: 3 })).toBe(false);
  });
  it('反方向穿過也算；沒跨過平面不算', () => {
    expect(crossesGate(gate, { x: 0, y: 5.1, h: 1.5 }, { x: 0, y: 4.9, h: 1.5 })).toBe(true);
    expect(crossesGate(gate, { x: 0, y: 4.5, h: 1.5 }, { x: 0, y: 4.9, h: 1.5 })).toBe(false);
  });
  it('朝右的圈門（機頭角 90）要沿 x 方向穿', () => {
    const g90: Target = { ...gate, facing: 90 };
    expect(crossesGate(g90, { x: -0.1, y: 5, h: 1.5 }, { x: 0.1, y: 5, h: 1.5 })).toBe(true);
    expect(crossesGate(g90, { x: 0, y: 4.9, h: 1.5 }, { x: 0, y: 5.1, h: 1.5 })).toBe(false);
  });
});

/** 測試用的簡單自動駕駛（定位模式、機頭朝外）：飛向下一個目標，圈門要穿過去再往後 1.5 m。 */
function pilot(run: ChallengeRun): Command {
  const s = run.state;
  const idx = run.ch.ordered ? run.next : run.hit.findIndex((h) => !h);
  const t = run.ch.targets[Math.max(0, idx)];
  let ax = t.x, ay = t.y;
  if (t.kind === 'gate') {
    const f = ((t.facing ?? 0) * Math.PI) / 180;
    const n = { x: Math.sin(f), y: Math.cos(f) };
    const side = Math.sign((s.x - t.x) * n.x + (s.y - t.y) * n.y) || -1;
    ax = t.x - n.x * side * 1.5;
    ay = t.y - n.y * side * 1.5;
  }
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const dx = ax - s.x, dy = ay - s.y;
  // 先爬到目標高度附近再前進，避免低空撞到角錐／氣球繩
  const dh = t.h - s.h;
  const go = s.h > 0.8 ? 1 : 0;
  return { throttle: Math.max(0, Math.min(1, 0.5 + dh * 0.6)), pitch: clamp(dy * 0.35) * go, roll: clamp(dx * 0.35) * go, yaw: 0 };
}

describe('每個挑戰都能完成', () => {
  for (const ch of CHALLENGES) {
    it(`${ch.name}：自動駕駛 4 分鐘內完成、拿到星等`, () => {
      const run = new ChallengeRun(ch, AIRFRAMES['quad-800g'], 'position', { ...DEFAULT_WIND });
      for (let i = 0; i < 240 * 120 && !run.finished; i++) run.stepOnce(pilot(run));
      const r = run.result();
      expect(r.failure).toBeNull();
      expect(r.finished).toBe(true);
      expect(r.hits).toBe(ch.targets.length);
      expect(r.timeS).toBeGreaterThan(5);
    });
  }
});

describe('足球網籠與星等', () => {
  it('撞網會被擋在籠內並記碰撞', () => {
    const soccer = CHALLENGES.find((c) => c.id === 'drone-soccer')!;
    const run = new ChallengeRun(soccer, AIRFRAMES['quad-800g'], 'position', { ...DEFAULT_WIND });
    // 起飛後一直往右飛，撞右邊網子
    for (let i = 0; i < 12 * 120; i++) run.stepOnce({ throttle: run.state.h < 1.5 ? 0.9 : 0.5, pitch: 0, roll: run.state.h > 1 ? 1 : 0, yaw: 0 });
    expect(run.state.x).toBeLessThanOrEqual(CAGE.xMax);
    expect(run.bumps).toBeGreaterThan(0);
    expect(run.failure).toBeNull();
  });
  it('時間越短星星越多', () => {
    const ch = CHALLENGES[0];
    expect(starsFor(ch, ch.stars[0] - 1)).toBe(3);
    expect(starsFor(ch, ch.stars[1] - 1)).toBe(2);
    expect(starsFor(ch, ch.stars[2] + 1)).toBe(0);
  });
});
