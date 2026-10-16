import { MISSION_STEP_ORDER } from '../mission/types';
import type { MissionState } from '../mission/types';
import type { FlightState } from '../flight/types';
import type { InspectionCaptureRecord } from '../inspection/types';
import type { SafetyState } from '../inspection/types';
import type { ScoreCaptureAttempt, ScoreSession } from './types';

/** One frame of real telemetry, as fed by the render loop. */
export interface RecorderSampleInput {
  position: { x: number; y: number; z: number };
  safetyState: SafetyState;
  insideInspectionZone: boolean;
  flightState: FlightState;
  horizontalSpeedMps: number;
  command: { roll: number; pitch: number; yaw: number; throttle: number };
  /** Frame timestamp in ms (performance.now()). */
  now: number;
}

/** Teaching thresholds for the raw input statistics (V1 basics only). */
const PATH_EPSILON_M = 0.02;
const FULL_STICK_THRESHOLD = 0.9;
const REVERSAL_THRESHOLD = 0.15;
const REVERSAL_COOLDOWN_MS = 150;
const HOVER_SPEED_MPS = 0.5;
const HOVER_ALTITUDE_M = 0.5;

/**
 * Collects the REAL data the ScoringEngine scores: flown path, hazard
 * episodes (count + duration, never frames), mission progress, capture
 * attempts and basic stick-input statistics.
 *
 * It never invents data and never scores anything itself - it only records.
 * Teleports (the test seam) are flagged and excluded from the flown path,
 * because a teleport is not flying.
 */
export class SessionRecorder {
  private missionId = 'mission-unknown';
  private startTime: number | null = null;
  private lastTime: number | null = null;
  private lastPosition: { x: number; y: number; z: number } | null = null;
  private pathLengthM = 0;
  private teleportPending = false;
  private maxAltitudeM = 0;
  private enteredInspectionZone = false;

  private currentEpisode: { state: Exclude<SafetyState, 'SAFE'>; startedAt: number; lastAt: number } | null = null;
  private hazardEpisodes: ScoreSession['hazardEpisodes'] = [];

  private missionBestStepIndex = 0;
  private missionFinalState: MissionState = 'IDLE';
  private reachedInspectionComplete = false;
  private missionFailed = false;

  private captureSeq = 0;
  private captureAttempts: ScoreCaptureAttempt[] = [];

  private fullStickActive = false;
  private fullStickCount = 0;
  private lastSign: { roll: number; pitch: number; yaw: number } | null = null;
  private lastReversalAt = Number.NEGATIVE_INFINITY;
  private inputReversalCount = 0;
  private hoverDeviationSum = 0;
  private hoverSampleCount = 0;

  reset(missionId: string): void {
    this.missionId = missionId;
    this.startTime = null;
    this.lastTime = null;
    this.lastPosition = null;
    this.pathLengthM = 0;
    this.teleportPending = false;
    this.maxAltitudeM = 0;
    this.enteredInspectionZone = false;
    this.currentEpisode = null;
    this.hazardEpisodes = [];
    this.missionBestStepIndex = 0;
    this.missionFinalState = 'IDLE';
    this.reachedInspectionComplete = false;
    this.missionFailed = false;
    this.captureSeq = 0;
    this.captureAttempts = [];
    this.fullStickActive = false;
    this.fullStickCount = 0;
    this.lastSign = null;
    this.lastReversalAt = Number.NEGATIVE_INFINITY;
    this.inputReversalCount = 0;
    this.hoverDeviationSum = 0;
    this.hoverSampleCount = 0;
  }

  /** Mark that the next positional delta is a test-harness teleport, not flying. */
  noteTeleport(): void {
    this.teleportPending = true;
  }

  sample(input: RecorderSampleInput): void {
    if (this.startTime === null && input.flightState !== 'disarmed') {
      this.startTime = input.now;
    }
    if (this.startTime !== null) {
      this.lastTime = input.now;
    }

    // Flown path (teleports excluded).
    if (this.lastPosition) {
      const delta = Math.hypot(
        input.position.x - this.lastPosition.x,
        input.position.y - this.lastPosition.y,
        input.position.z - this.lastPosition.z,
      );
      if (this.teleportPending) {
        this.teleportPending = false;
      } else if (delta > PATH_EPSILON_M) {
        this.pathLengthM += delta;
      }
    }
    this.lastPosition = { ...input.position };
    this.maxAltitudeM = Math.max(this.maxAltitudeM, input.position.y);
    if (input.insideInspectionZone) this.enteredInspectionZone = true;

    this.trackHazard(input.safetyState, input.now);
    this.trackStickInput(input.command, input.now);
    this.trackHover(input.command, input.horizontalSpeedMps, input.position.y);
  }

  observeMission(state: MissionState, now: number): void {
    const index = MISSION_STEP_ORDER.indexOf(state);
    if (index >= 0 && index > this.missionBestStepIndex) {
      this.missionBestStepIndex = index;
    }
    if (index >= MISSION_STEP_ORDER.indexOf('INSPECTION_COMPLETE')) {
      this.reachedInspectionComplete = true;
    }
    if (state === 'FAILED') this.missionFailed = true;
    this.missionFinalState = state;
    if (this.startTime !== null) this.lastTime = now;
  }

