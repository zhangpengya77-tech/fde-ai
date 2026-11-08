/**
 * REA 考照模擬器：趣味挑戰（2026-11-08）。
 *
 * 四個挑戰（玩法與場景為本專案自行設計）：
 *  1. 刺氣球：考場上五顆不同高度的氣球，全部碰破就完成（不限順序）
 *  2. 繞角錐：依序穿過繞 P1（逆時針）與 P5（順時針）的空中圈門
 *  3. 8 字闖關：沿 8 字航線依序穿過 8 個空中圈門
 *  4. 無人機足球：在室內網籠裡依序穿過三個圈門，最後射門（穿過球門圈）
 * 共同規則：計時；撞網（足球場）會被網子擋住並記一次碰撞；墜機或飛出考場就結束。
 * 成績：完成時間換算星等（★★★／★★／★），碰撞每次加罰 2 秒。
 * 物理與考照科目共用同一套（physics.ts），所以手感一致。
 */

import { FIELD_I, type Field, type Subject, type Vec2 } from './courses';
import { type Airframe, type Command, type DroneState, type FlightMode, initialState, step } from './physics';
import { PHYSICS_DT } from './session';
import { Wind, type WindSettings } from './wind';

export type TargetKind = 'balloon' | 'gate';

export interface Target {
  kind: TargetKind;
  x: number;
  y: number;
  /** 中心離地高度（公尺） */
  h: number;
  /** 氣球半徑／圈門內半徑（公尺） */
  r: number;
  /** 圈門朝向（機頭角，0＝朝外）；穿越方向不限 */
  facing?: number;
  /** 球門（足球）用不同顏色、較大 */
  goal?: boolean;
}

export interface Challenge {
  id: string;
  name: string;
  brief: string;
  arena: 'I' | 'cage';
  ordered: boolean;
  targets: Target[];
  /** 三星、二星、一星的完成時間上限（秒） */
  stars: [number, number, number];
}

/** 無人機足球網籠：16 × 9 m、高 5 m（場地與網子為自行設計的尺寸）。 */
export const CAGE = { xMin: -4.5, xMax: 4.5, yMin: -1.5, yMax: 14.5, height: 5 };

/** 足球網籠用的「場地」（給相機與外框用）：沒有 8 字環帶與角錐。 */
export const FIELD_CAGE: Field = {
  kind: 'I',
  bounds: { xMin: CAGE.xMin, xMax: CAGE.xMax, yMin: CAGE.yMin, yMax: CAGE.yMax },
  hRadius: 1,
  cones: {},
  rings: [],
  poi: {},
  examinee: { x: 0, y: -4 },
};

/** 繞著某點的圈門（ccw = 逆時針）。 */
function around(c: Vec2, radius: number, ccw: boolean, startDeg: number, n: number, h: number): Target[] {
  const out: Target[] = [];
  for (let i = 0; i < n; i++) {
    const deg = startDeg + (ccw ? 1 : -1) * (360 / n) * i;
    const a = (deg * Math.PI) / 180;
    // 圈門面向前進方向（切線）
    const tangent = deg + (ccw ? 90 : -90);
    out.push({ kind: 'gate', x: c.x + radius * Math.cos(a), y: c.y + radius * Math.sin(a), h, r: 1.1, facing: 90 - tangent });
  }
  return out;
}

const P = FIELD_I.cones;

