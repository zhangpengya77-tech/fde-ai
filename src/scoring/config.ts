import type { ScoreConfig, ScoreDimensionWeights } from './types';

/**
 * V1 teaching weights (points out of 100). Kept in one config object so the
 * UI never hard-codes numbers and teachers can re-balance without code edits.
 */
export const DEFAULT_SCORE_WEIGHTS: ScoreDimensionWeights = {
  missionCompletion: 25,
  flightSafety: 25,
  inspectionPosition: 15,
  photoQuality: 15,
  flightEfficiency: 10,
  controlStability: 10,
};

/**
 * Teaching-tuned V1 defaults. These are deliberately simple and transparent:
 * every deduction below is explainable to a trainee in one sentence.
 *
 * They are NOT an official licence-exam standard.
 */
export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  weights: DEFAULT_SCORE_WEIGHTS,
  gradeBands: { excellent: 90, pass: 70, needsPractice: 60 },

  failedMissionRatio: 0,
  incompleteStepRatio: 1,

  collisionPenalty: 25,
  dangerEpisodePenalty: 4,
  dangerSecondPenalty: 0.5,
  warningEpisodePenalty: 1,
  warningSecondPenalty: 0.25,
  severeDangerSeconds: 5,
  severeDangerPenalty: 5,

  zoneWithoutPhotoRatio: 0.5,
  neverZoneRatio: 0,
  unsafeShotPenalty: 3,
  idealDistanceM: 2.4,
  idealDistanceToleranceM: 1,
  offIdealDistancePenalty: 3,

  goodCoverageRatio: 0.25,
  lowCoveragePenalty: 3,
  goodAngleErrorDeg: 5,
  offAnglePenalty: 3,
  failedAttemptPenalty: 1.5,
  validPhotoFloorRatio: 0.6,

  goodPathRatio: 1.6,
  badPathRatio: 3,
  poorPathRatio: 0.2,
  maxDurationSec: 240,
  overtimePenalty: 2,

  goodFullStickCount: 3,
  fullStickPenalty: 1,
  goodReversalCount: 6,
  reversalPenalty: 0.5,
  goodHoverDeviation: 0.08,
  hoverDeviationPenalty: 10,

  capCollisionTotal: 59,
  capFailedTotal: 59,

  statusGoodRatio: 0.8,
  statusCheckRatio: 0.5,

  labels: {
    EXCELLENT: 'EXCELLENT（优秀）',
    PASS: 'PASS（通过）',
    NEEDS_PRACTICE: 'NEEDS_PRACTICE（需要加强）',
    FAIL: 'FAIL（未通过）',
  },
};
