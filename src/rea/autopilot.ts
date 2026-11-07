/**
 * REA 考照模擬器：示範飛行自動駕駛。
 * 讀取 CourseRunner 目前的步驟，輸出與真人相同格式的搖桿指令（定位模式語意），
 * 因此示範、回放與自動化測試都走同一套物理引擎與評等器。
 */

import { headingTo, type Vec2 } from './courses';
import { type Airframe, type Command, type DroneState, angleDiff, fieldToBody, horizontalSpeed } from './physics';
import { type CourseRunner, segmentInfo } from './runner';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface AutopilotOptions {
  /** 低空巡航速度 m/s。 */
  cruise?: number;
  /** 高空（五邊）巡航速度 m/s。 */
  cruiseHigh?: number;
}

export class Autopilot {
  private readonly cruise: number;
  private readonly cruiseHigh: number;

  constructor(private readonly af: Airframe, opts: AutopilotOptions = {}) {
    // 重機轉彎半徑大、煞車距離長：低空巡航速度依慣性下修
    this.cruise = opts.cruise ?? Math.min(1.6, af.maxSpeed * 0.4, 1.3 / af.tau);
    this.cruiseHigh = opts.cruiseHigh ?? Math.min(4, af.maxSpeed * 0.8);
  }

  command(runner: CourseRunner, s: DroneState): Command {
    const step = runner.step;
    const hold = (p: Vec2, alt: number, heading: number, vff: Vec2 = { x: 0, y: 0 }): Command =>
      this.track(s, p, alt, heading, vff);
    if (!step) return this.track(s, { x: s.x, y: s.y }, s.h, s.heading);
    const lowAlt = 1.5;
    switch (step.kind) {
      case 'takeoff':
        return hold(runner.anchor, step.alt, step.heading);
      case 'hold':
        return hold(runner.anchor, s.h < 5 ? lowAlt : s.h, step.heading);
      case 'yaw': {
        // 轉到目標角後才完成；以連續角度避免 360° 折返
        const target = s.heading + angleDiff(step.heading, s.heading);
        return hold(runner.anchor, s.h < 5 ? lowAlt : s.h, target);
      }
      case 'climb': {
        // 原地升降：記住開始升降的位置
        if (this.climbIdx !== runner.index) { this.climbIdx = runner.index; this.climbPos = { x: s.x, y: s.y }; }
        return hold(this.climbPos, step.alt, s.heading);
      }
      case 'fly': {
        const A = runner.anchor;
        const B = step.to;
        const seg = segmentInfo(A, B, s);
        const cruise = step.alt && step.alt > 5 ? this.cruiseHigh : this.cruise;
        const remain = Math.max(0, seg.len - seg.along);
        // 依機型慣性提早減速（重機 tau 大，需要更長的煞車距離）
        const v = Math.min(cruise, 0.2 + remain / (1.2 + 2 * this.af.tau));
        const ux = (B.x - A.x) / seg.len;
        const uy = (B.y - A.y) / seg.len;
        const look = Math.min(seg.len, Math.max(0, seg.along) + 1.5);
        const carrot = { x: A.x + ux * look, y: A.y + uy * look };
        const pathHd = headingTo(A, B);
        const want = step.heading === 'along' ? pathHd : step.heading === 'reverse' ? pathHd + 180 : step.heading;
        // 起步時先轉好機頭再前進，避免斜飛
        const aligned = Math.abs(angleDiff(want, s.heading)) < 15 || seg.along > 1;
        return hold(carrot, step.alt ?? lowAlt, s.heading + angleDiff(want, s.heading), aligned ? { x: ux * v, y: uy * v } : { x: 0, y: 0 });
      }
      case 'arc': {
        const rel = { x: s.x - step.center.x, y: s.y - step.center.y };
        const ang = Math.atan2(rel.y, rel.x);
        const dir = Math.sign(step.sweepDeg);
        const lead = ang + (dir * 1.2) / step.radius;
        const carrot = { x: step.center.x + step.radius * Math.cos(lead), y: step.center.y + step.radius * Math.sin(lead) };
        const tang = { x: -Math.sin(ang) * dir, y: Math.cos(ang) * dir };
        const tangentHd = (90 - ((ang * 180) / Math.PI + dir * 90) + 360) % 360;
        return hold(carrot, lowAlt, s.heading + angleDiff(tangentHd, s.heading), { x: tang.x * this.cruise, y: tang.y * this.cruise });
      }
      case 'land': {
        const target = step.target ?? runner.anchor;
        return this.descend(s, target);
      }
      case 'emergency-return': {
        const target = runner.returnTarget ?? runner.anchor;
        if (horizontalSpeed(s) > 0.4 && Math.hypot(s.x - target.x, s.y - target.y) > 4 && s.h > 5 && !this.stoppedOnce) {
          return hold({ x: s.x, y: s.y }, s.h, s.heading);
        }
        this.stoppedOnce = true;
        const d = Math.hypot(target.x - s.x, target.y - s.y);
        if (d > 0.8) {
          // 平緩下滑：距離越近高度越低
          const alt = clamp(d * 0.35, 1.5, s.h);
          const v = Math.min(this.cruiseHigh, 0.5 * d + 0.3);
          const ux = (target.x - s.x) / d;
          const uy = (target.y - s.y) / d;
          return hold(target, alt, s.heading, { x: ux * v, y: uy * v });
        }
        return this.descend(s, target);
      }
    }
  }

  private stoppedOnce = false;
  private climbIdx = -1;
  private climbPos: Vec2 = { x: 0, y: 0 };

  private descend(s: DroneState, target: Vec2): Command {
    const c = this.track(s, target, s.h, s.heading);
    const off = Math.hypot(s.x - target.x, s.y - target.y);
    const vh = off > 0.4 ? 0 : -clamp(0.25 + s.h * 0.5, 0.25, 1.2);
    c.throttle = clamp(0.5 + vh / this.af.maxClimb / 2, 0, 1);
    return c;
  }

  /** 位置＋速度前饋 → 機身搖桿（定位模式語意）；高度 P 控制；機頭 P 控制。 */
  private track(s: DroneState, p: Vec2, alt: number, heading: number, vff: Vec2 = { x: 0, y: 0 }): Command {
    // 位置增益依機型慣性調整，避免重機過衝
    const kp = Math.min(0.9, 0.6 / this.af.tau);
    const vx = clamp(vff.x + kp * (p.x - s.x), -this.af.maxSpeed, this.af.maxSpeed);
    const vy = clamp(vff.y + kp * (p.y - s.y), -this.af.maxSpeed, this.af.maxSpeed);
    const body = fieldToBody(vx, vy, s.heading);
    const climb = clamp((alt - s.h) * 1.2, -this.af.maxClimb, this.af.maxClimb);
    // 取最小角差，避免 0° 與 360° 被當成差一整圈而原地多轉
    const yawErr = angleDiff(heading, s.heading);
    return {
      pitch: clamp(body.forward / this.af.maxSpeed, -1, 1),
      roll: clamp(body.right / this.af.maxSpeed, -1, 1),
      throttle: clamp(0.5 + climb / this.af.maxClimb / 2, 0, 1),
      yaw: clamp(yawErr / 25, -1, 1) * 0.8,
    };
  }
}
