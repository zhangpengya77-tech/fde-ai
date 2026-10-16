import type { MissionState } from '../mission/types';
import type { PhotoValidationResult, SafetyState, Vec3 } from '../inspection/types';

/** One sampled frame of real stick input, used by the P1-7 trainee report. */
export interface ControlSample {
  /** Milliseconds since the mission start (recorder clock). */
  t: number;
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
}

/**
 * One continuous period spent in a non-safe state (WARNING / DANGER /
 * COLLISION), as recorded from real telemetry. A single continuous stay is
 * ONE episode - the score counts episodes and their duration, never frames.
 */
export interface HazardEpisode {
  state: Exclude<SafetyState, 'SAFE'>;
  durationMs: number;
}

/**
 * A single capture attempt (valid or not). Taken from the same
 * `InspectionCaptureRecord` the app persists, so the score and the stored
 * evidence can never disagree.
 */
export interface ScoreCaptureAttempt {
  index: number;
  photoValidation: PhotoValidationResult;
  safetyState: SafetyState;
}

export interface ScoreSession {
  missionId: string;
  /** Final mission state at scoring time. */
  missionFinalState: MissionState;
  /** The furthest step the mission ever reached. */
  missionBestStepIndex: number;
  missionStepTotal: number;
  /** True once the inspection itself completed (AI result produced). */
  reachedInspectionComplete: boolean;
  missionFailed: boolean;
  /** Mission duration from takeoff-ready to scoring time. */
  durationMs: number;
  homePoint: Vec3;
  targetPosition: Vec3;
  /** Actually flown path length (teleports are excluded by the recorder). */
  pathLengthM: number;
  /** Highest altitude reached this run (m). */
  maxAltitudeM: number;
  /** True if the aircraft was inside the inspection zone at any sample. */
  enteredInspectionZone: boolean;
  hazardEpisodes: HazardEpisode[];
  captureAttempts: ScoreCaptureAttempt[];
  /** |Roll|/|Pitch|/|Yaw|/|Throttle| episodes at or above full stick. */
  fullStickCount: number;
  /** Sign reversals of roll/pitch/yaw input (cooldown-filtered). */
  inputReversalCount: number;
  /** Mean absolute stick deviation while hovering (0..1). */
  hoverInputDeviation: number;
  hoverSampleCount: number;
}

export interface ScoreDimension {
  /** Chinese label shown in the UI. */
  label: string;
  score: number;
  maxScore: number;
  status: 'GOOD' | 'CHECK' | 'POOR';
  /** Short, human reasons - shown verbatim in the score panel. */
  reasons: string[];
}

export type ScoreGrade = 'EXCELLENT' | 'PASS' | 'NEEDS_PRACTICE' | 'FAIL';

export interface MissionScoreResult {
  missionId: string;
  totalScore: number;
  grade: ScoreGrade;
  /** Hard caps that were applied (e.g. collision), for transparency. */
  capped: boolean;
  capReason: string | null;
  dimensions: {
    missionCompletion: ScoreDimension;
    flightSafety: ScoreDimension;
    inspectionPosition: ScoreDimension;
    photoQuality: ScoreDimension;
    flightEfficiency: ScoreDimension;
    controlStability: ScoreDimension;
  };
  majorIssues: string[];
  suggestions: string[];
}

export interface ScoreDimensionWeights {
  missionCompletion: number;
  flightSafety: number;
  inspectionPosition: number;
  photoQuality: number;
  flightEfficiency: number;
  controlStability: number;
}

/** Grade bands (total score >= threshold). Configurable, not hard-coded. */
export interface ScoreGradeBands {
  excellent: number;
  pass: number;
  needsPractice: number;
}

export interface ScoreConfig {
  weights: ScoreDimensionWeights;
  gradeBands: ScoreGradeBands;

  /** Mission completion: score ratio when the mission ended FAILED. */
  failedMissionRatio: number;
  /** Mission completion: score ratio per completed step when never finished. */
  incompleteStepRatio: number;

  /** Safety: points removed for each collision episode. */
  collisionPenalty: number;
  /** Safety: points removed per DANGER episode. */
  dangerEpisodePenalty: number;
  /** Safety: points removed per second spent in DANGER. */
  dangerSecondPenalty: number;
  /** Safety: points removed per WARNING episode. */
  warningEpisodePenalty: number;
  /** Safety: points removed per second spent in WARNING. */
  warningSecondPenalty: number;
  /** Safety: DANGER time (s) counted as a severe violation (extra deduction). */
  severeDangerSeconds: number;
  severeDangerPenalty: number;

  /** Position: ratio of the max score for entering the zone without a valid photo. */
  zoneWithoutPhotoRatio: number;
  /** Position: ratio of the max score when the zone was never entered. */
  neverZoneRatio: number;
  /** Position: deduction when any attempt was made from an unsafe pose. */
  unsafeShotPenalty: number;
  /** Position: ideal capture distance band around the target (m). */
  idealDistanceM: number;
  idealDistanceToleranceM: number;
  offIdealDistancePenalty: number;

  /** Photo quality: below this coverage a valid photo still loses points. */
  goodCoverageRatio: number;
  lowCoveragePenalty: number;
  /** Photo quality: above this aim error a valid photo still loses points. */
  goodAngleErrorDeg: number;
  offAnglePenalty: number;
  /** Photo quality: penalty per failed attempt before the final valid one. */
  failedAttemptPenalty: number;
  /** Floor ratio for a photo that is valid at all. */
  validPhotoFloorRatio: number;

  /** Efficiency: actual/required path ratio that still scores full marks. */
  goodPathRatio: number;
  /** Efficiency: path ratio at which the score drops to poorRatio. */
  badPathRatio: number;
  poorPathRatio: number;
  /** Efficiency: teaching time budget (s); overtime deducts. */
  maxDurationSec: number;
  overtimePenalty: number;

  /** Stability: counted input peaks beyond this many episodes/indices. */
  goodFullStickCount: number;
  fullStickPenalty: number;
  goodReversalCount: number;
  reversalPenalty: number;
  goodHoverDeviation: number;
  hoverDeviationPenalty: number;

  /** Hard caps on the TOTAL score. */
  capCollisionTotal: number;
  capFailedTotal: number;

  /** Status thresholds as a ratio of the dimension max. */
  statusGoodRatio: number;
  statusCheckRatio: number;

  /** Safety hard-rule description used in majorIssues. */
  /** Display labels per grade (Chinese, for the score panel). */
  labels: Record<ScoreGrade, string>;
}
