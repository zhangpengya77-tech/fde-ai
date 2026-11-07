/**
 * REA 考照模擬器：飛行物理引擎（獨立實作）。
 *
 * 參考網站的內部飛行演算法無法從公開資訊確認，這裡是可測試的自行實作，
 * 不宣稱還原原站算法。機型參數為依軸距、重量量級合理估計的「訓練用數值」，
 * 不是原站或原廠數值。
 *
 * 輸入：標準化指令 throttle∈[0,1]（0.5 = 維持高度）、pitch/roll/yaw∈[-1,1]（+pitch = 往前）。
 * 模式：
 *  - position（定位模式）：搖桿 = 目標速度，放開就減速停住，風只造成小幅殘差漂移。
 *  - attitude（姿態模式）：搖桿 = 傾角，放開機身擺平但不會停，慢慢被風帶走。
 */

import type { AirframeId, Vec2 } from './courses';

export interface Airframe {
  id: AirframeId;
  name: string;
  detail: string;
  /** 軸距（m），也用於 3D 模型尺寸。 */
  wheelbase: number;
  rotors: 4 | 6;
  massKg: number;
  /** 定位模式最大水平速度 m/s。 */
  maxSpeed: number;
  /** 姿態模式最大傾角（度）。 */
  maxTiltDeg: number;
  /** 速度追隨時間常數（s）：越大越「重」、慣性越大。 */
  tau: number;
  /** 空氣阻力係數（1/s）：姿態模式下相對空氣的速度衰減。 */
  drag: number;
  /** 最大爬升／下降速率 m/s。 */
  maxClimb: number;
  /** 最大偏航角速度 °/s。 */
  maxYawRate: number;
  /** 姿態反應時間常數（s）。 */
  tiltTau: number;
}

export const AIRFRAMES: Record<AirframeId, Airframe> = {
  'quad-800g': {
    id: 'quad-800g', name: '800 g 四軸小飛機', detail: '軸距 35 cm', wheelbase: 0.35, rotors: 4, massKg: 0.8,
    maxSpeed: 6, maxTiltDeg: 30, tau: 0.45, drag: 0.55, maxClimb: 3, maxYawRate: 110, tiltTau: 0.12,
  },
  'quad-4kg': {
    id: 'quad-4kg', name: '4 kg 四軸自組機', detail: '軸距 90 cm', wheelbase: 0.9, rotors: 4, massKg: 4,
    maxSpeed: 5, maxTiltDeg: 25, tau: 0.75, drag: 0.35, maxClimb: 2.5, maxYawRate: 80, tiltTau: 0.2,
  },
  'hexa-18kg': {
    id: 'hexa-18kg', name: '18 kg 六軸自組機', detail: '軸距 130 cm', wheelbase: 1.3, rotors: 6, massKg: 18,
    maxSpeed: 4, maxTiltDeg: 20, tau: 1.1, drag: 0.25, maxClimb: 2, maxYawRate: 55, tiltTau: 0.3,
  },
};

export interface Command { throttle: number; pitch: number; roll: number; yaw: number }
export type FlightMode = 'position' | 'attitude';

export interface DroneState {
  x: number; y: number; h: number;
  vx: number; vy: number; vh: number;
  /** 機頭角（度，0 = 朝外，順時針為正）。連續值，不折返。 */
  heading: number;
  /** 實際傾角（度）：+pitch = 機頭下壓往前，+roll = 往右。 */
  pitchDeg: number; rollDeg: number;
  armed: boolean;
  landed: boolean;
  crashed: boolean;
  crashReason: string;
}

export const DEADBAND = 0.04;
const G = 9.81;

export function initialState(at: Vec2 = { x: 0, y: 0 }, heading = 0): DroneState {
  return {
    x: at.x, y: at.y, h: 0, vx: 0, vy: 0, vh: 0, heading,
    pitchDeg: 0, rollDeg: 0, armed: false, landed: true, crashed: false, crashReason: '',
  };
}

