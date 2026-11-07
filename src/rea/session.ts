/**
 * REA 考照模擬器：一次飛行（session）= 固定步長物理 + 科目追蹤 + 錄製。
 * 畫面迴圈、示範與自動化測試共用，確保三者行為一致。
 */

import { fieldOf, type Subject } from './courses';
import { AIRFRAMES, type Airframe, type Command, type DroneState, type FlightMode, initialState, step } from './physics';
import { CourseRunner, type CourseResult, type RunnerOptions } from './runner';
import { Wind, type WindSettings } from './wind';
import type { AirframeId } from './courses';

export const PHYSICS_DT = 1 / 120;
const RECORD_EVERY = 6; // 20 Hz

export interface Sample {
  t: number; x: number; y: number; h: number; heading: number; pitchDeg: number; rollDeg: number;
  cmd: Command; stepIndex: number; cross: number; headErr: number;
}

export interface SessionOptions extends RunnerOptions {
  subject: Subject;
  airframeId: AirframeId;
  mode: FlightMode;
  wind: WindSettings;
}

export class FlightSession {
  readonly airframe: Airframe;
  readonly runner: CourseRunner;
  readonly wind: Wind;
  state: DroneState;
  t = 0;
  readonly samples: Sample[] = [];
  private accum = 0;
  private tick = 0;
  /** 最近一次指令（給 HUD 顯示打桿位置）。 */
  lastCmd: Command = { throttle: 0.5, pitch: 0, roll: 0, yaw: 0 };

  constructor(readonly opts: SessionOptions) {
    this.airframe = AIRFRAMES[opts.airframeId];
    this.runner = new CourseRunner(opts.subject, fieldOf(opts.subject.field), opts);
    this.wind = new Wind(opts.wind);
    this.state = { ...initialState({ x: 0, y: 0 }, 0), armed: true };
  }

  /** 推進真實時間 dt（秒）；pilot 每個物理步提供一次指令。 */
  advance(dt: number, pilot: (s: FlightSession) => Command): void {
    this.accum += Math.min(dt, 0.1);
    while (this.accum >= PHYSICS_DT) {
      this.accum -= PHYSICS_DT;
      this.stepOnce(pilot(this));
    }
  }

  stepOnce(cmd: Command): void {
    this.lastCmd = cmd;
    this.state = step(this.state, cmd, this.wind.at(this.t), this.airframe, this.opts.mode, PHYSICS_DT);
    this.t += PHYSICS_DT;
    const info = this.runner.update(this.t, this.state, PHYSICS_DT);
    if (this.tick++ % RECORD_EVERY === 0) {
      const s = this.state;
      this.samples.push({
        t: this.t, x: s.x, y: s.y, h: s.h, heading: s.heading, pitchDeg: s.pitchDeg, rollDeg: s.rollDeg,
        cmd: { ...cmd }, stepIndex: info.stepIndex, cross: info.cross, headErr: info.headErr,
      });
    }
  }

  get done(): boolean {
    return this.runner.finished;
  }

  result(): CourseResult {
    return this.runner.result();
  }
}

/** 回放：依時間內插取樣。 */
export function sampleAt(samples: Sample[], t: number): Sample | null {
  if (!samples.length) return null;
  if (t <= samples[0].t) return samples[0];
  if (t >= samples[samples.length - 1].t) return samples[samples.length - 1];
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const k = (t - a.t) / (b.t - a.t || 1);
  const lerp = (p: number, q: number) => p + (q - p) * k;
  return {
    ...a, t, x: lerp(a.x, b.x), y: lerp(a.y, b.y), h: lerp(a.h, b.h), heading: lerp(a.heading, b.heading),
    pitchDeg: lerp(a.pitchDeg, b.pitchDeg), rollDeg: lerp(a.rollDeg, b.rollDeg),
  };
}
