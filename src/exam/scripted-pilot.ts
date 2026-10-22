/**
 * 腳本化「理想操作」飛行員（CAA 專業基本級術科模擬，端到端驗證用）。
 *
 * 目的：產生「搖桿指令序列」並真的送進考試機飛控（ExamFlightController），
 * 讓同一套判定（judgeSubjectB / judgeSubjectC）去評分。這不是合成軌跡——
 * 機體位置由飛控積分出來，飛行員只知道參考路徑與當前快照。
 *
 * 控制策略（閉環，位置模式）：
 *  - 參考點：hold 模式為定點；path 模式為「路徑上當前弧長對應的理想位置」，
 *    並以固定速度沿弧長推進；
 *  - 飛行員控制的對象是「對地速度」＝對空速度＋風（人看的是機體對地移動）；
 *  - 期望對地速度 = 參考切向速度 + kp·(參考點 − 當前) − kd·(對地速度 − 參考切向速度)；
 *    再扣掉觀測風得到期望對空速度（頂風修正）。kd 項以「對地速度」為對象是
 *    關鍵：若以對空速度為對象，穩態時對空速度 = −風 ≠ 0，kd 項會留下
 *    kd·風/kp 的定點偏移（風 5m/s、kp=3、kd=2.5 → 4.17m），懸停會定在錯誤的位置。
 *  - 放桿（stick release）：位置誤差與「對地速度」都夠小時輸出精確 0，讓定位保持
 *    接手（真實飛手飛到定點附近就放桿，由 GNSS/RTK 定位鎖定並抵銷風）。
 *  - 高度：油門偏離中位修正高度誤差（回中即自動定高）；
 *  - 航向：等速趨向目標航向（科目 B 需要 0→90→180→270→360）；
 *    path 模式可指定 'tangent'（機頭一律朝飛行方向，官方科目C 準則）。
 *
 * 風補償：考試機飛控僅在「搖桿回中」時抵銷風（放桿鎖定位置）。機動中桿不為零，
 * 風會把機體吹走，因此理想操作以觀測到的風向量做前饋補償（真實自駕儀／熟手
 * 也會頂風修正）。放桿時由定位保持抵銷，不再重複補償。可關閉以觀察未補償時
 * 的 raw 偏差。
 *
 * 停頓（pause）：輸出精確 0 放桿——飛手在中途停住就是放開桿讓機體定住。
 * 若用 PD 把參考點釘在当前位置，桿不為零、定位保持不生效，風會把機體吹離
 * 路徑，量測到的就不只是「停頓」而是「停頓＋偏離」，無法歸因。
 *
 * 注意：本類別只產生搖桿指令，不触碰任何判定閾值（simAssist）。
 */

import { angleDelta } from './subjects';
import type { ExamFlightSnapshot, ExamStickCommand } from './types';

export interface PilotPoint {
  x: number;
  z: number;
}

/** path 模式航向：固定角度／維持當前（null）／隨路徑切向（'tangent'）。 */
export type PilotPathHeading = number | null | 'tangent';

export interface ScriptedPilotOptions {
  /** 位置增益（1/s）。越大跟得越緊。 */
  positionGain?: number;
  /** 速度阻尼（無因次）。抵消飛控速度滯後造成的欠阻尼。 */
  velocityDamping?: number;
  /** 速度上限（m/s）＝搖桿滿桿對應的地速（與飛機參數一致）。 */
  maxSpeedMps?: number;
  /** 放桿的位置誤差門檻（m）：小於此值且速度也小時輸出精確 0。 */
  settlePositionM?: number;
  /** 放桿的速度門檻（m/s）。 */
  settleSpeedMps?: number;
  /** 是否以觀測風向量做前饋補償（理想操作，預設開）。 */
  compensateWind?: boolean;
  /** 航向比例增益（搖桿單位／度）。 */
  headingGain?: number;
  /** 航向死區（度）：進入此範圍不再輸出偏航。 */
  headingDeadzoneDeg?: number;
}

