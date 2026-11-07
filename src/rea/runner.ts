/**
 * REA 考照模擬器：科目進度追蹤與逐段練習評等。
 *
 * 評等分四級，名稱比照參考網站可見的介面（頂尖／標準／擦邊／失敗）；
 * 判定門檻為本專案自訂的「練習評等」，不是民航局官方評分，也不宣稱等同原站算法。
 * 官方術科只分「過／不過」，且由監評現場判定。
 */

import { type Field, type Step, type Subject, type Vec2, headingTo } from './courses';
import { type DroneState, angleDiff, horizontalSpeed } from './physics';

export type Tier = 0 | 1 | 2 | 3;
export const TIER_LABELS = ['頂尖', '標準', '擦邊', '失敗'] as const;

export function tierOf(value: number, limits: readonly [number, number, number]): Tier {
  if (value <= limits[0]) return 0;
  if (value <= limits[1]) return 1;
  if (value <= limits[2]) return 2;
  return 3;
}

export interface Metric { key: string; label: string; value: number; unit: string; tier: Tier }

export interface StepResult {
  index: number;
  label: string;
  kind: Step['kind'];
  startT: number;
  endT: number;
  completed: boolean;
  metrics: Metric[];
  tier: Tier;
}

export interface CourseResult {
  subjectId: string;
  grade: Tier;
  finished: boolean;
  failure: string | null;
  steps: StepResult[];
  durationS: number;
  disclaimer: string;
}

export const DISCLAIMER = '此為 FDE-AI 自訂的練習評等，用來找出可以改進的地方；不是民航局官方評分，官方術科只分「過／不過」並由監評現場判定。';

const HEADING_LIMITS = [10, 20, 45] as const;
const HOLD_HEADING_LIMITS = [5, 15, 30] as const;
const ALT_OUT_LIMITS = [0, 0.5, 1] as const;
const LAND_LIMITS = [0.3, 0.6, 1.0] as const;
const REACT_LIMITS = [3, 5, 8] as const;
const STOP_LIMITS = [0, 1, 2] as const;

interface Acc {
  maxCross: number;
  maxHeadErr: number;
  maxAltOut: number;
  maxDrift: number;
  stops: number;
  stopTimer: number;
  holdTimer: number;
  sweep: number;
  lastAngle: number | null;
  react: number | null;
  stopped: boolean;
  landDist: number;
  startPos: Vec2 | null;
}

const freshAcc = (): Acc => ({
  maxCross: 0, maxHeadErr: 0, maxAltOut: 0, maxDrift: 0, stops: 0, stopTimer: 0, holdTimer: 0,
  sweep: 0, lastAngle: null, react: null, stopped: false, landDist: 0, startPos: null,
});

export interface RunnerOptions {
  /** 緊急返航：在第 2 邊開始後幾秒喊「緊急返航」（測試用；預設隨機 4–20 s）。 */
  returnCallDelay?: number;
}

export interface SampleInfo { stepIndex: number; cross: number; headErr: number }

export class CourseRunner {
  index = 0;
  finished = false;
  failure: string | null = null;
  readonly results: StepResult[] = [];
  /** 目前步驟的錨點（上一步結束的目標位置）。 */
  anchor: Vec2 = { x: 0, y: 0 };
  /** 緊急返航目標（較近的八字內圈圓心）。 */
  returnTarget: Vec2 | null = null;
  returnCalled = false;
  private acc: Acc = freshAcc();
  private stepStart = 0;
  private t = 0;
  private legTwoStart: number | null = null;
  private readonly callDelay: number;
  private lastInfo: SampleInfo = { stepIndex: 0, cross: 0, headErr: 0 };

  constructor(readonly subject: Subject, readonly field: Field, opts: RunnerOptions = {}) {
    this.callDelay = opts.returnCallDelay ?? 4 + Math.random() * 16;
  }

  get step(): Step | null {
    return this.finished ? null : this.subject.steps[this.index] ?? null;
  }

  /** 目前步驟的終點目標（fly/land 用）。 */
  targetOf(step: Step | null = this.step): Vec2 {
    if (!step) return this.anchor;
    if (step.kind === 'fly') return step.to;
    if (step.kind === 'land') return step.target ?? this.anchor;
    if (step.kind === 'emergency-return') return this.returnTarget ?? this.anchor;
    return this.anchor;
  }

