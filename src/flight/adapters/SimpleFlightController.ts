import type { FlightControllerAdapter } from '../FlightControllerAdapter';
import type {
  FlightMode,
  FlightSnapshot,
  FlightState,
  OperationResult,
  PilotCommand,
  Vector3Like,
} from '../types';

const MAX_HORIZONTAL_SPEED_MPS = 8;
const DEFAULT_HORIZONTAL_ACCELERATION_MPS2 = 7;
const MAX_VERTICAL_SPEED_MPS = 2.5;
const MAX_YAW_RATE_DEG_PER_SECOND = 90;
const MAX_ATTITUDE_DEG = 18;
const MAX_ALTITUDE_M = 50;
const POSITION_EPSILON_M = 0.04;

/**
 * 無輸入（四軸歸一化值全部落在死區內）時，殘餘速度以此時間常數指數衰減到 0。
 *
 * 為什麼需要：手動模式下速度目標由指令決定，放開搖桿後 `approach()` 仍要
 * 7 m/s² 才能把 8 m/s 停下來（滑行約 4.5 m）；若搖桿靜止值沒落在校正 center
 * 上，殘餘指令更會讓機體持續漂移。這裡只在「完全沒有輸入」時衰減，任何
 * 有效輸入（含小舵量）都照原物理前進，飛行手感不變。
 */
const NO_INPUT_VELOCITY_TAU_S = 0.3;

/** 歸一化值小於此值視為「沒有輸入」（死區已把死區內的值歸零）。 */
const NO_INPUT_EPSILON = 1e-3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function approach(current: number, target: number, maximumChange: number): number {
  if (current < target) return Math.min(current + maximumChange, target);
  if (current > target) return Math.max(current - maximumChange, target);
  return current;
}

function normalizeHeading(value: number): number {
  return ((value % 360) + 360) % 360;
}

function result(ok: boolean, message: string): OperationResult {
  return { ok, message };
}

export class SimpleFlightController implements FlightControllerAdapter {
  private state: FlightState = 'disarmed';
  private mode: FlightMode = 'hover';
  private position: Vector3Like = { x: 0, y: 0, z: 0 };
  private homePoint: Vector3Like = { x: 0, y: 0, z: 0 };
  private velocity: Vector3Like = { x: 0, y: 0, z: 0 };
  private rollDeg = 0;
  private pitchDeg = 0;
  private headingDeg = 0;
  private targetAltitudeM = 0;
  private targetPosition: Vector3Like | null = null;
  private configuredSpeedMps = 5;
  private stateBeforePause: FlightState = 'flying';

  arm(): OperationResult {
    if (this.state !== 'disarmed') return result(false, '飞行器当前无法重复解锁');
    this.homePoint = { ...this.position };
    this.state = 'armed';
    return result(true, '飞行器已解锁');
  }

  disarm(): OperationResult {
    if (this.state !== 'armed' || this.position.y > POSITION_EPSILON_M) {
      return result(false, '必须先安全降落才能上锁');
    }
    this.state = 'disarmed';
    this.velocity = { x: 0, y: 0, z: 0 };
    return result(true, '飞行器已上锁');
  }

  takeoff(altitudeM: number): OperationResult {
    if (this.state !== 'armed') return result(false, '请先解锁飞行器');
    this.targetAltitudeM = clamp(altitudeM, 1, MAX_ALTITUDE_M);
    this.state = 'taking-off';
    this.mode = 'hover';
    return result(true, `起飞至 ${this.targetAltitudeM.toFixed(1)} m`);
  }

  land(): OperationResult {
    if (!['taking-off', 'flying', 'paused'].includes(this.state)) {
      return result(false, '当前状态无法降落');
    }
    this.targetPosition = null;
    this.state = 'landing';
    this.mode = 'hover';
    return result(true, '开始降落');
  }

  goto(position: Vector3Like): OperationResult {
    if (this.state !== 'flying') return result(false, '飞行器未处于可导航状态');
    this.targetPosition = {
      x: position.x,
      y: clamp(position.y, 1, MAX_ALTITUDE_M),
      z: position.z,
    };
    this.mode = 'mission';
    return result(true, '飞往指定位置');
  }

  setSpeed(speedMps: number): OperationResult {
    this.configuredSpeedMps = clamp(speedMps, 0.5, MAX_HORIZONTAL_SPEED_MPS);
    return result(true, `速度设定为 ${this.configuredSpeedMps.toFixed(1)} m/s`);
  }

  setAltitude(altitudeM: number): OperationResult {
    if (this.state !== 'flying') return result(false, '飞行器未处于飞行状态');
    this.targetAltitudeM = clamp(altitudeM, 1, MAX_ALTITUDE_M);
    this.targetPosition = { ...this.position, y: this.targetAltitudeM };
    this.mode = 'mission';
    return result(true, `高度设定为 ${this.targetAltitudeM.toFixed(1)} m`);
  }

  setYaw(yawDeg: number): OperationResult {
    this.headingDeg = normalizeHeading(yawDeg);
    return result(true, `航向设定为 ${this.headingDeg.toFixed(0)}°`);
  }