export const CHALLENGES: Challenge[] = [
  {
    id: 'balloons',
    name: '刺氣球',
    brief: '考場上有 5 顆不同高度的氣球，飛過去碰破它們，順序不限，全部碰破就完成。',
    arena: 'I',
    ordered: false,
    targets: [
      { kind: 'balloon', x: P.P1.x, y: P.P1.y, h: 2.5, r: 0.45 },
      { kind: 'balloon', x: P.P5.x, y: P.P5.y, h: 3, r: 0.45 },
      { kind: 'balloon', x: P.P2.x, y: P.P2.y, h: 1.6, r: 0.45 },
      { kind: 'balloon', x: P.P6.x, y: P.P6.y, h: 1.6, r: 0.45 },
      { kind: 'balloon', x: P.P4.x, y: P.P4.y, h: 4, r: 0.45 },
    ],
    stars: [45, 70, 110],
  },
  {
    id: 'cone-circle',
    name: '繞角錐',
    brief: '依序穿過黃色圈門：先繞左邊 P1 逆時針一圈，再繞右邊 P5 順時針一圈。',
    arena: 'I',
    ordered: true,
    targets: [...around(P.P1, 3, true, -90, 4, 1.6), ...around(P.P5, 3, false, -90, 4, 1.6)],
    stars: [50, 80, 120],
  },
  {
    id: 'eight-gates',
    name: '8 字闖關',
    brief: '沿著 8 字航線依序穿過 8 個圈門：左圈逆時針、右圈順時針，最後回到 P4。',
    arena: 'I',
    ordered: true,
    targets: [
      ...around(FIELD_I.rings[0].center, 6, true, 0, 4, 1.6).slice(1),
      { kind: 'gate', x: P.P4.x, y: P.P4.y, h: 1.6, r: 1.1, facing: 0 },
      ...around(FIELD_I.rings[1].center, 6, false, 180, 4, 1.6).slice(1),
      { kind: 'gate', x: P.P4.x, y: P.P4.y, h: 1.6, r: 1.1, facing: 0 },
    ],
    stars: [55, 85, 130],
  },
  {
    id: 'drone-soccer',
    name: '無人機足球',
    brief: '在室內網籠裡依序穿過三個圈門，最後穿過最遠的大球門「射門」！撞到網子會被擋住並加罰 2 秒。',
    arena: 'cage',
    ordered: true,
    targets: [
      { kind: 'gate', x: 0, y: 4, h: 1.5, r: 0.9, facing: 0 },
      { kind: 'gate', x: -2.2, y: 7.5, h: 2.6, r: 0.9, facing: 0 },
      { kind: 'gate', x: 2.2, y: 10.5, h: 1.8, r: 0.9, facing: 0 },
      { kind: 'gate', x: 0, y: 13.4, h: 2.4, r: 1.3, facing: 0, goal: true },
    ],
    stars: [25, 40, 65],
  },
];

export function challengeById(id: string): Challenge | undefined {
  return CHALLENGES.find((c) => c.id === id);
}

/** 給 scene.buildField 用的空科目（挑戰沒有考照步驟）。 */
export function challengeSubject(ch: Challenge): Subject {
  return {
    id: `challenge-${ch.id}`, name: ch.name, licenses: [], field: 'I', defaultAirframe: 'quad-800g',
    altBand: [0, 10], steps: [], brief: ch.brief, track: [1, 2, 3], implemented: true,
  };
}

export interface ChallengeResult {
  finished: boolean;
  failure: string | null;
  timeS: number;
  bumps: number;
  /** 0–3 顆星（含碰撞罰秒） */
  stars: number;
  hits: number;
  total: number;
}

/** 穿越圈門判定：上一點與這一點跨過圈門平面，且交點在圈內。 */
export function crossesGate(g: Target, a: { x: number; y: number; h: number }, b: { x: number; y: number; h: number }): boolean {
  const f = ((g.facing ?? 0) * Math.PI) / 180;
  const n = { x: Math.sin(f), y: Math.cos(f) }; // 機頭角 0＝+y
  const da = (a.x - g.x) * n.x + (a.y - g.y) * n.y;
  const db = (b.x - g.x) * n.x + (b.y - g.y) * n.y;
  // 沒有跨過平面（或幾乎平行於圈面移動）都不算
  if (Math.abs(da - db) < 1e-6 || Math.sign(da) === Math.sign(db)) return false;
  const k = da / (da - db);
  const px = a.x + (b.x - a.x) * k, py = a.y + (b.y - a.y) * k, ph = a.h + (b.h - a.h) * k;
  return Math.hypot(px - g.x, py - g.y, ph - g.h) <= g.r;
}

export function starsFor(ch: Challenge, timeS: number): number {
  return timeS <= ch.stars[0] ? 3 : timeS <= ch.stars[1] ? 2 : timeS <= ch.stars[2] ? 1 : 0;
}