  /** 每個模擬步呼叫一次。 */
  update(t: number, s: DroneState, dt: number): SampleInfo {
    this.t = t;
    if (this.finished) return this.lastInfo;

    // 全域重大違失
    if (s.crashed) return this.fail(`墜機：${s.crashReason}`);
    if (s.y < this.field.examinee.y) return this.fail('飛到考生身後');
    const big = this.subject.altBand[1] > 5;
    const b = this.field.bounds;
    if (!big && !s.landed && (s.x < b.xMin || s.x > b.xMax || s.y < b.yMin || s.y > b.yMax)) return this.fail('飛出考試場地');

    // 緊急返航觸發
    if (this.subject.id === 'return' && !this.returnCalled) {
      const st = this.step;
      if (st && st.kind === 'fly' && st.label === '第 2 邊' && this.legTwoStart === null) this.legTwoStart = t;
      const due = this.legTwoStart !== null && t - this.legTwoStart >= this.callDelay;
      const lastLegDone = st?.kind === 'emergency-return';
      if (due || lastLegDone) this.callReturn(s);
    }

    const step = this.step;
    if (!step) return this.lastInfo;
    const a = this.acc;
    const speed = horizontalSpeed(s);
    // 起飛、停懸、轉頭與低空航線一律以規範的 1–2 m 為準；高空航段（五邊）由 step.alt 另外判定
    const [lo, hi] = [1, 2];
    let cross = 0;
    let headErr = 0;

    const altOut = (h: number) => (h < lo ? lo - h : h > hi ? h - hi : 0);

    switch (step.kind) {
      case 'takeoff': {
        a.maxDrift = Math.max(a.maxDrift, dist(s, this.anchor));
        headErr = Math.abs(angleDiff(s.heading, step.heading));
        if (s.h >= lo && Math.abs(s.vh) < 0.4) this.complete([
          m('drift', '起飛時偏離 H', a.maxDrift, 'm', tierOf(a.maxDrift, [0.5, 1, 1.5])),
        ]);
        break;
      }
      case 'hold': {
        const drift = dist(s, this.anchor);
        headErr = Math.abs(angleDiff(s.heading, step.heading));
        cross = drift;
        const steady = speed < 0.5 && Math.abs(s.vh) < 0.4 && headErr < 20 && !s.landed;
        // 「停 5 秒」是先停穩才開始數
        a.holdTimer = steady ? a.holdTimer + dt : 0;
        if (a.holdTimer > 0) {
          a.maxDrift = Math.max(a.maxDrift, drift);
          a.maxHeadErr = Math.max(a.maxHeadErr, headErr);
          a.maxAltOut = Math.max(a.maxAltOut, altOut(s.h));
        }
        if (a.holdTimer >= step.seconds) this.complete([
          m('drift', '停住時偏離定點', a.maxDrift, 'm', tierOf(a.maxDrift, [0.5, 1, 1.5])),
          m('heading', '機頭偏差', a.maxHeadErr, '°', tierOf(a.maxHeadErr, HOLD_HEADING_LIMITS)),
          m('alt', '高度超出 1–2 m', a.maxAltOut, 'm', tierOf(a.maxAltOut, ALT_OUT_LIMITS)),
        ]);
        break;
      }
      case 'yaw': {
        // 原地轉頭：飄移以開始轉頭的位置為準
        a.startPos ??= { x: s.x, y: s.y };
        // 往定點修正不扣分：取「離開始位置」與「離定點」較小者
        const drift = Math.min(dist(s, a.startPos), dist(s, this.anchor));
        a.maxDrift = Math.max(a.maxDrift, drift);
        headErr = Math.abs(angleDiff(s.heading, step.heading));
        cross = drift;
        if (headErr < 8) this.complete([
          m('drift', '轉頭時整台飄移', a.maxDrift, 'm', tierOf(a.maxDrift, [0.5, 1, 1.5])),
        ]);
        break;
      }
      case 'climb': {
        // 飄移以「開始升降時的位置」為準（高空航段到點容許 3 m，不能把那段誤差算進來）
        a.startPos ??= { x: s.x, y: s.y };
        cross = dist(s, a.startPos);
        a.maxDrift = Math.max(a.maxDrift, cross);
        if (Math.abs(s.h - step.alt) < (step.alt > 5 ? 1 : 0.4)) this.complete([
          m('drift', '升降時水平飄移', a.maxDrift, 'm', tierOf(a.maxDrift, [1, 2, 4])),
        ]);
        break;
      }
      case 'fly': {
        const A = this.anchor;
        const B = step.to;
        const seg = segmentInfo(A, B, s);
        cross = Math.abs(seg.cross);
        const pathHd = headingTo(A, B);
        const want = step.heading === 'along' ? pathHd : step.heading === 'reverse' ? pathHd + 180 : step.heading;
        headErr = Math.abs(angleDiff(s.heading, want));
        // 起步與到點前一小段（低空 1 m、高空 6 m）不計機頭與停頓（轉頭、減速屬正常）
        const margin = step.alt && step.alt > 5 ? 6 : 1;
        const inMiddle = seg.along > margin && seg.along < seg.len - margin;
        a.maxCross = Math.max(a.maxCross, cross);
        if (inMiddle) {
          a.maxHeadErr = Math.max(a.maxHeadErr, headErr);
          if (speed < 0.15) {
            a.stopTimer += dt;
            if (a.stopTimer > 1 && a.stopTimer - dt <= 1) a.stops++;
          } else a.stopTimer = 0;
        }
        a.maxAltOut = Math.max(a.maxAltOut, step.alt ? Math.max(0, Math.abs(s.h - step.alt) - 2) : altOut(s.h));
        if (dist(s, B) < (step.alt && step.alt > 5 ? 1.5 : 0.7)) this.complete([
          m('cross', '偏離航線', a.maxCross, 'm', tierOf(a.maxCross, this.subject.track)),
          m('heading', '機頭偏差', a.maxHeadErr, '°', tierOf(a.maxHeadErr, HEADING_LIMITS)),
          m('alt', step.alt ? '高度變化' : '高度超出 1–2 m', a.maxAltOut, 'm', tierOf(a.maxAltOut, ALT_OUT_LIMITS)),
          m('stops', '途中停頓', a.stops, '次', tierOf(a.stops, STOP_LIMITS)),
        ], B);
        break;
      }
      case 'arc': {
        const rel = { x: s.x - step.center.x, y: s.y - step.center.y };
        const r = Math.hypot(rel.x, rel.y);
        const ang = (Math.atan2(rel.y, rel.x) * 180) / Math.PI;
        if (a.lastAngle !== null) a.sweep += angleDiff(ang, a.lastAngle);
        a.lastAngle = ang;
        cross = Math.abs(r - step.radius);
        const dir = Math.sign(step.sweepDeg);
        // 逆時針（dir>0）切線方向 heading = 角度 → 場地角換算；順時針相反
        const tangentHd = (90 - (ang + dir * 90) + 360) % 360;
        headErr = Math.abs(angleDiff(s.heading, tangentHd));
        a.maxCross = Math.max(a.maxCross, cross);
        // 進出圓圈的頭尾 15° 屬於轉換段，不計機頭偏差
        const prog = dir * a.sweep;
        if (prog > 15 && prog < Math.abs(step.sweepDeg) - 15) a.maxHeadErr = Math.max(a.maxHeadErr, headErr);
        a.maxAltOut = Math.max(a.maxAltOut, altOut(s.h));
        const end = { x: step.center.x + step.radius * Math.cos(rad(step.startDeg)), y: step.center.y + step.radius * Math.sin(rad(step.startDeg)) };
        // 要繞滿一圈「並且」回到起點（P4）附近才算完成
        if (prog >= Math.abs(step.sweepDeg) - 20 && dist(s, end) < 1.2) {
          this.complete([
            m('cross', '離中心線（環帶內外）', a.maxCross, 'm', tierOf(a.maxCross, this.subject.track)),
            m('heading', '機頭偏差', a.maxHeadErr, '°', tierOf(a.maxHeadErr, HEADING_LIMITS)),
            m('alt', '高度超出 1–2 m', a.maxAltOut, 'm', tierOf(a.maxAltOut, ALT_OUT_LIMITS)),
          ], end);
        }
        break;
      }
      case 'land': {
        const target = step.target ?? this.anchor;
        cross = dist(s, target);
        if (s.landed && !s.crashed) {
          const d = dist(s, target);
          this.complete([m('land', '落點離 H 中心', d, 'm', tierOf(d, LAND_LIMITS))], target);
        }
        break;
      }
      case 'emergency-return': {
        if (!a.stopped) {
          if (speed < 0.5) { a.stopped = true; a.react = t - this.stepStart; }
        }
        const target = this.returnTarget ?? this.anchor;
        cross = dist(s, target);
        if (s.landed && !s.crashed) {
          const d = dist(s, target);
          const inner = this.field.rings[0]?.inner ?? 4;
          this.complete([
            m('react', '喊了之後停住', a.react ?? 99, '秒', tierOf(a.react ?? 99, REACT_LIMITS)),
            m('land', '落點離八字內圈中心', d, 'm', tierOf(d, [inner * 0.4, inner * 0.7, inner])),
          ], target);
        }
        break;
      }
    }
    this.lastInfo = { stepIndex: this.index, cross, headErr };
    return this.lastInfo;
  }