  rtl(): OperationResult {
    if (this.state !== 'flying') return result(false, '飞行器未处于飞行状态');
    this.targetPosition = {
      x: this.homePoint.x,
      y: Math.max(this.position.y, 5),
      z: this.homePoint.z,
    };
    this.mode = 'mission';
    return result(true, '返回 Home Point');
  }

  /**
   * Teaching/test seam: jump the aircraft to an absolute position without
   * flying there. Used by the inspection browser tests to place the F450 at a
   * known pose; production flight never calls this.
   */
  teleport(position: Vector3Like): OperationResult {
    this.position = {
      x: clamp(position.x, -1000, 1000),
      y: clamp(position.y, 0, MAX_ALTITUDE_M),
      z: clamp(position.z, -1000, 1000),
    };
    this.velocity = { x: 0, y: 0, z: 0 };
    if (this.state === 'disarmed' || this.state === 'armed') {
      this.homePoint = { ...this.position };
    }
    return result(true, '飞行器已跳转至指定坐标');
  }

  pause(): OperationResult {
    if (!['flying', 'taking-off'].includes(this.state)) return result(false, '当前任务无法暂停');
    this.stateBeforePause = this.state;
    this.state = 'paused';
    this.mode = 'hover';
    this.targetPosition = null;
    this.velocity = { x: 0, y: 0, z: 0 };
    return result(true, '任务已暂停并悬停');
  }

  resume(): OperationResult {
    if (this.state !== 'paused') return result(false, '当前任务未暂停');
    this.state = this.stateBeforePause === 'taking-off' ? 'taking-off' : 'flying';
    return result(true, '任务已继续');
  }

  emergencyStop(): OperationResult {
    this.state = 'emergency';
    this.mode = 'hover';
    this.targetPosition = null;
    this.velocity = { x: 0, y: 0, z: 0 };
    return result(true, '紧急停止已触发');
  }

  update(command: PilotCommand, deltaSeconds: number): FlightSnapshot {
    const delta = clamp(deltaSeconds, 0, 0.1);
    if (delta === 0 || this.state === 'disarmed' || this.state === 'armed' || this.state === 'emergency') {
      return this.snapshot();
    }

    if (this.state === 'taking-off') {
      this.updateVerticalTarget(this.targetAltitudeM, delta);
      if (Math.abs(this.position.y - this.targetAltitudeM) <= POSITION_EPSILON_M) {
        this.position.y = this.targetAltitudeM;
        this.velocity.y = 0;
        this.state = 'flying';
      }
      return this.snapshot();
    }

    if (this.state === 'landing') {
      this.updateVerticalTarget(0, delta);
      if (this.position.y <= POSITION_EPSILON_M) {
        this.position.y = 0;
        this.velocity = { x: 0, y: 0, z: 0 };
        this.rollDeg = 0;
        this.pitchDeg = 0;
        this.state = 'armed';
      }
      return this.snapshot();
    }

    if (this.state === 'paused' || command.flightMode === 'hover') {
      this.mode = 'hover';
      this.velocity = { x: 0, y: 0, z: 0 };
      this.rollDeg = approach(this.rollDeg, 0, 60 * delta);
      this.pitchDeg = approach(this.pitchDeg, 0, 60 * delta);
      return this.snapshot();
    }

    if (this.mode === 'mission' && this.targetPosition) {
      this.updateMission(delta);
      return this.snapshot();
    }

    this.mode = 'manual';
    this.updateManual(command, delta);
    return this.snapshot();
  }

  snapshot(): FlightSnapshot {
    return {
      state: this.state,
      mode: this.mode,
      position: { ...this.position },
      homePoint: { ...this.homePoint },
      velocity: { ...this.velocity },
      rollDeg: this.rollDeg,
      pitchDeg: this.pitchDeg,
      yawDeg: this.headingDeg,
      altitudeM: this.position.y,
      horizontalSpeedMps: Math.hypot(this.velocity.x, this.velocity.z),
      verticalSpeedMps: this.velocity.y,
      headingDeg: this.headingDeg,
    };
  }

  private updateVerticalTarget(targetY: number, delta: number): void {
    const difference = targetY - this.position.y;
    const desiredVelocity = clamp(difference * 2, -MAX_VERTICAL_SPEED_MPS, MAX_VERTICAL_SPEED_MPS);
    this.velocity.y = approach(this.velocity.y, desiredVelocity, 5 * delta);
    const nextY = this.position.y + this.velocity.y * delta;
    this.position.y = difference >= 0 ? Math.min(nextY, targetY) : Math.max(nextY, targetY);
  }

