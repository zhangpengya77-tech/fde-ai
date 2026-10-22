/**
 * 腳本化「理想操作」的路徑建構（CAA 專業基本級術科模擬，端到端驗證用）。
 *
 * 由考場幾何（ExamField）推出参考路径，交給 ScriptedPilot 沿著飛。
 * 幾何來自官方圖11（附錄6 p233）：八字雙圓 Ø12/R6、交點 P4、角錐 P1–P7。
 *
 * 為何這樣進場（重要）：
 *  判定只把「首次貼近路徑」到「最後貼近路徑」之間的樣本視為機動窗口，盒內
 *  偏離 >1m 即計為偏出路徑。因此進場必須在離開窗口後才轉彎，並以切線方向
 *  併入圓周：
 *   - 左圓官方順序 P4→P1→P2→P3→P4（shoelace 面積 >0），在 P1 的切線為 −X；
 *   - 故由 H 前飛到 (0,−10) 後左轉，沿 z=−10 以 −X 方向併入 P1，再逆時針
 *     走 P1→P2→P3→P4；
 *   - P4 處左圓切線為 +Z，右圓（順時針）在 P4 亦為 +Z，兩弧相切連續，
 *     不需停頓即可由左圈切入右圈；
 *   - 右圈走完回到 P4 時仍朝 +Z，直接沿原路返航 H（離開窗口後不再檢驗）。
 */

import type { ExamField } from './field';
import type { PilotPoint } from './scripted-pilot';

/** 圓弧取樣（角度制，deg）。 */
export function arcPoints(
  center: PilotPoint,
  radius: number,
  fromDeg: number,
  toDeg: number,
  stepM: number,
): PilotPoint[] {
  const pts: PilotPoint[] = [];
  const dDeg = (stepM / Math.max(radius, EPS_R)) * (180 / Math.PI);
  const n = Math.max(1, Math.ceil(Math.abs(toDeg - fromDeg) / dDeg));
  for (let i = 0; i <= n; i += 1) {
    const a = fromDeg + (toDeg - fromDeg) * (i / n);
    const rad = (a * Math.PI) / 180;
    pts.push({ x: center.x + radius * Math.cos(rad), z: center.z + radius * Math.sin(rad) });
  }
  return pts;
}

const EPS_R = 1e-6;

/** 直線取樣。 */
export function linePoints(from: PilotPoint, to: PilotPoint, stepM: number): PilotPoint[] {
  const len = Math.hypot(to.x - from.x, to.z - from.z);
  if (len < EPS_R) return [{ ...to }];
  const n = Math.max(1, Math.ceil(len / stepM));
  const pts: PilotPoint[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    pts.push({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t });
  }
  return pts;
}

/** 去掉連續重複點。 */
function dedupe(points: PilotPoint[]): PilotPoint[] {
  const out: PilotPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 1e-6) out.push(p);
  }
  return out;
}

export interface Figure8Options {
  /** 半徑縮放（1 = 官方半徑）。用於「軌跡超出標示範圍」的不良操作。 */
  radiusScale?: number;
  /** 只縮放左弧（右弧與進出場維持正確）。用於「單側偏出路徑」的不良操作。 */
  leftRadiusScale?: number;
  /** 只縮放右弧。 */
  rightRadiusScale?: number;
  /** 取樣步長（m）。 */
  stepM?: number;
}

/** 進場段：H → (0,−10) → 圓角轉彎 → 沿 z=−10 併入 P1。 */
export function approachToP1(field: ExamField, stepM = 0.25): PilotPoint[] {
  const p1 = field.figure8.cones.P1;
  const cornerR = 2;
  // 圓角轉彎：由 −Z 方向轉到 −X 方向，圓心在 (p1.x + cornerR, −10 + cornerR)。
  const center: PilotPoint = { x: p1.x + cornerR, z: -10 + cornerR };
  return dedupe([
    ...linePoints({ x: 0, z: 0 }, { x: 0, z: -10 + cornerR }, stepM),
    ...arcPoints(center, cornerR, 0, -90, 0.15),
    ...linePoints({ x: p1.x + cornerR, z: -10 }, { x: p1.x, z: p1.z }, stepM),
  ]);
}

/** 左弧：P1 → P2 → P3 → P4（逆時針，官方順序）。 */
export function leftArc(field: ExamField, opts: Figure8Options = {}): PilotPoint[] {
  const c = field.figure8.leftCircle;
  const r = c.radiusM * (opts.leftRadiusScale ?? opts.radiusScale ?? 1);
  return arcPoints(c.center, r, 90, 360, opts.stepM ?? 0.2);
}

/** 右弧：P4 → P5 → P6 → P7 → P4（順時針）。 */
export function rightArc(field: ExamField, opts: Figure8Options = {}): PilotPoint[] {
  const c = field.figure8.rightCircle;
  const r = c.radiusM * (opts.rightRadiusScale ?? opts.radiusScale ?? 1);
  return arcPoints(c.center, r, 180, -180, opts.stepM ?? 0.2);
}

/** 返航段：P4 → H。 */
export function returnToHome(field: ExamField, stepM = 0.25): PilotPoint[] {
  const p4 = field.figure8.crossing;
  return linePoints(p4, { x: 0, z: 0 }, stepM);
}

/** 科目C 機動段（進場 + 左弧 + 右弧），不含返航。 */
export function figure8Maneuver(field: ExamField, opts: Figure8Options = {}): PilotPoint[] {
  return dedupe([...approachToP1(field), ...leftArc(field, opts), ...rightArc(field, opts)]);
}

/** 科目C 完整八字路徑（進場 + 左弧 + 右弧 + 返航）。 */
export function figure8Path(field: ExamField, opts: Figure8Options = {}): PilotPoint[] {
  return dedupe([...figure8Maneuver(field, opts), ...returnToHome(field)]);
}

/** 路徑總長（m）。 */
export function pathLength(points: PilotPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return total;
}