  /** 由外部（或自動）喊「緊急返航」。 */
  callReturn(s: DroneState): void {
    if (this.returnCalled) return;
    this.returnCalled = true;
    const rings = this.field.rings;
    this.returnTarget = rings.length
      ? rings.reduce((best, r) => (dist(s, r.center) < dist(s, best.center) ? r : best)).center
      : { x: 0, y: 0 };
    const idx = this.subject.steps.findIndex((st) => st.kind === 'emergency-return');
    if (idx >= 0 && idx !== this.index) {
      this.results.push(this.partial('被喊返航時中斷'));
      this.index = idx;
      this.anchor = { x: s.x, y: s.y };
      this.acc = freshAcc();
      this.stepStart = this.t;
    }
  }

  result(): CourseResult {
    const steps = [...this.results];
    const grade = (this.failure ? 3 : steps.reduce<number>((g, r) => Math.max(g, r.tier), 0)) as Tier;
    return {
      subjectId: this.subject.id, grade, finished: this.finished && !this.failure, failure: this.failure,
      steps, durationS: this.t, disclaimer: DISCLAIMER,
    };
  }

  private complete(metrics: Metric[], newAnchor?: Vec2): void {
    const step = this.subject.steps[this.index];
    const tier = metrics.reduce<number>((g, x) => Math.max(g, x.tier), 0) as Tier;
    this.results.push({ index: this.index, label: step.label, kind: step.kind, startT: this.stepStart, endT: this.t, completed: true, metrics, tier });
    if (newAnchor) this.anchor = { ...newAnchor };
    this.index++;
    this.acc = freshAcc();
    this.stepStart = this.t;
    if (this.index >= this.subject.steps.length) this.finished = true;
  }

