/**
 * 考試機飛行控制器（獨立疊加，不動既有 SimpleFlightController）。
 *
 * 模式定義依 AC 107-005D p3（config general.modes）：
 *  - 手動 manual    ：無輔助。搖桿直接控制姿態（速率限制模擬伺服），不會自動
 *                     回正；油門直接控制垂直速度；風完整飄移。
 *  - 姿態 attitude ：自動定高 + 限制姿態角 + 姿態水平（放桿自動回正），但不
 *                     維持水平位置——風會把機體吹走。
 *  - 定位 position ：在姿態模式基礎上以 GNSS/RTK/光流維持水平位置；放桿後
 *                     減速並鎖定位置，風在可補償上限內被抵銷。
 *
 * 重型機慣性（config/exam-aircraft.json inertia，模擬假設，非官方）：
 *  - 水平速度一階滯後 τ=horizontalVelocityTimeConstantS，加速度上限
 *    accelerationMps2；
 *  - 姿態一階滯後 τ=attitudeTimeConstantS + 速率上限
 *    attitudeRateLimitDegPerS；
 *  - 無推進時速度以 dragCoefficient 衰減（越大停得越快）。
 *
 * 方向約定與全專案一致（機頭 = (sin h, 0, −cos h)，heading 0 朝 −Z，
 * heading 90 朝 +X）；此為既有飛控航向旋轉修正的同一套約定，本檔案只是
 * 復用，不對原作任何改動。
 */

import type { Vector3Like } from '../flight/types';
import type {
  ExamAircraftParams,
  ExamFlightMode,
  ExamFlightSnapshot,
  ExamStickCommand,
  ExamState,
} from './types';

/** 垂直速度上限（m/s）。模擬假設，非官方（沿用既有輕型機數值量級）。 */
const MAX_VERTICAL_SPEED_MPS = 2.5;

/** 偏航速率上限（度/秒）。模擬假設，非官方：考試機較重，轉向比輕型機慢。 */
const DEFAULT_YAW_RATE_DEG_PER_S = 60;

/** 定位模式可補償的風速上限（m/s）。模擬假設，非官方：超出後開始飄移。 */
const DEFAULT_POSITION_HOLD_MAX_WIND_MPS = 10;

/** 油門中位死區（|throttle−0.5| 小於此值視為回中）。 */
const THROTTLE_CENTER_EPSILON = 0.02;

/**
 * 自動起飛完成後解除油門鎖定的門檻（|throttle − 起飛完成值| 超過此值視為
 * 駕駛員刻意改變油門）。模擬假設，非官方：實體搖桿雜訊遠小於此值。
 */
const TAKEOFF_THROTTLE_RELEASE_EPSILON = 0.12;

const EPS = 1e-6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 一階滯後：current 以時間常數 tau 趨向 target（指數，穩定且與幀率無關）。 */
function lag(current: number, target: number, tau: number, delta: number): number {
  if (tau <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-delta / tau));
}

function normalizeHeading(value: number): number {
  return ((value % 360) + 360) % 360;
}

function speedOf(v: Vector3Like): number {
  return Math.hypot(v.x, v.z);
}

export interface ExamFlightControllerOptions {
  yawRateLimitDegPerS?: number;
  positionHoldMaxWindMps?: number;
}

