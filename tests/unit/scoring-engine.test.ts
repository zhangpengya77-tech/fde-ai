import { describe, expect, it } from 'vitest';
import { ScoringEngine, gradeForTotal } from '../../src/scoring/ScoringEngine';
import { DEFAULT_SCORE_CONFIG } from '../../src/scoring/config';
import type { ScoreCaptureAttempt, ScoreSession } from '../../src/scoring/types';

/**
 * V1 teaching-score rules. The engine is pure: every number below comes from
 * real recorded data, never from the UI and never from randomness.
 */

const HOME = { x: 0, y: 0, z: 0 };
const TARGET = { x: -7.4, y: 8, z: 4 };

function session(overrides: Partial<ScoreSession> = {}): ScoreSession {
  return {
    missionId: 'mission-test',
    missionFinalState: 'COMPLETE',
    missionBestStepIndex: 11,
    missionStepTotal: 12,
    reachedInspectionComplete: true,
    missionFailed: false,
    durationMs: 60_000,
    homePoint: HOME,
    targetPosition: TARGET,
    pathLengthM: 30,
    maxAltitudeM: 8,
    enteredInspectionZone: true,
    hazardEpisodes: [],
    captureAttempts: [],
    fullStickCount: 0,
    inputReversalCount: 0,
    hoverInputDeviation: 0,
    hoverSampleCount: 0,
    ...overrides,
  };
}

function capture(index: number, overrides: Partial<ScoreCaptureAttempt['photoValidation']> = {}): ScoreCaptureAttempt {
  return {
    index,
    safetyState: 'WARNING',
    photoValidation: {
      targetVisible: true,
      coverageRatio: 0.4,
      distanceToTarget: 2.4,
      angleErrorDeg: 1,
      insideInspectionZone: true,
      safetyState: 'WARNING',
      valid: true,
      reasons: [],
      ...overrides,
    },
  };
}

function invalidCapture(index: number, reasons: string[], overrides: Partial<ScoreCaptureAttempt['photoValidation']> = {}): ScoreCaptureAttempt {
  return {
    index,
    safetyState: 'WARNING',
    photoValidation: {
      targetVisible: false,
      coverageRatio: 0,
      distanceToTarget: 3.1,
      angleErrorDeg: 20,
      insideInspectionZone: true,
      safetyState: 'WARNING',
      valid: false,
      reasons,
      ...overrides,
    },
  };
}

/** 2 x horizontal(home->target) + climb/descent budget = 8 + 16.82 ~= 24.8 m. */
const REQUIRED_PATH_M = 8 + 2 * Math.hypot(TARGET.x - HOME.x, TARGET.z - HOME.z);