  private partial(note: string): StepResult {
    const step = this.subject.steps[this.index];
    return { index: this.index, label: `${step.label}（${note}）`, kind: step.kind, startT: this.stepStart, endT: this.t, completed: false, metrics: [], tier: 0 };
  }

  private fail(reason: string): SampleInfo {
    if (!this.failure) {
      this.failure = reason;
      const step = this.subject.steps[this.index];
      if (step) this.results.push({ index: this.index, label: step.label, kind: step.kind, startT: this.stepStart, endT: this.t, completed: false, metrics: [], tier: 3 });
      this.finished = true;
    }
    return this.lastInfo;
  }
}

function m(key: string, label: string, value: number, unit: string, tier: Tier): Metric {
  return { key, label, value: Math.round(value * 100) / 100, unit, tier };
}

function dist(p: { x: number; y: number }, q: Vec2): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

const rad = (d: number) => (d * Math.PI) / 180;

/** 點到線段的投影：along（沿線距離）、cross（帶號橫向偏差）、len。 */
export function segmentInfo(A: Vec2, B: Vec2, p: { x: number; y: number }): { along: number; cross: number; len: number } {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.hypot(dx, dy) || 1e-9;
  const ux = dx / len;
  const uy = dy / len;
  const px = p.x - A.x;
  const py = p.y - A.y;
  return { along: px * ux + py * uy, cross: px * uy - py * ux, len };
}