const EPS = 1e-6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export class ScriptedPilot {
  private readonly gain: number;
  private readonly damping: number;
  private readonly maxSpeed: number;
  private readonly settlePosition: number;
  private readonly settleSpeed: number;
  private readonly compensateWind: boolean;
  private readonly headingGain: number;
  private readonly headingDeadzone: number;

  private mode: 'hold' | 'path' = 'hold';
  private holdPoint: PilotPoint = { x: 0, z: 0 };
  private targetHeadingDeg: number | null = 0;
  private targetAltitudeM = 1.5;

  private path: PilotPoint[] = [];
  /** 每個路徑點的累積弧長（m）。 */
  private pathCum: number[] = [0];
  private pathTotal = 0;
  private pathArc = 0;
  /** pointAtArc 的搜尋游標（弧長單調前進，均攤 O(1)）。 */
  private pathCursor = 1;
  private pathSpeed = 3;
  private pathHeadingDeg: PilotPathHeading = 0;
  /** 路徑切向航向（度；'tangent' 模式用）。 */
  private pathTangentDeg = 0;

  /** >0 時暫停（模擬「不良操作」的中途停頓）：放桿定住。 */
  private pauseS = 0;

  constructor(options: ScriptedPilotOptions = {}) {
    this.gain = options.positionGain ?? 3;
    this.damping = options.velocityDamping ?? 2.5;
    this.maxSpeed = options.maxSpeedMps ?? 8;
    this.settlePosition = options.settlePositionM ?? 0.06;
    this.settleSpeed = options.settleSpeedMps ?? 0.12;
    this.compensateWind = options.compensateWind ?? true;
    this.headingGain = options.headingGain ?? 1 / 10;
    this.headingDeadzone = options.headingDeadzoneDeg ?? 0.5;
  }

  /** 定點懸停（可指定航向；null = 維持當前航向）。 */
  hold(point: PilotPoint, headingDeg: number | null, altitudeM: number): void {
    this.mode = 'hold';
    this.holdPoint = { ...point };
    this.targetHeadingDeg = headingDeg;
    this.targetAltitudeM = altitudeM;
  }

  /** 沿路徑飛行（參考點以 speedMps 推進）。 */
  followPath(
    points: PilotPoint[],
    speedMps: number,
    altitudeM: number,
    headingDeg: PilotPathHeading = 0,
  ): void {
    this.mode = 'path';
    this.path = points.map((p) => ({ ...p }));
    this.pathCum = [0];
    for (let i = 1; i < this.path.length; i += 1) {
      const dx = this.path[i].x - this.path[i - 1].x;
      const dz = this.path[i].z - this.path[i - 1].z;
      this.pathCum.push(this.pathCum[i - 1] + Math.hypot(dx, dz));
    }
    this.pathTotal = this.pathCum[this.pathCum.length - 1] ?? 0;
    this.pathArc = 0;
    this.pathCursor = 1;
    this.pathSpeed = speedMps;
    this.pathHeadingDeg = headingDeg;
    this.targetAltitudeM = altitudeM;
  }

  /** 路徑進度 0..1。 */
  get progress(): number {
    return this.pathTotal > 0 ? clamp(this.pathArc / this.pathTotal, 0, 1) : 1;
  }

  /** 暫停指定秒數（用於模擬不良操作：放桿定住）。 */
  pause(seconds: number): void {
    this.pauseS = Math.max(this.pauseS, seconds);
  }

  /** 目前參考點（供腳本判斷進度）。 */
  currentReference(): PilotPoint {
    return this.mode === 'path' ? this.pointAtArc(this.pathArc) : { ...this.holdPoint };
  }

  update(snapshot: ExamFlightSnapshot, dt: number): ExamStickCommand {
    const step = clamp(dt, 0, 0.1);

    // 參考點與參考切向速度（世界座標）。
    let refX = 0;
    let refZ = 0;
    let vRefX = 0;
    let vRefZ = 0;
    /** 放桿：輸出精確 0，讓定位保持接手。 */
    let release = false;

    if (this.pauseS > 0) {
      // 停頓：放桿定住（定位保持釘住當前位置並抵銷風）。
      this.pauseS = Math.max(0, this.pauseS - step);
      release = true;
    } else if (this.mode === 'hold') {
      refX = this.holdPoint.x;
      refZ = this.holdPoint.z;
    } else {
      this.pathArc = Math.min(this.pathTotal, this.pathArc + this.pathSpeed * step);
      const ref = this.pointAtArc(this.pathArc);
      refX = ref.x;
      refZ = ref.z;
      // 前饋：參考點切向速度（以弧長前後各 0.25m 的差分推切向）。
      const ahead = this.pointAtArc(Math.min(this.pathTotal, this.pathArc + 0.25));
      const behind = this.pointAtArc(Math.max(0, this.pathArc - 0.25));
      const tx = ahead.x - behind.x;
      const tz = ahead.z - behind.z;
      const tLen = Math.hypot(tx, tz);
      if (tLen > EPS) {
        vRefX = (tx / tLen) * this.pathSpeed;
        vRefZ = (tz / tLen) * this.pathSpeed;
        // 航向約定：heading 0 = −Z、90 = +X → heading = atan2(dx, −dz)。
        this.pathTangentDeg = (Math.atan2(tx, -tz) * 180) / Math.PI;
      }
      if (this.pathArc >= this.pathTotal) {
        // 終點：收斂到最後一點（切向前饋歸零）。
        vRefX = 0;
        vRefZ = 0;
      }
    }

    // 觀測（世界座標）。「觀測有效風」依上一帧定位保持是否生效而定——那才是
    // 上一帧真正作用於機體的風。注意：本帧是否放桿會改變定位保持狀態，所以
    // 「控制有效風」必須另依本帧的 release 決定（見下方頂風修正），不能沿用
    // 觀測值：一給桿定位保持就解除、風全額回來，用舊值會少補一份風。
    const windX = snapshot.windVector.x;
    const windZ = snapshot.windVector.z;
    const obsWindX = this.compensateWind && !snapshot.positionHoldCompensating ? windX : 0;
    const obsWindZ = this.compensateWind && !snapshot.positionHoldCompensating ? windZ : 0;
    const groundVx = snapshot.velocity.x + obsWindX;
    const groundVz = snapshot.velocity.z + obsWindZ;

    // 期望「對地速度」：PD + 切向前饋。kd 項以對地速度為對象（見檔頭說明）：
    // 穩態時對空速度 = −風，若對對空速度取阻尼會留下 kd·風/kp 的定點偏移。
    const ctrlVx = this.compensateWind ? groundVx : snapshot.velocity.x;
    const ctrlVz = this.compensateWind ? groundVz : snapshot.velocity.z;

    const errX = refX - snapshot.position.x;
    const errZ = refZ - snapshot.position.z;
    let desiredGroundVx = vRefX + this.gain * errX - this.damping * (ctrlVx - vRefX);
    let desiredGroundVz = vRefZ + this.gain * errZ - this.damping * (ctrlVz - vRefZ);

    // 放桿判斷：位置誤差夠小，且「對空速度」夠小。
    //
    // 為什麼不能只以對地速度為準：有風時懸停的對空速度≈風速（頂風維持定點），
    // 此時若因對地速度小就放桿，定位保持會以「滯後速度」接手——機體仍以空速
    // 慣性滑行約 wind·τ（風 5m/s、τ=0.7s → 3.5m），遠超定位漂移容差，且放桿／
    // 再給桿反覆觸發會形成 ground speed 0.1~0.4 m/s 的極限環，把懸停平台打碎。
    // 故放桿一律以對空速度收斂為準（涵蓋剛起飛與無風收斂兩種時機）。
    if (!release) {
      const errMag = Math.hypot(errX, errZ);
      const airSpd = Math.hypot(snapshot.velocity.x, snapshot.velocity.z);
      if (errMag <= this.settlePosition && airSpd <= this.settleSpeed) release = true;
    }

    // 頂風修正：期望對空速度 = 期望對地速度 − 本帧真正會作用的風。
    // 放桿 → 定位保持生效 → 風被抵銷；給桿 → 定位保持解除 → 全額風。
    let desiredVx = desiredGroundVx;
    let desiredVz = desiredGroundVz;
    if (this.compensateWind && !release) {
      desiredVx -= windX;
      desiredVz -= windZ;
    }

    const speed = Math.hypot(desiredVx, desiredVz);
    if (speed > this.maxSpeed) {
      desiredVx = (desiredVx / speed) * this.maxSpeed;
      desiredVz = (desiredVz / speed) * this.maxSpeed;
    }

    // 世界速度 → 機體搖桿（依當前航向分解）。
    let roll = 0;
    let pitch = 0;
    if (!release) {
      const h = (snapshot.headingDeg * Math.PI) / 180;
      const sin = Math.sin(h);
      const cos = Math.cos(h);
      const forward = desiredVx * sin - desiredVz * cos;
      const right = desiredVx * cos + desiredVz * sin;
      // 以 maxSpeed 對應滿桿（與飛控內部 clamp(command,±1)*maxSpeed 一致）。
      pitch = clamp(forward / this.maxSpeed, -1, 1);
      roll = clamp(right / this.maxSpeed, -1, 1);
    }

    // 偏航：等速趨向目標航向。
    let yaw = 0;
    let targetHeading: number | null;
    if (this.mode === 'path') {
      targetHeading = this.pathHeadingDeg === 'tangent' ? this.pathTangentDeg : this.pathHeadingDeg;
    } else {
      targetHeading = this.targetHeadingDeg;
    }
    if (targetHeading !== null) {
      const err = angleDelta(targetHeading, snapshot.headingDeg);
      if (Math.abs(err) > this.headingDeadzone) {
        yaw = clamp(err * this.headingGain, -1, 1);
      }
    }

    // 油門：偏離中位修正高度誤差；回中即自動定高。
    const altErr = this.targetAltitudeM - snapshot.position.y;
    let throttle = 0.5;
    if (altErr > 0.05) throttle = clamp(0.5 + altErr * 0.6, 0.5, 1);
    else if (altErr < -0.05) throttle = clamp(0.5 + altErr * 0.6, 0, 0.5);

    return { roll, pitch, yaw, throttle };
  }

  private pointAtArc(arc: number): PilotPoint {
    if (this.path.length === 0) return { x: 0, z: 0 };
    if (arc <= 0) return { ...this.path[0] };
    if (arc >= this.pathTotal) return { ...this.path[this.path.length - 1] };
    // 以游標為起點雙向搜尋「第一個 cum ≥ arc」的索引（弧長單調前進，均攤 O(1)）。
    let i = Math.min(Math.max(1, this.pathCursor), this.pathCum.length - 1);
    if (this.pathCum[i] < arc) {
      while (i < this.pathCum.length && this.pathCum[i] < arc) i += 1;
    } else {
      while (i > 1 && this.pathCum[i - 1] >= arc) i -= 1;
    }
    this.pathCursor = i;
    const a = this.path[i - 1];
    const b = this.path[i];
    const segLen = this.pathCum[i] - this.pathCum[i - 1];
    const t = segLen > EPS ? (arc - this.pathCum[i - 1]) / segLen : 0;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }
}