describe('ScoringEngine V1', () => {
  const engine = new ScoringEngine();

  it('weights are configured and sum to exactly 100', () => {
    const total = Object.values(DEFAULT_SCORE_CONFIG.weights).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(100);
    expect(DEFAULT_SCORE_CONFIG.weights.missionCompletion).toBe(25);
    expect(DEFAULT_SCORE_CONFIG.weights.flightSafety).toBe(25);
  });

  it('a clean, complete mission scores full marks (EXCELLENT)', () => {
    const result = engine.score(
      session({ captureAttempts: [capture(1)], pathLengthM: REQUIRED_PATH_M * 1.2 }),
    );
    expect(result.totalScore).toBe(100);
    expect(result.grade).toBe('EXCELLENT');
    expect(result.capped).toBe(false);
    expect(result.dimensions.missionCompletion.score).toBe(25);
    expect(result.dimensions.flightSafety.score).toBe(25);
    expect(result.dimensions.inspectionPosition.score).toBe(15);
    expect(result.dimensions.photoQuality.score).toBe(15);
    expect(result.dimensions.flightEfficiency.score).toBe(10);
    expect(result.dimensions.controlStability.score).toBe(10);
    for (const dimension of Object.values(result.dimensions)) {
      expect(dimension.status).toBe('GOOD');
      expect(dimension.reasons.length).toBeGreaterThan(0);
    }
    expect(result.majorIssues).toEqual([]);
  });

  it('an unfinished mission loses mission-completion points and cannot reach full marks', () => {
    const result = engine.score(
      session({
        missionFinalState: 'COMPLETE',
        reachedInspectionComplete: false,
        missionBestStepIndex: 4, // AIM_CAMERA
        captureAttempts: [],
      }),
    );
    // 4 of the 8 steps up to INSPECTION_COMPLETE => 25 * 4/8 = 12.5
    expect(result.dimensions.missionCompletion.score).toBeCloseTo(12.5, 5);
    expect(result.dimensions.missionCompletion.score).toBeLessThan(25);
    expect(result.dimensions.missionCompletion.reasons.join()).toContain('未完成');
    expect(result.totalScore).toBeLessThan(90);
    expect(result.majorIssues.join()).toContain('任务未完成');
  });

  it('a FAILED mission is significantly deducted and capped at the failed cap', () => {
    const result = engine.score(
      session({
        missionFinalState: 'FAILED',
        missionFailed: true,
        reachedInspectionComplete: false,
        missionBestStepIndex: 8,
        captureAttempts: [capture(1)],
      }),
    );
    expect(result.dimensions.missionCompletion.score).toBe(0);
    // Everything else is perfect, but a failed mission still cannot pass:
    // raw total would be 75, the failed cap limits it to 59.
    expect(result.totalScore).toBe(DEFAULT_SCORE_CONFIG.capFailedTotal);
    expect(result.capped).toBe(true);
    expect(result.capReason).toContain('任务失败');
    expect(result.grade).toBe('FAIL');
    expect(result.majorIssues.join()).toContain('任务失败');
  });

  it('COLLISION forces the total cap no matter how good the rest looks', () => {
    const result = engine.score(
      session({
        // Inspected and landed fine, but the aircraft touched the structure.
        missionFinalState: 'COMPLETE',
        missionFailed: false,
        reachedInspectionComplete: true,
        captureAttempts: [capture(1)],
        hazardEpisodes: [{ state: 'COLLISION', durationMs: 2000 }],
      }),
    );
    // Raw total would be 25 + 0 + 15 + 15 + 10 + 10 = 75 -> capped at 59.
    expect(result.totalScore).toBe(DEFAULT_SCORE_CONFIG.capCollisionTotal);
    expect(result.totalScore).toBeLessThan(90); // never "90+ despite a collision"
    expect(result.capped).toBe(true);
    expect(result.capReason).toContain('碰撞');
    expect(result.dimensions.flightSafety.score).toBe(0);
    expect(result.dimensions.flightSafety.status).toBe('POOR');
    expect(result.dimensions.flightSafety.reasons.join()).toContain('碰撞');
    expect(result.majorIssues.join()).toContain('碰撞');
    expect(result.grade).toBe('FAIL');
  });

  it('a collision that also failed the mission is capped too', () => {
    const result = engine.score(
      session({
        missionFinalState: 'FAILED',
        missionFailed: true,
        reachedInspectionComplete: false,
        missionBestStepIndex: 4,
        captureAttempts: [],
        hazardEpisodes: [{ state: 'COLLISION', durationMs: 2000 }],
      }),
    );
    expect(result.totalScore).toBeLessThanOrEqual(DEFAULT_SCORE_CONFIG.capCollisionTotal);
    expect(result.grade).toBe('FAIL');
  });

  it('the collision cap is configurable', () => {
    const strict = new ScoringEngine({ ...DEFAULT_SCORE_CONFIG, capCollisionTotal: 40 });
    const result = strict.score(
      session({
        missionFailed: true,
        reachedInspectionComplete: false,
        hazardEpisodes: [{ state: 'COLLISION', durationMs: 500 }],
      }),
    );
    expect(result.totalScore).toBeLessThanOrEqual(40);
  });

  it('DANGER episodes deduct significantly from flight safety', () => {
    const result = engine.score(
      session({
        captureAttempts: [capture(1)],
        // 2 episodes x 3 s = 6 s total (>= severeDangerSeconds)
        hazardEpisodes: [
          { state: 'DANGER', durationMs: 3000 },
          { state: 'DANGER', durationMs: 3000 },
        ],
      }),
    );
    const safety = result.dimensions.flightSafety;
    // 25 - 2*4 (episodes) - 6*0.5 (seconds) - 5 (severe) = 9
    expect(safety.score).toBeCloseTo(9, 5);
    expect(safety.score).toBeLessThan(25 * 0.6);
    expect(safety.status).toBe('POOR');
    expect(safety.reasons.join()).toContain('DANGER');
    expect(result.majorIssues.join()).toContain('DANGER');
  });

  it('a short DANGER episode deducts less than a long one', () => {
    const short = engine.score(
      session({
        captureAttempts: [capture(1)],
        hazardEpisodes: [{ state: 'DANGER', durationMs: 1500 }],
      }),
    );
    // 25 - 4 - 0.75 = 20.25, no severe violation
    expect(short.dimensions.flightSafety.score).toBeCloseTo(20.25, 5);
    expect(short.dimensions.flightSafety.score).toBeGreaterThan(15);
    expect(short.totalScore).toBeLessThan(100);
  });

  it('WARNING episodes deduct only lightly', () => {
    const result = engine.score(
      session({
        captureAttempts: [capture(1)],
        hazardEpisodes: [
          { state: 'WARNING', durationMs: 1000 },
          { state: 'WARNING', durationMs: 1000 },
          { state: 'WARNING', durationMs: 1000 },
        ],
      }),
    );
    const safety = result.dimensions.flightSafety;
    // 25 - 3*1 (episodes) - 3*0.25 (seconds) = 21.25
    expect(safety.score).toBeCloseTo(21.25, 5);
    expect(safety.score).toBeLessThan(25);
    expect(safety.score).toBeGreaterThanOrEqual(25 * 0.6); // still a "light" deduction
    expect(safety.reasons.join()).toContain('WARNING');
    expect(result.totalScore).toBeLessThan(100);
  });

  it('a fully safe flight keeps flight safety at full marks', () => {
    const result = engine.score(session({ captureAttempts: [capture(1)], hazardEpisodes: [] }));
    expect(result.dimensions.flightSafety.score).toBe(25);
    expect(result.dimensions.flightSafety.reasons.join()).toContain('全程');
  });

  it('a valid photo with good geometry scores full photo-quality marks', () => {
    const result = engine.score(session({ captureAttempts: [capture(1)] }));
    expect(result.dimensions.photoQuality.score).toBe(15);
    expect(result.dimensions.photoQuality.status).toBe('GOOD');
  });

  it('a valid but mediocre photo loses photo-quality points', () => {
    const result = engine.score(
      session({
        captureAttempts: [
          capture(1, { coverageRatio: 0.1, angleErrorDeg: 12, distanceToTarget: 4.5 }),
        ],
      }),
    );
    const photo = result.dimensions.photoQuality;
    expect(photo.score).toBeLessThan(15);
    expect(photo.score).toBeGreaterThanOrEqual(15 * DEFAULT_SCORE_CONFIG.validPhotoFloorRatio);
    expect(photo.reasons.join()).toContain('占比偏小');
  });

  it('no valid photo zeroes photo quality with the real rejection reasons', () => {
    const result = engine.score(
      session({
        captureAttempts: [invalidCapture(1, ['云台方向偏差过大'])],
      }),
    );
    const photo = result.dimensions.photoQuality;
    expect(photo.score).toBe(0);
    expect(photo.status).toBe('POOR');
    expect(photo.reasons.join()).toContain('云台方向偏差过大');
    expect(result.majorIssues.join()).toContain('未获得有效巡检照片');
  });

  it('a retry after a bad shot is scored on the final valid photo and keeps the failed attempt on record', () => {
    const result = engine.score(
      session({
        captureAttempts: [
          invalidCapture(1, ['云台方向偏差过大']),
          capture(2),
        ],
      }),
    );
    const photo = result.dimensions.photoQuality;
    // 15 - 1.5 (one failed attempt before the valid final shot)
    expect(photo.score).toBeCloseTo(13.5, 5);
    expect(photo.status).toBe('GOOD');
    expect(photo.reasons.join()).toContain('共拍摄 2 次');
    expect(photo.reasons.join()).toContain('不合格');
    // The suggestion for re-aiming comes from the real first-shot reason.
    expect(result.suggestions.join()).toContain('先稳定悬停');
  });

  it('shooting outside the inspection zone costs inspection-position points', () => {
    const outside = engine.score(
      session({
        enteredInspectionZone: false,
        captureAttempts: [invalidCapture(1, ['未进入巡检拍摄区'], { insideInspectionZone: false })],
      }),
    );
    expect(outside.dimensions.inspectionPosition.score).toBe(0);
    expect(outside.dimensions.inspectionPosition.reasons.join()).toContain('未进入巡检拍摄区');

    const inZoneNoPhoto = engine.score(
      session({
        captureAttempts: [invalidCapture(1, ['距离过远'])],
      }),
    );
    // entered the zone but never produced a valid photo => 50% of the max
    expect(inZoneNoPhoto.dimensions.inspectionPosition.score).toBeCloseTo(7.5, 5);
    expect(inZoneNoPhoto.dimensions.inspectionPosition.reasons.join()).toContain('未获得有效照片');
  });

  it('capturing off the ideal distance or from a dangerous pose costs position points', () => {
    const far = engine.score(
      session({ captureAttempts: [capture(1, { distanceToTarget: 4.5 })] }),
    );
    // ideal band is 2.4 +/- 0.8 m
    expect(far.dimensions.inspectionPosition.score).toBeCloseTo(12, 5);

    const unsafe = engine.score(
      session({
        captureAttempts: [
          { index: 1, safetyState: 'DANGER', photoValidation: { ...capture(1).photoValidation, valid: false, safetyState: 'DANGER', reasons: ['拍摄位置存在安全风险'] } },
          capture(2),
        ],
      }),
    );
    expect(unsafe.dimensions.inspectionPosition.score).toBeCloseTo(12, 5);
    expect(unsafe.dimensions.inspectionPosition.reasons.join()).toContain('危险位置');
  });

  it('an obviously long detour path costs efficiency points', () => {
    const result = engine.score(
      session({ captureAttempts: [capture(1)], pathLengthM: REQUIRED_PATH_M * 4 }),
    );
    const efficiency = result.dimensions.flightEfficiency;
    // ratio 4 > badPathRatio 3 => poorPathRatio 0.2 => 10 * 0.2 = 2
    expect(efficiency.score).toBeCloseTo(2, 5);
    expect(efficiency.reasons.join()).toContain('绕行');
    expect(result.suggestions.join()).toContain('提前规划');
  });

  it('a reasonable path and on-time mission keeps full efficiency marks', () => {
    const result = engine.score(
      session({ captureAttempts: [capture(1)], pathLengthM: REQUIRED_PATH_M * 1.3, durationMs: 60_000 }),
    );
    expect(result.dimensions.flightEfficiency.score).toBe(10);
    expect(result.dimensions.flightEfficiency.reasons.join()).toContain('航程');
  });

  it('overtime deducts efficiency points', () => {
    const result = engine.score(
      session({ captureAttempts: [capture(1)], durationMs: 300_000 }),
    );
    expect(result.dimensions.flightEfficiency.score).toBe(8);
    expect(result.dimensions.flightEfficiency.reasons.join()).toContain('耗时');
  });

  it('unstable stick input scores lower than smooth input', () => {
    const smooth = engine.score(
      session({ captureAttempts: [capture(1)], fullStickCount: 0, inputReversalCount: 0, hoverInputDeviation: 0, hoverSampleCount: 30 }),
    );
    const rough = engine.score(
      session({ captureAttempts: [capture(1)], fullStickCount: 8, inputReversalCount: 14, hoverInputDeviation: 0.16, hoverSampleCount: 30 }),
    );
    expect(smooth.dimensions.controlStability.score).toBe(10);
    expect(smooth.dimensions.controlStability.reasons.join()).toContain('平稳');
    expect(rough.dimensions.controlStability.score).toBeLessThan(6);
    expect(rough.dimensions.controlStability.reasons.join()).toContain('满杆');
    expect(rough.totalScore).toBeLessThan(smooth.totalScore);
  });

  it('grade bands follow the configured thresholds', () => {
    const bands = DEFAULT_SCORE_CONFIG.gradeBands;
    expect(gradeForTotal(100, bands)).toBe('EXCELLENT');
    expect(gradeForTotal(90, bands)).toBe('EXCELLENT');
    expect(gradeForTotal(89, bands)).toBe('PASS');
    expect(gradeForTotal(70, bands)).toBe('PASS');
    expect(gradeForTotal(69, bands)).toBe('NEEDS_PRACTICE');
    expect(gradeForTotal(60, bands)).toBe('NEEDS_PRACTICE');
    expect(gradeForTotal(59, bands)).toBe('FAIL');
    expect(gradeForTotal(0, bands)).toBe('FAIL');
  });

  it('grade thresholds are configurable', () => {
    const custom = new ScoringEngine({ ...DEFAULT_SCORE_CONFIG, gradeBands: { excellent: 95, pass: 80, needsPractice: 50 } });
    const result = custom.score(session({ captureAttempts: [capture(1)] }));
    expect(result.grade).toBe('EXCELLENT'); // 100 still excellent
    expect(gradeForTotal(80, custom.config.gradeBands)).toBe('PASS');
    expect(gradeForTotal(50, custom.config.gradeBands)).toBe('NEEDS_PRACTICE');
  });

  it('the total equals the sum of dimensions when no hard cap applies', () => {
    const result = engine.score(
      session({
        captureAttempts: [capture(1)],
        hazardEpisodes: [{ state: 'WARNING', durationMs: 2000 }],
      }),
    );
    const sum = Object.values(result.dimensions).reduce((total, dimension) => total + dimension.score, 0);
    expect(result.totalScore).toBeCloseTo(Math.round(sum), 5);
    expect(result.capped).toBe(false);
  });

  it('suggestions are deterministic and sourced from real reasons', () => {
    const input = session({
      captureAttempts: [capture(1, { distanceToTarget: 4.5 })],
      hazardEpisodes: [{ state: 'DANGER', durationMs: 6000 }],
      pathLengthM: REQUIRED_PATH_M * 4,
      fullStickCount: 8,
    });
    const first = engine.score(input);
    const second = engine.score(input);
    expect(first.suggestions).toEqual(second.suggestions);
    expect(first.totalScore).toBe(second.totalScore);
    expect(first.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(first.suggestions.length).toBeLessThanOrEqual(3);
    expect(first.suggestions.join()).toContain('减速'); // DANGER -> distance warning
  });

  it('a flawless run still gets one short positive suggestion', () => {
    const result = engine.score(session({ captureAttempts: [capture(1)] }));
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toContain('保持');
  });
});