export class ExamFlightController {
  private state: ExamState = 'idle';
  private mode: ExamFlightMode;
  private position: Vector3Like = { x: 0, y: 0, z: 0 };
  private velocity: Vector3Like = { x: 0, y: 0, z: 0 };
  private rollDeg = 0;
  private pitchDeg = 0;
  private headingDeg = 0;
  /** 顯式起飛／降落目標高度。僅在 takeoff()/land() 期間非 null，
   * 到達後歸 null，進入自由飛——絕不與自動定高共用此欄位。 */
  private targetAltitudeM: number | null = null;
  /** 自動定高鎖定高度（姿態／定位模式回中油門時維持）。與 targetAltitudeM
   * 嚴格分離，避免自動定高把 targetAltitudeM 寫成非 null 而重新觸發起飛分支。 */
  private holdAltitudeM: number | null = null;
  private wind: Vector3Like = { x: 0, y: 0, z: 0 };
  private positionHoldActive = false;
  /** 定位模式鎖定的水平位置（放桿瞬間記住，鬆桿後回到此點）。 */
  private positionHoldTarget: Vector3Like | null = null;
  /** 回拉增益（m/s 每 m）：超出 maxSpeed 部分被夾斷。模擬假設，非官方。 */
  private static readonly RETURN_GAIN = 2.0;
  /**
   * 自動起飛完成當下的油門值（油門鎖定）。
   *
   * 實體遙控器油門搖桿靜止在底部（正規化 0），若起飛完成後直接套用「油門
   * −0.5 → 垂直速度」，機體會在到達 1.5m 後立刻被當成全速下降而落地——教師
   * 實測「按了起飛卻沒進入飛行狀態」即此原因。起飛完成後先以完成當下油門為
   * 基準鎖定定高；駕駛員刻意改變油門（> 12%）才交還手動垂直控制。
   */
  private takeoffThrottleLatch: number | null = null;
  private readonly yawRateLimitDegPerS: number;
  private readonly positionHoldMaxWindMps: number;

  constructor(
    private readonly params: ExamAircraftParams,
    options: ExamFlightControllerOptions = {},
  ) {
    this.mode = 'position';
    this.yawRateLimitDegPerS = options.yawRateLimitDegPerS ?? DEFAULT_YAW_RATE_DEG_PER_S;
    this.positionHoldMaxWindMps = options.positionHoldMaxWindMps ?? DEFAULT_POSITION_HOLD_MAX_WIND_MPS;
  }

  arm(): void {
    // 落地後可再次解鎖起飛（否則每次起飛前都要 Esc 重置，流程卡死）。
    if (this.state !== 'idle' && this.state !== 'landed') return;
    this.state = 'armed';
  }

  takeoff(targetAltitudeM: number): void {
    if (this.state !== 'armed') return;
    this.targetAltitudeM = Math.max(0.5, targetAltitudeM);
    this.holdAltitudeM = null;
    this.takeoffThrottleLatch = null;
    this.state = 'flying';
  }

  /**
   * 懸停：煞停水平速度並鎖定當前高度與位置（定位模式下由位置保持接手）。
   * 只在自由飛行（非起飛／降落程序）時有效；搖桿再給桿即交還控制。
   */
  hover(): boolean {
    if (this.state !== 'flying' || this.targetAltitudeM !== null) return false;
    this.takeoffThrottleLatch = null;
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.holdAltitudeM = this.position.y;
    this.positionHoldTarget = { ...this.position };
    this.positionHoldActive = this.mode === 'position';
    return true;
  }

  land(): void {
    if (this.state !== 'flying') return;
    this.targetAltitudeM = 0;
    this.takeoffThrottleLatch = null;
  }

  /** 起飛程序中（已離地、尚未到達目標高度）。 */
  isTakingOff(): boolean {
    return this.state === 'flying' && this.targetAltitudeM !== null && this.targetAltitudeM > 0;
  }

  /** 降落程序中（垂直趨近地面）。 */
  isLanding(): boolean {
    return this.state === 'flying' && this.targetAltitudeM === 0;
  }

  setMode(mode: ExamFlightMode): void {
    this.mode = mode;
    // 離開定位模式時清除鎖定；進入定位模式時以當前位置為鎖定點。
    if (mode !== 'position') this.positionHoldActive = false;
  }

  getMode(): ExamFlightMode {
    return this.mode;
  }