export class ChallengeRun {
  state: DroneState;
  t = 0;
  readonly hit: boolean[];
  bumps = 0;
  finished = false;
  failure: string | null = null;
  lastCmd: Command = { throttle: 0.5, pitch: 0, roll: 0, yaw: 0 };
  readonly samples: { x: number; y: number; h: number }[] = [];
  private readonly wind: Wind;
  private accum = 0;
  private bumpCool = 0;

  constructor(readonly ch: Challenge, readonly af: Airframe, readonly mode: FlightMode, wind: WindSettings) {
    // 足球場在室內：沒有風
    this.wind = new Wind(ch.arena === 'cage' ? { ...wind, level: 0, gust: 0 } : wind);
    // 與考照科目相同：一開始就解鎖，油門推高即起飛
    this.state = { ...initialState({ x: 0, y: 0 }, 0), armed: true };
    this.hit = ch.targets.map(() => false);
  }

  /** 下一個要穿的目標（不限順序時回傳 -1）。 */
  get next(): number {
    return this.ch.ordered ? this.hit.findIndex((h) => !h) : -1;
  }

  get hits(): number {
    return this.hit.filter(Boolean).length;
  }

  advance(dt: number, cmd: Command): void {
    if (this.finished) return;
    this.accum += Math.min(dt, 0.1);
    while (this.accum >= PHYSICS_DT && !this.finished) {
      this.accum -= PHYSICS_DT;
      this.stepOnce(cmd);
    }
  }

  stepOnce(cmd: Command): void {
    const a = this.state;
    this.lastCmd = cmd;
    let s = step(a, cmd, this.wind.at(this.t), this.af, this.mode, PHYSICS_DT);
    this.t += PHYSICS_DT;
    this.bumpCool = Math.max(0, this.bumpCool - PHYSICS_DT);
    if (s.crashed) { this.end(`墜機：${s.crashReason}`); this.state = s; return; }
    if (this.ch.arena === 'cage') {
      // 網子擋住：位置夾回籠內、速度歸零，記一次碰撞（同一次撞擊 0.6 秒內只算一次）
      const m = 0.35;
      const cx = Math.min(CAGE.xMax - m, Math.max(CAGE.xMin + m, s.x));
      const cy = Math.min(CAGE.yMax - m, Math.max(CAGE.yMin + m, s.y));
      const ch = Math.min(CAGE.height - m, s.h);
      if (cx !== s.x || cy !== s.y || ch !== s.h) {
        s = { ...s, x: cx, y: cy, h: ch, vx: cx !== s.x ? 0 : s.vx, vy: cy !== s.y ? 0 : s.vy, vh: ch !== s.h ? Math.min(0, s.vh) : s.vh };
        if (this.bumpCool === 0) { this.bumps += 1; this.bumpCool = 0.6; }
      }
    } else {
      const b = FIELD_I.bounds;
      if (s.x < b.xMin - 3 || s.x > b.xMax + 3 || s.y > b.yMax + 3 || s.y < FIELD_I.examinee.y) { this.state = s; this.end('飛出考試場地'); return; }
    }
    // 目標判定
    const tg = this.ch.targets;
    for (let i = 0; i < tg.length; i++) {
      if (this.hit[i]) continue;
      if (this.ch.ordered && i !== this.next) continue;
      const g = tg[i];
      const ok = g.kind === 'balloon'
        ? Math.hypot(s.x - g.x, s.y - g.y, s.h + 0.1 - g.h) <= g.r + 0.35
        : crossesGate(g, a, s);
      if (ok) this.hit[i] = true;
    }
    this.state = s;
    if (this.tick++ % 4 === 0) this.samples.push({ x: s.x, y: s.y, h: s.h });
    if (this.hit.every(Boolean)) { this.finished = true; }
  }

  private tick = 0;

  private end(reason: string): void {
    this.failure = reason;
    this.finished = true;
  }

  result(): ChallengeResult {
    const score = this.t + this.bumps * 2;
    return {
      finished: this.finished && !this.failure,
      failure: this.failure,
      timeS: this.t,
      bumps: this.bumps,
      stars: this.failure ? 0 : starsFor(this.ch, score),
      hits: this.hits,
      total: this.ch.targets.length,
    };
  }
}
