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

  private updateManual(command: PilotCommand, delta: number): void {
    this.headingDeg = normalizeHeading(this.headingDeg + clamp(command.yaw, -1, 1) * MAX_YAW_RATE_DEG_PER_SECOND * delta);

    const headingRadians = this.headingDeg * Math.PI / 180;
    const forward = clamp(command.pitch, -1, 1) * MAX_HORIZONTAL_SPEED_MPS;
    const right = clamp(command.roll, -1, 1) * MAX_HORIZONTAL_SPEED_MPS;
    const targetX = right * Math.cos(headingRadians) - forward * Math.sin(headingRadians);
    const targetZ = -forward * Math.cos(headingRadians) - right * Math.sin(headingRadians);
    const targetY = (clamp(command.throttle, 0, 1) - 0.5) * MAX_VERTICAL_SPEED_MPS * 2;

    this.velocity.x = approach(this.velocity.x, targetX, DEFAULT_HORIZONTAL_ACCELERATION_MPS2 * delta);
    this.velocity.z = approach(this.velocity.z, targetZ, DEFAULT_HORIZONTAL_ACCELERATION_MPS2 * delta);
    this.velocity.y = approach(this.velocity.y, targetY, 5 * delta);

    this.position.x += this.velocity.x * delta;
    this.position.z += this.velocity.z * delta;
    this.position.y = clamp(this.position.y + this.velocity.y * delta, 0, MAX_ALTITUDE_M);
    this.rollDeg = approach(this.rollDeg, clamp(command.roll, -1, 1) * MAX_ATTITUDE_DEG, 75 * delta);
    this.pitchDeg = approach(this.pitchDeg, clamp(command.pitch, -1, 1) * MAX_ATTITUDE_DEG, 75 * delta);
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