  /** 重設到起降點（新一次測驗／科目開始）。 */
  reset(): void {
    this.state = 'idle';
    this.position = { x: 0, y: 0, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.rollDeg = 0;
    this.pitchDeg = 0;
    this.headingDeg = 0;
    this.targetAltitudeM = null;
    this.holdAltitudeM = null;
    this.positionHoldActive = false;
    this.positionHoldTarget = null;
  }

  /** 由風場模組每幀注入（m/s，世界座標）。 */
  applyWind(wind: Vector3Like): void {
    this.wind = { ...wind };
  }

  update(command: ExamStickCommand, deltaSeconds: number): ExamFlightSnapshot {
    const delta = clamp(deltaSeconds, 0, 0.1);
    if (delta > 0 && this.state === 'flying') {
      this.stepFlight(command, delta);
    }
    return this.snapshot();
  }

  snapshot(): ExamFlightSnapshot {
    return {
      state: this.state,
      mode: this.mode,
      position: { ...this.position },
      velocity: { ...this.velocity },
      rollDeg: this.rollDeg,
      pitchDeg: this.pitchDeg,
      headingDeg: this.headingDeg,
      altitudeM: this.position.y,
      horizontalSpeedMps: speedOf(this.velocity),
      verticalSpeedMps: this.velocity.y,
      windVector: { ...this.wind },
      positionHoldCompensating: this.positionHoldActive,
    };
  }

  // ---------------------------------------------------------------- private

  private stepFlight(command: ExamStickCommand, delta: number): void {
    // 降落流程：垂直趨近地面，著地後回到 armed。
    if (this.targetAltitudeM === 0) {
      this.updateVerticalTarget(0, delta);
      if (this.position.y <= EPS) {
        this.position = { x: this.position.x, y: 0, z: this.position.z };
        this.velocity = { x: 0, y: 0, z: 0 };
        this.rollDeg = 0;
        this.pitchDeg = 0;
        this.targetAltitudeM = null;
        this.holdAltitudeM = null;
        this.state = 'landed';
      }
      return;
    }

    // 起飛流程：垂直趨近目標高度，到達後轉入自由飛，並以該高度作為自動定高鎖定值。
    if (this.targetAltitudeM !== null && this.targetAltitudeM > 0) {
      this.updateVerticalTarget(this.targetAltitudeM, delta);
      if (Math.abs(this.position.y - this.targetAltitudeM) <= 0.02) {
        this.position.y = this.targetAltitudeM;
        this.velocity.y = 0;
        this.holdAltitudeM = this.targetAltitudeM;
        this.targetAltitudeM = null;
        // 以起飛完成當下油門為鎖定基準：實體搖桿底部休止（0）不應被解讀為
        // 「全速下降」，否則自動起飛會立刻落回地面。
        this.takeoffThrottleLatch = command.throttle;
      }
      return;
    }

    this.updateHeading(command, delta);
    this.updateAttitude(command, delta);
    this.updateHorizontal(command, delta);
    this.updateVertical(command, delta);
  }

  private updateHeading(command: ExamStickCommand, delta: number): void {
    const rate = clamp(command.yaw, -1, 1) * this.yawRateLimitDegPerS;
    this.headingDeg = normalizeHeading(this.headingDeg + rate * delta);
  }

  /**
   * 姿態：手動模式搖桿直接控制（放桿保持，不會自動回正——這就是「無輔助」）；
   * 姿態／定位模式放桿自動回正（維持姿態水平），並受傾角上限限制。
   */
  private updateAttitude(command: ExamStickCommand, delta: number): void {
    const maxTilt = this.params.maxTiltDeg;
    const rateLimit = this.params.attitudeRateLimitDegPerS;
    const centered = Math.abs(command.roll) < EPS && Math.abs(command.pitch) < EPS;
    let rollTarget = clamp(command.roll, -1, 1) * maxTilt;
    let pitchTarget = clamp(command.pitch, -1, 1) * maxTilt;

    if (this.mode === 'manual') {
      // 手動（無輔助）：非中立時搖桿直接控制傾角；中立時「保持」當前傾角
      // （不會自動回正——這正是相對於姿態／定位模式的差異）。
      if (centered) {
        rollTarget = this.rollDeg;
        pitchTarget = this.pitchDeg;
      }
      this.rollDeg = this.rateLimited(this.rollDeg, rollTarget, rateLimit, delta);
      this.pitchDeg = this.rateLimited(this.pitchDeg, pitchTarget, rateLimit, delta);
      return;
    }

    // 姿態／定位：一階滯後 + 速率上限；放桿時目標為 0（自動回正）。
    this.rollDeg = clamp(
      this.rateLimited(this.rollDeg, lag(this.rollDeg, rollTarget, this.params.attitudeTimeConstantS, delta), rateLimit, delta),
      -maxTilt,
      maxTilt,
    );
    this.pitchDeg = clamp(
      this.rateLimited(this.pitchDeg, lag(this.pitchDeg, pitchTarget, this.params.attitudeTimeConstantS, delta), rateLimit, delta),
      -maxTilt,
      maxTilt,
    );
  }

  private rateLimited(current: number, target: number, rateLimitDegPerS: number, delta: number): number {
    const maxChange = rateLimitDegPerS * delta;
    if (current < target) return Math.min(current + maxChange, target);
    if (current > target) return Math.max(current - maxChange, target);
    return current;
  }

  /**
   * 水平運動。三模式差異：
   *  - manual   ：傾角產生加速度（a = tilt/maxTilt · acceleration），無自動
   *               回正所以會持續加速／慣性滑行，僅風與阻力使其減速。
   *  - attitude ：搖桿給速度目標（一階滯後），放桿減速到 0；不鎖位置，
   *               風完整飄移。
   *  - position ：同 attitude 的速度控制，放桿鎖定水平位置；風在可補償
   *               上限內被抵銷，超出部分才飄移。
   */
  private updateHorizontal(command: ExamStickCommand, delta: number): void {
    const maxSpeed = this.params.maxHorizontalSpeedMps;

    if (this.mode === 'manual') {
      const accel = this.params.accelerationMps2;
      const forwardAccel = (this.pitchDeg / this.params.maxTiltDeg) * accel;
      const rightAccel = (this.rollDeg / this.params.maxTiltDeg) * accel;
      const headingRadians = (this.headingDeg * Math.PI) / 180;
      const sin = Math.sin(headingRadians);
      const cos = Math.cos(headingRadians);
      // 機頭 = (sin h, −cos h)，右側 = (cos h, sin h)
      this.velocity.x += (forwardAccel * sin + rightAccel * cos) * delta;
      this.velocity.z += (-forwardAccel * cos + rightAccel * sin) * delta;
      // 無傾角時阻力衰減（越大停得越快）。
      const tilted = Math.abs(this.pitchDeg) > 1 || Math.abs(this.rollDeg) > 1;
      if (!tilted) {
        const decay = Math.exp(-this.params.dragCoefficient * delta);
        this.velocity.x *= decay;
        this.velocity.z *= decay;
        if (Math.abs(this.velocity.x) < 1e-3) this.velocity.x = 0;
        if (Math.abs(this.velocity.z) < 1e-3) this.velocity.z = 0;
      }
      this.positionHoldActive = false;
    } else {
      // 姿態／定位：搖桿 → 速度目標，一階滯後趨近（重型機起停延遲）。
      const forwardTarget = clamp(command.pitch, -1, 1) * maxSpeed;
      const rightTarget = clamp(command.roll, -1, 1) * maxSpeed;
      const headingRadians = (this.headingDeg * Math.PI) / 180;
      const sin = Math.sin(headingRadians);
      const cos = Math.cos(headingRadians);
      const targetX = forwardTarget * sin + rightTarget * cos;
      const targetZ = -forwardTarget * cos + rightTarget * sin;

      const centered = Math.abs(command.pitch) < EPS && Math.abs(command.roll) < EPS;
      if (this.mode === 'position' && centered) {
        // 定位保持：鬆桿瞬間記住當前位置，之後以 PD 回拉並鎖定該點
        // （真實 GNSS/RTK 定位模式行為），風在可補償上限內被抵銷。
        if (this.positionHoldTarget === null) {
          this.positionHoldTarget = { ...this.position };
        }
        const dx = this.positionHoldTarget.x - this.position.x;
        const dz = this.positionHoldTarget.z - this.position.z;
        const vx = clamp(dx * ExamFlightController.RETURN_GAIN, -maxSpeed, maxSpeed);
        const vz = clamp(dz * ExamFlightController.RETURN_GAIN, -maxSpeed, maxSpeed);
        this.velocity.x = lag(this.velocity.x, vx, this.params.horizontalVelocityTimeConstantS, delta);
        this.velocity.z = lag(this.velocity.z, vz, this.params.horizontalVelocityTimeConstantS, delta);
        this.positionHoldActive = true;
      } else {
        this.positionHoldTarget = null;
        this.positionHoldActive = false;
        this.velocity.x = lag(this.velocity.x, targetX, this.params.horizontalVelocityTimeConstantS, delta);
        this.velocity.z = lag(this.velocity.z, targetZ, this.params.horizontalVelocityTimeConstantS, delta);
      }
    }

    // 風飄移：只有「未被定位保持抵銷」的部分作用於位置。
    // 必須在 positionHoldActive 更新「之後」才取未補償風：搖桿剛回中的那一帧
    // 定位保持即應生效，否則那一帧仍吃全額風（機體被吹走 wind·dt），之後雖鎖定
    // 位置卻已留下偏移；放桿／再給桿會反覆觸發，有風時懸停永遠不成立。
    const windUncompensated = this.computeUncompensatedWind();
    this.position.x += (this.velocity.x + windUncompensated.x) * delta;
    this.position.z += (this.velocity.z + windUncompensated.z) * delta;
  }

  /**
   * 定位模式可補償的風：|wind| ≤ 上限時全部抵銷；超出時只補償到上限，
   * 超出量成為飄移（模擬假設，非官方）。
   */
  private computeUncompensatedWind(): Vector3Like {
    if (this.mode !== 'position' || !this.positionHoldActive) {
      return { ...this.wind };
    }
    const speed = Math.hypot(this.wind.x, this.wind.z);
    if (speed <= this.positionHoldMaxWindMps || speed < EPS) {
      return { x: 0, y: 0, z: 0 };
    }
    const excess = (speed - this.positionHoldMaxWindMps) / speed;
    return { x: this.wind.x * excess, y: 0, z: this.wind.z * excess };
  }

  /**
   * 垂直：手動模式油門直接控制垂直速度（無自動定高）；姿態／定位模式
   * 自動定高——回中時維持當前高度，推上／拉下給垂直速度。
   */
  private updateVertical(command: ExamStickCommand, delta: number): void {
    if (this.mode === 'manual') {
      const targetVy = (clamp(command.throttle, 0, 1) - 0.5) * 2 * MAX_VERTICAL_SPEED_MPS;
      this.velocity.y = lag(this.velocity.y, targetVy, 0.3, delta);
      this.position.y = clamp(this.position.y + this.velocity.y * delta, 0, 120);
      this.holdAltitudeM = null;
      return;
    }

    // 自動起飛完成後的油門鎖定（見 takeoffThrottleLatch）：油門維持在起飛
    // 完成值附近 → 定高；刻意改變超過門檻 → 交還手動垂直控制。
    if (this.takeoffThrottleLatch !== null) {
      if (Math.abs(command.throttle - this.takeoffThrottleLatch) <= TAKEOFF_THROTTLE_RELEASE_EPSILON) {
        if (this.holdAltitudeM === null) this.holdAltitudeM = this.position.y;
        this.updateVerticalTarget(this.holdAltitudeM, delta);
        return;
      }
      this.takeoffThrottleLatch = null;
    }

    const offCenter = clamp(command.throttle, 0, 1) - 0.5;
    if (Math.abs(offCenter) > THROTTLE_CENTER_EPSILON) {
      const targetVy = offCenter * 2 * MAX_VERTICAL_SPEED_MPS;
      this.velocity.y = lag(this.velocity.y, targetVy, this.params.horizontalVelocityTimeConstantS, delta);
      this.holdAltitudeM = null; // 脫離定高，改為爬升率控制
      this.position.y = clamp(this.position.y + this.velocity.y * delta, 0, 120);
      return;
    }

    // 自動定高：首次回中時記住當前高度，之後維持（使用 holdAltitudeM，
    // 絕不寫回 targetAltitudeM，以免重新觸發起飛分支）。
    if (this.holdAltitudeM === null) {
      this.holdAltitudeM = this.position.y;
    }
    this.updateVerticalTarget(this.holdAltitudeM, delta);
  }

  private updateVerticalTarget(targetY: number, delta: number): void {
    const difference = targetY - this.position.y;
    const desiredVelocity = clamp(difference * 2, -MAX_VERTICAL_SPEED_MPS, MAX_VERTICAL_SPEED_MPS);
    this.velocity.y = lag(this.velocity.y, desiredVelocity, 0.3, delta);
    const nextY = this.position.y + this.velocity.y * delta;
    this.position.y = difference >= 0 ? Math.min(nextY, targetY) : Math.max(nextY, targetY);
    if (Math.abs(this.position.y - targetY) < EPS) this.velocity.y = 0;
  }
}
