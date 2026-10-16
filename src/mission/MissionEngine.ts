import type { InspectionAIResult, PhotoValidationResult } from '../inspection/types';
import {
  DEFAULT_MISSION_CONFIG,
  MISSION_STEP_HINT,
  MISSION_STATE_LABEL,
  MISSION_STEP_ORDER,
  type CapturePermission,
  type MissionConfig,
  type MissionState,
  type MissionStepInfo,
  type MissionTelemetry,
} from './types';

const SAFE_TO_INSPECT: ReadonlySet<string> = new Set(['SAFE', 'WARNING']);

/**
 * Deterministic inspection mission state machine.
 *
 * Pure logic — it never touches Three.js or the DOM, only consumes real
 * telemetry each frame and advances when *real* conditions hold (never a timer).
 * Externally-driven actions (capture / return / fail / submitPhoto / submitAI)
 * are gated so an action only succeeds from the correct state and only when the
 * real conditions allow it, which is the teaching core of the loop.
 */
export class MissionEngine {
  private state: MissionState = 'IDLE';
  private lastPhoto: PhotoValidationResult | null = null;
  private lastAI: InspectionAIResult | null = null;
  private lastReasons: string[] = [];

  constructor(private readonly config: MissionConfig = DEFAULT_MISSION_CONFIG) {}

  get currentState(): MissionState {
    return this.state;
  }

  get photoResult(): PhotoValidationResult | null {
    return this.lastPhoto;
  }

  get aiResult(): InspectionAIResult | null {
    return this.lastAI;
  }

  /** Reasons the most recent capture / step was rejected, if any. */
  get rejectionReasons(): string[] {
    return [...this.lastReasons];
  }

  /** Progress as a "x / n" string; empty before start or once terminal. */
  get progress(): string {
    const total = MISSION_STEP_ORDER.length;
    const index = MISSION_STEP_ORDER.indexOf(this.state);
    if (index < 0) return '';
    return `${index + 1} / ${total}`;
  }

  stepInfo(): MissionStepInfo {
    return {
      state: this.state,
      label: MISSION_STATE_LABEL[this.state],
      hint: MISSION_STEP_HINT[this.state],
      progress: this.progress,
    };
  }

  /** Advanced frame-by-frame from real telemetry. */
  update(telemetry: MissionTelemetry): void {
    // A real collision aborts the mission regardless of the current step.
    if (
      this.state !== 'IDLE' &&
      this.state !== 'COMPLETE' &&
      this.state !== 'FAILED' &&
      telemetry.safetyState === 'COLLISION'
    ) {
      this.fail('发生碰撞，任务自动结束，请降落。');
      return;
    }

    switch (this.state) {
      case 'IDLE':
        if (telemetry.flightState === 'armed') this.state = 'READY';
        break;
      case 'READY':
        if (telemetry.flightState === 'taking-off') this.state = 'TAKEOFF';
        break;
      case 'TAKEOFF':
        if (telemetry.altitude >= this.config.takeoffAltitudeM) this.state = 'FLY_TO_TARGET';
        break;
      case 'FLY_TO_TARGET':
        if (telemetry.insideInspectionZone && telemetry.safetyState !== 'COLLISION') {
          this.state = 'POSITION_FOR_INSPECTION';
        }
        break;
      case 'POSITION_FOR_INSPECTION':
        if (telemetry.insideInspectionZone && SAFE_TO_INSPECT.has(telemetry.safetyState)) {
          this.state = 'AIM_CAMERA';
        }
        break;
      case 'RETURN':
        if (telemetry.distanceToHome <= this.config.homeArriveRadiusM) this.state = 'LAND';
        break;
      case 'LAND':
        if (telemetry.flightState === 'armed' && telemetry.altitude <= 0.1) this.state = 'COMPLETE';
        break;
      default:
        break;
    }
  }

  /**
   * Trainee asks to capture. Photography itself is permitted from the aiming
   * step; *quality* (aim, zone, distance, safety) is governed afterwards by
   * `ProjectionPhotoValidator`, not here - so a poor shot is still capturable
   * and must simply be retried (the teaching core).
   */
  requestCapture(): CapturePermission {
    if (this.state !== 'AIM_CAMERA') {
      return { ok: false, reason: '当前不在拍摄步骤。' };
    }
    this.lastReasons = [];
    this.state = 'CAPTURE';
    return { ok: true };
  }

  /** Consume the validator result; a valid photo advances to AI, else retry. */
  submitPhoto(photo: PhotoValidationResult): void {
    if (this.state !== 'CAPTURE') return;
    this.lastPhoto = photo;
    if (photo.valid) {
      this.lastReasons = [];
      this.state = 'AI_INSPECTION';
    } else {
      this.lastReasons = [...photo.reasons];
      // Retry loop: go back to aiming (the trainee may also reposition).
      this.state = 'AIM_CAMERA';
    }
  }

  /** Consume the deterministic AI result and finish the inspection. */
  submitAI(ai: InspectionAIResult): void {
    if (this.state !== 'AI_INSPECTION') return;
    this.lastAI = ai;
    this.state = 'INSPECTION_COMPLETE';
  }

  /** Trainee asks to return home; only valid after inspection completes. */
  requestReturn(): CapturePermission {
    if (this.state !== 'INSPECTION_COMPLETE') {
      return { ok: false, reason: '巡检尚未完成，暂不能返航。' };
    }
    this.state = 'RETURN';
    return { ok: true };
  }

  /** Abort the mission (e.g., emergency stop or a hard failure). */
  fail(reason: string): void {
    this.state = 'FAILED';
    this.lastReasons = [reason];
  }

  /** Reset to IDLE for a new run. */
  reset(): void {
    this.state = 'IDLE';
    this.lastPhoto = null;
    this.lastAI = null;
    this.lastReasons = [];
  }
}