  recordCapture(record: InspectionCaptureRecord): void {
    this.captureSeq += 1;
    this.captureAttempts.push({
      index: this.captureSeq,
      photoValidation: record.photoValidation,
      safetyState: record.safetyState,
    });
  }

  /** True once the mission got past takeoff (a real run happened). */
  hasReachedTakeoff(): boolean {
    return this.missionBestStepIndex >= MISSION_STEP_ORDER.indexOf('TAKEOFF');
  }

  session(): ScoreSession {
    // Non-mutating snapshot: an open hazard episode is reported with its
    // duration so far but stays open for further samples.
    const hazardEpisodes: ScoreSession['hazardEpisodes'] = [...this.hazardEpisodes];
    if (this.currentEpisode) {
      hazardEpisodes.push({
        state: this.currentEpisode.state,
        durationMs: Math.max(this.currentEpisode.lastAt - this.currentEpisode.startedAt, 0),
      });
    }
    return {
      missionId: this.missionId,
      missionFinalState: this.missionFinalState,
      missionBestStepIndex: this.missionBestStepIndex,
      missionStepTotal: MISSION_STEP_ORDER.length,
      reachedInspectionComplete: this.reachedInspectionComplete,
      missionFailed: this.missionFailed,
      durationMs:
        this.startTime !== null && this.lastTime !== null ? Math.max(this.lastTime - this.startTime, 0) : 0,
      // Filled by the caller from the scene layout (pure geometry the recorder
      // must not duplicate); defaults are only used when the app forgets.
      ...this.sceneRef,
      pathLengthM: this.pathLengthM,
      maxAltitudeM: this.maxAltitudeM,
      enteredInspectionZone: this.enteredInspectionZone,
      hazardEpisodes,
      captureAttempts: [...this.captureAttempts],
      fullStickCount: this.fullStickCount,
      inputReversalCount: this.inputReversalCount,
      hoverInputDeviation: this.hoverSampleCount > 0 ? this.hoverDeviationSum / this.hoverSampleCount : 0,
      hoverSampleCount: this.hoverSampleCount,
    };
  }

  /** Scene reference points the app provides once (target + home). */
  private sceneRef: { homePoint: { x: number; y: number; z: number }; targetPosition: { x: number; y: number; z: number } } = {
    homePoint: { x: 0, y: 0, z: 0 },
    targetPosition: { x: 0, y: 0, z: 0 },
  };

  setSceneReference(homePoint: { x: number; y: number; z: number }, targetPosition: { x: number; y: number; z: number }): void {
    this.sceneRef = { homePoint: { ...homePoint }, targetPosition: { ...targetPosition } };
  }

  private trackHazard(state: SafetyState, now: number): void {
    if (state === 'SAFE') {
      this.closeOpenEpisode();
      return;
    }
    if (this.currentEpisode && this.currentEpisode.state === state) {
      this.currentEpisode.lastAt = now;
      return;
    }
    this.closeOpenEpisode();
    this.currentEpisode = { state, startedAt: now, lastAt: now };
  }

  private closeOpenEpisode(): void {
    if (!this.currentEpisode) return;
    const episode = this.currentEpisode;
    this.hazardEpisodes.push({
      state: episode.state,
      durationMs: Math.max(episode.lastAt - episode.startedAt, 0),
    });
    this.currentEpisode = null;
  }

  private trackStickInput(command: RecorderSampleInput['command'], now: number): void {
    const axes = [command.roll, command.pitch, command.yaw, command.throttle];
    const atFullStick = axes.some((value) => Math.abs(value) >= FULL_STICK_THRESHOLD);
    if (atFullStick && !this.fullStickActive) {
      this.fullStickCount += 1;
      this.fullStickActive = true;
    } else if (!atFullStick) {
      this.fullStickActive = false;
    }

    const signs = {
      roll: this.signOf(command.roll),
      pitch: this.signOf(command.pitch),
      yaw: this.signOf(command.yaw),
    };
    if (this.lastSign) {
      const reversed = (['roll', 'pitch', 'yaw'] as const).some(
        (axis) =>
          this.isSignificant(command[axis]) &&
          signs[axis] !== 0 &&
          this.lastSign !== null &&
          this.lastSign[axis] !== 0 &&
          signs[axis] !== this.lastSign[axis],
      );
      if (reversed && now - this.lastReversalAt >= REVERSAL_COOLDOWN_MS) {
        this.inputReversalCount += 1;
        this.lastReversalAt = now;
      }
    }
    this.lastSign = signs;
  }

  private trackHover(command: RecorderSampleInput['command'], horizontalSpeedMps: number, altitude: number): void {
    if (horizontalSpeedMps >= HOVER_SPEED_MPS || altitude <= HOVER_ALTITUDE_M) return;
    this.hoverSampleCount += 1;
    this.hoverDeviationSum += (Math.abs(command.roll) + Math.abs(command.pitch) + Math.abs(command.yaw)) / 3;
  }

  private signOf(value: number): number {
    if (value >= REVERSAL_THRESHOLD) return 1;
    if (value <= -REVERSAL_THRESHOLD) return -1;
    return 0;
  }

  private isSignificant(value: number): boolean {
    return Math.abs(value) >= REVERSAL_THRESHOLD;
  }
}