  /**
   * 手動飛行：把搖桿指令旋轉到世界座標。
   *
   * 方向約定（全專案唯一一套，必須與機體模型和雲台相機一致）：
   *   機頭 = ( sin h, 0, −cos h)   ← heading 0 朝 −Z，heading 90 朝 +X
   *   右側 = ( cos h, 0,  sin h)   ← heading 0 朝 +X，heading 90 朝 +Z
   *
   * 這套約定由兩個地方釘住，改任何一處都要同步：
   *   1. 機體模型 `group.rotation.y = −heading`（create-programmatic-f450.ts），
   *      把本地 −Z（機頭）轉到世界 (sin h, −cos h)；
   *   2. 雲台相機 forward = (cos p·sin h, sin p, −cos p·cos h)（create-app.ts），
   *      heading 90 時 forward.x = +1。
   *
   * 2026-10-22 修正：原本寫成
   *   targetX = right·cos h − forward·sin h
   *   targetZ = −forward·cos h − right·sin h
   * 兩個 sin 項的符號都反了 —— 等於把機頭方向鏡射到 Z 軸另一側。heading 0
   * 時看不出來（sin 0 = 0），但 heading 45° 時前進方向偏了整整 90°（前推變
   * 橫移、右打變前後移動，即教師回報的「症狀 C」），heading 90° 時更是完全
   * 反著飛。修正後 heading 0 的行為與修正前完全相同。
   */
  private updateManual(command: PilotCommand, delta: number): void {
    this.headingDeg = normalizeHeading(this.headingDeg + clamp(command.yaw, -1, 1) * MAX_YAW_RATE_DEG_PER_SECOND * delta);

    if (this.isNeutralCommand(command)) {
      // 無輸入：不要把殘餘速度當成指令目標繼續積分，指數衰減到 0。
      this.decayVelocity(delta);
    } else {
      const headingRadians = this.headingDeg * Math.PI / 180;
      const sin = Math.sin(headingRadians);
      const cos = Math.cos(headingRadians);
      const forward = clamp(command.pitch, -1, 1) * MAX_HORIZONTAL_SPEED_MPS;
      const right = clamp(command.roll, -1, 1) * MAX_HORIZONTAL_SPEED_MPS;
      // velocity = forward · 機頭 + right · 右側
      const targetX = forward * sin + right * cos;
      const targetZ = -forward * cos + right * sin;
      const targetY = (clamp(command.throttle, 0, 1) - 0.5) * MAX_VERTICAL_SPEED_MPS * 2;

      this.velocity.x = approach(this.velocity.x, targetX, DEFAULT_HORIZONTAL_ACCELERATION_MPS2 * delta);
      this.velocity.z = approach(this.velocity.z, targetZ, DEFAULT_HORIZONTAL_ACCELERATION_MPS2 * delta);
      this.velocity.y = approach(this.velocity.y, targetY, 5 * delta);
    }

    this.position.x += this.velocity.x * delta;
    this.position.z += this.velocity.z * delta;
    this.position.y = clamp(this.position.y + this.velocity.y * delta, 0, MAX_ALTITUDE_M);
    this.rollDeg = approach(this.rollDeg, clamp(command.roll, -1, 1) * MAX_ATTITUDE_DEG, 75 * delta);
    this.pitchDeg = approach(this.pitchDeg, clamp(command.pitch, -1, 1) * MAX_ATTITUDE_DEG, 75 * delta);
  }

  /** 四軸歸一化值是否全部落在死區內（= 駕駛員沒有給任何指令）。 */
  private isNeutralCommand(command: PilotCommand): boolean {
    return (
      Math.abs(command.pitch) <= NO_INPUT_EPSILON &&
      Math.abs(command.roll) <= NO_INPUT_EPSILON &&
      Math.abs(command.yaw) <= NO_INPUT_EPSILON &&
      Math.abs(command.throttle) <= NO_INPUT_EPSILON
    );
  }

  /** v(t+dt) = v(t) · e^(-dt/τ)：只縮小不反向，衰減到接近 0 時直接歸零。 */
  private decayVelocity(delta: number): void {
    const decay = Math.exp(-delta / NO_INPUT_VELOCITY_TAU_S);
    this.velocity.x *= decay;
    this.velocity.y *= decay;
    this.velocity.z *= decay;
    if (Math.abs(this.velocity.x) < 1e-3) this.velocity.x = 0;
    if (Math.abs(this.velocity.y) < 1e-3) this.velocity.y = 0;
    if (Math.abs(this.velocity.z) < 1e-3) this.velocity.z = 0;
  }

  private updateMission(delta: number): void {
    if (!this.targetPosition) return;
    const dx = this.targetPosition.x - this.position.x;
    const dy = this.targetPosition.y - this.position.y;
    const dz = this.targetPosition.z - this.position.z;
    const distance = Math.hypot(dx, dy, dz);

    if (distance <= POSITION_EPSILON_M) {
      this.position = { ...this.targetPosition };
      this.targetPosition = null;
      this.velocity = { x: 0, y: 0, z: 0 };
      this.mode = 'hover';
      return;
    }

    const speed = Math.min(this.configuredSpeedMps, distance / Math.max(delta, 0.001));
    this.velocity = {
      x: dx / distance * speed,
      y: clamp(dy / distance * speed, -MAX_VERTICAL_SPEED_MPS, MAX_VERTICAL_SPEED_MPS),
      z: dz / distance * speed,
    };
    this.position.x += this.velocity.x * delta;
    this.position.y = clamp(this.position.y + this.velocity.y * delta, 0, MAX_ALTITUDE_M);
    this.position.z += this.velocity.z * delta;
  }
}