export function deadband(v: number, d = DEADBAND): number {
  if (Math.abs(v) <= d) return 0;
  return (Math.sign(v) * (Math.abs(v) - d)) / (1 - d);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const toRad = (d: number) => (d * Math.PI) / 180;

/** 機身座標（前、右）轉場地座標（x、y）。 */
export function bodyToField(forward: number, right: number, headingDeg: number): Vec2 {
  const t = toRad(headingDeg);
  return { x: forward * Math.sin(t) + right * Math.cos(t), y: forward * Math.cos(t) - right * Math.sin(t) };
}

/** 場地座標轉機身座標（前、右）。 */
export function fieldToBody(x: number, y: number, headingDeg: number): { forward: number; right: number } {
  const t = toRad(headingDeg);
  return { forward: x * Math.sin(t) + y * Math.cos(t), right: x * Math.cos(t) - y * Math.sin(t) };
}

/**
 * 推進一步（固定步長建議 1/120 s）。純函式風格：回傳新狀態，不改輸入。
 * wind：場地座標風速（m/s，空氣往哪個方向流動）。
 */
export function step(s0: DroneState, cmd: Command, wind: Vec2, af: Airframe, mode: FlightMode, dt: number): DroneState {
  const s = { ...s0 };
  if (s.crashed) return s;
  const thr = clamp(cmd.throttle, 0, 1);
  const pitch = deadband(clamp(cmd.pitch, -1, 1));
  const roll = deadband(clamp(cmd.roll, -1, 1));
  const yaw = deadband(clamp(cmd.yaw, -1, 1));
  const climbCmd = deadband((thr - 0.5) * 2, DEADBAND * 2);

  // 地面：未解鎖或停在地面且油門未推高時不動
  if (s.landed) {
    if (!s.armed || climbCmd <= 0.05) {
      s.vx = s.vy = s.vh = 0; s.pitchDeg = s.rollDeg = 0;
      return s;
    }
    s.landed = false;
  }

  // 偏航
  s.heading += yaw * af.maxYawRate * dt;

  // 垂直：一階追隨目標升降率
  const targetVh = climbCmd * af.maxClimb;
  s.vh += (targetVh - s.vh) * Math.min(1, dt / 0.35);

  // 水平
  if (mode === 'position') {
    const tv = bodyToField(pitch * af.maxSpeed, roll * af.maxSpeed, s.heading);
    // 定位模式：飛控補償風，只留 8% 殘差漂移
    const residual = { x: wind.x * 0.08, y: wind.y * 0.08 };
    const k = Math.min(1, dt / af.tau);
    s.vx += (tv.x + residual.x - s.vx) * k;
    s.vy += (tv.y + residual.y - s.vy) * k;
    // 顯示用傾角：由加速度反推
    const acc = fieldToBody((tv.x - s0.vx) / af.tau, (tv.y - s0.vy) / af.tau, s.heading);
    const tp = clamp((Math.atan2(acc.forward, G) * 180) / Math.PI, -af.maxTiltDeg, af.maxTiltDeg);
    const tr = clamp((Math.atan2(acc.right, G) * 180) / Math.PI, -af.maxTiltDeg, af.maxTiltDeg);
    s.pitchDeg += (tp - s.pitchDeg) * Math.min(1, dt / af.tiltTau);
    s.rollDeg += (tr - s.rollDeg) * Math.min(1, dt / af.tiltTau);
  } else {
    // 姿態模式：搖桿 → 傾角 → 推力水平分量；阻力作用在「相對空氣」速度
    const tp = pitch * af.maxTiltDeg;
    const tr = roll * af.maxTiltDeg;
    s.pitchDeg += (tp - s.pitchDeg) * Math.min(1, dt / af.tiltTau);
    s.rollDeg += (tr - s.rollDeg) * Math.min(1, dt / af.tiltTau);
    const a = bodyToField(G * Math.tan(toRad(s.pitchDeg)), G * Math.tan(toRad(s.rollDeg)), s.heading);
    s.vx += (a.x - af.drag * (s.vx - wind.x)) * dt;
    s.vy += (a.y - af.drag * (s.vy - wind.y)) * dt;
  }

  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.h += s.vh * dt;

  // 觸地判定
  if (s.h <= 0) {
    const horiz = Math.hypot(s.vx, s.vy);
    const impact = -s.vh;
    s.h = 0;
    if (impact > 2.5 || horiz > 2.5) {
      s.crashed = true;
      s.crashReason = impact > 2.5 ? `下降太快觸地（${impact.toFixed(1)} m/s）` : `水平速度太快觸地（${horiz.toFixed(1)} m/s）`;
    } else {
      s.landed = true;
    }
    s.vx = s.vy = s.vh = 0;
    s.pitchDeg = s.rollDeg = 0;
  }
  return s;
}

export function horizontalSpeed(s: DroneState): number {
  return Math.hypot(s.vx, s.vy);
}

/** 機頭角正規化到 [0, 360)。 */
export function norm360(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** 兩個角度的最小差（-180, 180]。 */
export function angleDiff(a: number, b: number): number {
  let d = norm360(a - b);
  if (d > 180) d -= 360;
  return d;
}
